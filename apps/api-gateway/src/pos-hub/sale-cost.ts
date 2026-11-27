/**
 * What a till line cost when it sold, and what a check's margin reads from it
 * (r57, table side decision D4). Pure, so the arithmetic is tested without a
 * database.
 *
 * The cost of a line is written on its consumption row at the moment of sale.
 * A later invoice, a re-priced lot or a corrected unit price changes what the
 * next sale costs and nothing already sold: every reader of a check's cost and
 * margin reads the row, never the lot.
 */
import { resolveUnitCost } from "../analytics/inventory-cost";
import { glassCostFrom } from "../pricing/margin-to-target";

export type SaleCostBasis =
  | "invoice_lot_wac"
  | "invoice_lot_wac_partial"
  | "last_purchase_price";

/** Written only by restate_sale_cost, when a verified invoice moves a sale's cost. */
export const RESTATED_BASIS = "invoice_restated";

/** The unit (one bottle) cost a sale was costed at, and where it came from. */
export interface SaleCostSource {
  unitCost: number;
  basis: SaleCostBasis;
  /** The oldest live costed lot: the one a pour draws from first. */
  lotId: string | null;
  /** The order (invoice) that lot arrived on, when it names one. */
  orderId: string | null;
}

/** The four columns a consumption row keeps for its cost. */
export interface CostSnapshot {
  cost_at_sale: number | null;
  cost_basis: SaleCostBasis | null;
  /** One whole bottle's cost the line was costed at; a verified invoice restates from it. */
  cost_unit_at_sale: number | null;
  cost_source_lot_id: string | null;
  cost_source_order_id: string | null;
}

export const NO_COST_SNAPSHOT: CostSnapshot = {
  cost_at_sale: null,
  cost_basis: null,
  cost_unit_at_sale: null,
  cost_source_lot_id: null,
  cost_source_order_id: null,
};

const round4 = (n: number) => Math.round(n * 10000) / 10000;

interface LotRow {
  id?: unknown;
  qty?: unknown;
  unit_cost?: unknown;
  cost_provenance?: unknown;
  source_order_id?: unknown;
  received_at?: unknown;
  stock_state?: unknown;
}

/**
 * The cost source for one inventory item: the recorded unit cost by the same
 * rule every other margin reader uses (invoiced lot WAC, else last purchase
 * price), and the oldest live lot that carries a cost as its source. Null when
 * the house has recorded no cost for the item.
 */
export function pickSaleCostSource(
  row: { last_purchase_price?: unknown } | null | undefined,
  rollup: Record<string, unknown> | null | undefined,
  lots: LotRow[] | null | undefined,
): SaleCostSource | null {
  const { unitCost, costBasis } = resolveUnitCost(row, rollup);
  if (unitCost === null || costBasis === "unknown") return null;
  let lotId: string | null = null;
  let orderId: string | null = null;
  {
    // The oldest live costed lot is named whatever the basis: a line costed at
    // the last price paid still came off a delivery, and the invoice that
    // verifies that delivery restates the line (r102).
    const live = (lots ?? [])
      .filter(
        (l) =>
          (l.stock_state ?? "live") === "live" &&
          Number(l.qty) > 0 &&
          l.unit_cost != null &&
          l.cost_provenance !== "sample",
      )
      .sort((a, b) =>
        String(a.received_at ?? "").localeCompare(String(b.received_at ?? "")),
      );
    const first = live[0];
    if (first) {
      lotId = first.id ? String(first.id) : null;
      orderId = first.source_order_id ? String(first.source_order_id) : null;
    }
  }
  return { unitCost, basis: costBasis, lotId, orderId };
}

/**
 * The cost snapshot of one line. A whole-bottle line costs one bottle per unit
 * sold. A pour costs its share of the bottle: bottle cost x ml / bottle ml
 * (`glassCostFrom`), so a bottle's worth of pours costs the bottle. A line
 * with no recorded cost, or a pour from a bottle of unknown size, keeps no
 * cost: null, never 0.
 */
