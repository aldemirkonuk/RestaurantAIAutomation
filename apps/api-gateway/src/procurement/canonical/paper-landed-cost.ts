/**
 * The delivery path's landed cost (cost-math proposal lane 1.4, without its
 * single-transaction RPC; forks F2, F3, F14). PURE: the service reads the rows,
 * this turns them into each booked item's cost per accepted bottle.
 *
 * One invoice = one `landedCost` run (`../landed-cost.ts`, the one rule).
 * `perBottleLotCost` stays the UNIT gatekeeper: a line it accepts is handed to
 * the rule in per-bottle terms (uom `bottle`, pack 1, base 1, its unrounded
 * per-bottle price), so the rule never converts a unit; a line it refuses is
 * handed over with no bottle count, which the rule marks unresolved. With a
 * charge or a discount on that paper every line on it stays open, because its
 * charges cannot be shared out; with none, the other lines still cost.
 *
 * What a line LISTS: `qty_bottles` is `toBottles(qty, uom, pack)` as the
 * extractor wrote it (`documents/document-extractor.service.ts:394`), and
 * `free_goods_qty` is in the line's own unit and INSIDE that quantity: the
 * extractor always writes 0 (`:397`), only a person's edit sets it
 * (`documents/document-intake.service.ts:2533-2536`, which leaves
 * `qty_bottles` alone), and the canonical check reads "a line of 12 with 1
 * free is billed for 11" (`canonical/canonical-invariants.ts:807-811`; also
 * `invoice-match.ts:597`). So paid = listed − free, and listed = `qty_bottles`.
 *
 * Accepted bottles come from what the door booked (F2): booked ≥ Σ listed →
 * every line is accepted in full and the extra bottles take the same cost;
 * booked < Σ listed on ONE line → that line's accepted count is what was
 * booked; spread over more than one line → which line was short is not known,
 * so the item stays provisional and says why. Never a proportional guess.
 *
 * Tax: see `houseTaxForLotCost`.
 */

import { currencyCode } from "../../common/iso-4217";
import { isMass, isVolumeLineUnit, normalizeUom, toBottles, UOMS } from "../documents/document-types";
import { LineKind } from "../documents/parsed-document";
import {
  CostedLine,
  CostTaxBasis,
  HouseTax,
  LandedCostHeader,
  LandedCostLineInput,
  LandedCostResult,
  unitNoun,
  landedCost,
} from "../landed-cost";
import { snapshotLineKinds } from "./from-document-rows";
import { LotUnitCost } from "./lot-unit-cost";

/**
 * The house's tax answers for a lot cost, until they exist.
 *
 * ADR 0359 C2 (Proposed in #784) adds `restaurants.tax_basis` and
 * `restaurants.reclaims_input_tax`; cost-math proposal lane 3.5a builds them.
 * No migration on `main` has either column, and no invoice line carries its
 * price's tax basis or rate. So the house is `unset` and every lot is costed as
 * printed, stamped null, and says so. This is the ONE place to change when
 * lane 3.5a lands: read the two columns here.
 */
export function houseTaxForLotCost(): HouseTax {
  return { tax_basis: "unset", reclaims_input_tax: null };
}

/** One `procurement_documents` row: its money columns and its line kinds. */
export interface PaperHeaderRow {
  id: string;
  doc_number?: string | null;
  subtotal?: number | string | null;
  discount_total?: number | string | null;
  freight?: number | string | null;
  fuel_surcharge?: number | string | null;
  split_case_fee?: number | string | null;
  delivery_fee?: number | string | null;
  other_charges?: number | string | null;
  deposit_total?: number | string | null;
  tax?: number | string | null;
  /** `procurement_documents.currency`: the vendor's money, as the paper says. */
  currency?: string | null;
  /** `extracted->lines`: the intake snapshot, read only for each line's kind. */
  extracted_lines?: unknown;
}

