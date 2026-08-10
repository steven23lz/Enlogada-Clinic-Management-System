import React, { useState, useEffect, useCallback, useRef } from 'react';
import SidebarLayout from '../components/SidebarLayout';
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
import { validatePatientProfile } from '../validations/patientValidation';
import QrScanner from '../components/QrScanner';
import {
  Check,
  ClipboardList,
  UserCheck,
  ShieldAlert,
  FilePlus,
  UserPlus,
  QrCode,
  PlusCircle,
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
  RefreshCw
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
  const [showCheckInConfirm, setShowCheckInConfirm] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState('');

  // Assign Tests Dialog State
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [showTestsModal, setShowTestsModal] = useState(false);

  // Existing Patient Lookup State (Module 7: patient record lookup)
  const [patientSearchQuery, setPatientSearchQuery] = useState('');
  const [patientSearchResults, setPatientSearchResults] = useState(null);
  const [patientSearching, setPatientSearching] = useState(false);
  const [patientSearchError, setPatientSearchError] = useState('');
  const [checkingInPatientId, setCheckingInPatientId] = useState(null);
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
  const [hmoSuccess, setHmoSuccess] = useState('');

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
    try {
      const testsRes = await api.get('/tests');
      setTestCatalog(testsRes.data.data.tests || []);

      const typesRes = await api.get('/patients/types');
      setPatientTypes(typesRes.data.data.patientTypes || []);

      const hmoRes = await api.get('/hmo/providers');
      setHmoProviders(hmoRes.data.data.providers || []);
    } catch (err) {
      console.error('Failed to fetch static data:', err);
    }
  }, []);

  useEffect(() => {
    fetchActiveVisits({ page: 1, search: '', status: 'All' });
    fetchStaticData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchActiveVisits, fetchStaticData]);

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

  const handleCheckIn = () => {
    // Check-in advances both the appointment and visit status — require explicit
    // confirmation before it fires. See .agents Phase 12.
    setCheckInError('');
    setShowCheckInConfirm(true);
  };

  const confirmCheckIn = async (visitId, appointmentId) => {
    setCheckingIn(true);
    setCheckInError('');
    try {
      await api.patch(`/appointments/${appointmentId}/status`, { status: 'Confirmed' });
      await api.patch(`/visits/${visitId}/status`, { status: 'Processing' });
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
      setShowCheckInConfirm(false);
      setSearchRef('');
      setVerifyResult(null);
    } catch (err) {
      setCheckInError(err.response?.data?.message || 'Failed to check in patient');
      setShowCheckInConfirm(false);
    } finally {
      setCheckingIn(false);
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

  const handleCheckInExistingPatient = async (patient) => {
    setPatientSearchError('');
    setLookupCheckInSuccess('');
    setCheckingInPatientId(patient.id);
    try {
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
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
    } catch (err) {
      setPatientSearchError(err.response?.data?.message || 'Failed to check in existing patient.');
    } finally {
      setCheckingInPatientId(null);
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

    try {
      await api.post('/tests/visit-tests', {
        patientVisitId: selectedVisitId,
        testIds: selectedTestIds.map(id => parseInt(id, 10))
      });
      setShowTestsModal(false);
      fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to assign tests to visit');
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
    setHmoSuccess('');
    setShowHmoModal(true);
  };

  const handleHmoSubmit = async (e) => {
    e.preventDefault();
    setHmoError('');
    setHmoSuccess('');

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

      setHmoSuccess('HMO Pre-authorization logged successfully!');
      setTimeout(() => {
        setShowHmoModal(false);
        setHmoSuccess('');
        fetchActiveVisits({ page: queuePage, search: searchQuery, status: statusFilter });
      }, 1500);
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
      alert(`Calling Queue Number ${queueNum}`);
    }
  };

  return (
    <SidebarLayout title={PAGE_TITLES[view]} activeNav={view} onSelectNav={onSelectNav}>
      <div className="space-y-6">

        {view === 'reception-queue' && (
          <>
            {/* KPI Metrics Header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Active Queue Visits" value={queueTotal} icon={UserCheck} tone="green" />
              <MetricCard label="Pending Intake" value={queuePendingCount} icon={Clock} tone="amber" />
              <MetricCard label="In Diagnostic / Processing" value={queueProcessingCount} icon={ClipboardList} tone="indigo" />
              <MetricCard label="Walk-In Intake Today" value={queueWalkinCount} icon={UserPlus} tone="emerald" />
            </div>

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
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3">Queue Ticket</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3">Patient Name</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3">Visit Type</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3">Patient Category</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3">Assigned Tests</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3">Status</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase tracking-wider text-gray-500 py-3 text-right">Actions</TableHead>
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
                            <span className="block text-[10px] text-gray-400 font-normal">PT-{visit.patient_id}</span>
                          </TableCell>

                          <TableCell className="py-3 text-xs">
                            <Badge variant="outline" className="text-[10px] font-bold border-gray-200">
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
                                    <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100 text-[10px] font-semibold border-gray-200">
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
                              <span className="text-gray-400 text-[11px] italic">No tests attached</span>
                            )}
                          </TableCell>

                          <TableCell className="py-3">
                            <Badge className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                              visit.visit_status === 'Processing' ? 'bg-indigo-100 text-indigo-800' :
                              visit.visit_status === 'Completed' ? 'bg-emerald-100 text-emerald-800' :
                              'bg-amber-100 text-amber-800'
                            }`}>
                              {visit.visit_status}
                            </Badge>
                          </TableCell>

                          <TableCell className="py-3 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <Button
                                onClick={() => handleOpenAssignTests(visit.id)}
                                variant="outline"
                                className="text-[11px] font-bold border-gray-200 hover:bg-[#769046] hover:text-white rounded-lg py-1 px-2.5"
                              >
                                + Attach Tests
                              </Button>
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
                <p className="text-[11px] text-gray-500 mt-1">Look up past patient visits, of any status, by date range.</p>
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
                      <TableHead className="text-[10px] font-bold uppercase py-3">Queue Ticket</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase py-3">Patient</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase py-3">Visit Type</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase py-3">Tests</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase py-3">Status</TableHead>
                      <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Date</TableHead>
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
                            <span className="block text-[10px] text-gray-400 font-normal">{v.patient_type_name}</span>
                          </TableCell>
                          <TableCell className="py-3 text-xs">
                            <Badge variant="outline" className="text-[10px] font-bold border-gray-200">
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
                <p className="text-[11px] text-gray-500 mt-1">Search before registering — a returning patient should be checked in, not re-registered.</p>
              </div>

              {lookupCheckInSuccess && (
                <div role="status" className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                  <span>{lookupCheckInSuccess}</span>
                </div>
              )}
              {patientSearchError && (
                <div role="alert" className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center space-x-2">
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
                          <span className="block font-bold text-slate-900">{patient.first_name} {patient.last_name} <span className="text-[10px] text-gray-400 font-normal">PT-{patient.id}</span></span>
                          <span className="block text-gray-500">{patient.patient_type_name} &middot; DOB {new Date(patient.birthdate).toLocaleDateString()}</span>
                        </div>
                        <Button
                          type="button"
                          onClick={() => handleCheckInExistingPatient(patient)}
                          disabled={checkingInPatientId === patient.id}
                          className="bg-[#769046] hover:bg-[#657c3a] text-white text-[11px] font-bold rounded-lg flex items-center space-x-1.5 px-3 py-1.5"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>{checkingInPatientId === patient.id ? 'Checking In...' : 'Check In This Patient'}</span>
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
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{registrationError}</span>
                </div>
              )}

              <form onSubmit={handleWalkInRegister} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
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

                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1 col-span-2">
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

                <div className="grid grid-cols-2 gap-4">
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
              <p className="text-[11px] text-gray-500 mt-1">
                Scan or enter the appointment reference code (e.g. <code>APPT-XXXXX</code>) to check a patient in.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setScanMode(m => !m)}
              className="flex items-center space-x-1.5 text-[11px] font-bold text-[#769046] hover:text-[#657c3a] cursor-pointer mb-3"
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
                <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{verifyError}</span>
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

                  <Button
                    type="button"
                    onClick={handleCheckIn}
                    className="w-full bg-[#769046] hover:bg-[#657c3a] text-white font-bold py-2 rounded-xl"
                  >
                    Confirm Check-In Patient
                  </Button>
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
                      <span className="font-bold text-gray-800">{t.name} <span className="text-[10px] text-gray-400 font-normal">({t.category_name})</span></span>
                      <span className="font-extrabold text-slate-900">₱{parseFloat(t.price).toFixed(2)}</span>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowTestsModal(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold">Attach Selected Tests</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* HMO Pre-Authorization Logging Modal (Module 7: HMO request initiation) */}
        <Dialog open={showHmoModal} onOpenChange={(open) => { setShowHmoModal(open); if (!open) { setHmoError(''); setHmoSuccess(''); } }}>
          <DialogContent className="max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-bold text-slate-900">Log HMO Pre-Authorization</DialogTitle>
              <DialogDescription className="text-xs">
                For <strong>{activeVisitTest?.test_name}</strong>. This logs the initial HMO request; approval is confirmed separately once the provider responds.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleHmoSubmit} className="space-y-4 pt-2">
              {hmoError && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{hmoError}</span>
                </div>
              )}
              {hmoSuccess && (
                <div role="status" className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{hmoSuccess}</span>
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
                <label className="text-xs font-bold text-gray-600 uppercase">Approval / LOA Code (if already available)</label>
                <Input
                  placeholder="Enter approval or card LOA number"
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

        {/* Check-in confirmation — advances appointment + visit status, see .agents Phase 12 */}
        <ConfirmDialog
          open={showCheckInConfirm}
          onOpenChange={setShowCheckInConfirm}
          title="Confirm Check-In"
          description={verifyResult ? `Check in ${verifyResult.first_name} ${verifyResult.last_name} (Queue ${verifyResult.queue_number})? This confirms their appointment and moves them into processing.` : ''}
          confirmLabel="Confirm Check-In"
          onConfirm={() => confirmCheckIn(verifyResult.patient_visit_id, verifyResult.id)}
          loading={checkingIn}
          error={checkInError}
        />

      </div>
    </SidebarLayout>
  );
};

export default ReceptionistDashboard;
