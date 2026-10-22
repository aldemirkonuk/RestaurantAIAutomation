/**
 * CHECKED DELIVERIES WITH NO INVOICE FILED — F-160, the founder's ruling
 * RECEIPTS-W53 ("Count paper owed (Recommended)", 2026-10-02; recorded in the
 * R3 sim-rulings ADR). /receipts said "the paper trail is caught up" whenever
 * its review queue was empty, while hundreds of deliveries the desk had
 * already checked had no invoice linked to their order. This is the count
 * that sentence was standing in for.
 *
 * WHAT "CHECKED" MEANS, FROM THE CODE THAT CHECKS:
 *   * `match_verified_at` is written by one place only, `verifyReceipt`'s
 *     match (`procurement.service.ts`, `match_verified_at: new Date()`), when
 *     the desk compares the delivery against the order and a typed price;
 *   * that same write leaves the order COMPLETED, or PARTIALLY_RECEIVED when
 *     bottles are backordered or no invoice was there to compare
 *     (`awaitingInvoice`: many distributors bill weekly in arrears);
 *   * PARTIALLY_RECEIVED alone is NOT checked: the door leaves every case
 *     count there (`receiving.service.ts`, "The order is NOT completed here"),
 *     with no `match_verified_at`.
 *   So a checked delivery is an order in COMPLETED or PARTIALLY_RECEIVED whose
 *   `match_verified_at` is set. A later truck that moves it back to DELIVERED
 *   leaves it out until it is checked again.
 *
 * WHAT "HAS ITS INVOICE" MEANS: the gateway's existing rule, not a new one —
 * a document LINKED to the order (`procurement_document_links`) that is a
 * live invoice (`isLiveInvoice`, `own-paper-sighting.ts`: an invoice, not
 * rejected, not superseded). Every read is house-scoped on `restaurant_id`.
 *
 * ABSENCE IS NOT HEALTH (ADR 0051 clause 2, ADR 0067):
 *   * any failed read THROWS. A count of zero from a read that did not happen
 *     is the exact "caught up" this replaces;
 *   * the checked orders are read up to `PAPER_OWED_ORDER_CEILING`, oldest
 *     check first. A read stopped by that ceiling says so (`complete: false`)
 *     and the count is then a floor;
 *   * a page of links that comes back full is refused rather than trusted: a
 *     link missed would count an order as owing paper it has.
 *   * a failed vendor-name read does not fail the count; it is named
 *     (`vendorNamesUnavailable`) and each row's name is null, never a guess.
 */
import { isLiveInvoice, type PaperCandidate } from "./own-paper-sighting";

type Db = { from(table: string): any };

/** Rows per page of checked orders. PostgREST's `max_rows` is 1000 here (`supabase/config.toml`). */
export const PAPER_OWED_PAGE = 1000;
/** The most checked orders one answer reads. Past it the count is a floor (`complete: false`). */
export const PAPER_OWED_ORDER_CEILING = 3000;
/** Order (and document) ids per `.in()` read, so no request line grows past what a proxy accepts. */
export const PAPER_OWED_ID_CHUNK = 100;
/** The rows "See them" lists, oldest first. The count is never limited by it. */
export const PAPER_OWED_LIST_MAX = 20;

/** The statuses a checked order is left in by `verifyReceipt`. */
export const CHECKED_ORDER_STATUSES = ["COMPLETED", "PARTIALLY_RECEIVED"] as const;

export interface CheckedOrderRow {
  id: string;
  order_number: string | null;
  provider_id: string | null;
  delivered_at: string | null;
  match_verified_at: string;
}

export interface PaperOwedItem {
  orderId: string;
  orderNumber: string | null;
  vendorName: string | null;
  /** When the door booked it; null when the order never went through the door. */
  deliveredAt: string | null;
  /** When the desk checked it (`match_verified_at`). */
  checkedAt: string;
}

export interface PaperOwed {
  /** Checked deliveries with no live invoice linked. A floor when `complete` is false. */
  count: number;
  /** False when the checked orders were read only up to the ceiling: `count` is then a floor. */
  complete: boolean;
  /** How many checked deliveries were read to reach `count`. */
  checkedRead: number;
  /** The oldest owed delivery's date (delivered, else checked); null when none is owed. */
  oldestAt: string | null;
  /** At most `PAPER_OWED_LIST_MAX`, oldest first. `items.length < count` means the list is cut. */
  items: PaperOwedItem[];
  listMax: number;
  vendorNamesUnavailable: boolean;
}

function chunks<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** The date a row is dated by: the delivery where the door booked it, else the check. */
function since(o: Pick<CheckedOrderRow, "delivered_at" | "match_verified_at">): string {
  return o.delivered_at ?? o.match_verified_at;
}

