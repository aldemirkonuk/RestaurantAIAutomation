import type { Logger } from "@nestjs/common";
import type {
  ApprovalDecision,
  ApproverRole,
} from "../settings/approval-thresholds";

/**
 * The gate between a threshold somebody wrote down and an order somebody seals.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * `settings/approval-thresholds.ts` already decides WHETHER an order needs a
 * signature, and it is pure and tested. What it deliberately does NOT decide is
 * whether THIS person may give that signature, because that needs a role the
 * settings register never sees. Those two halves are kept apart so the policy
 * has exactly one implementation and the gate has exactly one implementation,
 * and neither can quietly grow a second copy of the other.
 *
 * ---------------------------------------------------------------------------
 * THE RANK RULE, AND THE ONE TRAP IN IT
 * ---------------------------------------------------------------------------
 * `owner` outranks `manager`; everything else outranks nothing. The trap is
 * `null`: `OrganizationsService.resolveRestaurantRole` returns `null` both for
 * "this person has no row here" and for "the row could not be read", and those
 * two are indistinguishable at this layer. So `null` must never satisfy a rule.
 * A database outage that returned `null` and was read as `manager` would open
 * the ceiling at exactly the moment nobody could see what was happening — the
 * [[absence-reported-as-health]] shape, pointed at money.
 *
 * The refusal is deliberately NOT silent and NOT generic. A person told only
 * "forbidden" learns one thing: split the order in two. A person told "over the
 * 5,000 ceiling this house set for a manager — an owner has to sign this one"
 * learns who to ask.
 */

/** `owner` ⪰ `manager` ⪰ anything else. Unknown ranks below everything. */
const RANK: Record<string, number> = { owner: 2, manager: 1 };

/**
 * Does `actual` rank at or above `required`?
 *
 * `null`, `undefined`, `"staff"` and any string nobody has heard of all rank 0,
 * so none of them ever satisfies a rule. See the header on why `null` matters.
 */
export function roleSatisfies(
  actual: string | null | undefined,
  required: ApproverRole,
): boolean {
  const have = actual ? (RANK[actual] ?? 0) : 0;
  return have >= RANK[required];
}

/** How the refusal names the person who has to sign instead. */
export function approverPhrase(role: ApproverRole): string {
  return role === "owner" ? "an owner" : "a manager or an owner";
}

/**
 * The sentence the refused person reads, and the sentence filed on the order.
 *
 * One function so the 403 body, the audit row and the page all say the same
 * words. `reasons` comes straight out of `decideApproval`, so the numbers in it
 * are the house's own numbers rather than a paraphrase of them.
 */
export function refusalSentence(
  decision: ApprovalDecision,
  actorRole: string | null,
): string {
  const required = decision.requiredRole;
  if (!required) {
    // Not reachable from the gate — kept total so a caller cannot get an empty
    // string out of this function and print it as an explanation.
    return "No rule of this house required a second signature on this order.";
  }
  const because =
    decision.reasons.length > 0
      ? decision.reasons.join("; ")
      : "a rule this house set";
  const who = actorRole
    ? `You are signed in as ${actorRole} at this house`
    : "This session could not be shown to hold any role at this house";
  return (
    `This order is ${because}, so it waits for ${approverPhrase(required)} to seal it. ` +
    `${who}, so nothing was approved and the order stays open for ${approverPhrase(required)}.`
  );
}

/** What the house's own policy says about itself, in one sentence. */
export function policyNote(policySet: boolean): string {
  return policySet
    ? "this house has recorded at least one approval rule"
    : "no threshold is set for this house";
}

export interface RefusalRecord {
  restaurantId: string;
  orderId: string;
  /** `public.users.user_id`. NEVER an `auth.users` id — the two are disjoint. */
  actorUserId: string;
  actorRole: string | null;
  requiredRole: ApproverRole;
  firedBy: string[];
  reasons: string[];
  untestable: string[];
  total: number | null;
  sentence: string;
}

/**
 * File the refusal in `system_audit_log`. Never throws.
 *
 * Same contract as `team/access-audit.ts:recordAccessChange`, for the same
 * reason inverted: the refusal has already happened by the time this runs, and
 * turning a 403 into a 500 because the paper failed would tell the person
 * something false about what just happened. A failed write is logged loudly and
 * reported back to the caller as `audited`, so an empty trail is never read as
 * "no order was ever refused".
 *
 * A policy that is quietly blocking a house's work is the failure mode this row
 * exists to make visible — a threshold nobody remembers setting looks exactly
 * like a broken button.
 */
export async function recordApprovalRefusal(
  sb: {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  },
  logger: Pick<Logger, "error">,
  record: RefusalRecord,
): Promise<{ audited: boolean; reason: string | null }> {
  try {
    const { error } = await sb.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: record.actorUserId,
      action: "order_approval_refused",
      entity_type: "procurement_order",
      entity_id: record.orderId,
      changes: {
        register: "thresholds",
        subject: record.orderId,
        requiredRole: record.requiredRole,
        actorRole: record.actorRole,
        firedBy: record.firedBy,
        reasons: record.reasons,
        untestable: record.untestable,
        total: record.total,
        sentence: record.sentence,
      },
      restaurant_id: record.restaurantId,
      reason: record.sentence,
    });
    if (error) {
      logger.error(
        `order_approval_refused happened but the audit row failed to write: ${error.message}`,
      );
      return { audited: false, reason: error.message };
    }
    return { audited: true, reason: null };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `order_approval_refused happened but the audit row threw: ${message}`,
    );
    return { audited: false, reason: message };
  }
}
