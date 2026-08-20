import React, { useState } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { Button } from '../../components/ui/button';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { SegmentedFilter, ToolbarSpacer } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import MetricCard from '../../components/ui/metric-card';
import { Input } from '../../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { SearchInput } from '../../components/ui/search-input';
import { StatusBadge } from '../../components/ui/status-badge';
import Pagination from '../../components/ui/pagination';
import { ageFromBirthdate, formatDateTime } from '../../lib/date';
import WaitBadge from '../../components/ui/wait-badge';
import { SkeletonRows } from '../../components/ui/skeleton';
import { useAuth } from '../../contexts/AuthContext';
import ResultDocument from '../../components/ResultDocument';
import useOperationsReport from '../../hooks/useOperationsReport';
import { TurnaroundPanel } from '../../components/reports/OperationsPanels';
import { useDiagnosticWorklist } from '../../hooks/useDiagnosticWorklist';
import { useCriticalCallbacks } from '../../hooks/useCriticalCallbacks';
import { useResultEntry } from '../../hooks/useResultEntry';
import { usePatientResultHistory } from '../../hooks/usePatientResultHistory';
import { TEMPLATES_BY_CATEGORY } from '../../lib/resultTemplates';
import {
  Stethoscope,
  FlaskConical,
  Scan,
  FileText,
  Send,
  Clock,
  AlertCircle,
  History,
  Eye,
  Paperclip,
  Pencil,
  Printer,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  PhoneCall
} from 'lucide-react';

// A ticket only reaches this console once the receptionist/cashier has released it, at which
// point it is already 'Processing'. 'Pending' is therefore not a state this screen can ever
// show — it belongs to the front desk and cashier.
const WORKLIST_STATUS_FILTERS = ['All', 'Processing', 'Waiting for Release'];
const PAGE_SIZE = 10;


// Phase B: mirrors backend/src/config/upload.js's own allowlist/size cap, so a mismatched file
// is rejected instantly instead of round-tripping to the server first.

