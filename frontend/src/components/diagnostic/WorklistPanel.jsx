import React from 'react';
import { categoryLabel as categoryLabelFor, categoryIcon } from '../../lib/categories';

const PAGE_SIZE = 10;
const WORKLIST_STATUS_FILTERS = ['All', 'Processing', 'Waiting for Release'];
import { AlertTriangle, Clock, FileText, Send, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/button';
import { Panel, PanelBody } from '../ui/panel';
import Toolbar, { SegmentedFilter, ToolbarSpacer } from '../ui/toolbar';
import EmptyState from '../ui/empty-state';
import MetricCard from '../ui/metric-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { SearchInput } from '../ui/search-input';
import { StatusBadge } from '../ui/status-badge';
import Pagination from '../ui/pagination';
import { ageFromBirthdate } from '../../lib/date';
import WaitBadge from '../ui/wait-badge';
import { SkeletonRows } from '../ui/skeleton';

/**
 * What this department has to do today, and the state each ticket is in.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 */
export default function WorklistPanel({ worklist, entry, criticals }) {
  const categoryLabel = categoryLabelFor(worklist.category);
  const modalityIcon = categoryIcon(worklist.category);
  // 'Processing' = released to this department, exam not yet done.
  // 'Waiting for Release' = exam done and findings recorded, awaiting authorisation.
  const processingCount = worklist.pending.filter((t) => t.test_status === 'Processing').length;
  const awaitingReleaseCount = worklist.pending.filter((t) => t.test_status === 'Waiting for Release').length;

  // Client-side, because the worklist a department holds at once is small — a handful of
  // tickets, not the payments table. Filtering here keeps the search instant while the polling
  // in useDiagnosticWorklist keeps the underlying list fresh.
  const filtered = worklist.pending.filter((t) => {
    const term = worklist.search.toLowerCase();
    const matchesSearch = !worklist.search ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(term) ||
      t.test_name.toLowerCase().includes(term) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(term));
    const matchesStatus = worklist.status === 'All' || t.test_status === worklist.status;
    if (!matchesStatus) return false;
    return matchesSearch;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((worklist.worklistPage - 1) * PAGE_SIZE, worklist.worklistPage * PAGE_SIZE);

  return (
      <>
      {/* Department Modality Worklist Header Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <MetricCard label="Awaiting Exam" value={processingCount} caption="Paid and released to you" captionTone="slate" icon={Clock} tone="indigo" />
        <MetricCard label="Awaiting Release" value={awaitingReleaseCount} caption="Findings recorded, not authorised" captionTone="slate" icon={FileText} tone="amber" />
        {/* The tile this replaced said "Active Modality: Laboratory — Your department", which
            is the page title, the breadcrumb and the sidebar selection restated a fourth time
            in a third of the metric strip. A metric strip is the most valuable space on an
            operational screen and it was spending it on something the reader already knew.

            What goes there instead is the one thing on this screen nobody could see: a released
            critical result still waiting on its phone call. The escalation used to depend on the
            technician who flagged it staying on the worklist — one raised near the end of a
            shift had nobody watching it. Clicking opens the list. [1.28.0]

            It stays visible at zero, deliberately: a counter that only appears when it is
            non-zero teaches people not to look for it, and "0 outstanding" is the reassurance
            the tile exists to give. */}
        <MetricCard
          label="Critical Callbacks"
          value={criticals.outstanding.length}
          caption={
            criticals.outstanding.length
              ? 'Patient still to be telephoned'
              : 'Nothing outstanding'
          }
          captionTone={criticals.outstanding.length ? 'rose' : 'slate'}
          icon={AlertTriangle}
          tone={criticals.outstanding.length ? 'rose' : 'slate'}
          onClick={criticals.outstanding.length ? () => criticals.setExpanded(true) : undefined}
        />
      </div>

      <div>
        {/* Search + Status Filter Toolbar */}
        <Toolbar attached>
          <SegmentedFilter
            ariaLabel="Filter worklist by status"
            options={WORKLIST_STATUS_FILTERS.map(f => ({ value: f, label: f }))}
            value={worklist.status}
            onChange={worklist.setStatus}
          />
          <ToolbarSpacer />
          <SearchInput
            placeholder="Search patient, test, queue..."
            value={worklist.search}
            onChange={e => worklist.setSearch(e.target.value)}
            containerClassName="w-full sm:w-64"
          />
        </Toolbar>

      {/* Modality Worklist Data Table */}
      <Panel className="overflow-hidden rounded-t-none">
        <PanelBody flush>
          <Table stack>
            <TableHeader sticky>
              <TableRow>
                <TableHead>Queue Ticket</TableHead>
                <TableHead>Patient Name</TableHead>
                <TableHead>Diagnostic Examination</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worklist.worklistError ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-xs text-rose-600 font-semibold">
                    {worklist.worklistError}{' '}
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span>{test.first_name} {test.last_name}</span>
                        {/* The oldest ticket is usually the one to pick up next, and until now
                            this screen gave no indication of age at all. */}
                        <WaitBadge since={test.visit_created_at} />
                      </div>
                      {/* Age and sex, on the screen where findings are recorded.
                          Diagnostic reference ranges are banded by both — a haemoglobin that is
                          normal for a 40-year-old man is anaemia in a child — and the tech had
                          to open a second screen to find out which band applied. The query has
                          returned birthdate and sex all along; nothing rendered them. */}
                      <span className="block text-meta text-gray-400 font-normal">
                        PT-{test.patient_id}
                        {ageFromBirthdate(test.birthdate) !== null && (
                          <> &middot; {ageFromBirthdate(test.birthdate)}y</>
                        )}
                        {test.sex && <> &middot; {test.sex}</>}
                      </span>
                    </TableCell>

                    <TableCell label="Examination" className="py-3.5 text-xs font-bold text-gray-800">
                      {test.test_name}
                      <span className="block text-meta text-gray-400 font-normal">{test.category_name}</span>
                      {/* Who asked for it [1.23.0]. The report goes back to this doctor, and a
                          tech querying an odd result needs to know who to call. */}
                      {test.referring_physician && (
                        <span className="block text-meta font-normal text-brand-700">
                          Ref: {test.referring_physician}
                        </span>
                      )}
                    </TableCell>

                    <TableCell label="Status" className="py-3.5">
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={test.test_status} className="px-2.5 py-0.5" />
                        {/* Phase C finding 05: HMO-approval status wasn't surfaced anywhere on
                            the worklist — a tech had no on-screen signal that an expensive
                            test's authorization was rejected before running it. */}
                        {test.hmo_approval_status && (
                          <span className="flex items-center gap-1 text-meta font-bold text-gray-400">
                            <ShieldCheck className="w-3 h-3" />
                            HMO:&nbsp;<StatusBadge status={test.hmo_approval_status} className="px-1.5 py-0" />
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="py-3.5 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          onClick={() => entry.openFor(test)}
                          variant="outline"
                          size="xs"
                        >
                          <FileText className="h-3 w-3" />
                          <span>{test.test_status === 'Waiting for Release' ? 'Edit Findings' : 'Record Findings'}</span>
                        </Button>
                        {test.test_status === 'Waiting for Release' && (
                          <Button onClick={() => entry.openRelease(test)} size="xs">
                            <Send className="h-3 w-3" />
                            <span>Release Result</span>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={modalityIcon}
                      title={worklist.search || worklist.status !== 'All' ? 'Nothing matches this filter' : `Nothing waiting in ${categoryLabel}`}
                      description={
                        worklist.search || worklist.status !== 'All'
                          ? 'Clear the search box or switch the status filter back to All.'
                          : 'A ticket reaches this worklist once the cashier has taken payment and released the visit to your department.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </PanelBody>
        <Pagination
          page={worklist.worklistPage}
          totalPages={totalPages}
          onPageChange={worklist.setWorklistPage}
          total={filtered.length} pageSize={PAGE_SIZE}
        />
      </Panel>
      </div>
      </>
  );
}
