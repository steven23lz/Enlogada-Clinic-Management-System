import React, { useState, useEffect, useCallback } from 'react';
import { Panel, PanelBody } from '../../components/ui/panel';
import PageHeader from '../../components/ui/page-header';
import Toolbar, { SegmentedFilter } from '../../components/ui/toolbar';
import EmptyState from '../../components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { StatusBadge } from '../../components/ui/status-badge';
import { SkeletonRows } from '../../components/ui/skeleton';
import Pagination from '../../components/ui/pagination';
import api from '../../config/api';
import { CalendarClock } from 'lucide-react';

const STATUS_FILTERS = ['All', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'];

// UI/UX Modernization Phase 4: GET /appointments has no server-side pagination, so a client-side
// page size over the already-fetched, status-filtered array is proportionate (VISUAL_IDENTITY.md
// §3a #11).
const PAGE_SIZE = 15;

// Module 12: appointments oversight — read-only. Rescheduling/cancelling is Receptionist's
// (Module 7) or the Client's own (Module 3) job; this view is visibility only, per
// MODULE_SCOPE.md's "oversight" wording.
const AppointmentsOversight = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');
  const [page, setPage] = useState(1);

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'All' ? { status: statusFilter } : {};
      const res = await api.get('/appointments', { params });
      setAppointments(res.data.data.appointments || []);
      setPage(1);
    } catch (err) {
      console.error('Failed to fetch appointments:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  const totalPages = Math.max(1, Math.ceil(appointments.length / PAGE_SIZE));
  const pagedAppointments = appointments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Oversight"
        icon={CalendarClock}
        title="Appointments"
        description="Clinic-wide view of every booked appointment. Read-only — rescheduling and cancellation belong to Reception or the patient."
        meta={
          <span>
            <strong className="font-semibold text-slate-700">{appointments.length}</strong>{' '}
            {statusFilter === 'All' ? 'total' : statusFilter.toLowerCase()}
          </span>
        }
      />

      {/* Toolbar and table are one object, so they are wrapped in a bare div — the page's
          `space-y` would otherwise insert a gap between a filter row and the list it filters. */}
      <div>
        <Toolbar attached>
          <SegmentedFilter
            ariaLabel="Filter appointments by status"
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
                <TableHead>Reference</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Visit Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <SkeletonRows rows={6} columns={5} />
              ) : pagedAppointments.length > 0 ? (
                pagedAppointments.map(a => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-fine text-slate-500">{a.appointment_reference}</TableCell>
                    <TableCell className="font-semibold text-slate-900">{a.first_name} {a.last_name}</TableCell>
                    <TableCell>
                      {new Date(a.scheduled_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} &bull; {a.scheduled_time?.slice(0, 5)}
                    </TableCell>
                    <TableCell className="text-slate-500">{a.visit_type}</TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0">
                    <EmptyState
                      icon={CalendarClock}
                      title={statusFilter === 'All' ? 'No appointments booked' : `Nothing is ${statusFilter.toLowerCase()}`}
                      description={
                        statusFilter === 'All'
                          ? 'Appointments booked online or by phone appear here.'
                          : 'Try another status filter, or switch back to All.'
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          </PanelBody>
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} totalLabel={`${appointments.length} total`} />
        </Panel>
      </div>
    </div>
  );
};

export default AppointmentsOversight;
