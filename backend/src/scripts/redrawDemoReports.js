/**
 * Draws every demo result's report again on the clinic's form, as demoReportPdf.js now lays it out.
 * [1.141.0]
 *
 * Why this exists: the seed attaches a report when it records a result, so a change to the form
 * reaches only results seeded after it. The demo database already holds hundreds, some on the old
 * layout and 448 carrying one sample image each (repairMissingDemoFiles.js) — the same CBC page on
 * an ultrasound as on a urinalysis. This redraws each from its own record: the patient's name,
 * birthday and sex, the visit's date, patient type and referring physician, the service's form, and
 * for imaging the written report stored as its findings.
 *
 * Laboratory values are not stored ([1.109.0]: they live in the report file). So:
 *
 *   --values=<json>   label -> value pairs read back out of the old files, by result id (or by
 *                     the file name they were read from). A report with an entry keeps exactly the
 *                     numbers it showed, abnormal ones included — on every later run too, since a
 *                     result id survives the redraw and a file name does not.
 *   otherwise         the seed's normal values for that form, varied per result; where the stored
 *                     summary names an abnormal value (the seed's three such cases), it is written.
 *
 * The row's file columns change and nothing else: findings, version, verification code, release
 * dates are untouched. The file it replaced is deleted once the row points at the new one.
 *
 *   node src/scripts/redrawDemoReports.js                      # dry run: what would be redrawn
 *   node src/scripts/redrawDemoReports.js --confirm [--values=path.json]
 *
 * Refuses NODE_ENV=production: a real patient's report is the document the clinic signed, never a
 * thing to regenerate.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const logger = require('../config/logger');
const { UPLOAD_ROOT } = require('../config/upload');
const { renderClinicReport } = require('./demoReportPdf');
const {
  labFormFor, labReportRows, signatoriesFor, splitImpression, FORM_PATIENT_TYPE, ULTRASOUND_REPORT,
} = require('./seedDemoScenario');

// The seed's abnormal laboratory results whose value its stored summary names (seedDemoScenario.js).
const SUMMARY_VALUES = [
  [/^Elevated total cholesterol/i, { cholesterol: 286 }],
  [/^Total cholesterol within the desirable level/i, { cholesterol: 186 }],
  [/^Markedly elevated fasting blood sugar/i, { fbs: 452 }],
];

/** The overrides for a lab form: the old file's own values where known, else the summary's. */
function labValues(form, row, known) {
  if (known) {
    const byLabel = new Map(form.fields.map((f) => [f.label, f.code]));
    return Object.fromEntries(Object.entries(known).filter(([label]) => byLabel.has(label)).map(([label, v]) => [byLabel.get(label), v]));
  }
  const hit = SUMMARY_VALUES.find(([re]) => re.test(row.findings || ''));
  return hit ? hit[1] : {};
}

function reportFor(row, known) {
  const imaging = row.category === 'Ultrasound' || row.category === 'Xray';
  const form = row.category === 'Laboratory' ? labFormFor(row.test_name) : null;
  const [body, impression] = imaging ? splitImpression(row.findings || '') : ['', ''];
  return {
    patient: { name: `${row.last_name}, ${row.first_name}`, birthdate: row.birthdate, sex: row.sex },
    date: row.visit_date,
    patientType: FORM_PATIENT_TYPE[row.patient_type] || 'WALK-IN',
    physician: row.referring_physician || '',
    lab: form
      ? { discipline: form.discipline, title: form.name, rows: labReportRows(form, row.sex, row.visit_test_id * 7 + (row.visit_id % 97), labValues(form, row, known)) }
      : null,
    narrative: imaging
      ? {
        title: row.category === 'Xray' ? 'RADIOGRAPHIC REPORT' : 'ULTRASOUND REPORT',
        exam: row.category === 'Ultrasound' ? `${ULTRASOUND_REPORT[row.test_name] || row.test_name} ultrasound` : row.test_name,
        body, impression,
      }
      : null,
    comment: imaging ? (row.remarks || '') : (row.findings || row.remarks || ''),
    signatories: signatoriesFor(row.category),
  };
}

async function main() {
  const confirmed = process.argv.includes('--confirm');
  const valuesArg = process.argv.find((a) => a.startsWith('--values='));
  const known = valuesArg ? JSON.parse(fs.readFileSync(valuesArg.slice('--values='.length).replace(/^"|"$/g, ''), 'utf8')) : {};

  if (process.env.NODE_ENV === 'production') {
    logger.error("Refusing to run against NODE_ENV=production. A real report is the clinic's signed document.");
    process.exit(1);
  }

  const rows = (await db.query(`
    SELECT tr.id, tr.visit_test_id, tr.file_path, tr.findings, tr.remarks,
           t.name AS test_name, tc.name AS category,
           pv.id AS visit_id, pv.created_at AS visit_date, pv.referring_physician,
           p.first_name, p.last_name, p.birthdate, p.sex, pt.name AS patient_type
      FROM test_results tr
      JOIN visit_tests vt ON vt.id = tr.visit_test_id
      JOIN tests t ON t.id = vt.test_id
      JOIN test_categories tc ON tc.id = t.category_id
      JOIN patient_visits pv ON pv.id = vt.patient_visit_id
      JOIN patients p ON p.id = pv.patient_id
      JOIN patient_types pt ON pt.id = p.patient_type_id
     WHERE tr.file_path IS NOT NULL
     ORDER BY tr.id
  `)).rows;

  const knownFor = (r) => known[r.id] || known[path.basename(r.file_path)];
  const kept = rows.filter(knownFor).length;
  const formless = rows.filter((r) => r.category === 'Laboratory' && !labFormFor(r.test_name));
  logger.info(confirmed ? 'Redrawing demo reports…' : 'DRY RUN — nothing will be written. Re-run with --confirm to apply.');
  logger.info(`  reports to redraw            ${rows.length}`);
  logger.info(`  keeping their old lab values ${kept}`);
  if (formless.length) logger.warn(`  laboratory services with no form (comment only): ${[...new Set(formless.map((r) => r.test_name))].join(', ')}`);
  if (!confirmed) process.exit(0);

  let redrawn = 0;
  for (const row of rows) {
    const pdf = await renderClinicReport(reportFor(row, knownFor(row)));
    const name = `${crypto.randomBytes(16).toString('hex')}.pdf`;
    const target = path.join(UPLOAD_ROOT, name);
    fs.writeFileSync(target, pdf, { flag: 'wx' });
    // Guarded on the old path: a row changed since it was read is left alone, and its new file removed.
    const res = await db.query(
      `UPDATE test_results
          SET file_path = $2, file_mime_type = 'application/pdf', file_size_bytes = $3,
              file_original_name = regexp_replace(COALESCE(file_original_name, 'report'), '\\.[^.]*$', '') || '.pdf'
        WHERE id = $1 AND file_path = $4`,
      [row.id, name, pdf.length, row.file_path]
    );
    if (res.rowCount !== 1) {
      fs.unlinkSync(target);
      continue;
    }
    redrawn += 1;
    const old = path.join(UPLOAD_ROOT, path.basename(row.file_path));
    const stillUsed = (await db.query('SELECT 1 FROM test_results WHERE file_path = $1 LIMIT 1', [row.file_path])).rowCount > 0;
    if (!stillUsed && fs.existsSync(old)) fs.unlinkSync(old);
  }

  logger.info(`Redrew ${redrawn} of ${rows.length} report(s).`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(`Redraw failed: ${err.message}`);
    process.exit(1);
  });
}
