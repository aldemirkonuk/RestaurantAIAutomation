/**
 * VERIFIED PURCHASES BY CATEGORY (r110 invoices-g4).
 *
 * What the house bought, by kind, from papers a person checked. MarginEdge's
 * rule: every cent of a paper lands in exactly one class, so the classes plus
 * the deposits equal the paper's total to the cent.
 *
 * INVARIANTS
 *  1. Two currencies are never added: one result per currency, and a paper
 *     that states no currency is added to nothing (DD-r109-8b).
 *  2. Per paper, Σ classes + deposits = the paper total, in integer cents.
 *     The paper's charges, discounts and paper-level tax (the residual: total
 *     − Σ line nets − deposits) are spread over the classes pro rata to each
 *     class's line-net share, by largest remainder. When the paper prints no
 *     total, the residual is the charges it printed plus its tax less its
 *     discount. By value, not by quantity: by quantity a case of water would
 *     carry the wine's freight.
 *  3. A line's class is read from the good it is linked to, at read time
 *     (restaurant_inventory.kind, else the catalogue's beverages.beverage_type
 *     when the good says only 'other'). An unlinked line is 'Not classed'.
 *     Nothing is stored, so a corrected link moves the figure.
 *  4. VAT is summed per printed rate (vat_rate_percent, #1501). A line with
 *     no rate goes to 'rate not printed'; a rate is never assumed.
 *  5. A credit memo's figures are negative within their class.
 */
import { allocateSigned, toCents } from "./documents-export";

export { allocateSigned };

export const CLASSES = [
  "Wine",
  "Beer",
  "Spirits",
  "Cider/Sake",
  "N/A drinks",
  "Food",
  "Other",
  "Not classed",
] as const;
export type PurchaseClass = (typeof CLASSES)[number];
export const DEPOSITS = "Deposits (not cost)";
export const RATE_NOT_PRINTED = "rate not printed";

/** restaurant_inventory.kind (or a beverages.beverage_type) folded to a class. */
export function classOf(
  kind: string | null | undefined,
  beverageType?: string | null,
): PurchaseClass {
  const k = (kind ?? "").trim().toLowerCase();
  if (k && k !== "other") return foldKind(k);
  const b = (beverageType ?? "").trim().toLowerCase();
  if (b && b !== "other") return foldKind(b);
  return k === "other" ? "Other" : "Not classed";
}

function foldKind(k: string): PurchaseClass {
  if (/wine|sparkling|champagne|port|sherry|vermouth/.test(k)) return "Wine";
  if (/beer|ale|lager|stout/.test(k)) return "Beer";
  if (/cider|sake|mead|perry/.test(k)) return "Cider/Sake";
  if (/non_alcoholic|soft_drink|water|juice|soda|coffee|tea/.test(k))
    return "N/A drinks";
  if (/food|produce|meat|dairy|bakery/.test(k)) return "Food";
  if (
    /spirit|whisk|gin|rum|vodka|tequila|mezcal|brandy|cognac|liqueur|cocktail|raki|amaro|bitters/.test(
      k,
    )
  )
    return "Spirits";
  return "Other";
}

export interface PaperIn {
  id: string;
  doc_type: string | null;
  currency: string | null;
  total: number | string | null;
  freight?: number | string | null;
  fuel_surcharge?: number | string | null;
  split_case_fee?: number | string | null;
  delivery_fee?: number | string | null;
  other_charges?: number | string | null;
  discount_total?: number | string | null;
  deposit_total?: number | string | null;
  tax: number | string | null;
}

export interface LineIn {
  document_id: string;
  line_no?: number | null;
  description?: string | null;
  line_total: number | string | null;
  deposit?: number | string | null;
  vat_rate_percent?: number | string | null;
  /** The class of the good the line is linked to; null = not linked. */
  cls: PurchaseClass | null;
}

export interface CurrencyPurchases {
  currency: string;
  papers: number;
  /** Cents per class, every class present (0 when none bought). */
  classes: Record<PurchaseClass, number>;
  deposits: number;
  /** Σ classes + deposits: the papers' totals to the cent. */
  total: number;
  /** Line nets per printed VAT rate, plus 'rate not printed'. */
  vat: Array<{ rate: string; net: number }>;
  /** The tax the papers printed, at paper level. */
  taxPrinted: number;
}

export interface PurchasesByCategory {
  currencies: CurrencyPurchases[];
  /** Papers that state no currency: counted, added to nothing. */
  papersWithoutCurrency: number;
}

