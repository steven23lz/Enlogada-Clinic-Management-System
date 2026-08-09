import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import api from '../config/api';
import { validatePatientProfile } from '../validations/patientValidation';
import QrScanner from '../components/QrScanner';
import {
  Check,
  ClipboardList,
  Search,
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
  Keyboard
} from 'lucide-react';

const ReceptionistDashboard = ({ activeNav = 'reception-ops', onSelectNav }) => {
  const [activeVisits, setActiveVisits] = useState([]);
  const [testCatalog, setTestCatalog] = useState([]);
  const [patientTypes, setPatientTypes] = useState([]);
  const [hmoProviders, setHmoProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  // QR Code / Ref Verification State
  const [searchRef, setSearchRef] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError, setVerifyError] = useState('');
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [showCheckInConfirm, setShowCheckInConfirm] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkInError, setCheckInError] = useState('');

  // Assign Tests Dialog State
  const [selectedVisitId, setSelectedVisitId] = useState(null);
  const [selectedTestIds, setSelectedTestIds] = useState([]);
  const [showTestsModal, setShowTestsModal] = useState(false);

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

  const fetchActiveVisits = useCallback(async () => {
    try {
      const response = await api.get('/visits/active');
      setActiveVisits(response.data.data.visits || []);
    } catch (err) {
      console.error('Failed to fetch active visits:', err);
    } finally {
      setLoading(false);
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
    fetchActiveVisits();
    fetchStaticData();
  }, [fetchActiveVisits, fetchStaticData]);

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
      fetchActiveVisits();
      setShowCheckInConfirm(false);
      setShowVerifyModal(false);
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
      fetchActiveVisits();
    } catch (err) {
      setRegistrationError(err.response?.data?.message || 'Failed to register walk-in patient');
    } finally {
      setIsRegistering(false);
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
      fetchActiveVisits();
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

  const handleHmoSubmit = async (e) => {
    e.preventDefault();
    setHmoError('');
    setHmoSuccess('');

    if (!activeVisitTest || !hmoProviderId) {
      setHmoError('Provider and Approval Code are required.');
      return;
    }

    try {
      await api.post('/hmo/requests', {
        hmoProviderId: parseInt(hmoProviderId, 10),
        approvalCode: hmoApprovalCode,
        visitTestIds: [activeVisitTest.id]
      });

      setHmoSuccess('HMO Pre-authorization logged successfully!');
      setTimeout(() => {
        setShowHmoModal(false);
        setHmoSuccess('');
        fetchActiveVisits();
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

  const filteredVisits = activeVisits.filter(visit => {
    const matchesSearch = !searchQuery || 
      `${visit.first_name} ${visit.last_name}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (visit.queue_number && visit.queue_number.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = statusFilter === 'All' || visit.visit_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pendingVisits = activeVisits.filter(v => v.visit_status === 'Pending').length;
  const processingVisits = activeVisits.filter(v => v.visit_status === 'Processing').length;
  const walkinCount = activeVisits.filter(v => v.visit_type === 'Walk in').length;

  return (
    <SidebarLayout title="Receptionist Operational Desk" activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">
        
        {/* KPI Metrics Header */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Active Queue Visits</span>
                <span className="text-2xl font-extrabold text-slate-900">{activeVisits.length}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#769046]/10 text-[#769046] flex items-center justify-center font-bold">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Pending Intake</span>
                <span className="text-2xl font-extrabold text-amber-600">{pendingVisits}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">In Diagnostic / Processing</span>
                <span className="text-2xl font-extrabold text-indigo-600">{processingVisits}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <ClipboardList className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Walk-In Intake Today</span>
                <span className="text-2xl font-extrabold text-emerald-600">{walkinCount}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <UserPlus className="w-5 h-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">
          
          <div className="flex items-center space-x-3">
            <Dialog open={showVerifyModal} onOpenChange={(open) => { setShowVerifyModal(open); if (!open) setScanMode(false); }}>
              <DialogTrigger asChild>
                <Button className="bg-[#192534] hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center space-x-2 px-4 py-2.5 cursor-pointer">
                  <QrCode className="w-4 h-4" />
                  <span>Verify Online QR / Reference</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="text-base font-bold text-slate-900">Verify Appointment Reference</DialogTitle>
                  <DialogDescription className="text-xs">
                    Scan or enter the appointment reference code (e.g. <code>APPT-XXXXX</code>).
                  </DialogDescription>
                </DialogHeader>

                <button
                  type="button"
                  onClick={() => setScanMode(m => !m)}
                  className="flex items-center space-x-1.5 text-[11px] font-bold text-[#769046] hover:text-[#657c3a] cursor-pointer"
                >
                  {scanMode ? <Keyboard className="w-3.5 h-3.5" /> : <Camera className="w-3.5 h-3.5" />}
                  <span>{scanMode ? 'Switch to manual entry' : 'Scan QR with camera'}</span>
                </button>

                {scanMode && (
                  <QrScanner
                    active={showVerifyModal && scanMode}
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
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex items-center space-x-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search patient name or Queue #..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#769046]"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
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

        </div>

        {/* Main Work Surface (Tabs for Active Queue vs Walk-in Intake) */}
        <Tabs defaultValue="queue" className="w-full space-y-4">
          <TabsList className="bg-gray-100 p-1 rounded-xl">
            <TabsTrigger value="queue" className="rounded-lg text-xs font-bold px-4 py-1.5">
              Active Patient Queue ({filteredVisits.length})
            </TabsTrigger>
            <TabsTrigger value="walkin" className="rounded-lg text-xs font-bold px-4 py-1.5">
              Walk-In Fast Registration
            </TabsTrigger>
          </TabsList>

          {/* Active Queue Table */}
          <TabsContent value="queue" className="space-y-4 m-0">
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
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-xs text-gray-500 font-semibold">
                          Loading active queue…
                        </TableCell>
                      </TableRow>
                    ) : filteredVisits.length > 0 ? (
                      filteredVisits.map(visit => (
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
                                  <Badge key={t.id} className="bg-gray-100 text-gray-700 hover:bg-gray-100 text-[10px] font-semibold border-gray-200">
                                    {t.test_name} ({t.test_status})
                                  </Badge>
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
            </Card>
          </TabsContent>

          {/* Walk-in Registration Form */}
          <TabsContent value="walkin" className="m-0">
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
          </TabsContent>
        </Tabs>

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
