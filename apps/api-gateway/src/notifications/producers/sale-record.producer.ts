import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { money } from "./producer-copy";
import {
  localDateIn,
  localMidnight,
  serviceDaySettled,
  shiftLocalDate,
} from "./service-day";

/**
 * "The day's sale record" — one summary per service, once the day is in.
 *
 * THE ONE RULE THIS PRODUCER IS BUILT AROUND
 * ------------------------------------------
 * **A restaurant with no POS gets NO ROW.** Not a zero, not an em dash, not a
 * "0 covers" summary. `GoalsService.hasPosHistory` (`analytics/goals.service.ts`,
 * `grep -n 'private async hasPosHistory'` — deliberately NO line number: that
 * file moved twice during this one session, and a stale number is worse than an
 * anchor a reader has to run)
 * already draws that line and says why in its own comment: an unwindowed,
 * un-voided probe answers "is a POS wired to this tenant", which is a different
 * question from "did they sell anything", and "without it, a connected-but-quiet
 * week and a restaurant with no POS at all would both read as 0, and only one of
 * those is true." That method is private, so this producer asks the same
 * question through the public `getPosRevenueWindow`, whose `posConnected: false`
 * is the same fact — and which throws rather than swallowing a failed probe, so
 * a broken query cannot masquerade as "no POS".
 *
 * A connected POS that recorded nothing on the day also gets no row. A closed
 * Monday and a broken import both produce zero checks, and a notification saying
 * "0 covers, $0.00" would assert the first while the second is just as likely.
 * The run row carries the sentence instead, where it belongs.
 *
 * WHAT "THE DAY'S DATA IS IN" MEANS
 * ---------------------------------
 * See `service-day.ts`. Two rules, and the notification says which one decided,
 * because today the venue-hours rule cannot fire for anybody:
 * `restaurants.operating_hours` was added nullable with every existing row NULL
 * (20260902210000, its own header).
 *
 * COVERS ARE NOT CHECKS, AND SOME POS DO NOT SEND THEM
 * ---------------------------------------------------
 * `pos_checks.covers` is nullable and the Square adapter writes `covers: null`
 * unconditionally (pos-adapters.ts:96). So covers is summed only over the checks
 * that carry one, and the count of checks that did NOT is carried beside it. A
 * bare "142 covers" over a day where half the checks reported none would be a
 * number that is wrong in a direction nobody could see.
 */

const PRODUCER = "sale_record";

interface DayTotals {
  checks: number;
  revenue: number;
  covers: number | null;
  checksWithoutCovers: number;
  lastActivityAt: Date | null;
  topItem: { name: string; qty: number; revenue: number } | null;
  itemisedChecks: number;
}

@Injectable()
export class SaleRecordProducer {
  private readonly logger = new Logger(SaleRecordProducer.name);

  static readonly PRODUCER = PRODUCER;

  /**
   * How many local days back a sweep will still try to summarise. Two, so a
   * gateway that was down for a night still writes yesterday's record when it
   * comes back, and the claim ledger makes the re-read of an already-reported
   * day free.
   */
  static readonly RECOVERY_DAYS = 2;

