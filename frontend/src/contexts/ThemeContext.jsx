import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Light, dark, or whatever the device says. [1.39.0]
 *
 * Three values rather than a two-way switch, because "System" is the only one that keeps meaning
 * anything after somebody has touched the control once. A reception terminal set to dim in the
 * evening should follow that, and a plain on/off toggle silently opts out of it forever the first
 * time it is pressed.
 *
 * ── The attribute is already set before React runs ──────────────────────────────────────────
 *
 * index.html carries a small blocking script that reads this same key and stamps
 * `data-theme` on <html> during parse. That is not an optimisation: main.jsx fetches the clinic
 * identity and AuthContext resolves the session before anything renders, so a dark-mode user
 * would otherwise get a full-screen white flash for the length of an auth round trip — a third of
 * a second of white at 6am, every load.
 *
 * So this provider READS what the script already decided and never re-derives it on mount.
 * Re-deriving would reintroduce the flash it exists to prevent.
 *
 * ── Storage ────────────────────────────────────────────────────────────────────────────────
 *
 * Namespaced like the only other UI preference in the app (`enlogada.nav.collapsedGroups`), and
 * wrapped in try/catch for the same stated reason: a corrupt or unavailable localStorage must not
 * take the shell down with it. A browser with storage blocked gets a working app that simply
 * forgets the choice between loads.
 */

const STORAGE_KEY = 'enlogada.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** What the user asked for: 'light' | 'dark' | 'system'. Distinct from what is on screen. */
const readPreference = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    return 'system';
  }
};

const systemPrefersDark = () => {
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
};

/** The preference resolved against the device — the theme actually rendered. */
const resolve = (preference) => (
  preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference
);

const ThemeContext = createContext({
  preference: 'system',
  theme: 'light',
  setPreference: () => {},
});

export const ThemeProvider = ({ children }) => {
  const [preference, setPreferenceState] = useState(readPreference);
  const [theme, setTheme] = useState(() => resolve(readPreference()));

  // Push the resolved theme onto <html>. `color-scheme` is set alongside `data-theme` and is not
  // decorative: it is what makes the BROWSER's own surfaces follow — default scrollbars, form
  // controls, and the native date picker that Firefox users still get, because its calendar glyph
  // cannot be hidden by any CSS. Without it that calendar opens as a white panel over a dark
  // booking form.
  const apply = useCallback((next) => {
    setTheme(next);
    const root = document.documentElement;
    root.setAttribute('data-theme', next);
    root.style.colorScheme = next;
  }, []);

  const setPreference = useCallback((next) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked or full. The choice still applies to this session; it just will not
      // survive a reload, which is a better outcome than refusing to change the theme.
    }
    apply(resolve(next));
  }, [apply]);

  // Follow the device while the preference is 'system' — and only then. A user who explicitly
  // chose light does not want their screen inverting at sunset.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    let media;
    try {
      media = window.matchMedia(DARK_QUERY);
    } catch {
      return undefined;
    }
    const sync = () => apply(media.matches ? 'dark' : 'light');
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [preference, apply]);

  const value = useMemo(
    () => ({ preference, theme, setPreference }),
    [preference, theme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
