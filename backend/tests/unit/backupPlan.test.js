const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  backupFileName, backupFileDate, backupDue, filesToDelete, removedFoldersToDelete, parseClock,
} = require('../../src/utils/backupPlan');
const { encryptFile, decryptFile } = require('../../src/utils/backupCrypto');

// The nightly backup. [1.148.0] Local parts, as the server reads the clinic's clock.
const at = (day, hour, minute = 0) => new Date(2026, 10, day, hour, minute);

test('a backup file is named for the clinic day and minute it was made, and read back', () => {
  const name = backupFileName(at(4, 18, 2));
  assert.equal(name, 'enlogada-2026-11-04-1802.dump');
  assert.equal(backupFileName(at(4, 18, 2), { encrypted: true }), 'enlogada-2026-11-04-1802.dump.enc');
  assert.deepEqual(backupFileDate(name), at(4, 18, 2));
  assert.equal(backupFileDate('notes.txt'), null);
  assert.equal(backupFileDate('enlogada-2026-11-04-1802.sql'), null);
});

test('never backed up: due at once', () => {
  assert.equal(backupDue({ now: at(4, 9) }), true);
});

test('backed up this morning: the evening one waits for 18:00', () => {
  assert.equal(backupDue({ lastSuccessAt: at(4, 8), now: at(4, 17, 59) }), false);
  assert.equal(backupDue({ lastSuccessAt: at(4, 8), now: at(4, 18) }), true);
  assert.equal(backupDue({ lastSuccessAt: at(4, 18, 1), now: at(4, 23) }), false);
});

test('a PC switched off every evening still gets one a day, at start-up', () => {
  // Last made at 08:05 yesterday, when it was switched on; 18:00 was never reached.
  assert.equal(backupDue({ lastSuccessAt: at(3, 8, 5), now: at(4, 8, 4) }), false);
  assert.equal(backupDue({ lastSuccessAt: at(3, 8, 5), now: at(4, 8, 5) }), true);
});

test('after a failure it waits an hour before trying again', () => {
  const lastSuccessAt = at(2, 18);
  assert.equal(backupDue({ lastSuccessAt, lastFailureAt: at(4, 9), now: at(4, 9, 30) }), false);
  assert.equal(backupDue({ lastSuccessAt, lastFailureAt: at(4, 9), now: at(4, 10) }), true);
  // An old failure, since succeeded, does not hold anything back.
  assert.equal(backupDue({ lastSuccessAt: at(4, 9, 5), lastFailureAt: at(4, 9), now: at(4, 18) }), true);
});

test('the time of day is a setting, and a bad one falls back to 18:00', () => {
  assert.equal(parseClock('06:30'), 390);
  assert.equal(parseClock('25:00'), 1080);
  assert.equal(parseClock('later'), 1080);
  assert.equal(backupDue({ lastSuccessAt: at(4, 1), now: at(4, 6, 30), at: '06:30' }), true);
});

test('old backups are deleted after 30 days, but the newest 7 are always kept', () => {
  const names = [];
  for (let day = 1; day <= 10; day += 1) names.push(backupFileName(new Date(2026, 8, day, 18)));
  names.push('keep-me.txt');
  // A month closed: every file is old, and the newest seven stay.
  const gone = filesToDelete(names, { now: at(30, 9), keepDays: 30, minKeep: 7 });
  assert.deepEqual(gone, names.slice(0, 3).reverse());
  // Recent ones are never deleted.
  assert.deepEqual(filesToDelete([backupFileName(at(1, 18))], { now: at(4, 9) }), []);
});

test('removed uploads are kept 30 days, by their dated folder', () => {
  assert.deepEqual(
    removedFoldersToDelete(['2026-09-01', '2026-11-01', 'notes'], { now: at(4, 9), keepDays: 30 }),
    ['2026-09-01'],
  );
});

test('an encrypted backup decrypts to the same bytes, and only with its passphrase', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enl-backup-'));
  try {
    const plain = path.join(dir, 'plain.dump');
    const sealed = path.join(dir, 'plain.dump.enc');
    const back = path.join(dir, 'back.dump');
    const content = Buffer.concat([Buffer.from('PGDMP'), require('crypto').randomBytes(200000)]);
    fs.writeFileSync(plain, content);

    await encryptFile(plain, sealed, 'correct horse battery staple');
    const stored = fs.readFileSync(sealed);
    assert.equal(stored.subarray(0, 8).toString(), 'ENLBAK01');
    assert.equal(stored.subarray(36, 41).equals(Buffer.from('PGDMP')), false, 'not stored in the clear');
    assert.equal(stored.length, content.length + 36 + 16);
    await decryptFile(sealed, back, 'correct horse battery staple');
    assert.ok(fs.readFileSync(back).equals(content));

    await assert.rejects(decryptFile(sealed, back, 'wrong'), /wrong passphrase/);
    assert.equal(fs.existsSync(back), false, 'a failed decrypt leaves no partial file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
