/**
 * Who may send to a vendor with one hold — the rule, as a pure function.
 *
 * THE RULE (founder, verbatim where it matters)
 * ---------------------------------------------
 * ADR 0112 F12, ruling 2 (2026-09-05): *"one man approval if the authority is
 * valid — owner/manager or authorized personnel (owner can give access),
 * otherwise double approval is needed."*
 * ADR 0175 D10 (2026-09-19): every vendor send needs owner, manager or a
 * grantee.
 * The 2026-09-21 answer ("Staff ask, manager sends"): *"An owner, a manager, or
 * a person an owner has granted sends with one hold. When a staff member
 * holds, the letter becomes a REQUEST."*
 *
 * So there are exactly two outcomes, and neither is a refusal of the WORK:
 *
 *   send — an owner, a manager, or a person holding a live grant: one hold
 *          sends the letter.
 *   ask  — anybody else in the house: their hold becomes a request a manager
 *          releases (the "double approval" of F12).
 *
 * WHY PURE
 * --------
 * The service reads the role and the grants; this decides. Keeping the
 * decision free of I/O is what lets every clause below be mutation-tested
 * without mocking the thing under test (`vendor-send-authority.spec.ts`).
 *
 * WHAT MAKES A GRANT LIVE (each is a separate reason, so the refusal can NAME
 * which one failed — "your grant expired on …" tells a person what to do;
 * "forbidden" does not):
 *   - its grantee still holds a role in this house (no role here = no send,
 *     whatever grant rows remain — issue refuses a non-member, and so does
 *     the gate);
 *   - its scope is `vendor_send`;
 *   - it is not revoked;
 *   - it has not expired (checked NOW, at the act — F12 "expiry enforced at
 *     check time");
 *   - it has not been deleted;
 *   - it is not WAITING for an owner: the owner it rests on
 *     (`vouched_by_user_id` — the grantor at issue, the re-approving owner
 *     after a re-approval) still exists AND is still an owner of this house,
 *     AND the latch `suspended_at` is not set. Founder, 2026-09-21: a grant
 *     whose owner is demoted or removed STOPS at once and waits for a current
 *     owner's re-approval; *"no owner grant, no activation, or no going back
 *     once grant author gone"*. The latch is set by the database the moment
 *     the voucher stops being an owner
 *     (20260921114800_a_grant_waits_for_an_owner_when_its_voucher_goes.sql),
 *     so a voucher promoted again does not bring the grant back; the role
 *     read here is the second lock, for a write that ever got past the
 *     triggers.
 *   - when the act carries money (confirm-deal), the grant names a limit in the
 *     same currency and the amount is within it. A grant with NO limit covers
 *     letters only: an absent limit is not "unlimited" (ADR 0116 — a default
 *     is not an answer). [Also recorded as an open fork.]
 */

/** The one act a grant covers today. Matches the migration's CHECK. */
export const VENDOR_SEND_SCOPE = "vendor_send";

/** A row of `public.authority_grants`, as PostgREST returns it. */
export interface AuthorityGrantRow {
  id: string;
  grantor_user_id: string | null;
  grantee_user_id: string;
  scope: string;
  limit_amount: string | number | null;
  limit_currency: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  /** The owner the grant rests on now (20260921114800). NULL once they were deleted. */
  vouched_by_user_id: string | null;
  /** The latch: set when the voucher stopped being an owner; cleared only by a re-approval. */
  suspended_at: string | null;
  deleted_at: string | null;
}

/** The grant a send was made under, as the panel shows it ("granted by …"). */
export interface LiveGrant {
  id: string;
  grantorUserId: string;
  expiresAt: string | null;
  limitAmount: number | null;
  limitCurrency: string | null;
}

export type AskReason =
  | "no_role"
  | "not_owner_or_manager"
  | "grant_revoked"
  | "grant_deleted"
  | "grant_expired"
  | "grant_orphaned"
  | "grant_has_no_limit"
  | "grant_other_currency"
  | "grant_over_limit"
  | "amount_unknown";

export type VendorSendStanding =
  | { mode: "send"; basis: "owner" | "manager"; grant: null }
  | { mode: "send"; basis: "grant"; grant: LiveGrant }
  | { mode: "ask"; basis: null; grant: null; reason: AskReason };

/** Money an act carries, when it carries any. */
export interface ActAmount {
  /** null when the act carries money but the figure could not be read. */
  value: number | null;
  /** null when no currency could be read for it. */
  currency: string | null;
}

