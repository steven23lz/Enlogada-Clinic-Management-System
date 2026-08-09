import * as React from "react"

import { cn } from "../../lib/utils"

// Plain native <input type="checkbox"> rather than @radix-ui/react-checkbox — that package
// isn't an existing dependency, and adding it for this alone wasn't judged necessary. If a
// future feature needs indeterminate state / custom check-icon rendering, that's the trigger
// to add @radix-ui/react-checkbox and upgrade this component, not before.
const Checkbox = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <input
      type="checkbox"
      className={cn(
        "h-4 w-4 shrink-0 rounded border border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Checkbox.displayName = "Checkbox"

export { Checkbox }
