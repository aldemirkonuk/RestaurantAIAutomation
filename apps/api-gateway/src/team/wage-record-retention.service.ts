/**
 * The wage record's retention: kept five years after a person leaves the
 * roster, then deleted. ADR 0215.
 *
 * The founder, 2026-09-21, picked "Take all five" (the options he picked), one
 * of which was: a person's wage-change history is kept 5 years after they leave
 * the roster, then deleted. Five years is how long a wage claim can be brought;
 * after it, KVKK's "no longer than needed" applies.
 *
 * THE RULE LIVES IN THE DATABASE, NOT HERE. Migration 20260921170910 records
 * when each person with a wage record left (`team_member_departures`, stamped
 * by the database when their `team_members` row is removed), lets
 * `team_member_wage_changes` refuse any DELETE of a row whose five years have
 * not run, and gives `purge_expired_wage_records()` to delete the ones that
 * have. This job only calls it, once a night. A bug here can therefore fail to
 * delete, but it cannot delete early: the table refuses it.
 *
 * A failed run is logged as an error and reported as failed, never as "nothing
 * was due": an unreadable answer is not an empty one.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";

/** Once a night, at a quiet minute. */
export const WAGE_RETENTION_CRON = "23 3 * * *";
export const WAGE_RETENTION_JOB_NAME = "wage-record-retention";

export interface WageRetentionRun {
  ok: boolean;
  /** Change rows deleted because their five years had run. `null` when the run failed. */
  wageRowsDeleted: number | null;
  /** Departure records deleted once nothing of theirs was left. `null` when the run failed. */
  departuresDeleted: number | null;
  at: string;
  error?: string;
}

@Injectable()
export class WageRecordRetentionService {
  private readonly logger = new Logger(WageRecordRetentionService.name);

  constructor(private readonly db: DatabaseService) {}

  @Cron(WAGE_RETENTION_CRON, { name: WAGE_RETENTION_JOB_NAME })
  async scheduled(): Promise<void> {
    await this.purgeExpired();
  }

  /**
   * Delete every wage record whose person left the roster more than five years
   * ago. Counts only are logged: no person, no house, no figure (KVKK).
   */
  async purgeExpired(): Promise<WageRetentionRun> {
    const at = new Date().toISOString();
    try {
      const { data, error } = await this.db.supabase.rpc(
        "purge_expired_wage_records",
      );
      if (error) {
        this.logger.error(
          `${WAGE_RETENTION_JOB_NAME} failed: ${error.message}`,
        );
        return {
          ok: false,
          wageRowsDeleted: null,
          departuresDeleted: null,
          at,
          error: error.message,
        };
      }
      const row = Array.isArray(data) ? data[0] : data;
      // `Number(null)` is 0: a missing count must not read as "none deleted".
      const count = (v: unknown): number =>
        v == null || v === "" ? NaN : Number(v);
      const wageRowsDeleted = count(row?.wage_rows_deleted);
      const departuresDeleted = count(row?.departures_deleted);
      if (
        !Number.isInteger(wageRowsDeleted) ||
        wageRowsDeleted < 0 ||
        !Number.isInteger(departuresDeleted) ||
        departuresDeleted < 0
      ) {
        // An answer without its counts is not "0 deleted".
        const msg = "the purge answered without its counts";
        this.logger.error(`${WAGE_RETENTION_JOB_NAME} failed: ${msg}`);
        return {
          ok: false,
          wageRowsDeleted: null,
          departuresDeleted: null,
          at,
          error: msg,
        };
      }
      this.logger.log(
        `${WAGE_RETENTION_JOB_NAME}: ${wageRowsDeleted} wage change row(s) and ` +
          `${departuresDeleted} departure record(s) past five years deleted.`,
      );
      return { ok: true, wageRowsDeleted, departuresDeleted, at };
    } catch (err: any) {
      const msg = err?.message ?? "unknown";
      this.logger.error(`${WAGE_RETENTION_JOB_NAME} failed: ${msg}`);
      return {
        ok: false,
        wageRowsDeleted: null,
        departuresDeleted: null,
        at,
        error: msg,
      };
    }
  }
}
