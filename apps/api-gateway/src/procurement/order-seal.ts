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

/**
 * The second act on an order that this module seals: ending it.
 *
 * WHY A CANCEL IS SEALED LIKE AN APPROVAL (ADR 0125, founder 2026-09-05)
 * ---------------------------------------------------------------------
 * An approval spends money and a cancellation destroys the record of money
 * already spent — cancelling a delivered order takes its cost out of every
 * spend and delivery figure while the bottles stay on the shelf. The two acts
 * are symmetric in consequence, and until this act existed they were not
 * symmetric in proof: `POST orders/:id/approve` redeemed a one-time seal while
 * `DELETE orders/:id` read an id and an optional query parameter.
 *
 * It is a SEPARATE act rather than a second use of `approve`, so a seal minted
 * for one cannot be spent on the other. `SealChallengeService` compares the act
 * and refuses with the sentence `common/seal/seal-subject.ts` already writes:
 * "That seal was issued for a different act on this order." The same asymmetry
 * already holds for `deliver` (`one-tap-workflow.ts`), so this is the third act
 * on the one subject kind rather than a new mechanism.
 */
export const ORDER_CANCEL_ACT = "cancel";

/**
 * The third act this module seals: SENDING the letter the house drafted.
 *
 * ADR 0118 — *nothing reaches a vendor without a person's hold* — and packet 2
 * of the overlay layer, which builds the panel that hold lives on. Until this
 * act existed the only approval of a drafted reply was
 * `POST orders/:id/approve-draft`, which sends a letter to a vendor on an
 * unsealed request: a click, and the mail is gone.
 *
 * A SEPARATE act rather than a second use of `approve`, for exactly the reason
 * `cancel` is separate: a seal minted to approve an order's MONEY must not be
 * spendable to send that order's MAIL, and the reverse. `SealChallengeService`
 * compares the act and refuses the mismatch by name.
 *
 * ITS ARGS ARE THE LETTER, NOT THE ORDER. What must not change between the hold
 * and the send is the WORDS, the recipient and who is copied — not the order's
 * total. A person holds over a paragraph they have read; an edit after the hold
 * is exactly the substitution the seal exists to catch, and hashing the order's
 * figures instead would let the paragraph change freely.
 */
export const ORDER_SEND_DRAFT_ACT = "send_draft";

/**
 * What the hold was over, for `send_draft`.
 *
 * The body is hashed rather than carried so a long letter does not travel twice
 * and so the args have a fixed size; the recipient and the copies travel whole
 * because they are short and because a refusal that can NAME the address it
 * expected is worth more than one that says "something changed".
 *
 * Whitespace is collapsed and the ends trimmed before hashing: a trailing
 * newline the textarea added is not a change to the letter, and a seal that
 * broke on one would teach people that the seal is flaky, which is worse than
 * no seal at all.
 */
export function draftSealArgs(input: {
  body: string;
  to: string | null | undefined;
  cc?: string[] | null;
}): Record<string, unknown> {
  return {
    // The letter, normalised. NOT the order total — see above.
    body: (input.body ?? "").replace(/\s+/g, " ").trim(),
    to: (input.to ?? "").trim().toLowerCase(),
    // Sorted, so the same three addresses in a different order are the same
    // letter. A person did not change the letter by re-typing a cc.
    cc: [...(input.cc ?? [])].map((e) => e.trim().toLowerCase()).sort(),
  };
}

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

/**
 * The canonical arguments for a CANCELLATION seal.
 *
 * The money and the vendor, exactly as an approval's — a cancellation is a
 * decision about the same figure, and a token minted over an order of 2,000
 * must not be spendable after somebody made it 20,000 — PLUS the order's own
 * state, which an approval's seal does not carry.
 *
 * WHY THE STATE IS IN HERE AND NOT IN `orderSealArgs`
 * --------------------------------------------------
 * Whether a cancellation is allowed at all DEPENDS on the state
 * (`order-transitions.ts`: an order whose goods have arrived cannot be
 * cancelled). So the state is part of what the person was deciding about, and a
 * seal held open while the truck arrives must not still be spendable: between
 * the hold and the write the answer changed from "yes" to "no, the wine is on
 * the shelf". Hashing the state makes that a refusal with the seal's own words
 * instead of a race the transition check happens to catch.
 *
 * It is the same reason `deliverySealArgs` hashes `status`
 * (`one-tap-workflow.ts`), and the reason an APPROVAL's does not: an approval
 * is refused by role and threshold, which the state does not move.
 */
export function orderCancelSealArgs(order: {
  id: string;
  total: unknown;
  providerId: string | null | undefined;
  status: unknown;
}): Record<string, unknown> {
  return {
    orderId: order.id,
    total: normaliseSealTotal(order.total),
    providerId: order.providerId ?? null,
    status: String(order.status ?? "unknown")
      .trim()
      .toUpperCase(),
  };
}
