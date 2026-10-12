import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * "Refused at door — <reason>" (F-669, founder S198).
 *
 * A refusal happens to a TRUCK, not to the order, so the words come from what
 * the door recorded — never from the order's status alone:
 *
 *   * FAILED: the order's only writer of that state is a truck refused at the
 *     door after it was booked in (`delivery.service.ts` failRefusedOrder).
 *     The order stays FAILED internally (no new order state, ADR 0125) and is
 *     never shown as "cancelled" or "failed".
 *   * An order still open with the vendor (placed, in transit, back in
 *     negotiation) whose latest door count turned the truck away whole, or
 *     whose only truck was refused as meant for another restaurant. A truck
 *     refused BEFORE it was booked in leaves its order open (F-748; ADR 0125
 *     Q3), and that order must say "Refused" too.
 *   * A part-delivered order whose latest door count turned the next truck
 *     away whole (F-1479): the refusal leaves it PARTIALLY_RECEIVED, and its
 *     row must still say "Refused", not only "Part delivered".
 *
 * The credit claim's standing travels beside the reason: requested, received,
 * denied — or not asked yet. A claim that could not be read is `null`, never
 * "not asked": the two are different facts.
 */

type Db = { from(table: string): any };

export type DoorRefusalCredit =
  | "none"
  | "not_asked"
  | "requested"
  | "received"
  | "denied"
  | "written_off";

export interface DoorRefusal {
  /** Why the truck was turned away, in the house's words; null when not recorded. */
  reason: string | null;
  /** The credit claim on this order; null when it could not be read. */
  credit: DoorRefusalCredit | null;
  /** The whole label every surface shows: "Refused at door — broken case · credit requested". */
  label: string;
}

/** The door's reasons (`DOOR_REFUSAL_REASONS`, receiving.service.ts) in words. */
const REASON_WORDS: Record<string, string> = {
  wrong_wine: "wrong wine",
  broken_case: "broken case",
  temperature: "wrong temperature",
  other: "other reason",
};

/** A REJECTED delivery is always WRONG_VENUE (ADR 0103 D7). */
export const WRONG_VENUE_WORDS = "sent to the wrong restaurant";

const CREDIT_WORDS: Record<DoorRefusalCredit, string> = {
  none: "no credit asked",
  not_asked: "credit not asked yet",
  requested: "credit requested",
  received: "credit received",
  denied: "credit denied",
  written_off: "credit written off",
};

/** `procurement_credits.state` as the owner reads it. */
export function creditStanding(state: unknown): DoorRefusalCredit | null {
  switch (String(state ?? "").toLowerCase()) {
    case "open":
      return "not_asked";
    case "requested":
    case "promised":
      return "requested";
    case "credited":
      return "received";
    case "rejected":
      return "denied";
    case "written_off":
      return "written_off";
    default:
      return null;
  }
}

export function refusalReasonInWords(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const key = raw.trim().toLowerCase();
  return REASON_WORDS[key] ?? key.replace(/_/g, " ");
}

export function doorRefusalLabel(
  reason: string | null,
  credit: DoorRefusalCredit | null,
): string {
  const head = reason ? `Refused at door — ${reason}` : "Refused at door";
  return credit ? `${head} · ${CREDIT_WORDS[credit]}` : head;
}

/** States in which an order is still open with its vendor. */
const OPEN_WITH_VENDOR = new Set<string>([
  ProcurementOrderStatus.PENDING,
  ProcurementOrderStatus.APPROVAL_NEEDED,
  ProcurementOrderStatus.NEGOTIATING,
  ProcurementOrderStatus.APPROVED,
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
]);

/**
 * Orders whose door is read: open with the vendor, or part-delivered with
 * bottles still owed — the door takes a count on both (F-1479).
 */
const READ_AT_DOOR = new Set<string>([
  ...OPEN_WITH_VENDOR,
  ProcurementOrderStatus.PARTIALLY_RECEIVED,
]);

interface DoorEventRow {
  id: string;
  order_id: string;
  outcome: string | null;
  refusal_reason: string | null;
  counted_qty_bottles: number | string | null;
  rejected_qty_bottles: number | string | null;
  occurred_at: string | null;
}

/** The truck kept nothing: the same reading as receiving.service turnedAwayWhole. */
function turnedAwayWhole(e: DoorEventRow): boolean {
  if (e.outcome !== "refused") return false;
  return (
    Number(e.counted_qty_bottles ?? 0) - Number(e.rejected_qty_bottles ?? 0) <=
    0
  );
}

