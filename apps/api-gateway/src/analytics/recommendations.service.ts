import { Injectable, Logger, Optional } from "@nestjs/common";
import * as crypto from "crypto";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { GoalsService } from "./goals.service";
import { DatabaseService } from "../database/database.service";
import {
  RecommendationActionsService,
  RecommendationStatus,
} from "./recommendation-actions.service";
import {
  FiringPeriod,
  SuppressionScope,
  buildSuppressionKey,
  effectiveScope,
  suppressionKeys,
  withFiring,
} from "./insights/suppression";
import {
  MarginAdviceService,
  type HouseAdvice,
} from "../pricing/margin-advice.service";
import type { PriceAdvice } from "../pricing/margin-to-target";
import { PriceLocksService, type LockReadout } from "../pricing/price-locks.service";
import { resolveItemState, stateBookFrom } from "./insights/item-state";

/**
 * A rule's own firing period, from the horizon the rule itself declares
 * (ADR 0191 round 3 — the founder, 2026-09-21: "Each firing is one card",
 * keyed by the rule's own firing period, "e.g. its week"). A rule that says
 * `now` speaks about today, `this_week` about this week, `this_month` about
 * this month; its card, when it names no subject and no period, is that
 * firing — dismissed or done, it returns when the rule fires in its next
 * period. The mapping is the build's reading of "the rule's own period" and
 * is put to the founder in the ADR.
 */
export function firingPeriodOf(urgency: Recommendation["urgency"]): FiringPeriod {
  if (urgency === "now") return "day";
  if (urgency === "this_month") return "month";
  return "week";
}

export interface Recommendation {
  /** The observed number, restated ("Tuesday sales 12% below average Tuesdays"). */
  observation: string;
  /** What to actually do about it. */
  recommendation: string;
  /** Why this action follows from that number. */
  rationale: string;
  category: string;
  urgency: "now" | "this_week" | "this_month";
  /** Rule that fired — auditable, deterministic. */
  ruleKey: string;
  score: number;
  /** What the observation is ABOUT ("Wednesday"), when the rule names one. */
  subject?: string | null;
  /** The period it covers at its own grain ("d:2026-09-02"), when it has one. */
  periodKey?: string | null;
  /**
   * How to silence this entry, and how wide that silence really is.
   *
   * `key` is what a dismissal writes by default (the exact finding). `scope`
   * is what that key ACTUALLY silences — "rule" when the rule names no subject
   * and no period, which the page is required to say out loud rather than let
   * the manager believe they closed one line. `keys` carries all three scopes
   * so the dismissal sheet can offer them without re-deriving a key client-side.
   */
  suppression?: {
    key: string;
    scope: SuppressionScope;
    keys: Record<SuppressionScope, string>;
  };
  /** When this rule was FIRST shown, from `recommendation_impressions`. */
  firstSeenAt?: string | null;
  // ---- Manager disposition (merged from recommendation_actions) ----------
  status?: RecommendationStatus;
  pinned?: boolean;
  acted?: boolean;
  reason?: string | null;
  snoozeUntil?: string | null;
  feedback?: "helpful" | "not_helpful" | null;
  assignedTo?: string | null;
  assignedName?: string | null;
  /**
   * The per-wine numbers behind a price-advice entry (ADR 0193), so the
   * sentence is auditable and a page can offer the one-tap accept. Present
   * only on `margin_to_target`.
   */
  priceAdvice?: Array<{
    inventoryId: string;
    wineName: string | null;
    kind: PriceAdvice["kind"];
    state: PriceAdvice["state"];
    price: number | null;
    advisedPrice: number | null;
    currentMarginPct: number | null;
    targetPct: number | null;
    /** Today's price against the advised one, PERCENT of the advised price. */
    gapPct: number | null;
  }>;
}