export function snapshotLineCost(
  source: SaleCostSource | null,
  mode: "whole_bottle" | "volume",
  volumeMl: number,
  bottleMl: number | null,
  qty: number,
): CostSnapshot {
  if (!source) return NO_COST_SNAPSHOT;
  const cost =
    mode === "whole_bottle"
      ? Number.isFinite(qty) && qty >= 0
        ? source.unitCost * qty
        : null
      : glassCostFrom(source.unitCost, volumeMl, bottleMl);
  if (cost === null || !Number.isFinite(cost)) return NO_COST_SNAPSHOT;
  return {
    cost_at_sale: round4(cost),
    cost_basis: source.basis,
    cost_unit_at_sale: source.unitCost,
    cost_source_lot_id: source.lotId,
    cost_source_order_id: source.orderId,
  };
}

// ---------------------------------------------------------------------------
// The reader: a check's cost of goods and margin, from the snapshots.
// ---------------------------------------------------------------------------

export interface ConsumptionCostRow {
  wine_name?: string | null;
  quantity?: number | null;
  volume_ml?: number | null;
  total_revenue?: number | string | null;
  cost_at_sale?: number | string | null;
  cost_basis?: string | null;
  notes?: string | null;
  /** The lot the line was costed from; read for its cost tax basis (F3). */
  cost_source_lot_id?: string | null;
  /** That lot's cost_tax_basis, when the reader looked it up. */
  cost_tax_basis?: string | null;
  /** A tax rate the till printed on this line, in percent. Absent = not stated. */
  tax_rate_percent?: number | string | null;
}

/** restaurants.tax_basis (#1459): null when the house has not said. */
export type HouseTaxBasis = "prices_include_tax" | "prices_exclude_tax" | null;

/**
 * What the check itself says, beside its wine lines (r110 g5). `subtotal` is
 * pos_checks.subtotal, after discounts (ADR 0295). `rungTotal` is every line
 * on the check at the price rung, food included (comped lines at 0); null
 * when a line's price was not kept. `statedTax` is a tax the till stated for
 * the check; null when it stated none.
 */
export interface CheckFacts {
  subtotal: number | null;
  rungTotal: number | null;
  statedTax: number | null;
  taxBasis: HouseTaxBasis;
}

export const DISCOUNT_NOT_STATED = "discount not stated";
export const SUBTOTAL_ABOVE_LINES = "the subtotal is above the lines";
export const TAX_NOT_KNOWN = "tax inside the price not known";
export const COST_TAX_BASIS_NOT_STATED = "cost tax basis not stated";

const toCents = (n: number) => Math.round(n * 100);

/**
 * Split `target` cents over `weights` (cents, each >= 0) in proportion, by
 * largest remainder: every share is floor(target x w / W) and the cents left
 * over go one each to the largest remainders, ties to the earlier line. The
 * shares always sum to `target` exactly. BigInt, so a large check cannot lose
 * a cent to floating point. W = 0 gives every line 0 and divides nothing.
 */
export function allocateCents(weights: number[], target: number): number[] {
  const w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  const W = w.reduce((a, b) => a + b, 0n);
  if (W === 0n) return weights.map(() => 0);
  const T = BigInt(Math.round(target));
  const q = w.map((x) => (T * x) / W);
  const r = w.map((x, i) => T * x - q[i] * W);
  let left = T - q.reduce((a, b) => a + b, 0n);
  const order = r
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (a.x === b.x ? a.i - b.i : a.x > b.x ? -1 : 1));
  for (let k = 0; left > 0n && k < order.length; k++, left--) q[order[k].i] += 1n;
  return q.map((x) => Number(x));
}

export interface CheckMarginLine {
  wine: string | null;
  volumeMl: number;
  revenue: number | null;
  cost: number | null;
  costKept: boolean;
  /** Why this line has no cost in the totals, in words; null when it has one. */
  costNote: string | null;
  /** A verified invoice moved this line's cost off the delivery's estimate. */
  restated: boolean;
  /** The price rung on the till, before the check's discount and tax. */
  rungRevenue?: number | null;
  /** The margin is withheld: the tax inside the price is not known. */
  taxWithheld?: boolean;
}

