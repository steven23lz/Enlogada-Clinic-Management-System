import React, { useCallback, useEffect, useState } from 'react';
import { Input } from '../ui/input';
import api from '../../config/api';
import { todayStr } from '../../lib/date';
import { CalendarX2, Clock } from 'lucide-react';

/**
 * Pick a date, then a time the clinic actually has free.
 *
 * Extracted from the booking wizard when rescheduling needed the same control. Two copies of this
 * would have been two answers to "which slots are free" — and they would drift, because the copy
 * you are not looking at is the one that keeps the old rule. It owns its own availability fetch
 * for the same reason: a caller that forgot to refetch on a date change would silently offer
 * yesterday's slots.
 *
 * `currentTime` marks the slot the caller already holds. Rescheduling without it is disorienting:
 * the patient sees a grid of times with no indication of where they are now, and the slot they
 * currently occupy looks free — which it is, to them, and to nobody else.
 */
const SlotPicker = ({
  date,
  time,
  onDateChange,
  onTimeChange,
  currentDate = null,
  currentTime = null,
  disabled = false,
  minDate = todayStr(),
  label = 'Date',
  // Bump to force a refetch. The caller needs this after a 409 on submit: somebody took the slot
  // while the patient was filling the rest of the form, and the grid is now showing a free time
  // that is not free. Without it the patient re-submits the same slot and is refused again.
  refreshKey = 0,
}) => {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dayIsOpen, setDayIsOpen] = useState(true);
  const [error, setError] = useState('');

  const fetchAvailability = useCallback(async (forDate) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/appointments/availability', { params: { date: forDate } });
      const data = res.data.data;
      setSlots(data.slots || []);
      setDayIsOpen(data.isOpen !== false);
    } catch {
      // Distinguished from "no slots": an empty grid after a failed request reads as a fully
      // booked day, which is a different thing to tell a patient than "we could not check".
      setSlots([]);
      setDayIsOpen(true);
      setError('Could not load available times. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!date) {
      setSlots([]);
      return;
    }
    fetchAvailability(date);
  }, [date, refreshKey, fetchAvailability]);

  // A slot chosen a moment ago can be taken by somebody else before submit. Clearing it here means
  // the form cannot carry a selection the server will refuse — the alternative is a 409 explaining
  // that a time the screen is still showing as chosen is gone.
  useEffect(() => {
    if (!time || slots.length === 0) return;
    const stillFree = slots.some((s) => s.time === time && s.available);
    const isTheOneWeAlreadyHold = date === currentDate && time === currentTime;
    if (!stillFree && !isTheOneWeAlreadyHold) onTimeChange('');
    // onTimeChange is intentionally excluded: callers pass an inline arrow, so including it would
    // re-run this on every render and fight the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, time, date, currentDate, currentTime]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label htmlFor="slotpicker-label" className="field-label">{label}</label>
        <Input id="slotpicker-label"
          type="date"
          value={date || ''}
          min={minDate}
          disabled={disabled}
          onChange={(e) => onDateChange(e.target.value)}
          required
        />
      </div>

      {date && (
        <div className="space-y-1.5">
          <label className="field-label">Available Time</label>

          {loading ? (
            <div className="flex items-center gap-2 py-2 text-fine font-semibold text-slate-400">
              <Clock className="h-3.5 w-3.5 animate-pulse" />
              Loading available times…
            </div>
          ) : error ? (
            <div role="alert" className="alert alert-error">{error}</div>
          ) : !dayIsOpen ? (
            <div className="alert alert-warning">
              <CalendarX2 />
              <span>The clinic is closed on this date. Please choose another.</span>
            </div>
          ) : slots.length === 0 ? (
            <div className="py-2 text-fine font-semibold text-slate-400">
              No time slots are configured for this date.
            </div>
          ) : (
            <>
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto p-0.5">
                {slots.map((slot) => {
                  const isHeldByUs = date === currentDate && slot.time === currentTime;
                  const selected = time === slot.time;
                  const selectable = slot.available || isHeldByUs;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={disabled || !selectable}
                      onClick={() => onTimeChange(slot.time)}
                      aria-pressed={selected}
                      title={isHeldByUs ? 'Your current appointment time' : undefined}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                        selected
                          ? 'border-brand-500 bg-brand-500 text-white'
                          : isHeldByUs
                            ? 'border-brand-300 bg-brand-50 text-brand-700'
                            : selectable
                              ? 'border-gray-200 bg-white text-slate-700 hover:border-brand-500'
                              : 'cursor-not-allowed border-[#e6ebf1] bg-gray-100 text-gray-300 line-through'
                      }`}
                    >
                      {slot.time}
                    </button>
                  );
                })}
              </div>
              {currentDate === date && currentTime && (
                <p className="m-0 text-micro text-slate-500">
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand-300 align-middle" />
                  Your current time. Struck-through slots are already taken.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SlotPicker;
