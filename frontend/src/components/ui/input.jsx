import * as React from "react"

import { cn } from "../../lib/utils"

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        // 16px on mobile (iOS zooms the viewport on focus below that), 13px from `md` up where
        // the app is actually used all day. The focus treatment is the global one from
        // index.css plus a border shift, so the control itself reacts rather than only a ring
        // appearing outside it.
        "flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 transition-colors file:border-0 file:bg-transparent file:text-fine file:font-medium file:text-slate-700 placeholder:text-slate-400 hover:border-slate-300 focus-visible:border-brand-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60 md:text-note",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Input.displayName = "Input"

export { Input }
