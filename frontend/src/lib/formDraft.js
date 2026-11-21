/**
 * A form that survives the page being reloaded under it. [1.173.0]
 *
 * Choosing a photo on a phone sends the browser to the background, and Android may discard a page
 * it is not showing when memory is short (opening the camera is the usual reason). The page then
 * reloads when the patient comes back, and a booking half filled in, or a payment proof just
 * chosen, was gone: "I will be back to uploading again". What the patient entered is kept here as
 * they enter it, and read back when the form opens.
 *
 * sessionStorage, not localStorage: it belongs to this tab, survives a reload or a discard of that
 * tab, and is gone when the tab is closed. Sign-out clears it too (`clearAllDrafts`), since a
 * doctor's request or an ID photo must not wait for the next person at a shared computer. Every
 * read and write is guarded: storage can be full, blocked or absent, and the form must work
 * without it.
 */

const PREFIX = 'enlogada:draft:';

/** Drafts read by a component other than the form that writes them. */
export const DRAFT_KEYS = Object.freeze({ emailChange: 'email-change', acceptRecord: 'accept-record' });

/** A form waiting on an emailed code is kept for as long as a code lasts. */
const CODE_LIFETIME_MS = 30 * 60 * 1000;

/** The draft under `key` if it holds a ticket and is younger than a code lasts, else null. */
export function readCodeDraft(key) {
  const saved = readDraft(key);
  return saved?.ticket && Date.now() - (saved.savedAt || 0) < CODE_LIFETIME_MS ? saved : null;
}

export function readDraft(key) {
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Saves the draft; if it is too large with its photos, saves what was typed without them. */
export function writeDraft(key, value) {
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    try {
      window.sessionStorage.setItem(PREFIX + key, JSON.stringify({ ...value, files: {} }));
    } catch {
      /* storage unavailable: the form still works, it just does not survive a reload */
    }
    return false;
  }
}

export function clearDraft(key) {
  try {
    window.sessionStorage.removeItem(PREFIX + key);
  } catch {
    /* nothing to clear */
  }
}

export function clearAllDrafts() {
  try {
    Object.keys(window.sessionStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    /* nothing to clear */
  }
}

const stored = new WeakMap();

/** A File as something JSON can hold. The same File is encoded once. */
export function fileToStored(file) {
  if (!file) return Promise.resolve(null);
  if (stored.has(file)) return Promise.resolve(stored.get(file));
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = { name: file.name, type: file.type, data: String(reader.result) };
      stored.set(file, value);
      resolve(value);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/** The File back from what `fileToStored` made, or null if it cannot be read. */
export function storedToFile(value) {
  if (!value?.data) return null;
  try {
    const [, base64 = ''] = value.data.split(',');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const file = new File([bytes], value.name || 'file', { type: value.type || 'application/octet-stream' });
    stored.set(file, value);
    return file;
  } catch {
    return null;
  }
}
