import { readAll } from "../providers/vendor-menu-supply";
import { bucketSpend, type BucketSpend, type SpendHouse } from "./uncosted-spend";

/**
 * SPEND FROM SCANNED PAPERS (r36 invoices audit R3).
 *
 * Every spend reader on the dashboard summed `procurement_orders` only. A
 * house that buys by scanning the paper at the door (the founder's main flow:
 * scan, count, agree, verify) has deliveries with no order, so "Paid to
 * vendors" read 0 for a month of real buying: absence read as health.
 *
 * WHAT COUNTS. A delivery with NO order (`deliveries.order_id IS NULL`; one
 * with an order is already counted by that order) that the house has verified
 * or that the law has closed: VERIFIED, INVOICE_FILED, LAPSED or
 * LAPSED_AMENDED (ADR 0103 A1: vendor spend posts at VERIFIED). Its spend is
 * what its papers say: the totals of the documents filed on it as its
 * `invoice`, less those filed as its `credit_memo`. A rejected or superseded
 * paper is not read.
 *
 * Rules:
 *  - A paper filed on several deliveries (a consolidated invoice) is counted
 *    once, on the earliest of them.
 *  - A delivery with no invoice, or an invoice with no total, has no recorded
 *    cost: the window's figure is withheld and counted, never summed short.
 *  - Papers in one delivery that name different monies are not added: the
 *    delivery has no recorded cost.
 *  - A delivery whose credits meet or pass its invoices adds nothing (it was
 *    given back), and is still counted.
 *  - A delivery's day is when it came in (`delivered_at`), else when it was
 *    verified, the same day rule as an order's `delivered_at`.
 *  - A read that fails is a reason, never an empty list.
 */
export const PAPER_SPEND_STATES = ["VERIFIED", "INVOICE_FILED", "LAPSED", "LAPSED_AMENDED"] as const;

export interface PaperDelivery {
  id: string;
  delivered_at: string | null;
  verified_at: string | null;
}
export interface PaperLink {
  document_id: string;
  delivery_id: string;
  role: string;
}
export interface PaperDoc {
  id: string;
  total: number | string | null;
  currency: string | null;
  status: string | null;
}

/** One verified delivery with no order, shaped as the spend buckets read an order. */
export interface PaperSpendRow {
  deliveryId: string;
  delivered_at: string | null;
  total_cost: number | null;
  final_price: null;
  currency: string | null;
  /** True when the papers add to nothing or less: given back, so it adds 0 and is never "uncosted". */
  givenBack: boolean;
}

export interface PaperSpendRead {
  rows: PaperSpendRow[];
  /** Why the papers could not be read; null when they were. */
  unread: string | null;
}

const money = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const code = (v: unknown): string | null =>
  typeof v === "string" && /^[A-Za-z]{3}$/.test(v.trim()) ? v.trim().toUpperCase() : null;
const dayOf = (d: PaperDelivery) => d.delivered_at ?? d.verified_at;

/** The rows, from the three reads. Pure. */
export function paperRowsOf(deliveries: PaperDelivery[], links: PaperLink[], docs: PaperDoc[]): PaperSpendRow[] {
  const byId = new Map(deliveries.map((d) => [d.id, d]));
  const docById = new Map(
    docs.filter((d) => d.status !== "rejected" && d.status !== "superseded").map((d) => [d.id, d]),
  );
  // Each paper on the earliest delivery it is filed on.
  const home = new Map<string, { deliveryId: string; role: string }>();
  for (const l of links) {
    if (l.role !== "invoice" && l.role !== "credit_memo") continue;
    const d = byId.get(l.delivery_id);
    if (!d || !docById.has(l.document_id)) continue;
    const prev = home.get(l.document_id);
    const prevDay = prev ? dayOf(byId.get(prev.deliveryId)!) : null;
    const day = dayOf(d);
    if (!prev || (day !== null && (prevDay === null || day < prevDay))) home.set(l.document_id, { deliveryId: d.id, role: l.role });
  }
  const papers = new Map<string, Array<{ doc: PaperDoc; role: string }>>();
  for (const [docId, h] of home) {
    const list = papers.get(h.deliveryId) ?? [];
    list.push({ doc: docById.get(docId)!, role: h.role });
    papers.set(h.deliveryId, list);
  }
  // A consolidated paper counted on another delivery leaves this one with
  // none of its own; it is then not a delivery of unknown cost, it is paid
  // for on its sibling.
  const counted = new Set<string>();
  for (const l of links) if (home.get(l.document_id) && byId.has(l.delivery_id)) counted.add(l.delivery_id);

  const rows: PaperSpendRow[] = [];
  for (const d of deliveries) {
    const own = papers.get(d.id) ?? [];
    if (own.length === 0 && counted.has(d.id)) continue;
    const invoices = own.filter((p) => p.role === "invoice");
    const base: Omit<PaperSpendRow, "total_cost" | "currency" | "givenBack"> = {
      deliveryId: d.id,
      delivered_at: dayOf(d),
      final_price: null,
    };
    const codes = new Set(own.map((p) => code(p.doc.currency)));
    const amounts = own.map((p) => money(p.doc.total));
    if (invoices.length === 0 || amounts.some((a) => a === null) || codes.size > 1) {
      rows.push({ ...base, total_cost: null, currency: codes.size === 1 ? [...codes][0] : null, givenBack: false });
      continue;
    }
    let net = 0;
    own.forEach((p, i) => {
      const a = Math.abs(amounts[i] as number);
      net += p.role === "credit_memo" ? -a : a;
    });
    net = Math.round(net * 100) / 100;
    const currency = [...codes][0] ?? null;
    rows.push({ ...base, total_cost: net > 0 ? net : null, currency, givenBack: !(net > 0) });
  }
  return rows;
}