/**
 * RecommendationsService — the translation layer from numbers to actions.
 *
 * "12% lower than average Tuesdays" is a fact; "run a by-the-glass feature
 * and brief the floor on upsells tonight" is what a manager can DO. This
 * service is a deterministic RULE ENGINE: each rule pattern-matches on the
 * computed metrics / insight feed and emits an action with its rationale.
 * No LLM — every recommendation is auditable back to a rule + a number.
 * (The consultant layer remains the optional LLM tier above this.)
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly advanced: AdvancedAnalyticsService,
    private readonly insightGenerator: InsightGeneratorService,
    private readonly goalsService: GoalsService,
    private readonly actions: RecommendationActionsService,
    private readonly dbService: DatabaseService,
    // ADR 0193. Optional only so the existing unit specs can construct this
    // service without it; Nest always injects it (AnalyticsModule imports
    // PricingModule). When it is absent the response says price advice was
    // not computed (`priceAdviceReadable: false`) rather than going quiet.
    @Optional()
    private readonly marginAdvice?: MarginAdviceService,
    // ADR 0193 round 3: the house's price locks, for `price_locks_to_review`.
    // Optional for the same reason; absent, the source is named as unread.
    @Optional()
    private readonly priceLocks?: PriceLocksService,
  ) {}

  async getRecommendations(
    restaurantId: string,
    opts: {
      includeHidden?: boolean;
      surface?: string;
      /**
       * False for a read that is not a showing. The recommendations digest
       * composes the feed before it knows whether any mail will go out (two
       * gateway instances may both compose; one sends), so it records what it
       * actually mailed on its own send row (`recommendation_digest_sends.
       * rule_keys`) instead of logging an impression for every compose.
       */
      recordImpressions?: boolean;
       * The person looking (from the JWT). Their own snoozes (ADR 0191 round
       * 3) are withheld from them alone; with no viewer — the digest — the
       * answer is the house's.
       */
      viewerId?: string | null;
    } = {},
  ): Promise<{
    recommendations: Recommendation[];
    rulesEvaluated: number;
    generatedAt: string;
    stateCounts: Record<"active" | "snoozed" | "dismissed" | "done", number>;
    suppressed: number;
    suppressionsReadable: boolean;
    priceAdviceReadable: boolean;
    priceAdviceReason: string | null;
    /** Engine sources that rejected on this read, by name. Empty = all answered. */
    sourcesUnread: string[];
    /** Standing cards withheld because this viewer snoozed them for themselves. */
    hiddenForYou: number;
    /**
     * False when this viewer's own snoozes could not be read (or there is no
     * viewer): cards they snoozed for themselves may be showing.
     */
    personalSnoozesReadable: boolean;
  }> {
    const [
      financial,
      risk,
      invSci,
      menu,
      seasonality,
      cashflow,
      insightsRes,
      goals,
      priceAdviceRes,
      priceLocksRes,
    ] = await Promise.allSettled([
      this.analyticsService.getFinancialSummary(restaurantId),
      this.analyticsService.getRiskProfile(restaurantId),
      this.analyticsService.getInventoryScience(restaurantId),
      this.advanced.getMenuEngineering(restaurantId),
      this.advanced.getSeasonality(restaurantId),
      this.advanced.getCashflow(restaurantId),
      this.insightGenerator.generate(restaurantId, { maxPerCategory: 4 }),
      this.goalsService.listGoals(restaurantId, "active"),
      this.marginAdvice
        ? this.marginAdvice.adviseHouse(restaurantId)
        : Promise.reject(new Error("price advice is not wired into this build")),
      // A lock list that could not be read answers readable: false (L25); it
      // is turned into a rejection here so the feed names it as unread.
      this.priceLocks
        ? this.priceLocks.list(restaurantId).then((r) => {
            if (!r.readable) throw new Error(r.reason ?? "the price locks could not be read");
            return r;
          })
        : Promise.reject(new Error("price locks are not wired into this build")),
    ]);
    const ok = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value : null;
    // Which sources did not answer. `ok()` turns a rejected source into `null`,
    // and a rule over `null` does not fire — so without this list "nothing
    // fired" and "nothing could be read" are the same result. The digest
    // sender (analytics/digest) says which it was; the page may too.
    const sourcesUnread = (
      [
        ["financial summary", financial],
        ["risk profile", risk],
        ["inventory science", invSci],
        ["menu engineering", menu],
        ["seasonality", seasonality],
        ["cashflow", cashflow],
        ["insights", insightsRes],
        ["goals", goals],
        // ADR 0193: price advice is a source like the others; the digest's
        // "could not read" note names it when it rejected.
        ["price advice", priceAdviceRes],
        // ADR 0193 round 3: the price locks, likewise.
        ["price locks", priceLocksRes],
      ] as Array<[string, PromiseSettledResult<unknown>]>
    )
      .filter(([, r]) => r.status === "rejected")
      .map(([name]) => name);

    const ctx = {
      financial: ok(financial),
      risk: ok(risk),
      invSci: ok(invSci),
      menu: ok(menu),
      seasonality: ok(seasonality),
      cashflow: ok(cashflow),
      insights: ok(insightsRes)?.insights ?? [],
      goals: ok(goals) ?? [],
      priceAdvice: ok(priceAdviceRes) as HouseAdvice | null,
      priceLocks: ok(priceLocksRes) as LockReadout | null,
    };
    const priceAdviceReason =
      priceAdviceRes.status === "rejected"
        ? String(
            (priceAdviceRes.reason as { message?: string } | undefined)?.message ??
              priceAdviceRes.reason,
          )
        : null;

    const recs: Recommendation[] = [];
    let rulesEvaluated = 0;
    const rule = (
      key: string,
      fired: boolean | null | undefined,
      make: () => Omit<Recommendation, "ruleKey">,
    ) => {
      rulesEvaluated++;
      if (fired) recs.push({ ...make(), ruleKey: key });
    };

    const pct = (v: number) => `${Math.abs(v * 100).toFixed(0)}%`;

    // ---- Sales / demand rules --------------------------------------------
    const salesBaseline = ctx.insights.find(
      (i: any) =>
        i.candidateKey?.includes("vs_same_weekday") &&
        (i.effectPct ?? 0) < -0.08,
    );
    rule("sales_below_weekday_baseline", !!salesBaseline, () => ({
      observation: salesBaseline!.sentence,
      recommendation:
        "Tonight: brief the floor on top-margin picks, run one by-the-glass feature, and pair your strongest server with the weakest section. A soft day is a staffing-and-suggestion problem before it's a demand problem.",
      rationale:
        "Same-weekday baselines remove day-of-week mix, so the gap is execution or traffic — the levers you control same-day are selling behavior and features.",
      category: "sales",
      urgency: "now",
      score: 3,
      // Carried from the insight this rule restates, so a dismissal can be
      // scoped to THIS Wednesday, to every Wednesday, or to the rule — see
      // insights/suppression.ts. Without them the only scope representable is
      // "this rule, for ever", which is what dismiss silently meant before.
      subject: salesBaseline!.subject ?? null,
      periodKey: salesBaseline!.periodKey ?? null,
    }));

    const demandDown = ctx.insights.find(
      (i: any) =>
        i.candidateKey?.includes("vs_prev_period_7d") &&
        i.category === "sales" &&
        (i.effectPct ?? 0) < -0.1,
    );
    rule("weekly_demand_slide", !!demandDown, () => ({
      observation: demandDown!.sentence,
      recommendation:
        "Schedule a staff tasting on the two highest-margin slow movers this week and add a pairing prompt to the specials script — attach rate is the fastest week-scale lever.",
      rationale:
        "A week-over-week slide with stable inventory usually reflects selling energy, not assortment; tastings measurably lift server advocacy.",
      category: "sales",
      urgency: "this_week",
      score: 2.5,
      subject: demandDown!.subject ?? null,
      periodKey: demandDown!.periodKey ?? null,
    }));

    // ---- Inventory rules --------------------------------------------------
    const reorderTop = ctx.invSci?.reorderList?.[0];
    rule(
      "stockout_imminent",
      (reorderTop?.stockoutProbability ?? 0) > 0.4,
      () => ({
        observation: `${reorderTop.name} has a ${pct(reorderTop.stockoutProbability)} chance of stocking out before a 7-day replenishment (on hand: ${reorderTop.onHand}).`,
        recommendation: `Place the order today — reorder point is ${Math.ceil(reorderTop.reorderPoint ?? 0)} bottles. If the vendor is slow, split the order across two vendors.`,
        rationale:
          "Stockout probability is computed from this wine's own demand variance; above 40%, waiting for the weekly order cycle usually means an empty slot on the list.",
        category: "inventory",
        urgency: "now",
        score: 3,
      }),
    );

    rule(
      "dead_stock_capital",
      (ctx.financial?.deadStockCapital ?? 0) > 0 &&
        (ctx.financial?.deadStockTop?.length ?? 0) > 0,
      () => ({
        // The number behind this sentence is now a consumption join, not a
        // stock-depth test — see AnalyticsService.getFinancialSummary. Naming
        // the window keeps the claim checkable, and keeps the discount advice
        // below pointed at bottles that genuinely are not selling.
        observation: `$${Math.round(ctx.financial.deadStockCapital).toLocaleString()} is locked in inventory that has not moved in 90 days (top: ${ctx.financial.deadStockTop[0].name}).`,
        recommendation:
          "Build a weekend flight or staff-pick feature from the top three idle wines; if untouched after two weeks, discount to cost and reinvest the cash in A-class movers.",
        rationale:
          "Idle bottles pay storage and tie up cash with zero margin velocity — GMROI rises fastest by converting them back to working capital.",
        category: "inventory",
        urgency: "this_month",
        score: 2,
      }),
    );

    // ---- Menu engineering rules ------------------------------------------
    const plowhorses = ctx.menu?.items?.filter(
      (i: any) => i.quadrant === "plowhorse",
    );
    rule("plowhorse_repricing", (plowhorses?.length ?? 0) >= 2, () => ({
      observation: `${plowhorses.length} wines sell fast but earn below-median margin (top: ${plowhorses[0].name}).`,
      recommendation:
        "Raise those prices 5–8% or renegotiate cost on the next PO — volume holds on small moves for high-velocity wines.",
      rationale:
        "Menu-engineering plowhorses are proven demand with underpriced margin; small price moves on high-velocity items compound faster than any new listing.",
      category: "efficiency",
      urgency: "this_week",
      score: 2.5,
    }));

    const puzzles = ctx.menu?.items?.filter(
      (i: any) => i.quadrant === "puzzle",
    );
    rule("puzzle_activation", (puzzles?.length ?? 0) >= 2, () => ({
      observation: `${puzzles.length} high-margin wines barely move (top: ${puzzles[0].name}).`,
      recommendation:
        "Put one puzzle wine by-the-glass this week with a one-line story on the menu; rotate weekly and keep whichever converts.",
      rationale:
        "Puzzles already carry the margin — they only need visibility; BTG placement is the cheapest demand test you have.",
      category: "efficiency",
      urgency: "this_week",
      score: 2,
    }));

    // ---- Price toward the house's target margin (ADR 0193) ----------------
    // THE FOUNDER, 2026-09-21: "... advise the manager or owner to increase
    // decrease the prices so that the profit margin is where it's needed. We
    // don't want market average because that will be already shown in another
    // column." The numbers come from MarginAdviceService: price = cost / (1 -
    // target), the house's own cost and target, never the market average, and
    // nothing changes until a manager accepts a line on /inventory.
    const pa = ctx.priceAdvice;
    const pricedWines =
      pa?.wines.filter(
        (w) => (w.bottle?.price ?? null) !== null || (w.glass?.price ?? null) !== null,
      ) ?? [];
    rule(
      "margin_target_unset",
      !!pa && !pa.target.set && pricedWines.length > 0,
      () => ({
        observation: `No target margin is set, so none of this house's ${pricedWines.length} priced wine${pricedWines.length === 1 ? "" : "s"} can be judged against one.`,
        recommendation:
          "Set the margin you need on a bottle and on a glass, and how close is close enough as a percent of the advised price (Settings, Target margin). Each wine then gets an exact raise-to or lower-to price, applied only when you accept it.",
        rationale:
          "Advice toward a margin nobody chose would be a default dressed as a decision. The target is the house's own number, so until it is set there is no advice.",
        category: "pricing",
        urgency: "this_month",
        score: 1.6,
      }),
    );

    // A LOCKED kind is left out of the actions (ADR 0193 round 3, L22): it
    // cannot be accepted. Its advice is not hidden -- it is counted under
    // price_locks_to_review below, where the lock can be looked at.
    const adviceLines = (pa?.wines ?? []).flatMap((w) =>
      [w.bottle, w.glass]
        .filter(
          (a): a is NonNullable<typeof w.bottle> =>
            !!a && (a.state === "raise" || a.state === "lower") && !a.locked,
        )
        .map((a) => ({ w, a: a as PriceAdvice })),
    );
    // Furthest from its advised price first, in percent: that is the line
    // worth the manager's tap, in the unit the house's "close enough" uses.
    adviceLines.sort(
      (x, y) => Math.abs(y.a.gapPct ?? 0) - Math.abs(x.a.gapPct ?? 0),
    );
    const blind = (pa?.counts.no_cost ?? 0) + (pa?.counts.no_price ?? 0);
    rule("margin_to_target", !!pa && pa.target.set && adviceLines.length > 0, () => {
      const raises = adviceLines.filter((l) => l.a.state === "raise").length;
      const lowers = adviceLines.length - raises;
      const lockNote =
        pa!.locks && !pa!.locks.readable
          ? ` ${pa!.locks.reason ?? "Whether any of these prices is locked could not be read."}`
          : "";
      return {
        observation: `${adviceLines.length} ${adviceLines.length === 1 ? "price sits" : "prices sit"} outside your target margin: ${raises} below it, ${lowers} above it.${blind > 0 ? ` ${blind} more cannot be judged (no recorded cost or no price).` : ""}${lockNote}`,
        recommendation:
          adviceLines
            .slice(0, 3)
            .map((l) => `${l.w.wineName ?? "A wine"}: ${l.a.sentence}`)
            .join(" ") +
          " Accept each on Inventory, under Your price. Nothing changes until you do.",
        rationale:
          "Price = cost / (1 - target) is the price that exactly earns the margin you set, from this house's recorded cost and its own target, never the market average.",
        category: "pricing",
        urgency: "this_week",
        score: 2.4,
        priceAdvice: adviceLines.map(({ w, a }) => ({
          inventoryId: w.inventoryId,
          wineName: w.wineName,
          kind: a.kind,
          state: a.state,
          price: a.price,
          advisedPrice: a.advisedPrice,
          currentMarginPct: a.currentMarginPct,
          targetPct: a.targetPct,
          gapPct: a.gapPct,
        })),
      };
    });
    // The glass half waits for the house's pour (founder, 2026-09-21: glass
    // advice appears only after the house confirms its pour size, once). Said
    // as its own entry, so a quiet glass column is never read as on target.
    const pourWaiting = pa?.counts.pour_unconfirmed ?? 0;
    rule(
      "pour_size_unconfirmed",
      !!pa && pa.target.glassPct !== null && !pa.target.pourConfirmed && pourWaiting > 0,
      () => ({
        observation: `${pourWaiting} glass price${pourWaiting === 1 ? "" : "s"} cannot be advised yet: this house has not confirmed the pour it serves.`,
        recommendation:
          "Confirm your pour size once (Settings, Target margin). Glass advice starts from then; bottle advice does not wait for it.",
        rationale:
          "A glass's cost is the bottle's cost times pour over bottle. Until the house states its pour, the only number on record is the database's 150 ml default, which nobody chose.",
        category: "pricing",
        urgency: "this_month",
        score: 1.3,
      }),
    );
    // ADR 0193 round 3 (L22, L23): locked prices worth a look. A lock never
    // ends by itself; this entry is how one that no longer fits is noticed.
    const pl = ctx.priceLocks;
    // Last-call review, 2026-09-21: a lock list read in part (the menu, the
    // wines or the advice behind the facts could not be read) is SAID, never
    // taken for "nothing to review" (L25; absence is not health).
    const partlyRead = !!pl && pl.readable && !pl.markersReadable && pl.counts.open > 0;
    rule("price_locks_to_review", !!pl && pl.readable && (pl.counts.toReview > 0 || partlyRead), () => {
      const has = (m: string) => pl!.locks.filter((l) => l.markers.includes(m as never)).length;
      const parts = [
        has("off_target") > 0 ? `${has("off_target")} outside your target margin` : null,
        has("not_on_current_menu") + has("no_current_menu") > 0
          ? `${has("not_on_current_menu") + has("no_current_menu")} not on the current menu`
          : null,
        has("wine_removed") > 0 ? `${has("wine_removed")} on a wine removed from inventory` : null,
        has("author_without_access") > 0
          ? `${has("author_without_access")} set by someone who no longer manages this house`
          : null,
      ].filter((x): x is string => !!x);
      const n = pl!.counts.toReview;
      const open = pl!.counts.open;
      const lead =
        n > 0
          ? `${n} locked price${n === 1 ? "" : "s"} at this house need${n === 1 ? "s" : ""} a look: ${parts.join(", ")}.`
          : `${open} locked price${open === 1 ? "" : "s"} at this house could not be fully checked.`;
      const unread = partlyRead ? ` ${pl!.markersReason ?? "Some facts about these locks could not be read."}` : "";
      return {
        observation: `${lead}${unread}`,
        recommendation:
          "Look at them on Menu, under Locked prices: keep, change and keep locked, move to the right wine, or release. A lock never ends by itself.",
        rationale:
          "A lock holds a price against every menu, correction and accepted advice until a person ends it, so the only way a lock that no longer fits is noticed is to say so.",
        category: "pricing",
        urgency: "this_month",
        score: 1.4,
      };
    });

    rule(
      "margin_advice_blind",
      !!pa && pa.target.set && (pa.counts.no_cost ?? 0) > 0,
      () => ({
        observation: `${pa!.counts.no_cost} price${pa!.counts.no_cost === 1 ? "" : "s"} cannot be judged against your target margin: this house has no recorded cost for ${pa!.counts.no_cost === 1 ? "that wine" : "those wines"}.`,
        recommendation:
          "Receive the next delivery against its invoice (or record what you paid) so each wine carries a cost. Until then those wines get no price advice, and no margin is claimed for them.",
        rationale:
          "A margin needs a cost. An unknown cost is reported as unknown, never as a healthy margin (ADR 0051).",
        category: "pricing",
        urgency: "this_month",
        score: 1.2,
      }),
    );

    // ---- Risk rules -------------------------------------------------------
    const hhi = ctx.risk?.vendorConcentration?.hhi;
    rule("vendor_concentration", (hhi ?? 0) > 0.4, () => ({
      observation: `Purchasing is highly concentrated (HHI ${(hhi * 10000).toFixed(0)} — effectively ${ctx.risk.vendorConcentration.effectiveVendors?.toFixed(1)} vendors).`,
      recommendation:
        "Request quotes from one alternative vendor for your top category this month and move 10–20% of volume to establish the relationship before you need it.",
      rationale:
        "A single-vendor book means one delivery failure cascades into stockouts; a warm second source is cheap insurance priced in minutes of email.",
      category: "risk",
      urgency: "this_month",
      score: 2,
    }));

    const gini = ctx.risk?.revenueConcentration?.gini;
    rule("revenue_concentration", (gini ?? 0) > 0.6, () => ({
      observation: `Revenue rides on very few wines (Gini ${gini.toFixed(2)}).`,
      recommendation:
        "Protect the top sellers' stock first (raise their service level to 98%), then use pairing prompts to spread demand to adjacent wines.",
      rationale:
        "Concentrated revenue makes one stockout a P&L event — buffer the heroes and diversify demand, in that order.",
      category: "risk",
      urgency: "this_month",
      score: 1.8,
    }));

    // ---- Seasonality rules ------------------------------------------------
    const worstDay = ctx.seasonality?.worstDay;
    const bestDay = ctx.seasonality?.bestDay;
    rule(
      "weekday_gap",
      !!worstDay && !!bestDay && worstDay !== bestDay,
      () => ({
        observation: `${bestDay} is reliably your strongest day; ${worstDay} the weakest.`,
        recommendation: `Move staff training, deliveries, and inventory counts to ${worstDay}; test a ${worstDay}-only offer (corkage-free, flight special) rather than discounting strong days.`,
        rationale:
          "Weekday seasonality is structural — schedule costs into the trough and promotions where marginal demand is elastic, never where the room fills itself.",
        category: "sales",
        urgency: "this_week",
        score: 1.5,
      }),
    );

    // ---- Cashflow rules ---------------------------------------------------
    rule(
      "spend_acceleration",
      (ctx.cashflow?.paceDeltaPct ?? 0) > 0.3 &&
        (ctx.cashflow?.spendLast30d ?? 0) > 0,
      () => ({
        observation: `Purchasing spend is up ${pct(ctx.cashflow.paceDeltaPct)} vs the prior 30 days ($${Math.round(ctx.cashflow.spendLast30d).toLocaleString()}).`,
        recommendation:
          "Audit open orders against days-of-cover before the next PO run; push slow-mover orders a cycle and consolidate to hit vendor volume breaks.",
        rationale:
          "Spend accelerating faster than demand converts cash into shelf risk — days-of-cover is the arbiter of which orders can wait.",
        category: "purchasing",
        urgency: "this_week",
        score: 2,
      }),
    );

    // ---- Staff rules (fire only with POS check data) ----------------------
    const staffInsight = ctx.insights.find(
      (i: any) => i.category === "staff" && (i.effectPct ?? 0) > 0.15,
    );
    rule("staff_spread", !!staffInsight, () => ({
      observation: staffInsight!.sentence,
      recommendation:
        "Have the top seller run a 15-minute pre-shift on their pitch, and mirror their table-visit timing with one underperformer this week.",
      rationale:
        "A wide per-server spread on the same menu is trainable technique, not luck — peer shadowing closes it faster than incentives.",
      category: "staff",
      urgency: "this_week",
      score: 2,
    }));

    const basketInsight = ctx.insights.find(
      (i: any) => i.category === "basket",
    );
    rule("pairing_promotion", !!basketInsight, () => ({
      observation: basketInsight!.sentence,
      recommendation:
        "Print that pairing on the menu insert and add it to the server script — proven co-purchase is the cheapest upsell you own.",
      rationale:
        "A lift well above 1 means guests already believe in the combination; promotion just removes the discovery step.",
      category: "basket",
      urgency: "this_week",
      score: 1.8,
    }));

    // ---- Goal rules -------------------------------------------------------
    for (const g of ctx.goals.slice(0, 3)) {
      const target = Number(g.target_value) || 0;
      const current = Number(g.current_value) || 0;
      const behind =
        g.deadline &&
        target > 0 &&
        current / target <
          Math.max(
            0,
            1 -
              Math.max(
                0,
                (new Date(g.deadline).getTime() - Date.now()) / 86400000,
              ) /
                Math.max(
                  1,
                  (new Date(g.deadline).getTime() -
                    new Date(g.created_at).getTime()) /
                    86400000,
                ),
          ) *
            0.9;
      rule(`goal_behind_${g.id}`, !!behind, () => ({
        observation: `Goal "${g.name}" is behind its linear pace (${Math.round((current / target) * 100)}% done).`,
        recommendation:
          "Pick the single biggest lever from the insight feed for this goal's category and commit to it for 7 days before adding anything else.",
        rationale:
          "Behind-pace goals fail from diffusion; one measured lever per week beats five untracked ones.",
        category: "goals",
        urgency: "this_week",
        score: 2.2,
      }));
    }

    // ---- Merge stored manager disposition (dismiss/snooze/done/pin) --------
    const dispositions = await this.actions.readDispositions(restaurantId);
    const stateMap = dispositions.map;
    // The ONE shared per-item state (ADR 0191, founder 2026-09-21: "Build it
    // right, in order"): dismissed, done and in-force snoozes at every scope
    // their keys were written — the same `resolveItemState` the insight
    // generator applies for Reports, the rails and the catalogue. Before it,
    // this feed honoured a scoped dismissal but read snooze and done off the
    // bare rule key alone, so "snooze this Wednesday" either did nothing or
    // silenced every Wednesday, depending on which key was written.
    const book = stateBookFrom(stateMap.values());

    // "Each firing is one card" (ADR 0191 round 3, founder 2026-09-21): a
    // rule that names no subject and no period is keyed by the period it
    // fired in, so a one-card dismiss or done hides this firing and the card
    // returns when the rule fires in its next period. Before, its only key
    // was the bare rule — a whole-rule act staff could not make at all.
    const firedAt = new Date();
    for (const r of recs) {
      const keyed = withFiring(
        {
          ruleId: r.ruleKey,
          subject: r.subject ?? null,
          periodKey: r.periodKey ?? null,
        },
        firingPeriodOf(r.urgency),
        firedAt,
      );
      r.periodKey = keyed.periodKey ?? null;
    }

    // Every entry carries its own suppression keys, computed here because this
    // is the only place that knows what each rule is about. Attaching them
    // before the filter matters: the filter below uses the same target the UI
    // will dismiss with, so what the page silences is exactly what the engine
    // then withholds — one definition, both ends.
    for (const r of recs) {
      const target = {
        ruleId: r.ruleKey,
        subject: r.subject ?? null,
        periodKey: r.periodKey ?? null,
      };
      r.suppression = {
        key: buildSuppressionKey(target, "insight"),
        scope: effectiveScope(target, "insight"),
        keys: suppressionKeys(target),
      };
    }

    // The keys that decided a firing entry's state, so the count below does
    // not count the same fact twice.
    const decidingKeys = new Set<string>();
    for (const r of recs) {
      // Notes about the card — pin, acted, feedback, assignee — live on the
      // rule's own row, as before.
      const own = stateMap.get(r.ruleKey);
      if (own) {
        r.pinned = own.pinned;
        r.acted = !!own.actedAt;
        r.feedback = own.feedback;
        r.assignedTo = own.assignedTo;
        r.assignedName = own.assignedName;
      }
      // Its STATE is the shared one, at whatever scope decided it.
      const st = resolveItemState(
        {
          ruleId: r.ruleKey,
          subject: r.subject ?? null,
          periodKey: r.periodKey ?? null,
        },
        book,
      );
      r.status = st.state;
      r.reason = st.reason;
      r.snoozeUntil = st.snoozeUntil;
      if (st.key) decidingKeys.add(st.key);
    }

    const suppressedCount = recs.filter((r) => r.status === "dismissed").length;

    // Counts are computed BEFORE filtering so the status tabs stay accurate
    // even for rows that no longer fire (they live only in the actions table,
    // so count those too). A firing entry counts once, by its resolved state;
    // a row counts on its own only when it is not that entry's row and did
    // not decide a firing entry's state.
    const firingKeys = new Set(recs.map((r) => r.ruleKey));
    const stateCounts = { active: 0, snoozed: 0, dismissed: 0, done: 0 };
    for (const r of recs) stateCounts[r.status ?? "active"]++;
    for (const [key, s] of stateMap) {
      if (firingKeys.has(key) || decidingKeys.has(key)) continue;
      if (s.status === "dismissed") stateCounts.dismissed++;
      else if (s.status === "done") stateCounts.done++;
      else if (s.status === "snoozed") stateCounts.snoozed++;
    }

    const houseVisible = opts.includeHidden
      ? recs
      : recs.filter((r) => (r.status ?? "active") === "active");

    // The person's own snoozes (round 3, answer 4 — "Only them"): withheld
    // from the viewer alone, after the house state, and never counted in the
    // house's `stateCounts`. `includeHidden` shows them like any hidden card.
    const mine = opts.viewerId
      ? await this.actions.viewFor(
          restaurantId,
          opts.viewerId,
          houseVisible,
          (r) => ({
            ruleId: r.ruleKey,
            subject: r.subject ?? null,
            periodKey: r.periodKey ?? null,
          }),
        )
      : {
          kept: houseVisible,
          hiddenForYou: 0,
          personalSnoozesReadable: false,
        };
    const visible = opts.includeHidden ? houseVisible : mine.kept;

    // Pinned float to the top; then by score.
    visible.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.score - a.score;
    });

    // N2 (BEVERAGE_CATALOGUE_PLAN.md): log what was actually SHOWN, not just
    // what gets acted on later. recommendation_actions only records the
    // manager's disposition — with no impressions log, "shown at position 3,
    // ignored every time" is invisible, and a future learned recommender
    // would train on conversions alone and reinforce its own priors (arch
    // §10.6 M1). Fire-and-forget: telemetry must never slow or fail this
    // response, same posture as the low-stock alert dispatch in pos-hub.
    // "How long has this stood" was an em dash on every untouched entry,
    // because the feed carried no first-fired timestamp — while the answer had
    // been accumulating in `recommendation_impressions` since 2026-08-17. This
    // reads it BEFORE logging tonight's impression, so an entry's first sighting
    // is the first time it was ever shown, not this request.
    await this.attachFirstSeen(restaurantId, visible);

    if (opts.recordImpressions !== false) {
      void this.logImpressions(restaurantId, visible, opts.surface).catch(
        () => undefined,
      );
    }

    return {
      recommendations: visible,
      rulesEvaluated,
      generatedAt: new Date().toISOString(),
      stateCounts,
      // How many rules fired and were then withheld because they had been
      // dismissed, and whether the dismissal store was readable at all.
      // `suppressionsReadable: false` means this list may contain things the
      // manager already dismissed — the page has to say so rather than present
      // it as clean (ADR 0020).
      suppressed: suppressedCount,
      suppressionsReadable: dispositions.readable,
      // ADR 0193: whether the price advice behind the pricing entries could be
      // computed at all. `false` means those entries are MISSING, not that
      // every price is on target, and the reason says why.
      priceAdviceReadable: priceAdviceRes.status === "fulfilled",
      priceAdviceReason,
      sourcesUnread,
      hiddenForYou: mine.hiddenForYou,
      personalSnoozesReadable: mine.personalSnoozesReadable,
    };
  }

  /**
   * First impression per rule key, from `recommendation_impressions`.
   *
   * One indexed query per visible key rather than one wide scan: the table's
   * `(restaurant_id, rule_key, shown_at desc)` index answers each in a single
   * seek, and a `min()` aggregate is not available — PostgREST on this project
   * answers `select=rule_key,created_at.min()` with PGRST123, "Use of aggregate
   * functions is not allowed" (measured 2026-09-03). `shown_at` is the column
   * used because it is the indexed one; it and `created_at` are written by the
   * same insert and default to the same `now()`.
   *
   * A key with no impressions, or a failed read, leaves `firstSeenAt` null —
   * which the page renders as an em dash. An unknown is never a date.
   */
  private async attachFirstSeen(
    restaurantId: string,
    visible: Recommendation[],
  ): Promise<void> {
    if (visible.length === 0) return;
    const keys = Array.from(new Set(visible.map((r) => r.ruleKey))).slice(0, 40);
    const found = new Map<string, string>();
    await Promise.all(
      keys.map(async (key) => {
        try {
          const { data, error } = await this.dbService.supabase
            .from("recommendation_impressions")
            .select("shown_at")
            .eq("restaurant_id", restaurantId)
            .eq("rule_key", key)
            .order("shown_at", { ascending: true })
            .limit(1);
          if (error) throw new Error(error.message);
          const first = (data || [])[0]?.shown_at;
          if (first) found.set(key, first);
        } catch (err: any) {
          this.logger.warn(`firstSeenAt for ${key} failed: ${err?.message}`);
        }
      }),
    );
    for (const r of visible) r.firstSeenAt = found.get(r.ruleKey) ?? null;
  }

  private async logImpressions(
    restaurantId: string,
    visible: Recommendation[],
    surface?: string,
  ): Promise<void> {
    if (!visible.length) return;
    const requestId = crypto.randomUUID();
    const rows = visible.map((r, i) => ({
      restaurant_id: restaurantId,
      rule_key: r.ruleKey,
      category: r.category,
      urgency: r.urgency,
      score: r.score,
      position: i + 1,
      pinned: !!r.pinned,
      surface: surface || "recommendations_page",
      request_id: requestId,
    }));
    const { error } = await this.dbService.supabase
      .from("recommendation_impressions")
      .insert(rows);
    if (error) {
      this.logger.warn(`Impression logging failed: ${error.message}`);
    }
  }
}
