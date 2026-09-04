import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { ORDER_SPEND_STATUSES } from "../procurement/order-status";
import { ModelClientService } from "../common/model-client/model-client.service";
import {
  catalogueForPrompt,
  checkCuttingSpec,
  type CuttingSpec,
  type SpecRejection,
} from "./report-cuttings";

/**
 * GoalsService — metric-linked goals with AI assistance.
 *
 * A goal = a measure key + target + deadline. Progress is computed from the
 * same data the analytics engine reads, pace is compared to the linear
 * schedule, the deadline outcome is projected with Holt's trend method, and
 * "what to do about it" is pulled from the stored insight feed (relevant
 * categories), so the assistance is grounded in this restaurant's own math.
 *
 * Supported metric keys (v1): wine_revenue, bottles_sold, purchase_spend,
 * checks, avg_check, wine_attach_rate.
 *
 * `pos_revenue` is computed by the same query but is deliberately NOT in
 * SUPPORTED_METRICS: it exists for `getPosRevenueWindow` (OD-85), and offering
 * it as a goal target is a separate product decision nobody has made.
 */
@Injectable()
export class GoalsService {
  private readonly logger = new Logger(GoalsService.name);

  constructor(
    private readonly dbService: DatabaseService,
    private readonly insightGenerator: InsightGeneratorService,
    // Both @Global providers (ModelClientModule, ConfigModule), so neither
    // needs an import line in AnalyticsModule — the same call DatabaseModule
    // already made. Only `proposeCuttingSpec` uses them.
    private readonly configService: ConfigService,
    private readonly modelClient: ModelClientService,
  ) {}

  static readonly SUPPORTED_METRICS: Record<
    string,
    {
      label: string;
      unit: "currency" | "units" | "count" | "percent";
      insightCategories: string[];
    }
  > = {
    wine_revenue: {
      label: "Wine revenue",
      unit: "currency",
      insightCategories: ["sales", "efficiency"],
    },
    bottles_sold: {
      label: "Bottles sold",
      unit: "units",
      insightCategories: ["sales", "basket"],
    },
    purchase_spend: {
      label: "Purchasing spend",
      unit: "currency",
      insightCategories: ["purchasing", "risk"],
    },
    checks: {
      label: "Checks served",
      unit: "count",
      insightCategories: ["sales", "tables"],
    },
    avg_check: {
      label: "Average check",
      unit: "currency",
      insightCategories: ["efficiency", "staff", "basket"],
    },
    wine_attach_rate: {
      label: "Wine attach rate",
      unit: "percent",
      insightCategories: ["efficiency", "basket", "staff"],
    },
  };

  // ==========================================================================
  // CRUD
  // ==========================================================================

  async listGoals(restaurantId: string, status = "active") {
    const q = this.dbService
      .getClient()
      .from("analytics_goals")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    const { data, error } =
      status === "all" ? await q : await q.eq("status", status);
    if (error) throw new Error(error.message);
    return data || [];
  }

  /**
   * The recommendation rules a goal may name as its source
   * (`analytics_goals.source_rule_key`, migration `20260903161000`).
   *
   * These are the `rule("…")` keys evaluated in `recommendations.service.ts`.
   * The list is duplicated here rather than imported because
   * `RecommendationsService` depends on this service — importing back would
   * close a cycle — and because the catalogue is the CONTRACT for a stored
   * string: a rule that is renamed must break this list loudly, not silently
   * orphan every goal that named the old key.
   *
   * `goal_behind_<uuid>` is generated per goal at read time, so it is matched
   * by shape rather than listed.
   */
  static readonly RECOMMENDATION_RULE_KEYS: readonly string[] = [
    "sales_below_weekday_baseline",
    "weekly_demand_slide",
    "stockout_imminent",
    "dead_stock_capital",
    "plowhorse_repricing",
    "puzzle_activation",
    "vendor_concentration",
    "revenue_concentration",
    "weekday_gap",
    "spend_acceleration",
    "staff_spread",
    "pairing_promotion",
  ];

  private static readonly GOAL_BEHIND_KEY =
    /^goal_behind_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