function numberOf(v: string | number | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Decide. `ownerIds` is the set of people who are owners of this house NOW —
 * the service reads it so a grant resting on a demoted owner reads as waiting.
 */
export function decideVendorSend(input: {
  role: string | null;
  grants: AuthorityGrantRow[];
  ownerIds: ReadonlySet<string>;
  now: Date;
  /** Omitted (or null) for an act that carries no money — a letter. */
  amount?: ActAmount | null;
}): VendorSendStanding {
  const role = (input.role ?? "").trim().toLowerCase();
  if (role === "owner") return { mode: "send", basis: "owner", grant: null };
  if (role === "manager") return { mode: "send", basis: "manager", grant: null };
  // A grant is to a MEMBER of this house (issue refuses anyone else). A grantee
  // who has since left keeps an unrevoked row, and a token naming this house
  // stays signed until it expires — so no role here means no send, whatever
  // grant rows remain. [Last-call fix, 2026-09-21: before this line a
  // non-member holding a live grant was decided "send".]
  if (role === "") return { mode: "ask", basis: null, grant: null, reason: "no_role" };

  // The reason a grant did not count, kept so the refusal can name it. The
  // first failing reason of the MOST RECENT grant wins: that is the one the
  // person is most likely to recognise.
  let firstMiss: AskReason | null = null;
  const miss = (r: AskReason) => {
    if (firstMiss === null) firstMiss = r;
  };

  const newestFirst = [...input.grants].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );

  for (const g of newestFirst) {
    if (g.scope !== VENDOR_SEND_SCOPE) continue;
    if (g.deleted_at) {
      miss("grant_deleted");
      continue;
    }
    if (g.revoked_at) {
      miss("grant_revoked");
      continue;
    }
    if (g.expires_at && new Date(g.expires_at).getTime() <= input.now.getTime()) {
      miss("grant_expired");
      continue;
    }
    // Waiting for an owner: latched, resting on nobody, or resting on a person
    // who is not an owner now. The latch is checked FIRST and on its own —
    // a voucher who is an owner again does not clear it.
    if (g.suspended_at || !g.vouched_by_user_id || !input.ownerIds.has(g.vouched_by_user_id)) {
      miss("grant_orphaned");
      continue;
    }
    const limit = numberOf(g.limit_amount);
    if (input.amount) {
      if (limit === null || !g.limit_currency) {
        miss("grant_has_no_limit");
        continue;
      }
      if (input.amount.value === null || !input.amount.currency) {
        miss("amount_unknown");
        continue;
      }
      if (input.amount.currency.toUpperCase() !== g.limit_currency.toUpperCase()) {
        miss("grant_other_currency");
        continue;
      }
      if (input.amount.value > limit) {
        miss("grant_over_limit");
        continue;
      }
    }
    return {
      mode: "send",
      basis: "grant",
      grant: {
        id: g.id,
        // "granted by" names the owner the grant rests on now: after a
        // re-approval that is the re-approving owner, not the original
        // grantor, who is no longer an owner here.
        grantorUserId: g.vouched_by_user_id,
        expiresAt: g.expires_at,
        limitAmount: limit,
        limitCurrency: g.limit_currency,
      },
    };
  }

  const reason: AskReason =
    firstMiss ?? (role === "" ? "no_role" : "not_owner_or_manager");
  return { mode: "ask", basis: null, grant: null, reason };
}

/** Why this person's hold will not send, in one sentence. */
export function whyNotSend(reason: AskReason, act: string): string {
  switch (reason) {
    case "no_role":
      return "No role in this house could be found for you.";
    case "not_owner_or_manager":
      return `Only an owner, a manager, or someone an owner has named may ${act} with one hold.`;
    case "grant_revoked":
      return "The grant an owner gave you was revoked.";
    case "grant_deleted":
      return "The grant an owner gave you was deleted.";
    case "grant_expired":
      return "The grant an owner gave you has expired.";
    case "grant_orphaned":
      return "The owner who vouched for your grant is no longer an owner here, so it stopped; it waits for a current owner to re-approve it.";
    case "grant_has_no_limit":
      return "Your grant names no money limit, so it covers letters only, not an act that commits money.";
    case "grant_other_currency":
      return "Your grant's limit is in a different currency from this act.";
    case "grant_over_limit":
      return "This is over the limit on your grant.";
    case "amount_unknown":
      return "The amount of this act could not be read, so no grant limit can cover it.";
  }
}

/**
 * The sentence a person reads BEFORE they hold, when their hold will ask
 * rather than send.
 *
 * It says what happens to their work first (it is kept and a manager is asked)
 * and why second — the founder's point was that nobody's work is blocked, only
 * the release waits.
 */
export function askSentence(reason: AskReason, act: string): string {
  return `Your hold will ask a manager to ${act}; your version is kept exactly as you wrote it. ${whyNotSend(reason, act)}`;
}

/**
 * The refusal a SEND gets from someone who may not send (a 403's message).
 * `canAsk` says whether this act has a request path the person can use
 * instead. Confirm-deal and the composer have one since the founder's answer
 * (3) of 2026-09-21; `POST /conversations/:id/approve` does not, and passes
 * `canAsk: false`.
 */
export function sendRefusal(
  reason: AskReason,
  act: string,
  opts: { canAsk: boolean },
): string {
  return `Nothing was sent. ${whyNotSend(reason, act)} ${
    opts.canAsk
      ? "Hold again to ask a manager instead; your version will be kept."
      : "Ask an owner or a manager to do it."
  }`;
}
