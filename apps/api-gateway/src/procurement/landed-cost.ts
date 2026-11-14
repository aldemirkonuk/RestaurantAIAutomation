/**
 * Landed cost: ONE rule for what a bottle on a supplier's paper cost the house.
 * Cost-math proposal lane 1.2, forks F2, F3, F14 (the session's calls under the
 * founder's /goal of 2026-11-07). PURE and UNWIRED: imports nothing; lanes 1.3
 * and 1.4 wire it. The caller converts units: bottles are bottles, and
 * `price_base_qty` is the printed price base (BT-149) in the line's `uom`.
 *
 * - Net line value = the printed `line_total` once it reconciles with
 *   qty × price ÷ base, the `allowance` and the `deposit`: the allowance comes
 *   off only when the total is the gross, never twice. No total printed →
 *   qty × price ÷ base − allowance. Any other mismatch is unresolved.
 * - Charges and the header discount (negative) are shared over the STOCKED
 *   lines by net line value (F3).
 * - Deposits are never value (F14). A free-goods line adds bottles, no
 *   value, and dilutes its item (pooled by `item_key`).
 * - Tax (KDV) follows ADR 0359 C3: each line states whether its price holds
 *   the tax and at what rate. A reclaiming house costs it before tax (`net`),
 *   any other house with tax (`gross_cost`); what is missing costs as printed,
 *   stamped null, with the reason.
 * - Short or rejected units are not in cost (F2): cost per bottle = landed
 *   value of the ACCEPTED bottles ÷ accepted bottles. The claim is not here.
 */

/** `restaurants.tax_basis`, spelled as ADR 0359 C2 spells it (Proposed, not built). */
export type HouseTaxBasis =
  | "unset"
  | "prices_include_tax"
  | "prices_exclude_tax"
  | "not_vat_charging";

/** The house's two tax answers (ADR 0359 C2). */
export interface HouseTax {
  tax_basis: HouseTaxBasis;
  /** `restaurants.reclaims_input_tax`: null until the house answers. */
  reclaims_input_tax: boolean | null;
}

/** Whether a price printed on the paper has the tax inside it. */
export type PrintedTaxBasis = "includes_tax" | "excludes_tax";

/** `inventory_lots.cost_tax_basis` (ADR 0359 C3): what a cost holds. */
export type CostTaxBasis = "net" | "gross_cost" | null;

/** `procurement_documents` money columns (baseline, around line 4443). */
export interface LandedCostHeader {
  subtotal: number | null;
  discount_total: number | null;
  freight: number | null;
  fuel_surcharge: number | null;
  split_case_fee: number | null;
  delivery_fee: number | null;
  other_charges: number | null;
  deposit_total: number | null;
  /** The tax the paper prints (BT-110). Cross-checked, never added as cost. */
  tax: number | null;
  /** Whether the charges and the discount above are printed with tax inside. Null: the paper does not say. */
  charges_tax_basis: PrintedTaxBasis | null;
  /** The tax rate on the charges and the discount, a percentage. Null: not printed. */
  charges_vat_rate_percent: number | null;
}

/** One `procurement_document_lines` row (baseline, around line 4391) plus the door's count. */
export interface LandedCostLineInput {
  line_no: number;
  qty: number | null;
  uom: string | null;
  pack_size: number | null;
  /** BT-149 printed price base, in `uom`. Null means "per one". */
  price_base_qty: number | null;
  unit_price: number | null;
  line_total: number | null;
  allowance: number | null;
  deposit: number | null;
  /**
   * Whether this line's printed price and total have the tax inside them.
   * Required, so a caller has to say; null means the paper does not say.
   */
  price_tax_basis: PrintedTaxBasis | null;
  /** BT-152: this line's tax rate, a percentage (20 for 20 %). Null: not printed. */
  vat_rate_percent: number | null;
  /** Bottles this line lists, paid or free, converted by the caller. */
  listed_bottles: number | null;
  /** Bottles the house accepted from this line. */
  accepted_bottles: number;
  /** False for a line that is not stock (a service, a crate). Default true. */
  stocked?: boolean;
  /** Lines with the same key are one item: their cost per bottle is pooled. */
  item_key?: string | null;
  /**
   * The unit `listed_bottles` and `accepted_bottles` count, in words only: the
   * caller has already converted. Absent is `bottle`. A weighed line costed per
   * one of its item's unit (R8) passes that unit (`g`, `kg`, `mg`), so the
   * sentences say "3000 grams … 0.45 a gram", never "3000 bottles" (browser
   * walk 2026-11-12).
   */
  unit?: string | null;
}

