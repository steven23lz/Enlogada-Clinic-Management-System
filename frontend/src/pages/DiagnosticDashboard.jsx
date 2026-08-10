import React, { useState, useEffect, useCallback } from 'react';
import SidebarLayout from '../components/SidebarLayout';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ConfirmDialog } from '../components/ui/confirm-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import api from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { 
  Stethoscope, 
  FlaskConical, 
  Scan, 
  Play, 
  FileText, 
  Send, 
  ShieldAlert, 
  CheckCircle2, 
  Sparkles, 
  Search, 
  Upload, 
  Check, 
  Clock, 
  FileCheck,
  AlertCircle
} from 'lucide-react';

const NAV_TO_CATEGORY = {
  'lab-ops': 'Laboratory',
  'ultrasound-ops': 'Ultrasound',
  'xray-ops': 'Xray'
};

// The attachment URL is staff-entered free text with no format validation anywhere else in
// the pipeline (it's rendered client-side in ClientDashboard.jsx behind a matching render-side
// guard — see the Module 6 report). Validating it here, at the point of entry, stops an unsafe
// value from ever being submitted in the first place.
const isValidAttachmentUrl = (url) => {
  if (!url) return true; // optional field
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const DiagnosticDashboard = ({ activeNav = 'lab-ops', onSelectNav }) => {
  const { user } = useAuth();
  const [pendingTests, setPendingTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('Laboratory');
  const [searchQuery, setSearchQuery] = useState('');

  // Result Upload Form State
  const [activeTest, setActiveTest] = useState(null);
  const [findings, setFindings] = useState('');
  const [remarks, setRemarks] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const [releasingResult, setReleasingResult] = useState(false);

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
    try {
      const response = await api.get(`/results/pending/${catName}`);
      setPendingTests(response.data.data.pending || []);
    } catch (err) {
      console.error('Failed to fetch pending diagnostics:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const navCategory = NAV_TO_CATEGORY[activeNav];
    if (navCategory) {
      setCategory(navCategory);
    } else if (user && user.roles) {
      determineCategory(user.roles);
    }
  }, [activeNav, user, determineCategory]);

  useEffect(() => {
    if (category) {
      fetchPendingTests(category);
    }
  }, [category, fetchPendingTests]);

  const handleStartProcessing = async (visitTestId) => {
    try {
      await api.patch(`/results/test-status/${visitTestId}`, { status: 'Processing' });
      fetchPendingTests(category);
    } catch (err) {
      console.error(err);
      alert('Failed to update test status to Processing.');
    }
  };

  const handleOpenUploadModal = (test) => {
    setActiveTest(test);
    setFindings('');
    setRemarks('');
    setFileUrl('');
    setUploadError('');
    setShowUploadModal(true);
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

    if (!isValidAttachmentUrl(fileUrl)) {
      setUploadError('Attachment URL must be a valid http:// or https:// link, or left blank.');
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
      await api.post(`/results/${activeTest.visit_test_id}`, {
        findings,
        remarks,
        fileUrl: fileUrl || null
      });

      // The upload call above only records the findings — this is the actual "release" step
      // that notifies the patient by email. It was previously never called from this screen,
      // so "Authorize & Release Result" recorded findings but never released/notified anyone.
      await api.post(`/results/${activeTest.visit_test_id}/release`);

      setShowReleaseConfirm(false);
      setShowUploadModal(false);
      fetchPendingTests(category);
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
    return matchesSearch;
  });

  const pendingCount = pendingTests.filter(t => t.test_status === 'Pending').length;
  const processingCount = pendingTests.filter(t => t.test_status === 'Processing').length;

  return (
    <SidebarLayout title={`${category} Operations Worklist`} activeNav={activeNav} onSelectNav={onSelectNav}>
      <div className="space-y-6">
        
        {/* Department Modality Worklist Header Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Active Modality</span>
                <span className="text-xl font-extrabold text-slate-900">{category} Department</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-[#769046]/10 text-[#769046] flex items-center justify-center font-bold">
                {category === 'Ultrasound' ? <Stethoscope className="w-5 h-5" /> :
                 category === 'Xray' ? <Scan className="w-5 h-5" /> :
                 <FlaskConical className="w-5 h-5" />}
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Queue Awaiting Test</span>
                <span className="text-2xl font-extrabold text-amber-600">{pendingCount}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </Card>

          <Card className="border-gray-100 shadow-xs rounded-2xl bg-white p-4">
            <div className="flex justify-between items-center">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Currently Processing</span>
                <span className="text-2xl font-extrabold text-indigo-600">{processingCount}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                <FileText className="w-5 h-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* Search Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-end gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-xs">

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search patient, test, queue..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus:outline-none focus:ring-1 focus:ring-[#769046]"
            />
          </div>

        </div>

        {/* Modality Worklist Data Table */}
        <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
          <CardHeader className="border-b border-gray-100 py-4 px-6 flex justify-between items-center">
            <CardTitle className="text-base font-bold text-slate-900 m-0">
              {category} Worklist Queue ({filteredTests.length})
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
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-6 text-xs text-gray-400">Loading worklist…</TableCell>
                  </TableRow>
                ) : filteredTests.length > 0 ? (
                  filteredTests.map(test => (
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
                        <Badge className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          test.test_status === 'Processing' ? 'bg-indigo-100 text-indigo-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {test.test_status}
                        </Badge>
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
                      No pending diagnostic examinations in the {category} worklist.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Record Diagnostic Findings & Result Entry Modal */}
        <Dialog open={showUploadModal} onOpenChange={setShowUploadModal}>
          <DialogContent className="max-w-2xl rounded-2xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-slate-900">
                Record Findings & Release Diagnostic Certificate
              </DialogTitle>
              <DialogDescription className="text-xs">
                Patient: <strong>{activeTest?.first_name} {activeTest?.last_name}</strong> &bull; Examination: <strong>{activeTest?.test_name}</strong>
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleUploadResult} className="space-y-4 pt-2">
              {uploadError && (
                <div role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Quick Template Generator Buttons */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Clinical Report Templates</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('cbc_normal')}
                    className="text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                  >
                    + Normal CBC Template
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('xray_chest')}
                    className="text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                  >
                    + Normal Chest X-Ray
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate('pelvic_us')}
                    className="text-[11px] font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded-lg border border-gray-200 cursor-pointer"
                  >
                    + Normal Pelvic Ultrasound
                  </button>
                </div>
              </div>

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
                <label className="text-xs font-bold text-gray-600 uppercase">Image / Document URL Attachment (Optional)</label>
                <Input
                  placeholder="https://storage.enlogadaclinic.com/reports/sample.pdf"
                  value={fileUrl}
                  onChange={e => setFileUrl(e.target.value)}
                  className="text-xs rounded-xl"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                <Button type="button" variant="outline" onClick={() => setShowUploadModal(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold text-xs px-5 py-2 rounded-xl flex items-center space-x-1.5">
                  <Send className="w-4 h-4" />
                  <span>Authorize & Release Result</span>
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Result release confirmation — irreversible/clinically significant, see .agents Phase 12 */}
        <ConfirmDialog
          open={showReleaseConfirm}
          onOpenChange={setShowReleaseConfirm}
          title="Authorize & Release Result"
          description={activeTest ? `Release ${activeTest.test_name} findings for ${activeTest.first_name} ${activeTest.last_name}? This finalizes the result and cannot be undone from this screen.` : ''}
          confirmLabel="Authorize & Release"
          onConfirm={confirmReleaseResult}
          loading={releasingResult}
          error={uploadError}
        />

      </div>
    </SidebarLayout>
  );
};

export default DiagnosticDashboard;
