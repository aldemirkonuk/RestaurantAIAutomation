import type { ApprovalDecision } from "../settings/approval-thresholds";
import { ProcurementOrderStatus } from "./dto/procurement.dto";
import { approverPhrase } from "./order-approval-gate";
import { normaliseSealTotal } from "./order-seal";

/**
 * A price change on an approved order re-runs the approval rules for the
 * person making it — ADR 0244 D3, the founder's four calls of 2026-09-30.
 *
 *   F1 "Pending price change (Recommended)": an approved order (or one further
 *      on, before delivery) keeps its state; a change the person's rules do
 *      not cover waits as a PENDING change until someone whose rules cover it
 *      approves it through a sealed act. No stock release, no mail hold, no
 *      state change.
 *   F2 "Yes, gate it (Recommended)": confirm-deal runs the same rules for the
 *      confirming person (superseding ADR 0175's "owners and managers are not
 *      limited here").
 *   F3 "Yes, wait (Recommended)": the autonomy's accept of a vendor reply
 *      approves only within the house's rules.
 *   F4 "Any price change": EVERY price change re-runs EVERY rule, up or down,
 *      `new_vendor` and `price_jump` included.
 *
 * Pure: no Nest, no database, no `async` — except the two fact readers at the
 * bottom, which take the client as an argument so the gateway and the inbound
 * responder read "first order to this vendor" and "premium over the last
 * price" with ONE implementation. Two copies of a fact the rules test is how
 * a gate and a readout learn to disagree.
 */

/**
 * The figures a price change moves. ADR 0244 D2's money MINUS
 * `price_verified`: that column is the receipt verification's verdict, not a
 * figure any rule tests or any seal is taken over, so flipping it is not a
 * price change (builder's reading, recorded in ADR 0244 D3).
 */
export const ORDER_PRICE_FIGURES = [
  "quoted_price",
  "negotiated_price",
  "final_price",
  "total_cost",
] as const;
export type OrderPriceFigure = (typeof ORDER_PRICE_FIGURES)[number];

/** Every figure a pending change may carry: the prices and, for a deal, the quantity. */
export type ChangeFigure = OrderPriceFigure | "quantity";

/**
 * Where the re-check applies: sealed and not yet delivered (F1's "an
 * approved (or later, pre-delivery) order"). Before approval the approval act
 * itself tests the figures; after delivery is a question the founder has not
 * been asked (filed in the ADR).
 */
export const PRICE_RECHECK_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.APPROVED,
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
];

export function isPriceRecheckStatus(status: unknown): boolean {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  return (PRICE_RECHECK_STATUSES as readonly string[]).includes(s);
}

export function finiteOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** One figure, as a comparable string: money to cents, a quantity as a number, unknown as "unknown". */
export function figureKey(column: ChangeFigure, value: unknown): string {
  if (column === "quantity") {
    const n = finiteOrNull(value);
    return n === null ? "unknown" : String(n);
  }
  return normaliseSealTotal(value);
}

/**
 * Which figures a proposal actually moves, from what, to what. A proposed
 * value of `undefined` or `null` says nothing (the PATCH treats a null as
 * "not sent"), and a value equal to the current one to the cent is not a
 * change. Values are kept as numbers (or null) for the record; equality is
 * decided on `figureKey`.
 */
export function figuresThatMove(
  current: Partial<Record<ChangeFigure, unknown>>,
  proposed: Partial<Record<ChangeFigure, unknown>>,
): {
  from: Partial<Record<ChangeFigure, number | null>>;
  to: Partial<Record<ChangeFigure, number | null>>;
  moved: ChangeFigure[];
} {
  const from: Partial<Record<ChangeFigure, number | null>> = {};
  const to: Partial<Record<ChangeFigure, number | null>> = {};
  const moved: ChangeFigure[] = [];
  for (const column of Object.keys(proposed) as ChangeFigure[]) {
    const next = proposed[column];
    if (next === null || next === undefined) continue;
    if (figureKey(column, current[column]) === figureKey(column, next))
      continue;
    from[column] = finiteOrNull(current[column]);
    to[column] = finiteOrNull(next);
    moved.push(column);
  }
  return { from, to, moved };
}

/**
 * Every named figure as it stands, nulls included — the whole-snapshot twin
 * of `figuresThatMove`, for a change (a deal) whose approval must find the
 * order exactly as it was, not only the figures it moves.
 */
