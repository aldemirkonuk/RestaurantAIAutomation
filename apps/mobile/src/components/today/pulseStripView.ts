import type { TodayPulse } from "@/api/types";
import { houseClock, houseDay } from "@/lib/houseMoney";

/**
 * Pure view model for `PulseStrip`. Split out so the honesty rule below can
 * be unit-tested without pulling in the RN renderer (this repo's mobile test
 * runner is deliberately logic-only — see `apps/mobile/jest.config.js`).
 *
 * ADR 0020 (`.planning/decisions/0020-no-fabricated-answers.md`, LOCKED):
 * "An error must never render as emptiness" — it names a green 'All clear'
 * badge over a failed/missing request as exactly this anti-pattern. Revenue
 * availability and pending-decision count are two independent facts; this
 * resolver keeps them independent so a missing revenue figure can never
 * borrow the reassurance of a genuinely-zero decision count.
 */

/**
 * Why tonight's sales are missing, in the owner's words (F-674). A failed
 * read is never "connect a register": that sent an owner whose register
 * already feeds the house to set up something that was working.
 */
export const REVENUE_UNAVAILABLE_MESSAGES = {
  no_register: "Connect your register on the web to see tonight's sales here.",
  zone_unset: "Set your restaurant's time zone on the web to see tonight's sales.",
  unread: "Couldn't read tonight's sales just now.",
  no_amounts: "Tonight's checks came in without amounts.",
  // F-957: staff are not sent the house's takings (ADR 0145, DASH-W22).
  withheld: "Tonight's sales are kept for the owner and managers.",
} as const;

/** Kept for callers that name the old constant: the failed-read wording. */
export const REVENUE_UNAVAILABLE_MESSAGE = REVENUE_UNAVAILABLE_MESSAGES.unread;

export const DECISIONS_UNREAD_LABEL = "Couldn't check what's waiting";

export type PulseRevenueView =
  | {
      status: "known";
      amount: number;
      checksLabel: string;
      deltaPct: number | null;
    }
  | {
      status: "unavailable";
      message: string;
    };

export interface PulseStripView {
  /** "Tonight", or the night the figures belong to when they are older. */
  heading: string;
  /**
   * When the figures are from, and whether the last refresh failed (F-676).
   * Null only when no time is known.
   */
  freshness: string | null;
  /** True when the strip is showing figures it could not refresh. */
  stale: boolean;
  revenue: PulseRevenueView;
  /**
   * Rendered as-is when non-null. Deliberately `null` (nothing rendered)
   * rather than "All clear" when revenue is unavailable and the count is
   * zero — with revenue missing, the strip does not know enough about
   * tonight to assert everything is fine, so it says only what it knows
   * (see `revenue`) and stays silent on the rest rather than implying more
   * than it has.
   */
  decisionsLabel: string | null;
}

