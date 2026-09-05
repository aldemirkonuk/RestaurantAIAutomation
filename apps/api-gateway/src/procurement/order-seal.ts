/**
 * What a seal on an ORDER is a seal over.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ARGUMENTS ARE THE ORDER'S MONEY
 * ---------------------------------------------------------------------------
 * A challenge is bound to (actor, subject kind, subject id, act, args_hash).
 * The first four are obvious for an order. `args_hash` is the interesting one,
 * and choosing it badly makes the whole mechanism decorative:
 *
 *   * Hash NOTHING and the seal proves only that somebody held the gesture on
 *     THIS order at SOME point — so an order edited between the hold and the
 *     write still seals, at whatever number it now says. That is the
 *     edit-after-approval hole, and it is exactly the hole a seal is for.
 *   * Hash the WHOLE ROW and the seal breaks on a field nobody approved and
 *     nobody cares about — a `synced_at`, a note. A control that refuses for
 *     invisible reasons teaches operators to mash it until it works.
 *
 * So the hash covers the number the manager was looking at when they began the
 * hold, and the vendor it is going to. If either changes, what was approved and
 * what is being sent are not the same thing, and the refusal says so in those
 * words.
 *
 * `total` is normalised to a fixed-precision STRING rather than left as a
 * number: `total_cost` comes back from PostgREST as a string for `numeric` and
 * as a number for `float`, and a seal that hashed "2000.00" at issue and 2000 at
 * redemption would refuse every honest approval. Rounding to cents is the
 * house's own unit; anything finer is not a price anyone approved.
 */

/** The one act this module seals. Not a general "write" — approving is its own act. */
export const ORDER_SEAL_ACT = "approve";

/** Money, as one string, so issue and redemption cannot disagree about format. */
export function normaliseSealTotal(value: unknown): string {
  if (value === null || value === undefined || value === "") return "unknown";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "unknown";
  return n.toFixed(2);
}

/**
 * The canonical arguments for an order seal.
 *
 * "unknown" is a real value here and not a hole: an order whose total cannot be
 * read hashes to "unknown" at BOTH ends, so the seal still works — and it
 * changes the moment the total becomes readable, which is a change worth
 * refusing on. Substituting 0 would have hashed an unknown price as a free one.
 */
export function orderSealArgs(order: {
  id: string;
  total: unknown;
  providerId: string | null | undefined;
}): Record<string, unknown> {
  return {
    orderId: order.id,
    total: normaliseSealTotal(order.total),
    providerId: order.providerId ?? null,
  };
}
