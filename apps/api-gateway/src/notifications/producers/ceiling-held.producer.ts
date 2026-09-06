import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { GoalsService } from "../../analytics/goals.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn, onShiftPhrase, percent } from "./producer-copy";
import { ROSTER_SOURCE, rosterAt } from "./roster";
import { localMidnight, shiftLocalDate } from "./service-day";

/**
 * "The period closed and the house stayed under its ceiling."
 *
 * WHY THIS IS A SECOND PRODUCER AND NOT A BRANCH OF THE FIRST
 * ----------------------------------------------------------
 * `GoalReachedProducer` reports a CROSSING: a cumulative measure passes a floor
 * and the moment it happened is a real instant with real people on shift. A
 * ceiling has no such moment. Crossing an `at_most` target is a FAILURE, and the
 * success — staying under — is not an event at all until the period runs out.
 * The two therefore differ in every part that matters: the trigger (a value vs a
 * clock), the timing (the instant of the crossing vs the close of the period),
 * the dedupe key (`goal:<id>:<target>` vs `goal:<id>:<periodEnd>`) and the
 * arithmetic (how far past vs how far under). One class with an `if` would have
 * had two of everything inside it anyway.
 *
 * The founder asked for this one by name on 2026-09-03, after the first pass
 * reported ceilings as "not a success this producer reports on".
 *
 * WHEN THE PERIOD ACTUALLY CLOSES
 * -------------------------------
 * `analytics_goals.deadline` is a DATE, not a timestamp, so it names a day and
 * not an instant — and a day is only an instant once you say whose wall it is.
 * This says the restaurant's, from `ScheduledTenant.timezone`: the period closes
 * at local midnight ENDING the deadline day, i.e. `localMidnight(deadline + 1)`.
 * A goal with a 30 September deadline is therefore judged at 00:00 on
 * 1 October in the house's own zone, not at 00:00 UTC and not at noon.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - **It does not report a ceiling that was BREACHED.** "You went over by N" is
 *   a different notification with a different reader and a different urgency,
 *   and nobody has asked for it; the breach is counted and named in the run
 *   row's `withheld_reason` so it is visible rather than silently dropped, and
 *   filed in the page note §13.
 * - **It does not close the goal.** `analytics_goals.status` stays `active`;
 *   that write belongs to whoever owns the goal's lifecycle (§13.25 d).
 * - **It does not re-derive the measure.** `GoalsService.getGoalProgress` is the
 *   same call `/reports` renders, so the number in the notification and the
 *   number on the page cannot disagree.
 */

const PRODUCER = "ceiling_held";

@Injectable()
export class CeilingHeldProducer {
  private readonly logger = new Logger(CeilingHeldProducer.name);

  static readonly PRODUCER = PRODUCER;

  /**
   * How long after a period closes this producer will still report it.
   *
   * Fourteen days. Long enough that arming the producer, or a multi-day outage,
   * does not lose a month's result; short enough that the first armed sweep does
   * not replay a year of closed periods into the inbox. The claim ledger makes a
   * re-read free, so this is a noise bound, not a correctness one.
   */
  static readonly LOOKBACK_DAYS = 14;

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
      .eq("direction", "at_most")
      .not("deadline", "is", null)
      .limit(CeilingHeldProducer.CANDIDATE_CAP + 1);

