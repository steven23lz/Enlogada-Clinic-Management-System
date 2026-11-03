/**
 * Whether a test on a worklist has waited past its department's turnaround target. [1.148.0]
 *
 * The target is the clinic's own setting (TURNAROUND_TARGETS on the server), sent on each worklist
 * row as `target_minutes`, or null while the clinic has set none: then nothing is judged, as the
 * reports do. The wait counts from `ready_at`, when the test was paid for and the patient was here,
 * whichever came last (a booking paid from home last week is not overdue the moment it arrives).
 *
 * Pure and clock-injected: tests/unit/turnaroundTarget.test.js.
 *
 * @returns {{target: number, minutes: number, over: boolean}|null}
 */
export function targetState(test, now = new Date()) {
  const target = Number(test?.target_minutes);
  if (test?.target_minutes === null || test?.target_minutes === undefined || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  const start = new Date(test.ready_at || test.visit_created_at).getTime();
  if (Number.isNaN(start)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - start) / 60000));
  return { target, minutes, over: minutes > target };
}

/** The tests among `tests` past their target. */
export const overTarget = (tests = [], now = new Date()) => tests.filter((t) => targetState(t, now)?.over);
