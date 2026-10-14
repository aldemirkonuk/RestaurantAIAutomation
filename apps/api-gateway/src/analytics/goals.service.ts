import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { AnalyticsService } from "./analytics.service";
import * as E from "./engine";
import {
  InsightGeneratorService,
  LEVEL_GOAL_METRICS,
  goalExpectedByNow,
  goalPaceHolds,
} from "./insights/insight-generator.service";
import { ORDER_SPEND_STATUSES } from "../procurement/order-status";
import {
  ForeignCurrencySpendError,
  MixedCurrencySpendError,
  UnpricedSpendError,
  namedCurrencies,
  sumOrderSpend,
} from "../procurement/order-spend";
import { WholeReadError, readWholeWindow } from "../common/read-whole-window";
import {
  TILL_TOTALS_TAX_UNREAD,
  goalTaxNote,
  readTillPricesTaxWord,
  tillTotalsTaxNote,
} from "../common/period-tax-note";
import {
  HOUSE_ZONE_UNSET,
  HOUSE_ZONE_UNSET_PACE,
  houseDayBounds,
  houseDayOf,
  houseToday,
  readHouseZone,
  shiftHouseDay,
  type HouseZone,
} from "../common/house-day";
import {
  goalPeriodEndAfter,
  goalPeriodStart,
  goalSchedule,
  goalWindow,
} from "./goal-window";
import {
  UncountedConsumptionError,
  UnitsLabel,
  bottlesOf,
  unitsLabel,
} from "./consumption-units";
import {
  ModelClientService,
  NfEventRef,
} from "../common/model-client/model-client.service";
import { NfVerdictService } from "../common/model-client/nf-verdict.service";
import { SCHEMA_BASIS, cuttingSpecVerdict } from "./goal-cutting-verdict";
import {
  resolveModel,
  routingContext,
} from "../common/model-client/model-routing";
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
 * Supported metric keys: wine_revenue, bottles_sold, purchase_spend, checks,
 * avg_check, wine_attach_rate, and — since 2026-09-04 (ADR 0120) —
 * days_of_inventory, the first of the twelve gaps the scenario catalogue named.
 *
 * `pos_revenue` is computed by the same query but is deliberately NOT in
 * SUPPORTED_METRICS: it exists for `getPosRevenueWindow` (OD-85), and offering
 * it as a goal target is a separate product decision nobody has made.
 */
/**
 * A goal whose measure has nothing in its window to read: an average check or
 * an attach rate with no check filed since the goal was set. It is "not
 * measured", never 0 — a zero average check is not a cheap night, it is no
 * night at all (F-183). `createGoal` stores no baseline for it, and
 * `listGoalsWithProgress` prints the sentence where the bar would be.
 */
export class UnmeasuredGoalError extends Error {}

// The pace rule lives beside the insight feed's goal family, which reads it
// too: this file already imports the generator, so the rule sits there and
// not here, where importing it back would make the two files a cycle (F-183,
// F-383). Re-exported so the reports desk and recommendations keep one import.
export { LEVEL_GOAL_METRICS, goalExpectedByNow, goalPaceHolds };

/**
 * A percent measure is stored as a share (0.35 is 35%). A target above 1 is
 * a percentage typed as a whole number, which would be stored as 3,500% and
 * read as behind forever (F-184), so it is refused in words.
 */
export function percentTargetRefusal(
  metricKey: string,
  target: number,
): string | null {
  const unit = GoalsService.SUPPORTED_METRICS[metricKey]?.unit;
  if (unit !== "percent" || target <= 1) return null;
  return `${GoalsService.SUPPORTED_METRICS[metricKey].label} is a share of checks, so its target cannot be above 100%. Send 35% as 0.35.`;
}

/**
 * Why a goal's deadline is refused, or null (F-1413): it must be a day, and
 * not one before the house's today. The period a goal counts opens on or
 * before today, so a deadline that is not behind today is not behind it. No
 * zone on record reads today as UTC's.
 */
