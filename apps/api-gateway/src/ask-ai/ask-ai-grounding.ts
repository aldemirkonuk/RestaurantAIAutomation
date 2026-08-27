import { AskAiAction } from "./ask-ai-actions";

/**
 * The candidate set the prompt handed the model — and the only ids it may use.
 *
 * WHY THIS EXISTS
 * ---------------
 * `validateAction` proves an id is a well-formed uuid. It cannot prove the id
 * is REAL. A model that invents `4f2a...` produces something that passes every
 * shape check and points at nothing — or, worse, at a row belonging to a
 * different restaurant.
 *
 * This is the same defect the consultant grounding check was built for on the
 * same day: `evidence_refs` citing an evidence category nobody supplied. There
 * the cost was a misleading sentence. Here it would be a purchase order against
 * another tenant's inventory row, so the check is not advisory — an ungrounded
 * proposal is REJECTED before it is ever stored, let alone shown.
 *
 * The rule is narrow and total: **the model may only choose from ids we handed
 * it in this request.** Not "ids that exist" — ids in this restaurant's
 * candidate set. That makes tenant isolation a property of the prompt contract
 * rather than something a later query has to remember to filter for.
 */
export interface ProposalCandidates {
  inventoryIds: Set<string>;
  providerIds: Set<string>;
  orderIds: Set<string>;
}

/**
 * A discriminated union again, restored with `strictNullChecks` (OD-107). It
 * shipped flat because a boolean discriminant did not narrow with the flag off.
 */
export type GroundingResult =
  | { grounded: true }
  | {
      grounded: false;
      /** Vague on purpose; the detail is in `ungrounded`. */
      reason: string;
      /** Which ids were not in the candidate set — for the log, not the user. */
      ungrounded: string[];
    };

export function checkActionGrounded(
  action: AskAiAction,
  candidates: ProposalCandidates,
): GroundingResult {
  const ungrounded: string[] = [];

  if (action.family === "procurement") {
    if (!candidates.inventoryIds.has(action.payload.inventoryId)) {
      ungrounded.push(`inventoryId:${action.payload.inventoryId}`);
    }
    if (!candidates.providerIds.has(action.payload.providerId)) {
      ungrounded.push(`providerId:${action.payload.providerId}`);
    }
  } else if (action.family === "communications") {
    if (!candidates.orderIds.has(action.payload.orderId)) {
      ungrounded.push(`orderId:${action.payload.orderId}`);
    }
  }

  if (ungrounded.length > 0) {
    return {
      grounded: false,
      // Deliberately vague to the user and precise in the log: naming the
      // invented id back to the operator is noise, and echoing a uuid that may
      // belong to another tenant is worse than noise.
      reason:
        "That referred to something I could not find in your inventory, vendors or open orders.",
      ungrounded,
    };
  }

  return { grounded: true };
}
