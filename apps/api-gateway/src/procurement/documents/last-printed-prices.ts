import { HttpException, HttpStatus } from "@nestjs/common";
import {
  addPerBottle,
  perBottlePrinted,
  type PerBottle,
  type PrintedLine,
} from "./price-move";
import { OVERLAY_LINE_COLUMNS, readCorrections } from "./corrections-read";
import { overlayCorrections } from "../canonical/correction-overlay";

/** How many of the newest papers the first price read takes (r108 g15). */
const LAST_PAPER_WINDOW = 200;

export interface Earlier {
  price: PerBottle;
  formatMl: number | null;
}

/**
 * Each good's printed price per bottle on the newest other verified paper of
 * this house in this money (r108 g15): one bounded read, then limit(1) per
 * good it missed, so a quarterly good is never lost off a row cap.
 *
 * Shared by GET :id/price-moves and the price_moved notification producer, so
 * both compare against the same basis (#2236). Moved out of
 * DocumentsController unchanged.
 */
export async function readLastPrintedPrices(
  client: any,
  paperId: string,
  currency: string,
  goods: string[],
  restaurantId: string,
): Promise<Map<string, Earlier>> {
  const last = new Map<string, Earlier>();
  if (!goods.length) return last;
  const read = async (only: string[], limit: number) => {
    const { data, error } = await client
      .from("procurement_documents")
      .select(
        "id, verified_at, procurement_document_lines!inner(inventory_id, restaurant_id, line_total, qty, pack_size, qty_bottles, uom, format_ml)",
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", "verified")
      .neq("id", paperId)
      .ilike("currency", currency)
      .not("doc_type", "in", "(credit_memo,purchase_order,statement)")
      .eq("procurement_document_lines.restaurant_id", restaurantId)
      .in("procurement_document_lines.inventory_id", only)
      .gt("procurement_document_lines.line_total", 0)
      .order("verified_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error)
      throw new HttpException(
        `The goods' earlier papers could not be read, so no price was compared: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    type Line = PrintedLine & { inventory_id: string; format_ml?: number | null };
    const papers = (data ?? []) as { id: string; procurement_document_lines: Line[] }[];
    await layCorrections(client, papers, only, restaurantId);
    // Newest first; two lines of one good on a paper are one price, summed.
    for (const p of papers) {
      const here = new Map<string, Earlier>();
      for (const l of p.procurement_document_lines ?? []) {
        if (!l.inventory_id || last.has(l.inventory_id)) continue;
        const pb = perBottlePrinted(l);
        if (typeof pb === "string") continue;
        const seen = here.get(l.inventory_id);
        here.set(l.inventory_id, {
          price: seen ? addPerBottle(seen.price, pb) : pb,
          formatMl: seen?.formatMl ?? l.format_ml ?? null,
        });
      }
      for (const [g, e] of here) last.set(g, e);
    }
  };
  await read(goods, LAST_PAPER_WINDOW);
  const missing = goods.filter((g) => !last.has(g));
  await Promise.all(missing.map((g) => read([g], 1)));
  return last;
}

/**
 * The basis papers as the owner corrected them (r109): a correction writes
 * document_corrections, never the line columns this read prices, so a paper
 * whose total was corrected would still be the basis at its first read. For a
 * paper that has corrections, every one of its lines is read (a correction
 * names a line by its place in the whole paper, and the embedded read holds only
 * the matching goods), corrected, and cut back to the goods and prices asked for.
 */
async function layCorrections(
  client: any,
  papers: { id: string; procurement_document_lines: any[] }[],
  goods: string[],
  restaurantId: string,
): Promise<void> {
  if (!papers.length) return;
  const fixes = await readCorrections(client, papers.map((p) => p.id));
  const touched = papers.filter((p) => (fixes.get(p.id) ?? []).length > 0);
  if (!touched.length) return;
  const ids = touched.map((p) => p.id);
  const [heads, lines] = await Promise.all([
    client.from("procurement_documents").select("id, doc_type, doc_number, currency, subtotal, tax, total").eq("restaurant_id", restaurantId).in("id", ids),
    client.from("procurement_document_lines").select(OVERLAY_LINE_COLUMNS).eq("restaurant_id", restaurantId).in("document_id", ids).order("line_no", { ascending: true }),
  ]);
  const failed = heads.error ?? lines.error;
  if (failed)
    throw new HttpException(
      `The goods' earlier papers could not be read as corrected, so no price was compared: ${failed.message}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  for (const p of touched) {
    const head = ((heads.data ?? []) as any[]).find((h) => h.id === p.id) ?? { id: p.id };
    const own = ((lines.data ?? []) as any[]).filter((l) => l.document_id === p.id);
    const laid = overlayCorrections(head, own, fixes.get(p.id) ?? []);
    p.procurement_document_lines = laid.lines.filter(
      (l: any) => goods.includes(l.inventory_id) && Number(l.line_total) > 0,
    );
  }
}
