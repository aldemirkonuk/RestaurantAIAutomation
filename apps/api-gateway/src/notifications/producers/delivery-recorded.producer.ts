import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  ProducerLedgerService,
  emptyTally,
  type ProducerAudience,
  type ProducerTally,
} from "./producer-ledger.service";
import { clockIn, dayIn } from "./producer-copy";

/**
 * "A delivery was recorded at the door."
 *
 * WHAT A ROW HERE IS
 * ------------------
 * `procurement_receipt_events` with `stage = 'case_count'` — the stage
 * `ReceivingService.recordDoorReceipt` writes (receiving.service.ts:267), and
 * the only path in the gateway that inserts into that table at all (the other
 * three references at :320, :518 and :602 are reads). The other stages in the
 * CHECK constraint — `signed_at_door`, `bottle_count`, `reconciled`
 * (baseline:4592) — have no writer, so filtering to `case_count` is not a
 * narrowing of the door, it IS the door. If a second stage ever gains a writer
 * this producer will fall silent about it rather than mis-describe it, and the
 * filter is named here so that is a visible decision.
 *
 * SHORT-SHIP AND REFUSAL ARE STATED, NOT INFERRED
 * -----------------------------------------------
 * ADR 0057 and ADR 0059 are both about the same failure: a receiving write that
 * looked successful while the database and the ledger disagreed. The columns
 * this producer reads are the repair — `outcome` ('accepted' | 'short' |
 * 'refused'), `refusal_reason`, and the pair `counted_qty_bottles` /
 * `expected_qty_bottles`, all added by
 * 20260901220000_door_facts_are_columns.sql so the door's facts stop being prose
 * nothing reads back.
 *
 * The receiver's word comes FIRST and the arithmetic second. `outcome` is what a
 * person standing at the door typed; the bottle counts are what the system
 * derived. When they disagree the notification prints both rather than picking
 * one, because a disagreement between the two is the single most useful thing a
 * manager could learn from this row. When `expected_qty_bottles` is NULL — it is
 * nullable and `recordDoorReceipt` writes null whenever the client sent no
 * expectation (receiving.service.ts:241-247) — no shortfall is computed and none
 * is claimed.
 *
 * WHY IT DOES NOT ALSO CHASE THE ORDER'S STATUS
 * ---------------------------------------------
 * `procurement.service.ts:1744` already writes a receipt-verification
 * notification through the same funnel when a manager verifies an order, and
 * :2362 writes a discrepancy one. This producer is about the DOOR, which fires
 * hours earlier and for a different reader (the person who has to decide whether
 * to call the vendor before the truck leaves). Duplicating the verify notice
 * here would put two rows in the inbox for one event.
 */

const PRODUCER = "delivery_recorded";
const DOOR_STAGE = "case_count";

@Injectable()
export class DeliveryRecordedProducer {
  private readonly logger = new Logger(DeliveryRecordedProducer.name);

  static readonly PRODUCER = PRODUCER;

  /**
   * How far back a sweep still looks. Long enough that an outage of a few hours
   * is recoverable; short enough that turning this producer on for the first
   * time does not replay a year of deliveries into the inbox. The claim ledger
   * makes a re-read free, so this is a cost bound, not a correctness one.
   */
  static readonly LOOKBACK_HOURS = 48;