function newestFirst(a: DoorEventRow, b: DoorEventRow): number {
  const at = String(b.occurred_at ?? "").localeCompare(
    String(a.occurred_at ?? ""),
  );
  return at !== 0 ? at : String(b.id).localeCompare(String(a.id));
}

/**
 * The refusal for each order passed in that was refused at the door, in three
 * reads per call however many orders there are.
 *
 * `doorRefusalFor(result, id)` answers per order: the refusal, `null` (read,
 * and not refused) or `undefined` (the door could not be read, so the key is
 * left ABSENT rather than reported as "not refused"). A failed read never
 * hides a FAILED order's refusal: it still says "Refused at door", with no
 * reason and no credit standing.
 */
export interface DoorRefusalReading {
  refused: Map<string, DoorRefusal>;
  /** Orders whose door could not be read: neither refused nor "not refused". */
  unknown: Set<string>;
}

export function doorRefusalFor(
  reading: DoorRefusalReading,
  orderId: string,
): DoorRefusal | null | undefined {
  if (reading.refused.has(orderId)) return reading.refused.get(orderId);
  return reading.unknown.has(orderId) ? undefined : null;
}

export async function readDoorRefusals(
  db: Db,
  restaurantId: string,
  orders: Array<{ id: string; status?: string | null }>,
): Promise<DoorRefusalReading> {
  const out = new Map<string, DoorRefusal>();
  const unknown = new Set<string>();
  const result = { refused: out, unknown };
  const wanted = orders.filter(
    (o) =>
      o &&
      typeof o.id === "string" &&
      (String(o.status ?? "").toUpperCase() === ProcurementOrderStatus.FAILED ||
        READ_AT_DOOR.has(String(o.status ?? "").toUpperCase())),
  );
  if (!wanted.length) return result;
  const ids = wanted.map((o) => o.id);

  // A read that throws is a read that failed: never "not refused".
  const settled = await (async () =>
    Promise.all([
      db
        .from("procurement_receipt_events")
        .select(
          "id, order_id, outcome, refusal_reason, counted_qty_bottles, rejected_qty_bottles, occurred_at",
        )
        .eq("restaurant_id", restaurantId)
        .in("order_id", ids)
        .eq("stage", "case_count"),
      db
        .from("deliveries")
        .select("id, order_id, state")
        .eq("restaurant_id", restaurantId)
        .in("order_id", ids),
      db
        .from("procurement_credits")
        .select("id, order_id, state, created_at")
        .eq("restaurant_id", restaurantId)
        .in("order_id", ids),
    ]))().catch(() => null);
  const [events, deliveries, credits] = settled ?? [null, null, null];
  const eventsRead = !events?.error && Array.isArray(events?.data);
  const deliveriesRead = !deliveries?.error && Array.isArray(deliveries?.data);
  const creditsRead = !credits?.error && Array.isArray(credits?.data);

  for (const order of wanted) {
    const failed =
      String(order.status ?? "").toUpperCase() ===
      ProcurementOrderStatus.FAILED;
    const own = eventsRead
      ? (events.data as DoorEventRow[])
          .filter((e) => e.order_id === order.id)
          .sort(newestFirst)
      : [];
    const latest = own[0] ?? null;
    const trucks = deliveriesRead
      ? (
          deliveries.data as Array<{ order_id: string; state: string | null }>
        ).filter((d) => d.order_id === order.id)
      : [];
    const refusedTruck =
      trucks.some((d) => d.state === "REJECTED") &&
      !trucks.some((d) => d.state !== "REJECTED" && d.state !== "CANCELLED");

    let reason: string | null = null;
    if (latest && latest.outcome === "refused")
      reason = refusalReasonInWords(latest.refusal_reason);
    else if (refusedTruck) reason = WRONG_VENUE_WORDS;

    // An open order's refusal is read off its door; a door we could not
    // read cannot say "not refused".
    if (!failed && (!eventsRead || !deliveriesRead)) {
      unknown.add(order.id);
      continue;
    }
    const refused =
      failed ||
      (latest !== null && turnedAwayWhole(latest)) ||
      (refusedTruck && (latest === null || latest.outcome === "refused"));
    if (!refused) continue;

    let credit: DoorRefusalCredit | null = null;
    if (creditsRead) {
      const claims = (
        credits.data as Array<{
          order_id: string;
          state: string | null;
          created_at: string | null;
        }>
      )
        .filter((c) => c.order_id === order.id)
        .sort((a, b) =>
          String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
        );
      credit = claims.length ? creditStanding(claims[0].state) : "none";
    }
    out.set(order.id, {
      reason,
      credit,
      label: doorRefusalLabel(reason, credit),
    });
  }
  return result;
}
