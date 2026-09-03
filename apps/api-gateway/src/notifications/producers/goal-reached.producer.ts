import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { GoalsService } from "../../analytics/goals.service";
import { ORDER_SPEND_STATUSES } from "../../procurement/order-status";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn, earliness, onShiftPhrase } from "./producer-copy";
import { ROSTER_SOURCE, rosterAt } from "./roster";

/**
 * "The goal was reached" — the success the house owns.
 *
 * THE FOUNDER'S SENTENCE, VERBATIM (p4d brief, 2026-09-03)
 * -------------------------------------------------------
 *   "the success we own, eg. when the goal is reached (take time of event, how
 *    early was it, who were at shift — meta descriptions)"
 *
 * Three facts, and each one costs something to get right:
 *
 * **The time of the event is NOT the time of the sweep.** A cron on a 15-minute
 * step learns about a crossing up to fifteen minutes after it happened, and a
 * reader inside quiet hours is served hours later still. Reporting either as
 * "when the goal was reached" would be a false timestamp on a permanent row. So
 * `crossedAt` is read from the SOURCE: the most recent row that contributed to
 * the metric. Because every supported metric is a cumulative sum over time, the
 * last contributing row is the one that carried the total across the target.
 * When that read comes back empty or fails, `crossedAt` is `null` and the
 * sentence says "detected at" instead of inventing a moment.
 *
 * **"How early" needs a deadline, and a goal may not have one.**
 * `analytics_goals.deadline` is nullable and `GoalsService.createGoal` writes
 * `input.deadline ?? null` (goals.service.ts:126). With no deadline there is
 * nothing to be early against, so the phrase is omitted rather than filled with
 * "on time".
 *
 * **"Who was at shift" had no query.** `ScheduleService` answers week questions
 * only; see `shift-window.ts` for the smallest read that answers the instant
 * question, and for why it says "on the schedule" rather than "on the floor".
 *
 * WHAT THIS PRODUCER DELIBERATELY DOES NOT DO
 * -------------------------------------------
 * - **`at_most` goals get no notification.** Crossing a ceiling — spending MORE
 *   than the purchasing budget — is not a success, and there is no honest way to
 *   phrase "reached" for it. The success case for a ceiling is "the period ended
 *   and the house stayed under", which needs the deadline to have passed and is
 *   a different producer. Counted and named in the run's `withheld_reason`.
 * - **It does not set `status = 'achieved'`.** That is a write into
 *   `analytics_goals`, which belongs to the analytics module and to whoever owns
 *   the goal's lifecycle. Filed in the page note §13 rather than taken.
 * - **It does not re-implement the metric.** Progress comes from
 *   `GoalsService.getGoalProgress`, the same call `/reports` renders, so the
 *   number in the notification and the number on the page cannot disagree. Note
 *   that call refreshes `analytics_goals.current_value` as a documented side
 *   effect (goals.service.ts:170-175); running it on a cron means that column is
 *   kept warm, which is a consequence worth knowing rather than a surprise.
 */

const PRODUCER = "goal_reached";

@Injectable()
export class GoalReachedProducer {
  private readonly logger = new Logger(GoalReachedProducer.name);

  static readonly PRODUCER = PRODUCER;

  /**
   * How many active goals one sweep will look at. A cap that silently truncates
   * is the disease, so the run row carries `truncated` and the read asks for one
   * more row than the cap to know.
   */
  static readonly CANDIDATE_CAP = 100;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly goals: GoalsService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const client = this.databaseService.getClient();

    const { data, error } = await client
      .from("analytics_goals")
      .select("id, name, metric_key, target_value, direction, deadline, status")
      .eq("restaurant_id", restaurantId)
      .eq("status", "active")
      .limit(GoalReachedProducer.CANDIDATE_CAP + 1);

