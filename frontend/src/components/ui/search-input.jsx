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
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
      <input
        type="text"
        className={cn(
          "pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-xl text-xs w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
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