  /** Checks read for one day. A day past this is reported as truncated. */
  static readonly CHECK_CAP = 2000;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
    posConnected: boolean,
  ): Promise<ProducerTally> {
    const tally = emptyTally();

    if (!posConnected) {
      tally.withheldReason =
        "No POS check has ever landed for this restaurant, so there is no service to record. A zero here would be a claim about their trading rather than a statement about our data.";
      return tally;
    }

    const hours = await this.operatingHours(restaurantId);
    const today = localDateIn(now, timeZone);

    // Days this producer has already spoken about. The claim index would refuse
    // the write anyway; reading first is what stops an hourly cron re-summing a
    // day's checks twenty-three more times after it reported them.
    const alreadySaid = await this.ledger.claimedKeysSince(
      restaurantId,
      PRODUCER,
      new Date(
        now.getTime() -
          (SaleRecordProducer.RECOVERY_DAYS + 1) * 24 * 3_600_000,
      ),
    );

    const skipped: string[] = [];

    for (let back = 1; back <= SaleRecordProducer.RECOVERY_DAYS; back++) {
      const localDate = shiftLocalDate(today, -back);
      if (alreadySaid.has(`service:${localDate}`)) {
        tally.alreadyClaimed += 1;
        continue;
      }
      const verdict = serviceDaySettled(hours, timeZone, localDate, now);

      if (!verdict.settled) {
        skipped.push(
          verdict.rule === "closed_day"
            ? `${localDate}: the venue's hours name no service on that date`
            : `${localDate}: not settled until ${verdict.settledAt.toISOString()}`,
        );
        continue;
      }

      const totals = await this.dayTotals(
        restaurantId,
        timeZone,
        localDate,
        tally,
      );

      if (totals.checks === 0) {
        skipped.push(
          `${localDate}: the POS recorded no check — a closed day and a failed import look identical from here, so neither is asserted`,
        );
        continue;
      }

      const occurredAt =
        totals.lastActivityAt ??
        localMidnight(shiftLocalDate(localDate, 1), timeZone);

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally },
        {
          dedupeKey: `service:${localDate}`,
          occurredAt,
          payload: {
            // `service_closed` — the type this page's note §13.20 names, one
            // line per service close rather than per check, and the type
            // `nt-format.ts:111` files under the "Sales" register.
            type: "service_closed",
            title: `Service record for ${localDate}`,
            message: this.sentence(localDate, totals),
            // A record, not a summons. Low keeps it out of the mobile push
            // fan-out (notifications.service.ts:729-745), which is right for a
            // once-a-day summary nobody has to act on.
            priority: "low",
            actionUrl: "/reports",
            actionLabel: "Open reports",
            metadata: {
              serviceDate: localDate,
              checks: totals.checks,
              revenue: totals.revenue,
              currency: "USD",
              // `null` means no check on the day reported a cover count.
              covers: totals.covers,
              checksWithoutCovers: totals.checksWithoutCovers,
              topItem: totals.topItem,
              topItemBasis:
                "highest line revenue across itemised checks (price x qty)",
              itemisedChecks: totals.itemisedChecks,
              revenueBasis:
                "sum of pos_checks.total where voided = false, bucketed by closed_at or opened_at — the same definition GoalsService.computeMetricWithSeries uses (goals.service.ts:350-380)",
              dayClosedRule: verdict.rule,
              dayClosedNote: verdict.note,
              settledAt: verdict.settledAt.toISOString(),
              truncated: tally.truncated,
              timeZone,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason = skipped.length
        ? `Nothing recorded — ${skipped.join("; ")}.`
        : "Every settled service day in the window had already been recorded.";
    }

    return tally;
  }

  /**
   * The day's totals, computed from the same columns and the same filters the
   * goals engine uses, so the notification and `/reports` cannot disagree.
   *
   * The window is `[local midnight, next local midnight)` converted to instants
   * in the venue's zone. Bucketing follows `closed_at || opened_at`
   * (goals.service.ts:372-380) but the RANGE is taken on `opened_at`, because
   * that is the NOT NULL column (baseline:4200) and the one the read can filter
   * on. A check opened before midnight and closed after it therefore belongs to
   * the day it opened, which is how a restaurant counts a service.
   */
  private async dayTotals(
    restaurantId: string,
    timeZone: string,
    localDate: string,
    tally: ProducerTally,
  ): Promise<DayTotals> {
    const from = localMidnight(localDate, timeZone);
    const to = localMidnight(shiftLocalDate(localDate, 1), timeZone);

    const { data, error } = await this.databaseService
      .getClient()
      .from("pos_checks")
      .select("total, covers, items, opened_at, closed_at")
      .eq("restaurant_id", restaurantId)
      .eq("voided", false)
      .gte("opened_at", from.toISOString())
      .lt("opened_at", to.toISOString())
      .limit(SaleRecordProducer.CHECK_CAP + 1);

    if (error) {
      // Throwing hands the tenant to `runPerTenant`. Returning zeroes here would
      // write a "0 covers" service record off the back of a failed query, which
      // is the exact fabrication this producer exists to avoid.
      throw new Error(`could not read pos_checks: ${error.message}`);
    }

    const rows = (data ?? []) as any[];
    if (rows.length > SaleRecordProducer.CHECK_CAP) {
      tally.truncated = true;
      this.logger.warn(
        `SALE_RECORD_CHECKS_TRUNCATED restaurant=${restaurantId} date=${localDate} ` +
          `cap=${SaleRecordProducer.CHECK_CAP} — the day's totals are a floor, not a total.`,
      );
    }
    const checks = rows.slice(0, SaleRecordProducer.CHECK_CAP);

    let revenue = 0;
    let coverSum = 0;
    let coverReported = 0;
    let itemised = 0;
    let lastActivity: Date | null = null;
    const byItem = new Map<string, { qty: number; revenue: number }>();

    for (const check of checks) {
      revenue += Number(check.total) || 0;

      const covers = check.covers;
      if (covers !== null && covers !== undefined && Number.isFinite(Number(covers))) {
        coverSum += Number(covers);
        coverReported += 1;
      }

      const stamp = check.closed_at || check.opened_at;
      if (stamp) {
        const d = new Date(stamp);
        if (
          Number.isFinite(d.getTime()) &&
          (lastActivity === null || d.getTime() > lastActivity.getTime())
        ) {
          lastActivity = d;
        }
      }

      const items = Array.isArray(check.items) ? check.items : [];
      if (items.length) itemised += 1;
      for (const item of items) {
        const name = String(item?.name ?? "").trim();
        if (!name) continue;
        const qty = Number(item?.qty) || 1;
        const price = Number(item?.price) || 0;
        const seen = byItem.get(name) ?? { qty: 0, revenue: 0 };
        seen.qty += qty;
        seen.revenue += price * qty;
        byItem.set(name, seen);
      }
    }

    let topItem: DayTotals["topItem"] = null;
    for (const [name, agg] of byItem) {
      if (!topItem || agg.revenue > topItem.revenue) {
        topItem = { name, qty: agg.qty, revenue: agg.revenue };
      }
    }

    return {
      checks: checks.length,
      revenue: Number(revenue.toFixed(2)),
      // `null`, not 0: no check on the day reported a cover count.
      covers: coverReported > 0 ? coverSum : null,
      checksWithoutCovers: checks.length - coverReported,
      lastActivityAt: lastActivity,
      topItem: topItem
        ? { ...topItem, revenue: Number(topItem.revenue.toFixed(2)) }
        : null,
      itemisedChecks: itemised,
    };
  }

  private sentence(localDate: string, totals: DayTotals): string {
    const parts: string[] = [];
    parts.push(
      `${totals.checks} check${totals.checks === 1 ? "" : "s"}, ${money(totals.revenue)}.`,
    );

    if (totals.covers === null) {
      parts.push("No check reported a cover count, so covers are unknown.");
    } else if (totals.checksWithoutCovers > 0) {
      parts.push(
        `${totals.covers} covers across the ${
          totals.checks - totals.checksWithoutCovers
        } checks that reported one; ${totals.checksWithoutCovers} did not.`,
      );
    } else {
      parts.push(`${totals.covers} covers.`);
    }

    if (totals.topItem) {
      parts.push(
        `Best seller by revenue: ${totals.topItem.name}, ${trimQty(totals.topItem.qty)} sold for ${money(totals.topItem.revenue)}.`,
      );
    } else {
      parts.push(
        "No check carried line detail, so there is no best seller to name.",
      );
    }

    return parts.join(" ");
  }

  /**
   * The venue's hours, or `null` when it has none. A read failure also returns
   * `null` — with a log line — because the settle rule degrades gracefully to
   * the midnight margin and losing a whole day's record over an unreadable
   * hours column would be the worse outcome.
   */
  private async operatingHours(restaurantId: string): Promise<unknown | null> {
    const { data, error } = await this.databaseService
      .getClient()
      .from("restaurants")
      .select("operating_hours")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `SALE_RECORD_HOURS_UNREADABLE restaurant=${restaurantId} — ${error.message}. ` +
          "The settle rule falls back to the margin past local midnight, and the row says so.",
      );
      return null;
    }
    return data?.operating_hours ?? null;
  }
}

function trimQty(value: number): string {
  return String(Number(value.toFixed(2)));
}
