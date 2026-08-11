import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
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
import { useAuth } from '../contexts/AuthContext';
import {
  Stethoscope,
  FlaskConical,
  Scan,
  Play,
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

const WORKLIST_STATUS_FILTERS = ['All', 'Pending', 'Processing'];
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
  // Phase C finding 03: correcting an already-released result — reuses the same modal/upsert
  // path, just pre-filled and opened from the History table instead of the worklist.
  const [isEditingResult, setIsEditingResult] = useState(false);
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

  // Reset to page 1 whenever the filtered set could change shape, so a stale page number never
  // points past the end of a newly-filtered/newly-fetched list.
  useEffect(() => {
    setWorklistPage(1);
  }, [category, searchQuery, statusFilter]);

  useEffect(() => {
    setHistoryPage(1);
  }, [category, searchQuery]);

  const handleStartProcessing = async (visitTestId) => {
    try {
      await api.patch(`/results/test-status/${visitTestId}`, { status: 'Processing' });
      fetchPendingTests(category);
    } catch (err) {
      console.error(err);
      toastError('Failed to update test status to Processing.');
    }
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

  const handleOpenUploadModal = (test) => {
    setActiveTest(test);
    setIsEditingResult(false);
    setFindings('');
    setRemarks('');
    setResultFile(null);
    setUploadError('');
    setJustReleased(null);
    setShowUploadModal(true);
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

  const handleUploadResult = async (e) => {
    e.preventDefault();
    setUploadError('');

    if (!findings) {
      setUploadError('Findings and diagnostic analysis text are required.');
      return;
    }

    // Releasing a diagnostic result is clinically significant and effectively irreversible
    // from this screen — require explicit confirmation before it fires. See .agents Phase 12.
    setShowReleaseConfirm(true);
  };

  const confirmReleaseResult = async () => {
    setReleasingResult(true);
    setUploadError('');

    try {
      // Multipart when a file is attached (Phase B), plain JSON otherwise — the backend accepts
      // both on the same endpoint (uploadResultFileMiddleware only engages for multipart bodies).
      if (resultFile) {
        const formData = new FormData();
        formData.append('file', resultFile);
        formData.append('findings', findings);
        formData.append('remarks', remarks);
        await api.post(`/results/${activeTest.visit_test_id}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        await api.post(`/results/${activeTest.visit_test_id}`, { findings, remarks });
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
      setUploadError(err.response?.data?.message || 'Failed to record diagnostic result.');
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

  const pendingCount = pendingTests.filter(t => t.test_status === 'Pending').length;
  const categoryLabel = category === 'Ultrasound' ? 'Ultrasound (incl. 2D Echo)' : category;
  const processingCount = pendingTests.filter(t => t.test_status === 'Processing').length;
  const pageTitle = mode === 'history' ? `${categoryLabel} Result History` : `${categoryLabel} Operations Worklist`;

  return (
    <SidebarLayout title={pageTitle} activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">

        {mode === 'worklist' && (
        <>
        {/* Department Modality Worklist Header Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            label="Active Modality"
            value={`${categoryLabel} Department`}
            icon={category === 'Ultrasound' ? Stethoscope : category === 'Xray' ? Scan : FlaskConical}
            tone="green"
          />
          <MetricCard label="Queue Awaiting Test" value={pendingCount} icon={Clock} tone="amber" />
          <MetricCard label="Currently Processing" value={processingCount} icon={FileText} tone="indigo" />
        </div>

        {/* Search + Status Filter Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
          <div className="flex bg-gray-100 p-1 rounded-xl text-xs flex-wrap">
            {WORKLIST_STATUS_FILTERS.map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2.5 py-1 rounded-lg border-0 font-semibold cursor-pointer transition-all ${
                  statusFilter === s ? 'bg-white text-slate-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          <SearchInput
            placeholder="Search patient, test, queue..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            containerClassName="w-full sm:w-64"
          />
        </div>

        {/* Modality Worklist Data Table */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 flex justify-between items-center">
            <CardTitle className="text-base font-bold text-slate-900 m-0">
              {categoryLabel} Worklist Queue ({filteredTests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-gray-50/80">
                <TableRow>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Queue Ticket</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Patient Name</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Diagnostic Examination</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Status</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Actions</TableHead>
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
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400">Loading worklist…</TableCell>
                  </TableRow>
                ) : pagedTests.length > 0 ? (
                  pagedTests.map(test => (
                    <TableRow key={test.visit_test_id} className="hover:bg-gray-50/50 transition-colors">
                      <TableCell className="py-3.5">
                        <span className="font-extrabold text-xs text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                          {test.queue_number || `VT-${test.visit_test_id}`}
                        </span>
                      </TableCell>

                      <TableCell className="py-3.5 font-bold text-xs text-slate-900">
                        {test.first_name} {test.last_name}
                        <span className="block text-[10px] text-gray-400 font-normal">PT-{test.patient_id}</span>
                      </TableCell>

                      <TableCell className="py-3.5 text-xs font-bold text-gray-800">
                        {test.test_name}
                        <span className="block text-[10px] text-gray-400 font-normal">{test.category_name}</span>
                      </TableCell>

                      <TableCell className="py-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={test.test_status} className="px-2.5 py-0.5" />
                          {/* Phase C finding 05: HMO-approval status wasn't surfaced anywhere on
                              the worklist — a tech had no on-screen signal that an expensive
                              test's authorization was rejected before running it. */}
                          {test.hmo_approval_status && (
                            <span className="flex items-center gap-1 text-[10px] font-bold text-gray-400">
                              <ShieldCheck className="w-3 h-3" />
                              HMO:&nbsp;<StatusBadge status={test.hmo_approval_status} className="px-1.5 py-0" />
                            </span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="py-3.5 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          {test.test_status === 'Pending' ? (
                            <Button
                              onClick={() => handleStartProcessing(test.visit_test_id)}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center space-x-1.5 cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5" />
                              <span>Start Processing</span>
                            </Button>
                          ) : (
                            <Button
                              onClick={() => handleOpenUploadModal(test)}
                              className="bg-[#769046] hover:bg-[#657c3a] text-white text-xs font-bold px-3.5 py-1.5 rounded-xl flex items-center space-x-1.5 cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>Record Findings & Release</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-xs text-gray-400 font-semibold italic">
                      No pending diagnostic examinations in the {categoryLabel} worklist.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          <Pagination
            page={worklistPage}
            totalPages={worklistTotalPages}
            onPageChange={setWorklistPage}
            totalLabel={`${filteredTests.length} total`}
          />
        </Card>
        </>
        )}

        {mode === 'history' && (
        <>
        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-end gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
          <SearchInput
            placeholder="Search patient, test, queue..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            containerClassName="w-full sm:w-64"
          />
        </div>

        {/* Released Results Table (read-only) */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 flex justify-between items-center">
            <CardTitle className="text-base font-bold text-slate-900 m-0 flex items-center space-x-2">
              <History className="w-4 h-4 text-[#769046]" />
              <span>{categoryLabel} Released Results ({filteredReleased.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-gray-50/80">
                <TableRow>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Queue Ticket</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Patient Name</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Diagnostic Examination</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3">Released</TableHead>
                  <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Actions</TableHead>
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
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400">Loading result history…</TableCell>
                  </TableRow>
                ) : pagedReleased.length > 0 ? (
                  pagedReleased.map(test => (
                    <TableRow key={test.visit_test_id} className="hover:bg-gray-50/50 transition-colors">
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
                        <span className="block text-[10px] text-gray-400 font-normal">{test.category_name}</span>
                      </TableCell>

                      <TableCell className="py-3.5 text-xs text-gray-500">
                        {test.released_at ? new Date(test.released_at).toLocaleString() : '—'}
                        {test.released_by_first_name && (
                          <span className="block text-[10px] text-gray-400">by {test.released_by_first_name} {test.released_by_last_name}</span>
                        )}
                      </TableCell>

                      <TableCell className="py-3.5 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            onClick={() => setViewingResult(test)}
                            variant="outline"
                            className="text-[11px] font-bold border-gray-200 hover:bg-[#769046] hover:text-white rounded-lg py-1 px-2.5 flex items-center space-x-1.5"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View Report</span>
                          </Button>
                          <Button
                            onClick={() => handleOpenEditModal(test)}
                            variant="outline"
                            className="text-[11px] font-bold border-gray-200 hover:bg-slate-800 hover:text-white rounded-lg py-1 px-2.5 flex items-center space-x-1.5"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>Edit</span>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-xs text-gray-400 font-semibold italic">
                      No released results yet in the {categoryLabel} history.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          <Pagination
            page={historyPage}
            totalPages={historyTotalPages}
            onPageChange={setHistoryPage}
            totalLabel={`${filteredReleased.length} total`}
          />
        </Card>
        </>
        )}

        {/* Read-only Released Result Viewer */}
        <Dialog open={!!viewingResult} onOpenChange={(open) => { if (!open) setViewingResult(null); }}>
          <DialogContent className="max-w-2xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">Diagnostic Report</DialogTitle>
              <DialogDescription className="text-xs">
                Patient: <strong>{viewingResult?.first_name} {viewingResult?.last_name}</strong> &bull; Examination: <strong>{viewingResult?.test_name}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="print-area space-y-4">
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Findings &amp; Impression</span>
                <p className="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 m-0">{viewingResult?.findings || '—'}</p>
              </div>
              {viewingResult?.result_remarks && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Remarks</span>
                  <p className="text-xs m-0">{viewingResult.result_remarks}</p>
                </div>
              )}
              <div className="text-[11px] text-gray-400">
                Released {viewingResult?.released_at ? new Date(viewingResult.released_at).toLocaleString() : '—'}
                {viewingResult?.released_by_first_name && ` by ${viewingResult.released_by_first_name} ${viewingResult.released_by_last_name}`}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-gray-100">
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
          <DialogContent className="max-w-2xl rounded-2xl p-6">
            {justReleased ? (
              <div className="space-y-4">
                <div className="flex items-center space-x-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm font-bold">Result released successfully.</span>
                </div>

                <div className="print-area space-y-3 bg-white rounded-2xl border border-gray-100 p-5">
                  <div className="text-center border-b border-gray-100 pb-3 space-y-0.5">
                    <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide m-0">Enlogada Ultrasound &amp; Diagnostic Clinic</h3>
                    <p className="text-xs text-gray-500 m-0">Diagnostic Result Certificate</p>
                  </div>
                  <p className="text-xs m-0">
                    Patient: <strong>{justReleased.first_name} {justReleased.last_name}</strong> &bull; Examination: <strong>{justReleased.test_name}</strong>
                  </p>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Findings</span>
                    <p className="whitespace-pre-wrap text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 m-0">{justReleased.findings || '—'}</p>
                  </div>
                  {justReleased.result_remarks && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Remarks</span>
                      <p className="text-xs m-0">{justReleased.result_remarks}</p>
                    </div>
                  )}
                  <p className="text-[11px] text-gray-400 m-0 pt-2 border-t border-gray-100">
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
                    className="bg-[#769046] hover:bg-[#657c3a] text-white text-xs font-bold"
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
              <DialogDescription className="text-xs">
                Patient: <strong>{activeTest?.first_name} {activeTest?.last_name}</strong> &bull; Examination: <strong>{activeTest?.test_name}</strong>
                {isEditingResult && ' — re-submitting will notify the patient again by email.'}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleUploadResult} className="space-y-4 pt-2">
              {uploadError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Phase C finding 02: past results for this same patient, surfaced at the point
                  of writing new findings — GET /results/history/:patientId already existed but
                  nothing on this screen ever called it. */}
              {(patientHistoryLoading || patientHistory.length > 0) && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Past Results for This Patient</span>
                  {patientHistoryLoading ? (
                    <p className="text-[11px] text-gray-400 m-0">Loading history…</p>
                  ) : (
                    <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-32 overflow-y-auto">
                      {patientHistory.map(h => (
                        <div key={h.visit_test_id} className="px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
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
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Clinical Report Templates</span>
                  <div className="flex flex-wrap gap-2">
                    {TEMPLATES_BY_CATEGORY[category].map(t => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => handleApplyTemplate(t.key)}
                        className="text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase">Findings & Impression (Required)</label>
                <textarea
                  rows={6}
                  placeholder="Enter detailed laboratory/imaging findings, measurements, and impression..."
                  value={findings}
                  onChange={e => setFindings(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-1 focus:ring-[#769046]"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase">Remarks / Recommendations (Optional)</label>
                <Input
                  placeholder="e.g. Clinical correlation recommended..."
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  className="text-xs rounded-xl"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase">Attach Report File (Optional)</label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={handleFileChange}
                  className="w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#769046]/10 file:text-[#769046] hover:file:bg-[#769046]/20 file:cursor-pointer cursor-pointer"
                />
                <p className="text-[11px] text-gray-400 m-0">
                  PDF, JPEG, or PNG — up to 15MB.
                  {isEditingResult && (activeTest?.file_path || activeTest?.file_url) && !resultFile && ' A file is already attached — leave blank to keep it, or attach a new one to replace it.'}
                </p>
                {resultFile && (
                  <p className="text-[11px] font-semibold text-slate-700 m-0">{resultFile.name} ({(resultFile.size / 1024).toFixed(0)} KB)</p>
                )}
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowUploadModal(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold text-xs px-5 py-2 rounded-xl flex items-center space-x-1.5">
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
