import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils"

// Focus rings are handled globally by the `:focus-visible` rule in index.css rather than
// per-variant here, so the app's hand-rolled `<button className="border-0">` elements — of which
// there are many, and which never picked up Tailwind's ring utilities — get the same treatment as
// these. Keyboard users were previously losing the cursor several times per screen.
const buttonVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg text-note font-semibold transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The primary action. `active:` scale is deliberately absent — a button that shrinks
        // under the cursor feels playful, which is wrong on a screen where the primary action
        // takes a patient's money or releases a diagnostic report.
        default:
          "bg-brand-500 text-white shadow-[0_1px_2px_rgb(15_23_42_/_0.10)] hover:bg-brand-600 active:bg-brand-700",
        destructive:
          "bg-rose-600 text-white shadow-[0_1px_2px_rgb(15_23_42_/_0.10)] hover:bg-rose-700 active:bg-rose-800",
        outline:
          "border border-slate-200 bg-white text-slate-700 shadow-[0_1px_2px_rgb(15_23_42_/_0.04)] hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
        // The dark counterpart to `default`, for a second high-emphasis action beside it.
        secondary:
          "bg-slate-900 text-white shadow-[0_1px_2px_rgb(15_23_42_/_0.10)] hover:bg-slate-800 active:bg-slate-950",
        subtle:
          "bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        link: "text-brand-600 underline-offset-4 hover:underline",
      },
      size: {
        // 36px. The old 40px default made a toolbar of four controls taller than the content it
        // filtered.
        default: "h-9 px-3.5 py-2",
        sm: "h-8 rounded-md px-2.5 text-fine",
        xs: "h-7 rounded-md px-2 text-fine [&_svg]:size-3.5",
        lg: "h-11 rounded-xl px-6 text-sm",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 rounded-md [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
