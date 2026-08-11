import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { StatusBadge } from '../../components/ui/status-badge';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { formatCurrency } from '../../lib/currency';
import { ShieldCheck, AlertCircle, Check, X } from 'lucide-react';

const STATUS_FILTERS = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'];

// UI/UX Modernization Phase 4: GET /hmo/requests has no server-side pagination, so a client-side
// page size over the already-fetched, status-filtered array is proportionate (VISUAL_IDENTITY.md
// §3a #11).
const PAGE_SIZE = 15;

// Module 15 (Test and Service Request): the approval half of the HMO request/approval flow.
// Module 7 built request *initiation*; approval existed on the backend
// (PUT /hmo/request/:id/approve, PUT /hmo/request-test/:id) but had no UI anywhere, and there
// was no way to even discover pending requests (no "list" endpoint existed before this pass).
const ServiceRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);

  const [detailRequest, setDetailRequest] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [approvalCode, setApprovalCode] = useState('');
  const [detailError, setDetailError] = useState('');
  const [detailSubmitting, setDetailSubmitting] = useState(false);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'All' ? { status: statusFilter } : {};
      const res = await api.get('/hmo/requests', { params });
      setRequests(res.data.data.requests || []);
      setPage(1);
    } catch (err) {
      console.error('Failed to fetch HMO requests:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const openDetail = async (requestId) => {
    setDetailError('');
    setApprovalCode('');
    setDetailLoading(true);
    setDetailRequest({ id: requestId });
    try {
      const res = await api.get(`/hmo/request/${requestId}`);
      setDetailRequest(res.data.data.request);
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to load request details.');
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (requestId) => {
    const res = await api.get(`/hmo/request/${requestId}`);
    setDetailRequest(res.data.data.request);
    fetchRequests();
  };

  const handleApproveRequest = async (e) => {
    e.preventDefault();
    if (!approvalCode.trim()) {
      setDetailError('An approval/LOA code is required to approve the request.');
      return;
    }
    setDetailSubmitting(true);
    setDetailError('');
    try {
      await api.put(`/hmo/request/${detailRequest.id}/approve`, { approvalCode });
      await refreshDetail(detailRequest.id);
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to approve request.');
    } finally {
      setDetailSubmitting(false);
    }
  };

  const handleSetTestApproval = async (hmoRequestTestId, approvalStatus) => {
    setDetailError('');
    try {
      await api.put(`/hmo/request-test/${hmoRequestTestId}`, { approvalStatus });
      await refreshDetail(detailRequest.id);
    } catch (err) {
      setDetailError(err.response?.data?.message || 'Failed to update test approval.');
    }
  };

  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
  const pagedRequests = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 m-0">Service &amp; HMO Requests</h2>
          <p className="text-xs text-gray-500 m-0">Review and approve HMO pre-authorization requests logged by Reception.</p>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl text-xs flex-wrap">
          {STATUS_FILTERS.map(s => (
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
      </div>

      <Card className="border-gray-100 shadow-xs rounded-2xl bg-white overflow-hidden">
        <CardHeader className="border-b border-gray-100 py-4 px-6 flex flex-row items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-[#769046]" />
          <CardTitle className="text-sm font-bold text-slate-800">{requests.length} Request{requests.length === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase py-3">Provider</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Requested</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Tests Approved</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Status</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400">Loading requests…</TableCell></TableRow>
              ) : pagedRequests.length > 0 ? (
                pagedRequests.map(r => (
                  <TableRow key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <TableCell className="py-3 font-bold text-xs text-slate-900">{r.provider_name}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-500">{new Date(r.request_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</TableCell>
                    <TableCell className="py-3 text-xs font-semibold text-gray-700">{r.approved_test_count} / {r.test_count}</TableCell>
                    <TableCell className="py-3"><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="py-3 text-right">
                      <Button
                        onClick={() => openDetail(r.id)}
                        variant="outline"
                        className="text-[11px] font-bold border-gray-200 hover:bg-[#769046] hover:text-white rounded-lg py-1 px-2.5"
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400 italic">No HMO requests found for this filter.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${requests.length} total`} />
      </Card>

      <Dialog open={!!detailRequest} onOpenChange={(open) => { if (!open) setDetailRequest(null); }}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900">HMO Request Review</DialogTitle>
            <DialogDescription className="text-xs">{detailRequest?.provider_name}</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <p className="text-xs text-gray-400 text-center py-6">Loading…</p>
          ) : (
            <div className="space-y-4">
              {detailError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{detailError}</span>
                </div>
              )}

              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">Request Status</span>
                <StatusBadge status={detailRequest?.status} />
              </div>

              {detailRequest?.status !== 'Approved' && (
                <form onSubmit={handleApproveRequest} className="space-y-2 bg-gray-50 p-3 rounded-xl border border-gray-100">
                  <label className="text-xs font-bold text-gray-600 uppercase">Approve Request — Approval / LOA Code</label>
                  <div className="flex space-x-2">
                    <Input
                      placeholder="Enter approval code"
                      value={approvalCode}
                      onChange={e => setApprovalCode(e.target.value)}
                      disabled={detailSubmitting}
                    />
                    <Button type="submit" className="bg-[#769046] hover:bg-[#657c3a] text-white font-bold text-xs" disabled={detailSubmitting}>
                      {detailSubmitting ? 'Approving...' : 'Approve'}
                    </Button>
                  </div>
                </form>
              )}

              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Linked Tests</span>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {(detailRequest?.tests || []).map(t => (
                    <div key={t.id} className="flex items-center justify-between p-2.5 bg-gray-50/70 rounded-lg border border-gray-100 text-xs">
                      <div>
                        <span className="font-bold text-gray-800 block">{t.test_name}</span>
                        <span className="text-[11px] text-gray-500">{t.category_name} &bull; {formatCurrency(t.price_at_time)}</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <StatusBadge status={t.approval_status} />
                        {t.approval_status !== 'Approved' && (
                          <button
                            type="button"
                            onClick={() => handleSetTestApproval(t.id, 'Approved')}
                            aria-label={`Approve ${t.test_name}`}
                            className="p-1 text-emerald-600 hover:bg-emerald-100 rounded-md border-0 bg-transparent cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {t.approval_status !== 'Rejected' && (
                          <button
                            type="button"
                            onClick={() => handleSetTestApproval(t.id, 'Rejected')}
                            aria-label={`Reject ${t.test_name}`}
                            className="p-1 text-rose-600 hover:bg-rose-100 rounded-md border-0 bg-transparent cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ServiceRequests;
