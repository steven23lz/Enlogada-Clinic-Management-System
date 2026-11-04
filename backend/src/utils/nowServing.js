/**
 * What the waiting-room screen shows, from today's calls. [1.149.0] Pure, tested in
 * `tests/unit/nowServing.test.js`.
 *
 * A station's current ticket is its newest call. Every station is always listed, even one that has
 * called nobody yet, so the tiles on the screen never move. `recent` is the calls just before the
 * current ones, for someone who looked up a moment too late.
 *
 * Only what is copied here reaches the public: the ticket, the station and the time. No name, no
 * visit id, no test. A ticket number means nothing to anyone but the person holding the slip.
 *
 * @param {{id: number, station: string, ticket: string, called_at: Date|string}[]} rows  newest first
 * @param {{key: string, label: string}[]} stations  every station, in screen order
 */
function summarise(rows, stations, { recentCount = 6 } = {}) {
  const labelOf = Object.fromEntries(stations.map((s) => [s.key, s.label]));
  const shape = (row) => ({
    id: row.id,
    station: row.station,
    label: labelOf[row.station] || row.station,
    ticket: row.ticket,
    calledAt: row.called_at,
  });

  const current = new Map();
  const earlier = [];
  for (const row of rows) {
    if (!labelOf[row.station]) continue;
    if (current.has(row.station)) earlier.push(row);
    else current.set(row.station, row);
  }

  return {
    stations: stations.map((s) => {
      const call = current.get(s.key);
      return call
        ? shape(call)
        : { id: null, station: s.key, label: s.label, ticket: null, calledAt: null };
    }),
    recent: earlier.slice(0, recentCount).map(shape),
  };
}

module.exports = { summarise };
