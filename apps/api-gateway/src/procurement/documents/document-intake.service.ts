import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createHash } from "crypto";
import { DatabaseService } from "../../database/database.service";
import { DocumentExtractorService } from "./document-extractor.service";
import { SourceChannel } from "./document-types";
import { applyTieOut, ParsedDocument } from "./parsed-document";
import { matchLines, MatchLinesResult } from "./line-matcher";
import { looksLikeX12, parseX12 } from "./x12";
import { runWithNewCorrelationId } from "../../common/model-client/correlation";

/**
 * DocumentIntakeService — the single door every vendor document comes through.
 *
 * Four channels feed it (email attachment, photo at the door, web upload, EDI /
 * SFTP drop) and they converge here into one `procurement_documents` row before
 * anything else in procurement sees them. Keeping the convergence this early is
 * the point: the four-way match, line matching and the credit ledger must be
 * unable to tell how a document arrived, because the moment a verdict depends on
 * the channel, "we photographed it" and "they sent it electronically" start
 * producing different answers about the same delivery — and the restaurant loses
 * that argument with its distributor.
 *
 * NOTHING HERE WRITES STOCK, COST OR ORDERS. Intake produces a document and its
 * lines, at status `received` or `needs_review`. Applying it to a delivery is a
 * separate, human-initiated step. The feature this replaces (InvoiceScannerModal,
 * 487 lines pointed at a 404) was built the other way round: it would have posted
 * whatever a model read off a photograph straight into inventory, bypassing the
 * match engine entirely.
 *
 * IDEMPOTENT BY CONTENT. Documents are keyed on sha256 per restaurant, so every
 * channel can retry freely without coordinating, and the same invoice arriving
 * by email, by photograph and as an 810 is one row rather than three. Content
 * addressing rather than doc_number, because a photographed packing slip often
 * carries no number and two distributors happily reuse each other's numbering.
 */

export interface IntakeInput {
  restaurantId: string;
  providerId?: string | null;
  orderId?: string | null;
  source: SourceChannel;
  /** Raw bytes. Either this or `text` must be given. */
  buffer?: Buffer | null;
  /** Already-decoded text, for EDI arriving as a string. */
  text?: string | null;
  filename?: string | null;
  mimeType?: string | null;
  /** Where this came from — attachment id, message id, upload id. */
  sourceRef?: string | null;
  /** Object path in the vendor-attachments bucket, when already stored. */
  storagePath?: string | null;
}

export interface IntakeResult {
  documentId: string | null;
  parsed: ParsedDocument | null;
  /** True when this exact content was already ingested. */
  duplicate: boolean;
  error?: string;
}

@Injectable()
export class DocumentIntakeService {
  private readonly logger = new Logger(DocumentIntakeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly extractor: DocumentExtractorService,
  ) {}

  /**
   * Ingest one document. Never throws — intake sits behind an email webhook and
   * a receiving screen, and a document it cannot read must not take down the
   * path that delivered it. Failures come back in `error` and are recorded on
   * the row so a human can see the thing exists and needs attention, rather than
   * it vanishing.
   */
  async ingest(input: IntakeInput): Promise<IntakeResult> {
    try {
      const bytes =
        input.buffer ??
        (input.text != null ? Buffer.from(input.text, "utf8") : null);
      if (!bytes?.length)
        return {
          documentId: null,
          parsed: null,
          duplicate: false,
          error: "empty document",
        };

      const sha256 = createHash("sha256").update(bytes).digest("hex");

      const existing = await this.db
        .getClient()
        .from("procurement_documents")
        .select("id")
        .eq("restaurant_id", input.restaurantId)
        .eq("sha256", sha256)
        .maybeSingle();
      if (existing.data?.id)
        return { documentId: existing.data.id, parsed: null, duplicate: true };

      // Decision E47 — the photo and upload channels arrive as a `buffer`
      // with no `storagePath` of their own (the email channel already has
      // one, set when rabbitmq-bridge persisted the attachment). Without
      // this, storage_path lands NULL and the receipts page has nothing to
      // show beside the extracted lines, and a disputed credit has no
      // photograph to point a distributor at.
      const storagePath = await this.persistOriginalBytes(input, sha256, bytes);
      const resolvedInput: IntakeInput = { ...input, storagePath };

      const parsed = await this.route(input, bytes);
      const documentId = await this.persist(
        resolvedInput,
        sha256,
        bytes,
        parsed,
      );
      return { documentId, parsed, duplicate: false };
    } catch (err: any) {
      this.logger.warn(`ingest failed: ${err?.message}`);
      return {
        documentId: null,
        parsed: null,
        duplicate: false,
        error: err?.message ?? "unknown error",
      };
    }
  }

