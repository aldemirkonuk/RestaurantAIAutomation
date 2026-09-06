/**
 * Arming a series: the one act that lets a rule interrupt people.
 *
 * THE FOUNDER'S ANSWER TO Q3, 2026-09-05, verbatim: *"a Mudavym admin arms one
 * series at a time (X-Admin-Key/ServiceKeyGuard, the ADR 0099 pattern the
 * experiment report uses), with the calibration's derived threshold SHOWN
 * before the act; the act is sealed and logged; the calibration job only
 * PROPOSES numbers and writes nothing to the series; nothing arms itself."*
 *
 * Every clause is a property of this file:
 *
 *   ONE AT A TIME       `arm` takes exactly one `seriesKey`. There is no
 *                       arm-all, and adding one would need a reviewer to look
 *                       at this sentence.
 *   SHOWN BEFORE        the write must carry back the `proposalHash` from a
 *                       proposal, and this service RECOMPUTES the proposal from
 *                       the series' own observations before comparing. An admin
 *                       who did not read the proposal cannot produce the hash,
 *                       and a threshold that moved since they read it will not
 *                       match. See `commodity-calibration.ts` for why this is
 *                       the seal's real property rather than a substitute for
 *                       it, and for the measured reason the tenant seal store
 *                       cannot hold an admin act.
 *   SEALED              challenge-and-redeem over the numbers, as above.
 *   LOGGED              `commodity_series_arming_log`, append-only, recording
 *                       the OFF direction as well — a log that held only arming
 *                       would make "never armed" and "armed then turned off"
 *                       render alike.
 *   ONLY PROPOSES       nothing in `commodity-calibration.ts` can write: it has
 *                       no database import at all.
 *   NOTHING ARMS ITSELF there is no cron, no scheduler and no code path that
 *                       calls `arm` other than the guarded route.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { SERIES, type SeriesEntry } from "./commodity.registry";
import {
  CADENCE_NOT_ON_OFFER,
  DEFAULT_BUDGET,
  hashProposal,
  isRefusal,
  proposeAllBudgets,
  proposeCalibration,
  type CalibrationOutcome,
  type CalibrationPoint,
} from "./commodity-calibration";

/** What an arming attempt did, and — when it did nothing — why. */
export interface ArmOutcome {
  armed: boolean;
  seriesKey: string;
  reason:
    | "armed"
    | "disarmed"
    | "unknown_series"
    | "not_registered"
    | "no_proposal"
    | "proposal_moved"
    | "may_not_be_published"
    | "write_failed"
    | "unreadable";
  /** Plain words. Every refusal carries one. */
  detail: string;
  /** The proposal as recomputed at write time, when there was one. */
  proposal: CalibrationOutcome | null;
}

@Injectable()
export class CommodityAdminService {
  private readonly logger = new Logger(CommodityAdminService.name);

  constructor(private readonly db: DatabaseService) {}

  /** The series' own admitted observations, ascending by period. */
  private async points(seriesId: string): Promise<CalibrationPoint[] | null> {
    try {
      const { data, error } = await this.db.client
        .from("commodity_index_observations")
        .select("period_start, value")
        .eq("series_id", seriesId)
        .order("period_start", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          periodStart: String(row.period_start).slice(0, 10),
          value: Number(row.value),
        };
      });
    } catch (err) {
      // Null, never an empty array. An unreadable history is not a short one,
      // and a short one refuses with `too_short_a_history`, which would be the
      // wrong sentence entirely.
      this.logger.warn(
        `observations unreadable while calibrating ${seriesId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async seriesRow(
    seriesKey: string,
  ): Promise<{ id: string; armed: boolean } | null | "unreadable"> {
    try {
      const { data, error } = await this.db.client
        .from("commodity_index_series")
        .select("id, series_key, armed")
        .eq("series_key", seriesKey)
        .maybeSingle();
      if (error) throw error;
      const row = data as Record<string, unknown> | null;
      return row ? { id: String(row.id), armed: row.armed === true } : null;
    } catch (err) {
      this.logger.warn(
        `commodity_index_series unreadable for ${seriesKey}: ${(err as Error).message}`,
      );
      return "unreadable";
    }
  }

  /**
   * Every budget's proposal for one series. THE THING THE ADMIN READS.
   *
   * Returns the entry's own terms beside the numbers, because the decision is
   * not only "how often" — a series whose publisher forbids republication may
   * never be armed at all, and that has to be visible on the same screen as the
   * threshold rather than discovered by a refusal afterwards.
   */
  async propose(seriesKey: string): Promise<{
    seriesKey: string;
    registered: boolean;
    entry: SeriesEntry | null;
    mayBeArmed: boolean;
    mayNotBeArmedBecause: string | null;
    observations: number | null;
    budgets: Array<{
      firesPerYear: number;
      isDefault: boolean;
      rationale: string;
      outcome: CalibrationOutcome;
    }> | null;
    /**
     * The budget the founder chose (twice a year, 2026-09-05 batch 59). Carried
     * on every answer, including the ones that propose nothing, so the screen
     * never has to infer the recommendation from the list.
     */
    defaultBudget: number;
    /**
     * Why weekly and fortnightly are not in the list. An option that was asked
     * for and is missing must be explained, or an absence reads as a choice.
     */
    cadenceNotOnOffer: string;
    note: string | null;
  }> {
    const entry = SERIES[seriesKey] ?? null;
    if (!entry) {
      return {
        seriesKey,
        registered: false,
        entry: null,
        mayBeArmed: false,
        mayNotBeArmedBecause: `"${seriesKey}" is not a series this register knows. Nothing is proposed rather than calibrating a key nobody declared.`,
        observations: null,
        budgets: null,
        defaultBudget: DEFAULT_BUDGET,
        cadenceNotOnOffer: CADENCE_NOT_ON_OFFER,
        note: null,
      };
    }

    const mayNotBeArmedBecause =
      entry.redistribution === "prohibited"
        ? "This series' publisher forbids third-party publication, and an alert IS publication. It may be held and read; it may never be armed."
        : entry.admission === "upload_only" && entry.withheld
          ? `This series is not fetched: ${entry.withheld.reason} Until somebody brings the file there is no history to calibrate.`
          : null;

    const row = await this.seriesRow(seriesKey);
    if (row === "unreadable") {
      return {
        seriesKey,
        registered: true,
        entry,
        mayBeArmed: false,
        mayNotBeArmedBecause,
        observations: null,
        budgets: null,
        defaultBudget: DEFAULT_BUDGET,
        cadenceNotOnOffer: CADENCE_NOT_ON_OFFER,
        note: "The series register could not be read, so no proposal was computed. This is unknown, not a series with no history.",
      };
    }
    if (!row) {
      return {
        seriesKey,
        registered: true,
        entry,
        mayBeArmed: mayNotBeArmedBecause === null,
        mayNotBeArmedBecause,
        observations: 0,
        budgets: null,
        defaultBudget: DEFAULT_BUDGET,
        cadenceNotOnOffer: CADENCE_NOT_ON_OFFER,
        note: "This series is declared in the registry and has no row in the register yet, so it has no history to calibrate. Nothing is claimed about where its threshold would fall.",
      };
    }

    const pts = await this.points(row.id);
    if (pts === null) {
      return {
        seriesKey,
        registered: true,
        entry,
        mayBeArmed: false,
        mayNotBeArmedBecause,
        observations: null,
        budgets: null,
        defaultBudget: DEFAULT_BUDGET,
        cadenceNotOnOffer: CADENCE_NOT_ON_OFFER,
        note: "This series' observations could not be read, so no proposal was computed. This is unknown, not an empty history.",
      };
    }

    return {
      seriesKey,
      registered: true,
      entry,
      mayBeArmed: mayNotBeArmedBecause === null,
      mayNotBeArmedBecause,
      observations: pts.length,
      budgets: proposeAllBudgets(seriesKey, entry.periodGrain, pts),
      defaultBudget: DEFAULT_BUDGET,
      cadenceNotOnOffer: CADENCE_NOT_ON_OFFER,
      note: null,
    };
  }

  /**
   * Arm ONE series, on numbers the admin was shown.
   *
   * `proposalHash` is required and is compared against a proposal recomputed
   * here, now. There is deliberately no override and no force flag: the whole
   * value of the hash is that it cannot be worked around by the person it is
   * meant to slow down.
   */
  async arm(params: {
    seriesKey: string;
    firesPerYear: number;
    proposalHash: string;
    actorLabel: string;
    note?: string | null;
  }): Promise<ArmOutcome> {
    const entry = SERIES[params.seriesKey] ?? null;
    if (!entry) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "unknown_series",
        detail: `"${params.seriesKey}" is not a series this register knows. Nothing was armed.`,
        proposal: null,
      };
    }
    if (entry.redistribution === "prohibited") {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "may_not_be_published",
        detail:
          "This series' publisher forbids third-party publication, and an alert is publication. It may be held and read; it may not be armed.",
        proposal: null,
      };
    }

    const row = await this.seriesRow(params.seriesKey);
    if (row === "unreadable") {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "unreadable",
        detail:
          "The series register could not be read, so nothing was armed and nothing is claimed about its current state.",
        proposal: null,
      };
    }
    if (!row) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "not_registered",
        detail:
          "This series has no row in the register yet, so there is nothing to arm. A series is written by a fetch or an upload before it can be armed.",
        proposal: null,
      };
    }

    const pts = await this.points(row.id);
    if (pts === null) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "unreadable",
        detail:
          "This series' observations could not be read, so the proposal could not be recomputed and nothing was armed.",
        proposal: null,
      };
    }

    // RECOMPUTED HERE, NOW. Not read back from a cache and not trusted from the
    // request: the point of the hash is that the numbers on the screen and the
    // numbers being written are the same numbers.
    const proposal = proposeCalibration(
      params.seriesKey,
      entry.periodGrain,
      pts,
      params.firesPerYear,
    );
    if (isRefusal(proposal)) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "no_proposal",
        detail: proposal.detail,
        proposal,
      };
    }

    const presented = (params.proposalHash ?? "").trim().toLowerCase();
    const expected = hashProposal(proposal);
    if (presented !== expected) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "proposal_moved",
        detail: presented
          ? "The numbers changed after they were shown, so nothing was armed. What was approved and what would be written have to be the same thing — read the proposal again and arm on the numbers you can see."
          : "Arming carries back the hash of the proposal that was shown. None was sent, so nothing was armed: a series may not be armed on numbers nobody read.",
        proposal,
      };
    }

    try {
      const { error } = await this.db.client
        .from("commodity_index_series")
        .update({
          rise_threshold: Number(proposal.riseThreshold.toFixed(4)),
          step_guard: Number(proposal.stepGuard.toFixed(4)),
          threshold_window_from: proposal.windowFrom,
          threshold_window_to: proposal.windowTo,
          threshold_window_n_obs: proposal.windowNObs,
          threshold_computed_at: new Date().toISOString(),
          armed: true,
          armed_by_label: params.actorLabel,
          armed_at: new Date().toISOString(),
          armed_proposal_hash: expected,
          armed_note: params.note ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) throw error;
    } catch (err) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "write_failed",
        detail: `The series was not armed: ${(err as Error).message}. Nothing is claimed about its current state.`,
        proposal,
      };
    }

    await this.log({
      seriesId: row.id,
      seriesKey: params.seriesKey,
      act: "armed",
      actorLabel: params.actorLabel,
      proposal,
      note: params.note ?? null,
    });

    return {
      armed: true,
      seriesKey: params.seriesKey,
      reason: "armed",
      detail: proposal.sentence,
      proposal,
    };
  }

  /**
   * Turn one series off.
   *
   * Deliberately NOT hash-gated. The hash exists to stop a series being armed
   * on numbers nobody read; disarming makes no claim and takes an interruption
   * away, and putting the same friction on the OFF direction is how a thing
   * that is firing wrongly stays on for another ten minutes.
   *
   * The thresholds are left on the row on purpose. Clearing them would destroy
   * the record of what it had been armed on, and `armed = false` already stops
   * every rule.
   */
  async disarm(params: {
    seriesKey: string;
    actorLabel: string;
    note?: string | null;
  }): Promise<ArmOutcome> {
    const row = await this.seriesRow(params.seriesKey);
    if (row === "unreadable") {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "unreadable",
        detail:
          "The series register could not be read, so nothing was disarmed and nothing is claimed about its current state.",
        proposal: null,
      };
    }
    if (!row) {
      return {
        armed: false,
        seriesKey: params.seriesKey,
        reason: "not_registered",
        detail:
          "This series has no row in the register, so there was nothing to disarm.",
        proposal: null,
      };
    }
    try {
      const { error } = await this.db.client
        .from("commodity_index_series")
        .update({ armed: false, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (error) throw error;
    } catch (err) {
      return {
        armed: row.armed,
        seriesKey: params.seriesKey,
        reason: "write_failed",
        detail: `The series was not disarmed: ${(err as Error).message}. It may still be armed.`,
        proposal: null,
      };
    }
    await this.log({
      seriesId: row.id,
      seriesKey: params.seriesKey,
      act: "disarmed",
      actorLabel: params.actorLabel,
      proposal: null,
      note: params.note ?? null,
    });
    return {
      armed: false,
      seriesKey: params.seriesKey,
      reason: "disarmed",
      detail:
        "This series is disarmed. Its derived thresholds are left on the row so the record of what it had been armed on survives; `armed = false` is what stops the rule.",
      proposal: null,
    };
  }

  /**
   * Append to the log.
   *
   * A failure here is logged and NOT swallowed into the caller's success: the
   * act happened, and saying so while admitting the log did not take it is the
   * honest report. Every key is written explicitly — no conditional spread.
   */
  private async log(params: {
    seriesId: string;
    seriesKey: string;
    act: "armed" | "disarmed";
    actorLabel: string;
    proposal: (CalibrationOutcome & { proposalHash?: string }) | null;
    note: string | null;
  }): Promise<void> {
    const p =
      params.proposal && !isRefusal(params.proposal) ? params.proposal : null;
    try {
      const { error } = await this.db.client
        .from("commodity_series_arming_log")
        .insert({
          series_id: params.seriesId,
          series_key: params.seriesKey,
          act: params.act,
          actor_label: params.actorLabel,
          acted_at: new Date().toISOString(),
          proposal_hash: p ? p.proposalHash : null,
          rise_threshold: p ? Number(p.riseThreshold.toFixed(4)) : null,
          step_guard: p ? Number(p.stepGuard.toFixed(4)) : null,
          fires_per_year: p ? p.firesPerYear : null,
          window_from: p ? p.windowFrom : null,
          window_to: p ? p.windowTo : null,
          window_n_obs: p ? p.windowNObs : null,
          note: params.note,
        });
      if (error) throw error;
    } catch (err) {
      this.logger.error(
        `${params.act} ${params.seriesKey} happened and was NOT logged: ${(err as Error).message}`,
      );
    }
  }

  /** What the log holds for one series, newest first. */
  async history(seriesKey: string): Promise<{
    seriesKey: string;
    acts: Array<Record<string, unknown>>;
    note: string | null;
  }> {
    try {
      const { data, error } = await this.db.client
        .from("commodity_series_arming_log")
        .select(
          "id, series_key, act, actor_label, acted_at, proposal_hash, rise_threshold, step_guard, fires_per_year, window_from, window_to, window_n_obs, note",
        )
        .eq("series_key", seriesKey)
        .order("acted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return {
        seriesKey,
        acts: (data ?? []) as Array<Record<string, unknown>>,
        note:
          (data ?? []).length === 0
            ? "Nothing has ever armed or disarmed this series. That is different from a series that was armed and turned off, which this log would show."
            : null,
      };
    } catch (err) {
      return {
        seriesKey,
        acts: [],
        note: `The arming log could not be read: ${(err as Error).message}. This is unknown, not "nothing has happened".`,
      };
    }
  }
}