export function snapshotFigures(
  source: Partial<Record<ChangeFigure, unknown>>,
  columns: readonly ChangeFigure[],
): Partial<Record<ChangeFigure, number | null>> {
  const out: Partial<Record<ChangeFigure, number | null>> = {};
  for (const column of columns) out[column] = finiteOrNull(source[column]);
  return out;
}

/**
 * The figures that moved on the order since a change was proposed: every
 * figure the change touches must still read what it read then, or the change
 * is a proposal against an order that no longer exists.
 */
export function figuresMovedSince(
  current: Partial<Record<ChangeFigure, unknown>>,
  proposedFrom: Partial<Record<ChangeFigure, unknown>>,
): ChangeFigure[] {
  return (Object.keys(proposedFrom) as ChangeFigure[]).filter(
    (column) =>
      figureKey(column, current[column]) !==
      figureKey(column, proposedFrom[column]),
  );
}

/** The unit price an order carries: its final price, else its negotiated one, else its quote. */
export function effectiveUnitPrice(
  figures: Partial<Record<ChangeFigure, unknown>>,
): number | null {
  return (
    finiteOrNull(figures.final_price) ??
    finiteOrNull(figures.negotiated_price) ??
    finiteOrNull(figures.quoted_price)
  );
}

/**
 * The money the ceiling tests on a re-check: the larger of the order's total
 * and its unit price times its quantity, when either is known.
 *
 * WHY NOT `total_cost` ALONE (builder's reading of F4, recorded in ADR 0244
 * D3 as an open question): confirm-deal writes the price and the quantity and
 * never `total_cost`, and a PATCH may move the unit price alone. Tested on
 * `total_cost` only, both would step around the ceiling F2 and F4 exist to
 * keep — exactly the adversarial pass's "effective total" finding. The
 * product is unit-naive (a case price times a bottle count over-states), the
 * same arithmetic confirm-deal's grant limit already uses (`dealAmount`); an
 * over-statement can only make a change wait, never let one through.
 */
export function effectiveTotal(input: {
  totalCost: unknown;
  unitPrice: unknown;
  quantity: unknown;
}): number | null {
  const total = finiteOrNull(input.totalCost);
  const unit = finiteOrNull(input.unitPrice);
  const qty = finiteOrNull(input.quantity);
  const product =
    unit !== null && qty !== null ? Math.round(unit * qty * 100) / 100 : null;
  if (total === null) return product;
  if (product === null) return total;
  return Math.max(total, product);
}

/**
 * The sentence a person reads when their change waits instead of applying.
 * One function, so the 202 body, the audit row and the bell say one thing.
 */
export function pendingSentence(
  decision: Pick<ApprovalDecision, "requiredRole" | "reasons">,
  actorRole: string | null,
  source: PriceChangeSource,
): string {
  const who = approverPhrase(decision.requiredRole ?? "owner");
  const because =
    decision.reasons.length > 0
      ? decision.reasons.join("; ")
      : "a rule this house set";
  const as = actorRole
    ? `You are signed in as ${actorRole} at this house`
    : "This session could not be shown to hold any role at this house";
  const what =
    source === "confirm_deal"
      ? "Nothing was confirmed and nothing was sent to the vendor"
      : source === "order_merge"
        ? "The open order was not changed and no new order was made"
        : "The order's price was not changed";
  return (
    `This price change is ${because}, so it waits for ${who} to approve it. ` +
    `${as}. ${what}; the order keeps its state until ${who} holds to approve the change.`
  );
}

/** Why a waiting change can no longer be approved, in words. */
export function staleSentence(
  moved: string[],
  statusNow: string | null,
): string {
  if (moved.length === 0) {
    return (
      `This order is ${statusNow ?? "in an unreadable state"} now, and this change was proposed ` +
      "for it before that, so it can no longer be approved. Nothing was changed; propose it again if it still stands."
    );
  }
  return (
    `The order's ${moved.map((m) => m.replace(/_/g, " ")).join(", ")} changed after this change was proposed, ` +
    "so it can no longer be approved as it stood. Nothing was changed; propose it again if it still stands."
  );
}

/**
 * The sixth act on an order's seal: approving a price change that waited
 * for a signature (ADR 0244 D3; founder, 2026-09-30, F1 "Pending price
 * change"). Kept beside the change it seals rather than in `order-seal.ts`,
 * whose five acts it sits with in `SealChallengeService` by name alone.
 *
 * A SEPARATE act, for the reason `cancel` and `confirm_deal` are: a seal
 * minted to approve an ORDER (its total, its vendor) must not be spendable to
 * approve a CHANGE to its price, and the reverse.
 *
 * ITS ARGS ARE THE CHANGE: the waiting row's id (so a seal held over one
 * proposal cannot approve the proposal that superseded it), where it came
 * from, and every figure it moves, from and to. A proposal edited between the
 * hold and the approval is a different proposal and is refused by name.
 */
