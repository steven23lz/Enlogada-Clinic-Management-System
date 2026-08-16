import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { usePolling } from '../hooks/usePolling';
import { Button } from '../components/ui/button';
import { Panel, PanelBody } from '../components/ui/panel';
import PageHeader from '../components/ui/page-header';
import Toolbar, { SegmentedFilter, ToolbarSpacer } from '../components/ui/toolbar';
import EmptyState from '../components/ui/empty-state';
import MetricCard from '../components/ui/metric-card';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { SearchInput } from '../components/ui/search-input';
import { StatusBadge } from '../components/ui/status-badge';
import Pagination from '../components/ui/pagination';
import api from '../config/api';
import { toastSuccess, toastError, toastInfo } from '../lib/toast';
import WaitBadge from '../components/ui/wait-badge';
import { SkeletonRows } from '../components/ui/skeleton';
import { useAuth } from '../contexts/AuthContext';
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
  Pencil,
  Printer,
  ShieldCheck,
  CheckCircle2
} from 'lucide-react';

// A ticket only reaches this console once the receptionist/cashier has released it, at which
// point it is already 'Processing'. 'Pending' is therefore not a state this screen can ever
// show — it belongs to the front desk and cashier.
const WORKLIST_STATUS_FILTERS = ['All', 'Processing', 'Waiting for Release'];
const PAGE_SIZE = 10;

const NAV_TO_CATEGORY = {
  'lab-ops': 'Laboratory',
  'lab-history': 'Laboratory',
  'ultrasound-ops': 'Ultrasound',
  'ultrasound-history': 'Ultrasound',
  'xray-ops': 'Xray',
  'xray-history': 'Xray'
};

// UI/UX Phase 4: quick-fill templates were previously all shown to every department
// regardless of relevance (Laboratory staff saw an X-Ray template, etc.) — keyed by category
// so only the templates that department would actually use appear.
const TEMPLATES_BY_CATEGORY = {
  Laboratory: [{ key: 'cbc_normal', label: '+ Normal CBC Template' }],
  Xray: [{ key: 'xray_chest', label: '+ Normal Chest X-Ray' }],
  Ultrasound: [{ key: 'pelvic_us', label: '+ Normal Pelvic Ultrasound' }]
};

// Phase B: mirrors backend/src/config/upload.js's own allowlist/size cap, so a mismatched file
// is rejected instantly instead of round-tripping to the server first.
const ALLOWED_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