    if (error) {
      // Throwing hands the tenant to `runPerTenant`, which logs
      // SCHEDULED_JOB_TENANT_FAILED and keeps every other tenant's run. An empty
      // array here would be a sweep that found "no ceilings".
      throw new Error(`could not read analytics_goals: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > CeilingHeldProducer.CANDIDATE_CAP;
    const goals = tally.truncated
      ? rows.slice(0, CeilingHeldProducer.CANDIDATE_CAP)
      : rows;

    if (goals.length === 0) {
      tally.withheldReason =
        "No active 'at most' goal with a deadline is set for this restaurant, so no period can close under a ceiling.";
      return tally;
    }

    let stillOpen = 0;
    let tooOld = 0;
    let breached = 0;

    for (const goal of goals) {
      const periodEnd = String(goal.deadline).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
        tally.failed += 1;
        this.logger.warn(
          `CEILING_DEADLINE_UNREADABLE restaurant=${restaurantId} goal=${goal.id} — ` +
            `deadline ${JSON.stringify(goal.deadline)} is not a date; skipped rather than guessed.`,
        );
        continue;
      }

      // Local midnight ENDING the deadline day, on the house's own clock.
      const closedAt = localMidnight(shiftLocalDate(periodEnd, 1), timeZone);

      if (now.getTime() < closedAt.getTime()) {
        stillOpen += 1;
        continue;
      }
      if (
        now.getTime() - closedAt.getTime() >
        CeilingHeldProducer.LOOKBACK_DAYS * 86_400_000
      ) {
        tooOld += 1;
        continue;
      }

      let progress: any;
      try {
        progress = await this.goals.getGoalProgress(restaurantId, goal.id);
      } catch (e: any) {
        tally.failed += 1;
        this.logger.warn(
          `CEILING_PROGRESS_UNREADABLE restaurant=${restaurantId} goal=${goal.id} — ` +
            `${e?.message}. This period is neither held nor breached on this tick.`,
        );
        continue;
      }

      const target = Number(progress?.target ?? goal.target_value) || 0;
      const current = Number(progress?.current ?? 0);
      if (!(target > 0)) {
        tally.failed += 1;
        continue;
      }
      if (current > target) {
        // Went over. Not a success, and "you went over by N" is a different
        // notification nobody has asked for. Named, not dropped.
        breached += 1;
        continue;
      }

      const headroom = target - current;
      const headroomFraction = headroom / target;
      const roster = await rosterAt(
        client,
        restaurantId,
        closedAt,
        timeZone,
        this.logger,
      );

      const label = String(progress?.metricLabel ?? goal.metric_key);
      const unit = String(progress?.unit ?? "count");
      const name = String(goal.name || "Untitled goal");

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally, now },
        {
          // The period end, not the target: a ceiling that is reset for the next
          // month is a new period and gets its own line, while re-reading the
          // same closed period never does.
          dedupeKey: `goal:${goal.id}:${periodEnd}`,
          occurredAt: closedAt,
          payload: {
            // The register `nt-format.ts:112` already files under "Goals". A
            // distinct `goal_held` type would read better and is filed in §13;
            // inventing one today would drop this row into "Other".
            type: "goal_reached",
            title: `${name} stayed under its ceiling`,
            message: this.sentence({
              label,
              unit,
              current,
              target,
              headroom,
              headroomFraction,
              closedAt,
              timeZone,
              roster,
            }),
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
              direction: "at_most",
              deadline: goal.deadline ?? null,
              // The ceiling's analogue of `crossedAt`: the instant the period
              // closed, on the house's clock. Distinct from `detectedAt`, which
              // is when this process noticed.
              periodEndedAt: closedAt.toISOString(),
              periodEndSource:
                "local midnight ending analytics_goals.deadline, in the restaurant's timezone",
              detectedAt: now.toISOString(),
              headroom,
              headroomFraction,
              onShift: roster,
              onShiftSource: ROSTER_SOURCE,
              timeZone,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      const bits = [`${goals.length} ceiling goal(s) with a deadline`];
      if (stillOpen > 0) bits.push(`${stillOpen} whose period has not closed yet`);
      if (breached > 0) {
        bits.push(
          `${breached} that closed OVER the ceiling — this producer reports the success only, and "you went over by N" is a notification nobody has asked for yet`,
        );
      }
      if (tooOld > 0) {
        bits.push(
          `${tooOld} that closed more than ${CeilingHeldProducer.LOOKBACK_DAYS} days ago, outside this sweep's window`,
        );
      }
      if (tally.alreadyClaimed > 0) {
        bits.push(`${tally.alreadyClaimed} already reported`);
      }
      tally.withheldReason = `${bits.join("; ")}.`;
    }

    return tally;
  }

  /** The sentence of record: the fact, then the arithmetic, then the people. */
  private sentence(input: {
    label: string;
    unit: string;
    current: number;
    target: number;
    headroom: number;
    headroomFraction: number;
    closedAt: Date;
    timeZone: string;
    roster: Array<{ name: string | null; role: string | null }>;
  }): string {
    const shown = (v: number) =>
      input.unit === "currency"
        ? new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: "USD",
            maximumFractionDigits: 2,
          }).format(v)
        : input.unit === "percent"
          ? `${(v * 100).toFixed(1)}%`
          : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
              v,
            );

    const parts: string[] = [];
    parts.push(
      `The period closed ${dayIn(input.closedAt, input.timeZone)} at ${clockIn(input.closedAt, input.timeZone)} and the house stayed under by ${shown(input.headroom)}.`,
    );
    parts.push(
      `${input.label} finished at ${shown(input.current)} against a ceiling of ${shown(input.target)} — ${percent(input.headroomFraction)} of it unused.`,
    );

    const named = input.roster.filter((p) => p.name) as Array<{
      name: string;
      role: string | null;
    }>;
    if (named.length) {
      parts.push(`On the schedule at that hour: ${onShiftPhrase(named)}.`);
    } else {
      parts.push("The schedule names nobody on shift at that hour.");
    }

    return parts.join(" ");
  }
}
