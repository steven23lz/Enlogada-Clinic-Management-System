/**
 * Quick-fill report templates, keyed by the department that would actually use them.
 *
 * They were once all shown to every console [UI/UX Phase 4] — Laboratory staff looking at an
 * X-Ray template. Keying them by category is what stops a technician pasting the wrong body of
 * boilerplate into a report and editing their way out of it.
 *
 * The text lives here rather than in a hook or a component because it is content, not behaviour:
 * a radiologist correcting the phrasing of a normal chest report should not have to read a state
 * machine to find it.
 */

const CBC_NORMAL = `COMPLETE BLOOD COUNT (CBC) RESULTS:
Hemoglobin: 14.5 g/dL (Normal: 13.0 - 17.5)
Hematocrit: 43.5 % (Normal: 40.0 - 52.0)
WBC Count: 6.8 x 10^9/L (Normal: 4.5 - 11.0)
Platelet Count: 280 x 10^9/L (Normal: 150 - 450)

IMPRESSION:
Normal Complete Blood Count parameters.`;

const XRAY_CHEST = `CHEST X-RAY (PA VIEW) FINDINGS:
- Lungs are clear with no active infiltrates, mass, or consolidation.
- Cardiac silhouette and mediastinal contours are within normal limits.
- Both costophrenic angles and hemidiaphragms are intact.
- Osseous structures are unremarkable.

IMPRESSION:
Normal Chest Radiograph.`;

const PELVIC_US = `PELVIC ULTRASOUND FINDINGS:
- Urinary bladder is well-distended with thin smooth walls.
- Uterus is normal in size and echotexture (5.2 x 4.1 x 3.8 cm).
- Both ovaries display normal sonographic morphology without cystic or solid masses.
- No free fluid noted in the cul-de-sac.

IMPRESSION:
Normal Pelvic Ultrasound Evaluation.`;

// Normalised to LF on the way out. These are multi-line template literals, so on a checkout with
// core.autocrlf=true they carry CRLF while the committed blob carries LF — meaning the same
// template inserts different bytes on Windows and Linux. That matters because the text lands in
// test_results.findings: a textarea normalises CRLF to LF when the result is reopened, so saving
// an already-released report produces a version that differs from its predecessor on every line,
// demands an amendment reason, and re-emails the patient about a correction whose only change is
// line endings.
const lf = (text) => text.replace(/\r\n/g, '\n');

/** The template body for a key, or '' if the key is unknown. */
export const TEMPLATE_TEXT = {
  cbc_normal: lf(CBC_NORMAL),
  xray_chest: lf(XRAY_CHEST),
  pelvic_us: lf(PELVIC_US),
};

/** Which templates each department is offered. */
export const TEMPLATES_BY_CATEGORY = {
  Laboratory: [{ key: 'cbc_normal', label: '+ Normal CBC Template' }],
  Xray: [{ key: 'xray_chest', label: '+ Normal Chest X-Ray' }],
  Ultrasound: [{ key: 'pelvic_us', label: '+ Normal Pelvic Ultrasound' }],
};