export interface LandedCostInput {
  header: LandedCostHeader;
  lines: LandedCostLineInput[];
  house: HouseTax;
}

export interface CostedLine {
  line_no: number;
  status: "costed";
  item_key: string | null;
  /** The line's value as printed, after its allowance and without its deposit. */
  net_line_value: number;
  /** The line's value once tax is treated by ADR 0359 C3; what is shared and landed. */
  cost_value: number;
  /** Tax inside `cost_value`, because the house does not reclaim it. Null: not known. */
  tax_in_cost: number | null;
  /** Tax printed inside the price and taken out, because the house reclaims it. */
  tax_taken_out: number | null;
  cost_tax_basis: CostTaxBasis;
  /** Zero or negative: this line's share of the header discount. */
  discount_share: number;
  charge_share: number;
  landed_value: number;
  listed_bottles: number;
  accepted_bottles: number;
  accepted_landed_value: number;
  /** Null when no bottle was accepted from this line. */
  landed_cost_per_bottle: number | null;
  /** The noun its counts are in: `bottle`, `gram`, `keg`, … (`unitNoun`). */
  unit: string;
  basis: string;
}

export interface NotStockedLine {
  line_no: number;
  status: "not_stocked";
  item_key: string | null;
  basis: string;
}

export interface UnresolvedLine {
  line_no: number;
  status: "unresolved";
  item_key: string | null;
  unresolved: string;
}

export type LandedLine = CostedLine | NotStockedLine | UnresolvedLine;

export type LandedItem =
  | {
      item_key: string;
      status: "costed";
      accepted_bottles: number;
      accepted_landed_value: number;
      landed_cost_per_bottle: number | null;
      /** One stamp when every line agrees, else null. */
      cost_tax_basis: CostTaxBasis;
      basis: string;
    }
  | { item_key: string; status: "unresolved"; unresolved: string };

export interface LandedCostResult {
  house: HouseTax;
  /** The paper's charges and discount as printed. */
  charges_total: number;
  discount_total: number;
  /** What this paper carries that is never value, in plain words. */
  left_out: string;
  /** What was done with the paper's tax, in plain words. */
  tax_said: string;
  lines: LandedLine[];
  items: LandedItem[];
}

/** The header fields that are charges. Deposits and tax are NOT here (F14). */
export const CHARGE_FIELDS = [
  "freight",
  "fuel_surcharge",
  "split_case_fee",
  "delivery_fee",
  "other_charges",
] as const;

const CHARGE_WORDS: Record<(typeof CHARGE_FIELDS)[number], string> = {
  freight: "freight",
  fuel_surcharge: "fuel",
  split_case_fee: "split case",
  delivery_fee: "delivery",
  other_charges: "other charges",
};

const m = (n: number): string => n.toFixed(2);
const isNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);
const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The noun a count is said in. A unit symbol a house item is kept in reads as
 * its word ("3000 grams", "0.45 a gram"); a container reads as itself; nothing
 * stated is a bottle, as every caller before R8 meant.
 */
export function unitNoun(unit: string | null | undefined): string {
  switch (unit) {
    case "g":
    case "gram":
      return "gram";
    case "kg":
    case "kilogram":
      return "kilogram";
    case "mg":
    case "milligram":
      return "milligram";
    case "keg":
      return "keg";
    case "liter":
      return "liter";
    default:
      return "bottle";
  }
}

/**
 * Share `total` (money) over `weights` in whole cents, by largest remainder:
 * each part gets the floor of its exact share in cents, and the cents still
 * left go one each to the parts with the largest remainders (ties to the
 * earlier part). So the parts always add back to `total` rounded to the cent,
 * and a part never moves more than one cent from its exact share. A charge
 * shared in floats and rounded per bottle can lose all of itself on a large
 * cheap line (QA round 15: 4.90 freight over 1000 bottles at 10).
 */
