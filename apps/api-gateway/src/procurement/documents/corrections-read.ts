import { HttpException, HttpStatus } from "@nestjs/common";
import type { CorrectionRowLite } from "../canonical/correction-overlay";

/**
 * Every column a line needs for its corrections to be laid back over it
 * (`overlayCorrections` replays a correction through the canonical read, which
 * reads these). A read that selects fewer would replay on defaults.
 */
export const OVERLAY_LINE_COLUMNS =
  "document_id, line_no, description, inventory_id, line_total, qty, pack_size, qty_bottles, uom, format_ml, vendor_sku, vintage, free_goods_qty, unit_price, price_base_qty, price_base_uom, allowance, deposit";

/**
 * The corrections of some papers, oldest revision first, paged in a total order
 * (document, revision, id) with the ids in chunks, so no URL grows past a limit
 * and no row is read twice or skipped between pages. A failed read throws in
 * words: a paper that may have been corrected is never read as first read
 * (ADR 0020, DD-r108-20).
 */
export async function readCorrections(
  client: any,
  documentIds: string[],
): Promise<Map<string, CorrectionRowLite[]>> {
  const out = new Map<string, CorrectionRowLite[]>();
  const ids = [...new Set(documentIds)];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("document_corrections")
        .select("id, document_id, revision, kind, field_path, after")
        .in("document_id", chunk)
        .order("document_id", { ascending: true })
        .order("revision", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error)
        throw new HttpException(
          `The corrections to these papers could not be read, so no price was compared: ${error.message}`,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      for (const r of (data ?? []) as (CorrectionRowLite & { document_id: string })[])
        out.set(r.document_id, [...(out.get(r.document_id) ?? []), r]);
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}
