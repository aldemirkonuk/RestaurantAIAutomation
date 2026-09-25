/**
 * The public door's one switch (ADR 0133 §Decision 1, waived 2026-09-18 for
 * the "off is byte-identical" clause — see ADR 0133's Review trail; permanent-
 * on at cutover, decision 0149 row 37).
 *
 * Nine routes are public — `/login`, `/register`, `/forgot-password`,
 * `/reset-password`, `/verify-email`, `/invite/:code`, `/no-access`,
 * `/privacy`, `/v/:slug`. A visitor there has no house, so the per-house gate
 * in `useMudavymDesign.ts` is not "off" for them: it is structurally unable to
 * be on (it returns `false` before any request when no restaurant id exists).
 * The founder's verdict on `/login` and `/register` was to improve the page
 * that ships, never to build a parallel tree — so the improvement lives IN
 * those pages and reads this one module to decide whether it is on.
 *
 * Decision 0149 ("Mudavym is the only design") makes the house treatment the
 * only one that ships: `isPublicDesignOn()` now resolves `true` unconditionally,
 * with exactly one escape —
 *
 * 1. `localStorage["mudavym.design.public"]` set to `"0" | "false" | "off"` —
 *    a QA override, kept ONLY so today's page keeps compiling and is
 *    reachable for comparison until it is deleted (decision 0149's gated
 *    cutover). `"1" | "true" | "on"` is accepted too, but is now a no-op:
 *    the house treatment was already going to render.
 * 2. Anything else — no override, or `VITE_MUDAVYM_PUBLIC` set or unset — is
 *    `true`. The deployment env var is no longer read: there is nothing left
 *    for it to gate.
 */

export const PUBLIC_OVERRIDE_KEY = 'mudavym.design.public';

function parse(raw: string | null | undefined): boolean | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'off') return false;
  return null;
}

/** null = no override present; boolean = forced state. */
function readOverride(): boolean | null {
  try {
    if (typeof window === 'undefined') return null;
    return parse(window.localStorage.getItem(PUBLIC_OVERRIDE_KEY));
  } catch {
    return null; // storage blocked — behave as if no override
  }
}

/**
 * `true` → the public pages wear the house treatment; `false` → today's page,
 * kept compiling only for the explicit QA override. Pure and synchronous:
 * nothing to await, nothing to flash.
 */
export function isPublicDesignOn(): boolean {
  const override = readOverride();
  if (override === false) return false;
  return true;
}

/**
 * Hook form, for symmetry with `useMudavymDesign`. The value cannot change
 * during a session — it resolves `true` unconditionally except the explicit
 * QA `localStorage` override, read fresh on every render — so this is a
 * plain call — no state, no effect, no request.
 */
export function usePublicDesign(): boolean {
  return isPublicDesignOn();
}