function time(iso: string): number {
  const t = new Date(iso).getTime();
  // An unreadable date sorts LAST: it never presents itself as the oldest debt.
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

/**
 * The checked orders that have no live invoice linked, oldest first. Pure, so
 * the rule is tested without a database. `links` and `documents` must already
 * be this house's: the reads below scope them.
 */
export function ordersOwingPaper(args: {
  orders: readonly CheckedOrderRow[];
  links: readonly { order_id: string; document_id: string }[];
  documents: readonly Pick<PaperCandidate, "id" | "doc_type" | "status">[];
}): CheckedOrderRow[] {
  const live = new Set(args.documents.filter(isLiveInvoice).map((d) => d.id));
  const papered = new Set(
    args.links.filter((l) => live.has(l.document_id)).map((l) => l.order_id),
  );
  return args.orders
    .filter((o) => !papered.has(o.id))
    .sort((a, b) => time(since(a)) - time(since(b)) || a.id.localeCompare(b.id));
}

/**
 * The house's checked deliveries with no invoice filed: the count, the oldest
 * date and the first `PAPER_OWED_LIST_MAX`, oldest first.
 */
export async function readPaperOwed(db: Db, restaurantId: string): Promise<PaperOwed> {
  // 1. The checked orders, oldest check first, a page at a time up to the ceiling.
  const orders: CheckedOrderRow[] = [];
  let complete = true;
  for (let from = 0; ; from += PAPER_OWED_PAGE) {
    const { data, error } = await db
      .from("procurement_orders")
      .select("id, order_number, provider_id, delivered_at, match_verified_at")
      .eq("restaurant_id", restaurantId)
      .in("status", CHECKED_ORDER_STATUSES as unknown as string[])
      .not("match_verified_at", "is", null)
      .order("match_verified_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAPER_OWED_PAGE - 1);
    if (error || !Array.isArray(data)) {
      throw new Error(
        `The checked deliveries could not be read (${error?.message ?? "no rows came back"}).`,
      );
    }
    orders.push(...(data as CheckedOrderRow[]));
    if (data.length < PAPER_OWED_PAGE) break;
    if (orders.length >= PAPER_OWED_ORDER_CEILING) {
      complete = false;
      break;
    }
  }

  // 2. The documents linked to those orders, in this house only.
  const links: { order_id: string; document_id: string }[] = [];
  for (const ids of chunks(orders.map((o) => o.id), PAPER_OWED_ID_CHUNK)) {
    const { data, error } = await db
      .from("procurement_document_links")
      .select("order_id, document_id")
      .eq("restaurant_id", restaurantId)
      .in("order_id", ids)
      .limit(PAPER_OWED_PAGE);
    if (error || !Array.isArray(data)) {
      throw new Error(
        `The documents linked to the checked deliveries could not be read (${error?.message ?? "no rows came back"}).`,
      );
    }
    if (data.length >= PAPER_OWED_PAGE) {
      // A full page may have dropped a link, and a dropped link would count an
      // order as owing an invoice it has. Refused, not trusted.
      throw new Error(
        "The documents linked to the checked deliveries could not be read whole, so no count is given.",
      );
    }
    links.push(...(data as { order_id: string; document_id: string }[]));
  }

  // 3. Which of those documents are live invoices, in this house only.
  const documents: Pick<PaperCandidate, "id" | "doc_type" | "status">[] = [];
  const docIds = [...new Set(links.map((l) => l.document_id).filter(Boolean))];
  for (const ids of chunks(docIds, PAPER_OWED_ID_CHUNK)) {
    const { data, error } = await db
      .from("procurement_documents")
      .select("id, doc_type, status")
      .eq("restaurant_id", restaurantId)
      .in("id", ids);
    if (error || !Array.isArray(data)) {
      throw new Error(
        `The checked deliveries' documents could not be read (${error?.message ?? "no rows came back"}).`,
      );
    }
    documents.push(...(data as Pick<PaperCandidate, "id" | "doc_type" | "status">[]));
  }

  const owed = ordersOwingPaper({ orders, links, documents });
  const shown = owed.slice(0, PAPER_OWED_LIST_MAX);

  // 4. Vendor names for the rows shown. A failed read is named, never guessed.
  const providerIds = [
    ...new Set(shown.map((o) => o.provider_id).filter((x): x is string => !!x)),
  ];
  let names = new Map<string, string>();
  let vendorNamesUnavailable = false;
  if (providerIds.length) {
    const { data, error } = await db
      .from("providers")
      .select("id, name")
      .in("id", providerIds);
    if (error || !Array.isArray(data)) vendorNamesUnavailable = true;
    else
      names = new Map(
        (data as { id: string; name: string | null }[])
          .filter((p) => typeof p.name === "string" && p.name.trim() !== "")
          .map((p) => [p.id, (p.name as string).trim()]),
      );
  }

  return {
    count: owed.length,
    complete,
    checkedRead: orders.length,
    oldestAt: owed.length ? since(owed[0]) : null,
    items: shown.map((o) => ({
      orderId: o.id,
      orderNumber: o.order_number ?? null,
      vendorName: o.provider_id ? (names.get(o.provider_id) ?? null) : null,
      deliveredAt: o.delivered_at ?? null,
      checkedAt: o.match_verified_at,
    })),
    listMax: PAPER_OWED_LIST_MAX,
    vendorNamesUnavailable,
  };
}
