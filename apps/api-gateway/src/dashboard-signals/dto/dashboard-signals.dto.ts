import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

/**
 * Shared vocabulary for the three dashboard-rebuild signals (spec §3.1, §3.2,
 * §5). Every payload here obeys ADR 0051: a field is a live measured value, or
 * it is `null` WITH a sibling field naming why it is not knowable. There is no
 * third option, and there is never a zero standing in for an unknown.
 */

// ===========================================================================
// §3.2 — the "why" on a purchase
// ===========================================================================

/**
 * The five preset chips, exactly as the founder's chef specified them.
 * Tap-once and complete: no follow-up field is ever required.
 *
 * Closed set. It is mirrored by a CHECK constraint in
 * `supabase/migrations/20260901120000_purchase_reasons.sql`, so a sixth chip
 * needs both a migration and an ADR — it cannot be smuggled in as a string.
 */
export const PURCHASE_REASON_CODES = [
  "event_hold",
  "seasonal_trial",
  "slow_mover",
  "bought_wrong",
  "aging_on_purpose",
] as const;

export type PurchaseReasonCode = (typeof PURCHASE_REASON_CODES)[number];

/** Chip labels live server-side so no surface can drift from the decided wording. */
export const PURCHASE_REASON_LABELS: Record<PurchaseReasonCode, string> = {
  event_hold: "Event hold",
  seasonal_trial: "Seasonal trial",
  slow_mover: "Slow mover",
  bought_wrong: "Bought wrong",
  aging_on_purpose: "Aging on purpose",
};

/**
 * What a surface prints when an item has NO reason recorded.
 *
 * Exported as a constant because the spec is explicit that this must never
 * become a guess: "An item with no reason recorded must read as 'no reason
 * recorded', never as a guess."
 */
export const NO_REASON_RECORDED = "no reason recorded";

export class RecordPurchaseReasonDto {
  @ApiProperty({ description: "Restaurant UUID that owns the order" })
  @IsUUID()
  restaurantId: string;

  @ApiProperty({ description: "procurement_orders.id this reason explains" })
  @IsUUID()
  orderId: string;

  @ApiProperty({
    description: "One of the five preset chips",
    enum: PURCHASE_REASON_CODES,
  })
  @IsIn(PURCHASE_REASON_CODES as unknown as string[])
  reasonCode: PurchaseReasonCode;

  @ApiPropertyOptional({
    description:
      "Optional free text, reserved for the later voice-note addition. Never required, and never rendered as the reason.",
  })
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({ description: "User UUID that tapped the chip" })
  @IsUUID()
  @IsOptional()
  capturedBy?: string;
}

/** One recorded reason, as every read renders it. */
export interface PurchaseReasonRecord {
  orderId: string;
  inventoryId: string;
  reasonCode: PurchaseReasonCode;
  /** Decided wording for the chip — never re-derived client-side. */
  reasonLabel: string;
  capturedAt: string;
  /**
   * The order's real status when the chip was tapped, read from
   * `procurement_orders` inside the write. Not a claim by the writer: this is
   * what lets a reader say "recorded at ordering" and be right.
   */
  orderStatusAtCapture: string;
  capturedBy: string | null;
  note: string | null;
}

/** Per-inventory-item reason lookup, including the honest empty answer. */
export interface PurchaseReasonForItem {
  inventoryId: string;
  reason: PurchaseReasonRecord | null;
  /** Set iff `reason` is null. Always the literal `NO_REASON_RECORDED`. */
  reasonUnknownReason: string | null;
}

/**
 * Idle stock, reframed (spec §2.5). The chef: "framed as a finance number it
 * reads like an accusation with no context, and I'll get defensive, because
 * the same dollar figure covers 'I made a buying mistake' and 'this is aging
 * exactly as planned.'" The §3.2 reason is what separates those two, so it
 * travels with every row.
 */
export interface IdleStockItem {
  inventoryId: string;
  name: string;
  bottles: number;

  /**
   * "no_movement_recorded" — this item has never sold. Not the same claim as
   * "idle for N days", and the two must not be collapsed into one badge.
   */
  movementStatus: "no_movement_recorded" | "idle_since";
  daysSinceSale: number | null;

  /** Null where no cost backs the stock — an em dash, never 0. */
  capitalLocked: MoneyValue | null;
  capitalLockedUnknownReason: string | null;

  reason: PurchaseReasonRecord | null;
  /** Set iff `reason` is null. Always the literal `NO_REASON_RECORDED`. */
  reasonUnknownReason: string | null;
}

export interface IdleStockResponse {
  restaurantId: string;
  generatedAt: string;
  basis: Record<string, string>;
  totals: {
    idleItems: number;
    /**
     * The spec's three-way branch, never two:
     *   a positive number  → money
     *   a real 0           → nothing idle
     *   null               → idle stock exists but no cost is known for any of
     *                        it, which renders as an em dash
     */
    capitalLocked: number | null;
    /** True when some idle items have no known cost: render `≥`, not `=`. */
    capitalLockedIsFloor: boolean;
    itemsWithUnknownCapital: number;
    capitalLockedUnknownReason: string | null;
  };
  items: IdleStockItem[];
}

// ===========================================================================
// §5 — cellar aging / drink window
// ===========================================================================

