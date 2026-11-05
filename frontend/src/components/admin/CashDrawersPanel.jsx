import React, { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { Panel, PanelHeader, PanelBody } from '../ui/panel';
import { Button } from '../ui/button';
import api from '../../config/api';
import { toastSuccess } from '../../lib/toast';

const CHOICES = [
  {
    value: 'shared',
    label: 'One shared drawer',
    hint: 'Whoever closes counts all the cash, whichever cashier took it.',
  },
  {
    value: 'per_cashier',
    label: 'One drawer per cashier',
    hint: 'Each cashier counts only the cash they took, and each is checked on Cashier Monitoring.',
  },
];

/**
 * How the clinic's cash is counted. [1.162.0] Steven: one drawer for now, ready for two cashiers.
 * A setting, not a code change, for the day the clinic grows. Counts already made stay as they are.
 */
export default function CashDrawersPanel() {
  const [saved, setSaved] = useState(null);
  const [choice, setChoice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/admin/settings/cash-drawers')
      .then((res) => {
        if (!live) return;
        setSaved(res.data.data.mode);
        setChoice(res.data.data.mode);
      })
      .catch((err) => { if (live) setError(err.response?.data?.message || "Couldn't read this setting."); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.put('/admin/settings/cash-drawers', { mode: choice });
      setSaved(res.data.data.mode);
      toastSuccess(`Cash count set to ${CHOICES.find((c) => c.value === choice).label.toLowerCase()}.`);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't save this setting.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="mt-5" data-testid="cash-drawers">
      <PanelHeader
        icon={Calculator}
        title="Cash drawers"
        description="How the end-of-day Cash Count works. Change this when the clinic adds a cashier with their own drawer. Counts already made stay as they are."
      />
      <PanelBody>
        {error && <div role="alert" className="alert alert-error mb-3"><span>{error}</span></div>}
        {choice && (
          <div className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Cash drawers" className="flex flex-col gap-2">
              {CHOICES.map((c) => (
                <label key={c.value} className="flex cursor-pointer items-start gap-2 text-note text-slate-800">
                  <input
                    type="radio"
                    name="cash-drawers"
                    className="mt-1"
                    checked={choice === c.value}
                    onChange={() => setChoice(c.value)}
                  />
                  <span>
                    <span className="block font-semibold">{c.label}</span>
                    <span className="block text-fine text-slate-500">{c.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <Button size="sm" disabled={choice === saved} loading={busy} onClick={save}>Save</Button>
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
