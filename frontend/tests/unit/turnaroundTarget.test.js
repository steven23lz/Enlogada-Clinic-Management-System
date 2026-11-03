import { describe, it, expect } from 'vitest';
import { targetState, overTarget } from '../../src/lib/turnaroundTarget.js';

// [1.148.0] A worklist test past its department's turnaround target. Local parts, any time zone.
const at = (hour, minute = 0) => new Date(2026, 10, 4, hour, minute);

describe('targetState', () => {
  it('counts from when the test was paid for and the patient was here', () => {
    const test = { target_minutes: 60, ready_at: at(9).toISOString(), visit_created_at: at(8).toISOString() };
    expect(targetState(test, at(9, 59))).toEqual({ target: 60, minutes: 59, over: false });
    expect(targetState(test, at(10, 1))).toEqual({ target: 60, minutes: 61, over: true });
  });

  it('judges nothing while the clinic has set no target', () => {
    expect(targetState({ target_minutes: null, ready_at: at(1).toISOString() }, at(10))).toBeNull();
    expect(targetState({ ready_at: at(1).toISOString() }, at(10))).toBeNull();
    expect(targetState({ target_minutes: 0, ready_at: at(1).toISOString() }, at(10))).toBeNull();
  });

  it('falls back to arrival, and reads nothing from a date that does not parse', () => {
    expect(targetState({ target_minutes: 30, visit_created_at: at(9).toISOString() }, at(10)).over).toBe(true);
    expect(targetState({ target_minutes: 30, ready_at: 'soon' }, at(10))).toBeNull();
  });
});

describe('overTarget', () => {
  it('keeps the tests past their target', () => {
    const tests = [
      { id: 1, target_minutes: 45, ready_at: at(9).toISOString() },
      { id: 2, target_minutes: 45, ready_at: at(9, 30).toISOString() },
    ];
    expect(overTarget(tests, at(10)).map((t) => t.id)).toEqual([1]);
  });
});
