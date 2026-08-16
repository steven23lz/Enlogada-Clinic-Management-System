/**
 * The clinic's own identity, in one place.
 *
 * These strings were previously only in PublicFooter.jsx, as markup. That was fine while a footer
 * was the only thing that needed them — it stopped being fine the moment a printed receipt did,
 * because a receipt with a different address from the website is a document nobody can rely on.
 *
 * ── The blank fields are deliberate ───────────────────────────────────────────────────────────
 * `tin`, `businessPermit` and `accreditation` are read from the environment and render only when
 * set. They are NOT given plausible defaults, and that is the whole point: a BIR-compliant
 * official receipt must carry the issuer's real TIN, and a made-up one on a document a patient
 * files for reimbursement is worse than no number at all — it is a false record. So the receipt
 * prints without them and says so, until someone who knows the real values sets them.
 *
 *   VITE_CLINIC_TIN=000-000-000-000
 *   VITE_CLINIC_PERMIT=...
 *   VITE_CLINIC_ACCREDITATION=...
 *
 * Vite inlines import.meta.env at BUILD time, so these must be set before `npm run build` —
 * setting them on the server afterwards has no effect. Same constraint as VITE_API_BASE_URL;
 * see the env note in CLAUDE.md.
 */
const env = import.meta.env || {};

export const CLINIC = {
  name: 'Enlogada Ultrasound & Diagnostic Clinic',
  shortName: 'ENLOGADA',
  address: 'Bugo, Cagayan de Oro, Philippines 9000',
  phone: '0936 132 0650',
  email: 'enlogadaclinic2011@gmail.com',

  // Statutory identifiers. Absent unless configured — see the note above.
  tin: env.VITE_CLINIC_TIN || '',
  businessPermit: env.VITE_CLINIC_PERMIT || '',
  accreditation: env.VITE_CLINIC_ACCREDITATION || '',
};

/** Whether enough statutory detail is present for this to read as an official receipt. */
export const hasStatutoryIdentity = () => Boolean(CLINIC.tin);