/**
 * Urgency tiers, in the order they are ranked. Value never enters this
 * ordering: "a $40 bottle nobody's pouring that's about to tip over matters
 * more today than a $400 bottle with five good years left."
 */
export const DRINK_WINDOW_URGENCIES = [
  "past_window",
  "closing",
  "watch",
  "holding",
  "unknown",
] as const;

export type DrinkWindowUrgency = (typeof DRINK_WINDOW_URGENCIES)[number];

export interface DrinkWindow {
  /** vintage + aging_potential_years, both real catalog columns. */
  drinkByYear: number;
  /** Negative once the window has closed. */
  yearsRemaining: number;
  agingPotentialYears: number;
  vintage: number;
  /**
   * Always "estimated". The aging potential is a catalog property of the WINE,
   * not a measurement of this bottle in this cellar, so per spec §5 the
   * derived window is inferred and must be labelled as such.
   */
  confidence: "estimated";
  /** Human-readable provenance, printed verbatim by the surface. */
  basis: string;
}

export interface MoneyValue {
  amount: number;
  /** "invoice" when a real invoice cost backs the lots, else "estimated". */
  basis: "invoice" | "estimated";
  currency: string;
}

export type DrinkWindowItemValue = MoneyValue;

export interface DrinkWindowItem {
  inventoryId: string;
  masterWineId: string | null;
  name: string;
  producer: string | null;
  vintage: number | null;
  /** Live bottles on hand. */
  bottles: number;
  /**
   * Which book the count came from. `lots` is the source of truth; `stock_live`
   * is the legacy column, used only when the item has no lot rows at all. The
   * two can disagree (the dual-bookkeeping defect), so which one answered is
   * part of the answer.
   */
  bottlesBasis: "lots" | "stock_live";

  /** When this stock landed, or null when nothing recorded a landing. */
  landedAt: string | null;
  heldDays: number | null;
  landedBasis: "lot_received" | "order_delivered" | "unknown";

  /** Null when the window is not knowable for this item. */
  window: DrinkWindow | null;
  /** Set iff `window` is null. Names the missing input, per item. */
  windowUnknownReason: string | null;

  urgency: DrinkWindowUrgency;
  /**
   * The exact key the server sorted on, exposed so a surface cannot silently
   * re-rank by money and still claim to be showing urgency.
   */
  urgencyRank: number;

  /** Null when no cost is known — renders as an em dash, never as 0. */
  value: DrinkWindowItemValue | null;
  valueUnknownReason: string | null;
}

export interface DrinkWindowCoverage {
  itemsConsidered: number;
  itemsWithKnownWindow: number;
  itemsWithoutKnownWindow: number;
  itemsWithoutLandedDate: number;
  /**
   * True when the query hit its row cap. Every count above is then a FLOOR
   * (render `≥`), never a total (ADR 0051).
   */
  truncated: boolean;
}

export interface DrinkWindowResponse {
  restaurantId: string;
  generatedAt: string;
  basis: Record<string, string>;
  coverage: DrinkWindowCoverage;
  items: DrinkWindowItem[];
}

// ===========================================================================
// §3.1 — count freshness and attribution
// ===========================================================================

export interface CountCorrection {
  transactionId: string;
  at: string;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  source: string;
  performedBy: string | null;
  reason: string | null;
}

export interface CountCoverDelta {
  velocityPerDay: number;
  velocityBasis: string;
  daysOfCoverBefore: number;
  daysOfCoverAfter: number;
  /** Derived from a 30-day mean, so inferred — labelled per spec §5 / §4. */
  confidence: "estimated";
}

export interface CountFreshnessItem {
  inventoryId: string;
  name: string;

  /** Null when this item has never been counted. */
  lastCountedAt: string | null;
  daysSinceCount: number | null;

  /**
   * The ledger row the last count actually wrote, or null.
   *
   * Null has two distinct causes and `lastCountChangedStock` separates them —
   * a count that confirmed the number writes NO ledger row at all
   * (`set_stock_absolute` returns early on a zero delta), so silence here is
   * not the same as "never counted".
   */
  lastCorrection: CountCorrection | null;
  correctionUnknownReason: string | null;

  /**
   * true  — a reconciliation row is attributable to the last count.
   * false — the item was counted and the count changed nothing.
   * null  — never counted, so there is nothing to attribute either way.
   */
  lastCountChangedStock: boolean | null;

  /** The "4 days left → corrected to 2 days" line. Null when not knowable. */
  coverDelta: CountCoverDelta | null;
  coverDeltaUnknownReason: string | null;
}

export interface CountFreshnessResponse {
  restaurantId: string;
  generatedAt: string;
  basis: Record<string, string>;
  policy: {
    /**
     * Advisory only. A stated default, not a measured value and not a decided
     * threshold — it is published in the payload precisely so the surface
     * renders the policy it is using instead of a magic constant.
     */
    staleAfterDays: number;
    /**
     * How close a reconciliation row must sit to `last_counted_at` to be
     * attributed to that count. `recordSpotCount` writes the ledger row first
     * and stamps `last_counted_at` immediately after, so the true gap is
     * milliseconds; this tolerance is generous on purpose.
     */
    attributionWindowSeconds: number;
  };
  coverage: {
    itemsConsidered: number;
    itemsEverCounted: number;
    itemsWithTraceableCorrection: number;
    truncated: boolean;
  };
  items: CountFreshnessItem[];
}
