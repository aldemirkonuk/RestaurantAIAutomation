/**
 * The wage record's retention: kept five years after a person leaves the
 * roster, then deleted. ADR 0215.
 *
 * The founder, 2026-09-21, picked "Take all five" (the options he picked), one
 * of which was: a person's wage-change history is kept 5 years after they leave
 * the roster, then deleted. Five years is how long a wage claim can be brought;
 * after it, KVKK's "no longer than needed" applies.
 *
 * A person's SHIFTS AND LEAVE REQUESTS end the same way, on the same clock
 * (founder, 2026-09-22, round 6y, "Keep them 5 years (Recommended)", verbatim
 * in migration `20260925180200`): "removing a person must no longer delete
 * their shifts and leave requests straight away; they are kept and end with
 * the wage record (same five-year clock, same deletion job)." Before this,
 * `shifts.member_id` and `time_off_requests.member_id` were `ON DELETE
 * CASCADE` to `team_members`, so a removal deleted them in the same statement
 * the wage record's five-year clock started — the wage record then had no
 * hours or leave beside it to show what it priced (ADR 0215 residual (j)).
 *
 * THE RULE LIVES IN THE DATABASE, NOT HERE. Migration 20260925180110 records
 * when each person with a wage record, a shift or a leave request left
 * (`team_member_departures`, stamped by the database when their
 * `team_members` row is removed — broadened to shifts and leave by
 * `20260925180200`), lets `team_member_wage_changes` refuse any DELETE of a
 * row whose five years have not run, and gives `purge_expired_wage_records()`
 * to delete the ones that have. `purge_expired_shift_and_leave_records()`
 * (`20260925180200`) is the same rule for shifts and leave requests. This job
 * calls the shifts-and-leave purge FIRST, then the wage purge, once a night.
 * The order is about finishing, not safety: `purge_expired_wage_records()`
 * clears a departure only once its wage record, shifts AND leave are all
 * gone, so run first it would see shifts and leave the other purge has not
 * deleted yet and keep the departure — correctly, but for another night. Run
 * second, it clears that departure in the same run. Neither purge deletes a
 * row early: the wage table refuses a DELETE whose five years have not run,
 * and the shifts-and-leave purge selects only people whose departure is more
 * than `wage_record_retention()` old and who are not on the roster (shifts
 * and leave requests carry no guard of their own; the purge's clause is the
 * rule, held by the PGlite probe named in ADR 0215).
 *
 * CREDENTIALS, 2026-09-25 (founder round 4 item 19, "Credentials yes,
 * availability no"): `team_certifications` stopped cascading on a removal
 * (`20260925180210`), a departure is stamped for a person with a credential
 * too, and `purge_expired_credential_records()` is the same rule for them. It
 * runs FIRST of the three, for the same finishing reason: the wage purge's
 * departure cleanup now waits for credentials as well. Availability is not
 * kept (still ON DELETE CASCADE), so nothing here purges it.
 *
 * A failed run is logged as an error and reported as failed, never as "nothing
 * was due": an unreadable answer is not an empty one. The two purges are not
 * one transaction (two RPC calls): if the shifts-and-leave purge fails, the
 * wage purge is not called at all this run, so a partial run never reports
 * success.
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
  /** Shifts deleted on the same clock (ADR 0215, round 6y). `null` when the run failed. */
  shiftsDeleted: number | null;
  /** Leave requests deleted on the same clock (ADR 0215, round 6y). `null` when the run failed. */
  leaveRowsDeleted: number | null;
  /** Credentials deleted on the same clock (ADR 0215, round 4 2026-09-25). `null` when the run failed. */
  credentialsDeleted: number | null;
  /** Departure records deleted once nothing of theirs was left. `null` when the run failed. */
  departuresDeleted: number | null;
  at: string;
  error?: string;
}

/** A missing or blank count is not "0 deleted": `Number(null)` is 0. */
function readCount(v: unknown): number {
  return v == null || v === "" ? NaN : Number(v);
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
   * Delete every credential, shift, leave request and wage record whose person
   * left the roster more than five years ago — the credential purge and the
   * shifts-and-leave purge FIRST, then the wage purge (see the file header for why the order matters). Counts
   * only are logged: no person, no house, no figure (KVKK).
   */
  async purgeExpired(): Promise<WageRetentionRun> {
    const at = new Date().toISOString();
    const failed = (error: string): WageRetentionRun => {
      this.logger.error(`${WAGE_RETENTION_JOB_NAME} failed: ${error}`);
      return {
        ok: false,
        wageRowsDeleted: null,
        shiftsDeleted: null,
        leaveRowsDeleted: null,
        credentialsDeleted: null,
        departuresDeleted: null,
        at,
        error,
      };
    };
    try {
      // Credentials first (ADR 0215, founder 2026-09-25 round 4 item 19,
      // "Credentials yes, availability no"): the wage purge's departure
      // cleanup waits for them to be gone, so run before it.
      const { data: cData, error: cError } = await this.db.supabase.rpc(
        "purge_expired_credential_records",
      );
      if (cError) return failed(cError.message);
      const cRow = Array.isArray(cData) ? cData[0] : cData;
      const credentialsDeleted = readCount(cRow?.credentials_deleted);
      if (!Number.isInteger(credentialsDeleted) || credentialsDeleted < 0) {
        // An answer without its count is not "0 deleted", and nothing after
        // it runs this night.
        return failed("the credential purge answered without its count");
      }

      const { data: slData, error: slError } = await this.db.supabase.rpc(
        "purge_expired_shift_and_leave_records",
      );
      if (slError) return failed(slError.message);
      const slRow = Array.isArray(slData) ? slData[0] : slData;
      const shiftsDeleted = readCount(slRow?.shifts_deleted);
      const leaveRowsDeleted = readCount(slRow?.leave_rows_deleted);
      if (
        !Number.isInteger(shiftsDeleted) ||
        shiftsDeleted < 0 ||
        !Number.isInteger(leaveRowsDeleted) ||
        leaveRowsDeleted < 0
      ) {
        // An answer without its counts is not "0 deleted", and it stops here:
        // the wage purge is not called this run, so a partial answer never
        // reports success.
        return failed("the shifts-and-leave purge answered without its counts");
      }

      const { data, error } = await this.db.supabase.rpc(
        "purge_expired_wage_records",
      );
      if (error) return failed(error.message);
      const row = Array.isArray(data) ? data[0] : data;
      const wageRowsDeleted = readCount(row?.wage_rows_deleted);
      const departuresDeleted = readCount(row?.departures_deleted);
      if (
        !Number.isInteger(wageRowsDeleted) ||
        wageRowsDeleted < 0 ||
        !Number.isInteger(departuresDeleted) ||
        departuresDeleted < 0
      ) {
        // An answer without its counts is not "0 deleted".
        return failed("the wage purge answered without its counts");
      }
      this.logger.log(
        `${WAGE_RETENTION_JOB_NAME}: ${credentialsDeleted} credential(s), ${shiftsDeleted} shift(s), ` +
          `${leaveRowsDeleted} leave row(s), ${wageRowsDeleted} wage change row(s) and ${departuresDeleted} ` +
          `departure record(s) past five years deleted.`,
      );
      return {
        ok: true,
        wageRowsDeleted,
        shiftsDeleted,
        leaveRowsDeleted,
        credentialsDeleted,
        departuresDeleted,
        at,
      };
    } catch (err: any) {
      return failed(err?.message ?? "unknown");
    }
  }
}
