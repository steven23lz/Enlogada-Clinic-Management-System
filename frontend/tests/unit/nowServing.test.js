import { describe, it, expect } from 'vitest';
import {
  spokenTicket, callSentence, latestCallId, newCallsSince, isStale, clockOf, isFromToday, calledAgo,
} from '../../src/lib/nowServing.js';

// The waiting-room screen and the Call button. [1.149.0] Local parts, so any time zone holds.
const at = (hour, minute = 0, day = 4) => new Date(2026, 10, day, hour, minute);

const board = {
  stations: [
    { id: null, station: 'Front Desk', label: 'Front Desk', ticket: null, calledAt: null },
    { id: 7, station: 'Cashier', label: 'Cashier', ticket: '0007', calledAt: at(9).toISOString() },
    { id: 9, station: 'Xray', label: 'X-Ray', ticket: '0003', calledAt: at(9, 5).toISOString() },
  ],
  recent: [{ id: 5, station: 'Cashier', label: 'Cashier', ticket: '0005', calledAt: at(8, 50).toISOString() }],
};

describe('what is said aloud', () => {
  it('drops the padding from a ticket, and keeps anything that is not a number', () => {
    expect(spokenTicket('0012')).toBe('12');
    expect(spokenTicket('0000')).toBe('0');
    expect(spokenTicket('A12')).toBe('A12');
  });

  it('sends the patient somewhere a person would name', () => {
    expect(callSentence({ ticket: '0012', station: 'Cashier', label: 'Cashier' })).toBe('Number 12, please proceed to the cashier.');
    expect(callSentence({ ticket: '0003', station: 'Front Desk', label: 'Front Desk' })).toBe('Number 3, please proceed to the front desk.');
    expect(callSentence({ ticket: '0003', station: 'Xray', label: 'X-Ray' })).toBe('Number 3, please proceed to X-Ray.');
  });
});

describe('what is news', () => {
  it('reads nothing out on first look: a TV switched on at 2 PM must not read out the morning', () => {
    expect(newCallsSince(board, null)).toEqual([]);
    expect(latestCallId(board)).toBe(9);
  });

  it('says what came since, oldest first', () => {
    expect(newCallsSince(board, 5).map((c) => c.id)).toEqual([7, 9]);
    expect(newCallsSince(board, 9)).toEqual([]);
  });

  it('copes with an empty board', () => {
    expect(latestCallId({ stations: [], recent: [] })).toBe(0);
    expect(latestCallId(null)).toBe(0);
  });
});

describe('the time on a call', () => {
  it('fades after half an hour, and never for a tile with no call', () => {
    expect(isStale(at(9).toISOString(), at(9, 30))).toBe(false);
    expect(isStale(at(9).toISOString(), at(9, 31))).toBe(true);
    expect(isStale(null, at(9))).toBe(false);
  });

  it('reads as a clock', () => {
    expect(clockOf(at(13, 5))).toBe('1:05 PM');
    expect(clockOf(null)).toBe('');
  });

  it('only a ticket from today can be called: numbers restart each day', () => {
    expect(isFromToday(at(8).toISOString(), at(17))).toBe(true);
    expect(isFromToday(at(16, 0, 3).toISOString(), at(8))).toBe(false);
    expect(isFromToday(null, at(8))).toBe(false);
  });

  it('says how long ago it was called', () => {
    expect(calledAgo(at(9).toISOString(), at(9))).toBe('Called just now');
    expect(calledAgo(at(9).toISOString(), at(9, 12))).toBe('Called 12m ago');
    expect(calledAgo(at(9).toISOString(), at(11, 5))).toBe('Called 2h 5m ago');
    expect(calledAgo(null, at(9))).toBeNull();
  });
});
