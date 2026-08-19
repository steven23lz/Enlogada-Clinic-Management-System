import React, { useState, useEffect, useCallback, useRef } from 'react';
import SidebarLayout from '../../components/SidebarLayout';
import { usePolling } from '../../hooks/usePolling';
import { Button } from '../../components/ui/button';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { ToolbarSpacer } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import { SkeletonRows } from '../../components/ui/skeleton';
import MetricCard from '../../components/ui/metric-card';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { SearchInput } from '../../components/ui/search-input';
import { StatusBadge } from '../../components/ui/status-badge';
import Pagination from '../../components/ui/pagination';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import api from '../../config/api';
import { todayStr, formatDateTime } from '../../lib/date';
import { toastSuccess, toastError, toastInfo } from '../../lib/toast';
import QrScanner from '../../components/QrScanner';
import RescheduleDialog from '../../components/booking/RescheduleDialog';
import TestPicker from '../../components/booking/TestPicker';
import useOperationsReport from '../../hooks/useOperationsReport';
import { ReceptionThroughputPanel } from '../../components/reports/OperationsPanels';
import WalkInRegistration from '../../components/reception/WalkInRegistration';
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
  UserX,
  CalendarClock
} from 'lucide-react';

const PAGE_TITLES = {
  'reception-queue': 'Active Patient Queue',
  'reception-walkin': 'Walk-In Registration',
  'reception-checkin': 'Appointment Check-In',
  'reception-history': 'Visit History',
};

// One sentence per screen, written for someone in their first week on the desk. The four views
// previously opened straight onto a KPI strip or a bare form with nothing saying what the screen
// was for or how it related to the other three.
const PAGE_ICONS = {
  'reception-queue': UserCheck,
  'reception-walkin': UserPlus,
  'reception-checkin': QrCode,
  'reception-history': History,
};

const PAGE_BLURBS = {
  'reception-queue': "Everyone who has checked in today, in arrival order. Attach tests, print a ticket, or send a patient through to billing.",
  'reception-walkin': 'Register a patient who arrived without an appointment. Creates the patient record if they are new, then opens a visit.',
  'reception-checkin': 'Scan a booking pass or key in the reference code to turn a confirmed appointment into a live visit.',
  // Says what the screen does. It described itself as "Completed and cancelled visits" while
  // showing Pending and Processing ones too — findVisitsByDateRange is deliberately any-status,
  // so the copy was the half that was wrong. A receptionist looking a patient up does not know
  // what state the visit reached, which is usually why they are looking.
  'reception-history': 'Every visit in a chosen date range, whatever state it reached. Read-only.',
};
const VALID_VIEWS = Object.keys(PAGE_TITLES);
const QUEUE_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 25;