  static readonly CANDIDATE_CAP = 200;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly ledger: ProducerLedgerService,
  ) {}

  async sweepTenant(
    restaurantId: string,
    timeZone: string,
    audience: ProducerAudience,
    now: Date,
  ): Promise<ProducerTally> {
    const tally = emptyTally();
    const client = this.databaseService.getClient();
    const since = new Date(
      now.getTime() - DeliveryRecordedProducer.LOOKBACK_HOURS * 3_600_000,
    ).toISOString();

    const { data, error } = await client
      .from("procurement_receipt_events")
      .select(
        "id, order_id, occurred_at, outcome, refusal_reason, counted_qty, counted_uom, counted_qty_bottles, rejected_qty_bottles, expected_qty_bottles, driver_name, signed_by_initials",
      )
      .eq("restaurant_id", restaurantId)
      .eq("stage", DOOR_STAGE)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: true })
      .limit(DeliveryRecordedProducer.CANDIDATE_CAP + 1);

    if (error) {
      throw new Error(
        `could not read procurement_receipt_events: ${error.message}`,
      );
    }

    const rows = (data ?? []) as any[];
    tally.truncated = rows.length > DeliveryRecordedProducer.CANDIDATE_CAP;
    const events = tally.truncated
      ? rows.slice(0, DeliveryRecordedProducer.CANDIDATE_CAP)
      : rows;

    if (events.length === 0) {
      tally.withheldReason = `No delivery has been counted at the door in the last ${DeliveryRecordedProducer.LOOKBACK_HOURS} hours.`;
      return tally;
    }

    const orderNumbers = await this.orderNumbers(
      restaurantId,
      events.map((e) => e.order_id).filter(Boolean),
    );

    for (const event of events) {
      const occurredAt = new Date(event.occurred_at);
      if (!Number.isFinite(occurredAt.getTime())) {
        tally.failed += 1;
        this.logger.warn(
          `DELIVERY_EVENT_UNREADABLE_DATE restaurant=${restaurantId} event=${event.id} — ` +
            "occurred_at is not a readable instant; skipped rather than guessed.",
        );
        continue;
      }

      const orderNumber = event.order_id
        ? (orderNumbers.get(event.order_id) ?? null)
        : null;
      const subject = orderNumber
        ? `Order ${orderNumber}`
        : "An unlinked delivery";

      const shortfall = this.shortfall(event);
      const outcome = String(event.outcome ?? "").toLowerCase();

      await this.ledger.emit(
        { restaurantId, producer: PRODUCER, audience, tally },
        {
          // The event id. `procurement_receipt_events` rows are append-only and
          // their own UNIQUE `idempotency_key` index already stops the door
          // double-booking (uq_pre_idempotency, baseline:11894), so one row is
          // exactly one delivery and its id is exactly one notification.
          dedupeKey: `receipt:${event.id}`,
          occurredAt,
          payload: {
            // `order_delivered`, not a new word. `nt-format.ts` maps the row's
            // `type` to the register it is filed under (nt-format.ts:95-117),
            // and this page's own note §13.18 names this exact type for the
            // door. A type the map does not carry files the row under "Other".
            // The PRODUCER is still called `delivery_recorded`: the producer
            // names the sweep, the type names the register.
            type: "order_delivered",
            title: this.title(subject, outcome, shortfall),
            message: this.sentence(event, occurredAt, timeZone, shortfall),
            // A refusal is the one branch that needs somebody now: the truck is
            // still outside and the vendor has to be told. The other two are
            // records.
            priority: outcome === "refused" ? "high" : "medium",
            actionUrl: "/receiving",
            actionLabel: "Open receiving",
            metadata: {
              receiptEventId: event.id,
              orderId: event.order_id ?? null,
              orderNumber,
              outcome: event.outcome ?? null,
              outcomeSource:
                "procurement_receipt_events.outcome — the receiver's own word at the door",
              refusalReason: event.refusal_reason ?? null,
              countedQty: numberOrNull(event.counted_qty),
              countedUom: event.counted_uom ?? null,
              countedBottles: numberOrNull(event.counted_qty_bottles),
              expectedBottles: numberOrNull(event.expected_qty_bottles),
              rejectedBottles: numberOrNull(event.rejected_qty_bottles),
              // `null` means the door recorded no expectation, so no shortfall
              // can be computed. It is not zero.
              shortBottles: shortfall,
              driverName: event.driver_name ?? null,
              signedByInitials: event.signed_by_initials ?? null,
              stage: DOOR_STAGE,
              timeZone,
            },
          },
        },
      );
    }

    if (tally.emitted === 0 && tally.withheldReason === null) {
      tally.withheldReason =
        "Every door receipt in the window had already been reported.";
    }

    return tally;
  }

  /**
   * Bottles short, or `null` when the door recorded no expectation.
   *
   * Both columns are `numeric(12,3)` and both are nullable. A missing expectation
   * yields `null`, never `0`: "we know nothing was missing" and "we do not know
   * what was owed" are different, and only one of them is a fact.
   */
  private shortfall(event: any): number | null {
    const expected = numberOrNull(event.expected_qty_bottles);
    const counted = numberOrNull(event.counted_qty_bottles);
    if (expected === null || counted === null) return null;
    const diff = expected - counted;
    return diff > 0 ? Number(diff.toFixed(3)) : 0;
  }

  private title(
    subject: string,
    outcome: string,
    shortfall: number | null,
  ): string {
    if (outcome === "refused") return `${subject} was refused at the door`;
    if (outcome === "short" || (shortfall !== null && shortfall > 0)) {
      return `${subject} arrived short`;
    }
    return `${subject} was received at the door`;
  }

  private sentence(
    event: any,
    occurredAt: Date,
    timeZone: string,
    shortfall: number | null,
  ): string {
    const parts: string[] = [];
    const counted = numberOrNull(event.counted_qty);
    const uom = event.counted_uom ? String(event.counted_uom) : null;
    const bottles = numberOrNull(event.counted_qty_bottles);

    if (counted !== null && uom) {
      parts.push(
        `Counted ${trim(counted)} ${uom}${counted === 1 ? "" : "s"}${
          bottles !== null ? ` (${trim(bottles)} bottles)` : ""
        } on ${dayIn(occurredAt, timeZone)} at ${clockIn(occurredAt, timeZone)}.`,
      );
    } else {
      parts.push(
        `Recorded on ${dayIn(occurredAt, timeZone)} at ${clockIn(occurredAt, timeZone)}.`,
      );
    }

    const outcome = String(event.outcome ?? "").toLowerCase();
    if (outcome === "refused") {
      const reason = event.refusal_reason
        ? String(event.refusal_reason).replace(/_/g, " ")
        : null;
      parts.push(
        reason
          ? `The receiver refused it: ${reason}.`
          : "The receiver refused it; no reason was recorded.",
      );
    } else if (shortfall !== null && shortfall > 0) {
      parts.push(
        `${trim(shortfall)} bottles short of the ${trim(
          numberOrNull(event.expected_qty_bottles) ?? 0,
        )} expected.`,
      );
    } else if (shortfall === null) {
      parts.push(
        "The door recorded no expected quantity, so whether it was short is unknown.",
      );
    } else {
      parts.push("The count matched what was expected.");
    }

    const rejected = numberOrNull(event.rejected_qty_bottles);
    if (rejected !== null && rejected > 0) {
      parts.push(`${trim(rejected)} bottles were rejected on the spot.`);
    }

    if (event.driver_name) parts.push(`Driver: ${event.driver_name}.`);
    return parts.join(" ");
  }

  /** Order numbers for the events in hand, so the row can name what arrived. */
  private async orderNumbers(
    restaurantId: string,
    orderIds: string[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const ids = Array.from(new Set(orderIds));
    if (!ids.length) return out;
    const { data, error } = await this.databaseService
      .getClient()
      .from("procurement_orders")
      .select("id, order_number")
      // Scoped even though the ids came from this tenant's own events: a join
      // that is only tenant-safe because its input was is one refactor away from
      // not being.
      .eq("restaurant_id", restaurantId)
      .in("id", ids);
    if (error) {
      // The delivery is still worth reporting without its order number.
      this.logger.warn(
        `DELIVERY_ORDER_NUMBERS_UNREADABLE restaurant=${restaurantId} — ${error.message}. ` +
          "Notifications will name the delivery without its order number.",
      );
      return out;
    }
    for (const row of (data ?? []) as any[]) {
      if (row?.id && row?.order_number) out.set(row.id, String(row.order_number));
    }
    return out;
  }
}

function numberOrNull(value: any): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `12` not `12.000`; `12.5` keeps its half. */
function trim(value: number): string {
  return String(Number(value.toFixed(3)));
}
