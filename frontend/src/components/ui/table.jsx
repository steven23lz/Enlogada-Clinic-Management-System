import * as React from "react"

import { cn } from "../../lib/utils"

// The vendored shadcn table, retuned to this app's density.
//
// The defaults it shipped with (h-12 header, p-4 cells, text-sm, a full-width border under every
// row) were built for a marketing-site data table, not a worklist someone scans two hundred times
// a shift. Every call site had therefore been overriding them by hand — `className="text-meta
// font-bold uppercase py-3"` appears on forty-one `<TableHead>` elements — which meant the
// defaults were doing nothing except being overridden slightly differently on each screen.
//
// The overrides are now the defaults, so a new table looks like the others without anyone
// remembering the incantation, and the existing per-call-site classes still win where a screen
// genuinely needs something different (a right-aligned currency column, say).
//
// `sticky` on <TableHeader> is the one genuinely new capability: the modality worklists and the
// transaction log routinely run past a screen height, and a scrolled table with its header off
// the top is a table you have to scroll back up to read.

const Table = React.forwardRef(({ className, containerClassName, ...props }, ref) => (
  <div className={cn("relative w-full overflow-auto", containerClassName)}>
    <table
      ref={ref}
      className={cn("w-full caption-bottom border-collapse text-[13px]", className)}
      {...props} />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef(({ className, sticky = false, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "bg-slate-50/80 [&_tr]:border-b [&_tr]:border-[#e6ebf1]",
      sticky && "sticky top-0 z-10 backdrop-blur-sm",
      className
    )}
    {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props} />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t border-[#e6ebf1] bg-slate-50/80 font-semibold [&>tr]:last:border-b-0", className)}
    {...props} />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      // A hairline that is lighter than the panel's own border, so rows read as divisions
      // *within* one object rather than as a stack of separate objects.
      "border-b border-[#eef2f6] transition-colors hover:bg-slate-50/70 data-[state=selected]:bg-brand-50",
      className
    )}
    {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-9 whitespace-nowrap px-4 text-left align-middle text-micro font-semibold uppercase tracking-[0.1em] text-slate-500 [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props} />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn("px-4 py-3 align-middle text-[13px] text-slate-700 [&:has([role=checkbox])]:pr-0", className)}
    {...props} />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-fine text-slate-500", className)}
    {...props} />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
