/**
 * The paper a door count is made FOR (r24, door-count lane).
 *
 * Counting an invoice at `/documents/:id?view=door` used to record a count that
 * knew nothing of the invoice: no item on its lines (0 lots booked), and a
 * delivery holding neither the invoice nor its order, so the AGREED gate could
 * not fire and VERIFIED had no price to post (r23 walk, R23-VOL-1).
 *
 * THE PAPER IS THE TRUTH, NOT THE CLIENT. Each counted line names the paper's
 * line (`sourceLineId`); the item, unit, size and pack are copied from THAT
 * row, read under this house. One exception: a case whose pack the paper does
 * not state takes the pack the door gives (r28 G1). The door line keeps the paper's line number, so
 * the paper can later say what each of its lines received. Every refusal here
 * comes before anything is written.
 */

import { DoorCountLineDto } from "../dto/deliveries.dto";
import { normalizeUom, Uom } from "./document-types";
import { knownPack, PACKED_DOOR_UNITS, UNIT_WORDS } from "./door-count-lines";

type Client = { from: (table: string) => any };

export type PaperResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

/** The roles a paper that can be counted plays on its delivery. */
const COUNTABLE: Record<string, "invoice" | "despatch_advice"> = {
  invoice: "invoice",
  packing_slip: "despatch_advice",
  delivery_note: "despatch_advice",
  delivery_receipt: "despatch_advice",
};

/** A delivery that no longer takes goods. A paper on one is counted onto a new one. */
const CLOSED = new Set(["CANCELLED", "REJECTED"]);

export interface PaperForDoor {
  documentId: string;
  role: "invoice" | "despatch_advice";
  /** The paper's one linked order; null when it has none. */
  orderId: string | null;
  /** The open deliveries this paper already sits on. */
  openDeliveryIds: string[];
  /** The counted lines with the paper's own facts in place of the client's. */
  lines: DoorCountLineDto[];
}

interface PaperLineRow {
  id: string;
  line_no: number | null;
  inventory_id: string | null;
  uom: string | null;
  format_ml: number | string | null;
  pack_size: number | string | null;
  vintage: number | string | null;
  description: string | null;
  vendor_sku: string | null;
}

