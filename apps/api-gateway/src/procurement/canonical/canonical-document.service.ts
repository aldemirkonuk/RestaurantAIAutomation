import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { normalizeUom, Uom } from "../documents/document-types";
import { ParsedDocument } from "../documents/parsed-document";
import { parsedFromDocumentRows } from "./from-document-rows";
import { canonicalFromParsedDocument } from "./from-parsed-document";
import { CanonicalDocument, ResolvedLine, Source } from "./canonical-types";

/**
 * CanonicalDocumentService — build the canonical object for a stored document,
 * and append a revision of it.
 *
 * READ-ONLY, AND ONE CODE PATH. Slice 1 built this with no route and no provider
 * registration; slice 2 registers it in ProcurementModule and exposes it through
 * `GET /procurement/documents/:id/canonical`. The corpus runner still goes
 * through the same builder, so the report grades the code the product runs
 * rather than a second implementation of it.
 *
 * A FAILED READ IS NEVER AN EMPTY DOCUMENT (ADR 0067). supabase-js RESOLVES
 * with `{ data, error }` — it does not throw — so every read below inspects
 * `error` explicitly and returns a `{ ok: false, error }` result. There is no
 * path through this file on which a database failure produces a canonical
 * document with no lines, which is the shape that would let a broken query
 * render as "this invoice had nothing on it".
 *
 * WHY IT REBUILDS FROM COLUMNS RATHER THAN FROM `procurement_documents.extracted`.
 * That jsonb column holds the parser's own snapshot at intake. `editLine`
 * (document-intake.service.ts) corrects `procurement_document_lines` and the
 * tie-out columns and does NOT rewrite the snapshot, so reading it would return
 * a document a human has already corrected — silently, and only for the fields
 * they corrected.
 */

export type ReadResult<T> =
  | { ok: true; value: T; notes?: string[] }
  | { ok: false; error: string };

/**
 * "This database does not have that column", in the TWO codes PostgREST uses
 * for it — measured, not guessed (2026-09-04):
 *
 *   42703      Postgres `undefined_column`, forwarded verbatim when a
 *              `.select()` names a column the table does not have.
 *   PGRST204   PostgREST's OWN code, returned when an INSERT/UPDATE payload
 *              carries a key that is not in its schema cache
 *              ("Could not find the 'printed' column ... in the schema cache").
 *
 * Keying on only one of them is how a schema-lag retry silently never fires.
 */
const UNDEFINED_COLUMN_CODES = new Set(["42703", "PGRST204"]);

function isUndefinedColumn(
  error: { code?: string } | null | undefined,
): boolean {
  return !!error?.code && UNDEFINED_COLUMN_CODES.has(error.code);
}

/**
 * What a PostgREST read resolves to, narrowed to the two things this file acts
 * on. Declared because the same variable holds the answer to two DIFFERENT
 * column lists (the full one and the pre-migration fallback), and supabase-js
 * types each `.select()` by its literal string.
 */
type RawRead = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

interface DocumentRow {
  id: string;
  restaurant_id: string;
  provider_id: string | null;
  doc_type: string;
  doc_number: string | null;
  doc_date: string | null;
  references_doc_number: string | null;
  currency: string | null;
  subtotal: number | null;
  freight: number | null;
  fuel_surcharge: number | null;
  split_case_fee: number | null;
  delivery_fee: number | null;
  deposit_total: number | null;
  tax: number | null;
  other_charges: number | null;
  discount_total: number | null;
  total: number | null;
  extraction_confidence: number | null;
  extraction_model: string | null;
  direction: string | null;
  jurisdiction: string | null;
  source_channel: string | null;
  notes: string | null;
  printed?: Record<string, string> | null;
  /**
   * The parser's own snapshot at intake.
   *
   * READ ONLY FOR FIELDS THAT HAVE NO COLUMN. `procurement_documents` has no
   * vendor-name, delivered-date or VAT-breakdown column, so the snapshot is the
   * ONLY place those three exist — and every one of the three documents read on
   * 2026-09-04 rendered "The seller is not named on this document" while its
   * own extraction had supplied `vendorName`.
   *
   * The class doc's warning still stands for everything else: `editLine`
   * corrects the LINE rows and does not rewrite this snapshot, so reading a
   * corrected field from here would silently show the pre-correction value.
   * The fields below are not correctable through `editLine` — it touches
   * quantities, prices and units on `procurement_document_lines` — so there is
   * no correction for the snapshot to be stale about.
   */
  extracted?: Record<string, unknown> | null;
}