/** The columns of one `procurement_document_lines` row this file reads. */
export interface PaperLineRow {
  document_id: string;
  line_no: number | null;
  inventory_id: string | null;
  qty_bottles: number | string | null;
  free_goods_qty?: number | string | null;
  unit_price: number | string | null;
  uom?: string | null;
  pack_size?: number | string | null;
  line_total?: number | string | null;
  allowance?: number | string | null;
  deposit?: number | string | null;
  printed?: unknown;
  /** Counts already scaled into the item's unit (r21 volume); a free line takes that unit. */
  in_item_unit?: boolean;
}

/** An invoice line and what the unit gatekeeper made of it. */
export interface PaperLine {
  row: PaperLineRow;
  cost: LotUnitCost;
}

/** What the receive desk can show of one item's landed cost. */
export interface LandedBlock {
  /** Σ of the item's lines' value as printed, after allowance, without deposit. */
  netLineValue: number;
  /** Σ of the item's lines' share of the papers' charges. */
  chargeShare: number;
  /** Σ of the item's lines' share of the papers' discounts (zero or negative). */
  discountShare: number;
  acceptedBottles: number;
  /** Before rounding to the lot's two places. */
  landedCostPerBottle: number;
  /** Null until the house has a tax basis (ADR 0359 C3). */
  costTaxBasis: CostTaxBasis;
  basis: string;
  taxSaid: string;
  leftOut: string;
}

export interface LandedPrice {
  /** `landedCostPerBottle` at the lot's precision: what is posted. */
  unitCost: number;
  basis: string;
  costTaxBasis: CostTaxBasis;
  taxSaid: string;
  landed: LandedBlock;
}

/** What each paper carries that is not in any bottle, and what its tax did. */
export interface PaperNote {
  documentId: string;
  docNumber: string | null;
  leftOut: string;
  taxSaid: string;
}

export interface DeliveryLandedCost {
  byItem: Map<string, LandedPrice>;
  /** Items whose cost stays provisional, each with the whole sentence. */
  held: Map<string, string>;
  /** The gatekeeper's own refusal, by item (a re-verify names it). */
  refused: Map<string, string>;
  /** Held as not in the house's money (QA 15 (5)): no fallback price. */
  foreign: Set<string>;
  /** `document_id:line_no` of an unattached line paired to the one booked item. */
  paired: Map<string, string>;
  papers: PaperNote[];
}

const m = (n: number): string => n.toFixed(2);
/** A cost per bottle as posted: up to six places, never fewer than two. */
const six = (n: number): string =>
  n.toFixed(6).replace(/(\.\d\d\d*?)0+$/, "$1");

/** What `unit_cost numeric(14,6)` keeps (#839), half away from zero; posting
 * more places would defeat `finalise_delivery_cost`'s idempotency check. */
export function toLandedPrecision(perBottle: number): number {
  return Number(`${Math.round(Number(`${perBottle.toFixed(12)}e6`))}e-6`);
}
const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;

/** A numeric column: absent is null; anything else that is not a number is NaN. */
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN;
}

const lineKey = (r: PaperLineRow) => `${r.document_id}:${r.line_no}`;

/** An active ISO 4217 code (membership, not shape: `common/iso-4217`), null
 * when absent, "?" when written but not a currency ("TL", "US$", "ZZZ"). */
export function currencyOf(v: string | null | undefined): string | null {
  if (v == null || String(v).trim() === "") return null;
  return currencyCode(String(v)) ?? "?";
}

/** QA rounds 15 (5) and 19: why a paper is not costed in the house's money,
 * or null when it is. No rate is recorded, so nothing converts; and a house
 * that has not named its money (restaurants.currency NULL, or not a code) has
 * no money to cost in, so every paper waits for it in words. */
