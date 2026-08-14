import React, { useState, useEffect, useCallback, useRef } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { usePolling } from '../hooks/usePolling';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import MetricCard from '../components/ui/metric-card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { SearchInput } from '../components/ui/search-input';
import { StatusBadge } from '../components/ui/status-badge';
import Pagination from '../components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import { toastSuccess, toastError, toastInfo } from '../lib/toast';
import { validatePatientProfile } from '../validations/patientValidation';
import QrScanner from '../components/QrScanner';
import {
  ClipboardList,
  UserCheck,
  ShieldAlert,
  UserPlus,
  QrCode,
  Clock,
  Volume2,
  Printer,
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  Users,
  Camera,
  Keyboard,
  History,
  RefreshCw,
  XCircle,
  UserX
} from 'lucide-react';

const PAGE_TITLES = {
  'reception-queue': 'Active Patient Queue',
  'reception-walkin': 'Walk-In Registration',
  'reception-checkin': 'Appointment Check-In',
  'reception-history': 'Visit History',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);
const todayStr = () => new Date().toISOString().slice(0, 10);
const QUEUE_PAGE_SIZE = 25;

const ReceptionistDashboard = ({ activeNav = 'reception-queue', onSelectNav }) => {
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary queue view, mirroring DiagnosticDashboard's existing fallback pattern.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'reception-queue';
  const [activeVisits, setActiveVisits] = useState([]);
  const [testCatalog, setTestCatalog] = useState([]);
  const [patientTypes, setPatientTypes] = useState([]);
  const [hmoProviders, setHmoProviders] = useState([]);
  const [staticDataError, setStaticDataError] = useState('');
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const searchDebounceRef = useRef(null);

  // Server-driven pagination state (UI/UX Phase 2): the queue can genuinely grow into the
  // hundreds on a busy day, so search/status filtering and paging now happen in the backend
  // query, not in a client-side .filter() over every visit already downloaded.
  const [queuePage, setQueuePage] = useState(1);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueTotalPages, setQueueTotalPages] = useState(1);
  const [queuePendingCount, setQueuePendingCount] = useState(0);
  const [queueProcessingCount, setQueueProcessingCount] = useState(0);
  const [queueWalkinCount, setQueueWalkinCount] = useState(0);

  // Visit History state (new nav destination, UI/UX Phase 2)
  const [historyVisits, setHistoryVisits] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStartDate, setHistoryStartDate] = useState(todayStr());
  const [historyEndDate, setHistoryEndDate] = useState(todayStr());
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // QR Code / Ref Verification State
  const [searchRef, setSearchRef] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [scanMode, setScanMode] = useState(false);
  // UI/UX Modernization Phase 10: after a QR/reference check-in succeeds, verifyResult is
  // cleared (so the form resets for the next patient) — this instead holds a short-lived
  // "where to send them" message built from the visit's already-attached test categories.
  const [checkInGuidance, setCheckInGuidance] = useState(null);

  // UI/UX Phase 3: check-in used to have two independent code paths — the QR/reference flow
  // went through a ConfirmDialog, but checking in an existing patient found via the Walk-In
  // Registration lookup fired immediately with no confirmation at all. Both now funnel through
  // this one target + one ConfirmDialog, tagged by type so the same confirm action can branch.
  const [checkInTarget, setCheckInTarget] = useState(null); // { type: 'appointment' | 'walkin', data }
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState('');
  const [checkInNotice, setCheckInNotice] = useState('');

  // Feature Gap Plan Phase A: both endpoints already accepted 'Cancelled'/'No Show' — nothing
  // in the Receptionist UI ever sent either value. A no-show appointment or a mis-registered
  // walk-in had no way to be removed from the active queue.
  const [cancelVisitTarget, setCancelVisitTarget] = useState(null);
  const [cancelingVisit, setCancelingVisit] = useState(false);
  const [cancelVisitError, setCancelVisitError] = useState('');
  const [noShowTarget, setNoShowTarget] = useState(null);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [noShowError, setNoShowError] = useState('');

  // Assign Tests Dialog State
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [showTestsModal, setShowTestsModal] = useState(false);
  const [isAttachingTests, setIsAttachingTests] = useState(false);

  // Existing Patient Lookup State (Module 7: patient record lookup)
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState(null);
  const [patientSearching, setPatientSearching] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState('');
  const [lookupCheckInSuccess, setLookupCheckInSuccess] = useState('');

  // Walk-in Registration State
  const [newPatient, setNewPatient] = useState({
    firstName: '',
    lastName: '',
    birthdate: '',
    sex: 'Male',
    address: '',
    contactNumber: '',
    emergencyContact: '',
    patientTypeId: ''
  });
  const [visitNotes, setVisitNotes] = useState('');
  const [registrationSuccess, setRegistrationSuccess] = useState('');
  const [registrationError, setRegistrationError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  // Manual HMO logging State
  const [showHmoModal, setShowHmoModal] = useState(false);
  const [activeVisitTest, setActiveVisitTest] = useState(null);
  const [hmoProviderId, setHmoProviderId] = useState('');
  const [hmoApprovalCode, setHmoApprovalCode] = useState('');
  const [hmoError, setHmoError] = useState('');

  // UI/UX Modernization Phase 10: read-only visibility into pending HMO requests, shown on the
  // Active Queue landing view.
  const [pendingHmoRequests, setPendingHmoRequests] = useState([]);
  const [hmoRequestsLoading, setHmoRequestsLoading] = useState(true);

  const fetchActiveVisits = useCallback(async ({ page = 1, search = searchQuery, status = statusFilter } = {}) => {
    setLoading(true);
    setQueueError('');
    try {
      const response = await api.get('/visits/active', {
        params: {
          page,
          limit: QUEUE_PAGE_SIZE,
          search: search || undefined,
          status: status && status !== 'All' ? status : undefined
        }
      });
      const data = response.data.data;
      setActiveVisits(data.visits || []);
      setQueueTotal(data.total || 0);
      setQueueTotalPages(data.totalPages || 1);
      setQueuePendingCount(data.pendingCount || 0);
      setQueueProcessingCount(data.processingCount || 0);
      setQueueWalkinCount(data.walkinCount || 0);
      setQueuePage(data.page || page);
    } catch (err) {
      console.error('Failed to fetch active visits:', err);
      setQueueError('Could not load the active queue. Please try again.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchVisitHistory = useCallback(async (startDate, endDate, search) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get('/visits/history', {
        params: { startDate, endDate, search: search || undefined }
      });
      setHistoryVisits(response.data.data.visits || []);
    } catch (err) {
      console.error('Failed to fetch visit history:', err);
      setHistoryError('Could not load visit history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchStaticData = useCallback(async () => {
    setStaticDataError('');
    try {
      const testsRes = await api.get('/tests');
      setTestCatalog(testsRes.data.data.tests || []);

      const typesRes = await api.get('/patients/types');
      setPatientTypes(typesRes.data.data.patientTypes || []);

      const hmoRes = await api.get('/hmo/providers');
      setHmoProviders((hmoRes.data.data.providers || []).filter(p => p.is_active));
    } catch (err) {
      console.error('Failed to fetch static data:', err);
      // Phase D finding 05: this previously failed silently — the test catalog, patient types,
      // and HMO provider dropdowns would just render empty with no explanation, right when
      // Reception needs them mid-registration or mid-HMO-logging.
      setStaticDataError('Could not load test catalog, patient types, or HMO providers. Some forms below may be incomplete.');
    }
  }, []);

  // UI/UX Modernization Phase 10: GET /hmo/requests has always been authorized for
  // Receptionist, but nothing on this dashboard ever called it — pending requests were
  // effectively invisible unless someone already knew to look at Admin's Service Requests page.
  // Read-only here: approving stays wherever it already lives, this just surfaces the list.
  const fetchPendingHmoRequests = useCallback(async () => {
    setHmoRequestsLoading(true);
    try {
      const res = await api.get('/hmo/requests', { params: { status: 'Pending' } });
      setPendingHmoRequests(res.data.data.requests || []);
    } catch (err) {
      console.error('Failed to fetch pending HMO requests:', err);
    } finally {
      setHmoRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActiveVisits({ page: 1, search: '', status: 'All' });
    fetchStaticData();
    fetchPendingHmoRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchActiveVisits, fetchStaticData, fetchPendingHmoRequests]);

  // Keep the queue live. Walk-ins registered at another terminal, tickets the cashier has just
  // settled, and the wait-time badges (which recompute on render) all went stale the moment this
  // screen loaded — a receptionist who opened the queue at 08:00 saw the 08:00 queue all shift.
  // Only while the queue is actually on screen; paused automatically when the tab is hidden.
  usePolling(
    () => fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter }),
    30000,
    { enabled: view === 'reception-queue' }
  );

  // Lazy-load Visit History only once the tab is actually opened, not on every Receptionist
  // dashboard mount.
  useEffect(() => {
    if (view === 'reception-history' && !historyLoaded) {
      setHistoryLoaded(true);
      fetchVisitHistory(historyStartDate, historyEndDate, historySearch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleQueueSearchChange = (value) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      fetchActiveVisits({ page: 1, search: value, status: statusFilter });
    }, 400);
  };

  const handleQueueStatusFilterChange = (value) => {
    setStatusFilter(value);
    fetchActiveVisits({ page: 1, search: searchQuery, status: value });
  };

  const handleQueuePageChange = (newPage) => {
    if (newPage < 1 || newPage > queueTotalPages) return;
    fetchActiveVisits({ page: newPage, search: searchQuery, status: statusFilter });
  };

  const handleVerifyReference = async (e, refOverride) => {
    e?.preventDefault?.();
    setVerifyError('');
    setVerifyResult(null);
    setCheckInGuidance(null);

    const ref = refOverride ?? searchRef;
    if (!ref) return;

    try {
      const response = await api.get(`/appointments/verify/${ref}`);
      setVerifyResult(response.data.data.appointment);
    } catch (err) {
      setVerifyError(err.response?.data?.message || 'Appointment reference lookup failed.');
    }
  };

  const handleQrScan = (decodedText) => {
    setSearchRef(decodedText);
    handleVerifyReference(null, decodedText);
  };

  const requestCheckIn = (type, data) => {
    // Check-in is clinically/operationally significant either way — advances an appointment
    // and visit status, or creates a brand-new visit — so both paths require explicit
    // confirmation before firing. See .agents Phase 12.
    setCheckInError('');
    setCheckInNotice('');
    setCheckInTarget({ type, data });
  };

  const confirmCheckIn = async () => {
    if (!checkInTarget) return;
    setCheckingIn(true);
    setCheckInError('');
    try {
      if (checkInTarget.type === 'appointment') {
        const { id: appointmentId, is_paid: isPaid, first_name, last_name, categories } = checkInTarget.data;
        // Confirming the appointment is the front desk's half of the release rule. The backend
        // releases the ticket to the modalities only if payment has also landed — this screen
        // no longer PATCHes the visit status itself, which used to push unpaid visits straight
        // onto the diagnostic worklists.
        await api.patch(`/appointments/${appointmentId}/status`, { status: 'Confirmed' });
        setCheckInNotice(
          isPaid
            ? 'Checked in and released — the ticket is now on the department worklist.'
            : 'Checked in. Payment is still outstanding, so please send the patient to the cashier — the ticket reaches the department once payment is confirmed.'
        );
        setSearchRef('');
        setVerifyResult(null);
        setCheckInGuidance({
          patientName: `${first_name} ${last_name}`,
          categories: categories || []
        });
      } else {
        const patient = checkInTarget.data;
        const vRes = await api.post('/visits', {
          patientId: patient.id,
          visitType: 'Walk in',
          notes: visitNotes
        });
        const visit = vRes.data.data.visit;
        setLookupCheckInSuccess(`${patient.first_name} ${patient.last_name} checked in! Physical Queue Ticket: ${visit.queue_number}`);
        setPatientSearchResults(null);
        setPatientSearchQuery('');
        setVisitNotes('');
      }
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
      setCheckInTarget(null);
    } catch (err) {
      setCheckInError(err.response?.data?.message || 'Failed to check in patient');
    } finally {
      setCheckingIn(false);
    }
  };

  const confirmCancelVisit = async () => {
    if (!cancelVisitTarget) return;
    setCancelingVisit(true);
    setCancelVisitError('');
    try {
      await api.patch(`/visits/${cancelVisitTarget.id}/status`, { status: 'Cancelled' });
      setCancelVisitTarget(null);
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
    } catch (err) {
      setCancelVisitError(err.response?.data?.message || 'Failed to cancel this visit.');
    } finally {
      setCancelingVisit(false);
    }
  };

  const confirmMarkNoShow = async () => {
    if (!noShowTarget) return;
    setMarkingNoShow(true);
    setNoShowError('');
    try {
      await api.patch(`/appointments/${noShowTarget.id}/status`, { status: 'No Show' });
      setNoShowTarget(null);
      setVerifyResult(null);
      setSearchRef('');
      // Refetch the queue, which its three sibling handlers (check-in, cancel visit, walk-in
      // register) all do and this one did not. Without it the no-showed patient stayed on the
      // Active Queue for the rest of the session, so staff could go chasing — or re-check-in —
      // someone already marked absent.
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
    } catch (err) {
      setNoShowError(err.response?.data?.message || 'Failed to mark this appointment as a no-show.');
    } finally {
      setMarkingNoShow(false);
    }
  };

  const handleWalkInRegister = async (e) => {
    e.preventDefault();
    setRegistrationSuccess('');
    setRegistrationError('');

    const validationError = validatePatientProfile(newPatient);
    if (validationError) {
      setRegistrationError(validationError);
      return;
    }

    setIsRegistering(true);
    try {
      // 1. Create Patient Profile
      const pRes = await api.post('/patients', newPatient);
      const patient = pRes.data.data.patient;

      // 2. Create Walk-in Visit with Generated Queue Ticket
      const vRes = await api.post('/visits', {
        patientId: patient.id,
        visitType: 'Walk in',
        notes: visitNotes
      });

      const visit = vRes.data.data.visit;
      setRegistrationSuccess(`Walk-In registered successfully! Physical Queue Ticket: ${visit.queue_number}`);

      setNewPatient({
        firstName: '',
        lastName: '',
        birthdate: '',
        sex: 'Male',
        address: '',
        contactNumber: '',
        emergencyContact: '',
        patientTypeId: ''
      });
      setVisitNotes('');
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
    } catch (err) {
      setRegistrationError(err.response?.data?.message || 'Failed to register walk-in patient');
    } finally {
      setIsRegistering(false);
    }
  };

  const handlePatientSearch = async (e) => {
    e.preventDefault();
    setPatientSearchError('');
    setLookupCheckInSuccess('');

    if (patientSearchQuery.trim().length < 2) {
      setPatientSearchError('Enter at least 2 characters to search.');
      return;
    }

    setPatientSearching(true);
    try {
      const response = await api.get('/patients/search', { params: { q: patientSearchQuery.trim() } });
      setPatientSearchResults(response.data.data.patients);
    } catch (err) {
      setPatientSearchError(err.response?.data?.message || 'Failed to search patient records.');
      setPatientSearchResults(null);
    } finally {
      setPatientSearching(false);
    }
  };

  const handleOpenAssignTests = (visitId) => {
    setSelectedVisitId(visitId);
    setSelectedTestIds([]);
    setShowTestsModal(true);
  };

  const handleAssignTestsSubmit = async (e) => {
    e.preventDefault();
    if (!selectedVisitId || selectedTestIds.length === 0) return;
    // Guard against double-submission. Every other mutation on this screen is guarded
    // (isRegistering, checkingIn, cancelingVisit); this one was not, and it is the one that costs
    // the patient money — visit_tests rows carry price_at_time, so a double-click on a slow
    // connection attaches the same X-ray twice and bills for both.
    if (isAttachingTests) return;
    setIsAttachingTests(true);

    try {
      await api.post('/tests/visit-tests', {
        patientVisitId: selectedVisitId,
        testIds: selectedTestIds.map(id => parseInt(id, 10))
      });
      setShowTestsModal(false);
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
    } catch (err) {
      toastError(err.response?.data?.message || 'Failed to assign tests to visit');
    } finally {
      setIsAttachingTests(false);
    }
  };

  const handleToggleTest = (testId) => {
    if (selectedTestIds.includes(testId)) {
      setSelectedTestIds(selectedTestIds.filter(id => id !== testId));
    } else {
      setSelectedTestIds([...selectedTestIds, testId]);
    }
  };

  const handleOpenHmoModal = (visitTest) => {
    setActiveVisitTest(visitTest);
    setHmoProviderId('');
    setHmoApprovalCode('');
    setHmoError('');
    setShowHmoModal(true);
  };

  const handleHmoSubmit = async (e) => {
    e.preventDefault();
    setHmoError('');

    if (!activeVisitTest || !hmoProviderId) {
      setHmoError('Provider and Approval Code are required.');
      return;
    }

    try {
      await api.post('/hmo/request', {
        hmoProviderId: parseInt(hmoProviderId, 10),
        approvalCode: hmoApprovalCode,
        visitTestIds: [activeVisitTest.id]
      });

      toastSuccess('HMO Pre-authorization logged successfully!');
      setShowHmoModal(false);
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
      fetchPendingHmoRequests();
    } catch (err) {
      setHmoError(err.response?.data?.message || 'Failed to log HMO authorization');
    }
  };

  const speakQueueNumber = (queueNum) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(`Queue Number ${queueNum}, please proceed to the desk`);
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    } else {
      toastInfo(`Calling Queue Number ${queueNum}`);
    }
  };

  return (
    <SidebarLayout title={PAGE_TITLES[view]} activeNav={view} onSelectNav={onSelectNav}>
      <div className="space-y-6">

        {staticDataError && (
          <div role="alert" className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{staticDataError}</span>
            <button type="button" onClick={fetchStaticData} className="underline font-bold border-0 bg-transparent cursor-pointer text-amber-900">Retry</button>
          </div>
        )}

        {view === 'reception-queue' && (
          <>
            {/* KPI Metrics Header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Active Queue Visits" value={queueTotal} icon={UserCheck} tone="green" />
              <MetricCard label="Pending Intake" value={queuePendingCount} icon={Clock} tone="amber" />
              <MetricCard label="In Diagnostic / Processing" value={queueProcessingCount} icon={ClipboardList} tone="indigo" />
              <MetricCard label="Walk-In Intake Today" value={queueWalkinCount} icon={UserPlus} tone="emerald" />
            </div>

            {/* UI/UX Modernization Phase 10: read-only visibility into pending HMO requests —
                approving one still happens from wherever it already does, this card only
                surfaces that they exist. */}
            {!hmoRequestsLoading && pendingHmoRequests.length > 0 && (
              <Card className="border-amber-200 bg-amber-50/60 shadow-xs rounded-2xl overflow-hidden">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-amber-700 flex-shrink-0" />
                    <h3 className="text-xs font-bold text-amber-800 uppercase tracking-wider m-0">
                      {pendingHmoRequests.length} Pending HMO Request{pendingHmoRequests.length === 1 ? '' : 's'}
                    </h3>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {pendingHmoRequests.slice(0, 6).map(r => (
                      <span
                        key={r.id}
                        className="inline-flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg px-2.5 py-1 text-fine font-semibold text-amber-900"
                      >
                        <span className="font-bold">{r.provider_name}</span>
                        <span className="text-amber-600">&bull;</span>
                        <span>{r.approved_test_count}/{r.test_count} tests approved</span>
                      </span>
                    ))}
                    {pendingHmoRequests.length > 6 && (
                      <span className="text-fine font-semibold text-amber-700 self-center">+{pendingHmoRequests.length - 6} more</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Search + Status Filter Toolbar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
              <div className="flex items-center space-x-3 w-full sm:w-auto">
                <SearchInput
                  placeholder="Search patient name or Queue #..."
                  value={searchQuery}
                  onChange={e => handleQueueSearchChange(e.target.value)}
                  containerClassName="flex-1 sm:w-64"
                />

                <Select value={statusFilter} onValueChange={handleQueueStatusFilterChange}>
                  <SelectTrigger className="w-36 text-xs rounded-xl">
                    <SelectValue placeholder="Status Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Statuses</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Processing">Processing</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="text-xs font-bold text-gray-400 whitespace-nowrap">Showing {activeVisits.length} of {queueTotal} visit(s)</span>
            </div>

            {/* Active Queue Table */}
            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-gray-50/80 border-b border-gray-100">
                    <TableRow>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3">Queue Ticket</TableHead>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3">Patient Name</TableHead>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3">Visit Type</TableHead>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3">Patient Category</TableHead>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3">Assigned Tests</TableHead>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3">Status</TableHead>
                      <TableHead className="text-meta font-bold uppercase tracking-wider text-gray-500 py-3 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueError ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-xs text-rose-600 font-semibold">
                          {queueError}{' '}
                          <button
                            type="button"
                            onClick={() => fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter })}
                            className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                          >
                            Retry
                          </button>
                        </TableCell>
                      </TableRow>
                    ) : loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-xs text-gray-500 font-semibold">
                          Loading active queue…
                        </TableCell>
                      </TableRow>
                    ) : activeVisits.length > 0 ? (
                      activeVisits.map(visit => (
                        <TableRow key={visit.id} className="hover:bg-gray-50/50 transition-colors">
                          <TableCell className="py-3">
                            <div className="flex items-center space-x-2">
                              <span className="font-extrabold text-sm text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                                {visit.queue_number || `V-${visit.id}`}
                              </span>
                              <button
                                onClick={() => speakQueueNumber(visit.queue_number)}
                                title="Call Queue Number"
                                className="p-1 text-gray-400 hover:text-[#769046] border-0 bg-transparent cursor-pointer"
                              >
                                <Volume2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => window.print()}
                                title="Print Queue Ticket Slip"
                                className="p-1 text-gray-400 hover:text-indigo-600 border-0 bg-transparent cursor-pointer"
                              >
                                <Printer className="w-4 h-4" />
                              </button>
                            </div>
                          </TableCell>

                          <TableCell className="py-3 font-bold text-xs text-slate-900">
                            {visit.first_name} {visit.last_name}
                            <span className="block text-meta text-gray-400 font-normal">PT-{visit.patient_id}</span>
                          </TableCell>

                          <TableCell className="py-3 text-xs">
                            <Badge variant="outline" className="text-meta font-bold border-gray-200">
                              {visit.visit_type}
                            </Badge>
                          </TableCell>

                          <TableCell className="py-3 text-xs font-semibold text-gray-700">
                            {visit.patient_type_name}
                          </TableCell>

                          <TableCell className="py-3 text-xs">
                            {visit.tests && visit.tests.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {visit.tests.map(t => (
                                  <span key={t.id} className="inline-flex items-center gap-1">
                                    <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100 text-meta font-semibold border-gray-200">
                                      {t.test_name} ({t.test_status})
                                    </Badge>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenHmoModal(t)}
                                      title="Log HMO pre-authorization for this test"
                                      aria-label={`Log HMO pre-authorization for ${t.test_name}`}
                                      className="p-0.5 text-gray-400 hover:text-[#769046] border-0 bg-transparent cursor-pointer"
                                    >
                                      <ShieldAlert className="w-3.5 h-3.5" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-gray-400 text-fine italic">No tests attached</span>
                            )}
                          </TableCell>

                          <TableCell className="py-3">
                            <StatusBadge status={visit.visit_status} className="px-2.5 py-0.5" />
                            {/* Where the ticket actually is, in the front desk's own terms.
                                'Pending' alone doesn't say whether reception or the cashier is
                                holding it up, which is the question this row exists to answer. */}
                            <span className="block text-meta text-gray-400 font-semibold mt-1">
                              {visit.visit_status === 'Pending'
                                ? 'Awaiting payment — with cashier'
                                : visit.visit_status === 'Processing'
                                  ? 'Released to department'
                                  : ''}
                            </span>
                          </TableCell>

                          <TableCell className="py-3 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <Button
                                onClick={() => handleOpenAssignTests(visit.id)}
                                variant="outline"
                                className="text-fine font-bold border-gray-200 hover:bg-[#769046] hover:text-white rounded-lg py-1 px-2.5"
                              >
                                + Attach Tests
                              </Button>
                              {!['Completed', 'Cancelled'].includes(visit.visit_status) && (
                                <button
                                  type="button"
                                  onClick={() => { setCancelVisitError(''); setCancelVisitTarget(visit); }}
                                  title="Cancel this visit"
                                  aria-label={`Cancel visit for ${visit.first_name} ${visit.last_name}`}
                                  className="p-1.5 text-gray-400 hover:text-red-600 border-0 bg-transparent cursor-pointer"
                                >
                                  <XCircle className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-xs text-gray-500 font-semibold">
                          No active queue visits found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
              <Pagination
                page={queuePage}
                totalPages={queueTotalPages}
                onPageChange={handleQueuePageChange}
                totalLabel={`${queueTotal} total`}
              />
            </Card>
          </>
        )}

        {view === 'reception-history' && (
          <div className="space-y-6">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900 m-0 flex items-center space-x-2">
                  <History className="w-5 h-5 text-[#769046]" />
                  <span>Visit History</span>
                </h3>
                <p className="text-fine text-gray-500 mt-1">Look up past patient visits, of any status, by date range.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                  placeholder="Search patient or Queue #..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  containerClassName="w-56"
                />
                <Input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)} className="text-xs w-36" />
                <span className="text-xs text-gray-400">to</span>
                <Input type="date" value={historyEndDate} onChange={e => setHistoryEndDate(e.target.value)} className="text-xs w-36" />
                <Button
                  variant="outline"
                  onClick={() => fetchVisitHistory(historyStartDate, historyEndDate, historySearch)}
                  className="flex items-center space-x-1.5 text-xs font-semibold"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Apply</span>
                </Button>
              </div>
            </div>

            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
              <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-bold text-slate-800">{historyVisits.length} Visit(s)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-gray-50/80">
                    <TableRow>
                      <TableHead className="text-meta font-bold uppercase py-3">Queue Ticket</TableHead>
                      <TableHead className="text-meta font-bold uppercase py-3">Patient</TableHead>
                      <TableHead className="text-meta font-bold uppercase py-3">Visit Type</TableHead>
                      <TableHead className="text-meta font-bold uppercase py-3">Tests</TableHead>
                      <TableHead className="text-meta font-bold uppercase py-3">Status</TableHead>
                      <TableHead className="text-meta font-bold uppercase py-3 text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-xs text-rose-600 font-semibold">
                          {historyError}{' '}
                          <button
                            type="button"
                            onClick={() => fetchVisitHistory(historyStartDate, historyEndDate, historySearch)}
                            className="underline font-bold border-0 bg-transparent cursor-pointer text-rose-700"
                          >
                            Retry
                          </button>
                        </TableCell>
                      </TableRow>
                    ) : historyLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-xs text-gray-500 font-semibold">
                          Loading visit history…
                        </TableCell>
                      </TableRow>
                    ) : historyVisits.length > 0 ? (
                      historyVisits.map(v => (
                        <TableRow key={v.id} className="hover:bg-gray-50/50 transition-colors">
                          <TableCell className="py-3">
                            <span className="font-extrabold text-xs text-slate-900 bg-gray-100 px-2.5 py-1 rounded-lg border border-gray-200">
                              {v.queue_number || `V-${v.id}`}
                            </span>
                          </TableCell>
                          <TableCell className="py-3 font-bold text-xs text-slate-900">
                            {v.first_name} {v.last_name}
                            <span className="block text-meta text-gray-400 font-normal">{v.patient_type_name}</span>
                          </TableCell>
                          <TableCell className="py-3 text-xs">
                            <Badge variant="outline" className="text-meta font-bold border-gray-200">
                              {v.visit_type}
                            </Badge>
                          </TableCell>
                          <TableCell className="py-3 text-xs text-gray-600">
                            {v.tests && v.tests.length > 0 ? v.tests.map(t => t.test_name).join(', ') : <span className="text-gray-400 italic">No tests attached</span>}
                          </TableCell>
                          <TableCell className="py-3">
                            <StatusBadge status={v.visit_status} />
                          </TableCell>
                          <TableCell className="py-3 text-xs text-gray-500 text-right">
                            {new Date(v.created_at).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-xs text-gray-500 font-semibold italic">
                          No visits found in this date range.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}

        {view === 'reception-walkin' && (
          <div className="space-y-4">

            {/* Existing Patient Lookup (Module 7: patient record lookup) */}
            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-6 max-w-3xl">
              <div className="border-b border-gray-100 pb-3 mb-4">
                <h3 className="text-base font-bold text-slate-900 m-0 flex items-center space-x-2">
                  <Users className="w-5 h-5 text-[#769046]" />
                  <span>Find Existing Patient</span>
                </h3>
                <p className="text-fine text-gray-500 mt-1">Search before registering — a returning patient should be checked in, not re-registered.</p>
              </div>

              {lookupCheckInSuccess && (
                <div role="status" className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{lookupCheckInSuccess}</span>
                </div>
              )}
              {patientSearchError && (
                <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{patientSearchError}</span>
                </div>
              )}

              <form onSubmit={handlePatientSearch} className="flex space-x-2">
                <Input
                  placeholder="Search by patient name..."
                  value={patientSearchQuery}
                  onChange={e => setPatientSearchQuery(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" className="bg-[#192534] hover:bg-slate-800 text-white text-xs font-bold px-4" disabled={patientSearching}>
                  {patientSearching ? 'Searching...' : 'Search'}
                </Button>
              </form>

              {patientSearchResults && (
                <div className="mt-4 space-y-2">
                  {patientSearchResults.length === 0 ? (
                    <p className="text-xs text-gray-400 italic text-center py-3">No matching patient records found. Register them as a new patient below.</p>
                  ) : (
                    patientSearchResults.map(patient => (
                      <div key={patient.id} className="flex items-center justify-between border border-gray-100 rounded-xl p-3 bg-gray-50/50">
                        <div className="text-xs">
                          <span className="block font-bold text-slate-900">{patient.first_name} {patient.last_name} <span className="text-meta text-gray-400 font-normal">PT-{patient.id}</span></span>
                          <span className="block text-gray-500">{patient.patient_type_name} &middot; DOB {new Date(patient.birthdate).toLocaleDateString()}</span>
                          {/* Phase D: previously zero visit/financial context at lookup — a
                              returning patient's unpaid balance from a prior visit was invisible
                              at check-in. */}
                          <span className="flex items-center gap-2 mt-1">
                            <span className="text-meta font-semibold text-gray-400">
                              {Number(patient.visit_count) > 0
                                ? `${patient.visit_count} prior visit${Number(patient.visit_count) === 1 ? '' : 's'} · last ${new Date(patient.last_visit_at).toLocaleDateString()}`
                                : 'No prior visits'}
                            </span>
                            {Number(patient.unpaid_visit_count) > 0 && (
                              <span className="text-meta font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
                                {patient.unpaid_visit_count} unpaid visit{Number(patient.unpaid_visit_count) === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </div>
                        <Button
                          type="button"
                          onClick={() => requestCheckIn('walkin', patient)}
                          className="bg-[#769046] hover:bg-[#657c3a] text-white text-fine font-bold rounded-lg flex items-center space-x-1.5 px-3 py-1.5"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Check In This Patient</span>
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Card>

            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-6 max-w-3xl">
              <div className="border-b border-gray-100 pb-3 mb-4">
                <h3 className="text-base font-bold text-slate-900 m-0 flex items-center space-x-2">
                  <UserPlus className="w-5 h-5 text-[#769046]" />
                  <span>Register Walk-In Patient & Generate Physical Ticket</span>
                </h3>
              </div>

              {registrationSuccess && (
                <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{registrationSuccess}</span>
                </div>
              )}

              {registrationError && (
                <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-100 text-red-600 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{registrationError}</span>
                </div>
              )}

              <form onSubmit={handleWalkInRegister} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase">First Name <span className="text-rose-600">*</span></label>
                    <Input
                      placeholder="Juan"
                      value={newPatient.firstName}
                      onChange={e => setNewPatient({...newPatient, firstName: e.target.value})}
                      disabled={isRegistering}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase">Last Name <span className="text-rose-600">*</span></label>
                    <Input
                      placeholder="Dela Cruz"
                      value={newPatient.lastName}
                      onChange={e => setNewPatient({...newPatient, lastName: e.target.value})}
                      disabled={isRegistering}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-bold text-gray-600 uppercase">Birthdate <span className="text-rose-600">*</span></label>
                    <Input
                      type="date"
                      value={newPatient.birthdate}
                      onChange={e => setNewPatient({...newPatient, birthdate: e.target.value})}
                      disabled={isRegistering}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase">Sex <span className="text-rose-600">*</span></label>
                    <Select
                      value={newPatient.sex}
                      onValueChange={val => setNewPatient({...newPatient, sex: val})}
                      disabled={isRegistering}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase">Contact Number</label>
                    <Input
                      placeholder="09171234567"
                      value={newPatient.contactNumber}
                      onChange={e => setNewPatient({...newPatient, contactNumber: e.target.value})}
                      disabled={isRegistering}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-600 uppercase">Patient Type <span className="text-rose-600">*</span></label>
                    <Select
                      value={newPatient.patientTypeId}
                      onValueChange={val => setNewPatient({...newPatient, patientTypeId: val})}
                      disabled={isRegistering}
                    >
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Select patient type" />
                      </SelectTrigger>
                      <SelectContent>
                        {patientTypes.map(t => (
                          <SelectItem key={t.id} value={t.id.toString()}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">Home Address</label>
                  <Input
                    placeholder="Barangay, City, Province"
                    value={newPatient.address}
                    onChange={e => setNewPatient({...newPatient, address: e.target.value})}
                    disabled={isRegistering}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-600 uppercase">Visit Notes / Referral Reason</label>
                  <Input
                    placeholder="Walk-in referral for Abdominal Ultrasound..."
                    value={visitNotes}
                    onChange={e => setVisitNotes(e.target.value)}
                    disabled={isRegistering}
                  />
                </div>

                <div className="flex justify-end pt-3">
                  <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold text-xs px-6 py-2 rounded-xl" disabled={isRegistering}>
                    {isRegistering ? 'Registering...' : 'Register Walk-In & Issue Queue Ticket'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}

        {view === 'reception-checkin' && (
          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-6 max-w-xl">
            <div className="border-b border-gray-100 pb-3 mb-4">
              <h3 className="text-base font-bold text-slate-900 m-0 flex items-center space-x-2">
                <QrCode className="w-5 h-5 text-[#769046]" />
                <span>Verify Appointment Reference</span>
              </h3>
              <p className="text-fine text-gray-500 mt-1">
                Scan or enter the appointment reference code (e.g. <code>APPT-XXXXX</code>) to check a patient in.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setScanMode(m => !m)}
              className="flex items-center space-x-1.5 text-fine font-bold text-[#769046] hover:text-[#657c3a] cursor-pointer mb-3"
            >
              {scanMode ? <Keyboard className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
              <span>{scanMode ? 'Switch to manual entry' : 'Scan QR with camera'}</span>
            </button>

            {scanMode && (
              <QrScanner
                active={view === 'reception-checkin' && scanMode}
                onScan={handleQrScan}
                onError={setVerifyError}
              />
            )}

            <form onSubmit={handleVerifyReference} className="space-y-4 pt-2">
              <div className="flex space-x-2">
                <Input
                  placeholder="APPT-104928"
                  value={searchRef}
                  onChange={e => setSearchRef(e.target.value)}
                  className="text-xs rounded-xl"
                />
                <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-xs font-bold px-4">
                  Lookup
                </Button>
              </div>

              {verifyError && (
                <div role="alert" className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{verifyError}</span>
                </div>
              )}

              {checkInNotice && (
                <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{checkInNotice}</span>
                </div>
              )}
              {checkInGuidance && (
                <div role="status" className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl space-y-1.5 text-xs">
                  <div className="flex items-center space-x-2 font-bold">
                    <UserCheck className="w-4 h-4 flex-shrink-0" />
                    <span>{checkInGuidance.patientName} is checked in.</span>
                  </div>
                  {checkInGuidance.categories.length > 0 ? (
                    <p className="m-0">
                      Please guide the patient to: <strong>{checkInGuidance.categories.join(', ')}</strong>.
                    </p>
                  ) : (
                    <p className="m-0">No tests are attached to this visit yet — attach tests from the Active Queue before sending the patient anywhere.</p>
                  )}
                </div>
              )}

              {verifyResult && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500 uppercase">Patient</span>
                    <span className="font-extrabold text-slate-900">{verifyResult.first_name} {verifyResult.last_name}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500 uppercase">Scheduled</span>
                    <span className="font-bold text-gray-800">{verifyResult.scheduled_date} at {verifyResult.scheduled_time}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500 uppercase">Queue Ticket</span>
                    <Badge className="bg-[#769046] text-white font-extrabold">{verifyResult.queue_number}</Badge>
                  </div>

                  {/* Payment is the other half of the release rule, so the front desk needs to
                      see it before checking anyone in — otherwise they check the patient in,
                      nothing appears at the modality, and nobody knows why. */}
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500 uppercase">Payment</span>
                    <StatusBadge status={verifyResult.is_paid ? 'Paid' : 'Pending'} />
                  </div>

                  {!verifyResult.is_paid && (
                    <p className="text-fine text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 m-0">
                      This booking has no confirmed payment yet. You can still check the patient in, but the
                      ticket will only reach the department once the cashier confirms payment.
                    </p>
                  )}

                  <Button
                    type="button"
                    onClick={() => requestCheckIn('appointment', verifyResult)}
                    className="w-full bg-[#769046] hover:bg-[#657c3a] text-white font-bold py-2 rounded-xl"
                  >
                    Confirm Check-In Patient
                  </Button>
                  <button
                    type="button"
                    onClick={() => { setNoShowError(''); setNoShowTarget(verifyResult); }}
                    className="w-full flex items-center justify-center space-x-1.5 text-fine font-bold text-red-600 hover:text-red-700 border-0 bg-transparent cursor-pointer py-1"
                  >
                    <UserX className="w-3.5 h-3.5" />
                    <span>Mark as No-Show instead</span>
                  </button>
                </div>
              )}
            </form>
          </Card>
        )}

        {/* Attach Diagnostic Tests Modal */}
        <Dialog open={showTestsModal} onOpenChange={setShowTestsModal}>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Attach Diagnostic Tests to Visit</DialogTitle>
              <DialogDescription className="text-xs">
                Select tests requested for Visit ID #{selectedVisitId}.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAssignTestsSubmit} className="space-y-4 pt-2">
              <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-xl p-3 space-y-2 bg-gray-50/50">
                {testCatalog.map(t => (
                  <label key={t.id} className="flex items-center space-x-3 p-2 bg-white hover:bg-gray-50 rounded-lg cursor-pointer transition-colors border border-gray-100 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedTestIds.includes(t.id.toString())}
                      onChange={() => handleToggleTest(t.id.toString())}
                      className="rounded text-[#769046] focus:ring-[#769046]"
                    />
                    <div className="flex-1 flex justify-between items-center">
                      <span className="font-bold text-gray-800">{t.name} <span className="text-meta text-gray-400 font-normal">({t.category_name})</span></span>
                      <span className="font-extrabold text-slate-900">{formatCurrency(t.price)}</span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowTestsModal(false)}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={isAttachingTests || selectedTestIds.length === 0}
                  className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold"
                >
                  {isAttachingTests ? 'Attaching…' : 'Attach Selected Tests'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* HMO Pre-Authorization Logging Modal (Module 7: HMO request initiation) */}
        <Dialog open={showHmoModal} onOpenChange={(open) => { setShowHmoModal(open); if (!open) { setHmoError(''); } }}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Log HMO Pre-Authorization</DialogTitle>
              <DialogDescription className="text-xs">
                For <strong>{activeVisitTest?.test_name}</strong>. This logs the request for Admin review — it does not approve coverage on its own, even if a code is entered below.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleHmoSubmit} className="space-y-4 pt-2">
              {hmoError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{hmoError}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase">HMO Provider <span className="text-rose-600">*</span></label>
                <Select value={hmoProviderId} onValueChange={setHmoProviderId}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select HMO provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {hmoProviders.map(hmo => (
                      <SelectItem key={hmo.id} value={hmo.id.toString()}>
                        {hmo.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase">Card / LOA Number (if shown by patient)</label>
                <Input
                  placeholder="Enter the code shown on the HMO card or LOA"
                  value={hmoApprovalCode}
                  onChange={e => setHmoApprovalCode(e.target.value)}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowHmoModal(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold">Log HMO Request</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Check-in confirmation — one dialog for both check-in paths (QR/reference verify and
            existing-patient lookup), see .agents Phase 12 and UI/UX Phase 3 */}
        <ConfirmDialog
          open={!!checkInTarget}
          onOpenChange={(open) => { if (!open) setCheckInTarget(null); }}
          title="Confirm Check-In"
          description={
            checkInTarget?.type === 'appointment'
              ? `Check in ${checkInTarget.data.first_name} ${checkInTarget.data.last_name} (Queue ${checkInTarget.data.queue_number})? This confirms their appointment and moves them into processing.`
              : checkInTarget?.type === 'walkin'
              ? `Check in ${checkInTarget.data.first_name} ${checkInTarget.data.last_name} as a walk-in? This creates a new visit and queue ticket.`
              : ''
          }
          confirmLabel="Confirm Check-In"
          onConfirm={confirmCheckIn}
          loading={checkingIn}
          error={checkInError}
        />

        <ConfirmDialog
          open={!!cancelVisitTarget}
          onOpenChange={(open) => { if (!open) { setCancelVisitTarget(null); setCancelVisitError(''); } }}
          title="Cancel Visit"
          description={cancelVisitTarget && `Cancel the visit for ${cancelVisitTarget.first_name} ${cancelVisitTarget.last_name} (Queue ${cancelVisitTarget.queue_number})? This removes it from the active queue.`}
          confirmLabel="Cancel Visit"
          onConfirm={confirmCancelVisit}
          loading={cancelingVisit}
          error={cancelVisitError}
        />

        <ConfirmDialog
          open={!!noShowTarget}
          onOpenChange={(open) => { if (!open) { setNoShowTarget(null); setNoShowError(''); } }}
          title="Mark as No-Show"
          description={noShowTarget && `Mark ${noShowTarget.first_name} ${noShowTarget.last_name}'s appointment (Queue ${noShowTarget.queue_number}) as a no-show? This does not check them in.`}
          confirmLabel="Mark No-Show"
          onConfirm={confirmMarkNoShow}
          loading={markingNoShow}
          error={noShowError}
        />

      </div>
    </SidebarLayout>
  );
};

export default ReceptionistDashboard;
