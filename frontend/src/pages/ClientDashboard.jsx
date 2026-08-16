import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Panel } from '../components/ui/panel';
import Toolbar, { ToolbarSpacer } from '../components/ui/toolbar';
import EmptyState from '../components/ui/empty-state';
import { SearchInput } from '../components/ui/search-input';
import { SkeletonList } from '../components/ui/skeleton';
import MetricCard from '../components/ui/metric-card';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { StatusBadge } from '../components/ui/status-badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import Pagination from '../components/ui/pagination';
import BookingConfirmation from '../components/BookingConfirmation';
import api from '../config/api';
import { formatCurrency } from '../lib/currency';
import { toastError } from '../lib/toast';
import { validatePatientProfile } from '../validations/patientValidation';
import BookingPass from '../components/BookingPass';
import ResultDocument from '../components/ResultDocument';
import { 
  Activity, 
  Calendar, 
  Clock, 
  FileText, 
  PlusCircle, 
  CheckCircle, 
  AlertCircle, 
  Info, 
  ChevronRight, 
  UserPlus,
  ShieldCheck,
  Download,
  Eye,
  User,
  FlaskConical,
  Stethoscope,
  Scan,
  Printer,
  Sparkles,
  XCircle,
  CalendarClock,
  Receipt,
  Pencil,
  HeartPulse
} from 'lucide-react';

// Mirrors the 5 seeded test_categories rows exactly (database/schema.sql) so every
// category a client can actually have a result in gets a distinct, correct icon.
const CATEGORY_ICONS = {
  Ultrasound: <Stethoscope className="w-5 h-5" />,
  Xray: <Scan className="w-5 h-5" />,
  Laboratory: <FlaskConical className="w-5 h-5" />,
  '2D Echo': <HeartPulse className="w-5 h-5" />,
  ECG: <Activity className="w-5 h-5" />
};

// UI/UX Modernization Phase 4: My Appointments and Payment History are fetched in one shot with
// no server-side pagination, so a client-side page size over each already-fetched array is
// proportionate (VISUAL_IDENTITY.md §3a #11).
const LIST_PAGE_SIZE = 8;

// test_results.file_url is staff-entered free text with no format validation anywhere in the
// upload pipeline (see backend/src/controllers/resultController.js uploadResult). Rendered
// directly as an <a href>, an unvalidated value (e.g. a "javascript:" URI) would execute in the
// client's session — only allow schemes/paths that can never execute script.
const isSafeResultUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

// Phase B: a real uploaded file is served through an authenticated route, not a public URL — a
// bare <a href> can't carry the Authorization header, so this fetches the file as a blob (the
// `api` instance's request interceptor attaches the JWT) and opens it via a local object URL.
const downloadResultFile = async (visitTestId, originalName) => {
  try {
    const res = await api.get(`/results/${visitTestId}/file`, { responseType: 'blob' });
    const objectUrl = window.URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = originalName || 'result';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('Failed to download result file:', err);
    toastError('Failed to download the attachment. Please try again.');
  }
};

