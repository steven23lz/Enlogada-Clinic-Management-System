import { useSyncExternalStore } from 'react';

/**
 * The clinic's own identity, in one place.
 *
 * These strings were previously only in PublicFooter.jsx, as markup. That was fine while a footer
 * was the only thing that needed them — it stopped being fine the moment a printed receipt did,
 * because a receipt with a different address from the website is a document nobody can rely on.
 *
 * ── Why this is fetched rather than compiled in ───────────────────────────────────────────────
 * It used to read `VITE_CLINIC_TIN` and friends from `import.meta.env`, which Vite inlines at
 * BUILD time. Setting the clinic's TIN therefore meant editing `frontend/.env` and running
 * `npm run build` — an operation a clinic administrator will never perform, which is exactly why
 * the field was still empty and the receipt still printing "not a BIR-registered Official
 * Receipt" long after the feature existed. A correct mechanism nobody can operate is not a
 * working mechanism.
 *
 * `GET /api/clinic` reads the same values from the backend's environment, so setting them is a
 * `backend/.env` edit and a restart — the same operation as changing the SMTP password.
 *
 * The build-time values below are kept as the fallback, so a frontend that cannot reach the API
 * (the login page on a cold start, a network blip) still renders the clinic's name and address
 * rather than blanks.
 *
 * ── The statutory fields stay blank unless configured ─────────────────────────────────────────
 * `tin`, `businessPermit` and `accreditation` are NOT given plausible defaults, and that is the
 * whole point: a BIR-compliant official receipt must carry the issuer's real TIN, and a made-up
 * one on a document a patient files for reimbursement is worse than no number at all — it is a
 * false record. The receipt prints without them and says so, until someone who knows the real
 * values sets them.
 */
const env = import.meta.env || {};

/** What ships in the bundle. Contact details are real; statutory identifiers are deliberately blank. */
export const CLINIC_DEFAULTS = Object.freeze({
  name: 'Enlogada Ultrasound & Diagnostic Clinic',
  shortName: 'ENLOGADA',
  address: 'Bugo, Cagayan de Oro, Philippines 9000',
  phone: '0936 132 0650',
  email: 'enlogadaclinic2011@gmail.com',

  // Still honoured if someone does set them at build time, so nothing that worked before breaks.
  tin: env.VITE_CLINIC_TIN || '',
  businessPermit: env.VITE_CLINIC_PERMIT || '',
  accreditation: env.VITE_CLINIC_ACCREDITATION || '',
});

let current = CLINIC_DEFAULTS;
const listeners = new Set();

const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const getSnapshot = () => current;

/**
 * Merges whatever the server supplies over the defaults.
 *
 * Only non-empty values win. The endpoint returns every field, blank when unset, so this is a
 * plain overwrite-if-present rather than a distinction between absent and empty — which means an
 * operator who sets only CLINIC_TIN keeps the built-in name and address instead of blanking them.
 */
export function applyClinicIdentity(fromServer) {
  if (!fromServer) return;
  const merged = { ...CLINIC_DEFAULTS };
  for (const [key, value] of Object.entries(fromServer)) {
    if (typeof value === 'string' && value.trim()) merged[key] = value.trim();
  }
  current = Object.freeze(merged);
  notify();
}

/**
 * The clinic identity, re-rendering when the fetched values arrive.
 *
 * useSyncExternalStore rather than a context provider: two components need this and neither is
 * near a natural provider boundary, so a provider would exist only to thread one object down.
 */
export const useClinic = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

/** The current values, for code outside React (printing, PDF generation). */
export const getClinic = () => current;

/**
 * Whether enough statutory detail is present for this to read as an official receipt.
 *
 * Takes the identity rather than reading module state, so a component that got its copy from
 * useClinic cannot ask this question about a different snapshot than the one it is rendering.
 */
export const hasStatutoryIdentity = (clinic = current) => Boolean(clinic?.tin);

/**
 * Backwards-compatible named export.
 *
 * Deliberately the DEFAULTS, not a live snapshot: a module-level import is captured once, so a
 * mutable object here would hand callers stale values with no indication. Anything that needs the
 * configured identity uses useClinic() (React) or getClinic() (everything else).
 */
export const CLINIC = CLINIC_DEFAULTS;