const c0 = (v: unknown) => toCents(v as number | string | null) ?? 0;
const emptyClasses = () =>
  Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<PurchaseClass, number>;

/** One paper's cents by class, deposits apart. Σ classes + deposits = its total. */
export function foldPaper(
  paper: PaperIn,
  lines: LineIn[],
): { classes: Record<PurchaseClass, number>; deposits: number; total: number; vat: Map<string, number> } {
  const sign = paper.doc_type === "credit_memo" ? -1 : 1;
  const classes = emptyClasses();
  const vat = new Map<string, number>();
  let lineNet = 0;
  let lineDeposits = 0;
  let anyLineDeposit = false;
  for (const l of lines) {
    const net = c0(l.line_total);
    const cls = l.cls ?? "Not classed";
    classes[cls] += net;
    lineNet += net;
    if (l.deposit != null && l.deposit !== "") {
      anyLineDeposit = true;
      lineDeposits += c0(l.deposit);
    }
    const r = l.vat_rate_percent;
    const rate =
      r === null || r === undefined || r === "" || !Number.isFinite(Number(r))
        ? RATE_NOT_PRINTED
        : String(Number(r));
    vat.set(rate, (vat.get(rate) ?? 0) + net);
  }
  const deposits = anyLineDeposit ? lineDeposits : c0(paper.deposit_total);
  const printedTotal = toCents(paper.total as number | string | null);
  const residual =
    printedTotal !== null
      ? printedTotal - lineNet - deposits
      : c0(paper.freight) +
        c0(paper.fuel_surcharge) +
        c0(paper.split_case_fee) +
        c0(paper.delivery_fee) +
        c0(paper.other_charges) +
        c0(paper.tax) -
        c0(paper.discount_total);
  const keys = CLASSES.filter((k) => classes[k] > 0);
  if (residual !== 0) {
    if (keys.length === 0) classes["Not classed"] += residual;
    else {
      const shares = allocateSigned(
        keys.map((k) => classes[k]),
        residual,
      );
      keys.forEach((k, i) => (classes[k] += shares[i]));
    }
  }
  let total = deposits * sign;
  for (const k of CLASSES) {
    classes[k] = sign * classes[k] || 0;
    total += classes[k];
  }
  for (const [k, v] of vat) vat.set(k, sign * v || 0);
  return { classes, deposits: sign * deposits || 0, total, vat };
}

/** Every verified paper of a period, one result per currency. */
export function purchasesByCategory(
  papers: PaperIn[],
  linesByPaper: Map<string, LineIn[]>,
): PurchasesByCategory {
  const by = new Map<string, CurrencyPurchases & { vatMap: Map<string, number> }>();
  let papersWithoutCurrency = 0;
  for (const p of papers) {
    const cur = (p.currency ?? "").trim().toUpperCase();
    if (!cur) {
      papersWithoutCurrency++;
      continue;
    }
    const f = foldPaper(p, linesByPaper.get(p.id) ?? []);
    const acc =
      by.get(cur) ??
      ({
        currency: cur,
        papers: 0,
        classes: emptyClasses(),
        deposits: 0,
        total: 0,
        vat: [],
        taxPrinted: 0,
        vatMap: new Map(),
      } as CurrencyPurchases & { vatMap: Map<string, number> });
    acc.papers++;
    for (const k of CLASSES) acc.classes[k] += f.classes[k];
    acc.deposits += f.deposits;
    acc.total += f.total;
    acc.taxPrinted += c0(p.tax) * (p.doc_type === "credit_memo" ? -1 : 1);
    for (const [k, v] of f.vat) acc.vatMap.set(k, (acc.vatMap.get(k) ?? 0) + v);
    by.set(cur, acc);
  }
  const currencies = [...by.values()]
    .sort((a, b) => a.currency.localeCompare(b.currency))
    .map(({ vatMap, ...c }) => ({
      ...c,
      vat: [...vatMap.entries()]
        .sort(([a], [b]) =>
          a === RATE_NOT_PRINTED ? 1 : b === RATE_NOT_PRINTED ? -1 : Number(a) - Number(b),
        )
        .map(([rate, net]) => ({ rate, net })),
    }));
  return { currencies, papersWithoutCurrency };
}

// ---------------------------------------------------------------------------
// The read. Every hop names the house; pages of 1000 past PostgREST's cap.
// ---------------------------------------------------------------------------

const PAGE = 1000;
const IN_CHUNK = 200;

