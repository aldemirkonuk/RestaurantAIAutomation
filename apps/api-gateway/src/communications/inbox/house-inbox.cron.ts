/**
 * The schedule that reads the house's own inbox (ADR 0118, receive half).
 *
 * WHY A CRON AND NOT A PUSH SUBSCRIPTION
 * -------------------------------------
 * The shared mailbox is push-driven: Gmail watches it and Pub/Sub POSTs to
 * `/communications/webhooks/gmail`. A per-house watch would be better here too —
 * lower latency and 2-unit `history.list` calls instead of 5-unit listings — and
 * it is deliberately not what this build does. `users.watch` needs a Pub/Sub
 * topic per grant with an IAM binding Gmail can publish to, a renewal before the
 * 7-day expiry, and a push endpoint that can tell which of many houses a
 * notification belongs to; and every one of those is a piece of Google Cloud
 * plumbing the founder has not been asked to buy. A poll is a smaller promise:
 * it needs no infrastructure, it cannot silently stop (the run record says when
 * it last ran), and its cost is stated in `HOUSE_INBOX_CRON`'s own arithmetic.
 * The upgrade is filed in `communications.md` §13 rather than pretended at.
 *
 * WHAT IT DOES WHEN NOBODY HAS CONSENTED
 * --------------------------------------
 * Nothing, and it says so. `readDue` enumerates live `gmail_read` grants; with
 * none, `grants: 0` and an empty `outcomes` list is the true answer, and it is
 * DIFFERENT from `error` being set — which is what a failed enumeration returns.
 * `lastRun()` is null until the first tick, never a fabricated "nothing to do".
 */

import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import {
  HOUSE_INBOX_CRON,
  HouseInboxService,
  type InboxReadRun,
} from "./house-inbox.service";

@Injectable()
export class HouseInboxCron {
  private readonly logger = new Logger(HouseInboxCron.name);
  /** Null until the first run. Never a fabricated "never had anything to do". */
  private last: InboxReadRun | null = null;

  constructor(private readonly inbox: HouseInboxService) {}

  lastRun(): InboxReadRun | null {
    return this.last;
  }

  @Cron(HOUSE_INBOX_CRON, { name: "house-inbox-read" })
  async run(): Promise<void> {
    const at = new Date().toISOString();
    try {
      this.last = await this.inbox.readDue();
      if (this.last.mirrored > 0 || this.last.discarded > 0) {
        this.logger.log(
          `house inbox: ${this.last.mirrored} vendor ${
            this.last.mirrored === 1 ? "reply" : "replies"
          } filed, ${this.last.discarded} discarded as not in the book, across ${
            this.last.grants
          } grant${this.last.grants === 1 ? "" : "s"}.`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.last = {
        at,
        grants: 0,
        mirrored: 0,
        discarded: 0,
        outcomes: [],
        error,
      };
      this.logger.error(`house inbox read failed: ${error}`);
    }
  }
}
