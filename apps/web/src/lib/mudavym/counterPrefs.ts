/**
 * The counter's width — "Open first, then remember" (the founder's pick,
 * 2026-09-21, sketch 119 fork 10).
 *
 *   - Open on a person's first visits and at normal widths.
 *   - Tucked below ~1280 px, and on the wide pages (/reports, /inventory), to a
 *     ~52 px strip that still shows each verb with its count — never a blank
 *     edge.
 *   - After that, each person's choice PER PAGE is remembered, and wins.
 *
 * WHERE THE CHOICE IS KEPT, AND WHY (the pick allowed either)
 * ------------------------------------------------------------
 * localStorage, keyed by the person's user id, per device. The one server
 * store for a person's preferences, `GET/PATCH /users/:userId/preferences`,
 * takes the user id from the URL under `JwtAuthGuard` alone
 * (user-preferences.controller.ts) — writing a per-person choice through it
 * would build on a route that does not check the id is the caller's. Until
 * that route is scoped to the token, a per-device record is the honest first
 * version; it survives reloads, it is one person's on a shared till because
 * the key names the person, and a failed or blocked storage simply falls back
 * to the default rule rather than breaking the shell.
 */

/** Below this viewport width the counter starts tucked. */
export const TUCK_BELOW_PX = 1280;

/** Pages whose own layout wants the width (reports-next.css asks 1280). */
export const WIDE_PAGES: readonly string[] = ['/reports', '/inventory'];

export type CounterWidth = 'open' | 'tucked';

export interface ShellPrefs {
  /** The person's own choice, per page key. Absent = never chosen there. */
  counter: Record<string, CounterWidth>;
  /** The rooms rail tucked to its strip (⌘\). One choice, not per page. */
  railTucked: boolean;
}

const EMPTY: ShellPrefs = { counter: {}, railTucked: false };

export function prefsKeyFor(userId: string): string {
  return `mudavym.shell.v1.${userId}`;
}

/**
 * The page a choice is remembered for: the path's first segment, so
 * `/documents/abc` and `/documents/def` are one page and `/reports?tab=x` is
 * `/reports`. The query and hash never name a page.
 */
export function pageKeyOf(pathname: string): string {
  const clean = (pathname || '/').split(/[?#]/)[0];
  const first = clean.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
}

/** The rule. A remembered choice wins; otherwise width, then the page. */
export function counterWidthFor(
  pathname: string,
  viewportWidth: number,
  prefs: ShellPrefs,
): CounterWidth {
  const key = pageKeyOf(pathname);
  const chosen = prefs.counter[key];
  if (chosen === 'open' || chosen === 'tucked') return chosen;
  if (viewportWidth < TUCK_BELOW_PX) return 'tucked';
  if (WIDE_PAGES.includes(key)) return 'tucked';
  return 'open';
}

export function readShellPrefs(userId: string | null | undefined): ShellPrefs {
  if (!userId) return { ...EMPTY, counter: {} };
  try {
    const raw = window.localStorage.getItem(prefsKeyFor(userId));
    if (!raw) return { ...EMPTY, counter: {} };
    const parsed = JSON.parse(raw) as Partial<ShellPrefs>;
    const counter: Record<string, CounterWidth> = {};
    if (parsed && typeof parsed.counter === 'object' && parsed.counter) {
      for (const [k, v] of Object.entries(parsed.counter)) {
        if (v === 'open' || v === 'tucked') counter[k] = v;
      }
    }
    return { counter, railTucked: parsed?.railTucked === true };
  } catch {
    return { ...EMPTY, counter: {} };
  }
}

export function writeShellPrefs(userId: string | null | undefined, prefs: ShellPrefs): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(prefsKeyFor(userId), JSON.stringify(prefs));
  } catch {
    /* storage blocked or full — the choice lasts this sitting only */
  }
}

/** The person chose `width` on this page; remember it. */
export function rememberCounterWidth(
  prefs: ShellPrefs,
  pathname: string,
  width: CounterWidth,
): ShellPrefs {
  return { ...prefs, counter: { ...prefs.counter, [pageKeyOf(pathname)]: width } };
}
