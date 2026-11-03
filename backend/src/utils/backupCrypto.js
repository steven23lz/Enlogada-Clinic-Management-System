const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');

/**
 * Encrypts a backup file with a passphrase (BACKUP_PASSPHRASE). [1.148.0]
 *
 * A backup holds every patient's record, so one copied to a second drive or a cloud folder must
 * be unreadable to whoever finds it there. AES-256-GCM, with the key derived from the passphrase
 * by scrypt and a fresh salt and IV per file. GCM also proves the file is intact: a damaged or
 * altered backup fails to decrypt instead of restoring half a database.
 *
 * Layout: MAGIC (8) | salt (16) | iv (12) | ciphertext | tag (16).
 *
 * Without the passphrase the file cannot be restored by anyone, the clinic included, so it is
 * kept somewhere other than the backup's own drive (docs/BACKUP_AND_RESTORE.md).
 */
const MAGIC = Buffer.from('ENLBAK01');
const SALT = 16;
const IV = 12;
const TAG = 16;
const HEADER = MAGIC.length + SALT + IV;

const keyFor = (passphrase, salt) => crypto.scryptSync(String(passphrase), salt, 32);

async function encryptFile(source, target, passphrase) {
  const salt = crypto.randomBytes(SALT);
  const iv = crypto.randomBytes(IV);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  const out = fs.createWriteStream(target);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(source), cipher, out, { end: false });
  await new Promise((resolve, reject) => {
    out.end(cipher.getAuthTag(), (err) => (err ? reject(err) : resolve()));
  });
}

async function decryptFile(source, target, passphrase) {
  const { size } = fs.statSync(source);
  if (size < HEADER + TAG) throw new Error('This is not an encrypted backup: it is too short.');
  const fd = fs.openSync(source, 'r');
  let header;
  let tag;
  try {
    header = Buffer.alloc(HEADER);
    fs.readSync(fd, header, 0, HEADER, 0);
    tag = Buffer.alloc(TAG);
    fs.readSync(fd, tag, 0, TAG, size - TAG);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not an encrypted backup.');
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT);
  const iv = header.subarray(MAGIC.length + SALT);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    await pipeline(fs.createReadStream(source, { start: HEADER, end: size - TAG - 1 }), decipher, fs.createWriteStream(target));
  } catch (err) {
    fs.rmSync(target, { force: true });
    throw new Error(`Could not decrypt ${source}: wrong passphrase, or the file is damaged.`);
  }
}

const isEncryptedName = (name) => String(name).endsWith('.enc');

module.exports = { encryptFile, decryptFile, isEncryptedName };
