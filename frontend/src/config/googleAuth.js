// Google Sign-In configuration, read once from Vite's build-time env.
//
// This lives in its own module rather than in App.jsx because Login.jsx needs the same value
// and App.jsx already imports Login.jsx — importing back the other way would be a cycle.
//
// An unconfigured install used to fall back to a placeholder client ID. Google answers a
// placeholder with an invalid_client error, so the sign-in button rendered blank or dead with
// nothing on screen explaining why; the only clue was a console error. Callers now branch on
// `isGoogleAuthConfigured` and say so in the UI instead.
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

export const isGoogleAuthConfigured = GOOGLE_CLIENT_ID.length > 0;