const int = (v: unknown): number | undefined => {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * Tie each counted line to the paper's line, and find the paper's order and the
 * deliveries it sits on. A delivery's order is permanent (ADR 0103 D5): an
 * asked order must be one of the paper's, and a paper on several asks which.
 */
export async function paperForTheDoor(
  client: Client,
  restaurantId: string,
  documentId: string,
  counted: DoorCountLineDto[],
  askedOrderId: string | null,
): Promise<PaperResult<PaperForDoor>> {
  const doc = await client
    .from("procurement_documents")
    .select("id, doc_type")
    .eq("restaurant_id", restaurantId)
    .eq("id", documentId)
    .maybeSingle();
  if (doc.error)
    return { ok: false, status: 503, error: `the paper ${documentId} could not be read (${doc.error.message})); nothing was recorded.` };
  if (!doc.data) return { ok: false, status: 404, error: "The paper this count is for was not found at this house." };
  const docType = String((doc.data as { doc_type: string | null }).doc_type ?? "");
  const role = COUNTABLE[docType];
  if (!role)
    return { ok: false, status: 400, error: `A ${docType.replace(/_/g, " ") || "paper of no known kind"} is not counted at the door. Count the invoice or the delivery note that came with the goods.` };

  const read = await client
    .from("procurement_document_lines")
    .select("id, line_no, inventory_id, uom, format_ml, pack_size, vintage, description, vendor_sku")
    .eq("restaurant_id", restaurantId)
    .eq("document_id", documentId);
  if (read.error)
    return { ok: false, status: 503, error: `the paper's lines could not be read (${read.error.message})); nothing was recorded.` };
  const byId = new Map(((read.data ?? []) as PaperLineRow[]).map((r) => [r.id, r]));

  const seen = new Set<string>();
  const lines: DoorCountLineDto[] = [];
  for (const c of counted) {
    const row = c.sourceLineId ? byId.get(c.sourceLineId) : undefined;
    if (!c.sourceLineId)
      return { ok: false, status: 400, error: `Counted line ${c.lineNo} does not say which line of the paper it counts, so it cannot be booked against the paper. Nothing was recorded.` };
    if (!row)
      return { ok: false, status: 400, error: `Counted line ${c.lineNo} names a line that is not on this paper. Nothing was recorded; reload the paper and count again.` };
    if (seen.has(row.id))
      return { ok: false, status: 400, error: `Line ${row.line_no ?? "?"} of the paper was counted twice in one count. Nothing was recorded; count it once.` };
    seen.add(row.id);
    if (row.line_no == null)
      return { ok: false, status: 409, error: `A line of the paper ("${row.description ?? row.vendor_sku ?? row.id}") carries no line number, so its count could not be kept against it. Nothing was recorded.` };
    // THE PACK THE PAPER DOES NOT KNOW (r28 G1). A pack of 1 on a case is the
    // paper saying nothing (the column defaults to 1). The person holding the
    // case then says how many bottles it holds, and only then: a pack the
    // paper states is never overridden from the door. With neither, the count
    // is refused, because two unread cases would go on the shelf as 2 bottles.
    const unit = (normalizeUom(row.uom ?? c.uom) ?? "bottle") as Uom;
    const paperPack = knownPack(row.pack_size);
    const doorPack = knownPack(c.packSize);
    const pack = PACKED_DOOR_UNITS.has(unit) ? (paperPack ?? doorPack) : int(row.pack_size);
    if (PACKED_DOOR_UNITS.has(unit) && paperPack == null && doorPack == null && Number(c.qty) > 0)
      return {
        ok: false,
        status: 422,
        error: `Line ${row.line_no} of the paper ("${row.description ?? row.vendor_sku ?? "no description"}") is in ${UNIT_WORDS[unit]}, and the paper does not say how many bottles one holds, so the count cannot go on the shelf as bottles. Say how many bottles are in one, or set the pack on the paper's line first. Nothing was recorded.`,
      };
    lines.push({
      lineNo: row.line_no,
      qty: c.qty,
      uom: row.uom ?? c.uom,
      ...(row.description ? { description: row.description } : {}),
      ...(row.vendor_sku ? { vendorSku: row.vendor_sku } : {}),
      ...(pack ? { packSize: pack } : {}),
      ...(int(row.vintage) ? { vintage: int(row.vintage) } : {}),
      ...(int(row.format_ml) ? { formatMl: int(row.format_ml) } : {}),
      // The paper's pairing, or none: a line the paper has not paired books
      // nothing and says so (ADR 0103 A6). The client's id is never used here.
      ...(row.inventory_id ? { inventoryId: row.inventory_id } : {}),
      sourceLineId: row.id,
    } as DoorCountLineDto);
  }

  const links = await client
    .from("procurement_document_links")
    .select("order_id")
    .eq("restaurant_id", restaurantId)
    .eq("document_id", documentId);
  if (links.error)
    return { ok: false, status: 503, error: `which order this paper is for could not be read (${links.error.message})); nothing was recorded.` };
  const orders = [...new Set(((links.data ?? []) as { order_id: string | null }[]).map((l) => l.order_id).filter((x): x is string => !!x))];
  let orderId: string | null;
  if (askedOrderId) {
    if (orders.length && !orders.includes(askedOrderId))
      return { ok: false, status: 400, error: "The order named is not one this paper is linked to. Nothing was recorded." };
    orderId = askedOrderId;
  } else if (orders.length > 1) {
    return { ok: false, status: 409, error: `This paper is linked to ${orders.length} orders, and one delivery is for one order. Say which order this truck brought; nothing was recorded.` };
  } else {
    orderId = orders[0] ?? null;
  }

  const joins = await client
    .from("document_deliveries")
    .select("delivery_id")
    .eq("document_id", documentId);
  if (joins.error)
    return { ok: false, status: 503, error: `which deliveries carry this paper could not be read (${joins.error.message})); nothing was recorded.` };
  const ids = [...new Set(((joins.data ?? []) as { delivery_id: string }[]).map((j) => j.delivery_id))];
  let openDeliveryIds: string[] = [];
  if (ids.length) {
    const states = await client
      .from("deliveries")
      .select("id, state")
      .eq("restaurant_id", restaurantId)
      .in("id", ids);
    if (states.error)
      return { ok: false, status: 503, error: `the deliveries carrying this paper could not be read (${states.error.message})); nothing was recorded.` };
    openDeliveryIds = ((states.data ?? []) as { id: string; state: string }[])
      .filter((d) => !CLOSED.has(d.state))
      .map((d) => d.id);
  }

  return { ok: true, value: { documentId, role, orderId, openDeliveryIds, lines } };
}
