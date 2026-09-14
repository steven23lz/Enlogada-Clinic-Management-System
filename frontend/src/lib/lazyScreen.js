import { lazy } from 'react';

/**
 * A screen whose code is fetched the first time someone opens it. [1.87.0] See App.jsx.
 *
 * One failure is handled here rather than left to the ErrorBoundary: a tab kept open across a new
 * deploy asks for a file the deploy replaced. Reloading fetches the new build, so the first
 * failure reloads the page, once. If the file is still missing straight after that reload, the
 * error goes to the ErrorBoundary, which says so and offers its own Reload, rather than this
 * reloading forever. With nowhere to remember that it already reloaded (storage blocked), it
 * never reloads at all.
 */
const RELOADED = 'enlogada.screenReloaded';

/** The rule, with its storage and reload handed in, so a unit test can hold it. */
export function loadOnce(load, { storage, reload }) {
  return load().then(
    (module) => {
      storage.remove(RELOADED);
      return module;
    },
    (error) => {
      if (storage.get(RELOADED) || !storage.set(RELOADED)) throw error;
      reload();
      // The page is going away; settling now would only flash the error first.
      return new Promise(() => {});
    }
  );
}

const sessionFlag = {
  get: (key) => {
    try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
  },
  set: (key) => {
    try { sessionStorage.setItem(key, '1'); return true; } catch { return false; }
  },
  remove: (key) => {
    try { sessionStorage.removeItem(key); } catch { /* nothing to clear */ }
  },
};

export const lazyScreen = (load) =>
  lazy(() => loadOnce(load, { storage: sessionFlag, reload: () => window.location.reload() }));
