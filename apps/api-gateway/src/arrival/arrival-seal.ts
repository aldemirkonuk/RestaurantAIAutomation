/**
 * What a seal on an ARRIVAL BATCH is a seal over (ADR 0113, ADR 0144).
 *
 * Mirrors `procurement/order-seal.ts`'s shape exactly: a challenge is bound to
 * (actor, subject kind, subject id, act, args_hash), and args_hash is what was
 * on screen when the hold began — batch identity and revision — so a batch
 * edited between the hold and the write (a row discarded, a new proposal
 * appended, an earlier crash's resume having already advanced it) cannot be
 * sealed at whatever it now says. `apply()` already refuses on a revision
 * mismatch for the ordinary (non-resume) path; hashing it too means a token
 * minted over revision 3 is never spendable after anything moved the batch to
 * revision 4, even if some future caller forgot the separate check.
 *
 * Nothing here talks to a database or to Nest, so it is testable without
 * either — same reason `order-seal.ts` is its own file.
 */

/** The one act this module seals. Undo is a separate, unsealed control
 * (ADR 0113 rule 4a): the founder's brief named the assistant's PROPOSE and
 * the seal's APPLY; nothing in ADR 0113/0144 or the C2 audit asks for a
 * second ceremony on the seven-day undo. */
export const ARRIVAL_APPLY_ACT = "apply";

export function arrivalSealArgs(batch: {
  id: string;
  revision: number;
}): Record<string, unknown> {
  return {
    batchId: batch.id,
    revision: batch.revision,
  };
}