export function shareByLargestRemainder(
  total: number,
  weights: number[],
): number[] {
  const cents = Math.round(total * 100);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (!(sum > 0) || cents === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (cents * w) / sum);
  const floors = exact.map((e) => Math.floor(e + 1e-9));
  let left = cents - floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - floors[i] }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors.map((c) => c / 100);
}

type Reconciled =
  | { ok: true; net: number; how: string }
  | { ok: false; sentence: string };

/**
 * The reconcile step: what the printed line is worth, net of its own
 * allowance and with its deposit taken out, or why that cannot be said.
 */
export function reconcileLineValue(line: LandedCostLineInput): Reconciled {
  const label = `Line ${line.line_no}`;
  const { qty, unit_price: price, line_total: total } = line;
  const allowance = line.allowance ?? 0;
  const deposit = line.deposit ?? 0;
  const base = line.price_base_qty ?? 1;
  const uom = line.uom ?? "unit";

  const bad = (v: number | null) => v != null && (!isNum(v) || v < 0);
  if (
    [qty, price, total, allowance, deposit].some(bad) ||
    !(isNum(base) && base > 0)
  ) {
    return {
      ok: false,
      sentence: `${label} prints a figure that is negative or not a number, so it cannot be read as stock this paper delivered.`,
    };
  }

  const perBase = base === 1 ? "" : ` per ${base} ${uom}`;
  const gross = qty != null && price != null ? (qty * price) / base : null;

  if (total == null) {
    if (gross == null) {
      return {
        ok: false,
        sentence: `${label} prints neither a line total nor a quantity and unit price, so it has no value to cost.`,
      };
    }
    const net = gross - allowance;
    if (net < -0.005) {
      return {
        ok: false,
        sentence: `${label}'s allowance of ${m(allowance)} is more than its ${m(gross)} before allowance.`,
      };
    }
    return {
      ok: true,
      net: Math.max(0, net),
      how:
        `worked out as ${qty} ${uom} at ${m(price as number)}${perBase}` +
        (allowance > 0 ? ` less an allowance of ${m(allowance)}` : "") +
        `, since no line total is printed`,
    };
  }

  if (gross == null) {
    if (allowance === 0 && deposit === 0) {
      return {
        ok: true,
        net: total,
        how: `the line total of ${m(total)} as printed`,
      };
    }
    return {
      ok: false,
      sentence: `${label} prints a total of ${m(total)} and an allowance or deposit but no quantity and price, so it cannot be told whether the total is before or after them.`,
    };
  }

  // Which reading of the printed total does it match? Every reading that
  // matches implies the same net (gross − allowance), so the first wins and
  // the sentence names it.
  const tol = 0.01 + Math.abs(qty as number) * 0.00005;
  const readings: { allowanceTaken: boolean; depositIn: boolean }[] = [
    { allowanceTaken: false, depositIn: false },
    { allowanceTaken: true, depositIn: false },
    { allowanceTaken: false, depositIn: true },
    { allowanceTaken: true, depositIn: true },
  ];
  for (const r of readings) {
    if (r.allowanceTaken && allowance === 0) continue;
    if (r.depositIn && deposit === 0) continue;
    const expected =
      gross - (r.allowanceTaken ? allowance : 0) + (r.depositIn ? deposit : 0);
    if (Math.abs(total - expected) > tol) continue;
    const net =
      total - (r.allowanceTaken ? 0 : allowance) - (r.depositIn ? deposit : 0);
    if (net < -tol) break;
    const parts = [`the line total of ${m(total)} as printed`];
    if (allowance > 0) {
      parts.push(
        r.allowanceTaken
          ? `already after its allowance of ${m(allowance)}, so that is not taken off again`
          : `before its allowance of ${m(allowance)}, which comes off once`,
      );
    }
    if (r.depositIn)
      parts.push(`with its deposit of ${m(deposit)} taken back out`);
    return { ok: true, net: Math.max(0, net), how: parts.join(", ") };
  }

  const after = gross - allowance;
  return {
    ok: false,
    sentence:
      `${label} does not add up: ${qty} ${uom} at ${m(price as number)}${perBase} is ${m(gross)}` +
      (allowance > 0
        ? `, ${m(after)} after its allowance of ${m(allowance)}`
        : "") +
      (deposit > 0 ? `, with a deposit of ${m(deposit)}` : "") +
      `, but the paper prints ${m(total)}. Its cost stays open until someone reads the paper.`,
  };
}

