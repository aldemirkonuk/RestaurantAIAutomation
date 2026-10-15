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
    }
  | {
      /**
       * Not this person's to see: the gateway serves sales to owners and
       * managers only and leaves the figures out for anyone else (ADR 0253,
       * answered 2026-10-01 round 2). Nothing is rendered for it — not a
       * figure, not a zero, and not the "Connect Toast" line, which would
       * tell a staff member something false about the house.
       */
      status: "withheld";
    };

/**
 * Sales left out of the response because the signed-in role does not see
 * money. The gateway leaves the key out (`mobile.service.ts`
 * `getTodayPulse`); `null` is a different fact (the sales could not be read).
 */
export function salesWithheld(data: TodayPulse): boolean {
  return !Object.prototype.hasOwnProperty.call(data, "revenueToday");
}

/**
 * Whether the Insights tab draws its "Sales tonight" card.
 *
 * With a pulse in hand, the gateway's answer decides (`salesWithheld`), even
 * against the role the phone remembers. Without one (still loading, or the
 * request failed) the phone falls back on the role `/auth/me` gave the
 * session: only an owner or a manager is drawn the card, so a staff member
 * whose request failed is not told to "Connect Toast", a line about the house
 * that is false for them. A role the phone does not know gets no card. This is
 * a display choice, never the gate: the gateway decides what is sent.
 */
export function drawSalesCard(
  data: TodayPulse | undefined,
  role: string | undefined,
): boolean {
  if (data) return !salesWithheld(data);
  return role === "owner" || role === "manager";
}

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

  const revenue: PulseRevenueView = salesWithheld(data)
    ? { status: "withheld" }
    : revenueKnown
      ? {
          status: "known",
          amount: data.revenueToday as number,
          checksLabel: data.checksToday != null ? `${data.checksToday} checks` : "sales so far",
          deltaPct: data.deltaPct ?? null,
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