export interface PulseFetchState {
  /** When these figures were fetched (react-query `dataUpdatedAt`). */
  fetchedAt?: number;
  /** The last refresh failed and the strip is showing saved figures. */
  refreshFailed?: boolean;
  now?: number;
  /** Clock and weekday formatting; injectable so tests do not hang on a zone. */
  formatTime?: (at: Date) => string;
  formatWeekday?: (at: Date) => string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function revenueMessage(data: TodayPulse): string {
  if (data.salesState === "no_register") return REVENUE_UNAVAILABLE_MESSAGES.no_register;
  if (data.salesState === "zone_unset") return REVENUE_UNAVAILABLE_MESSAGES.zone_unset;
  if (data.salesState === "known") return REVENUE_UNAVAILABLE_MESSAGES.no_amounts;
  if (data.salesState === "withheld") return REVENUE_UNAVAILABLE_MESSAGES.withheld;
  return REVENUE_UNAVAILABLE_MESSAGES.unread;
}

export function resolvePulseStripView(
  data: TodayPulse,
  fetch: PulseFetchState = {},
): PulseStripView {
  const now = fetch.now ?? Date.now();
  // The house's clock and weekday names (F-953): "as of 19:30" in a Turkish
  // house. No locale on the pulse keeps the old en-US wording. Both read the
  // house's zone when the pulse names one, not the phone's (F-1074).
  const formatTime =
    fetch.formatTime ?? ((at: Date) => houseClock(at, data.locale, data.timezone));
  const formatWeekday =
    fetch.formatWeekday ??
    ((at: Date) => houseDay(at, data.locale, data.timezone, { weekday: "long" }));

  // F-676: saved figures come back at boot. A night that opened a day or more
  // ago is not tonight, whatever the last refresh did; it is named by its day.
  const opened = data.windowStart ? Date.parse(data.windowStart) : NaN;
  const earlierNight = Number.isFinite(opened) && now - opened >= DAY_MS;
  const heading = earlierNight
    ? `${formatWeekday(new Date(opened + DAY_MS / 2))} night`
    : "Tonight";
  const refreshFailed = fetch.refreshFailed === true;
  const stale = refreshFailed || earlierNight;
  const asOf = fetch.fetchedAt ? `as of ${formatTime(new Date(fetch.fetchedAt))}` : null;
  const freshness = refreshFailed
    ? `Couldn't refresh${asOf ? ` · ${asOf}` : ""}`
    : asOf
      ? asOf[0].toUpperCase() + asOf.slice(1)
      : null;

  const revenueKnown = data.revenueToday != null;

  const revenue: PulseRevenueView = revenueKnown
    ? {
        status: "known",
        amount: data.revenueToday as number,
        checksLabel:
          data.checksToday != null
            ? `${data.checksToday} check${data.checksToday === 1 ? "" : "s"}`
            : "sales so far",
        deltaPct: data.deltaPct,
      }
    : {
        status: "unavailable",
        message: revenueMessage(data),
      };

  let decisionsLabel: string | null;
  if (data.pendingDecisions == null) {
    // F-542: the feed could not be read. Unknown is said as unknown — never
    // borrowed as "All clear", whatever revenue says.
    decisionsLabel = DECISIONS_UNREAD_LABEL;
  } else if (data.pendingDecisions > 0) {
    // Always true and always useful, independent of whether revenue loaded.
    decisionsLabel = `${data.pendingDecisions} decision${data.pendingDecisions === 1 ? "" : "s"} waiting`;
  } else if (revenueKnown && !stale) {
    // We only assert "All clear" when the full picture — revenue included —
    // is actually known, and current: a count that could not be refreshed
    // is not a reason to say nothing is waiting now.
    decisionsLabel = "All clear";
  } else {
    decisionsLabel = null;
  }

  return { heading, freshness, stale, revenue, decisionsLabel };
}

// ── Insights reads ───────────────────────────────────────────────────
// Kept beside the pulse view: Insights draws the pulse through it too.

/**
 * What Insights may say about one read (F-677, ADR 0020: "an error must
 * never render as emptiness"). Insights used to test only `isLoading` and
 * `data`, so a failed read fell through to "No active goals yet", "Below
 * reorder point: 0 wines" and "Sitting still: None".
 *
 * - `loading`: nothing to show yet.
 * - `failed`: the read failed and there is nothing saved to show — say so.
 * - `ready`: show `data`; it is a real answer, empty or not.
 */
export type ReadState = "loading" | "failed" | "ready";

export function readState(q: {
  isLoading: boolean;
  isError: boolean;
  data: unknown;
}): ReadState {
  if (q.data !== undefined) return "ready";
  if (q.isError) return "failed";
  return "loading";
}

/** The Insights wording for a failed read, in the owner's words. */
export const INSIGHTS_READ_FAILED = {
  conclusions: "Couldn't load what the numbers say just now. Try again in a minute.",
  goals: "Couldn't load your goals just now.",
  cellar: "Couldn't read the cellar just now, so these figures are not shown.",
} as const;
