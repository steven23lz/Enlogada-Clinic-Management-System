import { useState, useEffect, useCallback } from 'react';
import api from '../config/api';
import { prepareCardImage, DOCUMENT_MAX_EDGE } from '../lib/cardImage';
import { readDraft, writeDraft, clearDraft, fileToStored, storedToFile } from '../lib/formDraft';
import { toastSuccess } from '../lib/toast';

const SHRINK_ABOVE_BYTES = 2 * 1024 * 1024;
const PDF_LIMIT_BYTES = 8 * 1024 * 1024;

/**
 * A patient settling a booking by paying into the clinic's own account. [1.48.0]
 *
 * They pay from their own GCash or banking app, then upload the confirmation screenshot with its
 * reference number. A cashier looks at it and approves, and only then is the booking pass issued.
 *
 * ── The state that matters ──────────────────────────────────────────────────────────────────
 *
 * A booking is in exactly one of four situations, and the patient must be able to tell which:
 *
 *   nothing submitted   -> show the accounts and the upload form
 *   awaiting review     -> say so, and do NOT offer a second upload
 *   rejected            -> say why, and offer the form again
 *   verified            -> the pass appears; nothing to do
 *
 * The middle two are the ones a naive implementation loses. A patient who has uploaded and hears
 * nothing assumes it failed and pays twice; a patient whose proof was rejected without a reason
 * rings the clinic, and whoever answers cannot help them.
 */
