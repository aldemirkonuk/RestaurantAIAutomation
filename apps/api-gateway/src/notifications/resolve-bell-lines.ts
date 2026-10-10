/**
 * A bell line clears when the thing it reports is dealt with (F-526).
 *
 * Until this, only `receipt_verify:{order}` cleared itself
 * (procurement.service.ts, `verifyReceipt`): every other line — "Name the item
 * of ORD-…", "Critical: <wine>", "<who> asks you to send a letter", "Delivery
 * discrepancy" — stayed unread for every recipient after one of them had
 * handled it, so an open line no longer meant an open job.
 *
 * Resolving is the same write `verifyReceipt` makes: `status = read` with a
 * `read_at`, on this house's still-unread rows, for every recipient at once.
 * A line is found by its `group_key` when its writer stamps one, or by its
 * `type` and `metadata.orderId` for a writer that never did (so lines written
 * before this change clear too).
 *
 * Never throws. The act that resolved the thing has already happened; a bell
 * that could not be cleared is logged by the caller, never a reason to undo it.
 */

type Client = { from: (table: string) => any };

export type BellLineMatch =
  | { groupKey: string }
  | { type: string; orderId: string };

export type ResolveOutcome =
  | { ok: true; resolved: number }
  | { ok: false; error: string };

export async function resolveBellLines(
  client: Client,
  restaurantId: string,
  match: BellLineMatch,
): Promise<ResolveOutcome> {
  try {
    let q = client
      .from("notifications")
      .update({ status: "read", read_at: new Date().toISOString() })
      .eq("restaurant_id", restaurantId)
      .eq("status", "unread");
    q =
      "groupKey" in match
        ? q.eq("group_key", match.groupKey)
        : q.eq("type", match.type).eq("metadata->>orderId", match.orderId);
    const { data, error } = await q.select("id");
    if (error) return { ok: false, error: error.message };
    return { ok: true, resolved: Array.isArray(data) ? data.length : 0 };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
