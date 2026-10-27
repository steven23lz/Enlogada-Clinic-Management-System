/**
 * Puts a file back behind every demo record whose file is gone from this checkout's uploads.
 *
 * Why this exists: a seed run uploads every report through the API, so the file lands in the
 * uploads folder of whichever backend answered — and two runs of seedDemoScenario.js were answered
 * by a backend that was not this checkout's. Their 448 result rows (and two bookings' doctor's
 * requests) point at files that were never written here, and every one of those reports opened on
 * "Report unavailable — the report file is missing from storage". The rows are right; only the
 * files are absent. Re-seeding to fix that is not an option: demo data is not disposable.
 *
 * What it puts back:
 *
 *   a result report     a copy of the image given with --image (or DEMO_REPORT_IMAGE), one copy per
 *                       row under a fresh generated name, exactly as an upload would be stored. The
 *                       row's file columns are updated to match; nothing else about the result —
 *                       findings, version, verification code, release dates — is touched.
 *
 *   a doctor's request  the seed's own page (demoDoctorRequestPdf.js), drawn again for that visit's
 *                       patient and test, written at the very name the row already holds.
 *
 * The image is never committed and never copied into the repo; uploads/ is git-ignored.
 *
 * Safe by default — reports what is missing and changes nothing:
 *   node src/scripts/repairMissingDemoFiles.js
 *
 * Put the files back:
 *   node src/scripts/repairMissingDemoFiles.js --confirm --image="C:\path\to\report.jpeg"
 *
 * Idempotent: a second run finds nothing missing. Refuses NODE_ENV=production — on a live clinic a
 * missing report is an incident to investigate, never a gap to paper over with a sample.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const { UPLOAD_ROOT, DOCTOR_REQUEST_UPLOAD_ROOT } = require('../config/upload');
const { doctorRequestPdf } = require('./demoDoctorRequestPdf');

// Recognised by their bytes, not their name: the same rule the upload path applies.
const IMAGE_TYPES = [
  { mime: 'image/jpeg', ext: '.jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47] },
];

const fileIsMissing = (root, name) => !fs.existsSync(path.join(root, path.basename(name)));

/**
 * The result rows and visits whose referenced file is not on disk. Read-only. The seed passes the
 * highest ids that existed before it ran, so it judges only what it created itself.
 */
async function findMissingDemoFiles({ afterResultId = 0, afterVisitId = 0 } = {}) {
  const results = (await db.query(`
    SELECT tr.id, tr.file_path, tc.name AS category, tr.is_current, tr.authorised_at IS NOT NULL AS authorised
      FROM test_results tr
      JOIN visit_tests vt ON vt.id = tr.visit_test_id
      JOIN tests t ON t.id = vt.test_id
      JOIN test_categories tc ON tc.id = t.category_id
     WHERE tr.file_path IS NOT NULL AND tr.id > $1
     ORDER BY tr.id
  `, [afterResultId])).rows.filter((r) => fileIsMissing(UPLOAD_ROOT, r.file_path));

  const requests = (await db.query(`
    SELECT pv.id, pv.doctor_request_file_path AS file_path, pv.doctor_request_uploaded_at AS uploaded_at,
           p.first_name, p.last_name,
           (SELECT t.name FROM visit_tests vt JOIN tests t ON t.id = vt.test_id
             WHERE vt.patient_visit_id = pv.id ORDER BY vt.id LIMIT 1) AS test_name
      FROM patient_visits pv
      JOIN patients p ON p.id = pv.patient_id
     WHERE pv.doctor_request_file_path IS NOT NULL AND pv.id > $1
     ORDER BY pv.id
  `, [afterVisitId])).rows.filter((r) => fileIsMissing(DOCTOR_REQUEST_UPLOAD_ROOT, r.file_path));

  return { results, requests };
}

