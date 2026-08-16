import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { SegmentedFilter } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonRows, SkeletonList } from '../../components/ui/skeleton';
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
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={ShieldCheck}
        title="Service & HMO Requests"
        description="Review and approve HMO pre-authorisation logged by Reception. Approval is Admin-only — Reception can log a request but not clear it."
        meta={<span><strong className="font-semibold text-slate-700">{requests.length}</strong> request{requests.length === 1 ? '' : 's'}</span>}
      />

      <div>
        <Toolbar attached>
          <SegmentedFilter
            ariaLabel="Filter HMO requests by status"
            options={STATUS_FILTERS.map(s => ({ value: s, label: s }))}
            value={statusFilter}
            onChange={setStatusFilter}
          />
        </Toolbar>

        <Panel className="overflow-hidden rounded-t-none">
          <PanelBody flush>
            <Table>
              <TableHeader sticky>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Tests Approved</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <SkeletonRows rows={5} columns={5} />
                ) : pagedRequests.length > 0 ? (
                  pagedRequests.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-semibold text-slate-900">{r.provider_name}</TableCell>
                      <TableCell className="text-slate-500">{new Date(r.request_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</TableCell>
                      <TableCell className="font-medium tabular-nums">{r.approved_test_count} / {r.test_count}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right">
                        <Button onClick={() => openDetail(r.id)} variant="outline" size="xs">
                          Review
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="p-0">
                      <EmptyState
                        icon={ShieldCheck}
                        title={statusFilter === 'All' ? 'No HMO requests logged' : `Nothing is ${statusFilter.toLowerCase()}`}
                        description="Reception logs a pre-authorisation against a visit; it appears here for approval."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </PanelBody>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${requests.length} total`} />
        </Panel>
      </div>

      <Dialog open={!!detailRequest} onOpenChange={(open) => { if (!open) setDetailRequest(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>HMO Request Review</DialogTitle>
            <DialogDescription>{detailRequest?.provider_name}</DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <SkeletonList rows={3} />
          ) : (
            <div className="space-y-4">
              {detailError && (
                <div role="alert" className="alert alert-error">
                  <AlertCircle />
                  <span>{detailError}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-fine font-medium text-slate-500">Request Status</span>
                <StatusBadge status={detailRequest?.status} />
              </div>

              {detailRequest?.status !== 'Approved' && (
                <form onSubmit={handleApproveRequest} className="space-y-2 rounded-lg border border-[#e6ebf1] bg-slate-50/80 p-3">
                  <label className="field-label">Approve Request — Approval / LOA Code</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Enter approval code"
                      value={approvalCode}
                      onChange={e => setApprovalCode(e.target.value)}
                      disabled={detailSubmitting}
                    />
                    <Button type="submit" disabled={detailSubmitting}>
                      {detailSubmitting ? 'Approving…' : 'Approve'}
                    </Button>
                  </div>
                </form>
              )}

              <div className="space-y-1.5">
                <span className="field-label">Linked Tests</span>
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {(detailRequest?.tests || []).map(t => (
                    <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-[#e6ebf1] p-2.5">
                      <div className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">{t.test_name}</span>
                        <span className="text-fine text-slate-500">{t.category_name} &bull; {formatCurrency(t.price_at_time)}</span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <StatusBadge status={t.approval_status} />
                        {t.approval_status !== 'Approved' && (
                          <button
                            type="button"
                            onClick={() => handleSetTestApproval(t.id, 'Approved')}
                            aria-label={`Approve ${t.test_name}`}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-emerald-600 hover:bg-emerald-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {t.approval_status !== 'Rejected' && (
                          <button
                            type="button"
                            onClick={() => handleSetTestApproval(t.id, 'Rejected')}
                            aria-label={`Reject ${t.test_name}`}
                            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-rose-600 hover:bg-rose-50"
                          >
                            <X className="h-3.5 w-3.5" />
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
