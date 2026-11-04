import { formatTime12 } from './date';

/**
 * The rules behind the waiting-room screen and the Call button. [1.149.0] Pure except `sayCall`, and
 * clock-injected: tests/unit/nowServing.test.js. The server's list is constants/queueStations.js;
 * this one only draws the tiles before its first answer, and names the two stations a screen calls to.
 */
export const FRONT_DESK = 'Front Desk';
export const CASHIER = 'Cashier';

export const STATIONS = [
  { station: FRONT_DESK, label: FRONT_DESK },
  { station: CASHIER, label: CASHIER },
  { station: 'Laboratory', label: 'Laboratory' },
  { station: 'Ultrasound', label: 'Ultrasound' },
  { station: 'Xray', label: 'X-Ray' },
];

/** How often the screen asks. The server gives it its own allowance (app.js displayLimiter). */
export const POLL_MS = 4000;
/** A station's ticket fades after this long with no new call: still true, no longer "now". */
export const STALE_AFTER_MINUTES = 30;
/** How long a tile stays lit after its call. */
export const FLASH_MS = 12000;

/** "0012" said aloud is "12". */
export function spokenTicket(ticket) {
  const text = String(ticket ?? '').trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

const SAID = { [FRONT_DESK]: 'the front desk', [CASHIER]: 'the cashier' };

export const callSentence = ({ ticket, station, label }) =>
  `Number ${spokenTicket(ticket)}, please proceed to ${SAID[station] || label || station}.`;

/** Every call on the board, once: a station's current one and the recent ones behind it. */
function callsOn(board) {
  const calls = [...(board?.stations || []), ...(board?.recent || [])].filter((c) => c.id);
  return [...new Map(calls.map((c) => [c.id, c])).values()];
}

export const latestCallId = (board) => callsOn(board).reduce((max, c) => Math.max(max, c.id), 0);

/**
 * The calls made since the screen last looked, oldest first, so they are said in the order they
 * were made. `lastSeen` null is the first look: what is already on the board is not news, and a TV
 * switched on at 2 PM must not read out the morning.
 */
export function newCallsSince(board, lastSeen) {
  if (lastSeen === null || lastSeen === undefined) return [];
  return callsOn(board).filter((c) => c.id > lastSeen).sort((a, b) => a.id - b.id);
}

export function isStale(calledAt, now = new Date()) {
  const at = new Date(calledAt).getTime();
  if (!calledAt || Number.isNaN(at)) return false;
  return now.getTime() - at > STALE_AFTER_MINUTES * 60000;
}

/** "9:32 AM", from an instant, in this screen's own time. */
export function clockOf(value) {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return '';
  return formatTime12(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`);
}

/** Tickets restart each day, so only a ticket from today can be called. */
export function isFromToday(value, now = new Date()) {
  const d = new Date(value);
  return Boolean(value) && !Number.isNaN(d.getTime()) && d.toDateString() === now.toDateString();
}

/** "Called just now", "Called 3m ago": `calledAt` is the newest of what the row and the press know. */
export function calledAgo(calledAt, now = new Date()) {
  const at = new Date(calledAt).getTime();
  if (!calledAt || Number.isNaN(at)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - at) / 60000));
  if (minutes < 1) return 'Called just now';
  if (minutes < 60) return `Called ${minutes}m ago`;
  return `Called ${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

/** Says a call aloud. False where the browser cannot, so the caller can say so instead. */
export function sayCall(call) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const utterance = new SpeechSynthesisUtterance(callSentence(call));
  utterance.rate = 0.9;
  window.speechSynthesis.speak(utterance);
  return true;
}
