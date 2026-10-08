/**
 * The counter's width — "Open first, then remember" (the founder's pick,
 * 2026-09-21, sketch 119 fork 10), narrowed 2026-10-01 to ONE choice.
 *
 *   - Open on a person's first visits and at normal widths.
 *   - Tucked below ~1280 px, and on the wide pages (/reports, /inventory and
 *     the dashboard at /), to a
 *     ~52 px strip that still shows each verb with its count — never a blank
 *     edge.
 *   - After that, the person's choice is remembered and wins on EVERY page.
 *
 * WHY ONE CHOICE, NOT ONE PER PAGE (founder, 2026-10-01)
 * ------------------------------------------------------
 * The first build remembered the choice per page, so a person who closed the
 * counter on one page saw it open again on the next: "even if I close the
 * counter, when I change pages, it reopens itself. That shouldn't happen." A
 * record written by that build (an object of page → width) carries no single
 * answer, so it is read as "never chosen", and the next toggle writes the one.
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

/**
 * Pages whose own layout wants the width (reports-next.css asks 1280). The
 * dashboard (`/`) joined them on 2026-10-05: its month needs the room for a
 * 12 px figure, and the founder chose this over stacking its side rail or
 * no change ("Counter starts tucked", ADR 0290).
 */
export const WIDE_PAGES: readonly string[] = ['/reports', '/inventory', '/'];

export type CounterWidth = 'open' | 'tucked';

export interface ShellPrefs {
  /** The person's own choice, for every page. Null = never chosen. */
  counter: CounterWidth | null;
  /** The rooms rail tucked to its strip (⌘\). One choice, not per page. */
  railTucked: boolean;
}

const EMPTY: ShellPrefs = { counter: null, railTucked: false };

export function prefsKeyFor(userId: string): string {
  return `mudavym.shell.v1.${userId}`;
}

/**
 * The page a path belongs to, for the wide-page default: the path's first
 * segment, so `/documents/abc` and `/documents/def` are one page and
 * `/reports?tab=x` is `/reports`. The query and hash never name a page.
 */
export function pageKeyOf(pathname: string): string {
  const clean = (pathname || '/').split(/[?#]/)[0];
  const first = clean.split('/').filter(Boolean)[0];
  return first ? `/${first}` : '/';
}

/** The rule. A remembered choice wins everywhere; otherwise width, then the page. */
export function counterWidthFor(
  pathname: string,
  viewportWidth: number,
  prefs: ShellPrefs,
): CounterWidth {
  if (prefs.counter === 'open' || prefs.counter === 'tucked') return prefs.counter;
  if (viewportWidth < TUCK_BELOW_PX) return 'tucked';
  if (WIDE_PAGES.includes(pageKeyOf(pathname))) return 'tucked';
  return 'open';
}

export function readShellPrefs(userId: string | null | undefined): ShellPrefs {
  if (!userId) return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(prefsKeyFor(userId));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as { counter?: unknown; railTucked?: unknown } | null;
    // Only a width is a choice. The per-page object the first build wrote,
    // and anything else, reads as never chosen.
    const c = parsed?.counter;
    const counter: CounterWidth | null = c === 'open' || c === 'tucked' ? c : null;
    return { counter, railTucked: parsed?.railTucked === true };
  } catch {
    return { ...EMPTY };
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

/** The person chose `width`; remember it for every page. */
export function rememberCounterWidth(prefs: ShellPrefs, width: CounterWidth): ShellPrefs {
  return { ...prefs, counter: width };
}