  /** True only for a key the engine actually evaluates. */
  static isRecommendationRuleKey(key: string): boolean {
    return (
      GoalsService.RECOMMENDATION_RULE_KEYS.includes(key) ||
      GoalsService.GOAL_BEHIND_KEY.test(key)
    );
  }

  async createGoal(
    restaurantId: string,
    input: {
      name: string;
      metricKey: string;
      targetValue: number;
      deadline?: string;
      period?: string;
      direction?: "at_least" | "at_most";
      createdBy?: string;
      /**
       * The recommendation this goal came from, or absent when a person typed
       * it. Validated against the catalogue above — an unknown key is refused
       * with words rather than stored as a string nothing can resolve.
       */
      sourceRuleKey?: string | null;
    },
  ) {
    if (!GoalsService.SUPPORTED_METRICS[input.metricKey]) {
      throw new Error(
        `Unsupported metric '${input.metricKey}'. Supported: ${Object.keys(GoalsService.SUPPORTED_METRICS).join(", ")}`,
      );
    }
    if (!(Number(input.targetValue) > 0))
      throw new Error("targetValue must be > 0");
    const sourceRuleKey =
      input.sourceRuleKey === undefined || input.sourceRuleKey === null
        ? null
        : String(input.sourceRuleKey);
    if (
      sourceRuleKey !== null &&
      !GoalsService.isRecommendationRuleKey(sourceRuleKey)
    ) {
      throw new Error(
        `Unknown recommendation rule '${sourceRuleKey}'. A goal's source must be a rule the engine evaluates: ${GoalsService.RECOMMENDATION_RULE_KEYS.join(", ")}, or goal_behind_<goal id>.`,
      );
    }
    const baseline = await this.computeMetric(
      restaurantId,
      input.metricKey,
      this.periodStart(input.period),
    );
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .insert({
        restaurant_id: restaurantId,
        name: input.name?.trim() || "Untitled goal",
        metric_key: input.metricKey,
        target_value: input.targetValue,
        baseline_value: baseline,
        current_value: baseline,
        direction: input.direction ?? "at_least",
        period: input.period ?? "custom",
        deadline: input.deadline ?? null,
        created_by: input.createdBy ?? null,
        source_rule_key: sourceRuleKey,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateGoalStatus(restaurantId: string, goalId: string, status: string) {
    const allowed = ["active", "achieved", "missed", "archived"];
    if (!allowed.includes(status)) throw new Error("Invalid status");
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .eq("id", goalId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * Edit a goal in place — the founder's *"they will have access to edit change
   * as they like"*.
   *
   * `metric_key` is deliberately NOT editable. `baseline_value` was measured
   * against the old metric at creation, and every progress figure, the pace
   * line and the Holt projection are computed against that baseline; swapping
   * the metric under it would leave a goal whose "we started at" is a reading
   * of a different quantity. Archive it and set a new one — the UI says so.
   *
   * A field the caller did not send is not written. A patch of `{}` therefore
   * touches nothing but `updated_at`, which is the honest outcome of "the user
   * opened the form and pressed save without changing anything".
   */
  async updateGoal(
    restaurantId: string,
    goalId: string,
    input: {
      name?: string;
      targetValue?: number;
      deadline?: string | null;
      direction?: "at_least" | "at_most";
      period?: string;
    },
  ) {
    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = String(input.name).trim();
      if (!name) throw new Error("A goal needs a name");
      patch.name = name.slice(0, 160);
    }
    if (input.targetValue !== undefined) {
      const target = Number(input.targetValue);
      if (!(target > 0)) throw new Error("targetValue must be > 0");
      patch.target_value = target;
    }
    if (input.deadline !== undefined) {
      if (input.deadline === null || input.deadline === "") {
        patch.deadline = null;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.deadline))) {
        throw new Error("deadline must be YYYY-MM-DD");
      } else {
        patch.deadline = input.deadline;
      }
    }
    if (input.direction !== undefined) {
      if (input.direction !== "at_least" && input.direction !== "at_most")
        throw new Error("direction must be at_least or at_most");
      patch.direction = input.direction;
    }
    if (input.period !== undefined) {
      const allowed = ["day", "week", "month", "quarter", "custom"];
      if (!allowed.includes(String(input.period)))
        throw new Error(`period must be one of ${allowed.join(", ")}`);
      patch.period = input.period;
    }
    if ((input as Record<string, unknown>).metricKey !== undefined)
      throw new Error(
        "A goal's metric cannot be changed after it is set — its baseline was measured against the old one. Archive this goal and set a new one.",
      );

    patch.updated_at = new Date().toISOString();

    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .update(patch)
      .eq("restaurant_id", restaurantId)
      .eq("id", goalId)
      .select()
      // `.single()` here answered a missing goal with PostgREST's own
      // "Cannot coerce the result to a single JSON object" — measured with
      // curl on 2026-09-03. That is a sentence about our query, handed to a
      // manager as though it were about their goal. `maybeSingle` lets the
      // absence be named as an absence.
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data)
      throw new Error("No goal with that id belongs to this restaurant.");
    return data;
  }

  // ==========================================================================
  // Progress + AI assistance
  // ==========================================================================

  /**
   * Progress for every goal of one status, in one call.
   *
   * `listGoals` alone cannot drive a progress bar honestly: `current_value` is
   * a STORED column, written at creation as the baseline and only refreshed
   * when someone opens that one goal's progress (`getGoalProgress`, :359). A
   * bar drawn off the list would therefore read "0% of the way there" for a
   * goal that is in fact half done — an absence reported as a measurement,
   * which is the fault ADR 0020 exists to stop.
   *
   * Capped at `MAX_PROGRESS_GOALS`, and the cap is REPORTED rather than
   * silently applied: a house with more goals than that must see that the list
   * it is looking at is partial.
   */
  async listGoalsWithProgress(restaurantId: string, status = "active") {
    const goals = await this.listGoals(restaurantId, status);
    const computed = goals.slice(0, GoalsService.MAX_PROGRESS_GOALS);
    const progress = await Promise.all(
      computed.map(async (g: any) => {
        try {
          return await this.getGoalProgress(restaurantId, g.id);
        } catch (err: any) {
          // One goal whose metric query broke must not blank the other five.
          // `null` progress is rendered as "this goal could not be read",
          // never as zero progress.
          this.logger.warn(
            `goal progress failed for ${g.id}: ${err?.message ?? err}`,
          );
          return { goal: g, unreadable: true, reason: String(err?.message ?? "") };
        }
      }),
    );
    return {
      status,
      goals: progress,
      total: goals.length,
      computed: computed.length,
      truncated: goals.length > computed.length,
      supportedMetrics: Object.entries(GoalsService.SUPPORTED_METRICS).map(
        ([key, m]) => ({ key, label: m.label, unit: m.unit }),
      ),
      basis: {
        current:
          "each goal's current value is recomputed from the same query the analytics engine reads, over the window that opens on the goal's creation date",
        peers:
          "no other restaurant's books are in this comparison: every figure here is this house against its own baseline, schedule and projection",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /** Recomputing progress is several queries per goal; six is a screenful. */
  static readonly MAX_PROGRESS_GOALS = 6;

  async getGoalProgress(restaurantId: string, goalId: string) {
    const { data: goal, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", goalId)
      .single();
    if (error || !goal) throw new Error(error?.message || "Goal not found");

    const spec = GoalsService.SUPPORTED_METRICS[goal.metric_key];
    const periodStart =
      goal.created_at?.substring(0, 10) ?? this.periodStart(goal.period);
    const { current, dailySeries } = await this.computeMetricWithSeries(
      restaurantId,
      goal.metric_key,
      periodStart,
    );

    // Refresh stored current_value (cheap side effect, keeps insights honest).
    await this.dbService
      .getClient()
      .from("analytics_goals")
      .update({ current_value: current, updated_at: new Date().toISOString() })
      .eq("id", goalId);

    const target = Number(goal.target_value) || 0;
    const progressPct = target > 0 ? current / target : 0;

    // Pace vs linear schedule.
    let daysLeft: number | null = null;
    let expectedByNow: number | null = null;
    let onTrack: boolean | null = null;
    let projected: number | null = null;
    if (goal.deadline) {
      const start = new Date(periodStart).getTime();
      const end = new Date(goal.deadline).getTime();
      const totalDays = Math.max(1, (end - start) / 86400000);
      const elapsed = Math.min(
        totalDays,
        Math.max(0, (Date.now() - start) / 86400000),
      );
      daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 86400000));
      expectedByNow = target * (elapsed / totalDays);
      onTrack =
        goal.direction === "at_most"
          ? current <= expectedByNow * 1.1
          : current >= expectedByNow * 0.9;

      // Projection: Holt trend on the cumulative series → deadline.
      if (dailySeries.length >= 7) {
        const cumulative: number[] = [];
        let acc = 0;
        for (const v of dailySeries) {
          acc += v;
          cumulative.push(acc);
        }
        const holt = E.holtLinear(cumulative, 0.4, 0.2, Math.max(1, daysLeft));
        projected = holt ? holt.forecast[holt.forecast.length - 1] : null;
      }
    }

    // Suggested actions: top stored insights from the goal's related
    // categories — the "levers" grounded in this restaurant's own data.
    const suggestions = await this.insightGenerator.getStored(restaurantId, {
      categories: spec?.insightCategories,
      limit: 4,
    });

    return {
      goal: { ...goal, current_value: current },
      metricLabel: spec?.label ?? goal.metric_key,
      unit: spec?.unit ?? "count",
      current,
      target,
      progressPct,
      expectedByNow,
      onTrack,
      daysLeft,
      projectedAtDeadline: projected,
      projectionHitsTarget:
        projected !== null
          ? goal.direction === "at_most"
            ? projected <= target
            : projected >= target
          : null,
      suggestedActions: suggestions.map((s: any) => ({
        sentence: s.sentence,
        category: s.category,
        score: s.score,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  // ==========================================================================
  // "Ask the book to make an analysis for this goal" (ADR 0020 / 0051)
  // ==========================================================================

  /**
   * Ask the assistant which of the analyses this product ALREADY computes
   * answers a goal, and how it should be drawn.
   *
   *   *"the Goals section that owners/managers decide, and it can be edited
   *    (will be using AI to create the analytics and their wanted feature if
   *    not already created)"*            — the founder, /reports, 2026-09-03
   *
   * The line this must not cross: the deterministic engine writes every number
   * and every sentence a reader sees as a measurement, and a model never does
   * (`insights/insight-verbalizer.ts` templates over computed arithmetic; ADR
   * 0020). So the model is not asked for an analysis — it is asked to CONFIGURE
   * one, and its whole answer is three enum values plus one sentence of its own
   * that is labelled as a proposal and never printed on a chart.
   *
   * Everything the model says is checked before it leaves this method
   * (`checkCuttingSpec`), and a spec that fails validation is REPORTED, not
   * repaired: a repaired spec would be shown to the reader as the assistant's
   * proposal while being something else.
   *
   * Failure posture: this method does not throw for a model failure. The goals
   * desk must keep working when the assistant does not, and "the book could not
   * answer" is a sentence the page can print, whereas a 500 is a blank panel.
   */
  async proposeCuttingSpec(
    restaurantId: string,
    goalId: string,
  ): Promise<{
    available: boolean;
    reason: string | null;
    spec: CuttingSpec | null;
    rejected: { reason: SpecRejection; detail: string } | null;
    goal: { id: string; name: string; metricKey: string } | null;
  }> {
    const { data: goal, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .select("id, name, metric_key, target_value, direction, deadline, period")
      .eq("restaurant_id", restaurantId)
      .eq("id", goalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!goal)
      throw new Error("No goal with that id belongs to this restaurant.");

    const named = {
      id: String(goal.id),
      name: String(goal.name),
      metricKey: String(goal.metric_key),
    };
    const metric = GoalsService.SUPPORTED_METRICS[goal.metric_key];

    // A provider that is not configured says so and does nothing. It does not
    // fall back to a hand-written "sensible" pick, because a fallback dressed
    // as an assistant's answer is exactly the fabrication this whole seam is
    // built to prevent.
    if (!this.configService.get<string>("ANTHROPIC_API_KEY")) {
      return {
        available: false,
        reason:
          "ANTHROPIC_API_KEY is not configured on this gateway, so no model can be asked. Every analysis on the sheet is still available to choose by hand.",
        spec: null,
        rejected: null,
        goal: named,
      };
    }

    const model =
      this.configService.get<string>("GOAL_CUTTING_MODEL") ||
      "claude-haiku-4-5-20251001";

    const system = `You configure an existing restaurant analytics page. You do NOT write analysis, numbers, or findings.

The page can lay down exactly these analyses, and no others:
${catalogueForPrompt()}

RULES
- Choose exactly ONE analysisId from the list above. Never invent an id.
- Choose ONE graph from that analysis's own "Drawings" list. Never choose a drawing that is not listed for it.
- Only the analysis marked "Takes days" accepts a "days" value, and only one of the values listed for it. For every other analysis, days must be null.
- "why" is one sentence naming the goal's measure and why that analysis speaks to it. Do NOT state any figure, trend, total or percentage: you have not been shown this restaurant's data and you must not imply that you have.

OUTPUT — respond with ONLY valid JSON, no prose, no code fence:
{"analysisId":"...","graph":"...","days":null,"why":"..."}`;

    const goalLine = `Goal "${named.name}": measure ${metric?.label ?? named.metricKey} (${metric?.unit ?? "count"}), ${goal.direction === "at_most" ? "keep at most" : "reach at least"} ${goal.target_value}${goal.deadline ? ` by ${goal.deadline}` : ", no deadline"}, period ${goal.period}.`;

    let payload: any;
    try {
      payload = await this.modelClient.call({
        body: {
          model,
          max_tokens: 400,
          system,
          messages: [
            {
              role: "user",
              content: `${goalLine}\n\nWhich single analysis on this page should the owner put on their sheet to watch this goal, and how should it be drawn?`,
            },
          ],
        },
        nf: {
          // NF-A ledger (P1 §5.3): one invocation, one row. `task_type` is the
          // group-by column of the headline spend query, so this call is
          // separable from the other nine model sites in the gateway.
          subjectId: "GoalsDesk",
          taskType: "goal_cutting_spec",
          stimulus: "goal",
          choice: (p: any) => {
            const t = (p?.content || []).find((b: any) => b.type === "text");
            try {
              return String(JSON.parse(stripFence(t?.text ?? "")).analysisId);
            } catch {
              return "unparsed";
            }
          },
          restaurantId,
          context: { goal_id: named.id, metric_key: named.metricKey },
        },
        timeoutMs: 20_000,
      });
    } catch (err: any) {
      return {
        available: true,
        reason: `The book could not be reached (${String(err?.message ?? err).slice(0, 200)}). Nothing was proposed.`,
        spec: null,
        rejected: null,
        goal: named,
      };
    }

    const text =
      (payload?.content || []).find((b: any) => b.type === "text")?.text ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFence(text));
    } catch {
      return {
        available: true,
        reason: null,
        spec: null,
        rejected: {
          reason: "not-an-object",
          detail: "the model's answer was not readable as JSON",
        },
        goal: named,
      };
    }

    const check = checkCuttingSpec(parsed);
    if (!check.ok) {
      this.logger.warn(
        `goal cutting spec refused (${check.reason}): ${check.detail}`,
      );
      return {
        available: true,
        reason: null,
        spec: null,
        rejected: { reason: check.reason, detail: check.detail },
        goal: named,
      };
    }

    return {
      available: true,
      reason: null,
      spec: check.spec,
      rejected: null,
      goal: named,
    };
  }

  // ==========================================================================
  // Metric computation (lean, per metric key)
  // ==========================================================================

  private periodStart(period?: string): string {
    const now = new Date();
    const d = new Date(now);
    switch (period) {
      case "day":
        break;
      case "week":
        d.setDate(d.getDate() - d.getDay());
        break;
      case "quarter": {
        const qMonth = Math.floor(d.getMonth() / 3) * 3;
        d.setMonth(qMonth, 1);
        break;
      }
      case "month":
        d.setDate(1);
        break;
      default:
        d.setDate(d.getDate() - 30); // custom default: trailing 30d
    }
    return d.toISOString().substring(0, 10);
  }

  private async computeMetric(
    restaurantId: string,
    metricKey: string,
    sinceDate: string,
  ): Promise<number> {
    const { current } = await this.computeMetricWithSeries(
      restaurantId,
      metricKey,
      sinceDate,
    );
    return current;
  }

  /**
   * @param untilDate optional inclusive end of the window (YYYY-MM-DD). Goal
   *   progress leaves it off — a goal runs to "now" — but the POS revenue
   *   endpoint needs a closed range so a chart's x-axis matches its total.
   */
  private async computeMetricWithSeries(
    restaurantId: string,
    metricKey: string,
    sinceDate: string,
    untilDate?: string,
  ): Promise<{
    current: number;
    dailySeries: number[];
    dailyDates: string[];
    rowCount: number;
  }> {
    const client = this.dbService.getClient();
    const sinceIso = `${sinceDate}T00:00:00Z`;
    const untilIso = untilDate ? `${untilDate}T23:59:59.999Z` : null;

    const daily = new Map<string, number>();
    let rowCount = 0;
    const add = (date: string, v: number) => {
      if (!date) return;
      daily.set(date, (daily.get(date) || 0) + v);
    };

    try {
      if (metricKey === "purchase_spend") {
        let q = client
          .from("procurement_orders")
          .select("total_cost, final_price, delivered_at, created_at, status")
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_SPEND_STATUSES)
          .gte("delivered_at", sinceIso);
        if (untilIso) q = q.lte("delivered_at", untilIso);
        const { data } = await q;
        rowCount = (data || []).length;
        for (const o of data || [])
          add(
            (o.delivered_at || o.created_at || "").substring(0, 10),
            o.total_cost || o.final_price || 0,
          );
      } else if (metricKey === "bottles_sold") {
        let q = client
          .from("wine_consumption_log")
          .select("quantity, volume_ml, created_at")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", sinceIso);
        if (untilIso) q = q.lte("created_at", untilIso);
        const { data } = await q;
        rowCount = (data || []).length;
        for (const c of data || [])
          add(
            (c.created_at || "").substring(0, 10),
            c.quantity || (c.volume_ml ? c.volume_ml / 750 : 0),
          );
      } else {
        // Check-based metrics (pos_revenue, wine_revenue, checks, avg_check,
        // attach rate). One query serves all of them on purpose: OD-85 asked
        // for POS revenue on four web surfaces, and a second hand-written sum
        // of `pos_checks` would be free to drift from the one goal progress
        // already trusts.
        let q = client
          .from("pos_checks")
          .select("total, opened_at, closed_at, items")
          .eq("restaurant_id", restaurantId)
          // Voided checks are not revenue — see pos_checks.voided. Goal progress
          // is the most visible of the three readers: it drives the sentences the
          // hourly sweep shows the owner.
          .eq("voided", false)
          .gte("opened_at", sinceIso);
        if (untilIso) q = q.lte("opened_at", untilIso);
        const { data } = await q;
        const checks = data || [];
        rowCount = checks.length;
        if (metricKey === "pos_revenue") {
          // The whole check total — the tender the restaurant actually booked,
          // which is the denominator a COGS ratio needs. `wine_revenue` below
          // deliberately sums only itemised wine lines and is NOT a substitute.
          for (const c of checks)
            add(
              (c.closed_at || c.opened_at || "").substring(0, 10),
              Number(c.total) || 0,
            );
        } else if (metricKey === "checks") {
          for (const c of checks)
            add((c.closed_at || c.opened_at || "").substring(0, 10), 1);
        } else if (metricKey === "avg_check") {
          const total = checks.reduce(
            (s: number, c: any) => s + (c.total || 0),
            0,
          );
          return {
            current: checks.length ? total / checks.length : 0,
            dailySeries: [],
            dailyDates: [],
            rowCount: checks.length,
          };
        } else if (metricKey === "wine_attach_rate") {
          const withWine = checks.filter((c: any) =>
            (Array.isArray(c.items) ? c.items : []).some(
              (it: any) => it?.is_wine,
            ),
          ).length;
          return {
            current: checks.length ? withWine / checks.length : 0,
            dailySeries: [],
            dailyDates: [],
            rowCount: checks.length,
          };
        } else {
          // wine_revenue: sum of wine items when itemized; whole check total
          // is NOT used so the number stays honest.
          for (const c of checks) {
            const items: any[] = Array.isArray(c.items) ? c.items : [];
            const wine = items
              .filter((it) => it?.is_wine)
              .reduce(
                (s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1),
                0,
              );
            add((c.closed_at || c.opened_at || "").substring(0, 10), wine);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`computeMetric(${metricKey}) failed: ${err?.message}`);
    }

    const dates = Array.from(daily.keys()).sort();
    const dailySeries = dates.map((d) => daily.get(d) || 0);
    const current = dailySeries.reduce((a, b) => a + b, 0);
    return { current, dailySeries, dailyDates: dates, rowCount };
  }

  // ==========================================================================
  // POS-backed sales revenue (OD-85)
  // ==========================================================================

  /**
   * Has this restaurant EVER had a POS check land?
   *
   * Deliberately unwindowed and deliberately not filtered on `voided`: the
   * question is "is a POS wired to this tenant", not "did they sell anything
   * this month". Without it, a connected-but-quiet week and a restaurant with
   * no POS at all would both read as `0`, and only one of those is true.
   *
   * Errors are NOT swallowed. `computeMetricWithSeries` catches and returns 0,
   * which is the pattern that lets a broken query masquerade as "no sales";
   * here a failure must reach the caller so the UI can say "couldn't load"
   * rather than "no POS connected".
   */
  private async hasPosHistory(restaurantId: string): Promise<boolean> {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .limit(1);
    if (error) throw new Error(error.message);
    return (data || []).length > 0;
  }

  /**
   * Sales revenue booked through the POS over a closed day range.
   *
   * `revenue`/`checkCount` are `null` — never `0` — when no POS is connected.
   * Every consumer of this payload renders an empty state off `posConnected`,
   * because a zero here would be a claim about the restaurant's trading rather
   * than a statement about our data (ADR 0020).
   */
  async getPosRevenueWindow(
    restaurantId: string,
    days = 30,
  ): Promise<PosRevenueWindow> {
    const span = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
    const end = new Date();
    const start = new Date(end.getTime() - (span - 1) * 86400000);
    const from = start.toISOString().substring(0, 10);
    const to = end.toISOString().substring(0, 10);

    if (!(await this.hasPosHistory(restaurantId))) {
      return {
        restaurantId,
        from,
        to,
        days: span,
        posConnected: false,
        revenue: null,
        checkCount: null,
        dailySeries: [],
      };
    }

    const { current, dailySeries, dailyDates, rowCount } =
      await this.computeMetricWithSeries(restaurantId, "pos_revenue", from, to);

    return {
      restaurantId,
      from,
      to,
      days: span,
      posConnected: true,
      revenue: current,
      checkCount: rowCount,
      dailySeries: dailyDates.map((date, i) => ({
        date,
        revenue: dailySeries[i] ?? 0,
      })),
    };
  }
}

/**
 * Models fence JSON even when told not to. Stripping the fence is a transport
 * concern, not a repair of the ANSWER — the values inside are still validated
 * against the catalogue before anything is honoured.
 */
export function stripFence(text: string): string {
  return String(text ?? "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/** Sales revenue for one restaurant over one closed day range. */
export interface PosRevenueWindow {
  restaurantId: string;
  /** Inclusive first day of the window, YYYY-MM-DD. */
  from: string;
  /** Inclusive last day of the window, YYYY-MM-DD. */
  to: string;
  days: number;
  /** False when this restaurant has never had a POS check. */
  posConnected: boolean;
  /** Sum of non-voided `pos_checks.total`. `null` when `posConnected` is false. */
  revenue: number | null;
  /** Non-voided checks in the window. `null` when `posConnected` is false. */
  checkCount: number | null;
  /** Sparse — only days that actually had revenue appear. */
  dailySeries: Array<{ date: string; revenue: number }>;
}