function readImage(imagePath) {
  if (!imagePath) throw new Error('Name the report image: --image="C:\\path\\to\\report.jpeg" (or set DEMO_REPORT_IMAGE).');
  const buffer = fs.readFileSync(imagePath);
  const type = IMAGE_TYPES.find((t) => t.magic.every((b, i) => buffer[i] === b));
  if (!type) throw new Error(`${imagePath} is not a JPEG or PNG image.`);
  return { buffer, type };
}

const ymd = (d) => {
  const date = d ? new Date(d) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

async function restoreResults(rows, { buffer, type }) {
  let restored = 0;
  for (const row of rows) {
    const name = `${crypto.randomBytes(16).toString('hex')}${type.ext}`;
    const target = path.join(UPLOAD_ROOT, name);
    fs.writeFileSync(target, buffer, { flag: 'wx' });
    // Guarded on the old path: a row changed since it was read is left alone, and its copy removed.
    const res = await db.query(
      `UPDATE test_results
          SET file_path = $2, file_mime_type = $3, file_size_bytes = $4,
              file_original_name = regexp_replace(COALESCE(file_original_name, 'report'), '\\.[^.]*$', '') || $5
        WHERE id = $1 AND file_path = $6`,
      [row.id, name, type.mime, buffer.length, type.ext, row.file_path]
    );
    if (res.rowCount === 1) restored += 1;
    else fs.unlinkSync(target);
  }
  return restored;
}

async function restoreRequests(rows) {
  let restored = 0;
  for (const row of rows) {
    const name = path.basename(row.file_path);
    const pdf = doctorRequestPdf({
      patientName: `${row.first_name} ${row.last_name}`,
      testName: row.test_name || 'Laboratory examination',
      date: ymd(row.uploaded_at),
    });
    const target = path.join(DOCTOR_REQUEST_UPLOAD_ROOT, name);
    fs.writeFileSync(target, pdf, { flag: 'wx' });
    const res = await db.query(
      `UPDATE patient_visits SET doctor_request_mime_type = 'application/pdf', doctor_request_size_bytes = $2
        WHERE id = $1 AND doctor_request_file_path = $3`,
      [row.id, pdf.length, row.file_path]
    );
    if (res.rowCount === 1) restored += 1;
    else fs.unlinkSync(target);
  }
  return restored;
}

async function main() {
  const confirmed = process.argv.includes('--confirm');
  const imageArg = process.argv.find((a) => a.startsWith('--image='));
  const imagePath = imageArg ? imageArg.slice('--image='.length).replace(/^"|"$/g, '') : process.env.DEMO_REPORT_IMAGE;

  if (process.env.NODE_ENV === 'production') {
    logger.error('Refusing to run against NODE_ENV=production. A missing report there is an incident, not a demo gap.');
    process.exit(1);
  }

  const { results, requests } = await findMissingDemoFiles();
  const byCategory = results.reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] || 0) + 1 }), {});

  logger.info(confirmed ? 'Restoring missing demo files…' : 'DRY RUN — nothing will be written. Re-run with --confirm --image=<path> to apply.');
  logger.info(`  result reports missing   ${results.length}` +
    (results.length ? `  (${Object.entries(byCategory).map(([k, n]) => `${k} ${n}`).join(', ')}; ` +
      `${results.filter((r) => !r.is_current).length} superseded, ${results.filter((r) => !r.authorised).length} not yet released)` : ''));
  logger.info(`  doctor's requests missing ${requests.length}`);

  if (!confirmed || (results.length === 0 && requests.length === 0)) {
    if (results.length === 0 && requests.length === 0) logger.info('Nothing to restore.');
    process.exit(0);
  }

  const image = results.length ? readImage(imagePath) : null;
  const restoredResults = results.length ? await restoreResults(results, image) : 0;
  const restoredRequests = await restoreRequests(requests);

  logger.info(`Restored ${restoredResults} result report(s) and ${restoredRequests} doctor's request(s).`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(`Repair failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { findMissingDemoFiles };
