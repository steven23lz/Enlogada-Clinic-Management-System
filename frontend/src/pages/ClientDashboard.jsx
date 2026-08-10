import React, { useState, useEffect, useCallback } from 'react';
import DashboardLayout from '../components/DashboardLayout';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { StatusBadge } from '../components/ui/status-badge';
import api from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { validatePatientProfile } from '../validations/patientValidation';
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
  Search,
  User,
  FlaskConical,
  Stethoscope,
  Scan,
  Printer,
  Sparkles,
  XCircle,
  CalendarClock,
  Pencil
} from 'lucide-react';

const ClientDashboard = ({ onNavigate }) => {
  const { user } = useAuth();
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

  const [bookingSuccess, setBookingSuccess] = useState('');
  const [bookingError, setBookingError] = useState('');

  // Live slot availability for the selected date
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [dayIsOpen, setDayIsOpen] = useState(true);

  // My Appointments (Module 3: view/cancel own appointments)
  const [appointments, setAppointments] = useState([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

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
      setHmoProviders(hmoRes.data.data.providers || []);
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
  }, [fetchProfiles, fetchStaticData, fetchAppointments]);

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
    setBookingSuccess('');

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
          await api.post('/hmo/requests', {
            hmoProviderId: parseInt(hmoProviderId, 10),
            approvalCode: hmoApprovalCode,
            visitTestIds: visitTests.map(vt => vt.id)
          });
        }
      }

      setBookingSuccess(`Appointment booked successfully! Reference Code: ${appt.appointment_reference}. Physical Queue Ticket: ${appt.queue_number}`);
      setBookingData({
        scheduledDate: '',
        scheduledTime: '',
        notes: '',
        testIds: [],
        hmoProviderId: '',
        hmoApprovalCode: ''
      });
      setBookingStep(1);
      fetchHistory(selectedProfileId);
      fetchAppointments();
      setTimeout(() => {
        setShowBooking(false);
        setBookingSuccess('');
      }, 4000);
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

  const getStatusColor = (status) => {
    switch (status) {
      case 'Completed': return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'Pending': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'Processing': return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'Approved': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'Cancelled': return 'bg-rose-100 text-rose-800 border-rose-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
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
          <div className="w-10 h-10 border-4 border-[#769046] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm font-semibold text-gray-500">Loading your clinic patient profile...</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout onNavigate={onNavigate} activeTab="dashboard">
      <div className="flex flex-col space-y-6">
        
        {/* Top Active Profile Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-white border border-gray-100 rounded-2xl p-4 shadow-xs gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-[#769046]/10 text-[#769046] flex items-center justify-center font-bold">
              <User className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Active Profile Profile</span>
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
              <Button className="bg-[#769046] hover:bg-[#657c3a] text-white flex items-center space-x-2 rounded-xl font-bold text-xs shadow-sm cursor-pointer transition-all">
                <UserPlus className="w-4 h-4" />
                <span>Add Dependent Profile</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-slate-900">Create Patient Profile</DialogTitle>
                <DialogDescription className="text-xs">
                  Register a profile for yourself or a family dependent.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddProfile} className="space-y-4 pt-2">
                {addProfileError && (
                  <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{addProfileError}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2">
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

                <div className="grid grid-cols-2 gap-3">
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

                <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                  <Button type="button" variant="outline" onClick={() => setShowAddProfile(false)} disabled={isAddingProfile}>Cancel</Button>
                  <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white" disabled={isAddingProfile}>
                    {isAddingProfile ? 'Saving...' : 'Save Profile'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {/* Edit Profile Dialog (Module 4: Patient Management) */}
          <Dialog open={showEditProfile} onOpenChange={(open) => { setShowEditProfile(open); if (!open) setEditProfileError(''); }}>
            <DialogContent className="max-w-lg rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-lg font-bold text-slate-900">Edit Patient Profile</DialogTitle>
                <DialogDescription className="text-xs">
                  Update {selectedProfile?.first_name}'s details.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleEditProfile} className="space-y-4 pt-2">
                {editProfileError && (
                  <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span>{editProfileError}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
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

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5 col-span-2">
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

                <div className="grid grid-cols-2 gap-3">
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

                <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                  <Button type="button" variant="outline" onClick={() => setShowEditProfile(false)} disabled={isEditingProfile}>Cancel</Button>
                  <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white" disabled={isEditingProfile}>
                    {isEditingProfile ? 'Saving...' : 'Save Changes'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Hero Welcome Banner & Stats */}
        <div className="bg-[#192534] text-white rounded-3xl p-8 relative overflow-hidden shadow-lg border border-slate-800">
          <div className="relative z-10 space-y-4">
            <div className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold text-[#769046]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Enlogada Diagnostic Patient Portal</span>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-1">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight m-0 text-white">
                  {selectedProfile ? `Welcome, ${selectedProfile.first_name} ${selectedProfile.last_name}!` : `Welcome to Enlogada!`}
                </h1>
                <p className="text-gray-300 text-xs md:text-sm max-w-xl leading-relaxed">
                  Book appointment schedules for Laboratory, Ultrasound, and X-Ray tests, check live visit statuses, and access certified diagnostic reports.
                </p>
              </div>

              {/* Action Button */}
              <Dialog open={showBooking} onOpenChange={(open) => {
                setShowBooking(open);
                if (!open) {
                  setBookingStep(1);
                  setBookingError('');
                  setBookingSuccess('');
                }
              }}>
                <DialogTrigger asChild>
                  <Button 
                    disabled={!selectedProfileId}
                    className="bg-[#769046] hover:bg-[#657c3a] text-white py-5 px-6 font-bold flex items-center space-x-2 rounded-2xl shadow-lg border-0 cursor-pointer transition-all hover:scale-105 active:scale-95 text-sm"
                  >
                    <PlusCircle className="w-5 h-5" />
                    <span>Book Schedule</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-xl rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="text-lg font-bold text-slate-900">
                      Book Diagnostic Appointment
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      Schedule a diagnostic test for <strong>{selectedProfile?.first_name} {selectedProfile?.last_name}</strong>.
                    </DialogDescription>
                    
                    {/* Visual Step Progress Bar */}
                    <div className="flex items-center justify-between pt-3 pb-1 border-b border-slate-100 my-2">
                      <div className={`flex items-center space-x-2 text-xs font-bold ${bookingStep === 1 ? 'text-[#769046]' : 'text-slate-400'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${bookingStep === 1 ? 'bg-[#769046] text-white' : 'bg-slate-200 text-slate-600'}`}>1</span>
                        <span>Select Tests</span>
                      </div>
                      <div className="h-[2px] flex-1 mx-3 bg-slate-200" />
                      <div className={`flex items-center space-x-2 text-xs font-bold ${bookingStep === 2 ? 'text-[#769046]' : 'text-slate-400'}`}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${bookingStep === 2 ? 'bg-[#769046] text-white' : 'bg-slate-200 text-slate-600'}`}>2</span>
                        <span>Schedule & HMO</span>
                      </div>
                    </div>
                  </DialogHeader>

                  <form onSubmit={handleBookAppointment} className="space-y-4 pt-2">
                    {bookingError && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{bookingError}</span>
                      </div>
                    )}

                    {bookingSuccess && (
                      <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl p-3 flex items-center space-x-2 text-xs font-semibold">
                        <CheckCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{bookingSuccess}</span>
                      </div>
                    )}

                    {/* Step Indicators */}
                    <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                      <button 
                        type="button"
                        onClick={() => setBookingStep(1)}
                        className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 1 ? 'bg-[#769046] text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        1. Schedule & Services
                      </button>
                      <button 
                        type="button"
                        onClick={() => setBookingStep(2)}
                        className={`text-xs font-bold px-3 py-1 rounded-full border-0 cursor-pointer ${bookingStep === 2 ? 'bg-[#769046] text-white' : 'bg-gray-100 text-gray-500'}`}
                      >
                        2. HMO / Payment Note
                      </button>
                    </div>

                    {bookingStep === 1 && (
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-gray-600 uppercase">Date</label>
                          <Input
                            type="date"
                            value={bookingData.scheduledDate}
                            onChange={e => setBookingData({...bookingData, scheduledDate: e.target.value, scheduledTime: ''})}
                            required
                          />
                        </div>

                        {bookingData.scheduledDate && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-600 uppercase">Available Time</label>
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
                                        ? 'bg-[#769046] text-white border-[#769046]'
                                        : slot.available
                                        ? 'bg-white text-slate-700 border-gray-200 hover:border-[#769046]'
                                        : 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed line-through'
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
                            <label className="text-xs font-bold text-gray-600 uppercase">Select Diagnostic Tests</label>
                            <span className="text-xs font-extrabold text-[#769046]">Total: ₱{calculateTotalPrice().toFixed(2)}</span>
                          </div>
                          <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-xl p-2.5 space-y-2 bg-gray-50/50">
                            {testCatalog.map(test => (
                              <label key={test.id} className="flex items-center space-x-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors border border-transparent hover:border-gray-100">
                                <input
                                  type="checkbox"
                                  checked={bookingData.testIds.includes(test.id.toString())}
                                  onChange={() => handleTestSelection(test.id.toString())}
                                  className="rounded text-[#769046] focus:ring-[#769046]"
                                />
                                <div className="flex-1 flex justify-between items-center text-xs">
                                  <span className="font-bold text-gray-800">{test.name} <span className="text-[10px] text-gray-400 font-medium">({test.category_name})</span></span>
                                  <span className="font-extrabold text-slate-900">₱{parseFloat(test.price).toFixed(2)}</span>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end pt-2">
                          <Button type="button" className="bg-[#769046] hover:bg-[#657c3a]" onClick={() => setBookingStep(2)}>
                            Next: HMO & Notes &rarr;
                          </Button>
                        </div>
                      </div>
                    )}

                    {bookingStep === 2 && (
                      <div className="space-y-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-gray-600 uppercase">HMO Provider (Optional)</label>
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
                            <label className="text-xs font-bold text-gray-600 uppercase">HMO Authorization / LOA Code</label>
                            <Input
                              placeholder="Enter approval or card LOA number"
                              value={bookingData.hmoApprovalCode}
                              onChange={e => setBookingData({...bookingData, hmoApprovalCode: e.target.value})}
                            />
                          </div>
                        )}

                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-gray-600 uppercase">Additional Clinical Notes</label>
                          <Input
                            placeholder="Physician referral notes or symptoms..."
                            value={bookingData.notes}
                            onChange={e => setBookingData({...bookingData, notes: e.target.value})}
                          />
                        </div>

                        <div className="flex justify-between pt-2 border-t border-gray-100">
                          <Button type="button" variant="outline" onClick={() => setBookingStep(1)}>
                            &larr; Back
                          </Button>
                          <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold">
                            Submit Schedule Request
                          </Button>
                        </div>
                      </div>
                    )}
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {/* Quick Metrics Bar inside Hero */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-slate-800">
              <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Pending Requests</span>
                <span className="text-xl font-extrabold text-amber-400">{pendingCount}</span>
              </div>
              <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Completed Reports</span>
                <span className="text-xl font-extrabold text-emerald-400">{completedCount}</span>
              </div>
              <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Total Test History</span>
                <span className="text-xl font-extrabold text-white">{history.length}</span>
              </div>
              <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Billing Type</span>
                <span className="text-xs font-bold text-[#769046] block truncate mt-1">
                  {selectedProfile?.patient_type_name || 'Standard'}
                </span>
              </div>
            </div>

          </div>

          <div className="absolute right-[-60px] top-[-60px] w-80 h-80 bg-[#769046]/15 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        {/* Diagnostic Results & History Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Left - Test History Workspace */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Filter & Search Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
              <div className="flex items-center space-x-2">
                <Activity className="w-5 h-5 text-[#769046]" />
                <h2 className="text-base font-bold text-slate-900 m-0">Diagnostic History</h2>
              </div>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-44">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search test..."
                    value={searchFilter}
                    onChange={e => setSearchFilter(e.target.value)}
                    className="pl-8 pr-3 py-1 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#769046]"
                  />
                </div>

                <div className="flex bg-gray-100 p-1 rounded-xl text-xs">
                  {['All', 'Laboratory', 'Ultrasound', 'Xray'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setFilterCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg border-0 font-semibold cursor-pointer transition-all ${
                        filterCategory === cat ? 'bg-white text-slate-900 shadow-xs' : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Test Cards List */}
            <div className="space-y-3">
              {filteredHistory.length > 0 ? (
                filteredHistory.map(item => (
                  <Card key={item.id} className="border-gray-100 shadow-xs rounded-2xl hover:shadow-md transition-all">
                    <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                      <div className="flex items-start space-x-3.5">
                        <div className="w-10 h-10 bg-gray-50 border border-gray-200/80 rounded-xl flex items-center justify-center flex-shrink-0 text-[#769046]">
                          {item.category_name === 'Ultrasound' ? <Stethoscope className="w-5 h-5" /> : 
                           item.category_name === 'Xray' ? <Scan className="w-5 h-5" /> : 
                           <FlaskConical className="w-5 h-5" />}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">REQ-{item.visit_test_id}</span>
                            <Badge className={`${getStatusColor(item.test_status)} text-[10px] font-bold px-2 py-0.5 rounded-full border`}>
                              {item.test_status}
                            </Badge>
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
                              className="border-[#769046] text-[#769046] hover:bg-[#769046]/10 text-xs font-bold px-4 rounded-xl flex items-center space-x-1.5 cursor-pointer"
                            >
                              <CheckCircle className="w-4 h-4" />
                              <span>View Certificate Report</span>
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl rounded-2xl p-6">
                            
                            {/* Official Lab Report Simulation Header */}
                            <div className="border-b border-gray-200 pb-4 text-center space-y-1">
                              <h2 className="text-base font-extrabold text-slate-900 uppercase tracking-wide m-0">ENLOGADA ULTRASOUND & DIAGNOSTIC CLINIC</h2>
                              <p className="text-[11px] text-gray-500 font-semibold m-0">Official Diagnostic Examination Report</p>
                              <span className="text-[10px] text-[#769046] font-bold block">CONFIDENTIAL MEDICAL DOCUMENT</span>
                            </div>

                            {/* Patient Info Summary Block */}
                            <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                              <div>
                                <span className="text-gray-400 font-bold text-[10px] uppercase block">Patient Name</span>
                                <span className="font-bold text-slate-900">{selectedProfile?.first_name} {selectedProfile?.last_name}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 font-bold text-[10px] uppercase block">Examination</span>
                                <span className="font-bold text-slate-900">{item.test_name}</span>
                              </div>
                              <div>
                                <span className="text-gray-400 font-bold text-[10px] uppercase block">Category</span>
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
                                <div className="border-l-4 border-[#769046] pl-3 py-1">
                                  <h4 className="text-[11px] font-bold text-gray-500 uppercase m-0">Remarks</h4>
                                  <p className="text-xs text-gray-700 m-0">{item.remarks}</p>
                                </div>
                              )}

                              {item.file_url && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between text-xs">
                                  <div className="flex items-center space-x-2">
                                    <FileText className="w-4 h-4 text-emerald-600" />
                                    <span className="font-bold text-emerald-800">Scanned Diagnostic Image / PDF Attachment</span>
                                  </div>
                                  <a
                                    href={item.file_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-xs font-bold text-emerald-800 hover:underline flex items-center space-x-1"
                                  >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Download Attachment</span>
                                  </a>
                                </div>
                              )}
                            </div>

                            {/* Footer Release Stamp */}
                            <div className="flex items-center justify-between pt-4 border-t border-gray-100 text-[11px]">
                              <span className="text-gray-400 font-medium">Released: {new Date(item.released_at).toLocaleString()}</span>
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
          </div>

          {/* Right Sidebar - Patient Info Card & Clinic Info */}
          <div className="space-y-6">
            {selectedProfile && (
              <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
                <CardHeader className="bg-gray-50/70 border-b border-gray-100 py-3.5 flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                    <User className="w-4 h-4 text-[#769046]" />
                    <span>Patient Profile Summary</span>
                  </CardTitle>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleOpenEditProfile}
                    aria-label="Edit patient profile"
                    className="h-7 w-7 p-0 border-gray-200 text-gray-500 hover:text-[#769046] hover:border-[#769046] rounded-lg"
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
                    <Badge variant="secondary" className="font-bold text-[10px] bg-[#769046]/10 text-[#769046]">
                      {selectedProfile.patient_type_name}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* My Appointments (Module 3: view/cancel own appointments) */}
            <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
              <CardHeader className="bg-gray-50/70 border-b border-gray-100 py-3.5">
                <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <CalendarClock className="w-4 h-4 text-[#769046]" />
                  <span>My Appointments</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3 max-h-[360px] overflow-y-auto">
                {appointmentsLoading ? (
                  <p className="text-xs text-gray-400 text-center py-4">Loading appointments…</p>
                ) : appointments.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4 italic">No appointments booked yet.</p>
                ) : (
                  appointments.map((appt) => {
                    const isCancellable = appt.status === 'Pending' || appt.status === 'Confirmed';
                    return (
                      <div key={appt.id} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50/50">
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="block text-xs font-extrabold text-slate-900">
                              {formatAppointmentDate(appt.scheduled_date)}
                            </span>
                            <span className="block text-[11px] text-gray-500 font-medium">{appt.scheduled_time?.slice(0, 5)}</span>
                          </div>
                          <StatusBadge status={appt.status} />
                        </div>
                        <span className="block text-[10px] text-gray-400 font-mono">{appt.appointment_reference}</span>
                        {isCancellable && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleRequestCancelAppointment(appt)}
                            className="w-full text-[11px] font-bold text-rose-600 border-rose-200 hover:bg-rose-50 rounded-lg py-1.5 flex items-center justify-center space-x-1.5"
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
            </Card>

            {/* HMO Coverage Info Card */}
            <Card className="border-gray-100 bg-[#192534] text-white rounded-2xl overflow-hidden p-5 space-y-3 shadow-sm">
              <div className="flex items-center space-x-2 text-[#769046]">
                <ShieldCheck className="w-5 h-5" />
                <h3 className="font-bold text-sm text-white m-0">HMO Accreditation</h3>
              </div>
              <p className="text-gray-300 text-xs leading-relaxed">
                Enlogada Clinic is partnered with accredited HMO providers like <strong>1CoopHealth</strong>. Present your HMO LOA or Approval Code during booking.
              </p>
            </Card>
          </div>

        </div>

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
    </DashboardLayout>
  );
};

export default ClientDashboard;
