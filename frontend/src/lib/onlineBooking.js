import api from '../config/api';

/**
 * Can a patient book online right now? [1.153.0]
 *
 * Only if there is a way to pay online: a published account, or the gateway. The server decides
 * (appointmentService.createAppointment) and refuses a booking otherwise. This asks the same two
 * things beforehand, so the booking dialog can say so before a patient fills it in, and an Admin's
 * Today can say why nobody is booking. Both reads are ones any signed-in person already may make.
 *
 * @returns {Promise<{open: boolean}>}
 */
export async function readOnlineBooking() {
  const [methods, gateway] = await Promise.all([
    api.get('/payment-methods'),
    api.get('/payments/gateway/status'),
  ]);
  return {
    open: (methods.data.data.methods || []).length > 0 || Boolean(gateway.data.data.gateway?.available),
  };
}
