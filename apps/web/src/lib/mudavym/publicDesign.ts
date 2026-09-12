/**
 * The public door's one switch (ADR 0133 §Decision 1).
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
 * Precedence, the same shape as the per-house hook:
 *
 * 1. `localStorage["mudavym.design.public"]` — a designer's own browser.
 *    `"1" | "true" | "on"` forces the house treatment, `"0" | "false" | "off"`
 *    forces today's page. Anything else falls through.
 * 2. `import.meta.env.VITE_MUDAVYM_PUBLIC` — the deployment switch. Set on
 *    Vercel by the founder's own keystroke; `"1" | "true" | "on"` turns the
 *    public door on for everyone at once. It is read HERE and nowhere else —
 *    a page that reads the env directly is a review defect.
 * 3. `false`. Absence is off, and off is byte-identical to today.
 *
 * Why a build-time variable and not a flag row: there is no row to read. A
 * stranger has no house to be enrolled in, so "one house at a time" cannot
 * apply to the front door; the honest shape is one switch that opens it for
 * every visitor, the same way the mark shipped to production (PR #172).
 */

export const PUBLIC_OVERRIDE_KEY = 'mudavym.design.public';

/** The env value as Vite injects it at build time; `undefined` when unset. */
function readEnv(): string | undefined {
  // Written as the literal `import.meta.env.VITE_MUDAVYM_PUBLIC` on purpose:
  // Vite replaces exactly that expression with the build-time value, and
  // vitest's `vi.stubEnv` reaches exactly that expression. A cast between
  // `import.meta` and `.env` defeats both (measured 2026-09-06: six env cases
  // read `undefined` until this was made literal).
  try {
    return import.meta.env.VITE_MUDAVYM_PUBLIC as string | undefined;
  } catch {
    return undefined;
  }
}

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
 * untouched. Pure and synchronous: nothing to await, nothing to flash.
 */
export function isPublicDesignOn(): boolean {
  const override = readOverride();
  if (override !== null) return override;
  return parse(readEnv()) ?? false;
}

/**
 * Hook form, for symmetry with `useMudavymDesign`. The value cannot change
 * during a session (the env is baked in; the override is read on render), so
 * this is a plain call — no state, no effect, no request.
 */
export function usePublicDesign(): boolean {
  return isPublicDesignOn();
}
