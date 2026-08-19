import { useEffect, useRef } from 'react';

/**
 * Bring a message into view the moment it appears.
 *
 * A validation error usually renders at the top of a form and the submit button sits at the
 * bottom of it. On the walk-in registration form — the longest staff form in the app, and longer
 * still once tests are ticked and the preparation notice unfolds — that puts the two more than a
 * viewport apart. The receptionist clicks Register, the form refuses, and from where they are
 * looking absolutely nothing happens. It is intermittent, too, which is worse than being broken
 * outright: on a short form the alert happens to be visible, so the fault only shows up on the
 * long entries where a mistake is likeliest.
 *
 * `role="alert"` already announces it to a screen reader. This is the sighted equivalent.
 *
 * `smooth` is deliberate — an instant jump reads as the page having navigated somewhere, and the
 * point is to show the reader that the thing they were looking at moved.
 */
export function useScrollIntoViewOnSet(value) {
  const ref = useRef(null);

  useEffect(() => {
    if (!value || !ref.current) return;
    ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [value]);

  return ref;
}
