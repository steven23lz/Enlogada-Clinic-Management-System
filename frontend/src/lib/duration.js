/**
 * Minutes into something a person can read at a glance.
 *
 * Lived in wait-badge.jsx, which was fine while a queue badge was the only thing that needed it.
 * The operations report needs the same formatting for turnaround and wait times, and a second
 * copy would eventually disagree with the first about where the hour boundary sits — so it moved
 * here rather than being duplicated. (It also silences the fast-refresh warning you get from
 * exporting a plain function next to components.)
 *
 * Past an hour it reads as hours and minutes, and past a day as days. The billing queue used to
 * render raw minutes, which is fine at "12m" and useless by "294m" — nobody converts that to just
 * under five hours while a patient is standing in front of them.
 */
export function formatDuration(totalMinutes) {
  const minutes = Math.max(0, Math.floor(totalMinutes || 0));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;

  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days}d` : `${days}d ${leftoverHours}h`;
}

export function minutesSince(timestamp) {
  const parsed = new Date(timestamp).getTime();
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 60000));
}
