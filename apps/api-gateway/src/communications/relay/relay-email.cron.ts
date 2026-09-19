/**
 * The dispatcher for the person door's queued mail — the founder's 2026-09-17
 * answer that `sendAsPerson` queues rather than sends immediately, built.
 *
 * Same shape as `HouseLettersCron` (house-letters.cron.ts), for the same
 * reason stated there: a `setTimeout` in the request's process is a promise
 * the process cannot keep across a deploy, a crash, or a scale-in during the
 * undo window, and the page would show a row that says "queued" forever with
 * nothing behind it. The queue is a row (`relay_email_queue`) and this cron
 * reads rows, so the only thing a restart loses is a minute.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { RelayEmailService } from "./relay-email.service";

export interface RelayDispatchRun {
  at: string;
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
  /** A row whose own SENT/HOUSE_FAILED write failed after the provider call
   *  returned, so it is stuck HOUSE_SENDING and counted in neither `sent`
   *  nor `failed` — read this before trusting either count is complete. */
  statusUpdateErrors: number;
  /**
   * `null` means the run COMPLETED, so `considered: 0` is a real quiet minute.
   * A string means it did not — the queue could not be read, or the dispatcher
   * threw — and the counts beside it are zeros by default, not a measurement.
   * Read this before the counts. ADR 0161.
   */
  error: string | null;
}

@Injectable()
export class RelayEmailCron {
  private readonly logger = new Logger(RelayEmailCron.name);
  /** Null until the first run. Never a fabricated "never had anything to do". */
  private last: RelayDispatchRun | null = null;

  constructor(private readonly relay: RelayEmailService) {}

  lastRun(): RelayDispatchRun | null {
    return this.last;
  }

  @Cron("* * * * *", { name: "relay-email-dispatch" })
  async run(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const result = await this.relay.dispatchQueued();
      this.last = { at, error: null, ...result };
      if (result.sent > 0 || result.failed > 0 || result.statusUpdateErrors > 0) {
        this.logger.log(
          `relay queue: ${result.sent} sent, ${result.failed} failed, ${result.skipped} claimed elsewhere, ${result.statusUpdateErrors} stuck HOUSE_SENDING on a status-write failure.`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.last = {
        at,
        considered: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        statusUpdateErrors: 0,
        error,
      };
      this.logger.error(`relay queue dispatch failed: ${error}`);
    }
  }
}