/** Whether the house reclaims the tax it pays (ADR 0359 C2, C3), or why that is not known. */
export type Reclaim =
  | { reclaims: boolean; why?: undefined }
  | { reclaims: null; why: string };

export function houseReclaims(house: HouseTax): Reclaim {
  if (house.tax_basis === "not_vat_charging") return { reclaims: false };
  if (house.tax_basis === "unset") {
    return { reclaims: null, why: "the house has not set its tax basis" };
  }
  if (house.reclaims_input_tax == null) {
    return {
      reclaims: null,
      why: "the house has not said whether it reclaims the tax it pays",
    };
  }
  return { reclaims: house.reclaims_input_tax };
}

type TaxTreated =
  | {
      ok: true;
      cost: number;
      tax_in_cost: number | null;
      tax_taken_out: number | null;
      stamp: CostTaxBasis;
      said: string;
    }
  | { ok: false; sentence: string };

/**
 * ADR 0359 C3 on one printed amount: cost before tax for a house that
 * reclaims it, cost with tax for one that does not. Whether the paper printed
 * the tax inside or outside the price only changes the arithmetic, never the
 * answer. What cannot be worked out costs as printed, stamped null.
 */
export function treatTax(
  amount: number,
  basis: PrintedTaxBasis | null,
  ratePercent: number | null,
  reclaim: Reclaim,
  what: string,
): TaxTreated {
  if (
    ratePercent != null &&
    !(isNum(ratePercent) && ratePercent >= 0 && ratePercent < 100)
  ) {
    return {
      ok: false,
      sentence: `${what} prints a tax rate that is not a rate, so its cost cannot be said.`,
    };
  }
  const r = ratePercent == null ? null : ratePercent / 100;
  let pre: number | null = null; // the amount before tax
  let gross: number | null = null; // the amount with tax
  if (r === 0) {
    pre = amount;
    gross = amount;
  } else if (basis === "includes_tax") {
    gross = amount;
    if (r != null) pre = amount / (1 + r);
  } else if (basis === "excludes_tax") {
    pre = amount;
    if (r != null) gross = amount * (1 + r);
  }
  const missing =
    basis == null && r !== 0
      ? "the paper does not say whether its price includes tax"
      : "the paper prints no tax rate for it";
  const done = (
    cost: number,
    stamp: CostTaxBasis,
    said: string,
  ): TaxTreated => ({
    ok: true,
    cost,
    tax_in_cost: pre == null ? null : cost - pre,
    tax_taken_out: Math.max(0, amount - cost),
    stamp,
    said,
  });

  // r34 walk w2 F5: "its tax could not be added ... what its cost holds is
  // not stated" did not say what the cost IS. The two sentences below name
  // it (the printed amount), why (`missing`), and the tax step left undone.
  if (reclaim.reclaims == null) {
    return done(
      amount,
      null,
      `it is costed as printed and what its cost holds is not stated, since ${reclaim.why}`,
    );
  }
  if (reclaim.reclaims) {
    if (pre == null) {
      return done(
        amount,
        null,
        `the printed amount is used, since ${missing}, so the tax the house reclaims is not taken out of it`,
      );
    }
    const tax = amount - pre;
    return done(
      pre,
      "net",
      r === 0
        ? `it carries no tax`
        : tax > 0
          ? `the ${m(tax)} of tax inside its price is taken out, since the house reclaims it`
          : `its price is before tax, and the house reclaims the tax`,
    );
  }
  if (gross == null) {
    return done(
      amount,
      null,
      `the printed amount is used, since ${missing}, so the tax the house pays on it is not added`,
    );
  }
  const tax = gross - (pre ?? gross);
  return done(
    gross,
    "gross_cost",
    r === 0
      ? `it carries no tax`
      : basis === "includes_tax"
        ? `the tax inside its price stays in cost, since the house does not reclaim it`
        : `${m(tax)} of tax is added, since the house does not reclaim it`,
  );
}