interface LineRow {
  line_no: number;
  vendor_sku: string | null;
  description: string | null;
  vintage: number | null;
  format_ml: number | null;
  qty: number | string | null;
  uom: string | null;
  pack_size: number | null;
  qty_bottles: number | string | null;
  free_goods_qty: number | string | null;
  unit_price: number | string | null;
  line_total: number | string | null;
  allowance: number | string | null;
  deposit: number | string | null;
  order_line_id: string | null;
  match_method: string | null;
  match_confidence: number | string | null;
  /** BT-149 / BT-150 and the kept literals — migration 20260904120000. */
  price_base_qty?: number | string | null;
  price_base_uom?: string | null;
  printed?: Record<string, string> | null;
}

/** Postgres numerics arrive as strings through PostgREST. */
const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "number" ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

const DOCUMENT_COLUMNS_BASE =
  "id, restaurant_id, provider_id, doc_type, doc_number, doc_date, " +
  "references_doc_number, currency, subtotal, freight, fuel_surcharge, " +
  "split_case_fee, delivery_fee, deposit_total, tax, other_charges, " +
  "discount_total, total, extraction_confidence, extraction_model, direction, " +
  "jurisdiction, source_channel, notes, extracted";

const LINE_COLUMNS_BASE =
  "line_no, vendor_sku, description, vintage, format_ml, qty, uom, pack_size, " +
  "qty_bottles, free_goods_qty, unit_price, line_total, allowance, deposit, " +
  "order_line_id, match_method, match_confidence";

/**
 * The columns migration 20260904120000 adds. Named separately because a
 * database that has not applied it yet must be TOLD APART from a document that
 * genuinely printed no price base — see the 42703 retry in buildFromDocumentId.
 */
/**
 * SPELLED OUT, not built from the BASE constants with a template literal.
 * `check_read_columns_exist.py` can only check a select whose column list is a
 * literal; a `${...}` here makes the read UNREADABLE to the guard, which is how
 * a select naming a column that does not exist gets past CI. (It is also how
 * the `filename` column this route once selected — and never had — reached a
 * running server.) The duplication is deliberate and cheap.
 */
const DOCUMENT_COLUMNS =
  "id, restaurant_id, provider_id, doc_type, doc_number, doc_date, " +
  "references_doc_number, currency, subtotal, freight, fuel_surcharge, " +
  "split_case_fee, delivery_fee, deposit_total, tax, other_charges, " +
  "discount_total, total, extraction_confidence, extraction_model, direction, " +
  "jurisdiction, source_channel, notes, extracted, printed";

const LINE_COLUMNS =
  "line_no, vendor_sku, description, vintage, format_ml, qty, uom, pack_size, " +
  "qty_bottles, free_goods_qty, unit_price, line_total, allowance, deposit, " +
  "order_line_id, match_method, match_confidence, price_base_qty, " +
  "price_base_uom, printed";

/** The sentence a schema-lagged read carries out to the screen. */
const SCHEMA_LAG_NOTE =
  "This database has not applied migration 20260904120000, so it has no " +
  "price_base_qty / price_base_uom / printed columns. BT-149, BT-150 and every " +
  '"as printed" literal are therefore ABSENT BECAUSE THEY WERE NEVER STORED — ' +
  "not because the document printed none.";

