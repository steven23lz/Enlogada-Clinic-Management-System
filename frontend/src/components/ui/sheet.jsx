import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { DialogOverlay } from './dialog';

/**
 * A panel that slides in from the side, over the screen it belongs to. [1.75.0]
 *
 * The same Radix dialog as dialog.jsx, so it has the focus trap, Escape, the scroll lock and
 * aria-modal, and the same rule that Escape closes an open date popover before the panel (see
 * DialogContent). Only the geometry differs: full height, anchored right, so the screen behind it
 * stays in view. On the front desk that is the point — registering a walk-in no longer takes the
 * receptionist off the queue they are watching.
 */
const Sheet = DialogPrimitive.Root;
const SheetClose = DialogPrimitive.Close;

const SheetContent = React.forwardRef(({ className, children, onEscapeKeyDown, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      onEscapeKeyDown={(event) => {
        if (document.querySelector('[data-datefield-open]')) event.preventDefault();
        onEscapeKeyDown?.(event);
      }}
      className={cn(
        // Wide enough for the registration form's two columns (it lays out on a container query at
        // 48rem); full width on a phone.
        'fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-4xl flex-col overflow-y-auto border-l border-line bg-surface p-5 shadow-overlay sm:p-6',
        'duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-3.5 top-3.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';

const SheetHeader = ({ className, ...props }) => (
  <div className={cn('mb-4 space-y-1 border-b border-line pb-3 pr-9', className)} {...props} />
);
SheetHeader.displayName = 'SheetHeader';

const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('m-0 text-lead font-bold tracking-tight text-slate-900', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('m-0 text-note leading-relaxed text-slate-500', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;

export { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetDescription };
