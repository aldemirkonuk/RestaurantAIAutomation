/**
 * Two years on, a name leaves the recommendation history; the act stays
 * (ADR 0191 round 4, answer 6 — one of the seven options the founder took
 * with "Take all seven", 2026-09-21).
 *
 * The rule itself lives in the database: migration 20260921171100's
 * `recommendation_action_history_forget_old_names()` removes every `actor_id`
 * acted on more than `recommendation_action_history_name_kept_for()` ago (two
 * calendar years), and the append-only trigger lets exactly that change, and
 * no other, through. This file only runs it every day and says what it did.
 *
 * DAILY, not yearly: a name's two years end on its own date, so a sweep once
 * a year would keep some names nearly three years.
 *
 * WHAT `lastRun()` IS FOR. It is null until the first tick, never a made-up
 * "nothing to do" — the shape `RawMailRetentionCron` uses, for the same
 * reason: a surface that cannot tell "has not run" from "ran and removed
 * nothing" reports absence as health. The count is logged even at zero.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";

/** 03:45 UTC every day — after the raw-mail sweep (03:30), before business. */
export const RECOMMENDATION_HISTORY_RETENTION_CRON = "45 3 * * *";

/** The SQL function that removes the names (migration 20260921171100). */
export const FORGET_OLD_NAMES_RPC = "recommendation_action_history_forget_old_names";

export interface HistoryRetentionTick {
  at: string;
  /** Names removed on this run; null when the run failed. */
  forgotten: number | null;
  error: string | null;
}

@Injectable()
export class RecommendationHistoryRetention {
  private readonly logger = new Logger(RecommendationHistoryRetention.name);
  private last: HistoryRetentionTick | null = null;

  constructor(private readonly dbService: DatabaseService) {}

  /** The last run, or null when none has run since the gateway started. */
  lastRun(): HistoryRetentionTick | null {
    return this.last;
  }

  /**
   * Remove every name older than two years. Returns how many went. A failed
   * call throws — "removed none" must never stand for "could not run".
   */
  async forgetOldNames(): Promise<number> {
    const { data, error } = await this.dbService
      .getClient()
      .rpc(FORGET_OLD_NAMES_RPC);
    if (error) throw new Error(error.message);
    // A number, or its digits: `Number(null)` is 0, and an empty answer must
    // never read as "removed none".
    const n =
      typeof data === "number"
        ? data
        : typeof data === "string" && /^\d+$/.test(data)
          ? Number(data)
          : NaN;
    if (!Number.isInteger(n) || n < 0)
      throw new Error(
        `${FORGET_OLD_NAMES_RPC} answered ${JSON.stringify(data)}, not a count`,
      );
    return n;
  }

  @Cron(RECOMMENDATION_HISTORY_RETENTION_CRON, {
    name: "recommendation-history-retention",
  })
  async sweep(): Promise<HistoryRetentionTick> {
    const at = new Date().toISOString();
    try {
      const forgotten = await this.forgetOldNames();
      this.last = { at, forgotten, error: null };
      this.logger.log(
        `recommendation history: removed ${forgotten} name${forgotten === 1 ? "" : "s"} older than two years; the acts are kept.`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.last = { at, forgotten: null, error };
      this.logger.error(`recommendation history retention failed — ${error}`);
    }
    return this.last as HistoryRetentionTick;
  }
}
