const test = require('node:test');
const assert = require('node:assert/strict');
const { summarise } = require('../../src/utils/nowServing');

// The waiting-room screen. [1.149.0]
const STATIONS = [
  { key: 'Front Desk', label: 'Front Desk' },
  { key: 'Cashier', label: 'Cashier' },
  { key: 'Xray', label: 'X-Ray' },
];
const call = (id, station, ticket) => ({ id, station, ticket, called_at: `2026-11-04T0${id}:00:00Z`, patient: 'never copied' });

test('each station shows its newest call, and every station is listed', () => {
  const { stations } = summarise([call(3, 'Cashier', '0003'), call(2, 'Xray', '0002'), call(1, 'Cashier', '0001')], STATIONS);
  assert.deepEqual(stations.map((s) => [s.station, s.ticket]), [['Front Desk', null], ['Cashier', '0003'], ['Xray', '0002']]);
  assert.equal(stations[2].label, 'X-Ray');
});

test('the calls behind the current ones are the recent list, newest first and capped', () => {
  const rows = [call(5, 'Cashier', '0005'), call(4, 'Cashier', '0004'), call(3, 'Cashier', '0003'), call(2, 'Cashier', '0002')];
  const { recent } = summarise(rows, STATIONS, { recentCount: 2 });
  assert.deepEqual(recent.map((r) => r.ticket), ['0004', '0003']);
});

test('only the ticket, the station and the time reach the public', () => {
  const { stations, recent } = summarise([call(2, 'Cashier', '0002'), call(1, 'Cashier', '0001')], STATIONS);
  const keys = ['calledAt', 'id', 'label', 'station', 'ticket'];
  assert.deepEqual(Object.keys(stations[1]).sort(), keys);
  assert.deepEqual(Object.keys(recent[0]).sort(), keys);
});

test('nobody called yet, and a retired station, say nothing', () => {
  assert.deepEqual(summarise([], STATIONS).recent, []);
  const { stations, recent } = summarise([call(1, '2D Echo', '0001')], STATIONS);
  assert.equal(stations.every((s) => s.ticket === null), true);
  assert.deepEqual(recent, []);
});
