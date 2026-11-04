/**
 * Does a file's first bytes match the type it claims? [1.151.0]
 *
 * A browser's label is only a claim, and these uploads are evidence somebody must read: a proof of
 * payment, an HMO card, a doctor's request, a photo of an ID. A zero-byte file or a renamed text
 * file passed as "image/png", reached the cashier as a broken picture, and in the meantime kept the
 * patient's slot with no time limit, because a proof sent in time keeps the slot while it is checked.
 *
 * Pure, so it is tested without a disk. `head` is the file's first bytes; 1024 is enough for all four.
 */
const PDF_MARK = Buffer.from('%PDF-');
const PNG_MARK = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const SIGNATURES = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length >= PNG_MARK.length && b.subarray(0, PNG_MARK.length).equals(PNG_MARK),
  'image/webp': (b) => b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  // Anywhere in the first kilobyte, as reportFileTypes reads a PDF: some scanners write a preamble.
  'application/pdf': (b) => b.subarray(0, 1024).includes(PDF_MARK),
};

/** How much of a file `matchesSignature` needs to see. */
const SIGNATURE_BYTES = 1024;

/**
 * @param {string} mimetype  what the upload says it is
 * @param {Buffer} head      its first bytes
 * @returns {boolean} false for an empty file, a mismatch, or a type this does not know
 */
function matchesSignature(mimetype, head) {
  const check = SIGNATURES[mimetype];
  return Boolean(check && head && head.length > 0 && check(head));
}

module.exports = { matchesSignature, SIGNATURE_BYTES };
