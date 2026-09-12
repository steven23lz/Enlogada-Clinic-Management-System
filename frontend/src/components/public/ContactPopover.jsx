import React, { useEffect, useId, useRef, useState } from 'react';
import { Phone, Mail, MapPin } from 'lucide-react';
import FacebookIcon from './FacebookIcon';
import { useClinic, httpsUrl, displayUrl } from '../../lib/clinic';
import { cn } from '../../lib/utils';

/**
 * "Contact Us" in the public header: the phone, the email, the Facebook page and the address, one
 * click from any page. [1.72.0] The reference site's header carries the same control.
 *
 * Every value comes from useClinic() — the identity the receipt and the result form print — so the
 * header cannot disagree with a document the patient is holding. The footer and About page did
 * exactly that once the address on the printed form was corrected.
 *
 * On the compact desktop row (lg to xl) the trigger shows only its icon. Its accessible name is
 * "Contact Us" at every width, and matches the visible label where there is one.
 */
export default function ContactPopover({ className }) {
  const CLINIC = useClinic();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const tel = CLINIC.phone.replace(/\s/g, '');
  const facebook = httpsUrl(CLINIC.facebook);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Contact Us"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-full border-0 px-2 py-1.5 text-note font-semibold transition-colors xl:px-3',
          open ? 'bg-brand-50 text-brand-700' : 'bg-transparent text-ink-soft hover:text-ink'
        )}
      >
        <Phone className="h-4 w-4 xl:hidden" aria-hidden="true" />
        <span className="hidden xl:inline">Contact Us</span>
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Contact the clinic"
          className="animate-fade-in absolute right-0 top-full z-50 mt-3 w-[min(21rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-4 shadow-float"
        >
          <p className="m-0 text-meta font-semibold uppercase tracking-[0.14em] text-ink-muted">Contact the clinic</p>
          <ul className="m-0 mt-3 list-none space-y-1 p-0">
            <li>
              <a
                href={`tel:${tel}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-note font-semibold text-ink no-underline transition-colors hover:bg-sunken"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                  <Phone className="h-4 w-4" aria-hidden="true" />
                </span>
                {CLINIC.phone}
              </a>
            </li>
            <li>
              <a
                href={`mailto:${CLINIC.email}`}
                className="flex items-center gap-3 rounded-lg px-2 py-2 text-note font-semibold text-ink no-underline transition-colors [overflow-wrap:anywhere] hover:bg-sunken"
              >
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </span>
                {CLINIC.email}
              </a>
            </li>
            {facebook && (
              <li>
                {/* Facebook's own blue on the mark, so it is recognised at a glance. As a non-text
                    mark it needs 3:1: 4.2:1 on white, and above 3:1 on the dark chip. */}
                <a
                  href={facebook}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg px-2 py-2 text-note font-semibold text-ink no-underline transition-colors hover:bg-sunken"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-azure-100 text-[#1877F2]">
                    <FacebookIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{displayUrl(facebook)}</span>
                  <span className="sr-only"> (Facebook, opens in a new tab)</span>
                </a>
              </li>
            )}
            <li className="flex items-start gap-3 px-2 py-2 text-note leading-relaxed text-ink-soft">
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-azure-100 text-azure-700">
                <MapPin className="h-4 w-4" aria-hidden="true" />
              </span>
              {/* Wraps rather than truncates — a clipped address is a wrong address. */}
              <span className="pt-1">{CLINIC.address}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
