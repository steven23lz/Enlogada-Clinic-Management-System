import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { StatusBadge } from '../../components/ui/status-badge';
import api from '../../config/api';
import { CalendarClock } from 'lucide-react';

const STATUS_FILTERS = ['All', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'];

// Module 12: appointments oversight — read-only. Rescheduling/cancelling is Receptionist's
// (Module 7) or the Client's own (Module 3) job; this view is visibility only, per
// MODULE_SCOPE.md's "oversight" wording.
const AppointmentsOversight = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');

  const fetchAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter !== 'All' ? { status: statusFilter } : {};
      const res = await api.get('/appointments', { params });
      setAppointments(res.data.data.appointments || []);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-gray-100 shadow-xs">
        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900 m-0">Appointments Oversight</h2>
          <p className="text-xs text-gray-500 m-0">Clinic-wide view of all booked appointments, read-only.</p>
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
          <CalendarClock className="w-4 h-4 text-[#769046]" />
          <CardTitle className="text-sm font-bold text-slate-800">{appointments.length} Appointment{appointments.length === 1 ? '' : 's'}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-gray-50/80">
              <TableRow>
                <TableHead className="text-[10px] font-bold uppercase py-3">Reference</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Patient</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Scheduled</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Visit Type</TableHead>
                <TableHead className="text-[10px] font-bold uppercase py-3">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400">Loading appointments…</TableCell></TableRow>
              ) : appointments.length > 0 ? (
                appointments.map(a => (
                  <TableRow key={a.id} className="hover:bg-gray-50/50 transition-colors">
                    <TableCell className="py-3 font-mono text-xs text-gray-500">{a.appointment_reference}</TableCell>
                    <TableCell className="py-3 font-bold text-xs text-slate-900">{a.first_name} {a.last_name}</TableCell>
                    <TableCell className="py-3 text-xs text-gray-700">
                      {new Date(a.scheduled_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} &bull; {a.scheduled_time?.slice(0, 5)}
                    </TableCell>
                    <TableCell className="py-3 text-xs text-gray-500">{a.visit_type}</TableCell>
                    <TableCell className="py-3"><StatusBadge status={a.status} /></TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-xs text-gray-400 italic">No appointments found for this filter.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AppointmentsOversight;