export const ORDER_APPROVE_PRICE_CHANGE_ACT = "approve_price_change";

/** What the hold was over, for `approve_price_change`. */
export function priceChangeSealArgs(change: {
  id: string;
  orderId: string;
  source: string;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  terms?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const sorted = (o: Record<string, unknown>) =>
    Object.fromEntries(
      Object.keys(o ?? {})
        .sort()
        .map((k) => [
          k,
          o[k] === null || o[k] === undefined ? "unknown" : String(o[k]),
        ]),
    );
  return {
    changeId: change.id,
    orderId: change.orderId,
    source: change.source,
    from: sorted(change.from),
    to: sorted(change.to),
    // What the approval replays (a deal's terms, a merge's order request),
    // hashed whole: `hashCallArgs` canonicalises nested keys itself.
    terms: change.terms ?? null,
  };
}

/** Where a price change came from: the order edit, confirm-deal, or the POST orders merge. */
export type PriceChangeSource = "order_edit" | "confirm_deal" | "order_merge";

/** A waiting (or decided) price change, as the gateway returns it. */
export interface PriceChangeView {
  id: string;
  orderId: string;
  source: PriceChangeSource;
  state: string;
  raisedBy: string | null;
  raisedAt: string;
  from: Record<string, number | null>;
  to: Record<string, number | null>;
  /** What the approval replays: a deal's terms, or a merge's order request. */
  terms: Record<string, unknown> | null;
  requiredRole: "owner" | "manager";
  firedBy: string[];
  reasons: string[];
}

export function presentPriceChange(row: Record<string, any>): PriceChangeView {
  return {
    id: String(row.id),
    orderId: String(row.order_id),
    source:
      row.source === "confirm_deal" || row.source === "order_merge"
        ? row.source
        : "order_edit",
    state: String(row.state),
    raisedBy: row.raised_by ?? null,
    raisedAt: String(row.raised_at ?? ""),
    from: (row.figures_from ?? {}) as Record<string, number | null>,
    to: (row.figures_to ?? {}) as Record<string, number | null>,
    terms: (row.terms ?? null) as Record<string, unknown> | null,
    requiredRole: row.required_role === "manager" ? "manager" : "owner",
    firedBy: Array.isArray(row.fired_by) ? row.fired_by : [],
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
  };
}

// ---------------------------------------------------------------------------
// The two facts the rules test that need a read. Moved here from
// `ProcurementService` unchanged (2026-09-30) so the inbound responder's
// autonomy gate (F3) reads them the same way. `null` means "could not find
// out", which `decideApproval` reports as untestable and never fires on.
// ---------------------------------------------------------------------------

type CountClient = {
  from: (table: string) => any;
};

/** Whether this house has any OTHER order with this vendor. */
export async function readIsFirstOrderToVendor(
  sb: CountClient,
  restaurantId: string,
  orderId: string,
  providerId: string | null,
): Promise<boolean | null> {
  if (!providerId) return null;
  try {
    const { count, error } = await sb
      .from("procurement_orders")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .neq("id", orderId);
    if (error || count === null || count === undefined) return null;
    return count === 0;
  } catch {
    return null;
  }
}

/**
 * How far above the last unit price this house paid for the same item, in
 * percent. `null` when there is no earlier price.
 */
export async function readPricePremiumPct(
  sb: CountClient,
  restaurantId: string,
  orderId: string,
  inventoryId: string | null,
  unitPrice: number | null,
): Promise<number | null> {
  if (!inventoryId || unitPrice === null || unitPrice <= 0) return null;
  try {
    const { data, error } = await sb
      .from("procurement_orders")
      .select("final_price, requested_at")
      .eq("restaurant_id", restaurantId)
      .eq("inventory_id", inventoryId)
      .neq("id", orderId)
      .order("requested_at", { ascending: false })
      .limit(1);
    if (error) return null;
    const prior = finiteOrNull(
      (data as Array<{ final_price: string | number | null }> | null)?.[0]
        ?.final_price ?? null,
    );
    if (prior === null || prior <= 0) return null;
    return ((unitPrice - prior) / prior) * 100;
  } catch {
    return null;
  }
}
