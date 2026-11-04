import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { Button } from '../ui/button';
import api from '../../config/api';
import { toastError, toastInfo, toastSuccess } from '../../lib/toast';
import { STATIONS, calledAgo, sayCall } from '../../lib/nowServing';

const newest = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  return new Date(a) > new Date(b) ? a : b;
};

/**
 * Calls a patient's ticket to a station. [1.149.0] The one Call button: the Desk, the Billing Queue
 * and every worklist draw this, and it says when that station last called them, so nobody calls the
 * same ticket twice not knowing, or wonders whether a call went out.
 *
 * The waiting-room screen shows the call and says it. With no screen open nobody would see it, so
 * this PC says it aloud (which is all the Desk's old button did) and the toast says why. The label is
 * in the accessible name; the patient's name is not, so a spec or a screen reader finding a row by
 * name finds the row and not this button.
 *
 * @param {string} station  a key of constants/queueStations.js: 'Cashier', 'Laboratory'…
 * @param {string} patientName  for the toast, which names who was called
 * @param {string|null} calledAt  when this station last called this visit, from the row
 */
export default function CallButton({ visitId, ticket, station, patientName, calledAt, className }) {
  const [busy, setBusy] = useState(false);
  const [pressedAt, setPressedAt] = useState(null);
  const last = newest(calledAt, pressedAt);
  const place = STATIONS.find((s) => s.station === station)?.label || station;

  const press = async () => {
    setBusy(true);
    try {
      const res = await api.post('/queue/calls', { visitId, station });
      const { call } = res.data.data;
      setPressedAt(call.calledAt);
      if (call.displayOpen) {
        toastSuccess(`Called ticket ${call.ticket} to ${call.label}`, patientName);
      } else {
        const said = sayCall(call);
        toastInfo(
          `Called ticket ${call.ticket} to ${call.label}`,
          said
            ? 'No waiting-room screen is open, so this computer said it aloud.'
            : 'No waiting-room screen is open, so nobody can see it. Call this patient by name.',
        );
      }
    } catch (err) {
      toastError("Couldn't call this ticket", err.response?.data?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className={`inline-flex flex-col items-center gap-0.5 ${className || ''}`}>
      <Button
        type="button"
        variant="outline"
        size="xs"
        loading={busy}
        onClick={press}
        data-testid="call-ticket"
        data-station={station}
        aria-label={`${last ? 'Call again' : 'Call'}: ticket ${ticket} to ${place}`}
      >
        <Volume2 />
        <span>{last ? 'Call again' : 'Call'}</span>
      </Button>
      {last && <span data-testid="call-ticket-last" className="whitespace-nowrap text-micro text-slate-500">{calledAgo(last)}</span>}
    </span>
  );
}
