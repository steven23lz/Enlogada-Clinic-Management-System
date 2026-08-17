import React from 'react';
import { Input } from '../ui/input';
import { Stethoscope } from 'lucide-react';

/**
 * The doctor who requested the test. [1.23.0]
 *
 * One component for the three places it is captured — reception registering a walk-in, reception
 * checking in a patient found by search, and a client booking online — because the rule about
 * when it is mandatory is a single rule (referralService on the server) and three differently
 * worded forms is how a patient gets told something the desk does not ask for.
 *
 * Always shown, conditionally required. A self-paying patient who WAS referred still needs the
 * doctor's name on the record, because the report goes back to them; the requirement only decides
 * whether the form will let you past without it.
 *
 * `required` is presentation only. The server decides — see referralService — and this mirrors it
 * so the patient is not told at submit what could have been said while they were typing.
 */
const ReferringPhysicianFields = ({
  physician,
  prc,
  onPhysicianChange,
  onPrcChange,
  required = false,
  reason = null,
  disabled = false,
  compact = false,
}) => (
  <div className={compact ? 'space-y-2' : 'space-y-3'}>
    <div className="space-y-1.5">
      <label className="field-label">
        Referring Physician {required && <span className="text-rose-600">*</span>}
        {!required && <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">(optional)</span>}
      </label>
      {reason && (
        <p className="m-0 flex items-start gap-1.5 text-fine leading-relaxed text-slate-500">
          <Stethoscope className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-brand-600" />
          <span>{reason}</span>
        </p>
      )}
      <Input
        placeholder="Dr. Juan Dela Cruz"
        value={physician || ''}
        disabled={disabled}
        onChange={(e) => onPhysicianChange(e.target.value)}
        required={required}
      />
    </div>

    {/* Only once there is a name to attach it to. A licence number on its own identifies nobody,
        and the server drops it in that case, so offering the box first invites typing into a
        field whose contents will be discarded. */}
    {physician?.trim() && (
      <div className="space-y-1.5">
        <label className="field-label">
          PRC Licence No.
          <span className="ml-1 font-normal normal-case tracking-normal text-slate-400">(optional)</span>
        </label>
        <Input
          placeholder="0123456"
          value={prc || ''}
          disabled={disabled}
          onChange={(e) => onPrcChange(e.target.value)}
        />
      </div>
    )}
  </div>
);

export default ReferringPhysicianFields;