export function notHouseMoney(
  paperCurrency: string | null | undefined,
  houseCurrency: string | null | undefined,
): string | null {
  const house = currencyOf(houseCurrency);
  if (!house)
    return "this house has not named the currency it keeps its costs in, so no invoice is costed in it yet; name the house's currency and verify the delivery again";
  if (house === "?")
    return `this house's currency is recorded as "${String(houseCurrency).trim()}", which is not a currency code, so no invoice is costed in it yet; correct the house's currency and verify the delivery again`;
  const money = currencyOf(paperCurrency);
  if (money === house) return null;
  if (money == null)
    return `its invoice does not say what currency it is in, and this house keeps its costs in ${house}`;
  if (money === "?")
    return `its invoice gives its currency as "${String(paperCurrency).trim()}", which is not a currency code, and this house keeps its costs in ${house}`;
  return `its invoice is in ${money} and this house keeps its costs in ${house}; no exchange rate is recorded, so a cost in ${money} is not booked as ${house}`;
}

function header(row: PaperHeaderRow): LandedCostHeader {
  return {
    subtotal: num(row.subtotal),
    discount_total: num(row.discount_total),
    freight: num(row.freight),
    fuel_surcharge: num(row.fuel_surcharge),
    split_case_fee: num(row.split_case_fee),
    delivery_fee: num(row.delivery_fee),
    other_charges: num(row.other_charges),
    deposit_total: num(row.deposit_total),
    tax: num(row.tax),
    // No column says either yet (ADR 0359 C3, lane 3.5a).
    charges_tax_basis: null,
    charges_vat_rate_percent: null,
  };
}

/** Free bottles inside a line's quantity, in bottles. */
function freeBottles(r: PaperLineRow): number {
  const free = num(r.free_goods_qty);
  if (free == null || !(free > 0)) return 0;
  const uom = (UOMS as readonly string[]).includes(r.uom ?? "")
    ? (r.uom as (typeof UOMS)[number])
    : "bottle";
  return toBottles(free, uom, num(r.pack_size) ?? 1);
}

/**
 * What the gatekeeper is asked to cross-check a printed total against: the
 * PAID bottles. A line of 12 with 1 free prints the total of 11.
 */
export function paidBottles(r: PaperLineRow): number | null {
  const listed = num(r.qty_bottles);
  if (listed == null || Number.isNaN(listed)) return listed;
  return listed - freeBottles(r);
}

/**
 * A line priced at 0 is free goods: its bottles count, its value is nothing.
 * The gatekeeper never sees a price of 0, so its unit is checked here, by the
 * same rules, or the bottles it adds would be a guess.
 */
function freeLineBottles(
  r: PaperLineRow,
): { ok: true; bottles: number } | { ok: false; reason: string } {
  const printed =
    r.printed && typeof r.printed === "object"
      ? (r.printed as Record<string, unknown>).uom
      : null;
  const said =
    typeof printed === "string" && printed.trim() ? printed.trim() : null;
  if (said && r.uom === "each" && normalizeUom(said) !== "each")
    return {
      ok: false,
      reason: `the invoice prints the unit of its free line as "${said}", which this house does not count in, so how many bottles came free is not known`,
    };
  const uom = r.uom ?? null;
  if (!uom || !(UOMS as readonly string[]).includes(uom))
    return {
      ok: false,
      reason: `its free line's unit reads ${JSON.stringify(uom)}, which is not a unit this house counts in`,
    };
  // A count the caller already put in the item's unit (r21) needs no pack.
  if ((uom === "keg" || isVolumeLineUnit(uom)) && !r.in_item_unit)
    return {
      ok: false,
      reason: `its free line is counted in ${uom}s, and a ${uom} is not a number of bottles`,
    };
  const pack = num(r.pack_size);
  if (
    !r.in_item_unit &&
    (uom === "case" || uom === "pack" || uom === "split_case") &&
    (pack == null || !(pack > 1))
  )
    return {
      ok: false,
      reason: `its free line does not state how many bottles a ${uom.replace("_", " ")} holds`,
    };
  const bottles = num(r.qty_bottles);
  if (bottles == null || !(bottles > 0))
    return {
      ok: false,
      reason: `its free line does not say how many bottles came free`,
    };
  return { ok: true, bottles };
}

