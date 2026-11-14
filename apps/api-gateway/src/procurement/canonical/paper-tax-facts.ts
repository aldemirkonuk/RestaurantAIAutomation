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
 *   EACH LINE'S OWN RATE (r35)
 *   - A paper that prints a rate BESIDE EACH LINE (a Turkish till receipt's
 *     "%10", an e-Fatura line's own percent) says which line carries which,
 *     so a paper of several rates can be costed line by line. The rates read
 *     off the lines are used only when they make the tax the paper prints,
 *     line by line, worked the way `landedCost` works it, and agree with any
 *     per-rate row it prints. Every line must print one; a paper of several
 *     rates must carry no charge or discount, whose rate it does not say.
 *   - They can also PROVE "tax inside" without printed bases: when the lines
 *     add up to the total, and their rates make the printed tax only when the
 *     prices hold it (and not when they are before tax), the total cannot be
 *     a pre-tax one. Both readings must be told apart by more than the
 *     tolerance, or nothing is read: at 1 % on a small paper they are not.
 *   - When the lines' rates prove nothing, the paper-wide reading above runs
 *     exactly as before, and the reason is added to the note.
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
  /**
   * Each line's own rate, in the order the lines were given, when the rates
   * printed beside the lines are proven (r35). Null otherwise: then every line
   * takes `ratePercent`.
   */
  lineRates: number[] | null;
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
  /** The rate printed beside this line (`extracted->lines[].vatRatePercent`). */
  printedRatePercent?: number | null;
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

const NOTHING: PaperTaxFacts = { basis: null, ratePercent: null, lineRates: null, said: "" };

/**
 * `extracted->lines[].vatRatePercent` by line number: the rate the reader saw
 * printed beside each line. A value that is not a rate is not kept.
 */
export function snapshotLineRates(extracted: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const rows = extracted && typeof extracted === "object" ? (extracted as Record<string, unknown>).lines : null;
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const o = (r ?? {}) as Record<string, unknown>;
    const lineNo = num(o.lineNo);
    const rate = num(o.vatRatePercent);
    if (lineNo == null || rate == null || !(rate >= 0 && rate < 100)) continue;
    out.set(lineNo, rate);
  }
  return out;
}

/** The tax a printed amount holds at a rate, worked as `landedCost` works it. */
const taxOf = (amount: number, basis: PrintedTaxBasis, ratePercent: number): number => {
  if (ratePercent === 0) return 0;
  const r = ratePercent / 100;
  return basis === "includes_tax" ? amount - amount / (1 + r) : amount * r;
};

type OwnRates =
  | { ok: true; basis: PrintedTaxBasis; rates: number[]; single: number | null; how: string; said: string }
  | { ok: false; said: string };

/**
 * The rates printed beside the lines, proven against the paper's own tax.
 * `basis` is what the paper-wide reading already proved (null: not proven);
 * `insideOnly` says its sums tie only as "tax inside", which the rates may
 * then prove. Returns `{ok:false}` with a sentence (or "") when they prove
 * nothing.
 */
