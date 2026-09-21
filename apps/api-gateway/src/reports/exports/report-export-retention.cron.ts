/**
 * The daily schedule behind the founder's report-export retention rule
 * (2026-09-17, ADR 0149 row 20's follow-up): an export older than
 * `EXPORT_RETENTION_DAYS` (90) is deleted, for every house alike.
 *
 * ONE CRON, NOT TWO. Unlike `raw-mail-retention.cron.ts`'s derive/sweep pair,
 * there is no per-house window to re-derive here — the founder's answer is a
 * flat 90 days for everyone, so the schedule is the sweep and nothing else.
 *
 * IDEMPOTENT AND SAFE FROM SEVERAL GATEWAY INSTANCES AT ONCE. The work is
 * `ReportExportsService.sweepExpired()` — a `DELETE ... WHERE requested_at <
 * cutoff`. A second run (this tick, a second instance, a redeploy that reruns
 * the day's job) finds only what the first left, which is nothing new to
 * delete; there is no row this sweep can act on twice.
 *
 * `lastRun()` IS NULL UNTIL THE FIRST TICK, never a fabricated "swept, found
 * nothing" — the same shape `RawMailRetentionCron.lastSweepRun()` uses, and
 * for the same reason: a surface that cannot tell "has not run" from "ran and
 * found nothing" reports absence as health.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ReportExportsService } from "./report-exports.service";

export const REPORT_EXPORT_RETENTION_CRON = "0 4 * * *";

export interface ReportExportRetentionTick {
  at: string;
  deleted: number;
  error: string | null;
}

@Injectable()
export class ReportExportRetentionCron {
  private readonly logger = new Logger(ReportExportRetentionCron.name);
  private lastRun: ReportExportRetentionTick | null = null;

  constructor(private readonly exports: ReportExportsService) {}

  lastSweepRun(): ReportExportRetentionTick | null {
    return this.lastRun;
  }

  @Cron(REPORT_EXPORT_RETENTION_CRON, { name: "report-export-retention-sweep" })
  async sweep(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const { deleted } = await this.exports.sweepExpired();
      this.lastRun = { at, deleted, error: null };
      // Logged even at zero: a sweep that only ever speaks when it deletes
      // something leaves a log in which the sweep only ever deletes.
      this.logger.log(
        `report export retention: swept, ${deleted} export${deleted === 1 ? "" : "s"} past 90 days deleted.`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.lastRun = { at, deleted: 0, error };
      this.logger.error(`report export retention: sweep failed — ${error}`);
    }
  }
}
