/**
 * Deciding whether a fetched document can be shown in the page, and how.
 *
 * Two screens need this now — the diagnostic report viewer (`ResultDocument`) and the HMO card on
 * the Admin's claim review — and they must agree. A second copy of `canRenderPdfInline` would be a
 * copy of a subtle browser-capability rule, which is exactly the kind of thing that drifts and
 * then only misbehaves on the one browser nobody tests on.
 */

/** mime type -> how to render it. Anything absent gets a download link and an honest explanation. */
const PREVIEWABLE = {
  'application/pdf': 'pdf',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
};

/**
 * The render strategy for a blob's mime type, or `null` when there isn't one.
 *
 * Takes the raw `Blob.type`, which may carry parameters (`image/jpeg; charset=binary`), so it
 * trims to the essence before looking it up.
 */
export const previewKindFor = (mimeType = '') =>
  PREVIEWABLE[String(mimeType).split(';')[0].trim().toLowerCase()] || null;

/**
 * Whether this browser will actually draw a PDF in an iframe.
 *
 * An <iframe src=blob:…> pointed at a PDF does not fail when the browser has no viewer — it
 * renders an empty white box, with no event and no error. So the honest-looking result and the
 * broken one are pixel-identical, which is the silent failure this app keeps finding and removing.
 * Chromium in headless mode reports false here; so do some embedded webviews and locked-down
 * mobile browsers, which is the case that matters for a patient opening their result on a phone.
 *
 * Feature-detected rather than sniffed, and defaulted to `true` on the older browsers that do not
 * expose the flag at all: those overwhelmingly do have a viewer, and being wrong that way shows a
 * working preview where we predicted none, rather than hiding a working preview behind a warning.
 */
export const canRenderPdfInline = () =>
  typeof navigator === 'undefined' || navigator.pdfViewerEnabled === undefined
    ? true
    : navigator.pdfViewerEnabled;
