import api from '../config/api';
import { toastError } from './toast';

// Opening a diagnostic report from the patient's own screen.
//
// Lifted out of ClientDashboard.jsx unchanged, which had grown to 1,878 lines against a
// documented 300-500 rule. Both are pure helpers with no component state, and the safe-URL check
// in particular is the kind of thing that gets quietly reimplemented on the next screen that
// needs it — it exists for a reason worth keeping in one place.

// test_results.file_url is staff-entered free text with no format validation anywhere in the
// upload pipeline (see backend/src/controllers/resultController.js uploadResult). Rendered
// directly as an <a href>, an unvalidated value (e.g. a "javascript:" URI) would execute in the
// client's session — only allow schemes/paths that can never execute script.
const isSafeResultUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Phase B: a real uploaded file is served through an authenticated route, not a public URL — a
// bare <a href> can't carry the Authorization header, so this fetches the file as a blob (the
// `api` instance's request interceptor attaches the JWT) and opens it via a local object URL.
const downloadResultFile = async (visitTestId, originalName) => {
  try {
    const res = await api.get(`/results/${visitTestId}/file`, { responseType: 'blob' });
    const objectUrl = window.URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = originalName || 'result';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('Failed to download result file:', err);
    toastError('Failed to download the attachment. Please try again.');
  }
};

export { isSafeResultUrl, downloadResultFile };
