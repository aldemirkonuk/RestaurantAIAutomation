import { Injectable, Logger } from "@nestjs/common";
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
  // ---- Manager disposition (merged from recommendation_actions) ----------
  status?: RecommendationStatus;
  pinned?: boolean;
  acted?: boolean;
  reason?: string | null;
  snoozeUntil?: string | null;
  feedback?: "helpful" | "not_helpful" | null;
  assignedTo?: string | null;
  assignedName?: string | null;
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
  ) {}

  async getRecommendations(
    restaurantId: string,
    opts: { includeHidden?: boolean; surface?: string } = {},
  ): Promise<{
    recommendations: Recommendation[];
    rulesEvaluated: number;
    generatedAt: string;
    stateCounts: Record<"active" | "snoozed" | "dismissed" | "done", number>;
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
    ] = await Promise.allSettled([
      this.analyticsService.getFinancialSummary(restaurantId),
      this.analyticsService.getRiskProfile(restaurantId),
      this.analyticsService.getInventoryScience(restaurantId),
      this.advanced.getMenuEngineering(restaurantId),
      this.advanced.getSeasonality(restaurantId),
      this.advanced.getCashflow(restaurantId),
      this.insightGenerator.generate(restaurantId, { maxPerCategory: 4 }),
      this.goalsService.listGoals(restaurantId, "active"),
    ]);
    const ok = (r: PromiseSettledResult<any>) =>
      r.status === "fulfilled" ? r.value : null;

    const ctx = {
      financial: ok(financial),
      risk: ok(risk),
      invSci: ok(invSci),
      menu: ok(menu),
      seasonality: ok(seasonality),
      cashflow: ok(cashflow),
      insights: ok(insightsRes)?.insights ?? [],
      goals: ok(goals) ?? [],
    };

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
        observation: `$${Math.round(ctx.financial.deadStockCapital).toLocaleString()} is locked in slow inventory (top: ${ctx.financial.deadStockTop[0].name}).`,
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
    const stateMap = await this.actions.getStateMap(restaurantId);
    for (const r of recs) {
      const s = stateMap.get(r.ruleKey);
      if (!s) continue;
      r.status = s.status;
      r.pinned = s.pinned;
      r.acted = !!s.actedAt;
      r.reason = s.reason;
      r.snoozeUntil = s.snoozeUntil;
      r.feedback = s.feedback;
      r.assignedTo = s.assignedTo;
      r.assignedName = s.assignedName;
    }

    // Counts are computed BEFORE filtering so the status tabs stay accurate
    // even for dismissed/done cards that no longer fire (they live only in the
    // actions table, so count those too).
    const firingKeys = new Set(recs.map((r) => r.ruleKey));
    const stateCounts = { active: 0, snoozed: 0, dismissed: 0, done: 0 };
    for (const r of recs) {
      const st = (r.status ?? "active") as keyof typeof stateCounts;
      if (st in stateCounts) stateCounts[st]++;
    }
    for (const [key, s] of stateMap) {
      if (firingKeys.has(key)) continue; // already counted above
      if (s.status === "dismissed") stateCounts.dismissed++;
      else if (s.status === "done") stateCounts.done++;
      else if (s.status === "snoozed") stateCounts.snoozed++;
    }

    const visible = opts.includeHidden
      ? recs
      : recs.filter((r) => (r.status ?? "active") === "active");

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
    void this.logImpressions(restaurantId, visible, opts.surface).catch(
      () => undefined,
    );

    return {
      recommendations: visible,
      rulesEvaluated,
      generatedAt: new Date().toISOString(),
      stateCounts,
    };
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
