import type { TodayPulse } from "@/api/types";

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

export const REVENUE_UNAVAILABLE_MESSAGE =
  "Connect Toast on the web dashboard to see live sales here.";

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

export function resolvePulseStripView(data: TodayPulse): PulseStripView {
  const revenueKnown = data.revenueToday != null;

  const revenue: PulseRevenueView = revenueKnown
    ? {
        status: "known",
        amount: data.revenueToday as number,
        checksLabel: data.checksToday != null ? `${data.checksToday} checks` : "sales so far",
        deltaPct: data.deltaPct,
      }
    : {
        status: "unavailable",
        message: REVENUE_UNAVAILABLE_MESSAGE,
      };

  let decisionsLabel: string | null;
  if (data.pendingDecisions > 0) {
    // Always true and always useful, independent of whether revenue loaded.
    decisionsLabel = `${data.pendingDecisions} decision${data.pendingDecisions === 1 ? "" : "s"} waiting`;
  } else if (revenueKnown) {
    // We only assert "All clear" when the full picture — revenue included —
    // is actually known. This is the legitimate case for that copy.
    decisionsLabel = "All clear";
  } else {
    decisionsLabel = null;
  }

  return { revenue, decisionsLabel };
}