const CHUNK = 100;
const UNREAD = "The scanned papers of deliveries with no order could not be read just now, so what they cost is not known.";

/** Read the papers of this house's verified deliveries that had no order. */
export async function readPaperSpend(client: any, restaurantId: string): Promise<PaperSpendRead> {
  try {
    // Keyset pages past the 1000-row read cap; a failed page throws, and the
    // whole read is then a reason, never a shorter list.
    const deliveries = (await readAll("Deliveries with no order", (after) => {
      let q = client
        .from("deliveries")
        .select("id, delivered_at, verified_at")
        .eq("restaurant_id", restaurantId)
        .is("order_id", null)
        .in("state", [...PAPER_SPEND_STATES]);
      if (after !== null) q = q.gt("id", after);
      return q;
    })) as unknown as PaperDelivery[];
    if (deliveries.length === 0) return { rows: [], unread: null };

    const links: PaperLink[] = [];
    const ids = deliveries.map((d) => d.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await client
        .from("document_deliveries")
        .select("document_id, delivery_id, role")
        .in("delivery_id", ids.slice(i, i + CHUNK))
        .in("role", ["invoice", "credit_memo"]);
      if (error) return { rows: [], unread: UNREAD };
      links.push(...((data ?? []) as PaperLink[]));
    }

    const docs: PaperDoc[] = [];
    const docIds = [...new Set(links.map((l) => l.document_id))];
    for (let i = 0; i < docIds.length; i += CHUNK) {
      const { data, error } = await client
        .from("procurement_documents")
        .select("id, total, currency, status")
        .eq("restaurant_id", restaurantId)
        .in("id", docIds.slice(i, i + CHUNK));
      if (error) return { rows: [], unread: UNREAD };
      docs.push(...((data ?? []) as PaperDoc[]));
    }
    return { rows: paperRowsOf(deliveries, links, docs), unread: null };
  } catch {
    return { rows: [], unread: UNREAD };
  }
}

/** What the papers in one window add, said about deliveries, not orders. */
export interface PaperWindow {
  /** Verified deliveries with no order in the window. */
  counted: number;
  /** Of those, the ones with no recorded cost on their papers. */
  uncosted: number;
  /** Of those, the ones whose papers are not in the house's money, by code. */
  notInHouseCurrency: Record<string, number>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One window's spend with its papers added: the orders' figure plus the
 * papers', or null when either is withheld, with every reason said.
 */
export function withPaperSpend(
  orders: BucketSpend,
  rows: PaperSpendRow[],
  house: SpendHouse,
  papersUnread: string | null,
): { read: BucketSpend; papers: PaperWindow } {
  if (papersUnread !== null) {
    return {
      read: { ...orders, spend: null, unread: [orders.unread, papersUnread].filter(Boolean).join(" ") },
      papers: { counted: 0, uncosted: 0, notInHouseCurrency: {} },
    };
  }
  const priced = rows.filter((r) => !r.givenBack);
  const p = bucketSpend(priced, house);
  const papers: PaperWindow = { counted: rows.length, uncosted: p.uncosted, notInHouseCurrency: p.notInHouseCurrency };
  if (p.spend !== null && orders.spend !== null) {
    return { read: { ...orders, spend: Math.round((orders.spend + p.spend) * 100) / 100 }, papers };
  }
  const why: string[] = [];
  const other = Object.values(p.notInHouseCurrency).reduce((a, b) => a + b, 0);
  if (other > 0)
    why.push(
      `${plural(other, "scanned delivery with no order is", "scanned deliveries with no order are")} not in house currency (${Object.entries(
        p.notInHouseCurrency,
      )
        .map(([c, n]) => `${n} in ${c}`)
        .join(", ")}), and nothing here converts one currency into another.`,
    );
  if (p.uncosted > 0)
    why.push(
      `${plural(p.uncosted, "scanned delivery with no order has", "scanned deliveries with no order have")} no invoice total on its papers yet.`,
    );
  return {
    read: { ...orders, spend: null, unread: [orders.unread, ...why].filter(Boolean).join(" ") || null },
    papers,
  };
}
