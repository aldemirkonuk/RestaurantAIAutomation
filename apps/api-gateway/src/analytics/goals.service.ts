import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import * as E from "./engine";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { ORDER_SPEND_STATUSES } from "../procurement/order-status";

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
    },
  ) {
    if (!GoalsService.SUPPORTED_METRICS[input.metricKey]) {
      throw new Error(
        `Unsupported metric '${input.metricKey}'. Supported: ${Object.keys(GoalsService.SUPPORTED_METRICS).join(", ")}`,
      );
    }
    if (!(Number(input.targetValue) > 0))
      throw new Error("targetValue must be > 0");
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

  // ==========================================================================
  // Progress + AI assistance
  // ==========================================================================

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