const sameStamp = (stamps: CostTaxBasis[]): CostTaxBasis =>
  stamps.length > 0 && stamps.every((s) => s != null && s === stamps[0])
    ? stamps[0]
    : null;

/** Cost every line of one supplier paper by the one rule. */
export function landedCost(input: LandedCostInput): LandedCostResult {
  const { header, lines, house } = input;
  const reclaim = houseReclaims(house);

  let paperProblem: string | null = null;
  let charges = 0;
  const chargeNames: string[] = [];
  for (const f of CHARGE_FIELDS) {
    const v = header[f];
    if (v == null || v === 0) continue;
    if (!isNum(v) || v < 0) {
      paperProblem = `The paper's ${CHARGE_WORDS[f]} is negative or not a number, so no line's cost can be final.`;
      continue;
    }
    charges += v;
    chargeNames.push(CHARGE_WORDS[f]);
  }
  const discount = header.discount_total ?? 0;
  if (!isNum(discount) || discount < 0) {
    paperProblem = `The paper's discount is negative or not a number, so no line's cost can be final.`;
  }
  const D = isNum(discount) && discount > 0 ? discount : 0;

  // The charges and the discount are tax-treated like a line (ADR 0359 C3).
  const chargesT = treatTax(
    charges,
    header.charges_tax_basis,
    header.charges_vat_rate_percent,
    reclaim,
    "The paper's charges",
  );
  const discountT = treatTax(
    D,
    header.charges_tax_basis,
    header.charges_vat_rate_percent,
    reclaim,
    "The paper's discount",
  );
  if (!paperProblem && (charges > 0 || D > 0)) {
    if (!chargesT.ok) paperProblem = chargesT.sentence;
    else if (!discountT.ok) paperProblem = discountT.sentence;
  }
  const C = chargesT.ok ? chargesT.cost : charges;
  const Dc = discountT.ok ? discountT.cost : D;

  // Step 1: each line on its own, then its tax.
  type Step =
    | {
        line: LandedCostLineInput;
        kind: "value";
        net: number;
        how: string;
        tax: Extract<TaxTreated, { ok: true }>;
      }
    | { line: LandedCostLineInput; kind: "not_stocked"; basis: string }
    | { line: LandedCostLineInput; kind: "unresolved"; sentence: string };
  const steps: Step[] = lines.map((line) => {
    if (line.stocked === false) {
      return {
        line,
        kind: "not_stocked",
        basis: `Line ${line.line_no} is not stock, so it carries no share of the paper's charges or discount.`,
      };
    }
    const r = reconcileLineValue(line);
    if (!r.ok) return { line, kind: "unresolved", sentence: r.sentence };
    const { listed_bottles: listed, accepted_bottles: accepted } = line;
    const u = unitNoun(line.unit);
    const why =
      !isNum(listed) || listed <= 0
        ? `does not say how many ${u}s it lists`
        : !isNum(accepted) || accepted < 0
          ? `has an accepted count that is not a number of ${u}s`
          : accepted > listed
            ? `lists ${plural(listed, u)} but ${accepted} were accepted; the extra ${u}s have no price on this paper`
            : null;
    if (why) {
      return {
        line,
        kind: "unresolved",
        sentence: `Line ${line.line_no} ${why}.`,
      };
    }
    const t = treatTax(
      r.net,
      line.price_tax_basis,
      line.vat_rate_percent,
      reclaim,
      `Line ${line.line_no}`,
    );
    if (!t.ok) return { line, kind: "unresolved", sentence: t.sentence };
    return { line, kind: "value", net: r.net, how: r.how, tax: t };
  });

  // The tax the paper prints must agree with its lines' rates, when every
  // line's tax can be worked out; otherwise the rates or the basis are wrong.
  const valueSteps = steps.filter(
    (x): x is Extract<Step, { kind: "value" }> => x.kind === "value",
  );
  const lineTax = (
    amount: number,
    basis: PrintedTaxBasis | null,
    rate: number | null,
  ) => {
    if (rate === 0) return 0;
    if (rate == null || basis == null) return null;
    const rr = rate / 100;
    return basis === "includes_tax" ? amount - amount / (1 + rr) : amount * rr;
  };
  if (
    !paperProblem &&
    isNum(header.tax) &&
    steps.length > 0 &&
    steps.every((x) => x.kind === "value")
  ) {
    const parts = valueSteps.map((x) =>
      lineTax(x.net, x.line.price_tax_basis, x.line.vat_rate_percent),
    );
    if (charges > 0 || D > 0) {
      const rate = header.charges_vat_rate_percent;
      const basis = header.charges_tax_basis;
      const c = lineTax(charges, basis, rate);
      const d = lineTax(D, basis, rate);
      parts.push(c == null || d == null ? null : c - d);
    }
    if (parts.every((p) => p != null)) {
      const worked = (parts as number[]).reduce((s, p) => s + p, 0);
      if (Math.abs(worked - header.tax) > 0.01 * (parts.length + 1)) {
        paperProblem = `The paper prints tax of ${m(header.tax)}, but its lines' rates come to ${m(worked)}, so no line's cost can be final.`;
      }
    }
  }

  // Step 2: share the paper's charges and discount by the lines' cost value (F3).
  const base = valueSteps.reduce((s, x) => s + x.tax.cost, 0);
  const needsShare = charges > 0 || D > 0;
  const firstOpen = steps.find((x) => x.kind === "unresolved");
  let shareProblem: string | null = paperProblem;
  if (!shareProblem && needsShare && firstOpen) {
    shareProblem = `Line ${firstOpen.line.line_no} could not be priced, so this paper's charges and discount cannot be shared out and no line's cost is final.`;
  } else if (!shareProblem && needsShare && base <= 0) {
    shareProblem = `This paper has charges or a discount but no priced stock line to carry them.`;
  } else if (!shareProblem && Dc > base + C) {
    shareProblem = `This paper's discount of ${m(D)} is more than its stock and charges, so no line's cost is final.`;
  }
  const headerStamps: CostTaxBasis[] = [];
  if (charges > 0 && chargesT.ok) headerStamps.push(chargesT.stamp);
  if (D > 0 && discountT.ok) headerStamps.push(discountT.stamp);

  // The shares are whole cents that add back to the charges and the discount
  // exactly (largest remainder), not floats rounded later per bottle.
  const weights = steps.map((x) => (x.kind === "value" ? x.tax.cost : 0));
  const chargeCents = shareByLargestRemainder(C, weights);
  const discountCents = Dc > 0 ? shareByLargestRemainder(Dc, weights) : weights.map(() => 0);

  const out: LandedLine[] = steps.map((x, i): LandedLine => {
    const item_key = x.line.item_key ?? null;
    const line_no = x.line.line_no;
    if (x.kind === "not_stocked")
      return { line_no, status: "not_stocked", item_key, basis: x.basis };
    if (x.kind === "unresolved" || shareProblem) {
      const unresolved = x.kind === "unresolved" ? x.sentence : shareProblem;
      return {
        line_no,
        status: "unresolved",
        item_key,
        unresolved: unresolved as string,
      };
    }

    const cost_value = x.tax.cost;
    const discount_share = discountCents[i] > 0 ? -discountCents[i] : 0;
    const charge_share = chargeCents[i];
    const landed_value = cost_value + discount_share + charge_share;
    const listed = x.line.listed_bottles as number;
    const accepted = x.line.accepted_bottles;
    const accepted_landed_value = (landed_value * accepted) / listed;
    const perBottle = accepted > 0 ? accepted_landed_value / accepted : null;
    const cost_tax_basis = sameStamp([
      x.tax.stamp,
      ...(charge_share !== 0 || discount_share !== 0 ? headerStamps : []),
    ]);

    const u = unitNoun(x.line.unit);
    const said: string[] = [`Line ${line_no} is worth ${m(x.net)}: ${x.how}.`];
    if (x.net === 0)
      said.push(
        `It is free goods: its ${u}s add no value and dilute the item's cost.`,
      );
    else said.push(`For cost, ${x.tax.said}: ${m(cost_value)}.`);
    const headerSaid = (t: TaxTreated) => (t.ok ? `; ${t.said}` : "");
    if (charge_share > 0) {
      said.push(
        `It carries ${m(charge_share)} of the paper's ${chargeNames.join(", ")}, shared by line value${headerSaid(chargesT)}.`,
      );
    }
    if (discount_share < 0) {
      said.push(
        `It carries ${m(-discount_share)} of the paper's discount, shared by line value${headerSaid(discountT)}.`,
      );
    }
    if ((x.line.deposit ?? 0) > 0)
      said.push(`Its deposit of ${m(x.line.deposit as number)} is not cost.`);
    if (accepted < listed) {
      const short = listed - accepted;
      said.push(
        `${accepted} of ${plural(listed, u)} were accepted; the ${short} not accepted are left out of cost.`,
      );
    }
    said.push(
      perBottle == null
        ? `No ${u} was accepted, so there is no cost per ${u}.`
        : `Landed cost ${m(perBottle)} a ${u}.`,
    );

    return {
      line_no,
      status: "costed",
      item_key,
      net_line_value: x.net,
      cost_value,
      tax_in_cost: x.tax.tax_in_cost,
      tax_taken_out: x.tax.tax_taken_out,
      cost_tax_basis,
      discount_share,
      charge_share,
      landed_value,
      listed_bottles: listed,
      accepted_bottles: accepted,
      accepted_landed_value,
      landed_cost_per_bottle: perBottle,
      unit: u,
      basis: said.join(" "),
    };
  });

  // Step 3: pool lines of one item, so free goods dilute the paid bottles.
  const keys = [
    ...new Set(out.map((l) => l.item_key).filter((k): k is string => !!k)),
  ];
  const items: LandedItem[] = keys.map((item_key) => {
    const mine = out.filter(
      (l) => l.item_key === item_key && l.status !== "not_stocked",
    );
    const open = mine.find(
      (l): l is UnresolvedLine => l.status === "unresolved",
    );
    if (open)
      return { item_key, status: "unresolved", unresolved: open.unresolved };
    const costed = mine as CostedLine[];
    // One item is kept in one unit (ADR 0070): lines counted in two units
    // cannot share one cost per unit, and adding them would add grams to bottles.
    const units = [...new Set(costed.map((l) => l.unit))];
    if (units.length > 1)
      return {
        item_key,
        status: "unresolved",
        unresolved: `This item's lines count it in ${units.map((x) => `${x}s`).join(" and ")}, and one cost per unit cannot cover both.`,
      };
    const u = units[0] ?? "bottle";
    const bottles = costed.reduce((s, l) => s + l.accepted_bottles, 0);
    const value = costed.reduce((s, l) => s + l.accepted_landed_value, 0);
    const perBottle = bottles > 0 ? value / bottles : null;
    return {
      item_key,
      status: "costed",
      accepted_bottles: bottles,
      accepted_landed_value: value,
      landed_cost_per_bottle: perBottle,
      cost_tax_basis: sameStamp(costed.map((l) => l.cost_tax_basis)),
      basis:
        perBottle == null
          ? `No ${u} of this item was accepted from this paper.`
          : `${plural(bottles, u)} accepted across ${plural(costed.length, "line")}, landed at ${m(value)}: ${m(perBottle)} a ${u}.`,
    };
  });

  const lineDeposits = lines.reduce(
    (s, l) => s + (isNum(l.deposit) && l.deposit > 0 ? l.deposit : 0),
    0,
  );
  const leftOut: string[] = [];
  const depositTotal = isNum(header.deposit_total) ? header.deposit_total : 0;
  if (depositTotal > 0) leftOut.push(`a deposit of ${m(depositTotal)}`);
  if (lineDeposits > 0) leftOut.push(`line deposits of ${m(lineDeposits)}`);

  // What happened to the tax, said from what was done to each line's OWN
  // price, never from the pooled stamp: a line whose own tax was treated but
  // whose share of the charges or discount holds tax that is not known was
  // not "costed as printed". Said from what was done, never from the basis
  // alone: a price with tax inside keeps it in cost for a house that does not
  // reclaim, so "tax is not cost" would be false there.
  const costedRows = out.flatMap((l, i) => {
    const x = steps[i];
    return l.status === "costed" && x.kind === "value"
      ? [{ l, own: x.tax.stamp }]
      : [];
  });
  const costedLines = costedRows.map((r) => r.l);
  const ownTreated = costedRows.filter((r) => r.own != null).map((r) => r.l);
  const asPrinted = costedRows.filter((r) => r.own == null).map((r) => r.l);
  const shareOnly = ownTreated.filter((l) => l.cost_tax_basis == null);
  // Once lines are costed, the charges and the discount are shared out in
  // full, so their tax (less the discount's) is in the paper's tax too.
  const shared = costedLines.length > 0 && (charges > 0 || D > 0);
  const headerTax = (k: "tax_taken_out" | "tax_in_cost") =>
    shared && chargesT.ok && discountT.ok
      ? (chargesT[k] ?? 0) - (discountT[k] ?? 0)
      : 0;
  const takenOut =
    costedLines.reduce((s, l) => s + (l.tax_taken_out ?? 0), 0) +
    headerTax("tax_taken_out");
  const inCost =
    costedLines.reduce((s, l) => s + (l.tax_in_cost ?? 0), 0) +
    headerTax("tax_in_cost");
  const taxSaid: string[] = [];
  if (reclaim.reclaims === true) {
    if (takenOut > 0.005) {
      taxSaid.push(
        `Tax of ${m(takenOut)} printed inside the prices is taken out of cost, since the house reclaims it.`,
      );
    } else if (ownTreated.length > 0) {
      const n = ownTreated.length;
      taxSaid.push(
        n === costedLines.length && shareOnly.length === 0
          ? `Cost is before tax, since the house reclaims it.`
          : `The price${n === 1 ? "" : "s"} of ${plural(n, "line")} ${n === 1 ? "is" : "are"} costed before tax, since the house reclaims it.`,
      );
    }
  }
  if (reclaim.reclaims === false) {
    if (inCost > 0.005)
      taxSaid.push(
        `Tax of ${m(inCost)} is in cost, since the house does not reclaim it.`,
      );
    if (ownTreated.some((l) => l.tax_in_cost == null))
      taxSaid.push(
        `Tax printed inside the prices stays in cost, since the house does not reclaim it.`,
      );
  }
  if (asPrinted.length > 0) {
    const one = asPrinted.length === 1;
    taxSaid.push(
      `${plural(asPrinted.length, "line")} ${one ? "is" : "are"} costed as printed, and what ${one ? "its" : "their"} cost holds is not stated, since ${reclaim.reclaims == null ? reclaim.why : `the paper does not say enough about the tax in ${one ? "its price" : "their prices"}`}.`,
    );
  }
  if (shareOnly.length > 0) {
    const one = shareOnly.length === 1;
    taxSaid.push(
      `${plural(shareOnly.length, "line")} ${one ? "carries" : "carry"} a share of the paper's charges or discount whose tax is not known, so what ${one ? "its" : "their"} cost holds is not stated.`,
    );
  }
  // Lines that could not be costed had nothing done to their tax; saying the
  // paper carries none would contradict their own unresolved sentence.
  const opened = out.filter((l) => l.status === "unresolved").length;
  const printsTax = header.tax != null && header.tax !== 0;
  const carriesTax =
    printsTax ||
    ((charges > 0 || D > 0) &&
      header.charges_vat_rate_percent != null &&
      header.charges_vat_rate_percent !== 0) ||
    lines.some(
      (l) =>
        l.stocked !== false &&
        l.vat_rate_percent != null &&
        l.vat_rate_percent !== 0,
    );
  if (carriesTax && opened > 0) {
    taxSaid.push(
      costedLines.length === 0
        ? `The paper's tax could not be treated, since none of its lines could be costed.`
        : `${plural(opened, "line")} could not be costed, so the tax on ${opened === 1 ? "it" : "them"} is not treated.`,
    );
  }
  if (carriesTax && taxSaid.length === 0) {
    taxSaid.push(
      printsTax
        ? `The paper prints tax${isNum(header.tax) ? ` of ${m(header.tax)}` : ""}, but none of its costed lines carries it, so it is not treated.`
        : `No tax is in the cost of this paper's lines.`,
    );
  }

  return {
    house,
    charges_total: charges,
    discount_total: D,
    left_out: leftOut.length
      ? `Not cost: ${leftOut.join(", ")}. Deposits come back.`
      : `No deposit on this paper is left out of cost.`,
    tax_said: taxSaid.length
      ? taxSaid.join(" ")
      : `Nothing on this paper carries tax.`,
    lines: out,
    items,
  };
}