const DiagnosticDashboard = ({ activeNav = 'lab-ops', onSelectNav }) => {
  const { user } = useAuth();
  // UI/UX Phase 1: 'worklist' (pending/processing, actionable) vs 'history' (already-released,
  // read-only) — each diagnostic role now has a real second nav destination for the latter,
  // which previously had no UI anywhere (released results just vanished from this screen).
  const mode = activeNav.endsWith('-history') ? 'history' : 'worklist';
  // How this department is actually performing, on the History screen where someone is looking
  // back rather than working the queue. Department-scoped server-side, so a lab account sees
  // Laboratory turnaround and nobody else's.
  const operations = useOperationsReport({ days: 7, enabled: mode === 'history' });
  const [viewingResult, setViewingResult] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);

  const patientHistory = usePatientResultHistory();

  const entry = useResultEntry({
    user,
    // Context for whoever is writing: what this patient's previous reports said.
    onOpened: (test) => patientHistory.loadFor(test.patient_id, test.visit_test_id),
    // Both outcomes re-read whichever list this console is showing. Recording happens from the
    // worklist and amending from History, so "the current mode's list" is always the right one.
    onRecorded: () => worklist.refresh(),
    onReleased: () => worklist.refresh(),
  });

  // Declared after `entry` because it reads it: polling is suspended while the findings dialog
  // is open, so a refetch cannot swap the list out from under someone typing into it.
  const worklist = useDiagnosticWorklist({
    activeNav,
    roles: user?.roles,
    mode,
    paused: entry.open,
  });

  const criticals = useCriticalCallbacks({ enabled: mode === 'worklist', paused: entry.open });

  const filteredTests = worklist.pending.filter(t => {
    const matchesSearch = !worklist.search ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(worklist.search.toLowerCase()) ||
      t.test_name.toLowerCase().includes(worklist.search.toLowerCase()) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(worklist.search.toLowerCase()));
    const matchesStatus = worklist.status === 'All' || t.test_status === worklist.status;
    return matchesSearch && matchesStatus;
  });

  const filteredReleased = worklist.released.filter(t => {
    const matchesSearch = !worklist.search ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(worklist.search.toLowerCase()) ||
      t.test_name.toLowerCase().includes(worklist.search.toLowerCase()) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(worklist.search.toLowerCase()));
    return matchesSearch;
  });

  const worklistTotalPages = Math.max(1, Math.ceil(filteredTests.length / PAGE_SIZE));
  const pagedTests = filteredTests.slice((worklist.worklistPage - 1) * PAGE_SIZE, worklist.worklistPage * PAGE_SIZE);
  const historyTotalPages = Math.max(1, Math.ceil(filteredReleased.length / PAGE_SIZE));
  const pagedReleased = filteredReleased.slice((worklist.historyPage - 1) * PAGE_SIZE, worklist.historyPage * PAGE_SIZE);

  // Display name, not the database name. `test_categories.name` is 'Xray' — a perfectly good
  // identifier and not how anyone writes it, so every heading on this console read "Xray
  // Operations Worklist". The value itself stays untouched: it is the join key for the worklist
  // queries and the department scope, and renaming it in the database to fix a caption would be
  // the wrong end of the problem.
  const CATEGORY_LABELS = { Xray: 'X-Ray', Ultrasound: 'Ultrasound (incl. 2D Echo)' };
  const categoryLabel = CATEGORY_LABELS[worklist.category] || worklist.category;
  // 'Processing' = released to this department, exam not yet done.
  // 'Waiting for Release' = exam done and entry.findings recorded, awaiting authorisation.
  const processingCount = worklist.pending.filter(t => t.test_status === 'Processing').length;
  const awaitingReleaseCount = worklist.pending.filter(t => t.test_status === 'Waiting for Release').length;
  const pageTitle = mode === 'history' ? `${categoryLabel} Result History` : `${categoryLabel} Operations Worklist`;
  const modalityIcon = worklist.category === 'Ultrasound' ? Stethoscope : worklist.category === 'Xray' ? Scan : FlaskConical;

  return (
    <SidebarLayout title={pageTitle} activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={modalityIcon}
          title={pageTitle}
          description={
            mode === 'history'
              ? `Every ${categoryLabel} result this department has released, including amended versions.`
              : `Patients whose ${categoryLabel} exam has been paid for and released to this department. Record entry.findings, then authorise the release of the report.`
          }
        />

        {mode === 'worklist' && (
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
                ) : pagedTests.length > 0 ? (
                  pagedTests.map(test => (
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
                        {/* Age and sex, on the screen where entry.findings are recorded.
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
            totalPages={worklistTotalPages}
            onPageChange={worklist.setWorklistPage}
            total={filteredTests.length} pageSize={PAGE_SIZE}
          />
        </Panel>
        </div>
        </>
        )}

        {mode === 'history' && (
        <>
        <div>
          {/* Search Bar */}
          <Toolbar attached>
            <span className="text-fine font-medium tabular-nums text-slate-500">
              {filteredReleased.length} released result{filteredReleased.length === 1 ? '' : 's'}
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
                ) : pagedReleased.length > 0 ? (
                  pagedReleased.map(test => (
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
                            onClick={() => setViewingResult(test)}
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
            totalPages={historyTotalPages}
            onPageChange={worklist.setHistoryPage}
            total={filteredReleased.length} pageSize={PAGE_SIZE}
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
        )}

        {/* Read-only Released Result Viewer */}
        <Dialog open={!!viewingResult} onOpenChange={(open) => { if (!open) setViewingResult(null); }}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">Diagnostic Report</DialogTitle>
              <DialogDescription>
                Patient: <strong>{viewingResult?.first_name} {viewingResult?.last_name}</strong> &bull; Examination: <strong>{viewingResult?.test_name}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="print-area space-y-4">
              <div className="space-y-1.5">
                <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Findings &amp; Impression</span>
                <p className="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 m-0">{viewingResult?.findings || '—'}</p>
              </div>
              {viewingResult?.result_remarks && (
                <div className="space-y-1.5">
                  <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Remarks</span>
                  <p className="text-xs m-0">{viewingResult.result_remarks}</p>
                </div>
              )}
              {/* The attachment. This screen showed the entry.findings text and nothing about the file
                  the modality actually uploaded, so verifying that the right scan went to the
                  right patient meant downloading it from somewhere else. */}
              {viewingResult?.file_path && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-fine text-slate-600">
                    <Paperclip className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                    <span className="truncate">{viewingResult.file_original_name || 'Attached report'}</span>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setPreviewDoc({
                      visitTestId: viewingResult.visit_test_id,
                      testName: viewingResult.test_name,
                      patientName: `${viewingResult.first_name} ${viewingResult.last_name}`,
                      fileName: viewingResult.file_original_name,
                    })}
                  >
                    <Eye className="h-3 w-3" />
                    View Attachment
                  </Button>
                </div>
              )}
              <div className="text-fine text-gray-400">
                Released {viewingResult?.released_at ? formatDateTime(viewingResult.released_at) : '—'}
                {viewingResult?.released_by_first_name && ` by ${viewingResult.released_by_first_name} ${viewingResult.released_by_last_name}`}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-[#e6ebf1]">
              <Button onClick={() => window.print()} variant="outline">
                <Printer className="h-3.5 w-3.5" />
                Print Report
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Record Diagnostic Findings & Result Entry Modal */}
        <Dialog
          open={entry.open}
          onOpenChange={(next) => { if (!next) entry.close(); }}
        >
          <DialogContent className="max-w-2xl">
            {entry.justReleased ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm font-bold">Result released successfully.</span>
                </div>

                <div className="print-area space-y-3 bg-white rounded-2xl border border-[#e6ebf1] p-5">
                  <div className="text-center border-b border-[#e6ebf1] pb-3 space-y-0.5">
                    <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide m-0">Enlogada Ultrasound &amp; Diagnostic Clinic</h3>
                    <p className="text-xs text-gray-500 m-0">Diagnostic Result Certificate</p>
                  </div>
                  <p className="text-xs m-0">
                    Patient: <strong>{entry.justReleased.first_name} {entry.justReleased.last_name}</strong> &bull; Examination: <strong>{entry.justReleased.test_name}</strong>
                  </p>
                  <div className="space-y-1">
                    <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Findings</span>
                    <p className="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 m-0">{entry.justReleased.findings || '—'}</p>
                  </div>
                  {entry.justReleased.result_remarks && (
                    <div className="space-y-1">
                      <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Remarks</span>
                      <p className="text-xs m-0">{entry.justReleased.result_remarks}</p>
                    </div>
                  )}
                  <p className="text-fine text-gray-400 m-0 pt-2 border-t border-[#e6ebf1]">
                    Released {formatDateTime(entry.justReleased.released_at)}
                    {entry.justReleased.released_by_first_name && ` by ${entry.justReleased.released_by_first_name} ${entry.justReleased.released_by_last_name}`}
                  </p>
                </div>

                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => window.print()} className="text-xs font-bold flex items-center space-x-1.5">
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Now</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={entry.close}
                    className="text-xs font-bold"
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">
                {entry.isEditing ? 'Correct Released Result' : 'Record Findings & Release Diagnostic Certificate'}
              </DialogTitle>
              <DialogDescription>
                Patient: <strong>{entry.activeTest?.first_name} {entry.activeTest?.last_name}</strong> &bull; Examination: <strong>{entry.activeTest?.test_name}</strong>
                {entry.isEditing && ' — re-submitting will notify the patient again by email.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={entry.record} className="space-y-4 pt-2">
              {entry.error && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{entry.error}</span>
                </div>
              )}

              {/* Phase C finding 02: past results for this same patient, surfaced at the point
                  of writing new entry.findings — GET /results/history/:patientId already existed but
                  nothing on this screen ever called it. */}
              {(patientHistory.loading || patientHistory.results.length > 0) && (
                <div className="space-y-1.5">
                  <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Past Results for This Patient</span>
                  {patientHistory.loading ? (
                    <p className="text-fine text-gray-400 m-0">Loading history…</p>
                  ) : (
                    <div className="border border-gray-200 rounded-xl divide-y divide-[#eef2f6] max-h-32 overflow-y-auto">
                      {patientHistory.results.map(h => (
                        <div key={h.visit_test_id} className="px-3 py-2 flex items-center justify-between gap-2 text-fine">
                          <span className="font-semibold text-gray-700 truncate">{h.category_name} &middot; {h.test_name}</span>
                          <span className="text-gray-400 whitespace-nowrap">{new Date(h.visit_date).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Template Generator Buttons — scoped to this department's worklist.category */}
              {TEMPLATES_BY_CATEGORY[worklist.category]?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Clinical Report Templates</span>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATES_BY_CATEGORY[worklist.category].map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => entry.applyTemplate(t.key)}
                        className="text-fine font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="diagnosticdashboard-findings-impression-required" className="field-label">Findings & Impression (Required)</label>
                <textarea id="diagnosticdashboard-findings-impression-required"
                  rows={6}
                  placeholder="Enter detailed laboratory/imaging findings, measurements, and impression..."
                  value={entry.findings}
                  onChange={e => entry.setFindings(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="diagnosticdashboard-remarks-recommendations-optional" className="field-label">Remarks / Recommendations (Optional)</label>
                <Input id="diagnosticdashboard-remarks-recommendations-optional"
                  placeholder="e.g. Clinical correlation recommended..."
                  value={entry.remarks}
                  onChange={e => entry.setRemarks(e.target.value)}
                  className="text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="diagnosticdashboard-attach-report-file-optional" className="field-label">Attach Report File (Optional)</label>
                <input id="diagnosticdashboard-attach-report-file-optional"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={entry.chooseFile}
                  className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 file:cursor-pointer cursor-pointer"
                />
                <p className="text-fine text-gray-400 m-0">
                  PDF, JPEG, or PNG — up to 15MB.
                  {entry.isEditing && (entry.activeTest?.file_path || entry.activeTest?.file_url) && !entry.resultFile && ' A file is already attached — leave blank to keep it, or attach a new one to replace it.'}
                </p>
                {entry.resultFile && (
                  <p className="text-fine font-semibold text-slate-700 m-0">{entry.resultFile.name} ({(entry.resultFile.size / 1024).toFixed(0)} KB)</p>
                )}
              </div>

              {/* Why a released report is being changed. Required on an amendment because the
                  audit entry is otherwise "something changed" and nothing more — the superseded
                  version is kept, but without a reason nobody can tell why it was replaced. */}
              {entry.isAmendingReleased && (
                <div className="space-y-1.5">
                  <label htmlFor="amendment-reason" className="field-label">
                    Reason for Amendment <span className="text-rose-600">*</span>
                  </label>
                  <Input
                    id="amendment-reason"
                    placeholder="e.g. Transcription error in the original report"
                    value={entry.amendmentReason}
                    onChange={e => entry.setAmendmentReason(e.target.value)}
                    className="text-xs rounded-xl"
                  />
                  <p className="text-fine text-gray-400 m-0">
                    The previous version is kept and stays readable in this test&apos;s history — it is
                    superseded, not overwritten. The patient is told their report was updated.
                  </p>
                </div>
              )}

              {/* Critical value. Deliberately styled as a warning rather than a quiet checkbox:
                  flagging it is what triggers the callback, and missing it is the most dangerous
                  thing that can happen on this screen. */}
              <label
                className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors ${
                  entry.isCritical ? 'bg-rose-50 border-rose-300' : 'bg-slate-50/80 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={entry.isCritical}
                  onChange={e => entry.setIsCritical(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-rose-600 cursor-pointer flex-shrink-0"
                />
                <span className="space-y-0.5">
                  <span className={`block text-xs font-bold ${entry.isCritical ? 'text-rose-700' : 'text-gray-700'}`}>
                    Flag as a CRITICAL result requiring patient callback
                  </span>
                  <span className="block text-fine text-gray-500">
                    Alerts the front desk and administrators to telephone the patient, and replaces
                    the routine &quot;results are ready&quot; email with one asking them to contact the clinic.
                  </span>
                </span>
              </label>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                <Button type="button" variant="outline" onClick={entry.close}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={entry.saving || (entry.isAmendingReleased && entry.amendmentReason.trim().length < 4)}
                  variant="outline"
                  className="font-bold text-xs px-5 py-2 rounded-xl border-gray-200 flex items-center space-x-1.5"
                >
                  <FileText className="w-4 h-4" />
                  <span>{entry.saving ? 'Saving…' : 'Save Findings'}</span>
                </Button>
                <Button
                  type="button"
                  onClick={entry.requestRelease}
                  className="font-bold text-xs px-5 py-2 rounded-xl flex items-center space-x-1.5"
                >
                  <Send className="w-4 h-4" />
                  <span>{entry.isEditing ? 'Save Correction & Re-notify' : 'Authorize & Release Result'}</span>
                </Button>
              </div>
            </form>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Result release confirmation — irreversible/clinically significant, see .agents Phase 12 */}
        <ConfirmDialog
          open={entry.confirmingRelease}
          onOpenChange={(next) => { if (!next) entry.dismissReleaseConfirm(); }}
          title={entry.isEditing ? 'Save Correction' : 'Authorize & Release Result'}
          description={entry.activeTest ? (
            entry.isEditing
              ? `Save the corrected ${entry.activeTest.test_name} entry.findings for ${entry.activeTest.first_name} ${entry.activeTest.last_name}? The patient will receive a new "results ready" email.`
              : `Release ${entry.activeTest.test_name} entry.findings for ${entry.activeTest.first_name} ${entry.activeTest.last_name}? This finalizes the result and cannot be undone from this screen.`
          ) : ''}
          confirmLabel={entry.isEditing ? 'Save Correction' : 'Authorize & Release'}
          onConfirm={entry.release}
          loading={entry.releasing}
          error={entry.error}
        />

      </div>
      <ResultDocument
        open={Boolean(previewDoc)}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        visitTestId={previewDoc?.visitTestId}
        testName={previewDoc?.testName}
        patientName={previewDoc?.patientName}
        fileName={previewDoc?.fileName}
      />

      {/* Who still has to be telephoned. [1.28.0]
          The endpoint existed with nothing reading it; before that, the only sign of a panic
          value anywhere was a badge on one department's worklist row. Oldest first, because the
          age of an un-made call is the whole severity of it — and the number is shown in the
          open rather than behind a hover, since the reason this fails is people not looking. */}
      <Dialog open={criticals.expanded} onOpenChange={criticals.setExpanded}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Critical results awaiting a callback</DialogTitle>
            <DialogDescription>
              Released with a panic value and not yet confirmed as communicated. Telephone the
              patient, then record the call — whoever makes it, from any department.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {criticals.outstanding.map((c) => (
              <div
                key={c.visit_test_id}
                className="rounded-xl border border-rose-200 bg-rose-50/60 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="m-0 text-[13px] font-bold text-slate-900">
                      {c.first_name} {c.last_name}
                    </p>
                    <p className="m-0 text-fine text-slate-600">
                      {c.test_name} &bull; released {c.released_at ? formatDateTime(c.released_at) : '—'}
                    </p>
                  </div>
                  {/* The number is the point of the row: it is what the person acts on. */}
                  {c.contact_number && (
                    <a
                      href={`tel:${c.contact_number}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-fine font-bold text-white no-underline hover:bg-rose-700"
                    >
                      <PhoneCall className="h-3.5 w-3.5" />
                      {c.contact_number}
                    </a>
                  )}
                </div>
                {c.findings && (
                  <p className="m-0 mt-1.5 line-clamp-2 text-fine text-slate-700">{c.findings}</p>
                )}
                {!c.contact_number && (
                  <p className="m-0 mt-1.5 text-fine font-semibold text-rose-700">
                    No contact number on file — check the visit record.
                  </p>
                )}
              </div>
            ))}
            {criticals.outstanding.length === 0 && (
              <EmptyState
                icon={CheckCircle2}
                title="Every critical result has been called through"
                description="Nothing is waiting on a phone call."
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </SidebarLayout>
  );
};

export default DiagnosticDashboard;
