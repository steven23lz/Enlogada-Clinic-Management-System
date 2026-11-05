import React, { useMemo, useState } from 'react';
import { AlertCircle, CalendarCheck } from 'lucide-react';
import { Panel, PanelBody, PanelHeader } from '../ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SegmentedFilter } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { SkeletonRows } from '../ui/skeleton';
import { Button } from '../ui/button';
import Pagination from '../ui/pagination';
import DateTime from '../ui/date-time';
import { formatCurrency } from '../../lib/currency';
import { daysAgoStr, todayStr } from '../../lib/date';
import { dayLabel } from '../../lib/reportPrint';
import { OUTCOME_TONE, outcomeWords } from '../../lib/cashCount';
import { useCashDays } from '../../hooks/useCashCount';

const RANGES = [
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last year' },
];
const PAGE_SIZE = 10;

const summaryLine = (s) => [
  `${s.counted} counted`,
  s.notCounted ? `${s.notCounted} not counted` : null,
  s.short ? `${formatCurrency(s.short)} short` : null,
  s.over ? `${formatCurrency(s.over)} over` : null,
].filter(Boolean).join(' · ');

/**
 * Every day the till took money, and what the drawer held. [1.150.0] On Cashier Monitoring for an
 * Admin, who reads and never counts, and under the form on Cash Count. A day with takings and no
 * count says so: the absence is the finding. The totals come from the server's summary, not from the
 * rows on this page.
 */
export default function ClosedDaysPanel({ refreshKey = 0 }) {
  const [range, setRange] = useState('30');
  const startDate = useMemo(() => daysAgoStr(Number(range)), [range]);
  const endDate = useMemo(() => todayStr(), []);
  const days = useCashDays({ enabled: true, startDate, endDate, limit: PAGE_SIZE });
  const { reload } = days;

  // A count just saved on this screen belongs in the list under it.
  React.useEffect(() => {
    if (refreshKey) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const rows = days.data?.days || [];

  return (
    <Panel data-testid="closed-days">
      <PanelHeader
        icon={CalendarCheck}
        title="Closed days"
        description={days.data ? summaryLine(days.data.summary) : 'What the till took each day, and what the drawer held.'}
        actions={<SegmentedFilter ariaLabel="Which days" options={RANGES} value={range} onChange={setRange} />}
      />
      <PanelBody flush>
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead>Cash taken</TableHead>
              <TableHead>Should be in drawer</TableHead>
              <TableHead>Counted</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Counted by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <EmptyState
                    compact
                    tone="error"
                    icon={AlertCircle}
                    title="Couldn't load the closed days"
                    description={days.error}
                    action={<Button variant="outline" size="sm" onClick={days.reload}>Try again</Button>}
                  />
                </TableCell>
              </TableRow>
            ) : days.loading && !days.data ? (
              <SkeletonRows rows={4} columns={6} />
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-0">
                  <EmptyState compact icon={CalendarCheck} title="No days in this range" description="A day appears here once the till has taken money or the drawer has been counted." />
                </TableCell>
              </TableRow>
            ) : rows.map((d) => (
              <TableRow key={`${d.date}-${d.drawerKey}`} data-testid="closed-day" data-date={d.date} data-drawer={d.drawerName || undefined} data-outcome={d.count?.outcome || (d.beforeCounting ? 'before-counting' : 'not-counted')}>
                <TableCell label="Day" className="whitespace-nowrap font-semibold text-slate-900">
                  {dayLabel(d.date)}
                  {d.drawerName && <span className="block text-fine font-semibold text-brand-700">{d.drawerName}'s drawer</span>}
                  <span className="block text-meta font-normal text-slate-500">{d.receipts} receipt{d.receipts === 1 ? '' : 's'}</span>
                </TableCell>
                <TableCell label="Cash taken" className="tabular-nums">
                  {formatCurrency(d.cash)}
                  {(d.gcash > 0 || d.bank > 0) && (
                    <span className="block text-meta text-slate-500">
                      {[d.gcash > 0 && `GCash ${formatCurrency(d.gcash)}`, d.bank > 0 && `Bank ${formatCurrency(d.bank)}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </TableCell>
                <TableCell label="Should be in drawer" className="tabular-nums">
                  {d.count ? formatCurrency(d.count.expectedInDrawer) : '—'}
                  {d.count?.changeFund > 0 && <span className="block text-meta text-slate-500">with {formatCurrency(d.count.changeFund)} change fund</span>}
                </TableCell>
                <TableCell label="Counted" className="tabular-nums font-semibold text-slate-900">{d.count ? formatCurrency(d.count.counted) : '—'}</TableCell>
                <TableCell label="Result">
                  {d.count ? (
                    <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-fine font-semibold ${OUTCOME_TONE[d.count.outcome]}`}>
                      {outcomeWords(d.count.difference)}
                    </span>
                  ) : (
                    <span className="inline-flex whitespace-nowrap rounded-md border border-line bg-slate-100 px-2 py-0.5 text-fine font-semibold text-slate-600">
                      {d.isToday ? 'Not counted yet' : d.beforeCounting ? 'Before counting began' : 'Not counted'}
                    </span>
                  )}
                  {d.takenAfter !== 0 && (
                    <span data-testid="closed-day-after" className="mt-1 block text-meta font-semibold text-amber-800">
                      {formatCurrency(Math.abs(d.takenAfter))} {d.takenAfter > 0 ? 'taken after this count' : 'less than at this count'}
                    </span>
                  )}
                  {d.count?.note && <span className="mt-1 block max-w-[18rem] text-meta text-slate-600">{d.count.note}</span>}
                </TableCell>
                <TableCell label="Counted by" className="text-slate-600">
                  {d.count ? (
                    <>
                      {d.count.countedBy}
                      <span className="block text-meta text-slate-500"><DateTime value={d.count.countedAt} /></span>
                      {d.recounts > 0 && <span className="block text-meta font-semibold text-amber-800">Counted {d.recounts + 1} times</span>}
                    </>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PanelBody>
      {days.data && !days.error && (
        <Pagination
          page={days.page}
          totalPages={days.data.totalPages}
          onPageChange={days.goToPage}
          total={days.data.total}
          pageSize={PAGE_SIZE}
        />
      )}
    </Panel>
  );
}
