/**
 * The dispatcher for house letters whose undo window has closed.
 *
 * WHY A CRON AND NOT A `setTimeout` AFTER THE POST
 * -----------------------------------------------
 * A timer in the request's process is a promise the process cannot keep: a
 * deploy, a crash or a scale-in during the two-minute window silently drops the
 * letter, and the page would show a row that says "queued" for ever with
 * nothing behind it. The queue is a row and the dispatcher reads rows, so the
 * only thing a restart loses is a minute.
 *
 * WHY THE UNDO WINDOW IS SERVER-SIDE AT ALL
 * -----------------------------------------
 * A client-side undo sends immediately and hides the fact for two minutes. The
 * letter is gone; the button is a lie. ADR 0083 forbids a page confirming a
 * write it has not had accepted, and this is the same rule pointed the other
 * way: a page may not offer to undo something that has already happened.
 *
 * WHAT IT DOES TODAY, MEASURED
 * ----------------------------
 * ~~Nothing, and it says so, because no `IntegrationDefinition` requests
 * `gmail.send`.~~ **STALE, corrected 2026-09-04.** That sentence stopped being
 * true the same day it was written: `gmail_send` was declared in
 * `integrations-oauth.constants.ts` (commit 9efef112), so a house one consent
 * away from a sender is no longer "no house". What is still true is the shape:
 * `HouseSenderService.resolve` returns `kind: "none"` for a house nobody has
 * consented for, nothing can be queued there, and this run has nothing to
 * consider. `lastRun` records that rather than leaving the surface to guess.
 * The correction is here rather than deleted because a comment that was wrong
 * for a day is worth knowing about — it is the reason the cron's own claim
 * about itself now names a commit instead of a line range.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { HouseLettersService } from "./house-letters.service";

export interface LetterDispatchRun {
  at: string;
  considered: number;
  sent: number;
  failed: number;
  skipped: number;
  error: string | null;
}

@Injectable()
export class HouseLettersCron {
  private readonly logger = new Logger(HouseLettersCron.name);
  /** Null until the first run. Never a fabricated "never had anything to do". */
  private last: LetterDispatchRun | null = null;

  constructor(private readonly letters: HouseLettersService) {}

  lastRun(): LetterDispatchRun | null {
    return this.last;
  }

  @Cron("* * * * *", { name: "house-letters-dispatch" })
  async run(): Promise<void> {
    const at = new Date().toISOString();
    try {
      const result = await this.letters.dispatchDue();
      this.last = { at, error: null, ...result };
      if (result.sent > 0 || result.failed > 0) {
        this.logger.log(
          `house letters: ${result.sent} sent, ${result.failed} failed, ${result.skipped} claimed elsewhere.`,
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
        error,
      };
      this.logger.error(`house letter dispatch failed: ${error}`);
    }
  }
}
