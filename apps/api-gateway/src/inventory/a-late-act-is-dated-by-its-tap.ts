import { HttpException, HttpStatus } from "@nestjs/common";
import { resolveFactTime } from "../common/fact-time";

/**
 * F-1731. A pour or a manual adjust (breakage, a comp, bottles found) kept on
 * a phone with no signal is sent later, with its AGE (`occurredAgoMs`, how
 * long ago it was tapped), the way a queued count is (F-249, F-777). The age,
 * not the phone's clock, so a phone clock that is off cannot move it.
 *
 * Two things follow from the tap time:
 * - the ledger row is dated by it (`p_occurred_at`, ADR 0281), so a pour at
 *   23:40 sent at 00:10 stays in the day, and the month, it was poured in
 *   (within ADR 0286's 72 hours; see lateActTime);
 * - a count of the shelf (or of every shelf) taken AFTER the tap already has
 *   the pour in it. Taking it off again took it twice, so the act is refused
 *   in words, as the till's "counted before" skip does for a late sale
 *   (pos-hub.service.ts, F-1433). Refused, not set aside: from the not-sent
 *   strip the person sees why and discards it.
 *
 * An act without an age (sent the moment it was tapped) is unchanged.
 */

type Client = {
  from: (table: string) => any;
};

/**
 * When the act happened, on the server's clock (`tappedAt`), and the time
 * its ledger row is dated by (`bookedAt`). They differ only past 72 hours:
 * ADR 0286 keeps an older time only on an owner's or a manager's word, so
 * anyone else's is booked at its arrival. The count check still reads the
 * real tap. Null when no age was sent (a live act).
 */
export function lateActTime(
  occurredAgoMs: unknown,
  what: string,
  role: string | null | undefined,
): { tappedAt: string; bookedAt: string } | null {
  if (occurredAgoMs == null) return null;
  const age = Number(occurredAgoMs);
  // An age past the epoch is not a time anyone tapped at (F-777's guard).
  if (!Number.isFinite(age) || age < 0 || age > Date.now()) {
    throw new HttpException(
      `The time this ${what} was made could not be read, so it was not applied. Enter it again.`,
      HttpStatus.BAD_REQUEST,
    );
  }
  const receivedAt = new Date();
  const tappedAt = new Date(receivedAt.getTime() - age).toISOString();
  const fact = resolveFactTime({ sentAt: tappedAt, receivedAt, role });
  return { tappedAt, bookedAt: fact.at.toISOString() };
}

/**
 * Refuse a late act that a count taken after it already holds. A count of
 * every shelf always stands; a count of one shelf stands only for an act on
 * that shelf (a pour that names no shelf may have come off any of them, the
 * same rule as F-1165). An act that already landed (its key is on record)
 * is let through, so its retry replays instead of being refused.
 */
export async function refuseActCountedAfter(
  client: Client,
  act: {
    restaurantId: string;
    inventoryId: string;
    stockState: string;
    occurredAt: string;
    locationId: string | null;
    /** Where this act's key lands: pour_events or inventory_transactions. */
    keyTable: "pour_events" | "inventory_transactions";
    idempotencyKey: string;
    what: "pour" | "change";
  },
  logger: { error: (msg: string) => void },
): Promise<void> {
  const unread = (err: { message?: string }) => {
    logger.error(`Late ${act.what} count check failed: ${err.message}`);
    return new HttpException(
      `This ${act.what} could not be checked against the counts just now. It will be tried again.`,
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  };

  // Two literals, not `from(act.keyTable)`, so the table guard can read them.
  const landed = await (
    act.keyTable === "pour_events"
      ? client.from("pour_events")
      : client.from("inventory_transactions")
  )
    .select("id")
    .eq("restaurant_id", act.restaurantId)
    .eq("idempotency_key", act.idempotencyKey)
    .limit(1);
  if (landed.error) throw unread(landed.error);
  if ((landed.data ?? []).length > 0) return;

  const counts = await client
    .from("stock_counts")
    .select("id, location_id, counted_at")
    .eq("restaurant_id", act.restaurantId)
    .eq("inventory_id", act.inventoryId)
    .eq("stock_state", act.stockState)
    .gt("counted_at", act.occurredAt)
    .limit(50);
  if (counts.error) throw unread(counts.error);
  const holds = (
    (counts.data ?? []) as Array<{ location_id: string | null }>
  ).some(
    (c) =>
      c.location_id == null ||
      (act.locationId != null && c.location_id === act.locationId),
  );
  if (holds) {
    throw new HttpException(
      `This shelf was counted after this ${act.what} was made, so the count already has it. It was not applied again.`,
      HttpStatus.CONFLICT,
    );
  }
}