export function usePaymentSubmission(visitId, { onSettled, onRefused } = {}) {
  const [methods, setMethods] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  // [1.173.0] What the patient entered survives the page reloading under them (lib/formDraft.js):
  // choosing the screenshot sends a phone's browser to the background, where Android may discard it.
  const draftKey = `pay:${visitId}`;
  const [draft] = useState(() => readDraft(draftKey));
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState(() => draft?.reference || '');
  // "These are the tests I want", ticked before the account is shown. [1.122.0]
  const [confirmed, setConfirmed] = useState(() => Boolean(draft?.confirmed));
  // No amount. [1.105.0] The booking states what is owed, and a box the patient could edit invited
  // them to send something else. The server records the amount due when none is sent.
  const [proof, setProof] = useState(() => storedToFile(draft?.files?.proof));
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // [1.62.0] What the OCR pass made of the screenshot. `null` until one has run.
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);

  const reload = useCallback(async () => {
    if (!visitId) return;
    setLoading(true);
    // Allowed to fail independently: a patient who cannot see the account list can still be shown
    // what they have already submitted, and vice versa.
    const [m, s] = await Promise.allSettled([
      api.get('/payment-methods'),
      api.get(`/payment-submissions/visit/${visitId}`),
    ]);
    if (m.status === 'fulfilled') setMethods(m.value.data.data.methods || []);
    if (s.status === 'fulfilled') setSubmissions(s.value.data.data.submissions || []);
    setLoading(false);
  }, [visitId]);

  useEffect(() => { reload(); }, [reload]);

  // Newest first from the API, so the head is the current state of play.
  const latest = submissions[0] || null;
  const pending = latest?.status === 'Pending' ? latest : null;
  const rejected = latest?.status === 'Rejected' ? latest : null;
  const verified = submissions.some((s) => s.status === 'Verified');

  /**
   * Picking a file runs the OCR pass and offers what it read. [1.62.0]
   *
   * ── It only fills a field the patient has left EMPTY ────────────────────────────────────────
   *
   * The rule that keeps this an assistant rather than an authority. Somebody who has already
   * typed their reference number has told us what it is, and a machine reading of a phone
   * screenshot is not better evidence than the person holding the phone. Overwriting them would
   * also be maddening: type the reference, attach the image, watch your own typing get replaced.
   *
   * A blank field, by contrast, costs nothing to fill and saves transcribing thirteen digits —
   * which is the actual error this addresses. A transposed digit produces a reference the clinic
   * can never reconcile against the transfer it names.
   *
   * Everything here is best-effort. A scan that fails, times out, or reads nothing leaves the
   * form exactly as it was, with no error shown: the patient never asked for this, so it cannot
   * fail in front of them. `setError` is deliberately untouched on the failure path.
   */
  const scanProof = useCallback(async (file) => {
    setScan(null);
    if (!file) return;
    // Tesseract reads raster images; a PDF receipt is legitimate but unscannable, and saying
    // nothing is better than reporting it as unreadable.
    if (!String(file.type || '').startsWith('image/')) return;

    setScanning(true);
    try {
      const fd = new FormData();
      fd.append('proof', file);
      const res = await api.post('/payments/scan-receipt', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = res.data?.data?.scan;
      if (!result) return;
      setScan(result);

      // A functional update: the scan resolves a second or two after the file was picked, and the
      // patient may well have been typing in the meantime. Reading the value from the setter
      // rather than from the closure is what makes "only fill what is empty" true at the moment
      // of writing rather than at the moment the request was sent.
      //
      // The amount it read fills nothing. [1.105.0] There is no amount field; the panel compares
      // it with what is due and warns when they differ.
      if (result.reference_number) {
        setReference((current) => (current.trim() ? current : result.reference_number));
      }
    } catch {
      // Silent by design — see above.
    } finally {
      setScanning(false);
    }
  }, []);

  /**
   * Replaces `setProof` at the call site, so choosing a file always triggers a scan.
   *
   * [1.173.0] A photo over 2 MB is made smaller first, as the booking dialog's photos are: a phone
   * camera's 8-12 MB went past the 8 MB limit and was slow on mobile data. A screenshot is far under
   * it and is sent as it is, so the reference number stays as sharp as GCash drew it.
   */
  const chooseProof = useCallback(async (file) => {
    // A PDF cannot be made smaller here, so one over the server's 8 MB is said at once, not after a
    // whole upload on mobile data.
    if (file && file.type === 'application/pdf' && file.size > PDF_LIMIT_BYTES) {
      setProof(null);
      setScan(null);
      setError('That PDF is larger than 8 MB. Attach a screenshot of the payment instead.');
      return;
    }
    let chosen = file;
    if (file && String(file.type || '').startsWith('image/') && file.size > SHRINK_ABOVE_BYTES) {
      try {
        chosen = await prepareCardImage(file, { name: 'payment-proof.jpg', maxEdge: DOCUMENT_MAX_EDGE });
      } catch (err) {
        setProof(null);
        setScan(null);
        setError(err.message);
        return;
      }
    }
    setError('');
    setProof(chosen);
    scanProof(chosen);
  }, [scanProof]);

  // A restored screenshot is read again, so its amount check shows as it did.
  const restoredProof = useState(proof)[0];
  useEffect(() => { if (restoredProof) scanProof(restoredProof); }, [restoredProof, scanProof]);

  useEffect(() => {
    if (!visitId) return undefined;
    let current = true;
    const timer = setTimeout(async () => {
      const stored = await fileToStored(proof);
      if (current) writeDraft(draftKey, { reference, confirmed, files: { proof: stored } });
    }, 300);
    return () => { current = false; clearTimeout(timer); };
  }, [visitId, draftKey, reference, confirmed, proof]);

  const submit = async (e) => {
    e?.preventDefault();
    if (submitting) return;
    setError('');

    if (!reference.trim()) {
      setError('Enter the reference number from your payment confirmation.');
      return;
    }
    if (!proof) {
      setError('Attach a screenshot or photo of the transaction.');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('patientVisitId', String(visitId));
      // [1.151.0] The account on screen, even if the patient never tapped it. The panel shows the
      // first one until they do, and this sent nothing then, so approving the proof filed a transfer
      // into a bank account under GCash in the cash book.
      const chosen = methodId || methods[0]?.id;
      if (chosen) fd.append('paymentMethodId', String(chosen));
      fd.append('referenceNumber', reference.trim());
      fd.append('proof', proof);

      await api.post('/payment-submissions', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setReference('');
      setProof(null);
      setScan(null);
      clearDraft(draftKey);
      await reload();
      toastSuccess('Payment sent for verification. Your pass appears once the cashier confirms it.');
      onSettled?.();
    } catch (err) {
      // [1.171.0] No reply at all: the connection dropped, before or after the clinic received it.
      // Asked rather than guessed. If it arrived, the panel turns to "Payment sent for checking" on
      // its own after the re-read; if not, the patient is told plainly, and what they typed stays.
      if (!err.response) {
        const landed = await api.get(`/payment-submissions/visit/${visitId}`)
          .then((res) => (res.data?.data?.submissions || []).some((x) => x.status === 'Pending' && x.reference_number === reference.trim()))
          .catch(() => false);
        if (landed) {
          setReference('');
          setProof(null);
          setScan(null);
          clearDraft(draftKey);
          await reload();
          toastSuccess('Your payment reached the clinic before the connection dropped. Your pass appears once the cashier confirms it.');
          onSettled?.();
          return;
        }
        setError("We couldn't reach the clinic, so your payment details were not sent. Check your connection and press Send for verification again. What you entered is kept.");
        return;
      }
      setError(err.response?.data?.message || 'The payment could not be submitted. Please try again.');
      // A 409 means the server knows something this mount does not: the visit is already paid, or a
      // claim is already awaiting review. Reachable now that payment lives in two places — the
      // booking dialog and the Appointments tab hold independent state, so submitting from one
      // leaves the other stale and still showing the form. Re-reading flips `pending`/`verified`
      // and the panel's early return lands on the right end state by itself, instead of stranding
      // the patient on a form with an error under it.
      //
      // Only on 409. `reload()` sets `loading`, which flashes the skeleton — worth it when the
      // answer actually changes, wasteful for a 400 like a missing reference number, where the
      // patient should stay on the form with what they typed still in it.
      if (err.response?.status === 409) {
        await reload();
        onRefused?.();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    methods, submissions, loading, reload, confirmed, setConfirmed,
    methodId, setMethodId, reference, setReference, proof, setProof,
    error, submitting, submit,
    latest, pending, rejected, verified,
    // [1.62.0] `chooseProof` is what the file input should call — `setProof` is still exported
    // for the Remove button, which must clear the file WITHOUT starting a scan of nothing.
    chooseProof, scan, scanning,
  };
}