export interface CheckMargin {
  lines: CheckMarginLine[];
  /** Lines the till voided: they sold nothing and are not in any total. */
  voidedLines: number;
  /** Revenue and cost over the lines that have both. */
  revenue: number;
  cost: number;
  margin: number | null;
  marginPct: number | null;
  linesWithoutCost: number;
  /** Lines whose cost a verified invoice restated. */
  restatedLines: number;
  /** What the owner reads; says outright when part of the check is unknown. */
  sentence: string;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * COGS and margin of a check from what each line cost when it sold. A row
 * with no snapshot (booked before costs were kept, or when no cost was
 * recorded) reads as "cost not kept" and is left out of the totals: it is
 * never costed at today's lot cost, which would let a later invoice move a
 * closed check's margin.
 *
 * Like with like (r110 g5). With the check's facts, a line's revenue is what
 * the house took for it, not the price rung:
 *  - DISCOUNT. When the subtotal S is stated and every line on the check sums
 *    to G > 0 with S <= G, each line's net is its rung x S/G, split in cents
 *    by largest remainder over the wine lines and the rest of the check, so
 *    the check's nets sum to S exactly. No S (or no G): rung revenue, and
 *    'discount not stated'. S > G: no split, 'the subtotal is above the lines'.
 *  - TAX, only in a prices_include_tax house: the net is divided by (1 + r)
 *    only when r is stated, by the till on the line or as the check's tax
 *    (then the split target is S - tax). Otherwise the line's margin is
 *    withheld, 'tax inside the price not known', never at a guessed rate.
 *  - COST is used as stamped. In a house that stated a basis, a line whose
 *    lot never said its cost_tax_basis adds 'cost tax basis not stated'.
 * Without facts (older callers) the rung revenue is read as before.
 */
export function checkMarginFromRows(
  rows: ConsumptionCostRow[],
  facts?: CheckFacts,
): CheckMargin {
  type Work = CheckMarginLine & {
    rungCents: number | null;
    rate: number | null;
    basisMissing: boolean;
  };
  const work: Work[] = [];
  let voidedLines = 0;
  let restatedLines = 0;
  for (const r of rows) {
    if (Number(r.quantity) === 0 && Number(r.volume_ml) === 0) {
      voidedLines++;
      continue;
    }
    const c = num(r.cost_at_sale);
    const rev = num(r.total_revenue);
    const costKept = c !== null;
    const restated = costKept && r.cost_basis === RESTATED_BASIS;
    if (restated) restatedLines++;
    let costNote: string | null = null;
    if (!costKept) costNote = "cost not kept";
    else if (rev === null) costNote = "price not kept";
    else if (restated) costNote = "cost restated to the invoice";
    const rate = num(r.tax_rate_percent);
    work.push({
      wine: r.wine_name ?? null,
      volumeMl: num(r.volume_ml) ?? 0,
      revenue: rev,
      rungRevenue: rev,
      cost: c,
      costKept,
      costNote,
      restated,
      taxWithheld: false,
      rungCents: rev === null ? null : toCents(rev),
      rate: rate !== null && rate >= 0 ? rate : null,
      basisMissing:
        !!facts?.taxBasis && costKept && r.cost_tax_basis == null,
    });
  }

  // DISCOUNT (and a check-level stated tax) — one split over the check.
  let discountWords: string | null = null;
  let checkTaxTaken = false;
  const includeTax = facts?.taxBasis === "prices_include_tax";
  if (facts) {
    const S = facts.subtotal;
    const G = facts.rungTotal;
    const priced = work.filter((l) => l.rungCents !== null);
    const wineCents = priced.reduce((a, l) => a + (l.rungCents as number), 0);
    if (S === null || G === null) {
      discountWords = DISCOUNT_NOT_STATED;
    } else if (toCents(G) <= 0) {
      // only voided or comped lines: nothing to divide
    } else if (toCents(S) > toCents(G)) {
      discountWords = SUBTOTAL_ABOVE_LINES;
    } else if (wineCents > toCents(G)) {
      // the wine lines alone are above every line on the check: the check's
      // own lines were not all kept, so no share can be told
      discountWords = DISCOUNT_NOT_STATED;
    } else {
      const T =
        includeTax && facts.statedTax !== null && facts.statedTax >= 0
          ? facts.statedTax
          : null;
      const target = toCents(S) - (T !== null ? toCents(T) : 0);
      if (target >= 0) {
        const shares = allocateCents(
          [...priced.map((l) => l.rungCents as number), toCents(G) - wineCents],
          target,
        );
        priced.forEach((l, k) => {
          l.revenue = shares[k] / 100;
        });
        checkTaxTaken = T !== null;
      } else {
        discountWords = DISCOUNT_NOT_STATED;
      }
    }
  }

  // TAX inside the price — only a stated rate takes it out.
  if (includeTax && !checkTaxTaken) {
    for (const l of work) {
      if (l.revenue === null) continue;
      if (l.rate !== null) {
        l.revenue = Math.round((l.revenue * 100) / (1 + l.rate / 100)) / 100;
      } else {
        l.taxWithheld = true;
        if (l.costKept) l.costNote = TAX_NOT_KNOWN;
      }
    }
  }

  let revenue = 0;
  let cost = 0;
  let linesWithoutCost = 0;
  let costTaxBasisMissing = 0;
  const lines: CheckMarginLine[] = work.map((l) => {
    const { rungCents: _r, rate: _t, basisMissing: missingBasis, ...line } = l;
    if (!line.costKept) linesWithoutCost++;
    if (line.costKept && line.revenue !== null && !line.taxWithheld) {
      revenue += line.revenue;
      cost += line.cost as number;
    }
    if (missingBasis) {
      costTaxBasisMissing++;
      line.costNote = line.costNote
        ? `${line.costNote}; ${COST_TAX_BASIS_NOT_STATED}`
        : COST_TAX_BASIS_NOT_STATED;
    }
    return line;
  });
  const counted = lines.filter(
    (l) => l.costKept && l.revenue !== null && !l.taxWithheld,
  ).length;
  const withheld = lines.filter(
    (l) => l.costKept && l.revenue !== null && l.taxWithheld,
  ).length;
  const margin = counted > 0 ? round4(revenue - cost) : null;
  const marginPct =
    margin !== null && revenue > 0
      ? Math.round((margin / revenue) * 1000) / 10
      : null;
  const unknown = lines.length - counted - withheld;
  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  let base: string;
  if (lines.length === 0) base = "No wine lines on this check.";
  else if (withheld === 0)
    base =
      unknown === 0
        ? "Every line's cost was kept when it sold."
        : `Cost or price was not kept for ${unknown} of ${plural(lines.length)}; the margin covers only the other ${counted}.`;
  else
    base =
      (unknown > 0
        ? `Cost or price was not kept for ${unknown} of ${plural(lines.length)}. `
        : "") +
      `The tax inside the price is not known for ${plural(withheld)}, so ${withheld === 1 ? "its" : "their"} margin is withheld; the margin covers only the other ${counted}.`;
  const parts = [base];
  if (restatedLines > 0)
    parts.push(
      `${plural(restatedLines)} ${restatedLines === 1 ? "was" : "were"} restated to the invoice cost once the invoice was checked.`,
    );
  if (discountWords === DISCOUNT_NOT_STATED && lines.length > 0)
    parts.push(
      "The check's discount was not stated, so each line reads at the price rung.",
    );
  if (discountWords === SUBTOTAL_ABOVE_LINES && lines.length > 0)
    parts.push(
      "The check's subtotal is above the lines, so each line reads at the price rung.",
    );
  if (checkTaxTaken)
    parts.push("The tax the till stated is taken out of each line's price.");
  if (costTaxBasisMissing > 0)
    parts.push(
      `The cost tax basis was not stated for ${plural(costTaxBasisMissing)}.`,
    );
  return {
    lines,
    voidedLines,
    revenue: round4(revenue),
    cost: round4(cost),
    margin,
    marginPct,
    linesWithoutCost,
    restatedLines,
    sentence: parts.join(" "),
  };
}