export function deadlineRefusal(
  deadline: string,
  zone: string | null,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline))
    return "deadline must be YYYY-MM-DD";
  const today = zone ? houseToday(zone) : new Date().toISOString().slice(0, 10);
  return deadline < today
    ? `A goal cannot be due on ${deadline}: that day has already passed here. Pick ${today} or a later day.`
    : null;
}

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
    // OD-59 / ADR 0029 P3.0: this call grades its own output. Without it the
    // task type recorded `call_level_v0` alone — "HTTP 200, not truncated" —
    // which says nothing about whether the assistant named an analysis this
    // sheet actually carries.
    private readonly nfVerdicts: NfVerdictService,
    /**
     * Only `days_of_inventory` uses this, and it reads ONE published field
     * (`daysInventoryOutstanding`) rather than re-deriving the ratio. Two
     * implementations of "how many days of stock" is how `/reports` and a goal
     * end up disagreeing about the same cellar.
     *
     * No cycle: `AnalyticsService`'s constructor takes `DatabaseService` alone
     * (analytics.service.ts), so it does not reach back here.
     */
    private readonly analyticsService: AnalyticsService,
  ) {}

  static readonly SUPPORTED_METRICS: Record<
    string,
    {
      label: string;
      unit: "currency" | "units" | "count" | "percent" | "days";
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
    /**
     * Days of stock on hand — the seventh, added 2026-09-04 (ADR 0120).
     *
     * The founder's answer to "which of the twelve gaps first": this one, and
     * it was chosen because it was already computed. `/analytics/financial/:rid`
     * has published `daysInventoryOutstanding` all along
     * (`analytics.service.ts:444-451`); the only thing missing was an entry
     * here, so the goals desk could hold a house to it.
     *
     * It is UNLIKE the other six in a way that matters downstream: they are
     * cumulative sums over a window, and this is a STOCK LEVEL read at an
     * instant. There is no daily series, so no Holt projection is drawn — the
     * same shape `avg_check` and `wine_attach_rate` already have, and the page
     * already says "there is not enough history to project the deadline".
     *
     * Insight categories are `purchasing` and `risk`: what moves days-of-stock
     * is what you buy and how much capital you leave sitting, which is the same
     * pair `purchase_spend` reads. `sales` is deliberately absent — selling
     * faster does move it, but the levers the feed would hand back under that
     * category are about revenue, and this goal is about the cellar.
     */
    days_of_inventory: {
      label: "Days of stock",
      unit: "days",
      insightCategories: ["purchasing", "risk"],
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
    // `closed` is both ends a deadline can close a goal on (F-1291).
    const { data, error } =
      status === "all"
        ? await q
        : status === "closed"
          ? await q.in("status", ["achieved", "missed"])
          : await q.eq("status", status);
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
    // ADR 0193 (2026-09-21): price advice toward the house's target margin.
    "margin_target_unset",
    "margin_to_target",
    "margin_advice_blind",
    // ADR 0193 round 2: glass advice waits for the house's pour size.
    "pour_size_unconfirmed",
    // ADR 0193 round 3: locked prices worth a look.
    "price_locks_to_review",
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
    const percentRefusal = percentTargetRefusal(
      input.metricKey,
      Number(input.targetValue),
    );
    if (percentRefusal) throw new Error(percentRefusal);
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
    // The baseline window opens on the house's own date (ADR 0296). With no
    // zone, a windowed metric refuses with the zone sentence rather than
    // writing a baseline measured on UTC days.
    const house = await readHouseZone(this.dbService.getClient(), restaurantId);
    const opens = house.zone
      ? this.periodStart(input.period, house.zone)
      : null;
    // F-1413: a deadline already behind the house's today (and so behind the
    // period's start) was kept, and the hourly sweep closed the goal on
    // figures from before it was set.
    if (input.deadline != null) {
      const refusal = deadlineRefusal(String(input.deadline), house.zone);
      if (refusal) throw new Error(refusal);
    }
    // A measure with nothing to read yet (no check filed) has no baseline:
    // the goal is set and stays "not measured" until a check lands (F-183).
    let baseline: number | null;
    try {
      baseline = await this.computeMetric(
        restaurantId,
        input.metricKey,
        opens,
        house.zone,
      );
    } catch (err) {
      if (!(err instanceof UnmeasuredGoalError)) throw err;
      baseline = null;
    }
    // A goal counted over a day, week, month or quarter, sent with no
    // deadline, is due on that period's last house day: "this month" ends on
    // the house's month end, not 30 days on (F-632). It can be moved later
    // (`updateGoal`).
    const periodEnd = opens ? this.periodEndAfter(input.period, opens) : null;
    const deadline =
      input.deadline ?? (periodEnd ? shiftHouseDay(periodEnd, -1) : null);
    const { data, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .insert({
        restaurant_id: restaurantId,
        name: input.name?.trim() || "Untitled goal",
        metric_key: input.metricKey,
        target_value: input.targetValue,
        baseline_value: baseline,
        // NOT NULL in the table; an unmeasured goal keeps the column default,
        // and no reader takes this stored figure for a measurement.
        current_value: baseline ?? 0,
        direction: input.direction ?? "at_least",
        period: input.period ?? "custom",
        deadline,
        created_by: input.createdBy ?? null,
        source_rule_key: sourceRuleKey,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  /**
   * `expectedStatus` is the status the caller's page showed (F-1371). When it
   * is sent and the goal has moved on since — another manager archived it, or
   * it was marked achieved — nothing is written and the 409 says what it is
   * now, rather than a stale tab quietly rewriting the other person's close.
   */
  async updateGoalStatus(
    restaurantId: string,
    goalId: string,
    status: string,
    expectedStatus?: string,
  ) {
    const allowed = ["active", "achieved", "missed", "archived"];
    if (!allowed.includes(status)) throw new Error("Invalid status");
    if (expectedStatus !== undefined && !allowed.includes(expectedStatus))
      throw new Error("Invalid expected status");
    let q = this.dbService
      .getClient()
      .from("analytics_goals")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .eq("id", goalId);
    if (expectedStatus !== undefined) q = q.eq("status", expectedStatus);
    const { data, error } = await q.select().maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) await this.refuseClosedGoal(restaurantId, goalId, "change");
    return data;
  }

  /**
   * Why a guarded goal write matched no row (F-1371): the goal is gone, or
   * someone closed it after this page read it. Always throws.
   */
  private async refuseClosedGoal(
    restaurantId: string,
    goalId: string,
    what: "edit" | "change",
  ): Promise<never> {
    const { data: held, error } = await this.dbService
      .getClient()
      .from("analytics_goals")
      .select("status")
      .eq("restaurant_id", restaurantId)
      .eq("id", goalId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!held)
      throw new Error("No goal with that id belongs to this restaurant.");
    const now = String((held as { status?: unknown }).status ?? "");
    const said =
      now === "archived"
        ? "archived"
        : now === "achieved"
          ? "marked achieved"
          : now === "missed"
            ? "marked missed"
            : now === "active"
              ? "reopened"
              : `set to ${now}`;
    throw new ConflictException(
      `This goal was ${said} by someone else after you opened it, so your ${what} was not written. Reload the page to see it as it stands now.`,
    );
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
      // Only a target above 1 can be a percentage typed whole, so only then
      // is the goal's measure read (F-184).
      if (target > 1) {
        const { data: held, error: heldError } = await this.dbService
          .getClient()
          .from("analytics_goals")
          .select("metric_key")
          .eq("restaurant_id", restaurantId)
          .eq("id", goalId)
          .maybeSingle();
        if (heldError) throw new Error(heldError.message);
        const refusal = held
          ? percentTargetRefusal(String(held.metric_key), target)
          : null;
        if (refusal) throw new Error(refusal);
      }
      patch.target_value = target;
    }
    if (input.deadline !== undefined) {
      if (input.deadline === null || input.deadline === "") {
        patch.deadline = null;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.deadline))) {
        throw new Error("deadline must be YYYY-MM-DD");
      } else {
        // F-1413: a new deadline is not set in the past. The goal's own
        // deadline sent back unchanged (the edit form sends every field) is
        // kept, so renaming a goal whose deadline passed still saves.
        const { zone } = await readHouseZone(
          this.dbService.getClient(),
          restaurantId,
        );
        if (deadlineRefusal(String(input.deadline), zone)) {
          const { data: held, error: heldError } = await this.dbService
            .getClient()
            .from("analytics_goals")
            .select("deadline")
            .eq("restaurant_id", restaurantId)
            .eq("id", goalId)
            .maybeSingle();
          if (heldError) throw new Error(heldError.message);
          const was = held?.deadline ? String(held.deadline).slice(0, 10) : "";
          if (was !== input.deadline)
            throw new Error(
              deadlineRefusal(String(input.deadline), zone) as string,
            );
        }
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
      // Only a running goal takes an edit (F-1371): an edit from a tab opened
      // before another manager archived it must not rewrite the closed goal.
      .eq("status", "active")
      .select()
      // `.single()` here answered a missing goal with PostgREST's own
      // "Cannot coerce the result to a single JSON object" — measured with
      // curl on 2026-09-03. That is a sentence about our query, handed to a
      // manager as though it were about their goal. `maybeSingle` lets the
      // absence be named as an absence.
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) await this.refuseClosedGoal(restaurantId, goalId, "edit");
    return data;
  }

  // ==========================================================================
  // Progress + AI assistance
  // ==========================================================================

  /**
   * Progress for every goal of one status, in one call.
   *
   * `listGoals` alone cannot drive a progress bar honestly: `current_value` is
   * a STORED column, written at creation as the baseline and refreshed only
   * by the hourly insight sweep (`refreshStoredCurrentValues`). A bar drawn
   * off the list would therefore read "0% of the way there" for a goal set
   * this morning that is in fact half done — an absence reported as a measurement,
   * which is the fault ADR 0020 exists to stop.
   *
   * Capped at `MAX_PROGRESS_GOALS`, and the cap is REPORTED rather than
   * silently applied: a house with more goals than that must see that the list
   * it is looking at is partial.
   */
  async listGoalsWithProgress(restaurantId: string, status = "active") {
    // The house's zone is read once for every goal on the list (ADR 0296),
    // alongside the list itself. A failed read throws: every goal would fail
    // on it alike, and a list of six identical failures says less than one.
    // With the active goals come the ones their deadlines closed (F-1291),
    // for the desk's own fold. They are not recomputed: each carries the
    // final window's value the sweep stored when it closed the goal.
    const [goals, house, closedGoals] = await Promise.all([
      this.listGoals(restaurantId, status),
      readHouseZone(this.dbService.getClient(), restaurantId),
      status === "active"
        ? this.listGoals(restaurantId, "closed")
        : Promise.resolve([]),
    ]);
    const computed = goals.slice(0, GoalsService.MAX_PROGRESS_GOALS);
    const progress = await Promise.all(
      computed.map(async (g: any) => {
        try {
          return await this.getGoalProgress(restaurantId, g.id, house);
        } catch (err: any) {
          // One goal whose metric query broke must not blank the other five.
          // `null` progress is rendered as "this goal could not be read",
          // never as zero progress.
          this.logger.warn(
            `goal progress failed for ${g.id}: ${err?.message ?? err}`,
          );
          // `zoneUnset` says the reason is the house's missing zone, so the
          // reports goal card can link it to Settings, as it does the pace
          // reason (ADR 0296 §5), without matching the sentence's words.
          return {
            goal: g,
            unreadable: true,
            reason: String(err?.message ?? ""),
            zoneUnset: err?.message === HOUSE_ZONE_UNSET,
          };
        }
      }),
    );
    return {
      status,
      goals: progress,
      total: goals.length,
      computed: computed.length,
      truncated: goals.length > computed.length,
      closed: closedGoals
        .slice(0, GoalsService.MAX_CLOSED_GOALS)
        .map((g: any) => {
          const metric = (GoalsService.SUPPORTED_METRICS as any)[g.metric_key];
          return {
            goal: g,
            outcome: g.status,
            final: g.current_value == null ? null : Number(g.current_value),
            target: Number(g.target_value),
            metricLabel: metric?.label ?? g.metric_key,
            unit: metric?.unit ?? "count",
          };
        }),
      closedTotal: closedGoals.length,
      supportedMetrics: Object.entries(GoalsService.SUPPORTED_METRICS).map(
        ([key, m]) => ({ key, label: m.label, unit: m.unit }),
      ),
      basis: {
        current:
          "each goal's current value is recomputed from the same query the analytics engine reads, over the goal's current day, week, month or quarter when it is counted over one, else from the goal's creation date, and never past its deadline",
        peers:
          "no other restaurant's books are in this comparison: every figure here is this house against its own baseline, schedule and projection",
        units:
          "Bottles sold counts bottles by each line's own mode: a bottle line is its quantity, a glass line is its millilitres over the item's stated bottle size, or over the 750 ml stand-in the stock moves by when no size is stated; each Bottles sold goal's `units` counts the lines and items in its window resting on that stand-in; a goal whose window holds a line with no bottle figure is not scored (ADR 0297)",
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * A goal's current value over its own window. The window opens on the house
   * date the goal was created (ADR 0296), not the UTC date: a goal set at
   * 22:00 in Los Angeles was set that day.
   */
  private async measureGoal(restaurantId: string, goal: any, house: HouseZone) {
    // The goal's window, on the house's days (ADR 0296). A goal "counted over"
    // a day, week, month or quarter counts the current one, and starts again
    // when the next opens (F-628) — the same window its baseline was read
    // over at creation. A custom goal opens on the house date it was created:
    // a goal set at 22:00 in Los Angeles was set that day. Either way the
    // count stops on the deadline's house day: a quarter goal that missed on
    // 30 Sep does not go on adding October's sales.
    // `goalWindow` is the one answer, shared with the insight feed's goal
    // card (F-864).
    const zone = house.zone;
    const deadlineDay = goal.deadline
      ? String(goal.deadline).slice(0, 10)
      : undefined;
    const win = zone ? goalWindow(goal, zone) : null;
    const periodStart = win?.periodStart ?? null;
    const periodEnd = win?.periodEnd ?? null;
    const measured = await this.computeMetricWithSeries(
      restaurantId,
      goal.metric_key,
      periodStart,
      deadlineDay,
      zone,
    );
    return { zone, periodStart, periodEnd, deadlineDay, ...measured };
  }

  /**
   * Writes each active goal's recomputed value into the stored
   * `current_value`, which the insight goals family, the recommendation goal
   * rules and the goal lists read. The progress reads never write (F-264);
   * this is the column's one refresh, run by the hourly insight sweep.
   * `updated_at` is left alone: it says when someone last edited the goal.
   *
   * A goal whose value could not be read keeps its last stored value and is
   * counted in `failed`; it is never written as zero.
   *
   * A goal whose deadline day is over on the house's clock is CLOSED here
   * (F-1291, the F-628 residual): achieved or missed from its final window's
   * value, which `goalWindow` already stops on the deadline day, and that
   * value is the one stored. Only a goal still `active` is closed, so a
   * second sweep, or an owner who archived it in between, changes nothing.
   * With no house zone the deadline's day is not known, and the goal stays
   * open rather than being closed on the server's day.
   */
  async refreshStoredCurrentValues(
    restaurantId: string,
  ): Promise<{ refreshed: number; failed: number; closed: number }> {
    const [goals, house] = await Promise.all([
      this.listGoals(restaurantId, "active"),
      readHouseZone(this.dbService.getClient(), restaurantId),
    ]);
    const today = house.zone ? houseToday(house.zone) : null;
    let refreshed = 0;
    let failed = 0;
    let closed = 0;
    for (const goal of goals) {
      try {
        const { current } = await this.measureGoal(restaurantId, goal, house);
        const outcome = GoalsService.closedOutcome(goal, current, today);
        let q = this.dbService
          .getClient()
          .from("analytics_goals")
          .update(
            outcome
              ? { current_value: current, status: outcome }
              : { current_value: current },
          )
          .eq("restaurant_id", restaurantId)
          .eq("id", goal.id);
        if (outcome) q = q.eq("status", "active");
        const { error } = await q;
        if (error) throw new Error(error.message);
        refreshed += 1;
        if (outcome) closed += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(
          `stored goal value not refreshed for ${goal.id}: ${err?.message ?? err}`,
        );
      }
    }
    return { refreshed, failed, closed };
  }

  /**
   * How a goal closes, or null while it is still running: only once its
   * deadline's house day is over, and only on a value that was read. At least
   * a target is achieved at or above it; at most, at or below it.
   */
  static closedOutcome(
    goal: { deadline?: unknown; direction?: string; target_value?: unknown },
    current: number | null | undefined,
    today: string | null,
  ): "achieved" | "missed" | null {
    if (!goal.deadline || !today) return null;
    if (String(goal.deadline).slice(0, 10) >= today) return null;
    const target = Number(goal.target_value);
    if (typeof current !== "number" || !Number.isFinite(current)) return null;
    if (!Number.isFinite(target)) return null;
    const met =
      goal.direction === "at_most" ? current <= target : current >= target;
    return met ? "achieved" : "missed";
  }

  /** Recomputing progress is several queries per goal; six is a screenful. */
  static readonly MAX_PROGRESS_GOALS = 6;

  /** The closed fold lists the latest goals a deadline closed (F-1291). */
  static readonly MAX_CLOSED_GOALS = 12;

  /**
   * @param known the house's zone when the caller already read it
   *   (`listGoalsWithProgress`); read here otherwise.
   */
  async getGoalProgress(
    restaurantId: string,
    goalId: string,
    known?: HouseZone,
  ) {
    const [{ data: goal, error }, house] = await Promise.all([
      this.dbService
        .getClient()
        .from("analytics_goals")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("id", goalId)
        .single(),
      known
        ? Promise.resolve(known)
        : readHouseZone(this.dbService.getClient(), restaurantId),
    ]);
    if (error || !goal) throw new Error(error?.message || "Goal not found");

    const spec = GoalsService.SUPPORTED_METRICS[goal.metric_key];
    // A read writes nothing (F-264): this ran an UPDATE of `current_value` and
    // `updated_at` on every GET, so opening a goal moved its "last edited"
    // time. The stored column is refreshed by `refreshStoredCurrentValues`,
    // which the hourly insight sweep runs. The window (F-628) is measureGoal's.
    const {
      zone,
      periodStart,
      periodEnd,
      deadlineDay,
      current,
      dailySeries,
      units,
    } = await this.measureGoal(restaurantId, goal, house);

    const target = Number(goal.target_value) || 0;
    const progressPct = target > 0 ? current / target : 0;

    // Pace vs linear schedule.
    let daysLeft: number | null = null;
    let expectedByNow: number | null = null;
    let onTrack: boolean | null = null;
    let projected: number | null = null;
    let paceUnread: string | null = null;
    // The schedule is `goalSchedule`'s: from the midnight that opened the
    // goal's first day to the midnight that closes its deadline day (F-865),
    // on the house's clock (ADR 0296). With no zone the deadline has
    // no midnight to count to, so the pace is not computed and `paceUnread`
    // carries the reason: the reports desk prints it, the goals export
    // withholds the pace with it, and the recommendations margin says "Pace
    // unknown" rather than "No deadline". Only days of stock gets here with no
    // zone; every other metric has already thrown HOUSE_ZONE_UNSET.
    if (goal.deadline && !zone) paceUnread = HOUSE_ZONE_UNSET_PACE;
    if (goal.deadline && zone && periodStart) {
      const schedule = goalSchedule(
        { periodStart, periodEnd, deadlineDay: deadlineDay! },
        zone,
      );
      const end = schedule.endAt;
      const totalDays = schedule.totalDays;
      const elapsed = schedule.elapsedDays;
      daysLeft = schedule.daysLeft;
      // A level (average check, attach rate, days of stock) ramps from its
      // baseline, a running total from nothing (F-183).
      const baseline =
        goal.baseline_value === null || goal.baseline_value === undefined
          ? null
          : Number(goal.baseline_value);
      expectedByNow = goalExpectedByNow(
        goal.metric_key,
        target,
        baseline,
        elapsed / totalDays,
      );
      onTrack = goalPaceHolds(goal.direction, current, expectedByNow);

      // Projection: Holt trend on the cumulative series → deadline.
      if (dailySeries.length >= 7) {
        const cumulative: number[] = [];
        let acc = 0;
        for (const v of dailySeries) {
          acc += v;
          cumulative.push(acc);
        }
        // Projected to the window's end: the deadline, or a counted-over
        // period's own end when that comes first.
        const toEnd = Math.ceil((end - Date.now()) / 86400000);
        const holt = E.holtLinear(cumulative, 0.4, 0.2, Math.max(1, toEnd));
        projected = holt ? holt.forecast[holt.forecast.length - 1] : null;
      }
    }

    // Suggested actions: top stored insights from the goal's related
    // categories — the "levers" grounded in this restaurant's own data.
    const [suggestions, taxNote] = await Promise.all([
      this.insightGenerator.getStored(restaurantId, {
        categories: spec?.insightCategories,
        limit: 4,
      }),
      GoalsService.TILL_PRICED_METRICS.has(goal.metric_key)
        ? this.goalTaxNoteFor(restaurantId, spec?.label ?? goal.metric_key)
        : Promise.resolve(null),
    ]);

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
      /** Why a goal with a deadline has no pace (null otherwise): ADR 0296. */
      paceUnread,
      projectedAtDeadline: projected,
      projectionHitsTarget:
        projected !== null
          ? goal.direction === "at_most"
            ? projected <= target
            : projected >= target
          : null,
      // A Bottles sold goal's bottle basis: how many lines and items in its
      // window rest on the 750 ml stand-in (ADR 0297). Null for every other
      // metric.
      units: units ?? null,
      // w109-gross-basis: an Average check or Wine revenue goal at a house
      // whose till prices include tax says the figure holds it. Absent
      // everywhere else, so a US or unset house's progress is unchanged.
      ...(taxNote ? { taxNote } : {}),
      suggestedActions: suggestions.map((s: any) => ({
        sentence: s.sentence,
        category: s.category,
        score: s.score,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * w109-gross-basis (ADR 0341): the goal measures that add up what the till
   * rang, `pos_checks.total` (Average check) or the wine lines' own prices
   * (Wine revenue). Ingest changes only `subtotal`, so these stay on one
   * basis across a switch day, the basis /reports Taken is on; at a house
   * whose till prices include tax they hold it, and say so.
   */
  static readonly TILL_PRICED_METRICS: ReadonlySet<string> = new Set([
    "avg_check",
    "wine_revenue",
  ]);

  /** The goal's tax sentence, or null; an unread answer is said, never a no. */
  private async goalTaxNoteFor(
    restaurantId: string,
    label: string,
  ): Promise<string | null> {
    try {
      const word = await readTillPricesTaxWord(
        this.dbService.getClient(),
        restaurantId,
      );
      return word ? goalTaxNote(label, word) : null;
    } catch (err: any) {
      this.logger.warn(
        `tax answer unreadable for r=${restaurantId}: ${err?.message ?? err}`,
      );
      return `Whether ${label} includes tax could not be read.`;
    }
  }

  /** The till totals' tax sentence, or null (Taken; w109-gross-basis). */
  private async tillTotalsTaxNoteFor(
    restaurantId: string,
  ): Promise<string | null> {
    try {
      const word = await readTillPricesTaxWord(
        this.dbService.getClient(),
        restaurantId,
      );
      return word ? tillTotalsTaxNote(word) : null;
    } catch (err: any) {
      this.logger.warn(
        `tax answer unreadable for r=${restaurantId}: ${err?.message ?? err}`,
      );
      return TILL_TOTALS_TAX_UNREAD;
    }
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
    /**
     * The user who pressed "Ask the book". Metered as `context.asked_by`
     * (ADR 0120). `null` — never a placeholder — when the caller cannot name
     * them, so "we recorded that we do not know" stays distinguishable from a
     * row written before the field existed.
     */
    askedBy: string | null = null,
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

    // Composing a cutting spec is the `compose` class (ADR 0120): the model is
    // writing a configuration, not looking something up, so the founder's
    // routing sends it to Sonnet 5. `GOAL_CUTTING_MODEL` still outranks the
    // class — an operator who set it on a running gateway meant it.
    const routing = resolveModel({
      config: this.configService,
      taskClass: "compose",
      siteEnvVar: "GOAL_CUTTING_MODEL",
    });
    const model = routing.model;
    const meter = routingContext(routing, askedBy);

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

    const eventRef = new NfEventRef();
    /** The grader, run once per exit. `record` never throws (nf-verdict.service). */
    const grade = (
      reading: Parameters<typeof cuttingSpecVerdict>[0]["reading"],
    ) =>
      this.nfVerdicts.record(
        eventRef,
        SCHEMA_BASIS,
        cuttingSpecVerdict({
          reading,
          model,
          taskClass: routing.taskClass,
          routedBy: routing.routedBy,
        }),
      );

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
          // Metering keys written literally, so the row's shape is readable
          // from this source rather than assembled out of a spread.
          context: {
            goal_id: named.id,
            metric_key: named.metricKey,
            task_class: meter.task_class,
            model_routed_by: meter.model_routed_by,
            asked_by: meter.asked_by,
          },
          eventRef,
        },
        timeoutMs: 20_000,
      });
    } catch (err: any) {
      // The emitter wrote a failure row for the CALL. The task verdict is
      // `null` — the grader ran and the case is untestable — because a model
      // that never answered cannot be judged on how it configured the sheet.
      grade({
        status: "degraded",
        why: "model_unreachable",
        detail: String(err?.message ?? err),
      });
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
      grade({
        status: "degraded",
        why: "answer_not_json",
        detail: "the model's answer was not readable as JSON",
      });
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
      grade({
        status: "refused_by_check",
        reason: check.reason,
        detail: check.detail,
      });
      return {
        available: true,
        reason: null,
        spec: null,
        rejected: { reason: check.reason, detail: check.detail },
        goal: named,
      };
    }

    grade({
      status: "accepted",
      analysisId: check.spec.analysisId,
      graph: check.spec.graph,
      days: check.spec.days,
    });
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

  /**
   * The first house date of a goal's period, on the house's clock (ADR 0296).
   * A week opens on Monday, a quarter on its first month's 1st, and a custom
   * goal looks back 30 days. `goalPeriodStart` (`goal-window.ts`) holds it.
   */
  private periodStart(
    period: string | undefined,
    zone: string,
    on: string = houseToday(zone),
  ): string {
    return goalPeriodStart(period, zone, on);
  }

  /** The first house date AFTER the period: `goalPeriodEndAfter`. */
  private periodEndAfter(
    period: string | undefined,
    start: string,
  ): string | null {
    return goalPeriodEndAfter(period, start);
  }

  private async computeMetric(
    restaurantId: string,
    metricKey: string,
    sinceDate: string | null,
    zone: string | null,
  ): Promise<number> {
    const { current } = await this.computeMetricWithSeries(
      restaurantId,
      metricKey,
      sinceDate,
      undefined,
      zone,
    );
    return current;
  }

  /**
   * @param sinceDate the window's first HOUSE date (YYYY-MM-DD); null only
   *   when `zone` is null.
   * @param untilDate optional inclusive last house date. Goal progress passes
   *   the deadline's house day (a goal with none runs to "now"), and the POS
   *   revenue endpoint needs a closed range so a chart's x-axis matches its
   *   total.
   * @param zone the house's zone (`readHouseZone`). Every series below is
   *   filed on the house's day (ADR 0296); with no zone a windowed metric
   *   throws `HOUSE_ZONE_UNSET`.
   */
  private async computeMetricWithSeries(
    restaurantId: string,
    metricKey: string,
    sinceDate: string | null,
    untilDate: string | undefined,
    zone: string | null,
  ): Promise<{
    current: number;
    dailySeries: number[];
    dailyDates: string[];
    rowCount: number;
    /** Bottles sold only: the bottle basis of the window (ADR 0297). */
    units?: UnitsLabel;
    /** pos_revenue only: checks with no total, left out of the sum (F-1444). */
    untotaled?: number;
    /** pos_revenue only: checks rung at 0, a comp or a staff meal (F-1534). */
    zeroTotaled?: number;
    /** pos_revenue only: refund checks, with a minus total (F-1644). */
    refundTotaled?: number;
    /** pos_revenue only: the money those refunds gave back, as a positive sum. */
    refundedSum?: number;
  }> {
    /**
     * Days of stock, before everything else, and deliberately OUTSIDE the
     * try/catch below.
     *
     * That catch logs and falls through to a sum of nothing, which returns
     * `0` — the shape that lets a failed query read as "this house bought
     * nothing". The other six metrics have lived with it since before this
     * change and repairing them is its own piece of work (since ADR 0292 the
     * check, consumption and, since F-332, order reads refuse through it
     * with `WholeReadError`); what must not happen
     * is a NEW metric inheriting it, because a days-of-stock goal reading
     * "0 days" is not a light cellar, it is an unread one.
     *
     * `daysInventoryOutstanding` is `null` unless every on-hand row carries a
     * recorded cost (ADR 0051), so a null is thrown rather than zeroed. It
     * surfaces exactly where the honesty machinery already is:
     * `listGoalsWithProgress` catches per goal and renders "this goal could not
     * be scored (<reason>)", and `createGoal` refuses with the same sentence
     * rather than writing a goal that can never be read.
     *
     * The window arguments are ignored on purpose and the caller is not misled
     * about it: a stock level is what is on the shelf NOW, not a total over a
     * period, and there is no historical series of it anywhere in this gateway.
     * So it is also the one metric whose number needs no house zone. Its pace
     * against a deadline still does (`getGoalProgress`, `paceUnread`).
     */
    if (metricKey === "days_of_inventory") {
      const financial: any =
        await this.analyticsService.getFinancialSummary(restaurantId);
      const dio = financial?.daysInventoryOutstanding;
      if (typeof dio !== "number" || !Number.isFinite(dio)) {
        // F-1443: say the reason the summary withheld it for, when it is
        // the deliveries with no price rather than the cellar's cost.
        const unpriced = Number(financial?.cogsUnpricedCount) || 0;
        // F-1491: a young house's days of stock are withheld for its short
        // span, not its cost basis; a fully costed cellar was told otherwise.
        // The unpriced deliveries come first, as the summary's basis.turns
        // names them first.
        if (unpriced === 0 && financial?.turnsSpanShort === true) {
          const days = Number(financial.turnsPeriodDays);
          throw new Error(
            `Days of stock cannot be read for this restaurant yet: it needs ${AnalyticsService.MIN_TURNS_SPAN_DAYS} days of buying on record, and this house has ${days} day${days === 1 ? "" : "s"} since its first delivery.`,
          );
        }
        throw new Error(
          unpriced > 0
            ? `Days of stock cannot be read for this restaurant yet: ${unpriced} delivered order${unpriced === 1 ? " has" : "s have"} no price, so cost of goods is short. Price ${unpriced === 1 ? "it" : "them"} to score this goal.`
            : "Days of stock cannot be read for this restaurant yet: it is cost of goods over inventory value, and inventory value is only known when every bottle on hand carries a recorded cost.",
        );
      }
      return { current: dio, dailySeries: [], dailyDates: [], rowCount: 1 };
    }

    // No zone, no house days: thrown HERE, outside the try below, whose catch
    // would turn it into a sum of nothing — a house with no zone set is not a
    // house that sold nothing (ADR 0296; ADR 0116).
    if (!zone || !sinceDate) throw new Error(HOUSE_ZONE_UNSET);

    const client = this.dbService.getClient();
    // Every series is read from 24 h before the window's first house midnight
    // (a check opened the night before and closed after midnight is filed on
    // the first day) up to the last instant of its last house day. `untilDate`
    // is the house's today or a goal's deadline, so that end is still to come
    // or already whole — except on the eve of a clock change at midnight, when
    // it is an hour early (ADR 0296 §1, `localMidnight`).
    const bounds = houseDayBounds(sinceDate, untilDate ?? sinceDate, zone);
    const sinceIso = bounds.readFromIso;
    const untilIso = untilDate
      ? new Date(Date.parse(bounds.endIso) - 1).toISOString()
      : null;

    // A row is filed on its house day by `houseDayOf` (the one rule), and a
    // row whose day falls outside the window is dropped — so one day's figure
    // is the same in every window that holds it (A-027). `subjectOf` hands
    // `houseDayOf` what it files: a check is handed whole, so the rule picks
    // its instant; any other row is handed its own instant.
    const fileByHouseDay = <T>(
      rows: T[],
      subjectOf: (row: T) => Parameters<typeof houseDayOf>[0],
    ): Array<{ row: T; day: string }> => {
      const out: Array<{ row: T; day: string }> = [];
      for (const row of rows) {
        const day = houseDayOf(subjectOf(row), zone);
        if (day === null || day < sinceDate) continue;
        if (untilDate !== undefined && day > untilDate) continue;
        out.push({ row, day });
      }
      return out;
    };

    const daily = new Map<string, number>();
    let rowCount = 0;
    let units: UnitsLabel | undefined;
    let untotaled = 0;
    let zeroTotaled = 0;
    let refundTotaled = 0;
    let refundedSum = 0;
    const add = (date: string, v: number) => {
      daily.set(date, (daily.get(date) || 0) + v);
    };

    try {
      if (metricKey === "purchase_spend") {
        // Read whole or refused (ADR 0292, F-332): unranged, this stopped at
        // PostgREST's 1,000 rows, and its error was dropped, so a failed read
        // summed to a spend of nothing.
        const read = await readWholeWindow<any>(
          "The delivered orders in this window",
          () => {
            let q = client
              .from("procurement_orders")
              .select(
                "id, total_cost, final_price, currency, delivered_at, created_at, status",
                { count: "exact" },
              )
              .eq("restaurant_id", restaurantId)
              .in("status", ORDER_SPEND_STATUSES)
              .gte("delivered_at", sinceIso);
            if (untilIso) q = q.lte("delivered_at", untilIso);
            return q;
          },
        );
        const orders = fileByHouseDay(
          read,
          (o) => o.delivered_at || o.created_at,
        );
        rowCount = orders.length;
        // A delivery with no price refuses the total rather than adding $0,
        // or one bottle's `final_price` as the whole order (F-701).
        const { unpricedCount } = sumOrderSpend(orders.map(({ row }) => row));
        if (unpricedCount > 0) throw new UnpricedSpendError(unpricedCount);
        // Orders paid in two currencies have no one total (F-1015, as COGS
        // under F-339). An order naming none is in the house's money, and a
        // window paid wholly in another currency is no progress towards a
        // target in the house's (F-1052).
        const house = await this.houseCurrencyOf(client, restaurantId);
        const codes = namedCurrencies(
          orders.map(({ row }) => row),
          house,
        );
        if (codes.length > 1) throw new MixedCurrencySpendError(codes);
        if (house && codes.length === 1 && codes[0] !== house)
          throw new ForeignCurrencySpendError(codes[0], house);
        for (const { row: o, day } of orders) add(day, Number(o.total_cost));
      } else if (metricKey === "bottles_sold") {
        // Read whole or refused (ADR 0292): an unranged select stopped at
        // PostgREST's 1,000 rows and reported the first thousand lines as
        // the window's bottles. The whole read is then filed on house days
        // (ADR 0296).
        const read = await readWholeWindow<any>(
          "The consumption lines in this window",
          () => {
            let q = client
              .from("wine_consumption_log")
              .select(
                "id, inventory_id, consumption_type, quantity, volume_ml, created_at, restaurant_inventory(bottle_size_ml)",
                { count: "exact" },
              )
              .eq("restaurant_id", restaurantId)
              // F-1197: a sale the till voided or corrected down is marked
              // reversed, never written negative; it was not sold.
              .is("reversed_at", null)
              .gte("created_at", sinceIso);
            if (untilIso) q = q.lte("created_at", untilIso);
            return q;
          },
        );
        const lines = fileByHouseDay(read, (c) => c.created_at);
        rowCount = lines.length;
        // Bottles by each line's own mode (ADR 0297): `quantity` counts
        // servings, so ten glasses are two bottles, not ten. A line with no
        // bottle figure refuses the total rather than leaving it short. Each
        // line keeps the house day it was filed on (ADR 0296).
        const counted = lines.map(({ row: c, day }) => ({
          ...bottlesOf(c),
          inventoryId: c.inventory_id ?? null,
          date: day,
        }));
        units = unitsLabel(counted);
        if (!units.complete) throw new UncountedConsumptionError(units);
        for (const c of counted) add(c.date, c.bottles as number);
      } else {
        // Check-based metrics (pos_revenue, wine_revenue, checks, avg_check,
        // attach rate). One query serves all of them on purpose: OD-85 asked
        // for POS revenue on four web surfaces, and a second hand-written sum
        // of `pos_checks` would be free to drift from the one goal progress
        // already trusts.
        //
        // Read whole or refused (ADR 0292). The unranged select this replaces
        // stopped at PostgREST's 1,000 rows: the 90-day till counted 1,000 of
        // 3,313 checks, $187k against $626k, with no day after Aug 15 (A-005).
        // `items` is fetched only for the two metrics that read it, so the
        // 365-day ribbon does not page every check's lines for a sum of totals.
        const needsItems =
          metricKey === "wine_revenue" || metricKey === "wine_attach_rate";
        const read = await readWholeWindow<any>(
          "The POS checks in this window",
          () => {
            let q: any = needsItems
              ? client
                  .from("pos_checks")
                  .select("id, total, opened_at, closed_at, items", {
                    count: "exact",
                  })
              : client
                  .from("pos_checks")
                  .select("id, total, opened_at, closed_at", {
                    count: "exact",
                  });
            q = q
              .eq("restaurant_id", restaurantId)
              // Voided checks are not revenue — see pos_checks.voided. Goal
              // progress is the most visible of the three readers: it drives
              // the sentences the hourly sweep shows the owner.
              .eq("voided", false)
              .gte("opened_at", sinceIso);
            if (untilIso) q = q.lte("opened_at", untilIso);
            return q;
          },
        );
        // Each check is handed whole, so `houseDayOf` files it by when it
        // closed, else when it opened (ADR 0296).
        const checks = fileByHouseDay(read, (c) => c);
        rowCount = checks.length;
        if (metricKey === "pos_revenue") {
          // The whole check total — the tender the restaurant actually booked,
          // which is the denominator a COGS ratio needs. `wine_revenue` below
          // deliberately sums only itemised wine lines and is NOT a substitute.
          //
          // F-1444: `total` is nullable, and an adapter with no total column
          // writes null. Such a check is left out of the sum and counted, so
          // Taken is not short by a silent 0 and the page can say how many.
          for (const { row: c, day } of checks) {
            const t = checkTotal(c);
            if (t == null) untotaled += 1;
            else add(day, t);
            // F-1534: a check rung at 0 took no money; it is in the sum as
            // nothing and counted, so the page's average can leave it out.
            if (t === 0) zeroTotaled += 1;
            // F-1644: a refund the till sends as a check with a minus total
            // is taken off the sum above, and counted, so the average check
            // can leave it out of both its sum and its count.
            if (t != null && t < 0) {
              refundTotaled += 1;
              refundedSum -= t;
            }
          }
        } else if (metricKey === "checks") {
          for (const { day } of checks) add(day, 1);
        } else if (metricKey === "avg_check") {
          // F-1444: a check with no total is not a $0 check; it is left out
          // of the sum and of the count the average divides by.
          const stated = checks
            .map(({ row: c }) => checkTotal(c))
            .filter((t): t is number => t != null);
          // F-1534: nor is a check rung at 0 (a comp, a staff meal) a sale;
          // it would pull the average down by a check nobody paid. F-1644:
          // nor is a refund, a check with a minus total.
          const totals = stated.filter((t) => t > 0);
          if (!checks.length)
            throw new UnmeasuredGoalError(
              "No check has been filed since this goal was set, so there is no average check to measure yet.",
            );
          if (!stated.length)
            throw new UnmeasuredGoalError(
              `None of the ${checks.length} checks filed since this goal was set carries a total, so there is no average check to measure yet.`,
            );
          if (!totals.length)
            throw new UnmeasuredGoalError(
              "Every check filed since this goal was set was rung at 0, such as a comp or a staff meal, or was a refund, so there is no average check to measure yet.",
            );
          return {
            current: totals.reduce((a, b) => a + b, 0) / totals.length,
            dailySeries: [],
            dailyDates: [],
            rowCount: totals.length,
          };
        } else if (metricKey === "wine_attach_rate") {
          const withWine = checks.filter(({ row: c }) =>
            (Array.isArray(c.items) ? c.items : []).some(
              (it: any) => it?.is_wine,
            ),
          ).length;
          if (!checks.length)
            throw new UnmeasuredGoalError(
              "No check has been filed since this goal was set, so there is no attach rate to measure yet.",
            );
          return {
            current: withWine / checks.length,
            dailySeries: [],
            dailyDates: [],
            rowCount: checks.length,
          };
        } else {
          // wine_revenue: sum of wine items when itemized; whole check total
          // is NOT used so the number stays honest.
          for (const { row: c, day } of checks) {
            const items: any[] = Array.isArray(c.items) ? c.items : [];
            const wine = items
              .filter((it) => it?.is_wine)
              .reduce(
                (s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1),
                0,
              );
            add(day, wine);
          }
        }
      }
    } catch (err: any) {
      // A window that could not be read whole is never summed to a figure:
      // it reaches the caller, which already says "could not be read" per
      // goal (listGoalsWithProgress) and refuses rather than writing a wrong
      // baseline (createGoal) or current_value (getGoalProgress). ADR 0292.
      if (err instanceof WholeReadError) throw err;
      // Same for a total that would rest on a line with no bottle figure.
      if (err instanceof UncountedConsumptionError) throw err;
      // And a measure with nothing to read is "not measured", never 0.
      if (err instanceof UnmeasuredGoalError) throw err;
      // And for a spend total that would leave out unpriced deliveries.
      if (err instanceof UnpricedSpendError) throw err;
      // And for one that would add lira to euros.
      if (err instanceof MixedCurrencySpendError) throw err;
      this.logger.warn(`computeMetric(${metricKey}) failed: ${err?.message}`);
    }

    const dates = Array.from(daily.keys()).sort();
    const dailySeries = dates.map((d) => daily.get(d) || 0);
    const current = dailySeries.reduce((a, b) => a + b, 0);
    return {
      current,
      dailySeries,
      dailyDates: dates,
      rowCount,
      units,
      ...(metricKey === "pos_revenue"
        ? { untotaled, zeroTotaled, refundTotaled, refundedSum }
        : {}),
    };
  }

  /**
   * The house's stated money (`restaurants.currency`), upper-cased; null when
   * none is on record (F-1052). A failed read refuses as a window that could
   * not be read whole does: `computeMetricWithSeries` lets that one through,
   * where any other error would become a spend of nothing.
   */
  private async houseCurrencyOf(
    client: any,
    restaurantId: string,
  ): Promise<string | null> {
    const { data, error } = await client
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error)
      throw new WholeReadError(
        "The house's currency",
        "read_failed",
        0,
        null,
        error.message ?? String(error),
      );
    const c = data?.currency;
    return typeof c === "string" && c.trim() ? c.trim().toUpperCase() : null;
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
   *
   * It answers with the first check, earliest first, or null when there is
   * none (F-1662), so the till window can say from which day the till was
   * connected: a day after it with no check is a day the house was shut, not
   * a day the till missed.
   */
  private async hasPosHistory(
    restaurantId: string,
  ): Promise<{ opened_at: string | null; closed_at: string | null } | null> {
    const { data, error } = await this.dbService
      .getClient()
      .from("pos_checks")
      .select("id, opened_at, closed_at")
      .eq("restaurant_id", restaurantId)
      .order("opened_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(error.message);
    return (data || [])[0] ?? null;
  }

  /**
   * Sales revenue booked through the POS over a closed range of HOUSE days.
   *
   * `revenue`/`checkCount` are `null` — never `0` — when no POS is connected.
   * Every consumer of this payload renders an empty state off `posConnected`,
   * because a zero here would be a claim about the restaurant's trading rather
   * than a statement about our data (ADR 0020).
   *
   * The window is the last `days` days on the house's clock, today included,
   * and each check is filed on its house day (ADR 0296). A house with no zone
   * answers `zoneUnset: true` with `null` figures and no window — not UTC
   * days (ADR 0116) — and readers say so and point to Settings.
   *
   * `month` (YYYY-MM) reads one calendar month instead (F-128): its first day
   * to its last, or to the house's today while the month is still running.
   * A month that has not begun on the house's clock is refused, not read as
   * an empty month. `days` is then the number of house days the month spans.
   * `month` may name a calendar quarter instead, YYYY-Qn (F-1577): its first
   * month's first day to its third month's last, read by the same whole
   * reader, so an owner reads Q3 without adding three months by hand.
   *
   * `week` reads one Monday-to-Sunday week instead (F-1236): `last` is the
   * last full week on the house's clock, the one that ended before today;
   * a Monday (YYYY-MM-DD) is that week, ended at the house's today while it
   * still runs. The weekly bell opens on `last`, so "the week" is the week
   * the house traded, not the trailing seven days the bell happened to land
   * in. A week not begun, or a date that is not a Monday, is refused.
   */
  async getPosRevenueWindow(
    restaurantId: string,
    days = 30,
    month: string | null = null,
    week: string | null = null,
  ): Promise<PosRevenueWindow> {
    const monthDays = month ? monthBounds(month) : null;
    if (month && !monthDays)
      throw new BadRequestException(
        "A month is written as year and month, like 2026-07, and a quarter as year and quarter, like 2026-Q3.",
      );
    if (month && week)
      throw new BadRequestException("Read one month or one week, not both.");
    if (week && week !== "last" && !isMonday(week))
      throw new BadRequestException(
        "A week is named by its Monday, like 2026-09-28, or as last for the last full week.",
      );
    // Both reads are by key and independent; neither error is swallowed.
    const [firstCheck, house] = await Promise.all([
      this.hasPosHistory(restaurantId),
      readHouseZone(this.dbService.getClient(), restaurantId),
    ]);
    const connected = firstCheck !== null;
    const zone = house.zone;
    const today = zone ? houseToday(zone) : null;
    if (monthDays && today && monthDays.first > today)
      throw new BadRequestException(
        `${month} has not begun on this house's clock, so there is nothing to read yet.`,
      );
    if (week && today && week !== "last" && week > today)
      throw new BadRequestException(
        `The week of ${week} has not begun on this house's clock, so there is nothing to read yet.`,
      );
    let from: string | null;
    let to: string | null;
    let span: number;
    if (week) {
      // The last full week ends on the Sunday before the house's today: on a
      // Sunday that is a week ago, since today is not yet over.
      const monday =
        week !== "last"
          ? week
          : today
            ? shiftHouseDay(today, -(isoWeekday(today) + 6))
            : null;
      if (monday && today) {
        const sunday = shiftHouseDay(monday, 6);
        to = sunday > today ? today : sunday;
        from = monday;
        span = spanOf(from, to);
      } else {
        to = null;
        from = null;
        span = 7;
      }
    } else if (monthDays) {
      // A month still running ends on the house's today, not on days to come.
      to = !today ? null : monthDays.last > today ? today : monthDays.last;
      from = today ? monthDays.first : null;
      span = spanOf(monthDays.first, to ?? monthDays.last);
    } else {
      span = Math.min(Math.max(Math.trunc(days) || 30, 1), 365);
      to = today;
      from = to ? shiftHouseDay(to, -(span - 1)) : null;
    }
    const unread = {
      restaurantId,
      from,
      to,
      days: span,
      timezone: zone,
      zoneUnset: zone === null,
      revenue: null,
      checkCount: null,
      checksWithoutTotal: null,
      checksTakingNoMoney: null,
      checksRefunded: null,
      refunded: null,
      dailySeries: [],
      coveredFrom: null,
    };

    if (!connected) return { ...unread, posConnected: false };
    if (!zone || !from || !to) return { ...unread, posConnected: true };

    const [
      {
        current,
        dailySeries,
        dailyDates,
        rowCount,
        untotaled,
        zeroTotaled,
        refundTotaled,
        refundedSum,
      },
      totalsTaxNote,
    ] = await Promise.all([
      this.computeMetricWithSeries(restaurantId, "pos_revenue", from, to, zone),
      this.tillTotalsTaxNoteFor(restaurantId),
    ]);

    return {
      restaurantId,
      from,
      to,
      days: span,
      timezone: zone,
      zoneUnset: false,
      posConnected: true,
      // F-1444: checks with no total are left out of `revenue` and counted;
      // when every check lacks one there is no figure, not $0.
      revenue: rowCount > 0 && (untotaled ?? 0) >= rowCount ? null : current,
      checkCount: rowCount,
      checksWithoutTotal: untotaled ?? 0,
      checksTakingNoMoney: zeroTotaled ?? 0,
      checksRefunded: refundTotaled ?? 0,
      refunded: refundedSum ?? 0,
      dailySeries: dailyDates.map((date, i) => ({
        date,
        revenue: dailySeries[i] ?? 0,
      })),
      coveredFrom: houseDayOf(firstCheck, zone),
      // w109-gross-basis: Taken at a house whose till prices include tax.
      ...(totalsTaxNote ? { totalsTaxNote } : {}),
    };
  }
}

/**
 * First and last calendar day of a YYYY-MM month, or of a YYYY-Qn quarter
 * (F-1577), or null when it is neither.
 */
export function monthBounds(
  month: string,
): { first: string; last: string } | null {
  const q = /^(\d{4})-Q([1-4])$/.exec(month);
  if (q) {
    const firstMonth = (Number(q[2]) - 1) * 3 + 1;
    const first = monthBounds(`${q[1]}-${String(firstMonth).padStart(2, "0")}`);
    const last = monthBounds(
      `${q[1]}-${String(firstMonth + 2).padStart(2, "0")}`,
    );
    return first && last ? { first: first.first, last: last.last } : null;
  }
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const lastDay = new Date(
    Date.UTC(Number(m[1]), Number(m[2]), 0),
  ).getUTCDate();
  return {
    first: `${month}-01`,
    last: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** 1 (Monday) to 7 (Sunday) for a YYYY-MM-DD calendar day. */
function isoWeekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
}

/** True when `day` is a real YYYY-MM-DD calendar day that falls on a Monday. */
function isMonday(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day
    ? isoWeekday(day) === 1
    : false;
}

/** Inclusive count of calendar days from `from` to `to`, both YYYY-MM-DD. */
function spanOf(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1
  );
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

/**
 * A check's total, or null when it carries none (F-1444): `pos_checks.total`
 * is nullable and a missing total is not a $0 check. A real 0 stays 0.
 */
function checkTotal(c: { total?: unknown }): number | null {
  if (c.total == null || c.total === "") return null;
  const n = Number(c.total);
  return Number.isFinite(n) ? n : null;
}

/** Sales revenue for one restaurant over one closed day range. */
export interface PosRevenueWindow {
  restaurantId: string;
  /** Inclusive first HOUSE day of the window, YYYY-MM-DD; null when `zoneUnset`. */
  from: string | null;
  /** Inclusive last house day (the house's today), YYYY-MM-DD; null when `zoneUnset`. */
  to: string | null;
  days: number;
  /** The IANA zone the days are filed in (ADR 0296); null when `zoneUnset`. */
  timezone: string | null;
  /** True when the house has no zone: no day can be filed, so no figure is stated. */
  zoneUnset: boolean;
  /** False when this restaurant has never had a POS check. */
  posConnected: boolean;
  /** Sum of non-voided `pos_checks.total` that carry one (F-1444). `null` when `posConnected` is false, `zoneUnset`, or no check carries a total. */
  revenue: number | null;
  /** Non-voided checks filed in the window. `null` when `posConnected` is false or `zoneUnset`. */
  checkCount: number | null;
  /**
   * Of `checkCount`, the checks that carry no total (F-1444). They are left
   * out of `revenue`, and an average check divides by the rest. `null` when
   * `checkCount` is.
   */
  checksWithoutTotal?: number | null;
  /**
   * Of `checkCount`, the checks rung at 0, such as a comp or a staff meal
   * (F-1534). They add nothing to `revenue`, and an average check leaves them
   * out of its count. `null` when `checkCount` is.
   */
  checksTakingNoMoney?: number | null;
  /**
   * Of `checkCount`, the refunds the till sent as checks with a minus total
   * (F-1644). They are taken off `revenue`, and an average check leaves them
   * out of its count; `refunded` is the money they gave back, as a positive
   * sum, so the average can add it back. `null` when `checkCount` is.
   */
  checksRefunded?: number | null;
  refunded?: number | null;
  /** Sparse — only days that actually had revenue appear. */
  dailySeries: Array<{ date: string; revenue: number }>;
  /**
   * The house day of the first check the till ever sent (F-1662): the till is
   * connected from then on, so a day after it missing from `dailySeries` is a
   * day the house was shut. A reader judges whether the till covered a period
   * by this, never by counting days with sales. `null` when `posConnected` is
   * false or `zoneUnset`.
   */
  coveredFrom: string | null;
  /**
   * w109-gross-basis (ADR 0341): present only when the house says its till
   * prices include tax ("…include KDV"), or when that answer could not be
   * read. Absent for every other house, so their window is unchanged.
   */
  totalsTaxNote?: string;
}
