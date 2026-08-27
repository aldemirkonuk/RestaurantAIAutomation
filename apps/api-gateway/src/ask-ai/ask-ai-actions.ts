/**
 * The Ask AI action contract (P3.C, FUTURES §8.2).
 *
 * "Allowlisted" has to mean something mechanical or it means nothing. This file
 * is the allowlist: a model proposal that is not exactly one of these shapes,
 * with every field present and of the right type, is REJECTED — not coerced,
 * not defaulted, not passed through with a warning.
 *
 * WHY REJECTION AND NOT COERCION
 * ------------------------------
 * The failure this repo keeps finding is machinery that turns a bad answer into
 * a plausible one: a parser whose regex fallback returns `success` for prose, a
 * `?? "bottle"` that invents a unit, an `ux_proposals.kind` that accepted any
 * string the model felt like. Here the stakes are higher — the output of this
 * parse becomes a purchase order or an email to a vendor — so a proposal that
 * does not validate produces NO action and says why.
 *
 * A rejected proposal is not an error the user sees as a crash. It is Ask AI
 * saying "I did not understand that well enough to act on it", which is the
 * honest answer and the one the confirm gate exists to make survivable.
 *
 * THE EXECUTORS ARE NOT HERE, DELIBERATELY
 * ----------------------------------------
 * FUTURES §8.1: "existing services are the executors". This file describes what
 * may be asked for; `ask-ai.service.ts` hands a validated payload to
 * `ProcurementService`. Nothing in Ask AI writes to a domain table itself, so
 * every guard those services already carry — the vendor check, the draft
 * gate, the constraint checks — still runs, unchanged and unbypassed.
 */

/** Families in the MVP. Founder call 2026-08-27; widening this is a decision. */
export const ACTION_FAMILIES = ["procurement", "communications"] as const;
export type ActionFamily = (typeof ACTION_FAMILIES)[number];

/**
 * Reorder an inventory item from a provider.
 *
 * Executes through `ProcurementService.createOrder`, which creates a DRAFT —
 * so this action has two gates, not one: the Ask AI confirm, and the order's
 * own approval before anything is sent to a vendor.
 */
export interface ReorderAction {
  family: "procurement";
  actionType: "reorder";
  payload: {
    inventoryId: string;
    providerId: string;
    quantity: number;
    unitType?: string;
  };
}

/**
 * Ask the responder to draft a vendor reply on an existing order.
 *
 * Executes through `ProcurementService.generateAiReply`, which stages a
 * one-tap-approve draft. Again two gates: confirm here, approve there. Nothing
 * reaches a vendor from this path without a human acting twice.
 */
export interface VendorDraftAction {
  family: "communications";
  actionType: "vendor_draft";
  payload: {
    orderId: string;
    instruction: string;
  };
}

export type AskAiAction = ReorderAction | VendorDraftAction;

/**
 * The result of validating one proposal.
 *
 * FLAT, not a discriminated union, and that is a workaround rather than a
 * preference. `apps/api-gateway/tsconfig.json` sets `strictNullChecks: false`,
 * under which TypeScript does NOT narrow a union on a boolean literal
 * discriminant — `if (!v.ok)` leaves the full union and every field access on
 * the narrowed side is a compile error. The `{ok: true, action} | {ok: false,
 * reason}` shape is the better model and cannot be used here.
 *
 * Worth knowing beyond this file: the same setting means discriminated-union
 * narrowing silently does not work anywhere in the gateway, so code that READS
 * as type-safe may not be. Filed for the register rather than fixed in passing —
 * flipping that flag repo-wide is its own decision with its own blast radius.
 */
export interface ActionValidation {
  ok: boolean;
  /** Present when `ok`. */
  action?: AskAiAction;
  /** Present when not `ok`. Always set — a refusal with no reason is a dead end. */
  reason?: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function uuid(v: unknown): string | null {
  const s = str(v);
  return s && UUID.test(s) ? s : null;
}

/**
 * Upper bound on a single reorder line.
 *
 * Not arbitrary caution: this is the one field where a misread digit becomes
 * money. "Order 12 cases" misparsed as 1200 is a plausible model error and an
 * implausible human intent, and the confirm card is read by someone in a hurry.
 * A proposal above this is rejected rather than shown — if the intent is real,
 * the operator places it on the Orders page where the number is the only thing
 * on screen.
 */
export const MAX_REORDER_QUANTITY = 500;

/**
 * Validate one raw proposal from the model.
 *
 * Every branch returns a REASON, because "Ask AI could not do that" with no
 * explanation is the kind of dead end that teaches people to stop using a
 * feature — and because the reason is what makes a bad parse debuggable later.
 */
export function validateAction(raw: unknown): ActionValidation {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "The model did not return an action object." };
  }
  const r = raw as Record<string, unknown>;

  const family = str(r.family);
  if (!family || !(ACTION_FAMILIES as readonly string[]).includes(family)) {
    return {
      ok: false,
      reason: `Not an allowlisted action family: ${family ?? "(missing)"}.`,
    };
  }

  const actionType = str(r.actionType);
  const payload =
    r.payload && typeof r.payload === "object"
      ? (r.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return { ok: false, reason: "The action carried no payload." };
  }

  if (family === "procurement" && actionType === "reorder") {
    const inventoryId = uuid(payload.inventoryId);
    const providerId = uuid(payload.providerId);
    if (!inventoryId)
      return { ok: false, reason: "Could not resolve which item to reorder." };
    if (!providerId)
      return {
        ok: false,
        reason: "Could not resolve which vendor to order from.",
      };

    const quantity = payload.quantity;
    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      quantity < 1
    ) {
      return {
        ok: false,
        reason: "Quantity must be a whole number of at least 1.",
      };
    }
    if (quantity > MAX_REORDER_QUANTITY) {
      return {
        ok: false,
        reason: `Quantity ${quantity} is above the ${MAX_REORDER_QUANTITY} limit for a proposed order — place it on the Orders page instead.`,
      };
    }

    const unitType = str(payload.unitType);
    return {
      ok: true,
      action: {
        family: "procurement",
        actionType: "reorder",
        payload: {
          inventoryId,
          providerId,
          quantity,
          ...(unitType ? { unitType } : {}),
        },
      },
    };
  }

  if (family === "communications" && actionType === "vendor_draft") {
    const orderId = uuid(payload.orderId);
    if (!orderId)
      return {
        ok: false,
        reason: "Could not resolve which order to reply about.",
      };
    const instruction = str(payload.instruction);
    if (!instruction)
      return { ok: false, reason: "No instruction was given for the draft." };
    return {
      ok: true,
      action: {
        family: "communications",
        actionType: "vendor_draft",
        payload: { orderId, instruction },
      },
    };
  }

  return {
    ok: false,
    reason: `Not an allowlisted action: ${family}.${actionType ?? "(missing)"}.`,
  };
}