/** Whether YYYY-MM-DD `d` falls in [from, to]; a paper with no date is in no period. */
export function inPeriod(d: string | null | undefined, from: string, to: string): boolean {
  if (!d) return false;
  const day = String(d).slice(0, 10);
  return day >= from && day <= to;
}

type Client = { from: (t: string) => any };

async function pagedAll(
  q: () => any,
  what: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await q().range(at, at + PAGE - 1);
    if (error) throw new Error(`${what} could not be read: ${error.message}`);
    out.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < PAGE) return out;
  }
}

const chunks = <T>(xs: T[]) =>
  Array.from({ length: Math.ceil(xs.length / IN_CHUNK) }, (_, i) =>
    xs.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK),
  );

export async function readPurchasesByCategory(
  db: Client,
  restaurantId: string,
  from: string,
  to: string,
): Promise<PurchasesByCategory & { from: string; to: string; papersWithoutDate: number }> {
  const all = await pagedAll(
    () =>
      db
        .from("procurement_documents")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("status", "verified")
        .order("id", { ascending: true }),
    "The verified papers",
  );
  const papersWithoutDate = all.filter((p) => !p.doc_date).length;
  const papers = all.filter((p) =>
    inPeriod(p.doc_date as string | null, from, to),
  ) as unknown as PaperIn[];
  const linesByPaper = await readClassedLines(
    db,
    restaurantId,
    papers.map((p) => p.id),
  );
  return { ...purchasesByCategory(papers, linesByPaper), from, to, papersWithoutDate };
}

/**
 * The lines of these papers, each with the class of the good it is linked to.
 * Lines, goods and papers are all read with this house's restaurant_id; a
 * link to a good another house holds reads as no link.
 */
export async function readClassedLines(
  db: Client,
  restaurantId: string,
  paperIds: string[],
): Promise<Map<string, LineIn[]>> {
  const lines: Record<string, unknown>[] = [];
  for (const ids of chunks(paperIds)) {
    lines.push(
      ...(await pagedAll(
        () =>
          db
            .from("procurement_document_lines")
            .select("*")
            .eq("restaurant_id", restaurantId)
            .in("document_id", ids)
            .order("id", { ascending: true }),
        "The papers' lines",
      )),
    );
  }
  const goodIds = [
    ...new Set(lines.map((l) => l.inventory_id as string | null).filter(Boolean)),
  ] as string[];
  const goods = new Map<string, { kind: string | null; beverage_id: string | null }>();
  for (const ids of chunks(goodIds)) {
    const rows = await pagedAll(
      () =>
        db
          .from("restaurant_inventory")
          .select("id, kind, beverage_id")
          .eq("restaurant_id", restaurantId)
          .in("id", ids)
          .order("id", { ascending: true }),
      "The goods the lines are linked to",
    );
    for (const g of rows)
      goods.set(g.id as string, {
        kind: (g.kind as string | null) ?? null,
        beverage_id: (g.beverage_id as string | null) ?? null,
      });
  }
  const bevIds = [
    ...new Set(
      [...goods.values()]
        .filter((g) => (g.kind ?? "other") === "other" && g.beverage_id)
        .map((g) => g.beverage_id as string),
    ),
  ];
  const bevType = new Map<string, string | null>();
  for (const ids of chunks(bevIds)) {
    // the shared catalogue: no house column, read only for goods of this house
    const rows = await pagedAll(
      () =>
        db
          .from("beverages")
          .select("id, beverage_type")
          .in("id", ids)
          .order("id", { ascending: true }),
      "The catalogue kinds",
    );
    for (const b of rows) bevType.set(b.id as string, (b.beverage_type as string | null) ?? null);
  }
  const linesByPaper = new Map<string, LineIn[]>();
  for (const l of lines) {
    const g = l.inventory_id ? goods.get(l.inventory_id as string) : undefined;
    // a link to a good this house does not hold reads as no link
    const cls = g
      ? classOf(g.kind, g.beverage_id ? bevType.get(g.beverage_id) : null)
      : null;
    const id = l.document_id as string;
    const list = linesByPaper.get(id) ?? [];
    list.push({
      document_id: id,
      line_no: (l.line_no as number | null) ?? null,
      description: (l.description as string | null) ?? null,
      line_total: l.line_total as number | null,
      deposit: l.deposit as number | null,
      vat_rate_percent: (l.vat_rate_percent as number | null | undefined) ?? null,
      cls,
    });
    linesByPaper.set(id, list);
  }
  return linesByPaper;
}
