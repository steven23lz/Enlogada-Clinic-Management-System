import React from 'react';
import { AlertCircle, History, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { SkeletonRows } from '../ui/skeleton';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { SearchInput } from '../ui/search-input';
import { StatusBadge } from '../ui/status-badge';
import Pagination from '../ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { formatDateTime } from '../../lib/date';
import { ReceptionThroughputPanel } from '../reports/OperationsPanels';
import { HISTORY_PAGE_SIZE } from '../../hooks/useVisitHistory';

/**
 * Past visits over a chosen range, with the desk's own throughput beside them.
 *
 * Lifted out of ReceptionistDashboard, which rendered four unrelated screens from one
 * 1,048-line file. The props are the hooks this screen actually reads — listed rather than
 * reached for, so what each view depends on is visible at its top instead of inferred by
 * scrolling.
 */
export default function VisitHistoryPanel({ history, operations }) {
  return (
        <div>
          <Toolbar attached>
            <SearchInput
              placeholder="Search patient or Queue #..."
              value={history.search}
              onChange={e => history.setSearch(e.target.value)}
              containerClassName="w-full sm:w-56"
            />
            <Input type="date" value={history.startDate} onChange={e => history.setStartDate(e.target.value)} className="w-[150px]" aria-label="History start date" />
            <span className="text-fine text-slate-400">to</span>
            <Input type="date" value={history.endDate} onChange={e => history.setEndDate(e.target.value)} className="w-[150px]" aria-label="History end date" />
            <Button variant="outline" onClick={history.reload}>
              <RefreshCw className="h-3.5 w-3.5" />
              Apply
            </Button>
            <ToolbarSpacer />
            <span className="whitespace-nowrap text-fine font-medium tabular-nums text-slate-500">
              {history.total} visit{history.total === 1 ? '' : 's'}
            </span>
          </Toolbar>

          <Panel className="overflow-hidden rounded-t-none">
            <PanelBody flush>
              <Table stack>
                <TableHeader sticky>
                  <TableRow>
                    <TableHead>Queue Ticket</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Visit Type</TableHead>
                    <TableHead>Tests</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.error ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="p-0">
                        <EmptyState
                          tone="error"
                          icon={AlertCircle}
                          title="Couldn't load visit history"
                          description={history.error}
                          action={
                            <Button variant="outline" size="sm" onClick={history.reload}>
                              Try again
                            </Button>
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ) : history.loading ? (
                    <SkeletonRows rows={6} columns={6} />
                  ) : history.visits.length > 0 ? (
                    history.visits.map(v => (
                      <TableRow key={v.id}>
                        <TableCell label="Queue Ticket">
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-fine font-bold tabular-nums text-slate-700">
                            {v.queue_number || `V-${v.id}`}
                          </span>
                        </TableCell>
                        <TableCell label="Patient" className="font-semibold text-slate-900">
                          {v.first_name} {v.last_name}
                          <span className="block text-micro font-normal text-slate-400">{v.patient_type_name}</span>
                        </TableCell>
                        <TableCell label="Visit Type">
                          <Badge variant="outline" className="text-slate-600">
                            {v.visit_type}
                          </Badge>
                        </TableCell>
                        <TableCell label="Tests" className="text-slate-500">
                          {v.tests && v.tests.length > 0 ? v.tests.map(t => t.test_name).join(', ') : <span className="text-slate-400">No tests attached</span>}
                        </TableCell>
                        <TableCell label="Status">
                          <StatusBadge status={v.visit_status} />
                        </TableCell>
                        <TableCell label="Date" className="text-right text-fine text-slate-500">
                          {formatDateTime(v.created_at)}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="p-0">
                        <EmptyState
                          icon={History}
                          title="No visits in this date range"
                          description="Widen the dates above, or clear the search box."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </PanelBody>
            {/* The screen had no footer at all, because it rendered every row it fetched. */}
            <Pagination
              page={history.page}
              totalPages={history.totalPages}
              onPageChange={history.goToPage}
              total={history.total}
              pageSize={HISTORY_PAGE_SIZE}
            />
          </Panel>

          {/* How the desk is performing, not just what it did. The queue KPIs count who is
              waiting; this is the only place that says how long they wait to be billed. */}
          <div className="mt-4">
            <ReceptionThroughputPanel
              reception={operations.report?.reception}
              loading={operations.loading}
            />
          </div>
        </div>
  );
}
