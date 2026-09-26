/**
 * Two years on, a name leaves the recommendation history; the act stays
 * (ADR 0191 round 4, answer 6 — one of the seven options the founder took
 * with "Take all seven", 2026-09-21).
 *
 * The rule itself lives in the database: migration 20260925120300's
 * `recommendation_action_history_forget_old_names()` removes every `actor_id`
 * acted on more than `recommendation_action_history_name_kept_for()` ago (two
 * calendar years), and the append-only trigger lets exactly that change, and
 * no other, through. This file only runs it every day and says what it did.
 *
 * ROUND 5 (the founder, 2026-09-22, "History + created_by"): the same two-
 * year rule, on the same daily run, now also clears
 * `recommendation_actions.created_by` — migration 20260925120500's
 * `recommendation_actions_forget_old_creators()`. `system_audit_log` keeps
 * its own retention: his words, "an audit trail that forgets who acted is no
 * longer an audit trail". Each RPC is its own call, its own try/catch and its
 * own count: one failing must never read as the other's answer, or as "ran
 * and removed nothing".
 *
 * ROUND 6 (the founder, 2026-09-22, "Clear them too (Recommended)"): asked
 * again now that `pinned_by`/`rated_by`/`assigned_by` exist (round 5's OTHER
 * answer introduced them, so round 5's "History + created_by" could not have
 * named them) — the SAME sweep, same function, same daily call, now ALSO
 * clears those three note-author columns (migration 20260925120600's
 * CREATE OR REPLACE of `recommendation_actions_forget_old_creators()`). No
 * code here changed: `forgetOldCreators()` still calls the one RPC named by
 * `FORGET_OLD_CREATORS_RPC`, which still returns one count — the SQL body it
 * runs now touches four columns instead of one. The note gate
 * (`item-state.ts` `mayTouchNote`) needed no change either — it already
 * reads a cleared author the same as one that was never recorded, proven at
 * `recommendation-round6.spec.ts` and `supabase/tests/20260925120600_..._
 * test.sql`.
 *
 * DAILY, not yearly: a name's two years end on its own date, so a sweep once
 * a year would keep some names nearly three years.
 *
 * WHAT `lastRun()` IS FOR. It is null until the first tick, never a made-up
 * "nothing to do" — the shape `RawMailRetentionCron` uses, for the same
 * reason: a surface that cannot tell "has not run" from "ran and removed
 * nothing" reports absence as health. Every count is logged even at zero.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";

/** 03:45 UTC every day — after the raw-mail sweep (03:30), before business. */
export const RECOMMENDATION_HISTORY_RETENTION_CRON = "45 3 * * *";

/** The SQL function that removes the names (migration 20260925120300). */
export const FORGET_OLD_NAMES_RPC = "recommendation_action_history_forget_old_names";

/**
 * The SQL function that clears `recommendation_actions.created_by`
 * (migration 20260925120500, round 5, answer 3) and, since round 6 (migration
 * 20260925120600, founder 2026-09-22: "Clear them too"), `pinned_by`,
 * `rated_by` and `assigned_by` too — one function, one call, unchanged name.
 */
export const FORGET_OLD_CREATORS_RPC = "recommendation_actions_forget_old_creators";

export interface HistoryRetentionTick {
  at: string;
  /** History names removed on this run; null when that call failed. */
  forgotten: number | null;
  /** The history call's failure, if it had one. */
  error: string | null;
  /**
   * `recommendation_actions` rows whose `created_by`, `pinned_by`,
   * `rated_by` and/or `assigned_by` were cleared on this run (round 5, round
   * 6); null when that call failed.
   */
  creatorsForgotten: number | null;
  /** The author-columns call's failure, if it had one — independent of `error`. */
  creatorsError: string | null;
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
   *
   * The `.rpc(FORGET_OLD_NAMES_RPC)` call stays literal here, not behind a
   * shared helper that takes the function name as a parameter: a guard
   * (`check_queried_tables_exist.py`) statically resolves which function a
   * call site names, and a call through a variable is invisible to it — it
   * flagged exactly that when this was first written as one shared call.
   * The parsing below IS shared (`parseCount`), because that half never
   * touches the database.
   */
  async forgetOldNames(): Promise<number> {
    const { data, error } = await this.dbService
      .getClient()
      .rpc(FORGET_OLD_NAMES_RPC);
    return this.parseCount(FORGET_OLD_NAMES_RPC, data, error);
  }

  /**
   * Clear `recommendation_actions.created_by` — and, since round 6,
   * `pinned_by`, `rated_by` and `assigned_by` too — on every row older than
   * two years (round 5, answer 3; round 6, "Clear them too"). Returns how
   * many rows it touched. A failed call throws, on the same contract as
   * `forgetOldNames`. Same reason its RPC call stays literal, not shared.
   */
  async forgetOldCreators(): Promise<number> {
    const { data, error } = await this.dbService
      .getClient()
      .rpc(FORGET_OLD_CREATORS_RPC);
    return this.parseCount(FORGET_OLD_CREATORS_RPC, data, error);
  }

  /** Both RPCs answer the same shape: a non-negative integer count, or an error. */
  private parseCount(
    fn: string,
    data: unknown,
    error: { message: string } | null,
  ): number {
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
      throw new Error(`${fn} answered ${JSON.stringify(data)}, not a count`);
    return n;
  }

  @Cron(RECOMMENDATION_HISTORY_RETENTION_CRON, {
    name: "recommendation-history-retention",
  })
  async sweep(): Promise<HistoryRetentionTick> {
    const at = new Date().toISOString();
    let forgotten: number | null = null;
    let error: string | null = null;
    try {
      forgotten = await this.forgetOldNames();
      this.logger.log(
        `recommendation history: removed ${forgotten} name${forgotten === 1 ? "" : "s"} older than two years; the acts are kept.`,
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.logger.error(`recommendation history retention failed — ${error}`);
    }
    // Round 5: its own call, its own try/catch — one failing must never read
    // as the other's answer, and neither stops the other from running.
    let creatorsForgotten: number | null = null;
    let creatorsError: string | null = null;
    try {
      creatorsForgotten = await this.forgetOldCreators();
      this.logger.log(
        `recommendation actions: cleared created_by on ${creatorsForgotten} row${creatorsForgotten === 1 ? "" : "s"} older than two years.`,
      );
    } catch (err) {
      creatorsError = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `recommendation_actions.created_by retention failed — ${creatorsError}`,
      );
    }
    this.last = { at, forgotten, error, creatorsForgotten, creatorsError };
    return this.last;
  }
}