function ownRates(
  lines: PaperTaxLine[],
  T: number | null,
  G: number | null,
  C: number,
  D: number,
  rows: BreakdownRow[] | null,
  basis: PrintedTaxBasis | null,
  insideOnly: boolean,
): OwnRates {
  const printed = lines.map((l) => l.printedRatePercent ?? null);
  if (!printed.some((r) => r != null)) return { ok: false, said: "" };
  const no = (said: string): OwnRates => ({ ok: false, said });
  const missing = printed.findIndex((r) => r == null);
  if (missing >= 0)
    return no(`Line ${lines[missing].input.line_no} prints no tax rate beside it, so the rates beside its other lines are not used.`);
  const rates = printed as number[];
  if (rates.some((r) => !(r >= 0 && r < 100))) return no("A rate printed beside a line is not a rate, so none is used.");
  if (T == null || !lines.every((l) => l.kind === "value")) return { ok: false, said: "" };
  const distinct = [...new Set(rates)];
  const single = distinct.length === 1 ? distinct[0] : null;
  if (single == null && (C > 0 || D > 0))
    return no(
      `Its lines print ${distinct.length} tax rates, and it does not say which rate its charges or discount carry, so the rates beside its lines are not used.`,
    );
  const values: number[] = [];
  for (const l of lines) {
    const v = reconcileLineValue({ ...l.input, accepted_bottles: 0 });
    if (!v.ok) return { ok: false, said: "" };
    values.push(v.net);
  }
  const worked = (b: PrintedTaxBasis) =>
    values.reduce((s, v, i) => s + taxOf(v, b, rates[i]), 0) +
    (single != null ? taxOf(C, b, single) - taxOf(D, b, single) : 0);
  // The landed rule's own tie-out allows 0.01 a part; this allows no more.
  const tol = 0.01 * (lines.length + 1);
  const ties = (b: PrintedTaxBasis) => Math.abs(worked(b) - T) <= tol;

  let b: PrintedTaxBasis | null = basis;
  let how = "";
  if (!b) {
    if (!insideOnly || G == null) return { ok: false, said: "" };
    if (!(ties("includes_tax") && !ties("excludes_tax")))
      return no(
        ties("excludes_tax")
          ? `The rates beside its lines make its tax of ${m(T)} only if its prices are before tax, while its lines add up to its total, so neither reading is used.`
          : `The rates beside its lines make tax of ${m(worked("includes_tax"))}, not the ${m(T)} it prints, so none is used.`,
      );
    b = "includes_tax";
    how = `Its prices are read as including tax, since its lines add up to its total of ${m(G)} and the rates printed beside them make its tax of ${m(T)} only with the tax inside (before tax they would make ${m(worked("excludes_tax"))}).`;
  } else if (!ties(b)) {
    return no(`The rates beside its lines make tax of ${m(worked(b))}, not the ${m(T)} it prints, so none is used.`);
  }

  const proven: PrintedTaxBasis = b;
  // Any per-rate row the paper prints must agree with its lines at that rate.
  const rated = (rows ?? []).filter((r) => r.rate != null);
  if (rated.length) {
    const printedRates = new Set(rated.map((r) => r.rate as number));
    const stray = distinct.find((r) => !printedRates.has(r));
    if (stray != null)
      return no(`A line prints ${pct(stray)}, a rate its tax rows do not print, so the rates beside its lines are not used.`);
    for (const r of printedRates) {
      const mine = rated.filter((x) => x.rate === r);
      const at = values.map((v, i) => (rates[i] === r ? v : null)).filter((v): v is number => v != null);
      const k = at.length + mine.length;
      const chargeBase = single != null ? C - D : 0;
      const amounts = mine.every((x) => x.amount != null) ? mine.reduce((s, x) => s + (x.amount as number), 0) : null;
      const workedAt = at.reduce((s, v) => s + taxOf(v, proven, r), 0) + (single != null ? taxOf(chargeBase, proven, r) : 0);
      if (amounts != null && Math.abs(workedAt - amounts) > 0.01 * (k + 1))
        return no(`Its lines at ${pct(r)} make tax of ${m(workedAt)}, but its tax row for ${pct(r)} prints ${m(amounts)}, so the rates beside its lines are not used.`);
      const bases = mine.every((x) => x.base != null) ? mine.reduce((s, x) => s + (x.base as number), 0) : null;
      const before = (v: number) => (proven === "includes_tax" ? v / (1 + r / 100) : v);
      const baseAt = at.reduce((s, v) => s + before(v), 0) + (single != null ? before(chargeBase) : 0);
      if (bases != null && Math.abs(baseAt - bases) > 0.01 * (k + 1))
        return no(`Its lines at ${pct(r)} come to ${m(baseAt)} before tax, but its tax row for ${pct(r)} prints a base of ${m(bases)}, so the rates beside its lines are not used.`);
    }
  }

  const groups = distinct
    .slice()
    .sort((x, y) => x - y)
    .map((r) => {
      const c = rates.filter((x) => x === r).length;
      return `${pct(r)} on ${c} line${c === 1 ? "" : "s"}`;
    });
  return {
    ok: true,
    basis: proven,
    rates,
    single,
    how,
    said:
      single != null
        ? `Every line prints ${pct(single)} beside it, which makes its tax of ${m(T)}.`
        : `Each line is at the rate printed beside it (${groups.join(", ")}), which makes its tax of ${m(T)}.`,
  };
}

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
  let insideOnly = false;
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
        insideOnly = true;
        how = `Whether its prices include tax is not read: its lines add up to its total of ${m(G)}, but it prints no base for its tax, so its total could be before tax.`;
      }
    }
  }

  // EACH LINE'S OWN RATE first: when proven, it decides every line's rate,
  // and may prove "tax inside" where the sums alone could not.
  const own = ownRates(lines, T, G, C, D, rows, basis, insideOnly);
  if (own.ok) {
    const lead = own.how || how;
    return {
      basis: own.basis,
      ratePercent: own.single,
      lineRates: own.rates,
      said: `${lead} ${own.said}`,
    };
  }
  const also = (s: string) => (own.said ? `${s} ${own.said}`.trim() : s);
  if (!basis) return how || own.said ? { ...NOTHING, said: also(how) } : NOTHING;

  // RATE
  const rated = (rows ?? []).filter((r) => r.rate != null);
  if (rated.length !== 1) {
    return {
      basis,
      ratePercent: null,
      lineRates: null,
      said: also(
        rated.length > 1
          ? `${how} It prints ${rated.length} tax rates and not which line carries which, so no line is given a rate.`
          : how,
      ),
    };
  }
  const r = rated[0].rate as number;
  if (!(r >= 0 && r < 100) || T == null || !lines.every((l) => l.kind === "value"))
    return { basis, ratePercent: null, lineRates: null, said: also(how) };
  let base = C - D;
  for (const l of lines) {
    const v = reconcileLineValue({ ...l.input, accepted_bottles: 0 });
    if (!v.ok) return { basis, ratePercent: null, lineRates: null, said: also(how) };
    base += v.net;
  }
  const rr = r / 100;
  const worked = r === 0 ? 0 : basis === "includes_tax" ? base - base / (1 + rr) : base * rr;
  // The landed rule's own tie-out allows 0.01 a part; this allows less.
  if (Math.abs(worked - T) > 0.01 * (n + 1))
    return {
      basis,
      ratePercent: null,
      lineRates: null,
      said: also(`${how} Its one printed rate of ${pct(r)} does not make its tax of ${m(T)} from its lines, so no line is given it.`),
    };
  return {
    basis,
    ratePercent: r,
    lineRates: null,
    said: also(`${how} Every line is at ${pct(r)}, the one rate it prints, which makes its tax of ${m(T)}.`),
  };
}