type Fed =
  | {
      kind: "value";
      row: PaperLineRow;
      key: string | null;
      listed: number;
      /**
       * The unit `listed` counts: the gatekeeper's `per` (`bottle`, `g`, `kg`,
       * `keg`, …). Null for a free weighed line, which takes its item's unit
       * (its count was scaled into that unit by the caller, R8).
       */
      per: string | null;
      input: Omit<LandedCostLineInput, "accepted_bottles">;
      said: string;
    }
  | {
      kind: "open";
      row: PaperLineRow;
      key: string | null;
      reason: string;
      refusal: string | null;
      input: Omit<LandedCostLineInput, "accepted_bottles">;
    }
  | {
      kind: "not_stocked";
      row: PaperLineRow;
      key: string | null;
      input: Omit<LandedCostLineInput, "accepted_bottles">;
      leftOut: string | null;
    };

/** Stock a line listed: a line that is the deposit or a fee is not. */
function feed(line: PaperLine, kind: LineKind | null, key: string | null): Fed {
  const r = line.row;
  const n = Number(r.line_no ?? 0);
  const shared = {
    line_no: n,
    allowance: num(r.allowance),
    deposit: num(r.deposit),
    price_tax_basis: null,
    vat_rate_percent: null,
    item_key: key,
  };
  const printedTotal = num(r.line_total);
  if (kind === "deposit" || kind === "fee") {
    const amount = printedTotal ?? 0;
    return {
      kind: "not_stocked",
      row: r,
      key,
      input: {
        ...shared,
        qty: null,
        uom: null,
        pack_size: null,
        price_base_qty: null,
        unit_price: null,
        line_total: printedTotal,
        listed_bottles: null,
        stocked: false,
      },
      leftOut:
        amount > 0
          ? kind === "deposit"
            ? `line ${n}, a deposit of ${m(amount)}`
            : `line ${n}, a fee of ${m(amount)} printed as a line (only the paper's charge totals are shared over bottles)`
          : null,
    };
  }
  const open = (reason: string, refusal: string | null): Fed => ({
    kind: "open",
    row: r,
    key,
    reason,
    refusal,
    // No bottle count: the rule marks the line unresolved by its own words.
    input: {
      ...shared,
      qty: null,
      uom: null,
      pack_size: null,
      price_base_qty: null,
      unit_price: null,
      line_total: null,
      listed_bottles: null,
      stocked: true,
    },
  });
  const listed = num(r.qty_bottles);
  const { cost } = line;
  if (cost.ok) {
    // A weighed line is costed per one of its item's unit (R8): its counts
    // arrive in that unit, and every sentence below says so.
    const unit = unitNoun(cost.per);
    const paid = paidBottles(r);
    if (listed == null || paid == null || !(paid > 0) || !(listed >= paid))
      return open(
        `the invoice line does not say how many ${unit}s it bills`,
        null,
      );
    return {
      kind: "value",
      row: r,
      key,
      listed,
      per: cost.per,
      said: `line ${n}: ${cost.basis}`,
      input: {
        ...shared,
        unit: cost.per,
        // Per-bottle terms: the gatekeeper already converted the unit.
        qty: paid,
        uom: "bottle",
        pack_size: 1,
        price_base_qty: 1,
        unit_price: cost.perBottle,
        line_total: printedTotal,
        listed_bottles: listed,
        stocked: true,
      },
    };
  }
  if (cost.kind === "refused")
    return open(
      `the invoice prices this item, but not per bottle: ${cost.reason}`,
      cost.reason,
    );
  const price = num(r.unit_price);
  if (price === 0) {
    const free = freeLineBottles(r);
    if (!free.ok)
      return open(`its invoice line is free goods, but ${free.reason}`, null);
    return {
      kind: "value",
      row: r,
      key,
      listed: free.bottles,
      per: isMass(r.uom) || r.in_item_unit ? null : "bottle",
      said: `line ${n}: free goods, ${plural(free.bottles, isMass(r.uom) || r.in_item_unit ? "unit" : "bottle")} at no price`,
      input: {
        ...shared,
        qty: free.bottles,
        uom: "bottle",
        pack_size: 1,
        price_base_qty: 1,
        unit_price: 0,
        line_total: printedTotal,
        listed_bottles: free.bottles,
        stocked: true,
      },
    };
  }
  // No price printed. A row that lists nothing and is worth nothing is not
  // stock at all (a note on the paper); anything else is a line nobody priced.
  if (
    price == null &&
    (printedTotal == null || printedTotal === 0) &&
    !((listed ?? 0) > 0)
  )
    return {
      kind: "not_stocked",
      row: r,
      key,
      input: {
        ...shared,
        qty: null,
        uom: null,
        pack_size: null,
        price_base_qty: null,
        unit_price: null,
        line_total: null,
        listed_bottles: null,
        stocked: false,
      },
      leftOut: null,
    };
  return open(
    price == null
      ? `its invoice line prints no price, so what its bottles cost is not known`
      : `its invoice line prints a negative price, which is not what a bottle cost`,
    null,
  );
}

