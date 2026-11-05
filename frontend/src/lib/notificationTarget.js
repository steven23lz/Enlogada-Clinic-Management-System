/**
 * Where a notification opens, for whoever clicks it. [1.164.0]
 *
 * Steven: clicking a notification took nobody anywhere; it only marked it read. The server says what a
 * notification is about (`target`, a kind and what identifies it), and this says which screen that is for
 * this person: one notice goes to several roles, and a cashier and a receptionist handle the same patient
 * from different screens. Each list is in order of preference, and the first the person can open wins.
 * Pure, so it is tested without a screen.
 */
const WORKLIST = { Laboratory: 'lab-ops', Ultrasound: 'ultrasound-ops', Xray: 'xray-ops' };

const DESTINATIONS = {
  worklist: (t) => t.departments?.map((d) => ({ nav: WORKLIST[d], intent: { find: t.find } })) || [],
  // A ticket reaching a department: its worklist for that department, the Desk for the front desk.
  ticket: (t) => [
    ...(t.departments || []).map((d) => ({ nav: WORKLIST[d], intent: { find: t.find } })),
    { nav: 'reception-queue', intent: { find: t.find } },
  ],
  booking: (t) => [
    { nav: 'appointments-list' },
    { nav: 'reception-queue', intent: { verify: t.reference } },
  ],
  till: (t) => [
    { nav: 'cashier-queue', intent: { find: t.find } },
    { nav: 'reception-queue', intent: { find: t.find } },
  ],
  'online-payments': () => [{ nav: 'cashier-payments' }],
  receipt: (t) => [
    { nav: 'cashier-history', intent: { find: t.receipt } },
    { nav: 'cashier-monitoring' },
  ],
  claim: (t) => [{ nav: 'service-requests', intent: { claimId: t.claimId } }],
  record: (t) => [{ nav: 'patient-records', intent: { find: t.find } }],
  'cash-count': () => [{ nav: 'cashier-monitoring' }, { nav: 'cashier-count' }],
  activity: () => [{ nav: 'activity' }],
};

/**
 * @param {{ kind: string }|null} target    what the server stored with the notification
 * @param {(navId: string) => boolean} canOpen  whether this person's sidebar offers that screen
 * @returns {{ nav: string, intent: object|null }|null}  null: nothing to open, as with a notice from before this
 */
export function notificationDestination(target, canOpen) {
  const options = target && DESTINATIONS[target.kind]?.(target);
  if (!options) return null;
  const hit = options.find((o) => o.nav && canOpen(o.nav));
  return hit ? { nav: hit.nav, intent: hit.intent || null } : null;
}
