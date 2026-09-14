import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

/**
 * Whose records the portal is showing, as a chip in the header. [1.81.0]
 *
 * An account owns several patient profiles — a parent booking for a child is the ordinary case — and
 * every tab answers for the one chosen here. It replaces the "Active Profile" bar that took a whole
 * row above the page. The accessible name is unchanged ("Active patient profile").
 *
 * "Viewing" is a <b>, not a <span>: the trigger clamps every child span to one line with
 * `display: -webkit-box`, which beats `hidden`, so a span stayed on screen at 390 px and took the
 * room the patient's name needed.
 */
export default function PatientSwitcher({ profiles }) {
  if (!profiles || profiles.profiles.length === 0) return null;

  return (
    <Select value={profiles.selectedId} onValueChange={profiles.setSelectedId}>
      <SelectTrigger
        aria-label="Active patient profile"
        className="h-9 w-auto max-w-[11rem] rounded-full border-line bg-slate-50 px-3 text-fine font-semibold xl:max-w-[16rem]"
      >
        <b className="hidden flex-shrink-0 font-medium text-ink-muted sm:inline">Viewing</b>
        <SelectValue placeholder="Choose a patient" />
      </SelectTrigger>
      <SelectContent>
        {profiles.profiles.map((p) => (
          <SelectItem key={p.id} value={p.id.toString()}>
            {p.first_name} {p.last_name} ({p.patient_type_name || 'Patient'})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
