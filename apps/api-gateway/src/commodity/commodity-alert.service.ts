/**
 * The dark run of `commodity_exposure_rising`.
 *
 * THE FOUNDER'S CALL, 2026-09-05, verbatim: *"Both: the line now, the alert
 * behind a flag"*. So the context line ships to the screen and this — the
 * interruption — is built dark for one series and judged after a quarter.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT "DARK" MEANS HERE, PRECISELY
 * ─────────────────────────────────────────────────────────────────────────────
 * There is **no code path in this file that reaches a person**. It does not
 * import `NotificationsService`, it does not take a producer claim, it does not
 * write to `notifications`, and it does not send. What it does is evaluate the
 * rule and write ONE row per evaluation into `neural_footprint_event` — the
 * ledger this repository already uses to record "a decision-maker met this
 * stimulus and made this choice". The choice it records is the VERDICT,
 * including `would_notify`, which is the whole point: after a quarter somebody
 * can count how often it would have interrupted a house and decide whether that
 * was worth doing.
 *
 * `outcome` is written **NULL** on every row, and that is not laziness. NULL
 * means UNKNOWN in that table by its own migration's rule, and whether a fire
 * was RIGHT cannot be known here: it needs a numerator of confirmed invoice
 * rises, and `vendor_price_observations` and `price_history` each hold **0 rows
 * in production** (measured 2026-09-04). Writing `success` because the rule ran
 * would be the absence-reported-as-health fault in its purest form — a system
 * grading its own firing as its own accuracy.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO INDEPENDENT GATES, BOTH DEFAULT-OFF
 * ─────────────────────────────────────────────────────────────────────────────
 *   COMMODITY_ALERT_DARK   must be armed for this to run AT ALL. Allow-list
 *                          (`true` / `1`), so a typo leaves it off.
 *   series.armed           must be true on the row, and the migration's own
 *                          CHECK refuses `armed = true` on a series with no
 *                          derived threshold. A series cannot be armed into a
 *                          rule that could never fire.
 *
 * There is deliberately no third flag that would turn this into a real
 * notification. Reaching a person is phase 1's decision and it is blocked on
 * the plan's Q3 (shelf life), which `commodity-alert.ts` names in
 * `UNEVALUATED_CONDITIONS` and every row below carries.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { priceIndexFetchArmed } from "../price-index/staleness";
import { refuseStale } from "../price-index/staleness";
import { SERIES, type SeriesEntry } from "./commodity.registry";
import {
  OBSERVATIONS_PER_YEAR,
  UNEVALUATED_CONDITIONS,
  decideCommoditySignal,
  type CommoditySignalDecision,
  type ExposureFact,
} from "./commodity-alert";

/** Only `"true"` and `"1"` arm the dark run. Off is the safe typo. */
export const COMMODITY_ALERT_DARK_FLAG = "COMMODITY_ALERT_DARK";

export function commodityAlertDark(raw?: string | null): boolean {
  // The same allow-list parser the fetch flag uses, imported rather than
  // re-spelled: two copies of "which strings mean on" is two answers.
  return priceIndexFetchArmed(raw);
}

/** What one dark sweep did, in words a report line can print without a count. */
export interface DarkRunTally {
  armed: boolean;
  /** Why nothing ran, when nothing ran. Never an empty result with no reason. */
  withheldReason: string | null;
  evaluated: number;
  wouldHaveNotified: number;
  /** Every verdict, by name. A refusal that was not counted did not happen. */
  byVerdict: Record<string, number>;
  /** Rows written to the footprint ledger. Never a notification. */
  recorded: number;
  failed: number;
}

@Injectable()
export class CommodityAlertService {
  private readonly logger = new Logger(CommodityAlertService.name);

  constructor(private readonly db: DatabaseService) {}

  armed(): boolean {
    return commodityAlertDark(process.env[COMMODITY_ALERT_DARK_FLAG]);
  }

  /**
   * What the status route may say WITHOUT having run anything.
   *
   * Deliberately not `reportLine` over a zeroed tally: that would read "0
   * series evaluated, 0 would have interrupted this house", which is a
   * sentence about a run that never happened. A status that describes an
   * imaginary run is the absence-reported-as-health shape in the one place
   * somebody goes to ask whether this thing is on.
   */
  standingNote(): string {
    return this.armed()
      ? `The commodity alert is armed DARK (${COMMODITY_ALERT_DARK_FLAG}). It records verdicts to the footprint ledger and has no code path to a person: this module imports no notifications service. No run is described here — this says only that it is on.`
      : `The commodity alert is not armed (${COMMODITY_ALERT_DARK_FLAG} is off). Nothing is evaluated, so nothing is claimed either way. Even armed it reaches nobody: it records verdicts and never sends.`;
  }