// scheduled_date arrives as a full ISO instant (pg parses the DATE column with the local-time
// constructor, then JSON serialises it to UTC). Formatting it back to a local calendar date is
// what every other screen in the app does; this one was interpolating it raw.
const formatScheduledDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const ReceptionistDashboard = ({ activeNav = 'reception-queue', onSelectNav }) => {
  // Any nav value this component doesn't recognize (e.g. a stale/default 'dashboard') falls
  // back to the primary queue view, mirroring DiagnosticDashboard's existing fallback pattern.
  const view = VALID_VIEWS.includes(activeNav) ? activeNav : 'reception-queue';
  // Desk performance, on Visit History where someone is reviewing rather than checking people
  // in. The queue KPIs count who is waiting; nothing measured how long they wait.
  const operations = useOperationsReport({ days: 7, enabled: view === 'reception-history' });
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
  // Paged at the server. [1.29.0] This screen fetched every visit in the range and rendered all
  // of them — no slice, no footer, the whole list straight into the DOM. Measured at 664 bytes a
  // visit, a year-wide range is a 3.6 MB response and roughly 5,700 table rows.
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
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
  // The verified booking currently open in the reschedule dialog, or null.
  const [reschedulingAppointment, setReschedulingAppointment] = useState(null);
  const [markingNoShow, setMarkingNoShow] = useState(false);
  const [noShowError, setNoShowError] = useState('');

  // Assign Tests Dialog State
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [showTestsModal, setShowTestsModal] = useState(false);
  const [isAttachingTests, setIsAttachingTests] = useState(false);

  // The visit whose queue slip is being printed. Held in state only for the duration of the
  // print dialog — see handlePrintTicket.
  const [ticketToPrint, setTicketToPrint] = useState(null);

  // Existing Patient Lookup State (Module 7: patient record lookup)
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState(null);
  const [patientSearching, setPatientSearching] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState('');
  const [lookupCheckInSuccess, setLookupCheckInSuccess] = useState('');

  // Walk-in Registration State

  // The form holds the patient type as an id; the referral rule is expressed in names. Resolved
  // here rather than comparing against a hardcoded id, which a reseed could renumber.
  // Manual HMO logging State
  const [showHmoModal, setShowHmoModal] = useState(false);
  const [activeVisitTest, setActiveVisitTest] = useState(null);
  const [hmoProviderId, setHmoProviderId] = useState('');
  const [hmoApprovalCode, setHmoApprovalCode] = useState('');
  const [hmoMemberNumber, setHmoMemberNumber] = useState('');
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

  const fetchVisitHistory = useCallback(async (startDate, endDate, search, page = 1) => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await api.get('/visits/history', {
        params: { startDate, endDate, search: search || undefined, page, limit: HISTORY_PAGE_SIZE }
      });
      const { visits, total, totalPages } = response.data.data;
      setHistoryVisits(visits || []);
      setHistoryTotal(total ?? (visits || []).length);
      setHistoryTotalPages(totalPages || 1);
      setHistoryPage(page);
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

  /**
   * Prints the physical queue slip the patient carries.
   *
   * This button used to call a bare `window.print()` on a view with no `.print-area` anywhere in
   * it. The rule in index.css hides `body *` and reveals only `.print-area`, so it produced a
   * completely blank sheet — on the one artefact the whole queue_number design assumes exists.
   *
   * The slip is rendered into a dedicated node rather than printed from the table row, because a
   * table row has none of the things a ticket needs: the number at a readable size, the patient's
   * name to hand it to the right person, and which departments they are going to.
   *
   * The print dialog is synchronous and blocks until dismissed, so the slip is cleared afterwards
   * rather than on a timer.
   */
  const handlePrintTicket = (visit) => {
    setTicketToPrint(visit);
    // Let React commit the slip before the browser snapshots the page for printing.
    requestAnimationFrame(() => {
      window.print();
      setTicketToPrint(null);
    });
  };

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
        // No notes. [1.29.0] This read `visitNotes`, which is the "Visit Notes / Referral Reason"
        // input belonging to the REGISTRATION form in the panel below — a form the receptionist
        // is not using when they check in a patient they just found by search. So a half-typed
        // registration note ended up attached to a returning patient's visit, silently and
        // against a patient the note was never about.
        //
        // It also tied two independent flows to one piece of ambient state, which is what made
        // this screen resist being split up. The coupling was the design pointing at the bug.
        const vRes = await api.post('/visits', {
          patientId: patient.id,
          visitType: 'Walk in',
        });
        const visit = vRes.data.data.visit;
        setLookupCheckInSuccess(`${patient.first_name} ${patient.last_name} checked in! Physical Queue Ticket: ${visit.queue_number}`);
        setPatientSearchResults(null);
        setPatientSearchQuery('');
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

    // The message named a field this check never looked at, and the LOA code is genuinely
    // optional — reception logs the claim, an Admin issues the code on approval.
    if (!activeVisitTest || !hmoProviderId) {
      setHmoError('Choose the HMO provider before logging the claim.');
      return;
    }

    try {
      await api.post('/hmo/request', {
        hmoProviderId: parseInt(hmoProviderId, 10),
        approvalCode: hmoApprovalCode,
        memberNumber: hmoMemberNumber,
        visitTestIds: [activeVisitTest.id]
      });

      toastSuccess('HMO Pre-authorization logged successfully!');
      setShowHmoModal(false);
      setHmoMemberNumber('');
      setHmoApprovalCode('');
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
      <div className="space-y-5">
        <PageHeader
          icon={PAGE_ICONS[view]}
          title={PAGE_TITLES[view]}
          description={PAGE_BLURBS[view]}
          actions={
            view === 'reception-queue' ? (
              <Button variant="outline" onClick={() => onSelectNav?.('reception-walkin')}>
                <UserPlus className="h-4 w-4" />
                Register Walk-In
              </Button>
            ) : undefined
          }
        />

        {staticDataError && (
          <div role="alert" className="alert alert-warning">
            <AlertCircle />
            <span>{staticDataError}</span>
            <button type="button" onClick={fetchStaticData} className="ml-auto cursor-pointer border-0 bg-transparent p-0 font-bold text-amber-900 underline underline-offset-2">Retry</button>
          </div>
        )}

        {view === 'reception-queue' && (
          <>
            {/* KPI Metrics Header */}
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <MetricCard label="Active Queue Visits" value={queueTotal} icon={UserCheck} tone="green" />
              <MetricCard label="Pending Intake" value={queuePendingCount} icon={Clock} tone="amber" />
              <MetricCard label="In Diagnostic" value={queueProcessingCount} icon={ClipboardList} tone="indigo" />
              <MetricCard label="Walk-Ins Today" value={queueWalkinCount} icon={UserPlus} tone="emerald" />
            </div>

            {/* UI/UX Modernization Phase 10: read-only visibility into pending HMO requests —
                approving one still happens from wherever it already does, this card only
                surfaces that they exist. */}
            {!hmoRequestsLoading && pendingHmoRequests.length > 0 && (
              <Panel tone="notice" className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 flex-shrink-0 text-amber-700" />
                  {/* A count in an alert banner is not a section heading — it was an <h3>, which
                      put a heading between the page title and the queue's own and broke the
                      outline for anyone navigating by heading. */}
                  <p className="m-0 text-fine font-semibold text-amber-900">
                    {pendingHmoRequests.length} pending HMO request{pendingHmoRequests.length === 1 ? '' : 's'} awaiting Admin approval
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {/* The patient, then the provider. These chips read "1CoopHealth • 1/2
                      approved" — five of them, identical, on a queue of five different people.
                      A receptionist standing in front of a patient asking "has mine come back
                      yet?" could not answer from this, which is the only question it is here
                      to answer. */}
                  {pendingHmoRequests.slice(0, 6).map(r => (
                    <span
                      key={r.id}
                      className="inline-flex items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-fine font-medium leading-5 text-amber-900 ring-1 ring-inset ring-amber-200"
                    >
                      <span className="font-semibold">
                        {r.patient_first_name ? `${r.patient_first_name} ${r.patient_last_name}` : r.provider_name}
                      </span>
                      <span className="text-amber-500">&bull;</span>
                      <span className="tabular-nums">{r.approved_test_count}/{r.test_count} approved</span>
                    </span>
                  ))}
                  {pendingHmoRequests.length > 6 && (
                    <span className="self-center text-fine font-semibold text-amber-700">+{pendingHmoRequests.length - 6} more</span>
                  )}
                </div>
              </Panel>
            )}

            <div>
              {/* Search + Status Filter Toolbar */}
              <Toolbar attached>
                <SearchInput
                  placeholder="Search patient name or Queue #..."
                  value={searchQuery}
                  onChange={e => handleQueueSearchChange(e.target.value)}
                  containerClassName="w-full sm:w-64"
                />

                <Select value={statusFilter} onValueChange={handleQueueStatusFilterChange}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Status Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All Statuses</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Processing">Processing</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
                <ToolbarSpacer />
                <span className="whitespace-nowrap text-fine font-medium text-slate-500 tabular-nums">
                  Showing {activeVisits.length} of {queueTotal} visit{queueTotal === 1 ? '' : 's'}
                </span>
              </Toolbar>

            {/* Active Queue Table */}
            <Panel className="overflow-hidden rounded-t-none">
              <PanelBody flush>
                <Table stack>
                  <TableHeader sticky>
                    <TableRow>
                      <TableHead>Queue Ticket</TableHead>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Visit Type</TableHead>
                      <TableHead>Patient Category</TableHead>
                      <TableHead>Assigned Tests</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueError ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0">
                          <EmptyState
                            tone="error"
                            icon={AlertCircle}
                            title="Couldn't load the queue"
                            description={queueError}
                            action={
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter })}
                              >
                                Try again
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : loading ? (
                      <SkeletonRows rows={6} columns={7} />
                    ) : activeVisits.length > 0 ? (
                      activeVisits.map(visit => (
                        <TableRow key={visit.id}>
                          <TableCell label="Queue Ticket">
                            <div className="flex items-center gap-1">
                              {/* The ticket number is the thing a receptionist calls out and a
                                  patient reads back, so it is set larger than the row around it
                                  rather than smaller — it was 12px in a row of 12px text. */}
                              <span className="rounded-md bg-slate-900 px-2 py-1 text-fine font-bold tabular-nums text-white">
                                {visit.queue_number || `V-${visit.id}`}
                              </span>
                              {/* aria-label as well as title: `title` alone is not a reliable
                                  accessible name and is invisible on touch, so a screen reader
                                  announced two unlabelled buttons on every queue row. */}
                              <button
                                onClick={() => speakQueueNumber(visit.queue_number)}
                                title="Call Queue Number"
                                aria-label={`Call queue number ${visit.queue_number}`}
                                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-brand-50 hover:text-brand-600"
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handlePrintTicket(visit)}
                                title={`Print queue ticket for ${visit.first_name} ${visit.last_name}`}
                                aria-label={`Print queue ticket for ${visit.first_name} ${visit.last_name}`}
                                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </TableCell>

                          <TableCell label="Patient Name" className="font-semibold text-slate-900">
                            {visit.first_name} {visit.last_name}
                            <span className="block font-mono text-micro font-normal text-slate-400">PT-{visit.patient_id}</span>
                          </TableCell>

                          <TableCell label="Visit Type">
                            <Badge variant="outline" className="text-slate-600">
                              {visit.visit_type}
                            </Badge>
                          </TableCell>

                          <TableCell label="Patient Category" className="text-slate-500">
                            {visit.patient_type_name}
                          </TableCell>

                          <TableCell label="Assigned Tests">
                            {visit.tests && visit.tests.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {visit.tests.map(t => (
                                  <span key={t.id} className="inline-flex items-center gap-0.5">
                                    <Badge variant="outline" className="text-slate-600">
                                      {t.test_name}
                                      <span className="ml-1 text-slate-400">({t.test_status})</span>
                                    </Badge>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenHmoModal(t)}
                                      title="Log HMO pre-authorization for this test"
                                      aria-label={`Log HMO pre-authorization for ${t.test_name}`}
                                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded border-0 bg-transparent text-slate-300 hover:bg-brand-50 hover:text-brand-600"
                                    >
                                      <ShieldAlert className="h-3 w-3" />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-fine text-slate-400">No tests attached</span>
                            )}
                          </TableCell>

                          <TableCell label="Status">
                            <StatusBadge status={visit.visit_status} />
                            {/* Where the ticket actually is, in the front desk's own terms.
                                'Pending' alone doesn't say whether reception or the cashier is
                                holding it up, which is the question this row exists to answer. */}
                            <span className="mt-1 block whitespace-nowrap text-micro font-medium text-slate-400">
                              {visit.visit_status === 'Pending'
                                ? 'With cashier'
                                : visit.visit_status === 'Processing'
                                  ? 'With department'
                                  : ''}
                            </span>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button onClick={() => handleOpenAssignTests(visit.id)} variant="outline" size="xs">
                                Attach Tests
                              </Button>
                              {!['Completed', 'Cancelled'].includes(visit.visit_status) && (
                                <button
                                  type="button"
                                  onClick={() => { setCancelVisitError(''); setCancelVisitTarget(visit); }}
                                  title="Cancel this visit"
                                  aria-label={`Cancel visit for ${visit.first_name} ${visit.last_name}`}
                                  className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={7} className="p-0">
                          <EmptyState
                            icon={UserCheck}
                            title={searchQuery || statusFilter !== 'All' ? 'No visits match this filter' : 'Nobody is waiting'}
                            description={
                              searchQuery || statusFilter !== 'All'
                                ? 'Clear the search or switch the status filter back to All.'
                                : 'The queue is clear. Register a walk-in or check in an appointment to start one.'
                            }
                            action={
                              !searchQuery && statusFilter === 'All' ? (
                                <Button size="sm" onClick={() => onSelectNav?.('reception-walkin')}>
                                  <UserPlus className="h-3.5 w-3.5" />
                                  Register Walk-In
                                </Button>
                              ) : undefined
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </PanelBody>
              <Pagination
                page={queuePage}
                totalPages={queueTotalPages}
                onPageChange={handleQueuePageChange}
                totalLabel={`${queueTotal} total`}
              />
            </Panel>
            </div>
          </>
        )}

        {view === 'reception-history' && (
          <div>
            <Toolbar attached>
              <SearchInput
                placeholder="Search patient or Queue #..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
                containerClassName="w-full sm:w-56"
              />
              <Input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)} className="w-[150px]" aria-label="History start date" />
              <span className="text-fine text-slate-400">to</span>
              <Input type="date" value={historyEndDate} onChange={e => setHistoryEndDate(e.target.value)} className="w-[150px]" aria-label="History end date" />
              <Button variant="outline" onClick={() => fetchVisitHistory(historyStartDate, historyEndDate, historySearch)}>
                <RefreshCw className="h-3.5 w-3.5" />
                Apply
              </Button>
              <ToolbarSpacer />
              <span className="whitespace-nowrap text-fine font-medium tabular-nums text-slate-500">
                {historyTotal} visit{historyTotal === 1 ? '' : 's'}
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
                    {historyError ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6} className="p-0">
                          <EmptyState
                            tone="error"
                            icon={AlertCircle}
                            title="Couldn't load visit history"
                            description={historyError}
                            action={
                              <Button variant="outline" size="sm" onClick={() => fetchVisitHistory(historyStartDate, historyEndDate, historySearch)}>
                                Try again
                              </Button>
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : historyLoading ? (
                      <SkeletonRows rows={6} columns={6} />
                    ) : historyVisits.length > 0 ? (
                      historyVisits.map(v => (
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
                page={historyPage}
                totalPages={historyTotalPages}
                onPageChange={(next) => fetchVisitHistory(historyStartDate, historyEndDate, historySearch, next)}
                total={historyTotal}
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
        )}

        {view === 'reception-walkin' && (
          <div className="space-y-4">

            {/* Existing Patient Lookup (Module 7: patient record lookup) */}
            <Panel className="max-w-3xl p-6">
              <div className="border-b border-[#e6ebf1] pb-3 mb-4">
                <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold tracking-tight text-slate-900">
                  <Users className="h-4 w-4 text-brand-600" />
                  <span>Find Existing Patient</span>
                </h2>
                <p className="mt-1 text-fine leading-relaxed text-slate-500">Search before registering — a returning patient should be checked in, not re-registered.</p>
              </div>

              {lookupCheckInSuccess && (
                <div role="status" className="mb-4 alert alert-success">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{lookupCheckInSuccess}</span>
                </div>
              )}
              {patientSearchError && (
                <div role="alert" className="mb-4 alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{patientSearchError}</span>
                </div>
              )}

              <form onSubmit={handlePatientSearch} className="flex space-x-2">
                <Input
                  aria-label="Search existing patients by name"
                  placeholder="Search by patient name..."
                  value={patientSearchQuery}
                  onChange={e => setPatientSearchQuery(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" className="bg-slate-900 hover:bg-slate-800 text-white" disabled={patientSearching}>
                  {patientSearching ? 'Searching...' : 'Search'}
                </Button>
              </form>

              {patientSearchResults && (
                <div className="mt-4 space-y-2">
                  {patientSearchResults.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-3">No matching patient records found. Register them as a new patient below.</p>
                  ) : (
                    patientSearchResults.map(patient => (
                      <div key={patient.id} className="flex items-center justify-between border border-[#e6ebf1] rounded-xl p-3 bg-slate-50/70">
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
                          className="text-fine font-bold rounded-lg flex items-center space-x-1.5 px-3 py-1.5"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Check In This Patient</span>
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </Panel>

            <WalkInRegistration
              patientTypes={patientTypes}
              testCatalog={testCatalog}
              onRegistered={() => fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter })}
            />
          </div>
        )}

        {view === 'reception-checkin' && (
          <Panel className="max-w-xl p-6">
            <div className="border-b border-[#e6ebf1] pb-3 mb-4">
              <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold tracking-tight text-slate-900">
                <QrCode className="h-4 w-4 text-brand-600" />
                <span>Verify Appointment Reference</span>
              </h2>
              <p className="mt-1 text-fine leading-relaxed text-slate-500">
                Scan or enter the appointment reference code (e.g. <code>APPT-XXXXX</code>) to check a patient in.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setScanMode(m => !m)}
              className="flex items-center space-x-1.5 text-fine font-bold text-brand-600 hover:text-[#657c3a] cursor-pointer mb-3"
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
                  aria-label="Appointment reference code"
                  placeholder="APPT-104928"
                  value={searchRef}
                  onChange={e => setSearchRef(e.target.value)}
                  className="text-xs rounded-xl"
                />
                <Button type="submit" className="text-xs font-bold px-4">
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
                <div role="status" className="alert alert-success">
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
                    {/* The API sends scheduled_date as a full ISO instant, so interpolating it
                        raw printed "2026-08-10T16:00:00.000Z" — unreadable, and one day behind
                        the real date on a UTC+8 clock. This is the screen where reception
                        confirms a booking is for today, so it was also the worst place for it. */}
                    <span className="font-bold text-gray-800">{formatScheduledDate(verifyResult.scheduled_date)} at {verifyResult.scheduled_time}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-gray-500 uppercase">Queue Ticket</span>
                    <Badge className="bg-brand-500 text-white font-extrabold">{verifyResult.queue_number}</Badge>
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
                    className="w-full font-bold py-2 rounded-xl"
                  >
                    Confirm Check-In Patient
                  </Button>

                  {/* The desk's half of rescheduling. This screen is where a receptionist already
                      has a booking in hand — from a scan, or from the reference a patient reads
                      out over the phone — so it is where "can I move this to Thursday?" gets
                      answered. Only offered while the booking is still Pending: once it is
                      Confirmed the patient is standing here, and a new date is not what is being
                      asked for. */}
                  {verifyResult.status === 'Pending' && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setReschedulingAppointment(verifyResult)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2 font-bold"
                    >
                      <CalendarClock className="h-3.5 w-3.5" />
                      <span>Reschedule this booking</span>
                    </Button>
                  )}

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
          </Panel>
        )}

        {/* Attach Diagnostic Tests Modal */}
        <Dialog open={showTestsModal} onOpenChange={setShowTestsModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Attach Diagnostic Tests to Visit</DialogTitle>
              <DialogDescription>
                Select tests requested for Visit ID #{selectedVisitId}.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleAssignTestsSubmit} className="space-y-4 pt-2">
              {/* Same control as the registration form below, so the two cannot drift on
                  grouping, the running total, or the preparation warning. */}
              <TestPicker
                tests={testCatalog}
                selectedIds={selectedTestIds}
                onToggle={handleToggleTest}
                disabled={isAttachingTests}
              />

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                <Button type="button" variant="outline" onClick={() => setShowTestsModal(false)}>Cancel</Button>
                <Button
                  type="submit"
                  disabled={isAttachingTests || selectedTestIds.length === 0}
                  className="font-bold"
                >
                  {isAttachingTests ? 'Attaching…' : 'Attach Selected Tests'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* HMO Pre-Authorization Logging Modal (Module 7: HMO request initiation) */}
        <Dialog open={showHmoModal} onOpenChange={(open) => { setShowHmoModal(open); if (!open) { setHmoError(''); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Log HMO Pre-Authorization</DialogTitle>
              <DialogDescription>
                For <strong>{activeVisitTest?.test_name}</strong>. This logs the request for Admin review — it does not approve coverage on its own, even if a code is entered below.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleHmoSubmit} className="space-y-4 pt-2">
              {hmoError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{hmoError}</span>
                </div>
              )}
              <div className="space-y-1.5">
                <label className="field-label" htmlFor="receptionistdashboard-hmo-provider">HMO Provider <span className="text-rose-600">*</span></label>
                <Select value={hmoProviderId} onValueChange={setHmoProviderId}>
                  <SelectTrigger className="rounded-xl" id="receptionistdashboard-hmo-provider">
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

              {/* Two fields, not one. This was a single box labelled "Card / LOA Number" writing
                  into approval_code — but a member number and an LOA code are different things
                  with different lifetimes. The member number is printed on the card and identifies
                  the patient to the provider forever; the LOA code is issued per claim when the
                  HMO approves it, and the Admin approval screen writes that same column. Typing a
                  member number here therefore filed it as an approval code on an unapproved claim.

                  The member number also had nowhere to live at all: it was legible only by opening
                  the card photo, and pruneHmoCards deletes those after 180 days while the claim
                  itself is kept for seven years. */}
              <div className="space-y-1.5">
                <label htmlFor="hmo-member-number" className="field-label">
                  Member number <span className="font-normal text-slate-400">(from the card)</span>
                </label>
                <Input
                  id="hmo-member-number"
                  placeholder="The patient's number with this provider"
                  value={hmoMemberNumber}
                  onChange={e => setHmoMemberNumber(e.target.value)}
                />
                <p className="m-0 text-fine text-slate-500">
                  What the provider looks the claim up by when you telephone them.
                </p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="hmo-loa-code" className="field-label">
                  LOA code <span className="font-normal text-slate-400">(only if they already have one)</span>
                </label>
                <Input
                  id="hmo-loa-code"
                  placeholder="Leave blank — an Admin fills this in on approval"
                  value={hmoApprovalCode}
                  onChange={e => setHmoApprovalCode(e.target.value)}
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                <Button type="button" variant="outline" onClick={() => setShowHmoModal(false)}>Cancel</Button>
                <Button type="submit" className="font-bold">Log HMO Request</Button>
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

        {/* Same dialog the patient sees on their own booking, so the receptionist on the phone and
            the patient on the app are working from one set of rules and one availability grid. */}
        <RescheduleDialog
          open={Boolean(reschedulingAppointment)}
          onOpenChange={(open) => { if (!open) setReschedulingAppointment(null); }}
          appointment={reschedulingAppointment}
          onRescheduled={(moved) => {
            // Keep the verified booking on screen showing its new time, rather than clearing the
            // panel and making the receptionist re-scan to confirm the move landed.
            setVerifyResult((prev) => (prev ? { ...prev, ...moved } : prev));
            toastSuccess('Appointment rescheduled.');
          }}
        />

        {/* The physical queue slip.
            Mounted only while printing, and `hidden` on screen — the @media print rule in
            index.css reveals .print-area and hides everything else, so this never appears in the
            dashboard itself. Rendering it unconditionally would put a stray ticket in the DOM of
            every screen and inside every other print job on this page. */}
        {ticketToPrint && (
          <div className="print-area hidden print:block" aria-hidden="true">
            <div style={{ textAlign: 'center', fontFamily: 'Outfit, sans-serif', padding: '24px' }}>
              <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Enlogada Ultrasound
              </div>
              <div style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#555' }}>
                &amp; Diagnostic Clinic
              </div>

              <div style={{ borderTop: '1px dashed #999', margin: '14px 0' }} />

              <div style={{ fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#555' }}>
                Queue Number
              </div>
              {/* Deliberately enormous: this is read across a waiting room, and it is the only
                  thing on the slip that matters at a glance. */}
              <div style={{ fontSize: '64px', fontWeight: 800, lineHeight: 1.1, letterSpacing: '0.04em' }}>
                {ticketToPrint.queue_number}
              </div>

              <div style={{ borderTop: '1px dashed #999', margin: '14px 0' }} />

              <div style={{ fontSize: '14px', fontWeight: 700 }}>
                {ticketToPrint.first_name} {ticketToPrint.last_name}
              </div>
              <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
                {ticketToPrint.visit_type} · {formatDateTime(ticketToPrint.created_at)}
              </div>

              {/* Where to go next. Without this the patient has a number and no idea which
                  department it is for, which is the question reception then answers by hand. */}
              {ticketToPrint.tests && ticketToPrint.tests.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: '#555' }}>
                    Proceed to
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>
                    {[...new Set(ticketToPrint.tests.map((t) => t.category_name))].join(' · ')}
                  </div>
                </div>
              )}

              <div style={{ borderTop: '1px dashed #999', margin: '14px 0' }} />
              <div style={{ fontSize: '9px', color: '#777' }}>
                Please keep this slip and wait for your number to be called.
              </div>
            </div>
          </div>
        )}
      </div>
    </SidebarLayout>
  );
};

export default ReceptionistDashboard;
