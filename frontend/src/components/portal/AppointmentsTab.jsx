import React from 'react';

const LIST_PAGE_SIZE = 8;
import { AlertTriangle, CalendarClock, XCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { StatusBadge } from '../ui/status-badge';
import { TabsContent } from '../ui/tabs';
import Pagination from '../ui/pagination';
import BookingPass from '../BookingPass';
import { formatAppointmentDate } from '../../lib/date';

/**
 * Bookings this patient has, and the pass they present.
 *
 * Lifted out of ClientDashboard, which rendered the profile switcher, two profile dialogs,
 * a hero and four tab panels from one 1,044-line file. The props are the hooks it reads.
 */
export default function AppointmentsTab({ bookings }) {
  // Open bookings first and soonest-first within them; everything finished falls below, newest
  // first. A patient opening this tab is almost always asking "what do I still have to attend".
  const isOpenBooking = (a) => a.status !== 'Cancelled' && a.status !== 'Completed';
  const sorted = [...bookings.appointments].sort((a, b) => {
    if (isOpenBooking(a) !== isOpenBooking(b)) return isOpenBooking(a) ? -1 : 1;
    const da = new Date(a.scheduled_date).getTime();
    const db = new Date(b.scheduled_date).getTime();
    return isOpenBooking(a) ? da - db : db - da;
  });

  // Client-side, because the whole list arrives in one request — a page size over an array
  // already in hand is proportionate here, unlike the payments table.
  const totalPages = Math.max(1, Math.ceil(sorted.length / LIST_PAGE_SIZE));
  const safePage = Math.min(bookings.page, totalPages);
  const paged = sorted.slice((safePage - 1) * LIST_PAGE_SIZE, safePage * LIST_PAGE_SIZE);

  return (
        <TabsContent value="appointments" className="m-0">
          <Card className="border-[#e6ebf1] rounded-xl bg-white overflow-hidden">
            <CardHeader className="bg-slate-50/80 border-b border-[#e6ebf1] py-3.5">
              <CardTitle className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                <CalendarClock className="w-4 h-4 text-brand-600" />
                <span>My Appointments</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {bookings.payError && (
                <div role="alert" className="alert alert-error mb-3">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{bookings.payError}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {bookings.loading ? (
                <p className="text-xs text-gray-400 text-center py-4">Loading appointments…</p>
              ) : bookings.appointments.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-4 italic">No appointments booked yet.</p>
              ) : (
                paged.map((appt) => {
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
                  const showPayOptions = isOpen && !appt.is_paid && bookings.gateway.available;
                  return (
                    <div
                      key={appt.id}
                      data-testid="appointment-card"
                      data-reference={appt.appointment_reference}
                      className="border border-[#e6ebf1] rounded-xl p-3 space-y-2 bg-slate-50/70"
                    >
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

                      {/* What to do before this appointment. [1.24.0] surfaced these while
                          choosing tests and in the confirmation email, and then left them off
                          the one screen a patient opens the day before to check the time. Only
                          for bookings still ahead — a preparation note on a completed visit is
                          an instruction for something that already happened. */}
                      {isOpen && appt.preparation_notes?.length > 0 && (
                        <div className="space-y-1 rounded-lg bg-amber-50 px-2.5 py-2 ring-1 ring-inset ring-amber-200">
                          <p className="m-0 flex items-center gap-1.5 text-fine font-semibold text-amber-900">
                            <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                            Before this appointment
                          </p>
                          <ul className="m-0 list-disc space-y-0.5 pl-5 text-fine leading-relaxed text-amber-800">
                            {appt.preparation_notes.map((prep, i) => (
                              <li key={i}>{prep}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {showPayOptions && (
                        <div className="space-y-2 pt-1">
                          <p className="text-fine text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 m-0">
                            Payment is required before your visit. Once paid, your QR booking pass appears
                            here — show it at the front desk on arrival.
                          </p>
                          <div className="flex gap-2">
                            {bookings.gateway.methods.map((method) => (
                              <Button
                                key={method}
                                type="button"
                                disabled={bookings.payingId === appt.id}
                                onClick={() => bookings.payOnline(appt, method)}
                                className="flex-1 text-fine font-bold rounded-lg py-1.5"
                              >
                                {bookings.payingId === appt.id ? 'Redirecting…' : `Pay with ${method}`}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}

                      {isOpen && !appt.is_paid && !bookings.gateway.available && (
                        <p className="text-fine text-gray-500 bg-gray-100 border border-gray-200 rounded-lg p-2 m-0">
                          Please settle payment at the clinic counter on arrival. Your reference code above
                          is what the receptionist needs to check you in.
                        </p>
                      )}

                      {/* Reschedule sits before Cancel, and only while the booking is still
                          Pending — once reception has checked the patient in, the date is not
                          the thing anyone is changing. Ordering matters here: cancelling used to
                          be the only way to change a booking, so it was doing duty as both, and
                          a patient who only wanted a different Tuesday gave their slot up to get
                          it. The gentler action goes first. */}
                      {(appt.status === 'Pending' || isCancellable) && (
                        <div className="flex gap-2 pt-0.5">
                          {appt.status === 'Pending' && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => bookings.openReschedule(appt)}
                              className="flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-fine font-bold"
                            >
                              <CalendarClock className="h-3.5 w-3.5" />
                              <span>Reschedule</span>
                            </Button>
                          )}
                          {isCancellable && (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => bookings.requestCancel(appt)}
                              className="flex-1 items-center justify-center gap-1.5 rounded-lg border-rose-200 py-1.5 text-fine font-bold text-rose-600 hover:bg-rose-50"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                              <span>Cancel</span>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              </div>
            </CardContent>
            {bookings.appointments.length > 0 && (
              <Pagination
                page={safePage}
                totalPages={totalPages}
                onPageChange={bookings.setPage}
                total={bookings.appointments.length}
                pageSize={LIST_PAGE_SIZE}
              />
            )}
          </Card>
        </TabsContent>
  );
}