  /**
   * Evaluate the rule for one house, dark.
   *
   * Returns a tally whose `withheldReason` is filled on EVERY legitimate no-op.
   * A sweep that evaluated nothing and said nothing is indistinguishable from a
   * sweep that never ran, which is the shape this whole register exists to stop.
   */
  async runDark(restaurantId: string | null): Promise<DarkRunTally> {
    const tally: DarkRunTally = {
      armed: this.armed(),
      withheldReason: null,
      evaluated: 0,
      wouldHaveNotified: 0,
      byVerdict: {},
      recorded: 0,
      failed: 0,
    };

    if (!tally.armed) {
      tally.withheldReason = `${COMMODITY_ALERT_DARK_FLAG} is not armed, so the rule was not evaluated. Nothing was written and nothing was suppressed.`;
      return tally;
    }
    if (!restaurantId) {
      tally.withheldReason =
        "No house was named, and this rule is evaluated per house because the exposure mapping is per house.";
      return tally;
    }

    let armedRows: Array<Record<string, unknown>>;
    try {
      const { data, error } = await this.db.client
        .from("commodity_index_series")
        .select(
          "id, series_key, redistribution, rise_threshold, step_guard, armed, max_age_days",
        )
        .eq("armed", true);
      if (error) throw error;
      armedRows = (data ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      // A failed read is never an empty one.
      tally.failed += 1;
      tally.withheldReason = `The series register could not be read, so no series was evaluated. This is unknown, not "no series is armed": ${(err as Error).message}`;
      return tally;
    }

    if (armedRows.length === 0) {
      tally.withheldReason =
        "No series in the register is armed for alerting. A series can only be armed once a threshold has been derived from its own history, and none has been.";
      return tally;
    }

    for (const row of armedRows) {
      const key = String(row.series_key);
      const entry = SERIES[key];
      if (!entry) {
        tally.failed += 1;
        this.logger.warn(
          `series ${key} is armed in the register and is not in the registry; skipped rather than guessed`,
        );
        continue;
      }
      const decision = await this.evaluateOne(
        entry,
        row,
        restaurantId,
        tally,
      );
      if (!decision) continue;
      tally.evaluated += 1;
      tally.byVerdict[decision.verdict] =
        (tally.byVerdict[decision.verdict] ?? 0) + 1;
      if (decision.verdict === "would_notify") tally.wouldHaveNotified += 1;
      const ok = await this.record(entry, restaurantId, decision);
      if (ok) tally.recorded += 1;
      else tally.failed += 1;
    }

    return tally;
  }

  /** One series, one house. Reads the history, counts exposures, decides. */
  private async evaluateOne(
    entry: SeriesEntry,
    row: Record<string, unknown>,
    restaurantId: string,
    tally: DarkRunTally,
  ): Promise<CommoditySignalDecision | null> {
    const seriesId = String(row.id);
    let values: number[] = [];
    let newestPeriod: string | null = null;
    try {
      const { data, error } = await this.db.client
        .from("commodity_index_observations")
        .select("period_start, value")
        .eq("series_id", seriesId)
        .order("period_start", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      values = rows.map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
      newestPeriod =
        rows.length > 0
          ? String(rows[rows.length - 1].period_start).slice(0, 10)
          : null;
    } catch (err) {
      tally.failed += 1;
      this.logger.warn(
        `observations unreadable for ${entry.seriesKey}; no verdict recorded rather than a verdict on no data: ${(err as Error).message}`,
      );
      return null;
    }

    // The exposures themselves, not a count: condition 8 is a fact about the
    // ITEMS (does this house's item keep long enough to be worth stocking up
    // on?) and a count cannot carry one. The shelf life is joined from
    // `restaurant_inventory`, where a PERSON typed it or it is null.
    let exposures: ExposureFact[];
    try {
      const { data, error } = await this.db.client
        .from("house_item_commodity_exposure")
        .select("id, house_item_id, lag_days")
        .eq("restaurant_id", restaurantId)
        .eq("series_id", seriesId)
        .is("retired_at", null);
      if (error) throw error;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const itemIds = rows.map((r) => String(r.house_item_id));
      let shelfLives = new Map<string, number | null>();
      if (itemIds.length > 0) {
        const { data: items, error: itemError } = await this.db.client
          .from("restaurant_inventory")
          .select("id, shelf_life_days")
          .in("id", itemIds);
        if (itemError) throw itemError;
        shelfLives = new Map(
          ((items ?? []) as Array<Record<string, unknown>>).map((i) => [
            String(i.id),
            i.shelf_life_days === null || i.shelf_life_days === undefined
              ? null
              : Number(i.shelf_life_days),
          ]),
        );
      }
      exposures = rows.map((r) => ({
        // An item this read could not find is NOT an item with no shelf life
        // typed -- but both land on `null` here, and the verdict that follows
        // says "nobody has typed one", which would be the wrong sentence. So a
        // missing item is treated as unreadable rather than as untyped.
        shelfLifeDays: shelfLives.has(String(r.house_item_id))
          ? (shelfLives.get(String(r.house_item_id)) ?? null)
          : null,
        lagDays: r.lag_days === null || r.lag_days === undefined ? null : Number(r.lag_days),
      }));
    } catch (err) {
      // Unreadable is NOT zero, and zero here would produce `no_exposure_mapped`,
      // which reads as a fact about the house.
      tally.failed += 1;
      this.logger.warn(
        `exposures unreadable for ${entry.seriesKey}; no verdict recorded: ${(err as Error).message}`,
      );
      return null;
    }

    const maxAge =
      typeof row.max_age_days === "number" ? row.max_age_days : entry.maxAgeDays;
    const stale = newestPeriod
      ? refuseStale(newestPeriod, maxAge, new Date())
      : { stale: true, ageDays: null, reason: "This series holds no observation at all." };

    return decideCommoditySignal({
      values,
      riseThreshold:
        row.rise_threshold === null || row.rise_threshold === undefined
          ? null
          : Number(row.rise_threshold),
      stepGuard:
        row.step_guard === null || row.step_guard === undefined
          ? null
          : Number(row.step_guard),
      redistribution: String(row.redistribution ?? entry.redistribution),
      fresh: !stale.stale,
      staleReason: stale.reason,
      exposures,
      // Never said, because nothing in this file ever says anything. The quiet
      // window is a phase-1 column and pretending to consult one here would
      // record a condition that was not evaluated as one that passed.
      daysSinceLastSaid: null,
    });
  }

  /**
   * One row in the footprint ledger. Never a notification.
   *
   * `subject_type: 'agent'` and `subject_id` = the rule's key, because the
   * decision-maker being recorded is the RULE, not the operator: nobody saw
   * this and nobody acted on it.
   */
  private async record(
    entry: SeriesEntry,
    restaurantId: string,
    decision: CommoditySignalDecision,
  ): Promise<boolean> {
    try {
      const { error } = await this.db.client
        .from("neural_footprint_event")
        .insert({
          subject_type: "agent",
          subject_id: "commodity_exposure_rising",
          stimulus: `commodity_index_series:${entry.seriesKey}`,
          choice: decision.verdict,
          // NULL means UNKNOWN in this table by its own rule. Whether a fire
          // was right needs a numerator of confirmed invoice rises, and
          // vendor_price_observations and price_history each hold 0 rows in
          // production. A system may not grade its own firing as its accuracy.
          outcome: null,
          context: {
            surface: "commodity:dark",
            series_key: entry.seriesKey,
            issuer: entry.issuer,
            unit: entry.unit,
            base_period: entry.basePeriod,
            value_kind: entry.valueKind,
            redistribution: entry.redistribution,
            // The dark contract, on every row, so a later reader cannot mistake
            // these for notifications that were sent.
            dark: true,
            reached_a_person: false,
            flag: COMMODITY_ALERT_DARK_FLAG,
          },
          internal_state: {
            reason: decision.reason,
            move: decision.move,
            baseline: decision.baseline,
            latest: decision.latest,
            step: decision.step,
            // The plan's conditions this evaluation could not reach, carried on
            // every row rather than mentioned in a comment. A row whose
            // `unevaluated` is non-empty is a row that may never become a
            // person's notification.
            unevaluated: decision.unevaluated,
            observations_per_year:
              OBSERVATIONS_PER_YEAR[entry.periodGrain] ?? null,
          },
          restaurant_id: restaurantId,
        });
      if (error) throw error;
      return true;
    } catch (err) {
      this.logger.warn(
        `dark commodity verdict for ${entry.seriesKey} could not be recorded: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * The report line: what the dark rule WOULD have said, counted.
   *
   * Deliberately a sentence rather than a number, and it names the unevaluated
   * conditions every time. A dashboard tile reading "3" would be a claim that
   * three houses should have been interrupted; this is a claim that a rule
   * nobody has judged reached that verdict three times with two of its nine
   * conditions unevaluated.
   */
  reportLine(tally: DarkRunTally): string {
    if (!tally.armed) {
      return `The commodity alert is not armed (${COMMODITY_ALERT_DARK_FLAG} is off). Nothing was evaluated, so nothing is claimed either way.`;
    }
    if (tally.withheldReason) return tally.withheldReason;
    const verdicts = Object.entries(tally.byVerdict)
      .map(([v, n]) => `${v} ${n}`)
      .join(", ");
    return (
      `Dark run: ${tally.evaluated} series evaluated, ${tally.wouldHaveNotified} would have interrupted this house, ${tally.recorded} recorded in the footprint ledger and none sent to anybody. ` +
      `Verdicts: ${verdicts || "none"}. ` +
      `${UNEVALUATED_CONDITIONS.length} of the rule's nine conditions ${UNEVALUATED_CONDITIONS.length === 1 ? "was" : "were"} NOT evaluated: ${UNEVALUATED_CONDITIONS.join("; ")}. ` +
      `Whether any of these would have been right is not knowable yet and is not claimed.`
    );
  }
}
