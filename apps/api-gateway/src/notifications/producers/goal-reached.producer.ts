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
import { readHouseMoney } from "../../common/house-money";
import {
  clockIn,
  count,
  dayIn,
  earliness,
  money,
  onShiftPhrase,
  percentFigure,
} from "./producer-copy";
import { ROSTER_SOURCE, rosterAt } from "./roster";
import { NO_GOAL_READER, goalReaders, noGoalReader } from "./goal-readers";
import { houseToday } from "../../common/house-day";

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
 * the metric. For a running total (wine revenue, bottles sold, purchasing
 * spend, checks), the last contributing row is the one that carried the total
 * across the target. When that read comes back empty or fails, `crossedAt` is
 * `null` and the sentence says "detected at" instead of inventing a moment.
 *
 * **Not every metric is a running total (F-629).** Average check and wine
 * attach rate are levels over the goal's window: one $120 check on night one
 * makes the average 120, and it falls back the next night. So they are judged
 * only once the window is whole — the deadline's house day has ended, and the
 * figure (counted to the deadline, `getGoalProgress`) can no longer move. A
 * level goal with no deadline has no whole window and is not reported. Days of
 * stock is a level read at an instant, not over a window: it is judged on the
 * shelf as it is now, up to the deadline. No single row carries a level across
 * its target, so neither gets a crossing time: the sentence says "detected at".
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
 *   number in the notification and the number on the page cannot disagree. That
 *   call writes nothing (F-264); the stored `analytics_goals.current_value` is
 *   refreshed by the hourly insight sweep, not by this producer.
 */

const PRODUCER = "goal_reached";

/** Averages over the goal's window: judged when the window is whole. */
const WINDOW_LEVELS = new Set(["avg_check", "wine_attach_rate"]);
/** A level read on the shelf now, with no window behind it. */
const INSTANT_LEVELS = new Set(["days_of_inventory"]);

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

    // The house's own money, for a goal counted in money (F-341). These lines
    // said `$` whatever the house sold in; `null` prints the figure bare. The
    // figure groups the house's way, not en-US (F-887).
    const { currency, locale } = await readHouseMoney(client, restaurantId);

    let ceilingGoals = 0;
    // The sentence carries the goal's figures, so only the people who may read
    // goals hear it (F-782). Read once, and only when something is to be said.
    let readers: ProducerAudience | null = null;
    let openLevels = 0;
    const today = houseToday(timeZone, now);

    for (const goal of goals) {
      if (goal.direction === "at_most") {
        ceilingGoals += 1;
        continue;
      }
      const metricKey = String(goal.metric_key);
      const deadlineDay = goal.deadline
        ? String(goal.deadline).slice(0, 10)
        : null;
      const level =
        WINDOW_LEVELS.has(metricKey) || INSTANT_LEVELS.has(metricKey);
      // An average is not reached while its window is still open; a stock
      // level read after the deadline says nothing about the deadline.
      if (
        WINDOW_LEVELS.has(metricKey) &&
        (deadlineDay === null || !(deadlineDay < today))
      ) {
        openLevels += 1;
        continue;
      }
      if (
        INSTANT_LEVELS.has(metricKey) &&
        deadlineDay !== null &&
        deadlineDay < today
      ) {
        openLevels += 1;
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

      const crossedAt = level
        ? null
        : await this.crossingInstant(restaurantId, metricKey);
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
        currency,
        locale,
        label,
        unit,
        current,
        target,
        eventAt,
        crossedAt,
        level,
        timeZone,
        early,
        roster,
      });

      await this.ledger.emit(
        {
          restaurantId,
          producer: PRODUCER,
          audience: (readers ??= await goalReaders(client, restaurantId, audience)),
          tally,
          now,
        },
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
                : level
                  ? "none — a level has no single row that carried it across the target"
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

    if (tally.emitted === 0 && tally.withheldReason === null && noGoalReader(readers)) {
      tally.withheldReason = NO_GOAL_READER;
    }
    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason =
        ceilingGoals > 0 && tally.considered === 0
          ? `${goals.length} active goal(s), of which ${ceilingGoals} are 'at most' ceilings this producer does not report on — crossing a ceiling is not a success. No 'at least' goal has reached its target.`
          : "No active goal has reached its target.";
      if (openLevels > 0)
        tally.withheldReason += ` ${openLevels} goal(s) on an average or a stock level are judged only over a whole window (an average once its deadline has passed, a stock level up to its deadline), and were not judged on this tick.`;
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

      // Every check-based running total — wine_revenue, checks — is summed
      // off `pos_checks` with `voided = false`
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
    currency: string | null;
    locale: string | null;
    label: string;
    unit: string;
    current: number;
    target: number;
    eventAt: Date;
    crossedAt: Date | null;
    level: boolean;
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
      level,
      timeZone,
      early,
      roster,
    } = input;

    const shown = (v: number) =>
      unit === "currency"
        ? money(v, input.currency, input.locale)
        : unit === "percent"
          ? percentFigure(v, input.locale)
          : count(v, input.locale);

    const parts: string[] = [];
    parts.push(
      `${label} stands at ${shown(current)} against a target of ${shown(target)}.`,
    );
    parts.push(
      crossedAt
        ? `Crossed ${dayIn(crossedAt, timeZone)} at ${clockIn(crossedAt, timeZone)}${
            early ? `, ${early.phrase}` : ""
          }.`
        : level
          ? `Read ${dayIn(eventAt, timeZone)} at ${clockIn(eventAt, timeZone)}; an average or a stock level has no single moment it crossed.`
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
