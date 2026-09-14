import React from 'react';
import { Banknote, Undo2, Users, Wallet } from 'lucide-react';
import MetricCard from '../ui/metric-card';
import { Panel, PanelHeader } from '../ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { TodayColumns, TodaySection } from './TodayParts';
import { formatCurrency } from '../../lib/currency';
import { formatDuration } from '../../lib/duration';
import { categoryLabel } from '../../lib/categories';
import { cn } from '../../lib/utils';
import { departmentRows, figureValue, hoursSoFar } from '../../lib/today';

const hourLabel = (hour) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;

/**
 * The clinic's Today, for whoever runs it — Admin's home since [1.77.0], replacing the Dashboard.
 *
 * The old overview's four cards were two near-constants (catalogue size, staff count) and a revenue
 * figure; what the clinic was doing today sat one tab deep under Reports. This is that answer on
 * the first screen: money in and back out, the queue, each department's backlog and pace, and when
 * people arrived. Decisions waiting on the Admin are in "Needs you now".
 *
 * Each figure answers from its own read, so a refused or failed one reads "—" and the rest stand.
 */
export default function ClinicToday({ queue, paid, yesterday, online, ops, analytics, needs, heading, now }) {
  const q = queue.data;
  const s = paid.data?.summary;
  const before = yesterday.data?.summary;

  const figures = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
      <MetricCard
        label="Revenue today"
        value={figureValue(paid, s && formatCurrency(s.collected))}
        icon={Banknote}
        tone="emerald"
        captionTone="slate"
        caption={before ? `Yesterday, whole day: ${formatCurrency(before.collected)}` : undefined}
      />
      <MetricCard
        label="In the queue"
        value={figureValue(queue, q?.total)}
        icon={Users}
        tone="indigo"
        captionTone="slate"
        caption={q ? `${q.pendingCount} not yet paid · ${q.processingCount} in a department` : undefined}
      />
      <MetricCard
        label="Online payments"
        value={figureValue(online, online.data?.length)}
        icon={Wallet}
        tone="amber"
        captionTone="slate"
        caption="Waiting for the cashier to check"
      />
      <MetricCard
        label="Reversals today"
        value={figureValue(paid, s?.reversals)}
        icon={Undo2}
        tone="rose"
        captionTone="slate"
        caption={s ? `${formatCurrency(s.reversed)} handed back` : undefined}
      />
    </div>
  );

  const diagnostics = ops.data?.diagnostics;
  const rows = diagnostics
    ? departmentRows({
      outstanding: diagnostics.outstanding,
      byCategory: diagnostics.byCategory,
      sla: analytics.data?.turnaroundSla || [],
    })
    : [];
  const departments = (
    <Panel data-testid="today-departments">
      <PanelHeader
        title="Departments right now"
        actions={<span className="text-fine text-slate-500">Turnaround: payment to release</span>}
      />
      {ops.failed || (ops.data && !diagnostics) ? (
        <p role="alert" className="m-0 px-5 py-4 text-fine font-medium text-rose-700">Couldn't load the departments.</p>
      ) : !ops.data ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-400">Loading…</p>
      ) : (
        // `stack`: a list of cards below `sm`, like the other staff tables, so a phone never has
        // to drag a row sideways to read it.
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Department</TableHead>
              <TableHead>Waiting</TableHead>
              <TableHead className="text-right">Released today</TableHead>
              <TableHead className="text-right">Median</TableHead>
              <TableHead className="pr-5 text-right">Target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const waiting = [
                r.awaitingExam > 0 && `${r.awaitingExam} awaiting exam`,
                r.awaitingRelease > 0 && `${r.awaitingRelease} to release`,
              ].filter(Boolean).join(' · ') || 'Nothing waiting';
              const within = r.targetMinutes && r.medianMinutes !== null ? r.medianMinutes <= r.targetMinutes : null;
              return (
                <TableRow key={r.category}>
                  <TableCell label="Department" className="pl-5 font-semibold text-slate-900">{categoryLabel(r.category)}</TableCell>
                  <TableCell label="Waiting">{waiting}</TableCell>
                  <TableCell label="Released today" className="text-right tabular-nums">{r.released}</TableCell>
                  <TableCell label="Median" className="text-right tabular-nums">
                    {r.medianMinutes === null ? <span className="text-slate-400">Not measured</span> : formatDuration(r.medianMinutes)}
                  </TableCell>
                  <TableCell label="Target" className="pr-5 text-right">
                    {analytics.failed ? '—' : r.targetMinutes ? (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md px-1.5 py-0.5 text-micro font-semibold tabular-nums ring-1 ring-inset',
                          within === false ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        )}
                      >
                        {within === false ? 'Over' : 'Within'} {r.targetMinutes} min
                      </span>
                    ) : (
                      <span className="text-fine text-slate-400">Not set</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Panel>
  );

  const arrivals = hoursSoFar(analytics.data?.hourlyArrivals || [], now);
  const busiest = Math.max(1, ...arrivals.map((r) => Number(r.total) || 0));
  const anyone = arrivals.some((r) => Number(r.total) > 0);
  const arrivalsPanel = (
    <Panel data-testid="today-arrivals">
      <PanelHeader title="Arrivals by hour" actions={<span className="text-fine text-slate-500">So far today</span>} />
      {analytics.failed || (analytics.data && !analytics.data.hourlyArrivals) ? (
        <p role="alert" className="m-0 px-5 py-4 text-fine font-medium text-rose-700">Couldn't load today's arrivals.</p>
      ) : !analytics.data ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-400">Loading…</p>
      ) : !anyone ? (
        <p className="m-0 px-5 py-4 text-fine text-slate-500">Nobody has arrived yet today.</p>
      ) : (
        <div
          role="img"
          aria-label={`Arrivals by hour: ${arrivals.map((r) => `${hourLabel(Number(r.hour))}, ${r.total}`).join('; ')}`}
          className="flex h-44 items-end gap-1.5 px-5 pb-3 pt-4"
        >
          {arrivals.map((r) => {
            const hour = Number(r.hour);
            const total = Number(r.total) || 0;
            return (
              <div key={hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <span className="text-micro font-bold tabular-nums text-slate-700">{total}</span>
                <span
                  aria-hidden="true"
                  className={cn('w-full max-w-10 rounded-t-md', hour === now.getHours() ? 'bg-brand-600' : 'bg-brand-300')}
                  style={{ height: total > 0 ? `${Math.max(0.2, (total / busiest) * 7)}rem` : '0' }}
                />
                <span className="whitespace-nowrap text-micro text-slate-500">{hourLabel(hour)}</span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );

  return (
    <TodaySection heading={heading}>
      <TodayColumns left={<>{needs}{departments}</>} right={<>{figures}{arrivalsPanel}</>} />
    </TodaySection>
  );
}