/** Cost every booked item of one delivery from its invoices. */
export function landDelivery(input: {
  papers: PaperHeaderRow[];
  lines: PaperLine[];
  booked: Map<string, number>;
  /** `restaurants.currency`; null when the house has not named it. */
  houseCurrency?: string | null;
}): DeliveryLandedCost {
  const house = houseTaxForLotCost();
  const foreign = new Set<string>();
  const moneyOf = new Map<string, Set<string>>();
  const byItem = new Map<string, LandedPrice>();
  const held = new Map<string, string>();
  const refused = new Map<string, string>();
  const paired = new Map<string, string>();
  const papers: PaperNote[] = [];
  const hold = (id: string, why: string) => {
    if (!held.has(id)) held.set(id, why);
  };

  const headerOf = new Map(input.papers.map((p) => [p.id, p]));
  const kindsOf = new Map(
    input.papers.map((p) => [
      p.id,
      snapshotLineKinds({ lines: p.extracted_lines }),
    ]),
  );
  const kindOf = (r: PaperLineRow) =>
    kindsOf.get(r.document_id)?.get(Number(r.line_no ?? 0)) ?? null;

  // #838's pairing, kept: ONE booked item, no line naming it, and ONE stock
  // line naming nothing → that line is the item's. Any other shape is not.
  const items = [...input.booked.entries()]
    .filter(([, q]) => q !== 0)
    .map(([id]) => id);
  const stockUnattached = input.lines.filter((l) => {
    if (l.row.inventory_id) return false;
    const k = kindOf(l.row);
    return (
      k !== "deposit" && k !== "fee" && feed(l, k, null).kind !== "not_stocked"
    );
  });
  if (
    items.length === 1 &&
    !input.lines.some((l) => l.row.inventory_id === items[0]) &&
    stockUnattached.length === 1
  )
    paired.set(lineKey(stockUnattached[0].row), items[0]);
  const keyOf = (r: PaperLineRow) =>
    r.inventory_id ?? paired.get(lineKey(r)) ?? null;

  // Step 1: each line, fed in per-bottle terms or held open.
  const fed = input.lines.map((l) => feed(l, kindOf(l.row), keyOf(l.row)));
  for (const f of fed) {
    if (f.kind !== "open" || !f.key) continue;
    hold(f.key, `${f.reason}. The lot stays provisional.`);
    if (f.refusal && !refused.has(f.key)) refused.set(f.key, f.refusal);
  }

  // Step 2: accepted bottles per item, from what the door booked (F2).
  const accepted = new Map<Fed, number>();
  const extraOf = new Map<string, number>();
  const valueByKey = new Map<string, Extract<Fed, { kind: "value" }>[]>();
  /** The unit each item's lines count it in (one per item, or it is held). */
  const perOf = new Map<string, string>();
  for (const f of fed) {
    if (f.kind !== "value") continue;
    if (!f.key) {
      accepted.set(f, f.listed);
      continue;
    }
    valueByKey.set(f.key, [...(valueByKey.get(f.key) ?? []), f]);
  }
  for (const [key, mine] of valueByKey) {
    // One item is kept in one unit (ADR 0070). Lines that count it in two
    // cannot be added, or grams are summed with bottles.
    const pers = [...new Set(mine.map((f) => f.per).filter((p): p is string => p != null))];
    if (pers.length > 1) {
      for (const f of mine) accepted.set(f, f.listed);
      hold(
        key,
        `its invoice lines count it in ${pers.map((x) => `${unitNoun(x)}s`).join(" and ")}, and one cost per unit cannot cover both. The lot stays provisional.`,
      );
      continue;
    }
    perOf.set(key, pers[0] ?? "bottle");
    const u = unitNoun(perOf.get(key));
    const listed = mine.reduce((s, f) => s + f.listed, 0);
    const booked = Math.max(0, input.booked.get(key) ?? 0);
    if (booked >= listed) {
      for (const f of mine) accepted.set(f, f.listed);
      if (booked > listed) extraOf.set(key, booked - listed);
    } else if (mine.length === 1) {
      accepted.set(mine[0], booked);
    } else {
      // The item's lines still carry their share of the paper; its own cost waits.
      for (const f of mine) accepted.set(f, f.listed);
      hold(
        key,
        `the door counted ${plural(booked, u)} of this item, but its invoice lines list ${listed} across ${mine.length} lines, and which line was short is not known. The lot stays provisional until the count or the invoice is corrected.`,
      );
    }
  }

  // Step 3: one landed-cost run per paper.
  const linesOf = new Map<string, CostedLine[]>();
  const docsOf = new Map<string, Set<string>>();
  const byDoc = new Map<string, Fed[]>();
  for (const f of fed)
    byDoc.set(f.row.document_id, [...(byDoc.get(f.row.document_id) ?? []), f]);
  const results = new Map<string, LandedCostResult>();
  for (const [docId, mine] of byDoc) {
    const row = headerOf.get(docId);
    if (!row) {
      for (const f of mine)
        if (f.key)
          hold(
            f.key,
            `the totals of the invoice it is on could not be found, so that paper's charges and discount are not known. The lot stays provisional.`,
          );
      continue;
    }
    // QA round 15 (5): a paper not in the house's money holds by name.
    const money = currencyOf(row.currency);
    const notHouse = notHouseMoney(row.currency, input.houseCurrency);
    if (notHouse) {
      for (const f of mine)
        if (f.key) {
          foreign.add(f.key);
          held.set(f.key, `${notHouse}. The lot stays provisional.`);
        }
      papers.push({
        documentId: docId,
        docNumber: row.doc_number ?? null,
        leftOut: `Nothing on it was costed: ${notHouse}.`,
        taxSaid: "",
      });
      continue;
    }
    for (const f of mine)
      if (f.key && money)
        moneyOf.set(f.key, (moneyOf.get(f.key) ?? new Set<string>()).add(money));
    const result = landedCost({
      header: header(row),
      house,
      lines: mine.map((f) => ({
        ...f.input,
        // The item's unit, so a free weighed line is said in it too.
        ...(f.key && perOf.has(f.key) ? { unit: perOf.get(f.key) } : {}),
        accepted_bottles: accepted.get(f) ?? 0,
      })),
    });
    results.set(docId, result);
    const own = mine
      .filter(
        (f): f is Extract<Fed, { kind: "not_stocked" }> =>
          f.kind === "not_stocked",
      )
      .map((f) => f.leftOut)
      .filter((s): s is string => !!s);
    papers.push({
      documentId: docId,
      docNumber: row.doc_number ?? null,
      leftOut: own.length
        ? `${result.left_out} Also not cost: ${own.join("; ")}.`
        : result.left_out,
      taxSaid: result.tax_said,
    });
    result.lines.forEach((l) => {
      const key = l.item_key;
      if (!key) return;
      docsOf.set(key, (docsOf.get(key) ?? new Set<string>()).add(docId));
      if (l.status === "unresolved")
        hold(key, `${l.unresolved} The lot stays provisional.`);
      if (l.status === "costed")
        linesOf.set(key, [...(linesOf.get(key) ?? []), l]);
    });
  }

  // Step 4: pool each item over every paper: Σ accepted landed value ÷ Σ accepted.
  const said = new Map<string, string[]>();
  for (const f of fed)
    if (f.kind === "value" && f.key)
      said.set(f.key, [...(said.get(f.key) ?? []), f.said]);
  for (const [key, costed] of linesOf) {
    if (held.has(key)) continue;
    const monies = [...(moneyOf.get(key) ?? [])];
    if (monies.length > 1) {
      foreign.add(key);
      hold(
        key,
        `its invoices are in ${monies.join(" and ")}, and costs in different currencies are never added together. The lot stays provisional.`,
      );
      continue;
    }
    // The item's unit, as its lines were costed (Step 2 held a mix).
    const u = unitNoun(perOf.get(key) ?? costed[0]?.unit);
    const bottles = costed.reduce((s, l) => s + l.accepted_bottles, 0);
    const value = costed.reduce((s, l) => s + l.accepted_landed_value, 0);
    if (!(bottles > 0)) {
      hold(
        key,
        `no ${u} of it on its invoice lines was accepted at the door, so there is no cost per ${u}. The lot stays provisional.`,
      );
      continue;
    }
    // A cost per bottle to six places (#839's numeric(14,6)), checked to add
    // back to the item's landed value to the cent (its charge shares already
    // are whole cents): 4.90 freight over 1000 bottles at 10
    // posts 10.0049, not 10.00 (QA round 15).
    const valueCents = Math.round(value * 100);
    const perBottle = value / bottles;
    const unitCost = toLandedPrecision(perBottle);
    if (!(unitCost > 0)) {
      hold(
        key,
        `its ${u}s came free on the invoice, and a lot is never booked at a cost of nothing. The lot stays provisional.`,
      );
      continue;
    }
    if (Math.round(unitCost * bottles * 100) !== valueCents) {
      hold(
        key,
        `its ${plural(bottles, u)} are too many for a cost per ${u} to six places to add back to the invoice's ${m(valueCents / 100)} to the cent. The lot stays provisional.`,
      );
      continue;
    }
    const docs = [...(docsOf.get(key) ?? [])];
    const notes = papers.filter((p) => docs.includes(p.documentId));
    const taxSaid = [...new Set(notes.map((p) => p.taxSaid))].join(" ");
    const leftOut = [...new Set(notes.map((p) => p.leftOut))].join(" ");
    const stamp: CostTaxBasis = costed.every(
      (l) =>
        l.cost_tax_basis != null &&
        l.cost_tax_basis === costed[0].cost_tax_basis,
    )
      ? costed[0].cost_tax_basis
      : null;
    const extra = extraOf.get(key) ?? 0;
    const basis = [
      `landed cost per accepted ${u}; ${(said.get(key) ?? []).join("; ")}.`,
      ...costed.map((l) => l.basis),
      `${plural(bottles, u)} accepted across ${plural(costed.length, "line")}, landed at ${m(valueCents / 100)}: posted as ${six(unitCost)} a ${u}, which adds back to ${m(valueCents / 100)}.`,
      ...(extra > 0
        ? [
            `The door booked ${plural(extra, u)} more than the invoice lists; ${extra === 1 ? "it takes" : "they take"} the same cost a ${u}.`,
          ]
        : []),
      stamp == null
        ? `What this cost holds for tax is not stated (cost tax basis: none). ${taxSaid}`
        : `This cost is stamped ${stamp}. ${taxSaid}`,
    ].join(" ");
    byItem.set(key, {
      unitCost,
      basis,
      costTaxBasis: stamp,
      taxSaid,
      landed: {
        netLineValue: costed.reduce((s, l) => s + l.net_line_value, 0),
        chargeShare: costed.reduce((s, l) => s + l.charge_share, 0),
        discountShare: costed.reduce((s, l) => s + l.discount_share, 0),
        acceptedBottles: bottles,
        landedCostPerBottle: perBottle,
        costTaxBasis: stamp,
        basis,
        taxSaid,
        leftOut,
      },
    });
  }

  return { byItem, held, refused, paired, papers, foreign };
}
