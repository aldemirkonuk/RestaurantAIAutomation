/**
 * THE VENDOR AND ORDER A PAPER IS FILED UNDER ARE THIS HOUSE'S
 * (proposal-receipt §3 row 1.3).
 *
 * `POST /procurement/documents` and `POST /procurement/documents/door-count`
 * took `providerId` and `orderId` from the body and passed them straight to
 * intake: `link()` then attached the paper to whatever order id it was given,
 * and the delivery the door count creates carried the vendor id as sent. A
 * session in house A could hang its paper on house B's order.
 *
 * THE SESSION'S CALL (2026-11-11, under the founder's 2026-11-07 /goal): the
 * paper is KEPT and the link is REFUSED, rather than the whole upload answering
 * 404. The upload is the delivery door (ADR 0126: "a role check there would
 * lose documents at the moment they arrive"); a deleted order or a stale vendor
 * id on a porter's phone must not throw a real paper away. So a foreign, absent
 * or unreadable id is dropped before intake runs, and `refused` carries one
 * sentence per dropped id for the reply. The sentence is the same for "not
 * this house's" and "does not exist" (ADR 0147: never confirm another house's
 * id exists).
 *
 * Rejected: 404 the upload (the proposal's first draft) — loses the paper;
 * keep the id and warn — leaves the cross-house link in place.
 *
 * A FAILED READ IS NOT A YES (ADR 0051): an id whose house could not be read is
 * dropped too, and its sentence says the check could not run.
 */

export interface HouseIds {
  providerId: string | null;
  orderId: string | null;
  /** One sentence per id that was named and not kept. Empty when all held. */
  refused: string[];
}

interface Reader {
  from(table: string): any;
}

async function heldByHouse(
  client: Reader,
  table: "providers" | "procurement_orders",
  restaurantId: string,
  id: string,
): Promise<"yes" | "no" | { failed: string }> {
  const { count, error } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("id", id)
    .eq("restaurant_id", restaurantId);
  if (error) return { failed: String(error.message ?? "unknown error") };
  return count ? "yes" : "no";
}

export async function houseIdsFor(
  client: Reader,
  restaurantId: string,
  named: { providerId?: string | null; orderId?: string | null },
): Promise<HouseIds> {
  const refused: string[] = [];
  let providerId = named.providerId ?? null;
  let orderId = named.orderId ?? null;

  if (providerId) {
    const held = await heldByHouse(client, "providers", restaurantId, providerId);
    if (held !== "yes") {
      refused.push(
        held === "no"
          ? "The vendor named with this paper is not one of this house's vendors, so the paper was filed without it."
          : `Whether the vendor named with this paper is this house's could not be checked (${held.failed}), so the paper was filed without it.`,
      );
      providerId = null;
    }
  }

  if (orderId) {
    const held = await heldByHouse(
      client,
      "procurement_orders",
      restaurantId,
      orderId,
    );
    if (held !== "yes") {
      refused.push(
        held === "no"
          ? "The order named with this paper is not one of this house's orders, so the paper was filed without it."
          : `Whether the order named with this paper is this house's could not be checked (${held.failed}), so the paper was filed without it.`,
      );
      orderId = null;
    }
  }

  return { providerId, orderId, refused };
}