const ClientDashboard = ({ onNavigate }) => {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [testCatalog, setTestCatalog] = useState([]);
  const [patientTypes, setPatientTypes] = useState([]);
  const [hmoProviders, setHmoProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('All');
  const [searchFilter, setSearchFilter] = useState('');

  // New Profile Form
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileData, setNewProfileData] = useState({
    firstName: '',
    lastName: '',
    birthdate: '',
    sex: 'Male',
    address: '',
    contactNumber: '',
    emergencyContact: '',
    patientTypeId: ''
  });
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [addProfileError, setAddProfileError] = useState('');

  // Edit Profile Form (Module 4: Patient Management)
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [editProfileData, setEditProfileData] = useState({
    firstName: '',
    lastName: '',
    birthdate: '',
    sex: 'Male',
    address: '',
    contactNumber: '',
    emergencyContact: '',
    patientTypeId: ''
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editProfileError, setEditProfileError] = useState('');

  // Appointment Booking Wizard State
  const [showBooking, setShowBooking] = useState(false);
  const [bookingStep, setBookingStep] = useState(1);
  const [bookingData, setBookingData] = useState({
    scheduledDate: '',
    scheduledTime: '',
    notes: '',
    testIds: [],
    hmoProviderId: '',
    hmoApprovalCode: ''
  });

  // UI/UX Modernization Phase 10: holds the full confirmation payload (not just a success
  // string) so BookingConfirmation.jsx can render a durable QR/reference/queue-ticket card
  // instead of the old plain-text message that auto-closed after 4 seconds.
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [bookingError, setBookingError] = useState('');

  // Live slot availability for the selected date
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [dayIsOpen, setDayIsOpen] = useState(true);

  // My Appointments (Module 3: view/cancel own appointments)
  const [appointments, setAppointments] = useState([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [appointmentsPage, setAppointmentsPage] = useState(1);
  const [cancelTarget, setCancelTarget] = useState(null);
  // The report currently open in the inline viewer, or null. Held here rather than per-row so
  // only one blob is ever alive at a time — see the revoke note in ResultDocument.
  const [previewDoc, setPreviewDoc] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  // Payment History (Module 14: client-side payment visibility)
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [paymentHistoryLoading, setPaymentHistoryLoading] = useState(true);
  const [paymentHistoryPage, setPaymentHistoryPage] = useState(1);

  // Online payment (GCash / Maya). `gateway.available` is false whenever the deployment has no
  // merchant credentials configured, in which case no online-payment option is rendered at all
  // and the patient simply pays at the counter — the pre-existing behaviour.
  const [gateway, setGateway] = useState({ available: false, methods: [] });
  const [payingAppointmentId, setPayingAppointmentId] = useState(null);
  const [payError, setPayError] = useState('');

  const fetchProfiles = useCallback(async () => {
    try {
      const response = await api.get('/patients/my-profiles');
      const list = response.data.data.patients;
      setProfiles(list);
      if (list.length > 0 && !selectedProfileId) {
        setSelectedProfileId(list[0].id.toString());
      }
    } catch (err) {
      console.error('Failed to fetch patient profiles:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProfileId]);

  const fetchStaticData = useCallback(async () => {
    try {
      const testsRes = await api.get('/tests');
      setTestCatalog(testsRes.data.data.tests);
      
      const typesRes = await api.get('/patients/types');
      setPatientTypes(typesRes.data.data.patientTypes);

      const hmoRes = await api.get('/hmo/providers');
      setHmoProviders((hmoRes.data.data.providers || []).filter(p => p.is_active));
    } catch (err) {
      console.error('Failed to fetch catalog data:', err);
    }
  }, []);

  const fetchHistory = useCallback(async (patientId) => {
    try {
      const response = await api.get(`/results/history/${patientId}`);
      setHistory(response.data.data.results);
    } catch (err) {
      console.error('Failed to fetch diagnostic history:', err);
    }
  }, []);

  const fetchAppointments = useCallback(async () => {
    setAppointmentsLoading(true);
    try {
      const response = await api.get('/appointments/my-bookings');
      setAppointments(response.data.data.bookings || []);
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
    } finally {
      setAppointmentsLoading(false);
    }
  }, []);

  const fetchPaymentHistory = useCallback(async () => {
    setPaymentHistoryLoading(true);
    try {
      const response = await api.get('/payments/my-payments');
      setPaymentHistory(response.data.data.payments || []);
    } catch (err) {
      console.error('Failed to fetch payment history:', err);
    } finally {
      setPaymentHistoryLoading(false);
    }
  }, []);

  const fetchGatewayStatus = useCallback(async () => {
    try {
      const response = await api.get('/payments/gateway/status');
      setGateway(response.data.data.gateway || { available: false, methods: [] });
    } catch {
      // Treat any failure as "not available" — never offer a payment route we can't confirm.
      setGateway({ available: false, methods: [] });
    }
  }, []);

  // Redirects the browser to the provider's own hosted page (GCash / Maya). The visit is NOT
  // marked paid here or on return — only the signed provider webhook can do that — so this
  // function's job ends at the redirect.
  const handlePayOnline = async (appointment, method) => {
    setPayError('');
    setPayingAppointmentId(appointment.id);
    try {
      const response = await api.post('/payments/gateway/checkout', {
        patientVisitId: appointment.patient_visit_id,
        paymentMethod: method
      });
      window.location.href = response.data.data.checkout.checkoutUrl;
    } catch (err) {
      setPayError(err.response?.data?.message || `Could not start the ${method} payment. Please try again.`);
      setPayingAppointmentId(null);
    }
  };

  const fetchAvailability = useCallback(async (date) => {
    setSlotsLoading(true);
    try {
      const response = await api.get('/appointments/availability', { params: { date } });
      setAvailableSlots(response.data.data.slots || []);
      setDayIsOpen(response.data.data.isOpen);
    } catch (err) {
      console.error('Failed to fetch availability:', err);
      setAvailableSlots([]);
      setDayIsOpen(true);
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfiles();
    fetchStaticData();
    fetchAppointments();
    fetchPaymentHistory();
    fetchGatewayStatus();
  }, [fetchProfiles, fetchStaticData, fetchAppointments, fetchPaymentHistory, fetchGatewayStatus]);

  // Returning from the provider's hosted page. The URL flag is presentational only — it says
  // "the browser came back", not "the money arrived", and is deliberately not trusted to mark
  // anything paid. The authoritative update is the signed webhook, so we simply re-fetch and
  // let the server state speak. The query string is then stripped so a refresh doesn't replay
  // the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('payment');
    if (!outcome) return;

    if (outcome === 'success') {
      setPayError('');
      fetchAppointments();
      fetchPaymentHistory();
    } else if (outcome === 'cancelled') {
      setPayError('Payment was cancelled. Your booking is still reserved — you can pay again below or at the clinic.');
    }

    window.history.replaceState({}, '', window.location.pathname);
  }, [fetchAppointments, fetchPaymentHistory]);

  useEffect(() => {
    if (bookingData.scheduledDate) {
      fetchAvailability(bookingData.scheduledDate);
    } else {
      setAvailableSlots([]);
      setDayIsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingData.scheduledDate, fetchAvailability]);

  // If the previously selected time is no longer in the fresh slot list, clear it
  useEffect(() => {
    if (bookingData.scheduledTime && availableSlots.length > 0) {
      const stillAvailable = availableSlots.some(s => s.time === bookingData.scheduledTime && s.available);
      if (!stillAvailable) {
        setBookingData(prev => ({ ...prev, scheduledTime: '' }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSlots]);

  useEffect(() => {
    if (selectedProfileId) {
      fetchHistory(selectedProfileId);
      const active = profiles.find(p => p.id === parseInt(selectedProfileId, 10));
      setSelectedProfile(active || null);
    } else {
      setSelectedProfile(null);
      setHistory([]);
    }
  }, [selectedProfileId, profiles, fetchHistory]);

  const handleAddProfile = async (e) => {
    e.preventDefault();
    setAddProfileError('');

    const validationError = validatePatientProfile(newProfileData);
    if (validationError) {
      setAddProfileError(validationError);
      return;
    }

    setIsAddingProfile(true);
    try {
      const response = await api.post('/patients', newProfileData);
      const created = response.data.data.patient;
      setNewProfileData({
        firstName: '',
        lastName: '',
        birthdate: '',
        sex: 'Male',
        address: '',
        contactNumber: '',
        emergencyContact: '',
        patientTypeId: ''
      });
      setShowAddProfile(false);
      await fetchProfiles();
      setSelectedProfileId(created.id.toString());
    } catch (err) {
      setAddProfileError(err.response?.data?.message || 'Failed to create patient profile');
    } finally {
      setIsAddingProfile(false);
    }
  };

  // pg returns birthdate as a full ISO instant string (see Module 3 report for why) — convert
  // to the local calendar date an <input type="date"> expects, without a UTC day-shift.
  const toDateInputValue = (value) => {
    if (!value) return '';
    const d = new Date(value);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const handleOpenEditProfile = () => {
    if (!selectedProfile) return;
    setEditProfileError('');
    setEditProfileData({
      firstName: selectedProfile.first_name || '',
      lastName: selectedProfile.last_name || '',
      birthdate: toDateInputValue(selectedProfile.birthdate),
      sex: selectedProfile.sex || 'Male',
      address: selectedProfile.address || '',
      contactNumber: selectedProfile.contact_number || '',
      emergencyContact: selectedProfile.emergency_contact || '',
      patientTypeId: selectedProfile.patient_type_id ? selectedProfile.patient_type_id.toString() : ''
    });
    setShowEditProfile(true);
  };

  const handleEditProfile = async (e) => {
    e.preventDefault();
    setEditProfileError('');

    const validationError = validatePatientProfile(editProfileData);
    if (validationError) {
      setEditProfileError(validationError);
      return;
    }

    setIsEditingProfile(true);
    try {
      await api.put(`/patients/${selectedProfile.id}`, editProfileData);
      setShowEditProfile(false);
      await fetchProfiles();
    } catch (err) {
      setEditProfileError(err.response?.data?.message || 'Failed to update patient profile');
    } finally {
      setIsEditingProfile(false);
    }
  };

  const handleBookAppointment = async (e) => {
    e.preventDefault();
    setBookingError('');
    setBookingConfirmation(null);

    const { scheduledDate, scheduledTime, notes, testIds, hmoProviderId, hmoApprovalCode } = bookingData;
    if (!scheduledDate || !scheduledTime || testIds.length === 0) {
      setBookingError('Date, Time, and at least one diagnostic test are required.');
      return;
    }

    try {
      // 1. Create visit and appointment
      const response = await api.post('/appointments', {
        patientId: parseInt(selectedProfileId, 10),
        scheduledDate,
        scheduledTime,
        notes
      });

      const appt = response.data.data.appointment;

      // 2. Attach selected tests to visit
      const visitTestsRes = await api.post('/tests/visit-tests', {
        patientVisitId: appt.patient_visit_id,
        testIds: testIds.map(id => parseInt(id, 10))
      });

      // 3. Attach HMO request if selected
      if (hmoProviderId) {
        const visitTests = visitTestsRes.data.data.visitTests || [];
        if (visitTests.length > 0) {
          await api.post('/hmo/request', {
            hmoProviderId: parseInt(hmoProviderId, 10),
            approvalCode: hmoApprovalCode,
            visitTestIds: visitTests.map(vt => vt.id)
          });
        }
      }

      setBookingConfirmation({
        referenceCode: appt.appointment_reference,
        queueNumber: appt.queue_number,
        patientName: selectedProfile ? `${selectedProfile.first_name} ${selectedProfile.last_name}` : '',
        scheduledDate: formatAppointmentDate(bookingData.scheduledDate),
        scheduledTime: bookingData.scheduledTime
      });
      setBookingData({
        scheduledDate: '',
        scheduledTime: '',
        notes: '',
        testIds: [],
        hmoProviderId: '',
        hmoApprovalCode: ''
      });
      fetchHistory(selectedProfileId);
      fetchAppointments();
    } catch (err) {
      setBookingError(err.response?.data?.message || 'Failed to book appointment');
      if (err.response?.status === 409 && bookingData.scheduledDate) {
        fetchAvailability(bookingData.scheduledDate);
      }
    }
  };

  // The API always sends scheduled_date as a full ISO instant string (e.g.
  // "2026-08-10T16:00:00.000Z" — pg parses the SQL DATE column using the local-timezone
  // constructor server-side, then JSON serializes it to that UTC instant). new Date(...)
  // parses that instant correctly, and toLocaleDateString() converts it back to the
  // browser's local calendar date — no manual timezone arithmetic needed.
  const formatAppointmentDate = (value) => {
    if (!value) return '';
    return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const handleRequestCancelAppointment = (appointment) => {
    setCancelError('');
    setCancelTarget(appointment);
  };

  const confirmCancelAppointment = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    setCancelError('');
    try {
      await api.put(`/appointments/${cancelTarget.id}/cancel`);
      setCancelTarget(null);
      fetchAppointments();
    } catch (err) {
      setCancelError(err.response?.data?.message || 'Failed to cancel appointment.');
    } finally {
      setCancelling(false);
    }
  };

  const handleTestSelection = (testId) => {
    const isSelected = bookingData.testIds.includes(testId);
    setBookingData({
      ...bookingData,
      testIds: isSelected 
        ? bookingData.testIds.filter(id => id !== testId) 
        : [...bookingData.testIds, testId]
    });
  };

  const calculateTotalPrice = () => {
    return bookingData.testIds.reduce((total, id) => {
      const found = testCatalog.find(t => t.id.toString() === id);
      return total + (found ? parseFloat(found.price) : 0);
    }, 0);
  };

  const filteredHistory = history.filter(item => {
    const matchesCategory = filterCategory === 'All' || item.category_name === filterCategory;
    const matchesSearch = !searchFilter || 
      item.test_name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      item.category_name.toLowerCase().includes(searchFilter.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const pendingCount = history.filter(h => h.test_status === 'Pending' || h.test_status === 'Processing').length;
  const completedCount = history.filter(h => h.test_status === 'Completed').length;

  if (loading) {
    return (
      <DashboardLayout onNavigate={onNavigate} activeTab="dashboard">
        <div className="flex-1 flex flex-col items-center justify-center space-y-3 py-16">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-semibold text-gray-500">Loading your clinic patient profile...</span>
        </div>
      </DashboardLayout>
    );
  }

  // The API returns bookings newest-scheduled-date first, which buries the one booking the
  // patient can actually act on: a far-future cancelled booking outranks tomorrow's paid visit,
  // so a QR booking pass could sit pages deep behind rows that do nothing. Order by what the
  // patient needs — still-open bookings first (soonest first, since the next visit is the one
  // that matters), then closed ones (most recent first, as history).
  const isOpenBooking = (a) => a.status !== 'Cancelled' && a.status !== 'Completed';
  const sortedAppointments = [...appointments].sort((a, b) => {
    if (isOpenBooking(a) !== isOpenBooking(b)) return isOpenBooking(a) ? -1 : 1;
    const da = new Date(a.scheduled_date).getTime();
    const db = new Date(b.scheduled_date).getTime();
    return isOpenBooking(a) ? da - db : db - da;
  });

  const appointmentsTotalPages = Math.max(1, Math.ceil(sortedAppointments.length / LIST_PAGE_SIZE));
  const safeAppointmentsPage = Math.min(appointmentsPage, appointmentsTotalPages);
  const pagedAppointments = sortedAppointments.slice(
    (safeAppointmentsPage - 1) * LIST_PAGE_SIZE,
    safeAppointmentsPage * LIST_PAGE_SIZE
  );

  const paymentHistoryTotalPages = Math.max(1, Math.ceil(paymentHistory.length / LIST_PAGE_SIZE));
  const safePaymentHistoryPage = Math.min(paymentHistoryPage, paymentHistoryTotalPages);
  const pagedPaymentHistory = paymentHistory.slice(
    (safePaymentHistoryPage - 1) * LIST_PAGE_SIZE,
    safePaymentHistoryPage * LIST_PAGE_SIZE
  );

  return (
    <DashboardLayout onNavigate={onNavigate} activeTab="dashboard">
      <div className="flex flex-col space-y-6">
        
        {/* Top Active Profile Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white border border-[#e6ebf1] rounded-xl p-4 gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center font-bold">
              <User className="w-5 h-5" />
            </div>
            <div>
              <span className="field-label">Active Profile</span>
              {profiles.length > 0 ? (
                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                  <SelectTrigger className="w-64 border-0 p-0 font-bold text-slate-800 focus:ring-0 focus:outline-none bg-transparent">
                    <SelectValue placeholder="Select patient profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map(p => (
                      <SelectItem key={p.id} value={p.id.toString()}>
                        {p.first_name} {p.last_name} ({p.patient_type_name || 'Patient'})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-sm text-gray-500 font-medium italic">No profiles created yet</span>
              )}
            </div>
          </div>

          <Dialog open={showAddProfile} onOpenChange={(open) => { setShowAddProfile(open); if (!open) setAddProfileError(''); }}>
            <DialogTrigger asChild>
              <Button className="flex items-center space-x-2 rounded-xl font-bold text-xs shadow-sm cursor-pointer transition-all">
                <UserPlus className="w-4 h-4" />
                <span>Add Dependent Profile</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-slate-900">Create Patient Profile</DialogTitle>
                <DialogDescription>
                  Register a profile for yourself or a family dependent.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddProfile} className="space-y-4 pt-2">
                {addProfileError && (
                  <div role="alert" className="alert alert-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{addProfileError}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">First Name <span className="text-rose-600">*</span></label>
                    <Input
                      placeholder="Juan"
                      value={newProfileData.firstName}
                      onChange={e => setNewProfileData({...newProfileData, firstName: e.target.value})}
                      disabled={isAddingProfile}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Last Name <span className="text-rose-600">*</span></label>
                    <Input
                      placeholder="Dela Cruz"
                      value={newProfileData.lastName}
                      onChange={e => setNewProfileData({...newProfileData, lastName: e.target.value})}
                      disabled={isAddingProfile}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Birthdate <span className="text-rose-600">*</span></label>
                    <Input
                      type="date"
                      value={newProfileData.birthdate}
                      onChange={e => setNewProfileData({...newProfileData, birthdate: e.target.value})}
                      disabled={isAddingProfile}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Sex <span className="text-rose-600">*</span></label>
                    <Select
                      value={newProfileData.sex}
                      onValueChange={val => setNewProfileData({...newProfileData, sex: val})}
                      disabled={isAddingProfile}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Contact Number</label>
                    <Input
                      placeholder="09171234567"
                      value={newProfileData.contactNumber}
                      onChange={e => setNewProfileData({...newProfileData, contactNumber: e.target.value})}
                      disabled={isAddingProfile}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Patient Billing Category <span className="text-rose-600">*</span></label>
                    <Select
                      value={newProfileData.patientTypeId}
                      onValueChange={val => setNewProfileData({...newProfileData, patientTypeId: val})}
                      disabled={isAddingProfile}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {patientTypes.map(type => (
                          <SelectItem key={type.id} value={type.id.toString()}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Address</label>
                  <Input
                    placeholder="Barangay, City, Province"
                    value={newProfileData.address}
                    onChange={e => setNewProfileData({...newProfileData, address: e.target.value})}
                    disabled={isAddingProfile}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Emergency Contact</label>
                  <Input
                    placeholder="Name & Contact Number"
                    value={newProfileData.emergencyContact}
                    onChange={e => setNewProfileData({...newProfileData, emergencyContact: e.target.value})}
                    disabled={isAddingProfile}
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                  <Button type="button" variant="outline" onClick={() => setShowAddProfile(false)} disabled={isAddingProfile}>Cancel</Button>
                  <Button type="submit"  disabled={isAddingProfile}>
                    {isAddingProfile ? 'Saving...' : 'Save Profile'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Edit Profile Dialog (Module 4: Patient Management) */}
          <Dialog open={showEditProfile} onOpenChange={(open) => { setShowEditProfile(open); if (!open) setEditProfileError(''); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-slate-900">Edit Patient Profile</DialogTitle>
                <DialogDescription>
                  Update {selectedProfile?.first_name}'s details.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleEditProfile} className="space-y-4 pt-2">
                {editProfileError && (
                  <div role="alert" className="alert alert-error">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{editProfileError}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">First Name <span className="text-rose-600">*</span></label>
                    <Input
                      placeholder="Juan"
                      value={editProfileData.firstName}
                      onChange={e => setEditProfileData({...editProfileData, firstName: e.target.value})}
                      disabled={isEditingProfile}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Last Name <span className="text-rose-600">*</span></label>
                    <Input
                      placeholder="Dela Cruz"
                      value={editProfileData.lastName}
                      onChange={e => setEditProfileData({...editProfileData, lastName: e.target.value})}
                      disabled={isEditingProfile}
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Birthdate <span className="text-rose-600">*</span></label>
                    <Input
                      type="date"
                      value={editProfileData.birthdate}
                      onChange={e => setEditProfileData({...editProfileData, birthdate: e.target.value})}
                      disabled={isEditingProfile}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Sex <span className="text-rose-600">*</span></label>
                    <Select
                      value={editProfileData.sex}
                      onValueChange={val => setEditProfileData({...editProfileData, sex: val})}
                      disabled={isEditingProfile}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Male">Male</SelectItem>
                        <SelectItem value="Female">Female</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Contact Number</label>
                    <Input
                      placeholder="09171234567"
                      value={editProfileData.contactNumber}
                      onChange={e => setEditProfileData({...editProfileData, contactNumber: e.target.value})}
                      disabled={isEditingProfile}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-gray-600 uppercase">Patient Billing Category <span className="text-rose-600">*</span></label>
                    <Select
                      value={editProfileData.patientTypeId}
                      onValueChange={val => setEditProfileData({...editProfileData, patientTypeId: val})}
                      disabled={isEditingProfile}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {patientTypes.map(type => (
                          <SelectItem key={type.id} value={type.id.toString()}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Address</label>
                  <Input
                    placeholder="Barangay, City, Province"
                    value={editProfileData.address}
                    onChange={e => setEditProfileData({...editProfileData, address: e.target.value})}
                    disabled={isEditingProfile}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Emergency Contact</label>
                  <Input
                    placeholder="Name & Contact Number"
                    value={editProfileData.emergencyContact}
                    onChange={e => setEditProfileData({...editProfileData, emergencyContact: e.target.value})}
                    disabled={isEditingProfile}
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2 border-t border-[#e6ebf1]">
                  <Button type="button" variant="outline" onClick={() => setShowEditProfile(false)} disabled={isEditingProfile}>Cancel</Button>
                  <Button type="submit"  disabled={isEditingProfile}>
                    {isEditingProfile ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Hero Welcome Banner & Stats */}
        <div className="rail-gradient rail-grid relative overflow-hidden rounded-2xl border border-[#2b3a4d] p-6 text-white sm:p-8">
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-micro font-semibold uppercase tracking-[0.14em] text-brand-200 ring-1 ring-inset ring-white/10">
              <Sparkles className="h-3 w-3" />
              <span>Patient Portal</span>
            </div>

            <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
              <div className="space-y-1.5">
                <h1 className="m-0 text-2xl font-bold tracking-tight text-white md:text-3xl">
                  {selectedProfile ? `Welcome, ${selectedProfile.first_name}` : 'Welcome to Enlogada'}
                </h1>
                <p className="m-0 max-w-xl text-[13px] leading-relaxed text-slate-300">
                  Book Laboratory, Ultrasound and X-Ray appointments, follow a visit as it moves through the clinic, and download your certified reports.
                </p>
              </div>

              {/* Action Button */}
              <Dialog open={showBooking} onOpenChange={(open) => {
                setShowBooking(open);
                if (!open) {
                  setBookingStep(1);
                  setBookingError('');
                  setBookingConfirmation(null);
                }
              }}>
                <DialogTrigger asChild>
                  <Button size="lg" disabled={!selectedProfileId}>
                    <PlusCircle className="h-4 w-4" />
                    Book Schedule
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl">
                  {bookingConfirmation ? (
                    <BookingConfirmation
                      {...bookingConfirmation}
                      onClose={() => setShowBooking(false)}
                    />
                  ) : (
                    <>
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-slate-900">
                      Book Diagnostic Appointment
                    </DialogTitle>
                    <DialogDescription>
                      Schedule a diagnostic test for <strong>{selectedProfile?.first_name} {selectedProfile?.last_name}</strong>.
                    </DialogDescription>

                    {/* Visual Step Progress Bar */}
                    <div className="flex items-center justify-between pt-3 pb-1 border-b border-slate-100 my-2">
                      <div className={`flex items-center space-x-2 text-xs font-bold ${bookingStep === 1 ? 'text-brand-600' : 'text-slate-400'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-meta ${bookingStep === 1 ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-600'}`}>1</span>
                        <span>Select Tests</span>
                      </div>
                      <div className="h-[2px] flex-1 mx-3 bg-slate-200" />
                      <div className={`flex items-center space-x-2 text-xs font-bold ${bookingStep === 2 ? 'text-brand-600' : 'text-slate-400'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-meta ${bookingStep === 2 ? 'bg-brand-500 text-white' : 'bg-slate-200 text-slate-600'}`}>2</span>
                        <span>Schedule & HMO</span>
                      </div>
                    </div>
                  </DialogHeader>

                  <form onSubmit={handleBookAppointment} className="space-y-4 pt-2">
                    {bookingError && (
                      <div role="alert" className="bg-red-50 border border-red-100 text-red-600 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{bookingError}</span>
                      </div>
                    )}

                    {/* Step Indicators */}
                    <div className="flex items-center justify-between border-b border-[#e6ebf1] pb-3">
                      <button 
                        type="button"
                        onClick={() => setBookingStep(1)}
                        className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 1 ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        1. Schedule & Services
                      </button>
                      <button 
                        type="button"
                        onClick={() => setBookingStep(2)}
                        className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 2 ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        2. HMO / Payment Note
                      </button>
                    </div>

                    {bookingStep === 1 && (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="field-label">Date</label>
                          <Input
                            type="date"
                            value={bookingData.scheduledDate}
                            onChange={e => setBookingData({...bookingData, scheduledDate: e.target.value, scheduledTime: ''})}
                            required
                          />
                        </div>

                        {bookingData.scheduledDate && (
                          <div className="space-y-1.5">
                            <label className="field-label">Available Time</label>
                            {slotsLoading ? (
                              <div className="text-xs text-gray-400 font-semibold py-2">Loading available times...</div>
                            ) : !dayIsOpen ? (
                              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-semibold">
                                Clinic is closed on this date. Please choose another date.
                              </div>
                            ) : availableSlots.length === 0 ? (
                              <div className="text-xs text-gray-400 font-semibold py-2">No time slots configured for this date.</div>
                            ) : (
                              <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-0.5">
                                {availableSlots.map(slot => (
                                  <button
                                    key={slot.time}
                                    type="button"
                                    disabled={!slot.available}
                                    onClick={() => setBookingData({...bookingData, scheduledTime: slot.time})}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-all ${
                                      bookingData.scheduledTime === slot.time
                                        ? 'bg-brand-500 text-white border-brand-500'
                                        : slot.available
                                        ? 'bg-white text-slate-700 border-gray-200 hover:border-brand-500'
                                        : 'bg-gray-100 text-gray-300 border-[#e6ebf1] cursor-not-allowed line-through'
                                    }`}
                                  >
                                    {slot.time}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <label className="field-label">Select Diagnostic Tests</label>
                            <span className="text-xs font-extrabold text-brand-600">Total: {formatCurrency(calculateTotalPrice())}</span>
                          </div>
                          <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-xl p-2.5 space-y-2 bg-slate-50/70">
                            {testCatalog.map(test => (
                              <label key={test.id} className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors border border-transparent hover:border-[#e6ebf1]">
                                <input
                                  type="checkbox"
                                  checked={bookingData.testIds.includes(test.id.toString())}
                                  onChange={() => handleTestSelection(test.id.toString())}
                                  className="rounded text-brand-600 focus:ring-brand-500"
                                />
                                <div className="flex-1 flex justify-between items-center text-xs">
                                  <span className="font-bold text-gray-800">{test.name} <span className="text-meta text-gray-400 font-medium">({test.category_name})</span></span>
                                  <span className="font-extrabold text-slate-900">{formatCurrency(test.price)}</span>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button type="button"  onClick={() => setBookingStep(2)}>
                            Next: HMO & Notes &rarr;
                          </Button>
                        </div>
                      </div>
                    )}

                    {bookingStep === 2 && (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="field-label">HMO Provider (Optional)</label>
                          <Select
                            value={bookingData.hmoProviderId}
                            onValueChange={val => setBookingData({...bookingData, hmoProviderId: val})}
                          >
                            <SelectTrigger className="rounded-xl">
                              <SelectValue placeholder="Select HMO Provider if applicable" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Self-Pay / None</SelectItem>
                              {hmoProviders.map(hmo => (
                                <SelectItem key={hmo.id} value={hmo.id.toString()}>
                                  {hmo.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {bookingData.hmoProviderId && bookingData.hmoProviderId !== 'none' && (
                          <div className="space-y-1.5">
                            <label className="field-label">HMO Authorization / LOA Code</label>
                            <Input
                              placeholder="Enter approval or card LOA number"
                              value={bookingData.hmoApprovalCode}
                              onChange={e => setBookingData({...bookingData, hmoApprovalCode: e.target.value})}
                            />
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="field-label">Additional Clinical Notes</label>
                          <Input
                            placeholder="Physician referral notes or symptoms..."
                            value={bookingData.notes}
                            onChange={e => setBookingData({...bookingData, notes: e.target.value})}
                          />
                        </div>

                        <div className="flex justify-between pt-2 border-t border-[#e6ebf1]">
                          <Button type="button" variant="outline" onClick={() => setBookingStep(1)}>
                            &larr; Back
                          </Button>
                          <Button type="submit" className="font-bold">
                            Submit Schedule Request
                          </Button>
                        </div>
                      </div>
                    )}
                  </form>
                    </>
                  )}
                </DialogContent>
              </Dialog>
            </div>

            {/* Quick Metrics Bar inside Hero */}
            <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-5 md:grid-cols-4">
              <MetricCard variant="dark" label="Pending Requests" value={pendingCount} icon={Clock} tone="amber" />
              <MetricCard variant="dark" label="Completed Reports" value={completedCount} icon={CheckCircle} tone="emerald" />
              <MetricCard variant="dark" label="Total Test History" value={history.length} icon={FileText} tone="slate" />
              <MetricCard variant="dark" label="Billing Type" value={selectedProfile?.patient_type_name || 'Standard'} icon={Receipt} tone="green" />
            </div>

          </div>

        </div>

        {/* UI/UX Phase 1: previously one long stacked page with no way to jump to a section —
            Payment History sat 3rd of 3 cards in a compressed right sidebar, requiring a client
            to scroll past everything else to reach it (the exact complaint that prompted this
            restructure). Each section now gets its own full-width tab. */}
        <Tabs defaultValue="results" className="w-full space-y-4">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="results">Diagnostic Results</TabsTrigger>
            <TabsTrigger value="appointments">Appointments</TabsTrigger>
            <TabsTrigger value="payments">Payments</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>

          <TabsContent value="results" className="m-0 space-y-4">

            {/* Filter & Search Header */}
            <Toolbar>
              <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                <Activity className="h-4 w-4 text-brand-600" />
                Diagnostic History
              </span>
              <ToolbarSpacer />
              <SearchInput
                placeholder="Search test..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                containerClassName="w-full sm:w-48"
              />

                <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg bg-slate-100 p-0.5">
                  {/* Mirrors the 5 seeded test_categories rows exactly (database/schema.sql) —
                      previously only 3 of 5 were filterable, silently hiding 2D Echo/ECG results. */}
                  {['All', 'Laboratory', 'Ultrasound', 'Xray', '2D Echo', 'ECG'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`cursor-pointer rounded-[7px] border-0 px-2.5 py-1.5 text-fine font-semibold transition-colors ${
                        filterCategory === cat
                          ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgb(15_23_42_/_0.08)]'
                          : 'bg-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
            </Toolbar>

            {/* Test Cards List */}
            <div className="space-y-3">
              {filteredHistory.length > 0 ? (
                filteredHistory.map(item => (
                  <Card key={item.visit_test_id} className="border-[#e6ebf1] rounded-xl hover:shadow-md transition-all">
                    <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start space-x-3.5">
                        <div className="w-10 h-10 bg-gray-50 border border-gray-200/80 rounded-xl flex items-center justify-center flex-shrink-0 text-brand-600">
                          {CATEGORY_ICONS[item.category_name] || <FlaskConical className="w-5 h-5" />}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-meta text-gray-400 font-bold uppercase tracking-wider">REQ-{item.visit_test_id}</span>
                            <StatusBadge status={item.test_status} className="text-meta px-2 py-0.5" />
                          </div>
                          <h3 className="font-bold text-slate-900 text-sm m-0">
                            {item.category_name} - {item.test_name}
                          </h3>
                          <div className="flex items-center space-x-3 text-xs text-gray-500">
                            <span className="flex items-center space-x-1">
                              <Calendar className="w-3.5 h-3.5" />
                              <span>{new Date(item.visit_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </span>
                            <span className="flex items-center space-x-1">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{new Date(item.visit_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Action Modal Trigger */}
                      {item.test_status === 'Completed' ? (
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              className="border-brand-500 text-brand-600 hover:bg-brand-50 text-xs font-bold px-4 rounded-xl flex items-center space-x-1.5 cursor-pointer"
                            >
                              <CheckCircle className="w-4 h-4" />
                              <span>View Certificate Report</span>
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">

                          <div className="print-area space-y-4">
                            {/* Official Lab Report Simulation Header */}
                            <div className="border-b border-gray-200 pb-4 text-center space-y-1">
                              <h2 className="text-base font-extrabold text-slate-900 uppercase tracking-wide m-0">ENLOGADA ULTRASOUND & DIAGNOSTIC CLINIC</h2>
                              <p className="text-fine text-gray-500 font-semibold m-0">Official Diagnostic Examination Report</p>
                              <span className="text-meta text-brand-600 font-bold block">CONFIDENTIAL MEDICAL DOCUMENT</span>
                            </div>

                            {/* Patient Info Summary Block */}
                            <div className="bg-gray-50 border border-[#e6ebf1] rounded-xl p-3.5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                              <div>
                                <span className="text-gray-400 font-bold text-meta uppercase block">Patient Name</span>
                                <span className="font-bold text-slate-900">{selectedProfile?.first_name} {selectedProfile?.last_name}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 font-bold text-meta uppercase block">Examination</span>
                                <span className="font-bold text-slate-900">{item.test_name}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 font-bold text-meta uppercase block">Category</span>
                                <span className="font-bold text-slate-900">{item.category_name}</span>
                              </div>
                            </div>

                            {/* Findings Body */}
                            <div className="space-y-3 pt-2">
                              <div className="space-y-1">
                                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider m-0">Clinical Findings & Impression</h4>
                                <div className="p-4 bg-white border border-gray-200 rounded-xl text-xs leading-relaxed text-gray-800 whitespace-pre-line min-h-[100px]">
                                  {item.findings || 'No specific clinical findings recorded.'}
                                </div>
                              </div>

                              {item.remarks && (
                                <div className="border-l-4 border-brand-500 pl-3 py-1">
                                  <h4 className="text-fine font-bold text-gray-500 uppercase m-0">Remarks</h4>
                                  <p className="text-xs text-gray-700 m-0">{item.remarks}</p>
                                </div>
                              )}

                              {(item.file_path || item.file_url) && (
                                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
                                  <span className="flex items-center gap-2">
                                    <FileText className="h-4 w-4 text-brand-600" />
                                    <span className="text-fine font-semibold text-slate-800">
                                      {item.file_original_name || 'Attached report'}
                                    </span>
                                  </span>
                                  {item.file_path ? (
                                    // View, not download. The patient is already looking at the
                                    // summary; making them save a file to read the report itself
                                    // is a step that exists only because nothing rendered it.
                                    <span className="flex items-center gap-1.5">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="xs"
                                        onClick={() => setPreviewDoc({
                                          visitTestId: item.visit_test_id,
                                          testName: item.test_name,
                                          patientName: `${selectedProfile?.first_name || ''} ${selectedProfile?.last_name || ''}`.trim(),
                                          fileName: item.file_original_name,
                                        })}
                                      >
                                        <Eye className="h-3 w-3" />
                                        View Report
                                      </Button>
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        onClick={() => downloadResultFile(item.visit_test_id, item.file_original_name)}
                                      >
                                        <Download className="h-3 w-3" />
                                        Download
                                      </Button>
                                    </span>
                                  ) : isSafeResultUrl(item.file_url) ? (
                                    <a
                                      href={item.file_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center gap-1 text-fine font-semibold text-brand-700 hover:underline"
                                    >
                                      <Download className="h-3 w-3" />
                                      Open attachment
                                    </a>
                                  ) : (
                                    <span className="text-fine font-semibold text-amber-700">Attachment link unavailable</span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Footer Release Stamp */}
                            <div className="pt-4 border-t border-[#e6ebf1] text-fine">
                              <span className="text-gray-400 font-medium">Released: {new Date(item.released_at).toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="flex justify-end pt-2">
                            <Button
                              onClick={() => window.print()}
                              variant="outline"
                              className="text-xs font-bold flex items-center space-x-1.5"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              <span>Print Official Copy</span>
                            </Button>
                          </div>

                          </DialogContent>
                        </Dialog>
                      ) : (
                        <Button 
                          variant="ghost" 
                          className="text-gray-500 hover:bg-gray-100 text-xs font-bold px-3 rounded-xl flex items-center space-x-1"
                        >
                          <span>Details</span>
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <Card className="border-dashed border-gray-200 bg-transparent text-center p-8 rounded-2xl">
                  <Info className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-gray-500">No diagnostic requests found matching the current filters.</p>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* My Appointments (Module 3: view/cancel own appointments) — full width now, no
              more max-h scroll-box compression forced by sharing a column with two other
              cards. */}
          <TabsContent value="appointments" className="m-0">
            <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden max-w-2xl">
              <CardHeader className="bg-slate-50/80 border-b border-[#e6ebf1] py-3.5">
                <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <CalendarClock className="w-4 h-4 text-brand-600" />
                  <span>My Appointments</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {payError && (
                  <div role="alert" className="alert alert-error">
                    <XCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{payError}</span>
                  </div>
                )}
                {appointmentsLoading ? (
                  <p className="text-xs text-gray-400 text-center py-4">Loading appointments…</p>
                ) : appointments.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4 italic">No appointments booked yet.</p>
                ) : (
                  pagedAppointments.map((appt) => {
                    const isCancellable = appt.status === 'Pending' || appt.status === 'Confirmed';
                    const isOpen = appt.status !== 'Cancelled' && appt.status !== 'Completed';
                    // The pass shows for any live booking, paid or not.
                    //
                    // It used to require payment first — "that is what makes it a pass". The
                    // reasoning sounded right and the effect was to disable the feature: this
                    // clinic takes most payments at the counter, so the large majority of
                    // bookings never got a QR at all, and the receptionist's scanner had almost
                    // nothing to read. GET /appointments/verify/:reference has always resolved a
                    // reference regardless of payment, so the scan worked; the patient simply had
                    // no code to present.
                    //
                    // Nothing is disclosed by showing it. The payload is the appointment
                    // reference, which is already printed as text underneath and is useless
                    // without a staff account to verify it against (see BookingPass.jsx).
                    // Payment is a separate fact, said separately below.
                    const showPass = isOpen;
                    const showPayOptions = isOpen && !appt.is_paid && gateway.available;
                    return (
                      <div key={appt.id} className="border border-[#e6ebf1] rounded-xl p-3 space-y-2 bg-slate-50/70">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="block text-xs font-extrabold text-slate-900">
                              {formatAppointmentDate(appt.scheduled_date)}
                            </span>
                            <span className="block text-fine text-gray-500 font-medium">{appt.scheduled_time?.slice(0, 5)}</span>
                          </div>
                          <StatusBadge status={appt.status} />
                        </div>

                        {showPass ? (
                          <BookingPass
                            reference={appt.appointment_reference}
                            queueNumber={appt.queue_number}
                            isPaid={appt.is_paid}
                          />
                        ) : (
                          <span className="block font-mono text-micro text-slate-400">{appt.appointment_reference}</span>
                        )}

                        {showPayOptions && (
                          <div className="space-y-2 pt-1">
                            <p className="text-fine text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 m-0">
                              Payment is required before your visit. Once paid, your QR booking pass appears
                              here — show it at the front desk on arrival.
                            </p>
                            <div className="flex gap-2">
                              {gateway.methods.map((method) => (
                                <Button
                                  key={method}
                                  type="button"
                                  disabled={payingAppointmentId === appt.id}
                                  onClick={() => handlePayOnline(appt, method)}
                                  className="flex-1 text-fine font-bold rounded-lg py-1.5"
                                >
                                  {payingAppointmentId === appt.id ? 'Redirecting…' : `Pay with ${method}`}
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}

                        {isOpen && !appt.is_paid && !gateway.available && (
                          <p className="text-fine text-gray-500 bg-gray-100 border border-gray-200 rounded-lg p-2 m-0">
                            Please settle payment at the clinic counter on arrival. Your reference code above
                            is what the receptionist needs to check you in.
                          </p>
                        )}

                        {isCancellable && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleRequestCancelAppointment(appt)}
                            className="w-full text-fine font-bold text-rose-600 border-rose-200 hover:bg-rose-50 rounded-lg py-1.5 flex items-center justify-center space-x-1.5"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Cancel Appointment</span>
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
              {appointments.length > 0 && (
                <Pagination
                  page={safeAppointmentsPage}
                  totalPages={appointmentsTotalPages}
                  onPageChange={setAppointmentsPage}
                  totalLabel={`${appointments.length} total`}
                />
              )}
            </Card>
          </TabsContent>

          {/* Payment History (Module 14: client-side payment visibility) — the exact section
              the "scroll to find payments" complaint was about; now its own full-width tab
              instead of 3rd-of-3 in a compressed sidebar. */}
          <TabsContent value="payments" className="m-0">
            {/* data-testid, because payment.spec.js needs to scope its assertions to this panel
                and was doing it by walking up to the nearest element with a `rounded-2xl` class.
                That coupled a passing test to a corner radius: changing the radius broke the
                spec, and the spec's failure said nothing about payments. */}
            <Panel data-testid="payment-history" className="max-w-2xl overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[#e6ebf1] bg-slate-50/70 px-5 py-3.5">
                <Receipt className="h-4 w-4 text-brand-600" />
                <h3 className="m-0 text-[13px] font-semibold text-slate-900">Payment History</h3>
              </div>
              <div className="space-y-2 p-4">
                {paymentHistoryLoading ? (
                  <SkeletonList rows={3} />
                ) : paymentHistory.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Receipt}
                    title="No payments yet"
                    description="Receipts appear here once the clinic has settled a visit for you."
                  />
                ) : (
                  pagedPaymentHistory.map((pay) => (
                    <div key={pay.id} className="rounded-lg border border-[#e6ebf1] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="block text-[15px] font-bold tabular-nums text-slate-900">{formatCurrency(pay.amount)}</span>
                          <span className="block text-fine text-slate-500">{pay.patient_first_name} {pay.patient_last_name}</span>
                        </div>
                        <StatusBadge status={pay.payment_status} />
                      </div>
                      <div className="mt-1.5 flex items-center justify-between text-micro text-slate-400">
                        <span className="font-mono">{pay.receipt_number || `OR-${pay.id}`}</span>
                        <span>{new Date(pay.paid_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {paymentHistory.length > 0 && (
                <Pagination
                  page={safePaymentHistoryPage}
                  totalPages={paymentHistoryTotalPages}
                  onPageChange={setPaymentHistoryPage}
                  totalLabel={`${paymentHistory.length} total`}
                />
              )}
            </Panel>
          </TabsContent>

          {/* Patient Profile Summary + HMO info — grouped under one Profile tab */}
          <TabsContent value="profile" className="m-0 space-y-4 max-w-2xl">
            {selectedProfile && (
              <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
                <CardHeader className="bg-slate-50/80 border-b border-[#e6ebf1] py-3.5 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                    <User className="w-4 h-4 text-brand-600" />
                    <span>Patient Profile Summary</span>
                  </CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleOpenEditProfile}
                    aria-label="Edit patient profile"
                    className="h-7 w-7 p-0 border-gray-200 text-gray-500 hover:text-brand-600 hover:border-brand-500 rounded-lg"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  <div className="flex justify-between items-center text-xs border-b border-gray-50 pb-2">
                    <span className="text-gray-500 font-medium">Patient ID:</span>
                    <span className="font-extrabold text-slate-900">PT-{selectedProfile.id}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-gray-50 pb-2">
                    <span className="text-gray-500 font-medium">Birthdate:</span>
                    <span className="font-bold text-slate-900">
                      {new Date(selectedProfile.birthdate).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs border-b border-gray-50 pb-2">
                    <span className="text-gray-500 font-medium">Contact:</span>
                    <span className="font-bold text-slate-900">{selectedProfile.contact_number || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs pb-1">
                    <span className="text-gray-500 font-medium">Category:</span>
                    <Badge variant="secondary" className="font-bold text-meta bg-brand-50 text-brand-600">
                      {selectedProfile.patient_type_name}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* HMO Coverage Info Card */}
            <Card className="border-[#e6ebf1] bg-rail text-white rounded-2xl overflow-hidden p-5 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 text-brand-600">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white m-0">HMO Accreditation</h3>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">
                Enlogada Clinic is partnered with accredited HMO providers like <strong>1CoopHealth</strong>. Present your HMO LOA or Approval Code during booking.
              </p>
            </Card>
          </TabsContent>

        </Tabs>

        {/* Cancel appointment confirmation */}
        <ConfirmDialog
          open={!!cancelTarget}
          onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
          title="Cancel Appointment"
          description={cancelTarget ? `Cancel your appointment on ${formatAppointmentDate(cancelTarget.scheduled_date)} at ${cancelTarget.scheduled_time?.slice(0, 5)}? This cannot be undone.` : ''}
          confirmLabel="Cancel Appointment"
          cancelLabel="Keep Appointment"
          onConfirm={confirmCancelAppointment}
          loading={cancelling}
          error={cancelError}
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

    </DashboardLayout>
  );
};

export default ClientDashboard;