    if (error) {
      // Throwing hands the tenant to `runPerTenant`, which logs
      // SCHEDULED_JOB_TENANT_FAILED and keeps every other tenant's run. An empty
      // array here would be a sweep that found "no goals".
      throw new Error(`could not read analytics_goals: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > GoalReachedProducer.CANDIDATE_CAP;
    const goals = tally.truncated
      ? rows.slice(0, GoalReachedProducer.CANDIDATE_CAP)
      : rows;

    if (goals.length === 0) {
      tally.withheldReason =
        "No active goal is set for this restaurant, so there is nothing that can be reached.";
      return tally;
    }

    let ceilingGoals = 0;

    for (const goal of goals) {
      if (goal.direction === "at_most") {
        ceilingGoals += 1;
        continue;
      }

      let progress: any;
      try {
        progress = await this.goals.getGoalProgress(restaurantId, goal.id);
      } catch (e: any) {
        tally.failed += 1;
        this.logger.warn(
          `GOAL_PROGRESS_UNREADABLE restaurant=${restaurantId} goal=${goal.id} — ` +
            `${e?.message}. This goal is neither reached nor not-reached on this tick.`,
        );
        continue;
      }

      const target = Number(progress?.target ?? goal.target_value) || 0;
      const current = Number(progress?.current ?? 0);
      if (!(target > 0) || !(current >= target)) continue;

      const crossedAt = await this.crossingInstant(
        restaurantId,
        String(goal.metric_key),
      );
      const eventAt = crossedAt ?? now;

      const deadline = goal.deadline ? new Date(goal.deadline) : null;
      const early = crossedAt ? earliness(crossedAt, deadline) : null;
      const roster = crossedAt
        ? await rosterAt(
            this.databaseService.getClient(),
            restaurantId,
            crossedAt,
            timeZone,
            this.logger,
          )
        : [];

      const label = String(progress?.metricLabel ?? goal.metric_key);
      const unit = String(progress?.unit ?? "count");
      const name = String(goal.name || "Untitled goal");

      const message = this.sentence({
        label,
        unit,
        current,
        target,
        eventAt,
        crossedAt,
        timeZone,
        early,
        roster,
      });

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally },
        {
          // The target is IN the key: raising a target after it was met makes a
          // new goal to reach, and the house should hear about that one too.
          // Lowering it below a value already passed re-fires once, which is the
          // same event by a different measure and is the honest reading.
          dedupeKey: `goal:${goal.id}:${target}`,
          occurredAt: eventAt,
          payload: {
            // Filed under the "Goals" register by `nt-format.ts:112`.
            type: "goal_reached",
            // No verb of approval. Linear's shape: the object and the state it
            // reached. https://linear.app/docs/project-notifications
            title: `${name} reached its target`,
            message,
            priority: "medium",
            actionUrl: "/reports",
            actionLabel: "Open the goal",
            metadata: {
              goalId: goal.id,
              metricKey: goal.metric_key,
              metricLabel: label,
              unit,
              target,
              current,
              direction: goal.direction ?? "at_least",
              deadline: goal.deadline ?? null,
              // Distinct on purpose: one is when it happened, one is when this
              // process noticed. A page that showed only the second would be
              // reporting our latency as the restaurant's history.
              crossedAt: crossedAt ? crossedAt.toISOString() : null,
              crossedAtSource: crossedAt
                ? "latest contributing source row"
                : "unknown — the source row carrying the crossing could not be read",
              detectedAt: now.toISOString(),
              earlyByDays: early ? early.days : null,
              earlinessPhrase: early ? early.phrase : null,
              onShift: roster,
              onShiftSource: ROSTER_SOURCE,
              timeZone,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason =
        ceilingGoals > 0 && tally.considered === 0
          ? `${goals.length} active goal(s), of which ${ceilingGoals} are 'at most' ceilings this producer does not report on — crossing a ceiling is not a success. No 'at least' goal has reached its target.`
          : "No active goal has reached its target.";
    }

    return tally;
  }

  /**
   * When the metric last moved — the instant the crossing actually happened.
   *
   * The three branches mirror `GoalsService.computeMetricWithSeries`
   * (goals.service.ts:307-410) table for table and filter for filter, so a
   * change there that this does not follow shows up as a wrong timestamp rather
   * than as silence. `null` means "could not be read", never "nothing happened":
   * the caller falls back to the sweep time and says which it used.
   */
  private async crossingInstant(
    restaurantId: string,
    metricKey: string,
  ): Promise<Date | null> {
    const client = this.databaseService.getClient();
    try {
      if (metricKey === "purchase_spend") {
        const { data, error } = await client
          .from("procurement_orders")
          .select("delivered_at")
          .eq("restaurant_id", restaurantId)
          .in("status", ORDER_SPEND_STATUSES)
          .not("delivered_at", "is", null)
          .order("delivered_at", { ascending: false })
          .limit(1);
        if (error) throw new Error(error.message);
        return this.firstInstant(data, ["delivered_at"]);
      }

      if (metricKey === "bottles_sold") {
        const { data, error } = await client
          .from("wine_consumption_log")
          .select("created_at")
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false })
          .limit(1);
        if (error) throw new Error(error.message);
        return this.firstInstant(data, ["created_at"]);
      }

      // Every check-based metric — wine_revenue, checks, avg_check,
      // wine_attach_rate — is summed off `pos_checks` with `voided = false`
      // (goals.service.ts:350-358). The bucket column is `closed_at || opened_at`
      // there, and the same preference is applied here.
      const { data, error } = await client
        .from("pos_checks")
        .select("closed_at, opened_at")
        .eq("restaurant_id", restaurantId)
        .eq("voided", false)
        .order("opened_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return this.firstInstant(data, ["closed_at", "opened_at"]);
    } catch (e: any) {
      this.logger.warn(
        `GOAL_CROSSING_INSTANT_UNREADABLE restaurant=${restaurantId} ` +
          `metric=${metricKey} — ${e?.message}. The notification will report the ` +
          "detection time and say the crossing time is unknown.",
      );
      return null;
    }
  }

  private firstInstant(data: any, columns: string[]): Date | null {
    const row = (data ?? [])[0];
    if (!row) return null;
    for (const col of columns) {
      const raw = row[col];
      if (!raw) continue;
      const d = new Date(raw);
      if (Number.isFinite(d.getTime())) return d;
    }
    return null;
  }

  /** The sentence of record. Facts, then the arithmetic, then the people. */
  private sentence(input: {
    label: string;
    unit: string;
    current: number;
    target: number;
    eventAt: Date;
    crossedAt: Date | null;
    timeZone: string;
    early: { days: number; phrase: string } | null;
    roster: Array<{ name: string | null; role: string | null }>;
  }): string {
    const {
      label,
      unit,
      current,
      target,
      eventAt,
      crossedAt,
      timeZone,
      early,
      roster,
    } = input;

    const shown = (v: number) =>
      unit === "currency"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(v)
        : unit === "percent"
          ? `${(v * 100).toFixed(1)}%`
          : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
              v,
            );

    const parts: string[] = [];
    parts.push(
      `${label} stands at ${shown(current)} against a target of ${shown(target)}.`,
    );
    parts.push(
      crossedAt
        ? `Crossed ${dayIn(crossedAt, timeZone)} at ${clockIn(crossedAt, timeZone)}${
            early ? `, ${early.phrase}` : ""
          }.`
        : `Detected ${dayIn(eventAt, timeZone)} at ${clockIn(eventAt, timeZone)}; the exact moment of the crossing could not be read from the source.`,
    );

    const named = roster.filter((p) => p.name) as Array<{
      name: string;
      role: string | null;
    }>;
    if (named.length) {
      parts.push(`On the schedule at that hour: ${onShiftPhrase(named)}.`);
    } else if (crossedAt) {
      parts.push("The schedule names nobody on shift at that hour.");
    }

    return parts.join(" ");
  }
}
