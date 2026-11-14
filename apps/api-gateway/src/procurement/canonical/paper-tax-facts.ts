/**
 * What one supplier paper says about its own tax, read from the figures it
 * printed (ADR 0359 C3, cost-math lane 3.5a).
 *
 * `landedCost` already knows the rule: a reclaiming house costs a line before
 * tax, one that does not costs it with tax. What it needs per line is whether
 * the printed price has the tax inside it, and at what rate. No column holds
 * either, and every line was fed `null`, so every lot was "costed as printed".
 *
 * This reads both from what the paper itself proves, and nothing else:
 *
 *   BASIS
 *   - An e-invoice FILE (e-Fatura, e-Arşiv) prices every line before tax:
 *     UBL's `LineExtensionAmount` is the net amount (EN 16931 BT-131).
 *   - Otherwise the paper's own sums decide, and only when one reading adds up
 *     and the other does not:
 *       before tax: lines + charges − discount + tax = total;
 *       tax inside: lines + charges − discount = total, AND the tax rows'
 *         printed bases add up to total − tax. The second half matters: a
 *         paper read with its pre-tax total in the "total" box also has its
 *         lines adding up to that total, and only the printed base tells the
 *         two apart. Without bases, "tax inside" is never inferred, because
 *         being wrong there costs a reclaiming house too LOW.
 *   RATE
 *   - Only when the paper prints exactly ONE rate, every line is stock with a
 *     value, and the printed tax is what that one rate makes of them, worked
 *     the way `landedCost`'s own tie-out works it (so the rule never holds a
 *     paper over a rate this file gave it). A paper with two rates does not
 *     say which line carries which, and no line is given one.
 *
 * Never: a rate from the country's tables (C3: "the purchase rate is not
 * assumed to be the sales rate"), a rate from dividing the tax by a total, or
 * a basis from the language of the paper.
 */
import {
  CHARGE_FIELDS,
  LandedCostLineInput,
  PrintedTaxBasis,
  reconcileLineValue,
} from "../landed-cost";

export interface PaperTaxFacts {
  basis: PrintedTaxBasis | null;
  /** Percent, e.g. 10 for KDV %10. Null: not proven for every line. */
  ratePercent: number | null;
  /** One sentence for the paper's note: what was read, and from what. */
  said: string;
}

/** The figures of one paper this reading uses. */
export interface PaperTaxFigures {
  tax?: number | string | null;
  total?: number | string | null;
  discount_total?: number | string | null;
  deposit_total?: number | string | null;
  freight?: number | string | null;
  fuel_surcharge?: number | string | null;
  split_case_fee?: number | string | null;
  delivery_fee?: number | string | null;
  other_charges?: number | string | null;
  /** `extracted->taxBreakdown`: [{rate, taxableBase, amount, category}]. */
  tax_breakdown?: unknown;
  /** `extracted->einvoice`: set only when the paper was read from the file. */
  einvoice?: unknown;
}

/** One line of the paper as the landed rule will see it. */
export interface PaperTaxLine {
  /** `value`: stock with a price; `not_stocked`: a deposit or fee line; `open`: unpriced. */
  kind: "value" | "not_stocked" | "open";
  /** The printed line total, as stored. */
  printedTotal: number | null;
  /** What `landedCost` will read the line as (for the rate's tie-out). */
  input: Omit<LandedCostLineInput, "accepted_bottles">;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const m = (n: number): string => n.toFixed(2);
const pct = (r: number): string => `${Number(r.toFixed(3))} %`;

interface BreakdownRow {
  rate: number | null;
  base: number | null;
  amount: number | null;
}

function breakdownRows(v: unknown): BreakdownRow[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { rate: num(o.rate), base: num(o.taxableBase), amount: num(o.amount) };
  });
}

function isEinvoiceFile(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const kind = (v as Record<string, unknown>).kind;
  return kind === "e-fatura" || kind === "e-arsiv" ? kind : null;
}

const NOTHING: PaperTaxFacts = { basis: null, ratePercent: null, said: "" };

export function paperTaxFacts(paper: PaperTaxFigures, lines: PaperTaxLine[]): PaperTaxFacts {
  const T = num(paper.tax);
  const G = num(paper.total);
  const D = Math.max(0, num(paper.discount_total) ?? 0);
  const C = CHARGE_FIELDS.reduce((s, f) => s + Math.max(0, num(paper[f]) ?? 0), 0);
  const rows = breakdownRows(paper.tax_breakdown);
  const n = lines.length;

  // BASIS
  let basis: PrintedTaxBasis | null = null;
  let how = "";
  const file = isEinvoiceFile(paper.einvoice);
  if (file) {
    basis = "excludes_tax";
    how = `Its prices are read as before tax, since it was read from its ${file === "e-fatura" ? "e-Fatura" : "e-Arşiv"} file, which states every line before tax.`;
  } else if (
    T != null &&
    G != null &&
    n > 0 &&
    !((num(paper.deposit_total) ?? 0) > 0) &&
    lines.every((l) => l.printedTotal != null)
  ) {
    const tol = 0.01 * (n + 2);
    const L = lines.reduce((s, l) => s + (l.printedTotal as number), 0);
    if (T > tol) {
      const before = Math.abs(L + C - D + T - G) <= tol;
      const inside = Math.abs(L + C - D - G) <= tol;
      const bases = rows && rows.length > 0 && rows.every((r) => r.base != null)
        ? rows.reduce((s, r) => s + (r.base as number), 0)
        : null;
      if (before && !inside) {
        basis = "excludes_tax";
        how = `Its prices are read as before tax, since its lines${C || D ? ", charges and discount" : ""} of ${m(L + C - D)} and its tax of ${m(T)} add up to its total of ${m(G)}.`;
      } else if (inside && !before && bases != null && Math.abs(bases - (G - T)) <= tol) {
        basis = "includes_tax";
        how = `Its prices are read as including tax, since its lines add up to its total of ${m(G)} and the tax it prints, ${m(T)}, is on a base of ${m(bases)}.`;
      } else if (inside && !before) {
        how = `Whether its prices include tax is not read: its lines add up to its total of ${m(G)}, but it prints no base for its tax, so its total could be before tax.`;
      }
    }
  }
  if (!basis) return how ? { ...NOTHING, said: how } : NOTHING;

  // RATE
  const rated = (rows ?? []).filter((r) => r.rate != null);
  if (rated.length !== 1) {
    return {
      basis,
      ratePercent: null,
      said: rated.length > 1
        ? `${how} It prints ${rated.length} tax rates and not which line carries which, so no line is given a rate.`
        : how,
    };
  }
  const r = rated[0].rate as number;
  if (!(r >= 0 && r < 100) || T == null || !lines.every((l) => l.kind === "value"))
    return { basis, ratePercent: null, said: how };
  let base = C - D;
  for (const l of lines) {
    const v = reconcileLineValue({ ...l.input, accepted_bottles: 0 });
    if (!v.ok) return { basis, ratePercent: null, said: how };
    base += v.net;
  }
  const rr = r / 100;
  const worked = r === 0 ? 0 : basis === "includes_tax" ? base - base / (1 + rr) : base * rr;
  // The landed rule's own tie-out allows 0.01 a part; this allows less.
  if (Math.abs(worked - T) > 0.01 * (n + 1))
    return {
      basis,
      ratePercent: null,
      said: `${how} Its one printed rate of ${pct(r)} does not make its tax of ${m(T)} from its lines, so no line is given it.`,
    };
  return {
    basis,
    ratePercent: r,
    said: `${how} Every line is at ${pct(r)}, the one rate it prints, which makes its tax of ${m(T)}.`,
  };
}
