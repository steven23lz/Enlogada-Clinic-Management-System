import React from 'react';
import { categoryLabel as categoryLabelFor } from '../../lib/categories';

const PAGE_SIZE = 10;
import { Eye, History, Pencil } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SearchInput } from '../ui/search-input';
import Pagination from '../ui/pagination';
import { formatDateTime } from '../../lib/date';
import { SkeletonRows } from '../ui/skeleton';
import { TurnaroundPanel } from '../reports/OperationsPanels';

/**
 * Reports this department has already released, and its throughput beside them.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 */
export default function ResultHistoryPanel({ worklist, entry, operations, onViewResult }) {
  const categoryLabel = categoryLabelFor(worklist.category);

  // Client-side, because the worklist a department holds at once is small — a handful of
  // tickets, not the payments table. Filtering here keeps the search instant while the polling
  // in useDiagnosticWorklist keeps the underlying list fresh.
  const filtered = worklist.released.filter((t) => {
    const term = worklist.search.toLowerCase();
    const matchesSearch = !worklist.search ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(term) ||
      t.test_name.toLowerCase().includes(term) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(term));
    return matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((worklist.historyPage - 1) * PAGE_SIZE, worklist.historyPage * PAGE_SIZE);

  return (
      <>
      <div>
        {/* Search Bar */}
        <Toolbar attached>
          <span className="text-fine font-medium tabular-nums text-slate-500">
            {filtered.length} released result{filtered.length === 1 ? '' : 's'}
          </span>
          <ToolbarSpacer />
          <SearchInput
            placeholder="Search patient, test, queue..."
            value={worklist.search}
            onChange={e => worklist.setSearch(e.target.value)}
            containerClassName="w-full sm:w-64"
          />
        </Toolbar>

      {/* Released Results Table (read-only) */}
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Queue Ticket</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Diagnostic Examination</TableHead>
                <TableHead>Released</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worklist.historyError ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-xs text-rose-600 font-semibold">
                    {worklist.historyError}{' '}
                    <button
                      type="button"
                      onClick={worklist.refresh}
                      className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                    >
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : worklist.loading ? (
                <SkeletonRows rows={5} columns={5} />
              ) : paged.length > 0 ? (
                paged.map(test => (
                  <TableRow key={test.visit_test_id} className="hover:bg-slate-50/70 transition-colors">
                    <TableCell label="Queue Ticket" className="py-3.5">
                      <span className="font-extrabold text-xs text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                        {test.queue_number || `VT-${test.visit_test_id}`}
                      </span>
                    </TableCell>

                    <TableCell label="Patient" className="py-3.5 font-bold text-xs text-slate-900">
                      {test.first_name} {test.last_name}
                    </TableCell>

                    <TableCell label="Examination" className="py-3.5 text-xs font-bold text-gray-800">
                      {test.test_name}
                      {/* A corrected report is not the same document as a first one, and this
                          screen's own description promises "including amended versions" while
                          showing nothing that distinguished them. A v2 read exactly like a v1,
                          so somebody scanning the history could not tell which reports had been
                          re-issued — which is the first thing you want to know when a patient
                          or a referring doctor rings up about one. `version` was already in the
                          payload; nothing displayed it. */}
                      {test.version > 1 && (
                        <span className="ml-1.5 inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-200">
                          Amended &middot; v{test.version}
                        </span>
                      )}
                      <span className="block text-meta text-gray-400 font-normal">{test.category_name}</span>
                    </TableCell>

                    <TableCell label="Released" className="py-3.5 text-xs text-gray-500">
                      {test.released_at ? formatDateTime(test.released_at) : '—'}
                      {test.released_by_first_name && (
                        <span className="block text-meta text-gray-400">by {test.released_by_first_name} {test.released_by_last_name}</span>
                      )}
                    </TableCell>

                    <TableCell className="py-3.5 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          onClick={() => onViewResult(test)}
                          variant="outline"
                          className="text-fine font-bold border-gray-200 hover:bg-brand-500 hover:text-white rounded-lg py-1 px-2.5 flex items-center space-x-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Report</span>
                        </Button>
                        <Button
                          onClick={() => entry.openForEdit(test)}
                          variant="outline"
                          size="xs"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>Edit</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={History}
                      title={worklist.search ? 'Nothing matches that search' : `No released ${categoryLabel} results yet`}
                      description={
                        worklist.search
                          ? 'Try a surname, a test name, or a queue ticket number.'
                          : 'A result appears here once it has been authorised for release from the worklist.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
        <Pagination
          page={worklist.historyPage}
          totalPages={totalPages}
          onPageChange={worklist.setHistoryPage}
          total={filtered.length} pageSize={PAGE_SIZE}
        />
      </Panel>

      {/* Turnaround for this department. The worklist counts what is waiting; this is the
          only place that says how long the waiting takes. */}
      <div className="mt-4">
        <TurnaroundPanel
          diagnostics={operations.report?.diagnostics}
          loading={operations.loading}
          title="Your turnaround"
        />
      </div>
      </div>
      </>
  );
}
