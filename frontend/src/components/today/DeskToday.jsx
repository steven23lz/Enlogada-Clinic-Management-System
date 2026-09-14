import React from 'react';
import { AlertTriangle, Receipt, Stethoscope, Users } from 'lucide-react';
import MetricCard from '../ui/metric-card';
import { Panel, PanelHeader } from '../ui/panel';
import { Button } from '../ui/button';
import { LinesPanel, TodayColumns, TodaySection } from './TodayParts';
import { formatTime12 } from '../../lib/date';
import { formatDuration } from '../../lib/duration';
import { cn } from '../../lib/utils';
import { figureValue, minutesBetween, nextSevenDays, personName, todaysBookings } from '../../lib/today';

const BOOKING_STATE = {
  arrived: { label: 'Arrived', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  // Indigo, not blue: index.css remaps indigo for dark mode, and a blue-50 pill stayed white there.
  due: { label: 'Due', tone: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  late: { label: 'Late', tone: 'bg-amber-50 text-amber-800 ring-amber-200', icon: AlertTriangle },
  'no-show': { label: 'No-show', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The front desk's Today. [1.77.0]
 *
 * What the desk is asked during a shift: who is booked in and whether they came, who is standing at
 * the cashier and for how long, and when the clinic is open ("are you open Saturday?"). The queue
 * itself is the Desk's; this says where it stands.
 *
 * The bookings list carries its own Check in, which opens that booking's card on the Desk. It is not
 * repeated in "Needs you now": a booking that is due is on this list once, not on two.
 */
export default function DeskToday({ queue, ops, bookings, hmo, hours, needs, heading, canCheckIn, onGo, now }) {
  const visits = queue.data?.visits || [];
  const statusOf = (v) => v.visit_status || v.status;
  // With the cashier = waiting to pay WITH something to pay for. A visit with nothing on it is the
  // desk's own work, and "Needs you now" already names it; counting it here would say it twice.
  const withCashier = visits
    .filter((v) => statusOf(v) === 'Pending' && (v.tests || []).length > 0)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const inDepartment = visits.filter((v) => statusOf(v) === 'Processing').length;
  const longest = withCashier[0];
  const longestFor = longest ? minutesBetween(longest.created_at, now) : null;
  const reception = ops.data?.reception;

  const figures = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <MetricCard
        label="With the cashier"
        value={figureValue(queue, withCashier.length)}
        icon={Receipt}
        tone="amber"
        captionTone="slate"
        caption={longest ? `Longest: ${personName(longest)}${longestFor !== null ? `, ${formatDuration(longestFor)}` : ''}` : undefined}
      />
      <MetricCard label="In a department" value={figureValue(queue, inDepartment)} icon={Stethoscope} tone="indigo" />
      <MetricCard
        label="Visits today"
        value={figureValue(ops, reception?.visits)}
        icon={Users}
        tone="green"
        captionTone="slate"
        caption={reception ? `${plural(reception.walk_ins, 'walk-in')} · ${reception.appointments} booked` : undefined}
      />
    </div>
  );

  const booked = todaysBookings(bookings.data || [], now);
  const bookingsPanel = (
    <Panel data-testid="today-bookings">
      <PanelHeader
        title="Today's bookings"
        actions={bookings.data ? <span className="text-fine text-slate-500">{booked.length} booked</span> : undefined}
      />
      {bookings.failed ? (
        <p role="alert" className="m-0 px-5 py-4 text-fine font-medium text-rose-700">Couldn't load today's bookings.</p>
      ) : bookings.loading ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-400">Loading…</p>
      ) : booked.length === 0 ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-500">No bookings today.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0">
          {booked.map((b) => {
            const state = BOOKING_STATE[b.state] || BOOKING_STATE.due;
            const StateIcon = state.icon;
            const name = personName(b);
            return (
              <li key={b.id} data-testid="today-booking" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-2.5">
                <span className="w-16 flex-shrink-0 text-fine font-semibold tabular-nums text-slate-500">
                  {formatTime12(b.scheduled_time)}
                </span>
                {/* Wraps rather than truncating: on a phone "Tomas …" is a name the desk cannot read. */}
                <span className="min-w-0 flex-1 break-words text-note font-semibold text-slate-900">{name}</span>
                <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-micro font-semibold ring-1 ring-inset', state.tone)}>
                  {StateIcon && <StateIcon aria-hidden="true" className="h-3 w-3" />}
                  {state.label}
                </span>
                {canCheckIn && (b.state === 'due' || b.state === 'late') && (
                  <Button
                    size="xs"
                    variant="outline"
                    // The slot as well as the name: one person can hold two bookings in a day, and
                    // two buttons both called "Check in Elena Client" cannot be told apart.
                    aria-label={`Check in ${name}, ${formatTime12(b.scheduled_time)}`}
                    onClick={() => onGo?.('reception-queue', { verify: b.appointment_reference })}
                  >
                    Check in
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );

  // HMO claims raised for someone in the building today, still waiting on an Admin. The desk cannot
  // decide them, so they are not "needs"; they are what to tell the patient who asks.
  const inToday = new Set(visits.map((v) => v.id));
  const claims = (hmo.data || []).filter((r) => inToday.has(r.patient_visit_id));
  const claimsPanel = (hmo.failed || claims.length > 0) && (
    <LinesPanel
      testId="today-hmo"
      title="HMO requests waiting for Admin"
      failed={hmo.failed}
      failedText="Couldn't load the HMO requests."
      rows={claims.map((r) => ({
        key: r.id,
        label: [r.patient_first_name, r.patient_last_name].filter(Boolean).join(' '),
        note: r.provider_name,
        value: r.queue_number ? `Ticket ${r.queue_number}` : '',
      }))}
    />
  );

  const days = hours.data ? nextSevenDays(hours.data.week, hours.data.upcoming, now) : [];
  const hoursPanel = (
    <LinesPanel
      testId="today-hours"
      title="Opening hours"
      hint="The next 7 days"
      failed={hours.failed}
      failedText="Couldn't load the opening hours."
      loading={hours.loading}
      emptyText="No opening hours are set."
      rows={days.map((d) => ({
        key: d.key,
        label: d.label,
        note: d.changed ? `${d.date} · not the usual hours` : d.date,
        value: d.text,
      }))}
    />
  );

  return (
    <TodaySection heading={heading}>
      <TodayColumns
        left={<>{needs}{figures}</>}
        right={<>{bookingsPanel}{claimsPanel}{hoursPanel}</>}
      />
    </TodaySection>
  );
}
