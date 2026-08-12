import * as React from "react"

import { cn } from "../../lib/utils"
import { Badge } from "./badge"

// Canonical status → color mapping for this app (see .agents/_shared/VISUAL_IDENTITY.md,
// "Status-to-color mapping" decision). Covers every distinct status/approval_status value
// across patient_visits, appointments, visit_tests, hmo_requests, hmo_request_tests, and
// payments (per database/schema.sql's CHECK constraints) so one component can represent all
// of them consistently, replacing the three independently hand-copied color maps found by
// the 2026-08-10 audit (ClientDashboard.getStatusColor, ReceptionistDashboard's inline
// ternary, DiagnosticDashboard's inline ternary).
const STATUS_STYLES = {
  Pending: "bg-amber-100 text-amber-800",
  Processing: "bg-indigo-100 text-indigo-800",
  // visit_tests only: the modality has performed the exam and recorded findings, and the
  // result is awaiting authorisation. Sits between Processing and Completed, so it gets its
  // own hue rather than reusing either neighbour's.
  "Waiting for Release": "bg-violet-100 text-violet-800",
  Approved: "bg-emerald-100 text-emerald-800",
  Confirmed: "bg-emerald-100 text-emerald-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Paid: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-rose-100 text-rose-800",
  Rejected: "bg-rose-100 text-rose-800",
  Failed: "bg-rose-100 text-rose-800",
  "No Show": "bg-rose-100 text-rose-800",
  Refunded: "bg-slate-200 text-slate-700",
};

const DEFAULT_STYLE = "bg-muted text-muted-foreground";

function StatusBadge({ status, className, ...props }) {
  const style = STATUS_STYLES[status] || DEFAULT_STYLE;
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-bold", style, className)}
      {...props}
    >
      {status}
    </Badge>
  );
}

export { StatusBadge, STATUS_STYLES }
