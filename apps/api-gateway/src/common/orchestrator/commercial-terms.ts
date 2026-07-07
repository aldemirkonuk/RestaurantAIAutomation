/**
 * Commercial terms — pure parsing + validation for the structured pricing/ordering
 * constraints a wine supplier states in an email or attached price list. Implements §2 of
 * `.planning/INBOUND_EMAIL_INTELLIGENCE_PLAN.md`.
 *
 * The LLM extracts the raw shape; these helpers coerce it to safe types and derive the
 * validation flags that become guardrail reasons (case↔unit price mismatch, MOQ not met,
 * tax basis unknown, ambiguous currency). Side-effect free and fully unit-testable — the
 * responder stays the only place that decides what to do with the flags.
 */

export type TaxStatus = 'included' | 'excluded' | 'unknown';

export interface DiscountTier {
  threshold_qty: number | null;
  unit: string | null; // 'bottle' | 'case'
  discount_pct: number | null;
  discount_amount: number | null;
}

export interface CommercialTerms {
  currency: string | null; // ISO-4217 (USD, EUR, GBP, …) or null when not stated
  currency_ambiguous: boolean; // more than one currency present
  unit_price: number | null; // per bottle
  case_price: number | null;
  bottles_per_case: number | null;
  min_order_qty: number | null;
  min_order_unit: string | null; // 'bottle' | 'case'
  discount_tiers: DiscountTier[];
  tax_status: TaxStatus;
  tax_rate_pct: number | null;
  price_valid_until: string | null; // free text or ISO date, as stated
  payment_terms: string | null; // e.g. "Net 30", "2% 10 net 30", "prepaid"
  delivery_lead_time: string | null; // e.g. "3-5 business days"
  stock_status: string | null; // in_stock | limited | allocation | out_of_stock
  stock_qty_available: number | null;
}

export interface CommercialTermsValidation {
  /** case_price / bottles_per_case disagrees with unit_price by > 2%. */
  price_inconsistent: boolean;
  /** min_order_qty exceeds the quantity we asked for. */
  moq_not_met: boolean;
  /** Tax basis (included/excluded) not stated. */
  tax_status_unknown: boolean;
  /** More than one currency detected. */
  currency_ambiguous: boolean;
}

/** Empty terms — used when nothing was extracted; keeps downstream code branch-free. */
export function emptyCommercialTerms(): CommercialTerms {
  return {
    currency: null,
    currency_ambiguous: false,
    unit_price: null,
    case_price: null,
    bottles_per_case: null,
    min_order_qty: null,
    min_order_unit: null,
    discount_tiers: [],
    tax_status: 'unknown',
    tax_rate_pct: null,
    price_valid_until: null,
    payment_terms: null,
    delivery_lead_time: null,
    stock_status: null,
    stock_qty_available: null,
  };
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$€£\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

const KNOWN_CURRENCIES = ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'NZD'];

function normalizeCurrency(v: any): string | null {
  const s = (str(v) || '').toUpperCase();
  if (!s) return null;
  if (KNOWN_CURRENCIES.includes(s)) return s;
  if (s.includes('$')) return 'USD';
  if (s.includes('€') || s.includes('EUR')) return 'EUR';
  if (s.includes('£') || s.includes('GBP')) return 'GBP';
  return s.length === 3 ? s : null;
}

function normalizeTax(v: any): TaxStatus {
  const s = (str(v) || '').toLowerCase();
  if (s.includes('includ') || s === 'inc' || s.includes('incl')) return 'included';
  if (s.includes('exclud') || s === 'exc' || s.includes('excl') || s.includes('plus tax') || s.includes('+ tax')) {
    return 'excluded';
  }
  return 'unknown';
}

/** Coerce raw LLM output into safe, typed commercial terms. Never throws. */
export function parseCommercialTerms(raw: any): CommercialTerms {
  if (!raw || typeof raw !== 'object') return emptyCommercialTerms();
  const tiers: DiscountTier[] = Array.isArray(raw.discount_tiers)
    ? raw.discount_tiers.slice(0, 8).map((t: any) => ({
        threshold_qty: num(t?.threshold_qty),
        unit: str(t?.unit),
        discount_pct: num(t?.discount_pct),
        discount_amount: num(t?.discount_amount),
      }))
    : [];
  return {
    currency: normalizeCurrency(raw.currency),
    currency_ambiguous: raw.currency_ambiguous === true,
    unit_price: num(raw.unit_price),
    case_price: num(raw.case_price),
    bottles_per_case: num(raw.bottles_per_case),
    min_order_qty: num(raw.min_order_qty),
    min_order_unit: str(raw.min_order_unit),
    discount_tiers: tiers,
    tax_status: normalizeTax(raw.tax_status),
    tax_rate_pct: num(raw.tax_rate_pct),
    price_valid_until: str(raw.price_valid_until),
    payment_terms: str(raw.payment_terms),
    delivery_lead_time: str(raw.delivery_lead_time),
    stock_status: str(raw.stock_status),
    stock_qty_available: num(raw.stock_qty_available),
  };
}

/** True when the terms carry at least one extracted value worth persisting/surfacing. */
export function hasCommercialTerms(t: CommercialTerms): boolean {
  return (
    t.unit_price != null ||
    t.case_price != null ||
    t.min_order_qty != null ||
    t.discount_tiers.length > 0 ||
    t.tax_status !== 'unknown' ||
    t.payment_terms != null ||
    t.stock_status != null ||
    t.price_valid_until != null
  );
}

/**
 * Derive validation flags from the terms. `orderedQty` is what we asked for (0/unknown when
 * we have no target). Pure — the caller decides which flags become guardrail reasons (e.g.
 * tax_status_unknown only matters on a decision-ready deal).
 */
export function validateCommercialTerms(t: CommercialTerms, orderedQty: number): CommercialTermsValidation {
  let priceInconsistent = false;
  if (t.case_price != null && t.bottles_per_case != null && t.bottles_per_case > 0 && t.unit_price != null && t.unit_price > 0) {
    const derived = t.case_price / t.bottles_per_case;
    priceInconsistent = Math.abs(derived - t.unit_price) / t.unit_price > 0.02;
  }
  const moqNotMet = t.min_order_qty != null && orderedQty > 0 && t.min_order_qty > orderedQty;

  return {
    price_inconsistent: priceInconsistent,
    moq_not_met: moqNotMet,
    tax_status_unknown: t.tax_status === 'unknown',
    currency_ambiguous: t.currency_ambiguous === true,
  };
}
