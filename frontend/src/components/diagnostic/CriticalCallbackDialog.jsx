import React from 'react';
import { CheckCircle2, PhoneCall } from 'lucide-react';
import EmptyState from '../ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { formatDateTime } from '../../lib/date';

/**
 * Who still has to be telephoned about a panic value.
 *
 * Lifted out of DiagnosticDashboard, which rendered both worklist modes and four dialogs
 * from one 847-line file. The props are the hooks this piece reads.
 * 
 * Oldest first, because the age of an un-made call is the whole severity of it.
 * Who still has to be telephoned. [1.28.0]
 * The endpoint existed with nothing reading it; before that, the only sign of a panic
 * value anywhere was a badge on one department's worklist row. Oldest first, because the
 * age of an un-made call is the whole severity of it — and the number is shown in the
 * open rather than behind a hover, since the reason this fails is people not looking.
 */
export default function CriticalCallbackDialog({ criticals }) {
  return (
    <Dialog open={criticals.expanded} onOpenChange={criticals.setExpanded}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Critical results awaiting a callback</DialogTitle>
          <DialogDescription>
            Released with a panic value and not yet confirmed as communicated. Telephone the
            patient, then record the call — whoever makes it, from any department.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {criticals.outstanding.map((c) => (
            <div
              key={c.visit_test_id}
              className="rounded-xl border border-rose-200 bg-rose-50/60 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 text-note font-bold text-slate-900">
                    {c.first_name} {c.last_name}
                  </p>
                  <p className="m-0 text-fine text-slate-600">
                    {c.test_name} &bull; released {c.released_at ? formatDateTime(c.released_at) : '—'}
                  </p>
                </div>
                {/* The number is the point of the row: it is what the person acts on. */}
                {c.contact_number && (
                  <a
                    href={`tel:${c.contact_number}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-fine font-bold text-destructive-foreground no-underline hover:bg-destructive-hover"
                  >
                    <PhoneCall className="h-3.5 w-3.5" />
                    {c.contact_number}
                  </a>
                )}
              </div>
              {c.findings && (
                <p className="m-0 mt-1.5 line-clamp-2 text-fine text-slate-700">{c.findings}</p>
              )}
              {!c.contact_number && (
                <p className="m-0 mt-1.5 text-fine font-semibold text-rose-700">
                  No contact number on file — check the visit record.
                </p>
              )}
            </div>
          ))}
          {criticals.outstanding.length === 0 && (
            <EmptyState
              icon={CheckCircle2}
              title="Every critical result has been called through"
              description="Nothing is waiting on a phone call."
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
