import { useEffect, useRef } from 'react';

/**
 * The browser's Back button, without a router. [1.152.0]
 *
 * This app keeps its screen in React state, so the browser had one history entry for the whole of a
 * session. Back on a phone, the gesture people use without thinking, left the site from anywhere and
 * took a half-filled booking with it. Now each screen is an entry, and so is each open dialog: Back
 * closes the dialog, then returns to the screen before. No address changes, so the deep links
 * (`?receipt=`, `?verify=`, `?display=`) work as they did. A screen is saved in `history.state`, which
 * also survives a reload, so reloading stays where you are; the state names a screen and nothing else.
 *
 * ── One at a time ───────────────────────────────────────────────────────────────────────────
 *
 * A dialog closed by its own button has to remove the entry it added, and `history.back()` finishes
 * later. Closing one dialog and opening another, or closing one and moving to another screen, pushes
 * while that is still under way, and the browser then lands somewhere neither meant. So every change
 * goes through one queue, and a step back holds the queue until its popstate arrives.
 */

const ops = [];
const openDialogs = []; // innermost last
let steppingBack = false;
let stepTimer = null;
let screenListener = null;

function runOps() {
  while (!steppingBack && ops.length) ops.shift()();
}

function stepBackDone() {
  steppingBack = false;
  clearTimeout(stepTimer);
  runOps();
}

function stepBack() {
  ops.push(() => {
    steppingBack = true;
    // A popstate that never comes must not stop every later change.
    stepTimer = setTimeout(stepBackDone, 600);
    window.history.back();
  });
  runOps();
}

function pushEntry(state) {
  window.history.pushState(state, '', window.location.href);
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    // Our own step back, removing a closed dialog's entry: nothing for anyone to do.
    if (steppingBack) {
      stepBackDone();
      return;
    }
    const dialog = openDialogs.pop();
    if (dialog) {
      dialog.popped = true;
      dialog.close();
      return;
    }
    screenListener?.(event.state?.screen ?? null);
  });
}

const sameScreen = (a, b) => a.tab === b.tab && a.portalTab === b.portalTab && a.nav === b.nav && a.verify === b.verify;

/** The screen this history entry holds: Back returned to it, or the page was reloaded on it. */
export function savedScreen() {
  return typeof window === 'undefined' ? null : window.history.state?.screen ?? null;
}

/**
 * The app is now showing this screen. A new entry when it moved. Replaces instead when there is
 * nothing to go back to: the first screen of a page load, or a staff landing being settled.
 *
 * @param {{tab: string, portalTab: string, nav: string|null, verify: boolean}} screen
 */
export function recordScreen(screen) {
  ops.push(() => {
    const current = savedScreen();
    if (current && sameScreen(current, screen)) return;
    const settling = current && current.nav === null && screen.nav !== null
      && current.tab === screen.tab && current.portalTab === screen.portalTab;
    if (!current || settling) {
      window.history.replaceState({ ...window.history.state, screen }, '', window.location.href);
    } else {
      pushEntry({ screen });
    }
  });
  runOps();
}

/** Called with the screen Back or Forward landed on, once no dialog is left to close. */
export function onScreenChange(listener) {
  screenListener = listener;
  return () => { screenListener = null; };
}

/**
 * While `open`, the browser's Back closes this dialog, innermost first. `close` is whatever the
 * dialog's own Close button does, so what is kept and what is cleared stays that dialog's decision.
 *
 * @param {boolean} open
 * @param {() => void} close
 */
export function useBackCloses(open, close) {
  const latestClose = useRef(close);
  useEffect(() => { latestClose.current = close; });

  useEffect(() => {
    if (!open) return undefined;
    const entry = { popped: false, close: () => latestClose.current() };
    openDialogs.push(entry);
    ops.push(() => pushEntry({ ...window.history.state, dialog: true }));
    runOps();
    return () => {
      // Closed by Back: the browser has already left its entry.
      if (entry.popped) return;
      const at = openDialogs.indexOf(entry);
      if (at >= 0) openDialogs.splice(at, 1);
      stepBack();
    };
  }, [open]);
}
