import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from './ui/button';
import { Printer, CheckCircle2 } from 'lucide-react';

// UI/UX Modernization Phase 10: replaces the old plain-text success message (auto-closed after
// 4 seconds with no lasting record) with a durable, printable confirmation. The QR encodes the
// raw appointment_reference string — ReceptionistDashboard.jsx's QrScanner already hands its
// decoded text straight to GET /appointments/verify/:ref with no URL-parsing step, so this
// closes the loop with zero backend change.
const BookingConfirmation = ({ referenceCode, queueNumber, patientName, scheduledDate, scheduledTime, onClose }) => {
  return (
    <div className="space-y-5">
      <div className="flex items-center space-x-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm font-bold">Appointment booked successfully!</span>
      </div>

      <div className="print-area space-y-4 bg-white rounded-2xl border border-gray-100 p-5 text-center">
        <div className="space-y-0.5">
          <h3 className="text-sm font-extrabold text-slate-900 uppercase tracking-wide m-0">Enlogada Ultrasound &amp; Diagnostic Clinic</h3>
          <p className="text-xs text-gray-500 m-0">Appointment Confirmation</p>
        </div>

        <div className="flex justify-center py-2">
          <div className="p-3 bg-white border border-gray-200 rounded-xl inline-block">
            <QRCodeSVG value={referenceCode} size={144} />
          </div>
        </div>

        <p className="text-fine text-gray-400 m-0">Present this code at the front desk, or let reception scan it on arrival.</p>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
          <div className="space-y-0.5">
            <span className="text-meta font-bold text-gray-400 uppercase tracking-wider block">Reference Code</span>
            <span className="text-sm font-extrabold text-slate-900 font-mono">{referenceCode}</span>
          </div>
          <div className="space-y-0.5">
            <span className="text-meta font-bold text-gray-400 uppercase tracking-wider block">Queue Ticket</span>
            <span className="text-lg font-extrabold text-[#769046]">{queueNumber}</span>
          </div>
        </div>

        {(patientName || scheduledDate) && (
          <div className="pt-3 border-t border-gray-100 text-xs text-gray-500 space-y-0.5">
            {patientName && <p className="m-0 font-semibold">{patientName}</p>}
            {scheduledDate && <p className="m-0">{scheduledDate}{scheduledTime ? ` at ${scheduledTime}` : ''}</p>}
          </div>
        )}
      </div>

      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={() => window.print()} className="text-xs font-bold flex items-center space-x-1.5">
          <Printer className="w-3.5 h-3.5" />
          <span>Print</span>
        </Button>
        <Button type="button" onClick={onClose} className="bg-[#769046] hover:bg-[#657c3a] text-white text-xs font-bold">
          Done
        </Button>
      </div>
    </div>
  );
};

export default BookingConfirmation;
