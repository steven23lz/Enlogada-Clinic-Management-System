import * as React from "react"
import { Search } from "lucide-react"

import { cn } from "../../lib/utils"

// Canonical search-box pattern (see .agents/_shared/VISUAL_IDENTITY.md, "Shared search
// component" decision), replacing the six independently hand-rolled search inputs found by
// the 2026-08-10 audit (SidebarLayout, AdminDashboard, ReceptionistDashboard,
// CashierDashboard, DiagnosticDashboard, ClientDashboard all duplicated a near-identical
// `pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs ...` block).
const SearchInput = React.forwardRef(({ className, containerClassName, ...props }, ref) => {
  return (
    <div className={cn("relative", containerClassName)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        className={cn(
          // Matches Input's geometry exactly (h-9, rounded-lg, 13px) so a search box and a date
          // field sitting in the same toolbar line up on both edges. They previously differed by
          // 6px of height and 4px of radius, which is enough to make a filter row look assembled
          // rather than designed.
          "h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-[13px] text-slate-900 transition-colors placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-brand-400 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    </div>
  );
})
SearchInput.displayName = "SearchInput"

export { SearchInput }