@Injectable()
export class CanonicalDocumentService {
  private readonly logger = new Logger(CanonicalDocumentService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Build the canonical object for one stored document.
   *
   * Scoped by `restaurantId` as well as id: the gateway holds the service role,
   * so tenant isolation on a read is this filter and nothing else.
   */
  async buildFromDocumentId(
    restaurantId: string,
    documentId: string,
  ): Promise<ReadResult<CanonicalDocument>> {
    const notes: string[] = [];
    let docRead: RawRead = (await this.db
      .getClient()
      .from("procurement_documents")
      .select(DOCUMENT_COLUMNS)
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle()) as RawRead;

    if (isUndefinedColumn(docRead.error)) {
      // The migration has not reached this database yet. Retry WITHOUT the new
      // columns and carry the reason out in `notes`. The alternative shapes are
      // both wrong: failing the whole read hides a
      // readable document behind a deployment detail, and retrying silently
      // would make "never stored" and "the paper printed none" the same
      // rendering, which is this repository's absence-as-health fault exactly.
      notes.push(SCHEMA_LAG_NOTE);
      docRead = (await this.db
        .getClient()
        .from("procurement_documents")
        .select(DOCUMENT_COLUMNS_BASE)
        .eq("id", documentId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle()) as RawRead;
    }

    // `data: null` from maybeSingle() means BOTH "no row matched" and "the query
    // failed". Checking `error` first is what keeps those apart.
    if (docRead.error) {
      return {
        ok: false,
        error: `procurement_documents read failed for ${documentId}: ${docRead.error.message}`,
      };
    }
    if (!docRead.data) {
      return {
        ok: false,
        error: `document ${documentId} not found for restaurant ${restaurantId}`,
      };
    }
    const row = docRead.data as unknown as DocumentRow;

    let lineRead: RawRead = (await this.db
      .getClient()
      .from("procurement_document_lines")
      .select(LINE_COLUMNS)
      .eq("document_id", documentId)
      .order("line_no", { ascending: true })) as RawRead;

    if (isUndefinedColumn(lineRead.error)) {
      if (!notes.includes(SCHEMA_LAG_NOTE)) notes.push(SCHEMA_LAG_NOTE);
      lineRead = (await this.db
        .getClient()
        .from("procurement_document_lines")
        .select(LINE_COLUMNS_BASE)
        .eq("document_id", documentId)
        .order("line_no", { ascending: true })) as RawRead;
    }

    if (lineRead.error) {
      // Deliberately NOT "a document with zero lines". A read that failed and a
      // credit memo that genuinely has no lines must not produce the same object.
      return {
        ok: false,
        error: `procurement_document_lines read failed for ${documentId}: ${lineRead.error.message}`,
      };
    }
    const lineRows = (lineRead.data ?? []) as unknown as LineRow[];

    const parsed = this.toParsedDocument(row, lineRows);

    const resolved = await this.resolveLines(restaurantId, lineRows);
    if (!resolved.ok) return resolved;

    const parties = await this.resolveParties(restaurantId, row.provider_id);
    if (!parties.ok) return parties;

    return {
      ok: true,
      ...(notes.length ? { notes } : {}),
      value: canonicalFromParsedDocument(parsed, {
        documentId: row.id,
        restaurantId: row.restaurant_id,
        source: this.sourceForChannel(row.source_channel),
        direction:
          row.direction === "issued_by_us"
            ? "issued_by_us"
            : "issued_by_vendor",
        jurisdiction:
          row.jurisdiction === "TR" ||
          row.jurisdiction === "US-CA" ||
          row.jurisdiction === "unknown"
            ? row.jurisdiction
            : null,
        providerId: row.provider_id,
        // BG-4 / BG-7. The provider row wins over the transcription when one
        // resolved; `parsed.vendorName` (from the `extracted` snapshot) is the
        // fallback and is genuinely `extracted`, so the mapper keeps its glyphs.
        ...(parties.value.sellerName
          ? {
              seller: {
                name: parties.value.sellerName,
                source: "human_entered" as const,
              },
            }
          : {}),
        ...(parties.value.buyerName
          ? {
              buyer: {
                name: parties.value.buyerName,
                source: "human_entered" as const,
              },
            }
          : {}),
        resolvedLines: resolved.value,
      }),
    };
  }

  /**
   * BG-4 and BG-7 from OUR OWN RECORDS, not from the page.
   *
   * `source` is `human_entered` on both, and that is the honest label: a
   * provider row and a restaurant row are things a person created in Mudavym.
   * Calling either `extracted` would put a name the document never printed
   * behind the paper's authority, which is the masquerade ADR 0104 D1 exists to
   * prevent — and `learned_from_vendor` is reserved for values recalled from
   * correction history, which these are not.
   *
   * BT-31 / BT-48 (the VAT identifier — a Turkish VKN) are NOT filled here:
   * `providers` and `restaurants` were both read on 2026-09-05 and NEITHER
   * carries a tax-id column. There is nothing to read, so the field stays null
   * and the sheet shows the em dash rather than a blank that reads as zero.
   *
   * A FAILED READ IS NOT AN ABSENT NAME. Both reads return `{ok:false}` on
   * error rather than a null name, because "we could not read the provider" and
   * "this document names no seller" are different sentences and the second one
   * sends a bookkeeper looking for a vendor that is on file.
   */
  private async resolveParties(
    restaurantId: string,
    providerId: string | null,
  ): Promise<
    ReadResult<{ sellerName: string | null; buyerName: string | null }>
  > {
    let sellerName: string | null = null;
    if (providerId) {
      const provider = await this.db
        .getClient()
        .from("providers")
        .select("id, name, company_name")
        .eq("id", providerId)
        .maybeSingle();
      if (provider.error)
        return {
          ok: false,
          error: `providers read failed for ${providerId}: ${provider.error.message}`,
        };
      const p = provider.data as {
        name: string | null;
        company_name: string | null;
      } | null;
      // The trading name a document prints is the company name where one
      // exists; `name` is our shorthand for the same vendor.
      sellerName = p?.company_name || p?.name || null;
    }

    const restaurant = await this.db
      .getClient()
      .from("restaurants")
      .select("id, name")
      .eq("id", restaurantId)
      .maybeSingle();
    if (restaurant.error)
      return {
        ok: false,
        error: `restaurants read failed for ${restaurantId}: ${restaurant.error.message}`,
      };

    return {
      ok: true,
      value: {
        sellerName,
        buyerName:
          (restaurant.data as { name: string | null } | null)?.name ?? null,
      },
    };
  }

  /**
   * Append the next revision of a document's layer 1.
   *
   * INSERT ONLY. There is no UPDATE anywhere in this class, and the database
   * refuses one anyway (the append-only trigger from
   * 20260903160000_canonical_document_and_delivery.sql). Both halves are
   * deliberate: the trigger is the guarantee, this is the intent, and a test
   * asserts the service never issues an update.
   *
   * The revision number is read-then-written rather than computed in SQL, so a
   * genuine race loses on the UNIQUE (document_id, revision) index and comes
   * back as a 23505 the caller can retry. Losing that race is correct behaviour:
   * two revisions of the same document written at the same instant are two
   * different claims about the same paper, and one of them must be re-based.
   */
  async persistRevision(
    documentId: string,
    canonical: CanonicalDocument,
    source: Source,
    userId?: string | null,
  ): Promise<ReadResult<{ revision: number; id: string }>> {
    const latest = await this.db
      .getClient()
      .from("document_revisions")
      .select("revision")
      .eq("document_id", documentId)
      .order("revision", { ascending: false })
      .limit(1);

    if (latest.error) {
      return {
        ok: false,
        error: `document_revisions read failed for ${documentId}: ${latest.error.message}`,
      };
    }
    const rows = (latest.data ?? []) as { revision: number }[];
    const nextRevision = (rows[0]?.revision ?? 0) + 1;

    const insert = await this.db
      .getClient()
      .from("document_revisions")
      .insert({
        document_id: documentId,
        revision: nextRevision,
        layer1: { ...canonical.layer1, revision: nextRevision },
        source,
        created_by: userId ?? null,
      })
      .select("id, revision")
      .single();

    if (insert.error) {
      return {
        ok: false,
        error: `document_revisions insert failed for ${documentId} revision ${nextRevision}: ${insert.error.message}`,
      };
    }
    // error null AND data null should be impossible through supabase-js's
    // .single(), which raises PGRST116 when no row comes back. Handled anyway:
    // reporting a revision id we never received would be a fabricated success,
    // and a TypeError here would surface as a 500 with no mention of the write.
    if (!insert.data) {
      return {
        ok: false,
        error: `document_revisions insert for ${documentId} revision ${nextRevision} returned no row and no error`,
      };
    }
    return {
      ok: true,
      value: {
        id: (insert.data as { id: string }).id,
        revision: (insert.data as { revision: number }).revision,
      },
    };
  }

  /**
   * Layer 2 from the match tables: an inventory item and a master wine for every
   * document line the matcher already paired to an order line.
   *
   * Unmatched lines get NULLs, which is the honest answer — the matcher's own
   * rule is that a WRONG LINK IS WORSE THAN NO LINK.
   */
  private async resolveLines(
    restaurantId: string,
    lineRows: LineRow[],
  ): Promise<ReadResult<ResolvedLine[]>> {
    const orderLineIds = Array.from(
      new Set(
        lineRows
          .map((l) => l.order_line_id)
          .filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
      ),
    );

    const byOrderLine = new Map<
      string,
      { inventory_id: string | null; master_wine_id: string | null }
    >();

    if (orderLineIds.length > 0) {
      const itemRead = await this.db
        .getClient()
        .from("procurement_order_items")
        .select("id, inventory_id, master_wine_id")
        .in("id", orderLineIds);

      if (itemRead.error) {
        return {
          ok: false,
          error: `procurement_order_items read failed for restaurant ${restaurantId}: ${itemRead.error.message}`,
        };
      }
      for (const item of (itemRead.data ?? []) as {
        id: string;
        inventory_id: string | null;
        master_wine_id: string | null;
      }[]) {
        byOrderLine.set(item.id, {
          inventory_id: item.inventory_id ?? null,
          master_wine_id: item.master_wine_id ?? null,
        });
      }
    }

    return {
      ok: true,
      value: lineRows.map((l, i): ResolvedLine => {
        const linked = l.order_line_id
          ? (byOrderLine.get(l.order_line_id) ?? null)
          : null;
        const canonicalUom: Uom | null = normalizeUom(l.uom);
        return {
          lineIndex: i,
          inventoryId: linked?.inventory_id ?? null,
          masterWineId: linked?.master_wine_id ?? null,
          canonicalUom,
          packSize: l.pack_size ?? null,
          qtyBottles: n(l.qty_bottles),
          matchMethod: l.match_method ?? null,
          matchConfidence: n(l.match_confidence),
          vintage: l.vintage ?? null,
          lot: null,
        };
      }),
    };
  }

  /**
   * How the document reached us maps to where its values came from.
   *
   * EDI and SFTP carry structured, authoritative content, so `edi` is truthful
   * there. Everything else is `extracted` — the pessimistic answer, because a
   * value claimed as more authoritative than it is cannot be un-claimed later.
   */
  private sourceForChannel(channel: string | null): Source {
    return channel === "edi" || channel === "sftp" ? "edi" : "extracted";
  }

  /**
   * The stored rows, as the parser would have produced them.
   *
   * ONE MAPPING, SHARED WITH THE CORPUS RUNNER. `parsedFromDocumentRows` is the
   * same function `canonical/cli.ts` calls, so a document cannot read one way
   * on the page and another way in `scripts/canonical_corpus_run.py`. Before
   * they were shared, the runner named `vat_breakdown_present` as failing on a
   * document whose page rendered the VAT row, and read a `deposit` line as
   * `goods` — measured 2026-09-05.
   */
  private toParsedDocument(
    row: DocumentRow,
    lineRows: LineRow[],
  ): ParsedDocument {
    return parsedFromDocumentRows(
      row as unknown as Record<string, unknown>,
      lineRows as unknown as Record<string, unknown>[],
    );
  }
}
