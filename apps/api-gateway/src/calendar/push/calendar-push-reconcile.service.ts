import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { CalendarPushService } from "./calendar-push.service";

/**
 * The sweep that makes "one write per mutation" survivable.
 *
 * ADR 0111 §5 direction 1 buys its cheapness by having no sync token and no
 * webhook: one write, at the moment of the change, and that is all. The
 * consequence is that ANY missed write is missed permanently — a restart
 * mid-push, a rate limit, an expired token, a house connected after its entries
 * were already made. None of those leaves a mark anywhere a person would look.
 *
 * So the sweep exists to answer one question per house, out loud, every hour:
 * how many of this house's entries have a copy in Google, and how many are
 * owed one. `0 of 40` is a sentence this job will print; "in sync" is not a
 * sentence it can produce, because it never reports a state — it reports two
 * counts and their difference.
 *
 * WHY IT DOES NOT GO THROUGH `ScheduledTenantsService.runPerTenant`
 * ---------------------------------------------------------------------------
 * The same reason the weather prefetch does not (ADR 0111 §Status, and the
 * amendment to ADR 0022 dated 2026-09-04): that scheduler enumerates tenants
 * carrying `scheduled_communications` or matching `DEFAULT_RESTAURANT_ID`, one
 * house of ten in production. A house that connected Google and was not on that
 * list would accumulate an ever-growing pile of unpushed entries and no sentence
 * anywhere saying so.
 *
 * This job's population is narrower and self-selecting in the only way that
 * matters: HOUSES THAT HAVE CONNECTED A GOOGLE ACCOUNT. Connecting is the
 * opt-in, it is per house, a person made it deliberately on a consent screen,
 * and a manager can end it (ADR 0114) — which is exactly the protection ADR
 * 0022's gate exists to give. A house with no grant is never touched.
 */

/** Twelve past the hour: away from the weather prefetch's top-of-hour sweep. */
const RECONCILE_CRON = "12 * * * *";
const RECONCILE_JOB_NAME = "calendar-push-reconcile";

/**
 * The most entries one house may be pushed in one sweep.
 *
 * A ceiling rather than "everything owed", because the first sweep after a
 * house connects would otherwise send its whole history in one burst — the
 * exact traffic shape a rate limit exists to stop. What is not sent this hour
 * is sent next hour, and the count printed says how many are still owed, so
 * nothing is lost and nothing is hidden.
 */
const MAX_PER_HOUSE_PER_SWEEP = 25;

/** Pause between writes, milliseconds. Politeness, not capacity planning. */
export const PAUSE_BETWEEN_WRITES_MS = 250;

export interface HouseReconcileReport {
  restaurantId: string;
  /** Entries this house holds. Null when the count could not be read. */
  entries: number | null;
  /** Entries with a copy in Google. */
  mapped: number | null;
  /** Entries owed a copy. */
  unmapped: number | null;
  /** Copies the house deleted whose removal has not landed. */
  pendingDeletes: number | null;
  attempted: number;
  delivered: number;
  failed: number;
  /** Seconds this house was still being held back, if it was skipped. */
  heldBackSeconds: number;
  /** The one sentence. Never "in sync". */
  sentence: string;
}

export interface ReconcileRunSummary {
  startedAt: string;
  finishedAt: string;
  /** Houses with a live grant — the only ones this job touches. */
  houses: number;
  attempted: number;
  delivered: number;
  failed: number;
  perHouse: HouseReconcileReport[];
  /** Set when the grant register itself could not be read. Never an empty run. */
  error: string | null;
}

@Injectable()
export class CalendarPushReconcileService {
  private readonly logger = new Logger(CalendarPushReconcileService.name);

  private lastRun: ReconcileRunSummary | null = null;

  constructor(private readonly push: CalendarPushService) {}

  status(): {
    armed: boolean;
    cron: string;
    lastRun: ReconcileRunSummary | null;
  } {
    return {
      armed: this.push.armed,
      cron: RECONCILE_CRON,
      lastRun: this.lastRun,
    };
  }