const DiagnosticDashboard = ({ activeNav = 'lab-ops', onSelectNav }) => {
  const { user } = useAuth();
  // UI/UX Phase 1: 'worklist' (pending/processing, actionable) vs 'history' (already-released,
  // read-only) — each diagnostic role now has a real second nav destination for the latter,
  // which previously had no UI anywhere (released results just vanished from this screen).
  const mode = activeNav.endsWith('-history') ? 'history' : 'worklist';
  const [pendingTests, setPendingTests] = useState([]);
  const [releasedTests, setReleasedTests] = useState([]);
  const [loading, setLoading] = useState(true);
  // Phase C finding 01: a failed fetch previously looked identical to a genuinely empty
  // worklist (console.error only) — see VISUAL_IDENTITY.md §3b's 5-state pattern.
  const [worklistError, setWorklistError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [viewingResult, setViewingResult] = useState(null);
  const [category, setCategory] = useState('Laboratory');
  const [categoryResolved, setCategoryResolved] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [worklistPage, setWorklistPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  // Result Upload Form State
  const [activeTest, setActiveTest] = useState(null);
  const [findings, setFindings] = useState('');
  const [remarks, setRemarks] = useState('');
  // Phase B: a real uploaded file, replacing the old free-text URL field — see
  // database/migrations.md [1.7.0].
  const [resultFile, setResultFile] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadError, setUploadError] = useState('');
  // UI/UX Modernization Phase 11: shown in place of the upload form immediately after a
  // successful release, so "Print Now" doesn't require navigating away to History and finding
  // this same result again.
  const [justReleased, setJustReleased] = useState(null);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [releasingResult, setReleasingResult] = useState(false);
  const [savingFindings, setSavingFindings] = useState(false);
  // Phase C finding 03: correcting an already-released result — reuses the same modal/upsert
  // path, just pre-filled and opened from the History table instead of the worklist.
  const [isEditingResult, setIsEditingResult] = useState(false);
  // A panic value used to release with the same silent email as a routine result. Flagging it
  // here routes an urgent callback notification to the front desk on release.
  const [isCritical, setIsCritical] = useState(false);
  // Why a released report is being changed. Kept with the superseded version, so the amendment
  // history says what changed and not merely that something did.
  const [amendmentReason, setAmendmentReason] = useState('');
  // Phase C finding 02: past results for this same patient, for context while writing new
  // findings — GET /results/history/:patientId already existed but nothing on this screen
  // called it.
  const [patientHistory, setPatientHistory] = useState([]);
  const [patientHistoryLoading, setPatientHistoryLoading] = useState(false);

  const determineCategory = useCallback((roles) => {
    if (roles.includes('Laboratory Staff')) {
      setCategory('Laboratory');
    } else if (roles.includes('Xray Staff')) {
      setCategory('Xray');
    } else if (roles.includes('Ultrasound Staff')) {
      setCategory('Ultrasound');
    } else {
      setCategory('Laboratory');
    }
  }, []);

  const fetchPendingTests = useCallback(async (catName) => {
    setWorklistError('');
    try {
      // '2D Echo' is a distinct test_categories row, but MODULE_SCOPE.md assigns it to the
      // Ultrasound Staff role — merge both into one worklist for that role only.
      const categoriesToFetch = catName === 'Ultrasound' ? ['Ultrasound', '2D Echo'] : [catName];
      const responses = await Promise.all(categoriesToFetch.map(c => api.get(`/results/pending/${c}`)));
      setPendingTests(responses.flatMap(r => r.data.data.pending || []));
    } catch (err) {
      console.error('Failed to fetch pending diagnostics:', err);
      setWorklistError('Could not load the worklist. Please try again.');
      setPendingTests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchReleasedTests = useCallback(async (catName) => {
    setHistoryError('');
    try {
      const categoriesToFetch = catName === 'Ultrasound' ? ['Ultrasound', '2D Echo'] : [catName];
      const responses = await Promise.all(categoriesToFetch.map(c => api.get(`/results/released/${c}`)));
      setReleasedTests(responses.flatMap(r => r.data.data.released || []));
    } catch (err) {
      console.error('Failed to fetch released diagnostics:', err);
      setHistoryError('Could not load result history. Please try again.');
      setReleasedTests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const navCategory = NAV_TO_CATEGORY[activeNav];
    if (navCategory) {
      setCategory(navCategory);
      setCategoryResolved(true);
    } else if (user && user.roles) {
      determineCategory(user.roles);
      setCategoryResolved(true);
    }
  }, [activeNav, user, determineCategory]);

  // Wait for the real category (from nav or the user's actual role) before fetching at all.
  // Fetching once immediately with the hardcoded default, then again after resolution, is a
  // race: whichever response arrives last wins, and the resolved fetch isn't guaranteed to be
  // the faster of the two — especially now that the Ultrasound worklist fetches two categories.
  // Only fetches whichever list the active mode actually needs.
  useEffect(() => {
    if (category && categoryResolved) {
      setLoading(true);
      if (mode === 'history') {
        fetchReleasedTests(category);
      } else {
        fetchPendingTests(category);
      }
    }
  }, [category, categoryResolved, mode, fetchPendingTests, fetchReleasedTests]);

  // Keep the worklist live. A ticket only reaches a department once the cashier takes payment and
  // the front desk checks the patient in — both of which happen at other terminals, so without
  // this the technician had no way to learn work had arrived except by re-navigating. The wait
  // badges recompute on these re-renders too, which is what makes them usable for triage.
  //
  // Suspended while a modal is open: refetching under an open findings dialog would swap the
  // underlying list while someone is typing into it.
  usePolling(
    () => (mode === 'history' ? fetchReleasedTests(category) : fetchPendingTests(category)),
    30000,
    { enabled: categoryResolved && !!category && !showUploadModal }
  );

  // Reset to page 1 whenever the filtered set could change shape, so a stale page number never
  // points past the end of a newly-filtered/newly-fetched list.
  useEffect(() => {
    setWorklistPage(1);
  }, [category, searchQuery, statusFilter]);

  useEffect(() => {
    setHistoryPage(1);
  }, [category, searchQuery]);

  const handleOpenReleaseConfirm = (test) => {
    setActiveTest(test);
    // Reset the findings-form state: this path releases a ticket directly from the table row,
    // bypassing the upload modal entirely. Without this reset, `findings` could still hold
    // leftover text from a PREVIOUS test's upload-modal session, and confirmReleaseResult's
    // "was something typed but not saved yet" check below would then silently overwrite THIS
    // ticket's already-recorded result with that stale, unrelated text before releasing it.
    setFindings('');
    setRemarks('');
    setResultFile(null);
    setUploadError('');
    setShowReleaseConfirm(true);
  };

  const fetchPatientHistory = useCallback(async (patientId, excludeVisitTestId) => {
    if (!patientId) {
      setPatientHistory([]);
      return;
    }
    setPatientHistoryLoading(true);
    try {
      const res = await api.get(`/results/history/${patientId}`);
      const rows = (res.data.data.results || [])
        .filter(r => r.result_id && r.visit_test_id !== excludeVisitTestId)
        .slice(0, 5);
      setPatientHistory(rows);
    } catch (err) {
      console.error('Failed to fetch patient result history:', err);
      setPatientHistory([]);
    } finally {
      setPatientHistoryLoading(false);
    }
  }, []);

  const handleOpenUploadModal = async (test) => {
    setActiveTest(test);
    setIsEditingResult(false);
    setFindings('');
    setRemarks('');
    setResultFile(null);
    // Never carry a critical flag or an amendment reason over from the previous ticket — a stale
    // flag would raise a false callback, and a stale one cleared would suppress a real one.
    setIsCritical(false);
    setAmendmentReason('');
    setUploadError('');
    setJustReleased(null);
    setShowUploadModal(true);

    // A ticket in 'Waiting for Release' already has findings recorded against it — load them
    // so "Edit Findings" edits rather than silently blanking the previous entry.
    if (test.test_status === 'Waiting for Release') {
      try {
        const res = await api.get(`/results/${test.visit_test_id}`);
        const existing = res.data.data.result;
        if (existing) {
          setFindings(existing.findings || '');
          setRemarks(existing.remarks || '');
        }
      } catch {
        // Non-fatal: the form simply starts empty, exactly as it did before.
      }
    }

    fetchPatientHistory(test.patient_id, test.visit_test_id);
  };

  // Phase C finding 03: opened from the History table's new Edit action — same modal, pre-filled
  // with the existing findings/remarks. Re-submitting reuses the same upsert + release call the
  // original upload used, so a correction also re-notifies the patient by email (deliberate: they
  // should know the result they were sent has since been corrected).
  const handleOpenEditModal = (test) => {
    setActiveTest(test);
    setIsEditingResult(true);
    setFindings(test.findings || '');
    setRemarks(test.result_remarks || '');
    setResultFile(null);
    // Carry the existing critical flag into the amendment: correcting a typo in a panic result
    // must not quietly downgrade it to routine. The reason field starts empty on purpose — it
    // describes THIS change, not the previous one.
    setIsCritical(Boolean(test.is_critical));
    setAmendmentReason('');
    setUploadError('');
    setJustReleased(null);
    setShowUploadModal(true);
    fetchPatientHistory(test.patient_id, test.visit_test_id);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setResultFile(null);
      return;
    }
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setUploadError('Unsupported file type. Only PDF, JPEG, and PNG files are allowed.');
      e.target.value = '';
      setResultFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError('File is too large. Maximum size is 15MB.');
      e.target.value = '';
      setResultFile(null);
      return;
    }
    setUploadError('');
    setResultFile(file);
  };

  const handleApplyTemplate = (templateType) => {
    if (templateType === 'cbc_normal') {
      setFindings(`COMPLETE BLOOD COUNT (CBC) RESULTS:\nHemoglobin: 14.5 g/dL (Normal: 13.0 - 17.5)\nHematocrit: 43.5 % (Normal: 40.0 - 52.0)\nWBC Count: 6.8 x 10^9/L (Normal: 4.5 - 11.0)\nPlatelet Count: 280 x 10^9/L (Normal: 150 - 450)\n\nIMPRESSION:\nNormal Complete Blood Count parameters.`);
    } else if (templateType === 'xray_chest') {
      setFindings(`CHEST X-RAY (PA VIEW) FINDINGS:\n- Lungs are clear with no active infiltrates, mass, or consolidation.\n- Cardiac silhouette and mediastinal contours are within normal limits.\n- Both costophrenic angles and hemidiaphragms are intact.\n- Osseous structures are unremarkable.\n\nIMPRESSION:\nNormal Chest Radiograph.`);
    } else if (templateType === 'pelvic_us') {
      setFindings(`PELVIC ULTRASOUND FINDINGS:\n- Urinary bladder is well-distended with thin smooth walls.\n- Uterus is normal in size and echotexture (5.2 x 4.1 x 3.8 cm).\n- Both ovaries display normal sonographic morphology without cystic or solid masses.\n- No free fluid noted in the cul-de-sac.\n\nIMPRESSION:\nNormal Pelvic Ultrasound Evaluation.`);
    }
  };

  // Shared validation for both exits from the findings form.
  const validateFindingsForm = () => {
    if (!findings) {
      setUploadError('Findings and diagnostic analysis text are required.');
      return false;
    }
    return true;
  };

  const handleUploadResult = async (e) => {
    e.preventDefault();
    setUploadError('');
    if (!validateFindingsForm()) return;
    await handleRecordFindings();
  };

  const handleSaveAndRelease = () => {
    setUploadError('');
    if (!validateFindingsForm()) return;
    // Releasing a diagnostic result is clinically significant and effectively irreversible
    // from this screen — require explicit confirmation before it fires. See .agents Phase 12.
    setShowReleaseConfirm(true);
  };

  // One submit path for both exits from the form. Multipart when a file is attached, plain
  // JSON otherwise — the backend accepts both on the same endpoint (uploadResultFileMiddleware
  // only engages for multipart bodies).
  const submitFindings = async () => {
    // amendmentReason is only meaningful when correcting an already-recorded result; the backend
    // ignores it on a first version. isCritical travels as a string over multipart, which the
    // controller parses explicitly rather than by truthiness.
    if (resultFile) {
      const formData = new FormData();
      formData.append('file', resultFile);
      formData.append('findings', findings);
      formData.append('remarks', remarks);
      formData.append('isCritical', String(isCritical));
      if (isEditingResult) formData.append('amendmentReason', amendmentReason);
      await api.post(`/results/${activeTest.visit_test_id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return;
    }
    await api.post(`/results/${activeTest.visit_test_id}`, {
      findings,
      remarks,
      isCritical,
      ...(isEditingResult ? { amendmentReason } : {}),
    });
  };

  // Recording findings and releasing them are now two distinct events, matching the two
  // distinct ticket states the front desk sees. This call parks the ticket in
  // 'Waiting for Release'; releaseResult below is what actually notifies the patient.
  const handleRecordFindings = async () => {
    setSavingFindings(true);
    setUploadError('');

    try {
      await submitFindings();
      setShowUploadModal(false);
      fetchPendingTests(category);
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Failed to record diagnostic result.');
    } finally {
      setSavingFindings(false);
    }
  };

  const confirmReleaseResult = async () => {
    setReleasingResult(true);
    setUploadError('');

    try {
      // Findings may have been recorded in an earlier session (the ticket is sitting in
      // 'Waiting for Release'), in which case there is nothing new to save — only release.
      if (findings) {
        await submitFindings();
      }

      // The upload call above only records the findings — this is the actual "release" step
      // that notifies the patient by email. It was previously never called from this screen,
      // so "Authorize & Release Result" recorded findings but never released/notified anyone.
      const releaseRes = await api.post(`/results/${activeTest.visit_test_id}/release`);
      const emailStatus = releaseRes.data.data.result?.emailStatus;

      // Previously this always showed a blanket "released and notified" success, even when
      // sendEmail() had actually failed or skipped silently (SMTP unconfigured) — the backend
      // now reports what really happened via emailStatus.
      if (emailStatus === 'sent') {
        toastSuccess('Result released and the patient was notified by email.');
      } else if (emailStatus === 'failed') {
        toastError('Result released — email notification failed, patient was not notified.');
      } else {
        toastInfo('Result released. No email on file, so the patient was not notified.');
      }

      setShowReleaseConfirm(false);
      setJustReleased({
        ...activeTest,
        findings,
        result_remarks: remarks,
        released_at: new Date().toISOString(),
        released_by_first_name: user?.firstName,
        released_by_last_name: user?.lastName
      });
      if (isEditingResult) {
        fetchReleasedTests(category);
      } else {
        fetchPendingTests(category);
      }
    } catch (err) {
      setUploadError(err.response?.data?.message || 'Failed to release diagnostic result.');
      setShowReleaseConfirm(false);
    } finally {
      setReleasingResult(false);
    }
  };

  const filteredTests = pendingTests.filter(t => {
    const matchesSearch = !searchQuery ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.test_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = statusFilter === 'All' || t.test_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredReleased = releasedTests.filter(t => {
    const matchesSearch = !searchQuery ||
      `${t.first_name} ${t.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.test_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.queue_number && t.queue_number.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  const worklistTotalPages = Math.max(1, Math.ceil(filteredTests.length / PAGE_SIZE));
  const pagedTests = filteredTests.slice((worklistPage - 1) * PAGE_SIZE, worklistPage * PAGE_SIZE);
  const historyTotalPages = Math.max(1, Math.ceil(filteredReleased.length / PAGE_SIZE));
  const pagedReleased = filteredReleased.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);

  const categoryLabel = category === 'Ultrasound' ? 'Ultrasound (incl. 2D Echo)' : category;
  // 'Processing' = released to this department, exam not yet done.
  // 'Waiting for Release' = exam done and findings recorded, awaiting authorisation.
  const processingCount = pendingTests.filter(t => t.test_status === 'Processing').length;
  const awaitingReleaseCount = pendingTests.filter(t => t.test_status === 'Waiting for Release').length;
  const pageTitle = mode === 'history' ? `${categoryLabel} Result History` : `${categoryLabel} Operations Worklist`;
  const modalityIcon = category === 'Ultrasound' ? Stethoscope : category === 'Xray' ? Scan : FlaskConical;

  return (
    <SidebarLayout title={pageTitle} activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-5">
        <PageHeader
          icon={modalityIcon}
          title={pageTitle}
          description={
            mode === 'history'
              ? `Every ${categoryLabel} result this department has released, including amended versions.`
              : `Patients whose ${categoryLabel} exam has been paid for and released to this department. Record findings, then authorise the release of the report.`
          }
        />

        {mode === 'worklist' && (
        <>
        {/* Department Modality Worklist Header Cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard
            label="Active Modality"
            value={categoryLabel}
            caption="Your department"
            captionTone="slate"
            icon={modalityIcon}
            tone="green"
          />
          <MetricCard label="Awaiting Exam" value={processingCount} caption="Paid and released to you" captionTone="slate" icon={Clock} tone="indigo" />
          <MetricCard label="Awaiting Release" value={awaitingReleaseCount} caption="Findings recorded, not authorised" captionTone="slate" icon={FileText} tone="amber" />
        </div>

        <div>
          {/* Search + Status Filter Toolbar */}
          <Toolbar attached>
            <SegmentedFilter
              ariaLabel="Filter worklist by status"
              options={WORKLIST_STATUS_FILTERS.map(f => ({ value: f, label: f }))}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <ToolbarSpacer />
            <SearchInput
              placeholder="Search patient, test, queue..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              containerClassName="w-full sm:w-64"
            />
          </Toolbar>

        {/* Modality Worklist Data Table */}
        <Panel className="overflow-hidden rounded-t-none">
          <PanelBody flush>
            <Table>
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
                {worklistError ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-xs text-rose-600 font-semibold">
                      {worklistError}{' '}
                      <button
                        type="button"
                        onClick={() => fetchPendingTests(category)}
                        className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                      >
                        Retry
                      </button>
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  <SkeletonRows rows={5} columns={5} />
                ) : pagedTests.length > 0 ? (
                  pagedTests.map(test => (
                    <TableRow key={test.visit_test_id} className="hover:bg-slate-50/70 transition-colors">
                      <TableCell className="py-3.5">
                        <span className="font-extrabold text-xs text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                          {test.queue_number || `VT-${test.visit_test_id}`}
                        </span>
                      </TableCell>

                      <TableCell className="py-3.5 font-bold text-xs text-slate-900">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span>{test.first_name} {test.last_name}</span>
                          {/* The oldest ticket is usually the one to pick up next, and until now
                              this screen gave no indication of age at all. */}
                          <WaitBadge since={test.visit_created_at} />
                        </div>
                        <span className="block text-meta text-gray-400 font-normal">PT-{test.patient_id}</span>
                      </TableCell>

                      <TableCell className="py-3.5 text-xs font-bold text-gray-800">
                        {test.test_name}
                        <span className="block text-meta text-gray-400 font-normal">{test.category_name}</span>
                      </TableCell>

                      <TableCell className="py-3.5">
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
                            onClick={() => handleOpenUploadModal(test)}
                            variant="outline"
                            size="xs"
                          >
                            <FileText className="h-3 w-3" />
                            <span>{test.test_status === 'Waiting for Release' ? 'Edit Findings' : 'Record Findings'}</span>
                          </Button>
                          {test.test_status === 'Waiting for Release' && (
                            <Button onClick={() => handleOpenReleaseConfirm(test)} size="xs">
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
                        title={searchQuery || statusFilter !== 'All' ? 'Nothing matches this filter' : `Nothing waiting in ${categoryLabel}`}
                        description={
                          searchQuery || statusFilter !== 'All'
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
            page={worklistPage}
            totalPages={worklistTotalPages}
            onPageChange={setWorklistPage}
            totalLabel={`${filteredTests.length} total`}
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
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              containerClassName="w-full sm:w-64"
            />
          </Toolbar>

        {/* Released Results Table (read-only) */}
        <Panel className="overflow-hidden rounded-t-none">
          <PanelBody flush>
            <Table>
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
                {historyError ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-xs text-rose-600 font-semibold">
                      {historyError}{' '}
                      <button
                        type="button"
                        onClick={() => fetchReleasedTests(category)}
                        className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                      >
                        Retry
                      </button>
                    </TableCell>
                  </TableRow>
                ) : loading ? (
                  <SkeletonRows rows={5} columns={5} />
                ) : pagedReleased.length > 0 ? (
                  pagedReleased.map(test => (
                    <TableRow key={test.visit_test_id} className="hover:bg-slate-50/70 transition-colors">
                      <TableCell className="py-3.5">
                        <span className="font-extrabold text-xs text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                          {test.queue_number || `VT-${test.visit_test_id}`}
                        </span>
                      </TableCell>

                      <TableCell className="py-3.5 font-bold text-xs text-slate-900">
                        {test.first_name} {test.last_name}
                      </TableCell>

                      <TableCell className="py-3.5 text-xs font-bold text-gray-800">
                        {test.test_name}
                        <span className="block text-meta text-gray-400 font-normal">{test.category_name}</span>
                      </TableCell>

                      <TableCell className="py-3.5 text-xs text-gray-500">
                        {test.released_at ? new Date(test.released_at).toLocaleString() : '—'}
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
                            onClick={() => handleOpenEditModal(test)}
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
                        title={searchQuery ? 'Nothing matches that search' : `No released ${categoryLabel} results yet`}
                        description={
                          searchQuery
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
            page={historyPage}
            totalPages={historyTotalPages}
            onPageChange={setHistoryPage}
            totalLabel={`${filteredReleased.length} total`}
          />
        </Panel>
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
              <div className="text-fine text-gray-400">
                Released {viewingResult?.released_at ? new Date(viewingResult.released_at).toLocaleString() : '—'}
                {viewingResult?.released_by_first_name && ` by ${viewingResult.released_by_first_name} ${viewingResult.released_by_last_name}`}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-[#e6ebf1]">
              <Button
                onClick={() => window.print()}
                variant="outline"
                className="text-xs font-bold flex items-center space-x-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Report</span>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Record Diagnostic Findings & Result Entry Modal */}
        <Dialog
          open={showUploadModal}
          onOpenChange={(open) => {
            setShowUploadModal(open);
            if (!open) setJustReleased(null);
          }}
        >
          <DialogContent className="max-w-2xl">
            {justReleased ? (
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
                    Patient: <strong>{justReleased.first_name} {justReleased.last_name}</strong> &bull; Examination: <strong>{justReleased.test_name}</strong>
                  </p>
                  <div className="space-y-1">
                    <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Findings</span>
                    <p className="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 m-0">{justReleased.findings || '—'}</p>
                  </div>
                  {justReleased.result_remarks && (
                    <div className="space-y-1">
                      <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Remarks</span>
                      <p className="text-xs m-0">{justReleased.result_remarks}</p>
                    </div>
                  )}
                  <p className="text-fine text-gray-400 m-0 pt-2 border-t border-[#e6ebf1]">
                    Released {new Date(justReleased.released_at).toLocaleString()}
                    {justReleased.released_by_first_name && ` by ${justReleased.released_by_first_name} ${justReleased.released_by_last_name}`}
                  </p>
                </div>

                <div className="flex justify-end space-x-2">
                  <Button type="button" variant="outline" onClick={() => window.print()} className="text-xs font-bold flex items-center space-x-1.5">
                    <Printer className="w-3.5 h-3.5" />
                    <span>Print Now</span>
                  </Button>
                  <Button
                    type="button"
                    onClick={() => { setShowUploadModal(false); setJustReleased(null); }}
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
                {isEditingResult ? 'Correct Released Result' : 'Record Findings & Release Diagnostic Certificate'}
              </DialogTitle>
              <DialogDescription>
                Patient: <strong>{activeTest?.first_name} {activeTest?.last_name}</strong> &bull; Examination: <strong>{activeTest?.test_name}</strong>
                {isEditingResult && ' — re-submitting will notify the patient again by email.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleUploadResult} className="space-y-4 pt-2">
              {uploadError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Phase C finding 02: past results for this same patient, surfaced at the point
                  of writing new findings — GET /results/history/:patientId already existed but
                  nothing on this screen ever called it. */}
              {(patientHistoryLoading || patientHistory.length > 0) && (
                <div className="space-y-1.5">
                  <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Past Results for This Patient</span>
                  {patientHistoryLoading ? (
                    <p className="text-fine text-gray-400 m-0">Loading history…</p>
                  ) : (
                    <div className="border border-gray-200 rounded-xl divide-y divide-[#eef2f6] max-h-32 overflow-y-auto">
                      {patientHistory.map(h => (
                        <div key={h.visit_test_id} className="px-3 py-2 flex items-center justify-between gap-2 text-fine">
                          <span className="font-semibold text-gray-700 truncate">{h.category_name} &middot; {h.test_name}</span>
                          <span className="text-gray-400 whitespace-nowrap">{new Date(h.visit_date).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Quick Template Generator Buttons — scoped to this department's category */}
              {TEMPLATES_BY_CATEGORY[category]?.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-meta font-bold text-gray-500 uppercase tracking-wider block">Clinical Report Templates</span>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATES_BY_CATEGORY[category].map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => handleApplyTemplate(t.key)}
                        className="text-fine font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="field-label">Findings & Impression (Required)</label>
                <textarea
                  rows={6}
                  placeholder="Enter detailed laboratory/imaging findings, measurements, and impression..."
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="field-label">Remarks / Recommendations (Optional)</label>
                <Input
                  placeholder="e.g. Clinical correlation recommended..."
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  className="text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="field-label">Attach Report File (Optional)</label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-brand-50 file:text-brand-600 hover:file:bg-brand-100 file:cursor-pointer cursor-pointer"
                />
                <p className="text-fine text-gray-400 m-0">
                  PDF, JPEG, or PNG — up to 15MB.
                  {isEditingResult && (activeTest?.file_path || activeTest?.file_url) && !resultFile && ' A file is already attached — leave blank to keep it, or attach a new one to replace it.'}
                </p>
                {resultFile && (
                  <p className="text-fine font-semibold text-slate-700 m-0">{resultFile.name} ({(resultFile.size / 1024).toFixed(0)} KB)</p>
                )}
              </div>

              {/* Why a released report is being changed. Required on an amendment because the
                  audit entry is otherwise "something changed" and nothing more — the superseded
                  version is kept, but without a reason nobody can tell why it was replaced. */}
              {isEditingResult && (
                <div className="space-y-1.5">
                  <label htmlFor="amendment-reason" className="field-label">
                    Reason for Amendment <span className="text-rose-600">*</span>
                  </label>
                  <Input
                    id="amendment-reason"
                    placeholder="e.g. Transcription error in the original report"
                    value={amendmentReason}
                    onChange={e => setAmendmentReason(e.target.value)}
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
                  isCritical ? 'bg-rose-50 border-rose-300' : 'bg-slate-50/80 border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isCritical}
                  onChange={e => setIsCritical(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-rose-600 cursor-pointer flex-shrink-0"
                />
                <span className="space-y-0.5">
                  <span className={`block text-xs font-bold ${isCritical ? 'text-rose-700' : 'text-gray-700'}`}>
                    Flag as a CRITICAL result requiring patient callback
                  </span>
                  <span className="block text-fine text-gray-500">
                    Alerts the front desk and administrators to telephone the patient, and replaces
                    the routine &quot;results are ready&quot; email with one asking them to contact the clinic.
                  </span>
                </span>
              </label>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                <Button type="button" variant="outline" onClick={() => setShowUploadModal(false)}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={savingFindings || (isEditingResult && !amendmentReason.trim())}
                  variant="outline"
                  className="font-bold text-xs px-5 py-2 rounded-xl border-gray-200 flex items-center space-x-1.5"
                >
                  <FileText className="w-4 h-4" />
                  <span>{savingFindings ? 'Saving…' : 'Save Findings'}</span>
                </Button>
                <Button
                  type="button"
                  onClick={handleSaveAndRelease}
                  className="font-bold text-xs px-5 py-2 rounded-xl flex items-center space-x-1.5"
                >
                  <Send className="w-4 h-4" />
                  <span>{isEditingResult ? 'Save Correction & Re-notify' : 'Authorize & Release Result'}</span>
                </Button>
              </div>
            </form>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* Result release confirmation — irreversible/clinically significant, see .agents Phase 12 */}
        <ConfirmDialog
          open={showReleaseConfirm}
          onOpenChange={setShowReleaseConfirm}
          title={isEditingResult ? 'Save Correction' : 'Authorize & Release Result'}
          description={activeTest ? (
            isEditingResult
              ? `Save the corrected ${activeTest.test_name} findings for ${activeTest.first_name} ${activeTest.last_name}? The patient will receive a new "results ready" email.`
              : `Release ${activeTest.test_name} findings for ${activeTest.first_name} ${activeTest.last_name}? This finalizes the result and cannot be undone from this screen.`
          ) : ''}
          confirmLabel={isEditingResult ? 'Save Correction' : 'Authorize & Release'}
          onConfirm={confirmReleaseResult}
          loading={releasingResult}
          error={uploadError}
        />

      </div>
    </SidebarLayout>
  );
};

export default DiagnosticDashboard;