  /**
   * Persist the original bytes to the private `vendor-attachments` bucket so
   * a photographed or hand-uploaded document has an image to show beside its
   * extracted lines, same as the email channel already gets from
   * rabbitmq-bridge. Content-addressed at
   * `{restaurantId}/documents/{sha256}/{filename}` — the same bytes ingested
   * twice (retry, or the same invoice arriving by two channels) land at the
   * same path, so this is a plain `upsert`, never a growing pile of
   * duplicates.
   *
   * Best-effort: a storage failure must not fail the whole ingest, since the
   * extraction and the four-way match evidence do not depend on the photo
   * existing — only the receipts page's side-by-side view does. Skipped
   * entirely when the caller already resolved a storagePath (email channel)
   * or when there are no original bytes to store (EDI/SFTP text, which keeps
   * its full content in `raw_payload` instead).
   */
  private async persistOriginalBytes(
    input: IntakeInput,
    sha256: string,
    bytes: Buffer,
  ): Promise<string | null> {
    if (input.storagePath) return input.storagePath;
    if (!input.buffer?.length) return null;

    const safeName = (input.filename || "document")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 120);
    const path = `${input.restaurantId}/documents/${sha256}/${safeName}`;

    try {
      const { error } = await this.db
        .getClient()
        .storage.from("vendor-attachments")
        .upload(path, bytes, {
          contentType: input.mimeType || "application/octet-stream",
          upsert: true,
        });
      if (error) {
        this.logger.warn(
          `persistOriginalBytes: upload failed for ${safeName} — ${error.message}`,
        );
        return null;
      }
      return path;
    } catch (err: any) {
      this.logger.warn(
        `persistOriginalBytes: unexpected failure for ${safeName} — ${err?.message}`,
      );
      return null;
    }
  }

  /**
   * Decide which parser reads this document.
   *
   * The X12 sniff is deliberately strict (a segment tag at the start, not merely
   * the letters "ISA" somewhere). A PDF coerced through the EDI parser comes back
   * as a document with no lines and no total, which reads downstream as a vendor
   * who billed nothing rather than as a routing mistake.
   */
  private async route(
    input: IntakeInput,
    bytes: Buffer,
  ): Promise<ParsedDocument> {
    const mime = (input.mimeType || "").toLowerCase();
    const name = (input.filename || "").toLowerCase();
    const isEdiName = /\.(edi|x12|810|856|812|txt|dat)$/.test(name);

    if (mime.startsWith("text/") || isEdiName || input.text != null) {
      const text = bytes.toString("utf8");
      if (looksLikeX12(text)) {
        const result = parseX12(text);
        if (result.documents.length) return result.documents[0];
        // Recognised as EDI but produced nothing usable — a 997 or an
        // unsupported set. Say so rather than silently returning an empty invoice.
        return this.unreadable(
          result.skipped.length
            ? `EDI file contained only ${result.skipped.map((s) => s.setType).join(", ")}, which carry nothing the match consumes.`
            : "EDI file produced no readable transaction sets.",
        );
      }
    }

    if (!this.extractor.available())
      return this.unreadable(
        "No extraction model is configured, so the document was stored unread.",
      );

    return this.extractor.extract(
      bytes.toString("base64"),
      input.mimeType,
      input.restaurantId,
    );
  }

  private unreadable(reason: string): ParsedDocument {
    return {
      docType: "unknown",
      docNumber: null,
      docDate: null,
      referencesDocNumber: null,
      poNumber: null,
      vendorName: null,
      vendorAccount: null,
      currency: "USD",
      subtotal: null,
      freight: null,
      fuelSurcharge: null,
      splitCaseFee: null,
      deliveryFee: null,
      depositTotal: null,
      tax: null,
      otherCharges: null,
      discountTotal: null,
      total: null,
      lines: [],
      computedLinesTotal: null,
      tieOutDelta: null,
      tiesOut: null,
      confidence: 0,
      warnings: [reason],
    };
  }

  /**
   * Write the document and its lines.
   *
   * Status is `needs_review` whenever the document did not tie out, came back
   * unknown, or carries warnings — anything a person should look at before it is
   * used to argue with a distributor. `verified` is never set here; only a human
   * sets that.
   */
  private async persist(
    input: IntakeInput,
    sha256: string,
    bytes: Buffer,
    parsed: ParsedDocument,
  ): Promise<string | null> {
    const needsReview =
      parsed.docType === "unknown" ||
      parsed.tiesOut === false ||
      parsed.warnings.length > 0 ||
      parsed.lines.length === 0;

    const { data, error } = await this.db
      .getClient()
      .from("procurement_documents")
      .insert({
        restaurant_id: input.restaurantId,
        provider_id: input.providerId ?? null,
        doc_type: parsed.docType,
        source_channel: input.source,
        doc_number: parsed.docNumber,
        doc_date: parsed.docDate,
        references_doc_number: parsed.referencesDocNumber,
        storage_path: input.storagePath ?? null,
        content_type: input.mimeType ?? null,
        file_bytes: bytes.length,
        // Only EDI keeps its raw payload — it is small, textual and the
        // authoritative record. A PDF's bytes live in object storage; putting
        // them in a jsonb-adjacent column would bloat every row read.
        raw_payload:
          input.source === "edi" || input.source === "sftp"
            ? bytes.toString("utf8").slice(0, 500_000)
            : null,
        extracted: parsed as unknown as Record<string, unknown>,
        extraction_confidence: parsed.confidence,
        currency: parsed.currency,
        subtotal: parsed.subtotal,
        freight: parsed.freight,
        fuel_surcharge: parsed.fuelSurcharge,
        split_case_fee: parsed.splitCaseFee,
        delivery_fee: parsed.deliveryFee,
        deposit_total: parsed.depositTotal,
        tax: parsed.tax,
        other_charges: parsed.otherCharges,
        discount_total: parsed.discountTotal,
        total: parsed.total,
        computed_lines_total: parsed.computedLinesTotal,
        tie_out_delta: parsed.tieOutDelta,
        ties_out: parsed.tiesOut,
        status: needsReview ? "needs_review" : "received",
        source_ref: input.sourceRef ?? null,
        sha256,
        notes: parsed.warnings.length ? parsed.warnings.join("\n") : null,
      })
      .select("id")
      .single();

    if (error) {
      // A unique violation means another path won the race on the same bytes.
      // That is the dedupe working, not a failure.
      if (error.code === "23505") {
        const dup = await this.db
          .getClient()
          .from("procurement_documents")
          .select("id")
          .eq("restaurant_id", input.restaurantId)
          .eq("sha256", sha256)
          .maybeSingle();
        return dup.data?.id ?? null;
      }
      throw new Error(error.message);
    }

    const documentId = data.id as string;

    if (parsed.lines.length) {
      const { error: lineErr } = await this.db
        .getClient()
        .from("procurement_document_lines")
        .insert(
          parsed.lines.map((l) => ({
            document_id: documentId,
            restaurant_id: input.restaurantId,
            line_no: l.lineNo,
            vendor_sku: l.vendorSku,
            description: l.description,
            vintage: l.vintage,
            format_ml: l.formatMl,
            qty: l.qty,
            uom: l.uom,
            pack_size: l.packSize,
            qty_bottles: l.qtyBottles,
            free_goods_qty: l.freeGoodsQty,
            unit_price: l.unitPrice,
            line_total: l.lineTotal,
            allowance: l.allowance,
            deposit: l.deposit,
            // order_line_id is left NULL on purpose. Matching lines to a PO is a
            // separate, ranked step, and a low-confidence guess written here
            // silently corrupts cost basis for months before anyone notices.
            order_line_id: null,
          })),
        );
      if (lineErr)
        this.logger.warn(
          `document ${documentId} stored but its lines failed: ${lineErr.message}`,
        );
    }

    if (input.orderId)
      await this.link(
        documentId,
        input.orderId,
        input.restaurantId,
        "manual",
        1,
      );
    else await this.autoLink(documentId, input.restaurantId, parsed);

    // Pair lines against what was ordered. Only unambiguous matches are written;
    // everything else waits for a person. Best-effort — a document is still
    // useful unmatched, and failing intake over line pairing would lose it.
    try {
      await this.matchDocumentLines(documentId, input.restaurantId);
    } catch (err: any) {
      this.logger.warn(
        `line matching failed for document ${documentId}: ${err?.message}`,
      );
    }

    return documentId;
  }

  /**
   * Pair a document's lines with the lines that were ordered.
   *
   * Writes `order_line_id` ONLY above the auto threshold — an exact vendor SKU
   * with no substitution. Everything else comes back as a suggestion for one-tap
   * confirmation and is deliberately not persisted: a wrong link writes one
   * wine's invoice price onto another wine's cost lot, nothing looks broken, and
   * it surfaces months later as unexplained margin drift on two products at once.
   *
   * Re-runnable, and a line a human already paired is left alone — so someone who
   * fixes a mis-paired line and re-runs does not get their correction reverted.
   */
  async matchDocumentLines(
    documentId: string,
    restaurantId: string,
  ): Promise<MatchLinesResult> {
    const empty: MatchLinesResult = {
      applied: [],
      suggested: [],
      unmatchedDocumentLineIds: [],
      unmatchedOrderLineIds: [],
    };

    const [{ data: docLines }, { data: links }] = await Promise.all([
      this.db
        .getClient()
        .from("procurement_document_lines")
        .select(
          "id, vendor_sku, description, vintage, format_ml, qty_bottles, unit_price, order_line_id",
        )
        .eq("document_id", documentId)
        .eq("restaurant_id", restaurantId),
      this.db
        .getClient()
        .from("procurement_document_links")
        .select("order_id")
        .eq("document_id", documentId)
        .eq("restaurant_id", restaurantId),
    ]);

    const orderIds = (links ?? []).map((l) => l.order_id);
    if (!docLines?.length || !orderIds.length) return empty;

    const { data: orderLines } = await this.db
      .getClient()
      .from("procurement_order_items")
      .select(
        "id, vendor_sku, wine_name, vintage, total_bottles, final_unit_price",
      )
      .eq("restaurant_id", restaurantId)
      .in("order_id", orderIds);
    if (!orderLines?.length) return empty;

    const openDocLines = docLines.filter((l) => !l.order_line_id);
    const takenOrderLines = new Set(
      docLines.map((l) => l.order_line_id).filter(Boolean) as string[],
    );

    const result = matchLines(
      openDocLines.map((l) => ({
        id: l.id,
        vendorSku: l.vendor_sku,
        description: l.description,
        vintage: l.vintage,
        formatMl: l.format_ml,
        qtyBottles: Number(l.qty_bottles ?? 0),
        unitPrice: l.unit_price == null ? null : Number(l.unit_price),
      })),
      orderLines
        .filter((o) => !takenOrderLines.has(o.id))
        .map((o) => ({
          id: o.id,
          vendorSku: o.vendor_sku,
          description: o.wine_name,
          vintage: o.vintage,
          formatMl: null,
          qtyBottles: Number(o.total_bottles ?? 0),
          unitPrice:
            o.final_unit_price == null ? null : Number(o.final_unit_price),
        })),
    );

    for (const m of result.applied) {
      const { error } = await this.db
        .getClient()
        .from("procurement_document_lines")
        .update({
          order_line_id: m.orderLineId,
          match_confidence: m.confidence,
          match_method: m.method,
        })
        .eq("id", m.documentLineId)
        .eq("restaurant_id", restaurantId);
      if (error)
        this.logger.warn(
          `failed to link document line ${m.documentLineId}: ${error.message}`,
        );
    }

    if (result.applied.length || result.suggested.length)
      this.logger.log(
        `document ${documentId}: ${result.applied.length} lines paired, ${result.suggested.length} awaiting confirmation`,
      );

    return result;
  }

  /**
   * Attach a document to the order it belongs to.
   *
   * Deliberately many-to-many: one distributor invoice routinely covers several
   * POs, and one PO can be filled across two trucks with two packing slips.
   */
  private async link(
    documentId: string,
    orderId: string,
    restaurantId: string,
    method: string,
    confidence: number,
  ): Promise<void> {
    const { error } = await this.db
      .getClient()
      .from("procurement_document_links")
      .insert({
        document_id: documentId,
        order_id: orderId,
        restaurant_id: restaurantId,
        link_method: method,
        confidence,
      });
    // Duplicate link = already attached. Not an error.
    if (error && error.code !== "23505")
      this.logger.warn(`link failed for ${documentId}: ${error.message}`);
  }

  /**
   * Link by the PO number the document itself cites.
   *
   * Only an exact order_number match links automatically. A fuzzy guess here
   * attaches an invoice to the wrong delivery, which then produces a confident,
   * wrong discrepancy — and a restaurant that takes a wrong claim to its
   * distributor loses credibility it does not get back.
   */
  private async autoLink(
    documentId: string,
    restaurantId: string,
    parsed: ParsedDocument,
  ): Promise<void> {
    const poNumber =
      parsed.poNumber ?? parsed.lines.find((l) => l.poNumber)?.poNumber ?? null;
    if (!poNumber) return;

    const { data } = await this.db
      .getClient()
      .from("procurement_orders")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("order_number", poNumber)
      .maybeSingle();

    if (data?.id)
      await this.link(documentId, data.id, restaurantId, "po_number", 0.95);
  }

  /**
   * Turn vendor email attachments into documents.
   *
   * This is the email channel, and it is a sweep rather than a call from the
   * inbound webhook on purpose. ProcurementModule already imports
   * OrchestratorModule, so hooking the bridge directly would need a circular
   * forwardRef — which in Nest fails by injecting `undefined` at runtime rather
   * than at build time, and the symptom would be invoices silently not being
   * ingested. A five-minute sweep costs one indexed lookup per recent
   * attachment and cannot break the mail path it feeds from.
   *
   * The latency is immaterial for this channel: a distributor's invoice arrives
   * hours after the delivery it bills, and the low-latency path is the receiver
   * photographing the paper at the door. It also backfills attachments that
   * landed before document intake existed.
   *
   * Safe to run repeatedly — intake is content-addressed, so a second attempt on
   * the same bytes is a no-op.
   */
  @Cron("*/5 * * * *", { name: "procurement-document-intake-sweep" })
  async sweepUningestedAttachments(limit = 25): Promise<number> {
    const { data: attachments, error } = await this.db
      .getClient()
      .from("conversation_attachments")
      .select(
        "id, restaurant_id, provider_id, order_id, filename, mime_type, storage_path, sha256",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      this.logger.warn(`document backfill sweep failed: ${error.message}`);
      return 0;
    }

    let ingested = 0;
    for (const a of attachments ?? []) {
      if (ingested >= limit) break;
      if (!a.restaurant_id || !a.storage_path) continue;
      if (!isDocumentLike(a.mime_type, a.filename)) continue;

      // Cheap pre-check on the hash we already have, so the common case costs
      // one indexed lookup rather than a storage download.
      if (a.sha256) {
        const { data: seen } = await this.db
          .getClient()
          .from("procurement_documents")
          .select("id")
          .eq("restaurant_id", a.restaurant_id)
          .eq("sha256", a.sha256)
          .maybeSingle();
        if (seen?.id) continue;
      }

      const file = await this.db
        .getClient()
        .storage.from("vendor-attachments")
        .download(a.storage_path);
      if (file.error || !file.data) continue;

      const buffer = Buffer.from(await file.data.arrayBuffer());
      // One correlation scope PER ATTACHMENT. `ingest` reaches
      // DocumentExtractorService -> ModelClientService, and a cron has no
      // request to inherit an id from, so without this the NF row for every
      // email-sourced extraction lands with correlation_id NULL — which is
      // most of them, since the HTTP path is manual upload. Per-attachment
      // rather than per-sweep so one id still means one document.
      const result = await runWithNewCorrelationId(() =>
        this.ingest({
          restaurantId: a.restaurant_id,
          providerId: a.provider_id,
          orderId: a.order_id,
          source: "email",
          buffer,
          filename: a.filename,
          mimeType: a.mime_type,
          sourceRef: `conversation_attachment:${a.id}`,
          storagePath: a.storage_path,
        }),
      );
      if (result.documentId && !result.duplicate) ingested++;
    }

    if (ingested)
      this.logger.log(`document backfill ingested ${ingested} attachment(s)`);
    return ingested;
  }

  /**
   * Correct one extracted line by hand (ADR 0045 §5, the receipts brief:
   * "we can edit, and we can just confirm it right away").
   *
   * Guards, in order of importance:
   * - Only a PRE-verification document may be edited (`received` /
   *   `needs_review`). A verified document is the record a vendor dispute
   *   leans on; there is deliberately no un-verify here.
   * - Edits are anonymous drafts: provenance is carried by the verify step,
   *   which stamps who confirmed the FINAL transcription (verified_by).
   * - The document's tie-out is recomputed through the same applyTieOut rule
   *   extraction uses — an edited line must never leave a stale
   *   ties-out/delta claim standing.
   */
  async editLine(
    documentId: string,
    lineId: string,
    restaurantId: string,
    patch: {
      qty?: number;
      unitPrice?: number | null;
      lineTotal?: number | null;
      description?: string | null;
      vintage?: number | null;
      packSize?: number;
      qtyBottles?: number;
      freeGoodsQty?: number;
      allowance?: number | null;
      uom?: string;
      vendorSku?: string | null;
    },
  ): Promise<{
    line: Record<string, unknown>;
    tieOut: { computedLinesTotal: number; tieOutDelta: number | null; tiesOut: boolean | null };
  }> {
    const client = this.db.getClient();

    const { data: doc, error: docErr } = await client
      .from("procurement_documents")
      .select(
        "id, status, total, freight, fuel_surcharge, split_case_fee, delivery_fee, deposit_total, tax, other_charges, discount_total",
      )
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (docErr) throw new Error(docErr.message);
    if (!doc) throw new Error("NOT_FOUND");
    if (doc.status !== "needs_review" && doc.status !== "received")
      throw new Error(
        `NOT_EDITABLE:${doc.status}`,
      );

    // Whitelisted columns only, with finite-number guards. A NaN is REJECTED,
    // never coerced to NULL — "clear this value" is null in the patch, and
    // junk must not masquerade as a deliberate clearing (receipts-audit.md).
    const finite = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v);
    const nullable = (v: number | null, field: string): number | null => {
      if (v === null) return null;
      if (!finite(v)) throw new Error(`BAD_FIELD:${field}`);
      return v;
    };
    const update: Record<string, unknown> = {};
    if (patch.qty !== undefined) {
      if (!finite(patch.qty) || patch.qty < 0) throw new Error("BAD_FIELD:qty");
      update.qty = patch.qty;
    }
    if (patch.unitPrice !== undefined)
      update.unit_price = nullable(patch.unitPrice, "unitPrice");
    if (patch.lineTotal !== undefined)
      update.line_total = nullable(patch.lineTotal, "lineTotal");
    if (patch.description !== undefined) update.description = patch.description;
    if (patch.vintage !== undefined)
      update.vintage = nullable(patch.vintage, "vintage");
    if (patch.packSize !== undefined) {
      if (!finite(patch.packSize) || patch.packSize <= 0)
        throw new Error("BAD_FIELD:packSize");
      update.pack_size = patch.packSize;
    }
    if (patch.qtyBottles !== undefined) {
      if (!finite(patch.qtyBottles) || patch.qtyBottles < 0)
        throw new Error("BAD_FIELD:qtyBottles");
      update.qty_bottles = patch.qtyBottles;
    }
    if (patch.freeGoodsQty !== undefined) {
      if (!finite(patch.freeGoodsQty) || patch.freeGoodsQty < 0)
        throw new Error("BAD_FIELD:freeGoodsQty");
      update.free_goods_qty = patch.freeGoodsQty;
    }
    if (patch.allowance !== undefined)
      update.allowance = nullable(patch.allowance, "allowance");
    if (patch.uom !== undefined) update.uom = patch.uom;
    if (patch.vendorSku !== undefined) update.vendor_sku = patch.vendorSku;
    if (Object.keys(update).length === 0) throw new Error("EMPTY_PATCH");

    // Capture the line as it stands, so a verify that lands mid-edit can be
    // answered by restoring it (the TOCTOU window below).
    const LINE_COLS =
      "id, line_no, qty, uom, pack_size, qty_bottles, free_goods_qty, unit_price, line_total, allowance, description, vintage, vendor_sku, order_line_id";
    const { data: before, error: beforeErr } = await client
      .from("procurement_document_lines")
      .select(LINE_COLS)
      .eq("id", lineId)
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (beforeErr) throw new Error(beforeErr.message);
    if (!before) throw new Error("NOT_FOUND");

    const { data: line, error: lineErr } = await client
      .from("procurement_document_lines")
      .update(update)
      .eq("id", lineId)
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .select(LINE_COLS)
      .maybeSingle();
    if (lineErr) throw new Error(lineErr.message);
    if (!line) throw new Error("NOT_FOUND");

    // The status read above and the update here are two statements: a verify
    // can land between them. Re-check, and if the document got verified while
    // we wrote, restore the captured line (verify never touches lines, so the
    // restore leaves pre-edit lines under a verified document — consistent)
    // and refuse the edit.
    const { data: statusNow } = await client
      .from("procurement_documents")
      .select("status")
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (
      statusNow &&
      statusNow.status !== "needs_review" &&
      statusNow.status !== "received"
    ) {
      const { id: _id, ...restore } = before as Record<string, unknown>;
      await client
        .from("procurement_document_lines")
        .update(restore)
        .eq("id", lineId)
        .eq("document_id", documentId)
        .eq("restaurant_id", restaurantId);
      throw new Error(`NOT_EDITABLE:${statusNow.status}`);
    }

    // Recompute the tie-out over ALL lines with the one rule extraction uses.
    const { data: allLines, error: allErr } = await client
      .from("procurement_document_lines")
      .select("qty, unit_price, line_total, allowance")
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId);
    if (allErr) throw new Error(allErr.message);

    const recomputed = applyTieOut({
      total: doc.total,
      freight: doc.freight,
      fuelSurcharge: doc.fuel_surcharge,
      splitCaseFee: doc.split_case_fee,
      deliveryFee: doc.delivery_fee,
      depositTotal: doc.deposit_total,
      tax: doc.tax,
      otherCharges: doc.other_charges,
      discountTotal: doc.discount_total,
      lines: (allLines ?? []).map((l) => ({
        qty: l.qty,
        unitPrice: l.unit_price,
        lineTotal: l.line_total,
        allowance: l.allowance,
      })),
      // applyTieOut spreads doc.warnings on the does-not-tie-out branch —
      // omitting it threw the moment an edit BROKE the tie-out, after the
      // line had already committed (receipts-audit.md, BLOCKER 1). The cast
      // keeps the tie-out rule single-sourced; warnings must ride along.
      warnings: [],
    } as unknown as ParsedDocument);

    const { error: tieErr } = await client
      .from("procurement_documents")
      .update({
        computed_lines_total: recomputed.computedLinesTotal,
        tie_out_delta: recomputed.tieOutDelta,
        ties_out: recomputed.tiesOut,
      })
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId);
    if (tieErr) throw new Error(tieErr.message);

    return {
      line,
      tieOut: {
        computedLinesTotal: recomputed.computedLinesTotal ?? 0,
        tieOutDelta: recomputed.tieOutDelta,
        tiesOut: recomputed.tiesOut,
      },
    };
  }
}

/**
 * Is this attachment plausibly a vendor document?
 *
 * Vendor email carries logos, signature images and marketing PDFs. Running every
 * one through a vision model costs money per message and fills the review queue
 * with noise that trains people to ignore it. Cheap filters first.
 */
export function isDocumentLike(
  mimeType?: string | null,
  filename?: string | null,
): boolean {
  const m = (mimeType || "").toLowerCase();
  const n = (filename || "").toLowerCase();
  if (/logo|signature|banner|icon|footer|header/.test(n)) return false;
  if (m === "application/pdf" || n.endsWith(".pdf")) return true;
  if (/\.(edi|x12|810|856|812)$/.test(n)) return true;
  if (m.startsWith("image/")) return true;
  if (m.startsWith("text/") && /invoice|packing|credit|statement/.test(n))
    return true;
  return false;
}