  @Cron(RECONCILE_CRON, { name: RECONCILE_JOB_NAME })
  async sweep(): Promise<ReconcileRunSummary> {
    const startedAt = new Date().toISOString();
    const summary: ReconcileRunSummary = {
      startedAt,
      finishedAt: startedAt,
      houses: 0,
      attempted: 0,
      delivered: 0,
      failed: 0,
      perHouse: [],
      error: null,
    };

    if (!this.push.armed) {
      this.logger.log(
        "Calendar push is switched off (CALENDAR_PUSH_ENABLED); no house's " +
          "day-book is being copied to Google, and no entry made while it is " +
          "off will have a copy until a sweep runs with it on.",
      );
      return this.finish(summary);
    }

    const houses = await this.push.housesWithAGrant();
    if (houses === null) {
      // Never an empty list standing in for a failed read.
      summary.error =
        "The grant register could not be read, so it is not known which houses push to Google, and no house was served.";
      this.logger.error(`Calendar push reconcile: ${summary.error}`);
      return this.finish(summary);
    }

    summary.houses = houses.length;
    if (houses.length === 0) {
      this.logger.log(
        "Calendar push reconcile: no house has connected a Google account, so " +
          "no entry anywhere is owed a copy. This is an empty population, not " +
          "an empty result.",
      );
      return this.finish(summary);
    }

    for (const restaurantId of houses) {
      const report = await this.house(restaurantId);
      summary.perHouse.push(report);
      summary.attempted += report.attempted;
      summary.delivered += report.delivered;
      summary.failed += report.failed;
      this.logger.log(`Calendar push reconcile: ${report.sentence}`);
    }

    return this.finish(summary);
  }

  private async house(restaurantId: string): Promise<HouseReconcileReport> {
    const report: HouseReconcileReport = {
      restaurantId,
      entries: null,
      mapped: null,
      unmapped: null,
      pendingDeletes: null,
      attempted: 0,
      delivered: 0,
      failed: 0,
      heldBackSeconds: 0,
      sentence: "",
    };

    const held = await this.push.persistedBackoffSeconds(restaurantId);
    if (held > 0) {
      report.heldBackSeconds = held;
      report.sentence =
        `${restaurantId} was left alone: Google asked this house to slow down and ` +
        `${held} second(s) of that are still to run. Nothing was pushed and nothing is lost.`;
      return report;
    }

    const owed = await this.push.entriesOwedACopy(
      restaurantId,
      MAX_PER_HOUSE_PER_SWEEP * 8,
    );
    const removals = await this.push.copiesAwaitingRemoval(
      restaurantId,
      MAX_PER_HOUSE_PER_SWEEP,
    );

    if (owed === null || removals === null) {
      report.sentence =
        `${restaurantId}: the push register could not be read, so it is NOT known ` +
        "how many entries are owed a copy. This is a failed read, not a clean house.";
      return report;
    }

    report.pendingDeletes = removals.length;

    // Removals first. A copy of an entry the house has deleted is the one thing
    // in Google that is actively wrong, rather than merely missing.
    for (const entryId of removals) {
      const result = await this.push.push(restaurantId, entryId, "delete", {
        fromReconcile: true,
      });
      report.attempted += 1;
      if (result.outcome === "delivered") report.delivered += 1;
      else report.failed += 1;
      await pause();
    }

    for (const entryId of owed.slice(0, MAX_PER_HOUSE_PER_SWEEP)) {
      const result = await this.push.push(restaurantId, entryId, "create", {
        fromReconcile: true,
      });
      report.attempted += 1;
      if (result.outcome === "delivered") report.delivered += 1;
      else report.failed += 1;
      // A rate limit or an expired token stops THIS house and nobody else. The
      // remaining entries stay owed and are counted as owed.
      if (
        result.outcome === "rate_limited" ||
        result.outcome === "token_expired" ||
        result.outcome === "house_stopped"
      ) {
        break;
      }
      await pause();
    }

    // Counted AFTER the writes, so the sentence describes where the house
    // actually is rather than where it was when the sweep started.
    const status = await this.push.status(restaurantId);
    report.entries = status.entries;
    report.mapped = status.pushed;
    report.unmapped = status.unpushed;
    report.sentence = `${restaurantId}: ${status.sentence} (${report.attempted} attempted this sweep, ${report.delivered} delivered, ${report.failed} not)`;
    return report;
  }

  private finish(summary: ReconcileRunSummary): ReconcileRunSummary {
    summary.finishedAt = new Date().toISOString();
    this.lastRun = summary;
    return summary;
  }
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_WRITES_MS));
}
