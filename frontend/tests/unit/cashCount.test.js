import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import {
  DENOMINATIONS, pieceLabel, pileValue, countedTotal, hasCount, expectedInDrawer, differenceOf, outcomeOf, outcomeWords,
} from '../../src/lib/cashCount.js';

// The cash count's live figures. [1.150.0] The server's are the ones on the record, and these must
// read the same, so the two are held to each other here.
const require = createRequire(import.meta.url);
const server = require('../../../backend/src/utils/cashCount.js');

describe('the same arithmetic as the server', () => {
  it('lists the same notes and coins', () => {
    expect(DENOMINATIONS).toEqual([...server.DENOMINATIONS]);
  });

  it('adds up to the same total, difference and outcome', () => {
    const pieces = { 1000: 2, 500: 1, 100: 3, 1: 4, 0.25: 3 };
    expect(countedTotal(pieces, 0.35)).toBe(server.readCount({ pieces, loose: 0.35 }).total);
    const given = { counted: 5200.5, changeFund: 1000, cash: 4250.5 };
    expect(differenceOf(given.counted, given.changeFund, given.cash)).toBe(server.differenceOf(given));
    expect(outcomeOf(-50)).toBe(server.outcomeOf(-50));
    expect(expectedInDrawer(1000, 4250.5)).toBe(server.expectedInDrawer({ changeFund: 1000, cash: 4250.5 }));
  });
});

describe('the form', () => {
  it('values a pile, and a blank or unreadable one as nothing', () => {
    expect(pileValue(100, '3')).toBe(300);
    expect(pileValue(0.25, 3)).toBe(0.75);
    expect(pileValue(100, '')).toBe(0);
    expect(pileValue(100, 'x')).toBe(0);
  });

  it('adds what was typed, as text, blanks and all', () => {
    expect(countedTotal({ 1000: '1', 500: '', 20: '2' }, '')).toBe(1040);
  });

  it('knows a 0 is an answer and a blank row is not', () => {
    expect(hasCount({}, '')).toBe(false);
    expect(hasCount({ 1000: '' }, '')).toBe(false);
    expect(hasCount({ 1000: '0' }, '')).toBe(true);
    expect(hasCount({}, '0')).toBe(true);
  });

  it('labels the notes and the one coin with centavos', () => {
    expect(pieceLabel(1000)).toBe('₱1,000');
    expect(pieceLabel(0.25)).toBe('₱0.25');
  });

  it('says the result in words', () => {
    expect(outcomeWords(0)).toBe('It balances');
    expect(outcomeWords(-50)).toMatch(/50\.00 short$/);
    expect(outcomeWords(10.5)).toMatch(/10\.50 over$/);
  });
});
