/**
 * The tax-basis vocabularies — the code half of
 * `supabase/migrations/20270110000000_house_tax_basis_and_rates.sql`
 * (F-620 / F-1537; founder 2026-10-12, S218: F1 build it, F2 only from now,
 * F3 stamp cost basis).
 *
 * Each list here is the CHECK of one column, and `tax-basis.spec.ts` reads the
 * migration and fails when the two disagree, so a fifth basis cannot be added
 * on one side only. A value outside the list reads as `null` — not stated —
 * and never as a default basis: an unread basis is not "unset", and it is
 * certainly not "prices include tax".
 */

/**
 * `restaurants.tax_basis` and `pos_checks.tax_basis`.
 *
 * - `unset`: nobody at the house has said. Every house starts here, and it is
 *   a strict no-op: figures read exactly as before.
 * - `prices_include_tax`: the till's prices include tax (KDV, VAT); ingest
 *   makes the subtotal pre-tax.
 * - `prices_exclude_tax`: tax is added on top (the US way); a no-op.
 * - `not_vat_charging`: the house charges no VAT; net is what the till sends.
 */
export const HOUSE_TAX_BASES = [
  "unset",
  "prices_include_tax",
  "prices_exclude_tax",
  "not_vat_charging",
] as const;

export type HouseTaxBasis = (typeof HOUSE_TAX_BASES)[number];

/**
 * `procurement_order_items.price_tax_basis`,
 * `inventory_lots.unit_cost_tax_basis` and
 * `restaurant_inventory.last_purchase_price_tax_basis`. NULL in the database
 * is "not stated", and margin advice refuses on it (F3).
 */
export const COST_TAX_BASES = ["includes_tax", "excludes_tax"] as const;

export type CostTaxBasis = (typeof COST_TAX_BASES)[number];

/** `house_tax_rates.key_kind`. */
export const TAX_RATE_KEY_KINDS = [
  "house",
  "pos_category",
  "house_item",
] as const;

export type TaxRateKeyKind = (typeof TAX_RATE_KEY_KINDS)[number];

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v)
    ? (v as T)
    : null;
}

/** A house's or a check's basis as read, or `null` when it is not one of the four. */
export function asHouseTaxBasis(v: unknown): HouseTaxBasis | null {
  return oneOf(HOUSE_TAX_BASES, v);
}

/** A cost's basis as read, or `null`: not stated. */
export function asCostTaxBasis(v: unknown): CostTaxBasis | null {
  return oneOf(COST_TAX_BASES, v);
}

/** A rate row's key kind as read, or `null` when it is not one of the three. */
export function asTaxRateKeyKind(v: unknown): TaxRateKeyKind | null {
  return oneOf(TAX_RATE_KEY_KINDS, v);
}
