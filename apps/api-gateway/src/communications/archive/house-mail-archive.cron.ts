/**
 * The scheduled export (ADR 0118 D16).
 *
 * IT RUNS BEFORE THE SWEEP, AND THE GAP IS DELIBERATE. The retention sweep is
 * at 03:30 (`RETENTION_SWEEP_CRON`); this is at 03:10, twenty minutes ahead, so
 * a reply that reached its last day is written out before the sweep looks at
 * it. The sweep does not DEPEND on that ordering — it refuses to delete an
 * unexported reply whatever time it runs — but a house whose export ran after
 * its sweep would see its mail held for a day for no reason.
 *
 * A SCHEDULED RUN CARRIES NO SEAL, AND SAYS SO. A cron has no person behind it.
 * What it inherits is the seal a person spent to ARM the archive: choosing
 * `own_cloud` is the sealed act, and every scheduled run is that decision being
 * carried out. `house_mail_export_runs.seal_id` is NULL on these rows, which is
 * the true answer rather than a borrowed one.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { HouseMailArchiveService } from "./house-mail-archive.service";

/** Daily at 03:10 — twenty minutes ahead of the retention sweep's 03:30. */
export const ARCHIVE_EXPORT_CRON = "10 3 * * *";

@Injectable()
export class HouseMailArchiveCron {
  private readonly logger = new Logger(HouseMailArchiveCron.name);

  constructor(private readonly archive: HouseMailArchiveService) {}

  @Cron(ARCHIVE_EXPORT_CRON)
  async exportDue(): Promise<void> {
    await this.runAll();
  }

  /**
   * Exposed so a spec can drive it without a scheduler, and so an operator can
   * call it from a script. Returns what happened rather than logging only —
   * a caller that gets nothing back cannot tell a run that found nothing from a
   * run that did not happen.
   */
  async runAll(): Promise<{
    houses: number;
    exported: number;
    failed: number;
    errors: Array<{ restaurantId: string; message: string }>;
  }> {
    let houses: string[];
    try {
      houses = await this.archive.housesWithAnArchive();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `The archive export could not enumerate houses, so NO house was exported: ${message}`,
      );
      throw err;
    }

    let exported = 0;
    let failed = 0;
    const errors: Array<{ restaurantId: string; message: string }> = [];

    for (const restaurantId of houses) {
      try {
        const run = await this.archive.runExport({
          restaurantId,
          trigger: "scheduled",
          sealId: null,
        });
        exported += run.exported;
        failed += run.failed;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ restaurantId, message });
        this.logger.error(
          `The archive export for ${restaurantId} threw and its mail was NOT exported: ${message}`,
        );
      }
    }

    return { houses: houses.length, exported, failed, errors };
  }
}
