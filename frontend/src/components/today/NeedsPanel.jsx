import React from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, FlaskConical, Mail, Receipt, ShieldCheck, Wallet, WifiOff,
} from 'lucide-react';
import { Panel, PanelHeader } from '../ui/panel';
import { Button } from '../ui/button';
import EmptyState from '../ui/empty-state';
import { SkeletonList } from '../ui/skeleton';
import { cn } from '../../lib/utils';

const ICONS = {
  alert: AlertTriangle, clock: Clock, flask: FlaskConical, mail: Mail, receipt: Receipt,
  shield: ShieldCheck, wallet: Wallet, offline: WifiOff,
};

// A tone is carried by the icon as well as the colour, as the status badges do: a pale red tile and
// a pale amber one are the same rectangle on a sunlit reception monitor. "blue" draws from the indigo
// ramp because index.css remaps indigo for dark mode and not blue, which stayed a white tile there.
const TONES = {
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  blue: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  green: 'bg-brand-50 text-brand-700 ring-brand-200',
};

/**
 * "Needs you now": what is waiting on this person, each with the one button that deals with it.
 * [1.77.0]
 *
 * The rows come from lib/today.js as descriptors; this only draws them. One list for the whole
 * screen, however many sections the person works in, so a Receptionist who is also a Cashier sees
 * one "Needs you now", not two.
 *
 * The first row's button is the solid one: the list is ordered by what matters most (a panic value
 * first), and one primary action per list is what makes it read as a list of work rather than a row
 * of equal buttons.
 *
 * @param {object[]} needs        descriptors from lib/today.js
 * @param {boolean}  loading      nothing has answered yet
 * @param {Function} onAction     (action) => void
 * @param {{ label: string, onClick: Function }} [emptyAction]  the way on when nothing is waiting
 */
export default function NeedsPanel({ needs, loading, onAction, emptyAction }) {
  const primaryId = needs.find((need) => need.action)?.id;

  return (
    <Panel data-testid="today-needs">
      <PanelHeader title="Needs you now" />
      {loading && needs.length === 0 ? (
        <div className="p-5">
          <SkeletonList rows={2} />
        </div>
      ) : needs.length === 0 ? (
        <EmptyState
          compact
          icon={CheckCircle2}
          title="Nothing needs you right now"
          description="Anything that comes in shows up here, with a button to deal with it."
          action={emptyAction ? (
            <Button variant="outline" size="sm" onClick={emptyAction.onClick}>{emptyAction.label}</Button>
          ) : undefined}
        />
      ) : (
        <ul className="m-0 list-none divide-y divide-line p-0">
          {needs.map((need) => (
            <NeedRow key={need.id} need={need} primary={need.id === primaryId} onAction={onAction} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function NeedRow({ need, primary, onAction }) {
  const Icon = ICONS[need.icon] || AlertTriangle;
  return (
    <li data-testid="today-need" data-need={need.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3">
      <span
        aria-hidden="true"
        className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ring-inset', TONES[need.tone] || TONES.blue)}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 basis-48">
        <span className="block text-note font-semibold text-slate-900">{need.title}</span>
        {need.detail && <span className="block text-fine text-slate-500">{need.detail}</span>}
      </span>
      {need.action && (
        <Button
          size="sm"
          variant={primary ? 'default' : 'outline'}
          aria-label={need.action.ariaLabel}
          onClick={() => onAction(need.action)}
        >
          {need.action.label}
        </Button>
      )}
    </li>
  );
}
