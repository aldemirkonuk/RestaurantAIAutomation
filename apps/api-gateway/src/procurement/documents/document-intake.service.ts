import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { createHash } from "crypto";
import { DatabaseService } from "../../database/database.service";
import {
  DocumentExtractorService,
  stripJsonFence,
} from "./document-extractor.service";
import { normalizeUom, SourceChannel, toBottles } from "./document-types";
import {
  applyCurrencyRules,
  refiledMoney,
  refilingSentence,
  type DocumentMoney,
} from "./invoice-currency";
import { applyTieOut, ParsedDocument, ParsedLine } from "./parsed-document";
import { LineMatch, matchLines, MatchLinesResult } from "./line-matcher";
import { looksLikeX12, parseX12 } from "./x12";
// A pure reader, no Nest dependency and no network: the 832 the document door
// stores and the 832 `distributor-feed` prices are read by ONE parser, so a
// catalogue cannot be classified one way here and another way there.
import {
  looksLikeEdi832,
  readEdi832Header,
} from "../../distributor-feed/parse-edi832";
import { runWithNewCorrelationId } from "../../common/model-client/correlation";
import {
  CanonicalDocumentService,
  ReadResult,
} from "../canonical/canonical-document.service";

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
  /**
   * The original bytes arrived and could NOT be stored (ADR 0067).
   *
   * Distinct from `error`, which means the document itself did not land. This
   * one says: the document is on the record and readable, and the file beside
   * it is missing because a write failed — never because none was sent. Absent
   * when the upload succeeded or when the channel carried no bytes to store.
   */
  storageError?: string;
}

/** What the extraction door reports back beyond the document itself. */
export interface ExternalExtractionResult {
  warnings: string[];
  tieOut: {
    computedLinesTotal: number | null;
    tieOutDelta: number | null;
    tiesOut: boolean | null;
  };
  /**
   * The append-only revision this apply wrote (ADR 0104 D5), or the reason it
   * could not be written. NEVER omitted on failure: a document whose lines
   * landed and whose revision did not is a different thing from one where both
   * did, and collapsing them is this repository's absence-as-health fault.
   */
  revision: ReadResult<{ revision: number; id: string }>;
}

@Injectable()
export class DocumentIntakeService {
  private readonly logger = new Logger(DocumentIntakeService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly extractor: DocumentExtractorService,
    private readonly canonical: CanonicalDocumentService,
  ) {}

  /**
   * A DOOR COUNT — a document we AUTHOR, not one we read (ADR 0104 D2/D11, S6).
   *
   * Every other path through this service reads a document somebody else wrote
   * and records how confident it is about what it read. This one records what a
   * person standing at the door SAYS they counted. Nothing is extracted, so:
   *
   *   * `extraction_confidence` and `extraction_model` are **NULL, not 0**. A
   *     zero would be a confidence somebody computed; NULL is "nothing read
   *     this, so there is no such number".
   *   * `direction = issued_by_us` (S6). A receiving advice is ours. Reading it
   *     as a vendor document would put our own count behind the vendor's
   *     authority in every comparison the delivery makes.
   *   * `doc_number` stays NULL. Nobody printed a number on it, and the partial
   *     unique index on (restaurant, provider, type, number) would otherwise
   *     make a second count of the same vendor a duplicate-key error.
   *   * `status = 'received'`, never `verified`. A count one person typed has
   *     not been checked by anyone else, and `verified` is the word this
   *     product uses for a human standing behind a document.
   *
   * A LINE NOBODY COUNTED IS ABSENT, NOT ZERO (ADR 0103 A6). The door screen
   * submits only the lines somebody actually counted; a line missing from this
   * document keeps the canonical `received: "not_counted"` it already has. That
   * is why there is no `notCounted` flag here and why a body with zero lines is
   * refused — an empty count is not a count, and a truck that arrived empty is a
   * rejection, which is a different door.
   *
   * THE SIGNATURE IS EVIDENCE, AND IT GATES AGREEMENT. `signedBy` is stored in
   * the `extracted` snapshot because ADR 0103 D3's second route to `AGREED` is
   * "a door signature where a per-vendor setting says the signed delivery ticket
   * is final". `DeliveryService.agree` reads it from there, and a count with no
   * signature simply cannot reach that rule.
   */
  async recordDoorCount(input: {
    restaurantId: string;
    providerId?: string | null;
    countedBy: string | null;
    countedAt?: string | null;
    lines: {
      lineNo: number;
      description?: string | null;
      vendorSku?: string | null;
      qty: number;
      uom: string;
      packSize?: number | null;
      vintage?: number | null;
      formatMl?: number | null;
    }[];
    /** Who signed the vendor's ticket at the door, when anyone did. */
    signedBy?: string | null;
    note?: string | null;
    /** One photograph of the goods, as evidence. */
    photo?: {
      bytes: Buffer;
      filename?: string | null;
      mimeType?: string | null;
    } | null;
  }): Promise<IntakeResult> {
    if (!input.lines.length)
      return {
        documentId: null,
        parsed: null,
        duplicate: false,
        error:
          "A door count with no lines is not a count. Submit the lines somebody counted; a line nobody counted is simply absent and stays 'not counted'.",
      };

    const countedAt = input.countedAt ?? new Date().toISOString();
    const lines: ParsedLine[] = input.lines.map((l) => {
      const uom = (normalizeUom(l.uom) ?? "bottle") as ParsedLine["uom"];
      const packSize = l.packSize && l.packSize >= 1 ? l.packSize : 1;
      return {
        lineNo: l.lineNo,
        vendorSku: l.vendorSku ?? null,
        description: l.description ?? null,
        vintage: l.vintage ?? null,
        formatMl: l.formatMl ?? null,
        qty: l.qty,
        uom,
        packSize,
        qtyBottles: toBottles(l.qty, uom, packSize),
        freeGoodsQty: 0,
        // NO MONEY AT THE DOOR (D11). Not zero — absent. A price of 0.00 on a
        // receiving advice is a claim that the goods were free.
        unitPrice: null,
        lineTotal: null,
        allowance: null,
        deposit: null,
        priceBaseQty: null,
        priceBaseUom: null,
      };
    });

    const parsed: ParsedDocument = applyTieOut({
      docType: "receiving_advice",
      docNumber: null,
      docDate: countedAt.slice(0, 10),
      deliveredDate: countedAt.slice(0, 10),
      referencesDocNumber: null,
      poNumber: null,
      vendorName: null,
      vendorAccount: null,
      // A door count carries no money, so it carries no currency either.
      currency: null,
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
      lines,
      computedLinesTotal: null,
      tieOutDelta: null,
      tiesOut: null,
      confidence: 0,
      warnings: [],
      extractionModel: null,
    } as unknown as ParsedDocument);

    /**
     * Content-addressed, INCLUDING the moment it was stated.
     *
     * A re-count an hour later is a different document even when every number
     * is the same — the fact being recorded is "this is what we counted at
     * 09:41", and hashing only the numbers would make the second count
     * disappear as a duplicate of the first.
     */
    const sha256 = createHash("sha256")
      .update(
        JSON.stringify({
          restaurantId: input.restaurantId,
          providerId: input.providerId ?? null,
          countedAt,
          lines: input.lines,
        }),
      )
      .digest("hex");

    let storagePath: string | null = null;
    let storageError: string | undefined;
    if (input.photo?.bytes?.length) {
      const stored = await this.persistOriginalBytes(
        {
          restaurantId: input.restaurantId,
          source: "manual",
          buffer: input.photo.bytes,
          filename: input.photo.filename ?? "door-count.png",
          mimeType: input.photo.mimeType ?? null,
        },
        sha256,
        input.photo.bytes,
      );
      storagePath = stored.path;
      if (stored.failure) storageError = stored.failure;
    }

    const snapshot = {
      ...(parsed as unknown as Record<string, unknown>),
      countedAt,
      countedBy: input.countedBy,
      note: input.note ?? null,
      // ADR 0103 D3's second route to AGREED reads this. Absent means nobody
      // signed, which is a fact about the door, not a missing field.
      signature: input.signedBy
        ? { signedBy: input.signedBy, signedAt: countedAt }
        : null,
    };

    // Inline literals, never a spread: `check_order_capture_contract.py` can
    // only read a write whose column names are literal.
    const { data, error } = await this.db
      .getClient()
      .from("procurement_documents")
      .insert({
        restaurant_id: input.restaurantId,
        provider_id: input.providerId ?? null,
        doc_type: "receiving_advice",
        direction: "issued_by_us",
        source_channel: "manual",
        doc_number: null,
        doc_date: countedAt.slice(0, 10),
        references_doc_number: null,
        storage_path: storagePath,
        content_type: input.photo?.mimeType ?? null,
        file_bytes: input.photo?.bytes?.length ?? null,
        raw_payload: null,
        extracted: snapshot,
        // NULL, NOT 0 — see the header. Nothing read this document.
        extraction_confidence: null,
        extraction_model: null,
        currency: null,
        subtotal: null,
        total: null,
        computed_lines_total: null,
        tie_out_delta: null,
        ties_out: null,
        status: "received",
        source_ref: input.countedBy ? `user:${input.countedBy}` : null,
        sha256,
        notes: input.note ?? null,
      })
      .select("id")
      .single();

    if (error)
      return {
        documentId: null,
        parsed: null,
        duplicate: false,
        error: `the door count could not be recorded: ${error.message}`,
      };
    if (!data)
      return {
        documentId: null,
        parsed: null,
        duplicate: false,
        error:
          "the door count insert returned no row and no error, so it cannot be reported as recorded",
      };

    const documentId = (data as { id: string }).id;
    const lineErr = await this.insertDocumentLines(
      documentId,
      input.restaurantId,
      lines,
      null,
    );
    if (lineErr)
      return {
        documentId,
        parsed,
        duplicate: false,
        // The document row exists; the lines do not. Saying "the count failed"
        // would leave a caller believing nothing was written.
        error: `the door count document ${documentId} was written but its lines were not: ${lineErr.message}`,
      };

    return {
      documentId,
      parsed,
      duplicate: false,
      ...(storageError ? { storageError } : {}),
    };
  }

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
      const stored = await this.persistOriginalBytes(input, sha256, bytes);
      const resolvedInput: IntakeInput = { ...input, storagePath: stored.path };

      const parsed = await this.route(input, bytes);
      // A failed upload travels on the document's own warnings, so it reaches
      // `notes` on the row and the canonical page's read-notes strip. It is
      // NOT folded into `error`: the document itself was read and stored, and
      // failing the ingest would discard a readable document over a photo.
      const parsedWithStorage = stored.failure
        ? { ...parsed, warnings: [...parsed.warnings, stored.failure] }
        : parsed;
      const documentId = await this.persist(
        resolvedInput,
        sha256,
        bytes,
        parsedWithStorage,
      );
      return {
        documentId,
        parsed: parsedWithStorage,
        duplicate: false,
        ...(stored.failure ? { storageError: stored.failure } : {}),
      };
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
   * Best-effort ABOUT THE INGEST, never about the record: a storage failure
   * must not throw away a readable document, since the extraction and the
   * four-way match evidence do not depend on the photo existing — but it must
   * not disappear either. Skipped entirely when the caller already resolved a
   * storagePath (email channel) or when there are no original bytes to store
   * (EDI/SFTP text, which keeps its full content in `raw_payload` instead).
   *
   * A FAILED UPLOAD IS A FAILED WRITE, AND IT SAYS SO (ADR 0067).
   *
   * This used to return NULL on failure, indistinguishable from "this channel
   * had no bytes to store" — so `storage_path` landed null, `GET :id` answered
   * "no original was stored for this document", and nothing anywhere recorded
   * that bytes HAD arrived and the write had broken. That is the
   * absence-as-health shape at its most expensive: the one screen a
   * disputed-credit conversation depends on says the paper never existed.
   *
   * Two rules hold from here on:
   *   1. `path` is returned ONLY when the object is in the bucket. A document
   *      never claims a `storage_path` it does not have.
   *   2. `failure` is a SENTENCE, carried onto the document's own `notes` and
   *      out through the ingest result, so a failed write reads as a failed
   *      write rather than as an absent file.
   */
  private async persistOriginalBytes(
    input: IntakeInput,
    sha256: string,
    bytes: Buffer,
  ): Promise<{ path: string | null; failure: string | null }> {
    if (input.storagePath) return { path: input.storagePath, failure: null };
    if (!input.buffer?.length) return { path: null, failure: null };

    const safeName = (input.filename || "document")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 120);
    const path = `${input.restaurantId}/documents/${sha256}/${safeName}`;

    const failed = (why: string) => {
      const failure =
        `The original bytes could not be stored (${safeName}): ${why}. ` +
        `This document has no file to show beside its lines, and that is a ` +
        `failed write, not a document that arrived without one.`;
      this.logger.warn(`persistOriginalBytes: ${failure}`);
      return { path: null, failure };
    };

    try {
      const { error } = await this.db
        .getClient()
        .storage.from("vendor-attachments")
        .upload(path, bytes, {
          contentType: input.mimeType || "application/octet-stream",
          upsert: true,
        });
      if (error) return failed(error.message);
      return { path, failure: null };
    } catch (err: any) {
      return failed(err?.message ?? "unknown error");
    }
  }

  /**
   * Decide which parser reads this document.
   *
   * The X12 sniff is deliberately strict (a segment tag at the start, not merely
   * the letters "ISA" somewhere). A PDF coerced through the EDI parser comes back
   * as a document with no lines and no total, which reads downstream as a vendor
   * who billed nothing rather than as a routing mistake.
   *
   * THE 832 IS ASKED ABOUT FIRST, AND IT IS NOT AN INVOICE (ADR 0126, batch 56).
   * `looksLikeX12`'s `ST` alternation is `8[015][0-9]|997`, so a bare `ST*832`
   * is not recognised at all, and an 832 inside an ISA envelope reaches
   * `parseX12`'s `default` branch and comes back as "an unsupported set" — a
   * house's real price catalogue stored as an unreadable document. It is a
   * `price_list`, one of the twelve doc types this spine already admits, and it
   * is stored as one. Its PRICES are a separate act with a separate failure
   * mode: they are admitted only under the code meanings a manager of the house
   * has stated (`distributor-feed/catalog-ingest.service.ts`), which is why
   * this method reads the header and stops rather than returning lines.
   */
  private async route(
    input: IntakeInput,
    bytes: Buffer,
  ): Promise<ParsedDocument> {
    const mime = (input.mimeType || "").toLowerCase();
    const name = (input.filename || "").toLowerCase();
    const isEdiName = /\.(edi|x12|810|832|856|812|txt|dat)$/.test(name);

    // What this HOUSE says its money is, read once for whichever parser runs.
    // Founder, 2026-09-06: an 810 with no CUR takes the house's own currency.
    // A read that FAILS is not an absent currency, and `houseCurrency` says
    // which of the two it got (ADR 0067).
    const house = await this.houseCurrency(input.restaurantId);

    if (mime.startsWith("text/") || isEdiName || input.text != null) {
      const text = bytes.toString("utf8");
      if (looksLikeEdi832(text)) return this.priceCatalogue(text);
      if (looksLikeX12(text)) {
        const result = parseX12(text, { houseCurrency: house.code });
        if (result.documents.length)
          return house.failure
            ? {
                ...result.documents[0],
                warnings: [...result.documents[0].warnings, house.failure],
              }
            : result.documents[0];
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

    try {
      const extracted = await this.extractor.extract(
        bytes.toString("base64"),
        input.mimeType,
        input.restaurantId,
      );
      /*
       * Rules 1 and 2, on the model path (founder, 2026-09-06).
       *
       * The SAME function the 810 runs, for the reason `ParsedDocument`'s
       * header gives: a verdict that depends on the channel makes "we
       * photographed it" and "they sent it electronically" produce different
       * answers about one delivery. What differs is only the input — a
       * photographed invoice has a `currencySeen` because a model read the
       * page, and an 810 never does.
       */
      const ruled = applyCurrencyRules({
        doc: extracted,
        houseCurrency: house.code,
        fileField: "printed currency",
      });
      return house.failure
        ? { ...ruled, warnings: [...ruled.warnings, house.failure] }
        : ruled;
    } catch (err: any) {
      /**
       * ADR 0104 D6 — "when extraction runs and FAILS, the template degrades to
       * original + header fields + an explicit NOT EXTRACTED banner".
       *
       * Before this, an extractor that threw took the whole ingest down: the
       * caller got a 422, no `procurement_documents` row was written, and the
       * original bytes — already uploaded a few lines earlier — were left in
       * the bucket with nothing pointing at them. The restaurant had handed us
       * their paper and we kept neither the paper nor the fact that they had.
       *
       * MEASURED, not hypothetical (2026-09-04): three synthetic PDFs pushed at
       * the local gateway came back
       * `422 Anthropic 400: Your credit balance is too low`. A billing problem
       * at the model vendor must not be able to discard a restaurant's invoice.
       *
       * The failure is NAMED on the document (it becomes a warning, so the row
       * lands in `needs_review` with the reason in `notes`) and returned to the
       * uploader in the same response. It is never silently an empty invoice.
       */
      const reason = err?.message ?? "unknown error";
      this.logger.warn(
        `extraction failed, storing the document unread: ${reason}`,
      );
      return this.unreadable(
        `The extraction model could not be reached, so the document was stored unread: ${reason}`,
      );
    }
  }

  /**
   * What currency this HOUSE says it reports in, and whether we could ask.
   *
   * `restaurants.currency` carries no default since
   * `20260905120000_a_house_names_its_money.sql`, so NULL is a real and common
   * state: it means the question has not been answered, and every reader must
   * say "currency not recorded" rather than print a dollar sign.
   *
   * A FAILED READ IS NEVER AN EMPTY ONE (ADR 0067). supabase-js resolves
   * `{ data, error }` and never throws, so a dead connection and a house that
   * has stated nothing arrive here identically unless the error is looked at.
   * They are not the same: the first must not be allowed to REFUSE an invoice's
   * money on the strength of an answer nobody actually got. So a failed read
   * returns `code: null` AND a sentence, and the sentence travels onto the
   * document's warnings — the refusal that follows then says, in the document's
   * own notes, that it may be a failure rather than a fact.
   */
  private async houseCurrency(
    restaurantId: string,
  ): Promise<{ code: string | null; failure: string | null }> {
    const { data, error } = await this.db
      .getClient()
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();

    if (error) {
      const failure =
        `This house's own currency could not be read (${error.message}), so ` +
        `a document that states none had nothing to fall back to. That is a ` +
        `FAILED READ, not a house without a currency — re-upload once the ` +
        `read works, or name the currency on the document.`;
      this.logger.warn(`houseCurrency: ${failure}`);
      return { code: null, failure };
    }

    const code = (data as { currency?: string | null } | null)?.currency ?? null;
    return { code, failure: null };
  }

  /**
   * An EDI 832 price/sales catalogue, as a stored document.
   *
   * IT CARRIES NO LINES ON PURPOSE, and the warning says so. A `price_list`
   * document's lines would be prices, and a price this house may see is one
   * admitted under a code meaning a manager of the house has stated — a
   * judgement `procurement_document_lines` has no column for and this parser
   * has no standing to make. So the document records what the catalogue says
   * about ITSELF (its number, its version, its sender, its currency, its
   * effective date, how many lines it holds) and the prices are admitted
   * separately, where the refusals can be named one by one.
   *
   * `currency` falls back to the empty string rather than "USD" when the file
   * states none: `own-paper-sighting.ts`'s `?? "USD"` is the measured defect
   * that stamps every Turkish and British sighting as dollars (ADR 0117), and a
   * catalogue is exactly the document that would spread it. The warning names
   * the absence.
   */
  private priceCatalogue(text: string): ParsedDocument {
    const header = readEdi832Header(text);
    const warnings = [
      `This is an EDI 832 price/sales catalogue, not an invoice. It is stored as a price list and NOTHING on it has been priced by storing it: ${header.lineCount} catalogue ${header.lineCount === 1 ? "line was" : "lines were"} read, and each one is admitted to this house's price register only under a price code a manager of this house has stated the meaning of (ADR 0126).`,
    ];
    if (!header.currency)
      warnings.push(
        "The catalogue states no CUR currency segment. No currency was assumed — there is deliberately no USD default here — so every line will be refused until one is declared with the file.",
      );
    if (!header.catalogNumber)
      warnings.push(
        "The catalogue states no BCT02 number, so it cannot be told apart from another edition by its own header.",
      );
    return {
      docType: "price_list",
      docNumber: header.catalogNumber,
      docDate: header.effectiveDate,
      referencesDocNumber: null,
      poNumber: null,
      vendorName: header.senderName,
      vendorAccount: null,
      currency: header.currency ?? "",
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
      // Low, and it is about the PARSE, not the file: everything below the
      // header was deliberately left unread here.
      confidence: 0.4,
      warnings,
    };
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
      // A document nobody could read states no currency, and it never states
      // dollars. This was the literal `"USD"` until 2026-09-06 — an unread
      // file asserting a currency is a claim about a vendor made by a parser
      // that read nothing at all.
      currency: "",
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
    const needsReview = this.needsReview(parsed);

    /**
     * The columns migration 20260904120000 adds. Held apart so a database that
     * has not applied it yet is TOLD APART from a document that printed no
     * price base — the same distinction the read side makes.
     *
     * A write fallback is a heavier thing than a read fallback, so it does two
     * things a silent retry would not: it names the loss in the document's own
     * `notes` (which the canonical page renders), and it logs at warn level.
     * This shape exists only for the window between this branch and its merge;
     * once the migration is on every database the retry can never fire, and
     * `v3.0-TECH-DEBT.md` carries the note to delete it.
     */
    let schemaLagNote: string | null = null;

    /**
     * The parser's own snapshot, cast ONCE up here rather than inline in the
     * payload. `check_order_capture_contract.py` splits a write payload on
     * top-level commas and does not know that `Record<string, unknown>` has one
     * inside it — so an inline cast made this whole insert unreadable to the
     * guard, and a column the table does not have could be written through it
     * without CI noticing. Hoisting the cast is what makes the payload
     * checkable; it changes nothing at runtime.
     */
    const extractedSnapshot = parsed as unknown as Record<string, unknown>;

    let { data, error } = await this.db
      .getClient()
      .from("procurement_documents")
      .insert({
        // Inline, never spread: `check_order_capture_contract.py` can only read
        // a write whose column names are literal, and a payload it cannot read
        // is a payload it cannot check for a column the table does not have.
        printed: parsed.printed ?? null,
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
        extracted: extractedSnapshot,
        extraction_confidence: parsed.confidence,
        // ADR 0059 (L5, L6). Both were reachable all along and neither was
        // written: `extraction_model` has had a column and no writer since the
        // document spine, and there was no `event_id` column at all — so no
        // extraction in this product could ever be attributed to a model.
        //
        // NULL on both is honest and expected for EDI and for an unreadable
        // document: no model ran. It is the invoice photograph reading NULL
        // that was the defect.
        extraction_model: parsed.extractionModel ?? null,
        event_id: parsed.eventId ?? null,
        // NULL, not `''` and never `'USD'`, when the money was refused or held
        // (founder, 2026-09-06; `invoice-currency.ts`). NULL is the state
        // `restaurants.currency` and `price_history.currency` already use for
        // "not recorded" and the one `formatMoney` renders as the sentence
        // rather than a symbol. An explicit null in the payload overrides the
        // column's `DEFAULT 'USD'`, which only applies to an OMITTED column —
        // omitting it here would put the defect straight back.
        currency: parsed.currency || null,
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

    // 42703 is Postgres's `undefined_column`; PGRST204 is PostgREST's own answer
    // when an INSERT payload names a column missing from its schema cache. The
    // insert path returns the SECOND one — measured 2026-09-04 — so a retry
    // keyed only on 42703 would never fire.
    if (error?.code === "42703" || error?.code === "PGRST204") {
      schemaLagNote =
        "The price base and the printed literals were read but could not be " +
        "stored: this database has not applied migration 20260904120000.";
      this.logger.warn(schemaLagNote);
      ({ data, error } = await this.db
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
          raw_payload:
            input.source === "edi" || input.source === "sftp"
              ? bytes.toString("utf8").slice(0, 500_000)
              : null,
          extracted: extractedSnapshot,
          extraction_confidence: parsed.confidence,
          extraction_model: parsed.extractionModel ?? null,
          event_id: parsed.eventId ?? null,
          currency: parsed.currency || null,
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
          notes: [...parsed.warnings, schemaLagNote].join("\n"),
        })
        .select("id")
        .single());
    }

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
    // `error` null AND `data` null cannot happen through `.single()` (PostgREST
    // raises PGRST116 instead), but reporting a document id we never received
    // would be a fabricated success and a TypeError here would surface as a 500
    // with no mention of the write.
    if (!data)
      throw new Error(
        `procurement_documents insert returned no row and no error for sha256 ${sha256}`,
      );

    const documentId = data.id as string;

    const lineErr = await this.insertDocumentLines(
      documentId,
      input.restaurantId,
      parsed.lines,
      schemaLagNote,
    );
    if (lineErr)
      this.logger.warn(
        `document ${documentId} stored but its lines failed: ${lineErr.message}`,
      );

    await this.linkAndMatch(
      documentId,
      input.restaurantId,
      input.orderId ?? null,
      parsed,
    );

    return documentId;
  }

  /**
   * `needs_review` whenever the document did not tie out, came back unknown, or
   * carries warnings — anything a person should look at before it is used to
   * argue with a distributor.
   *
   * ONE RULE, TWO CALLERS. Intake writes it on insert; the extraction door
   * writes it on update. Two copies would drift, and the drift would be
   * invisible: a document that skipped review because the second copy forgot a
   * clause looks exactly like one that passed it.
   */
  private needsReview(parsed: ParsedDocument): boolean {
    return (
      parsed.docType === "unknown" ||
      parsed.tiesOut === false ||
      parsed.warnings.length > 0 ||
      parsed.lines.length === 0
    );
  }

  /**
   * Write a document's lines. Shared by intake and by the extraction door, so
   * a line written through either carries the same columns.
   *
   * Returns the error rather than acting on it: intake WARNS (a document is
   * still worth keeping without its lines, and failing the ingest would lose
   * the paper), while the door THROWS (its entire purpose is to put lines on a
   * document, so a silent success there would be a fabricated one).
   */
  private async insertDocumentLines(
    documentId: string,
    restaurantId: string,
    lines: ParsedLine[],
    schemaLagNote: string | null,
  ): Promise<{ message: string } | null> {
    if (!lines.length) return null;

    const { error: lineErr } = await this.db
      .getClient()
      .from("procurement_document_lines")
      .insert(
        // TWO INLINE LITERALS, not one with a conditional spread.
        // `check_order_capture_contract.py` reads write payloads only when the
        // column names are literal; a spread makes the whole write invisible
        // to it, which is how a column the table does not have gets written in
        // production. The second branch is the pre-migration fallback (see
        // `schemaLagNote` above) and disappears with it.
        //
        // BT-149 / BT-150 and the printed literals (ADR 0104 D1, migration
        // 20260904120000): before those columns existed the extractor read all
        // three and threw them away at the end of the request, so
        // `142,00 / KS(12)` and `142,00` were indistinguishable the moment the
        // document was read back.
        //
        // order_line_id is left NULL on purpose in both. Matching lines to a
        // PO is a separate, ranked step, and a low-confidence guess written
        // here silently corrupts cost basis for months before anyone notices.
        lines.map((l) =>
          schemaLagNote
            ? {
                document_id: documentId,
                restaurant_id: restaurantId,
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
                order_line_id: null,
              }
            : {
                document_id: documentId,
                restaurant_id: restaurantId,
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
                price_base_qty: l.priceBaseQty ?? null,
                price_base_uom: l.priceBaseUom ?? null,
                printed: l.printed ?? null,
                order_line_id: null,
              },
        ),
      );
    return lineErr ? { message: lineErr.message } : null;
  }

  /**
   * The post-extraction tail: attach the document to an order, then pair its
   * lines with what was ordered.
   *
   * Shared with the extraction door so a document filled from outside the
   * gateway is matched by exactly the code that matches one the gateway read
   * itself. Without the link step the matcher returns empty — it looks up order
   * lines THROUGH `procurement_document_links` — so "same matching" has to mean
   * both halves or it means nothing.
   *
   * Best-effort throughout: a document is still useful unmatched, and failing
   * over line pairing would lose the thing that was already written.
   */
  private async linkAndMatch(
    documentId: string,
    restaurantId: string,
    orderId: string | null,
    parsed: ParsedDocument,
  ): Promise<void> {
    if (orderId)
      await this.link(documentId, orderId, restaurantId, "manual", 1);
    else await this.autoLink(documentId, restaurantId, parsed);

    try {
      await this.matchDocumentLines(documentId, restaurantId);
    } catch (err: any) {
      this.logger.warn(
        `line matching failed for document ${documentId}: ${err?.message}`,
      );
    }
  }

  /**
   * THE EXTRACTION DOOR — apply an extraction produced OUTSIDE this gateway to
   * a document that was stored unread.
   *
   * WHY IT EXISTS. `DocumentExtractorService` calls Anthropic with
   * `ANTHROPIC_API_KEY`, and that key has no credit: three synthetic PDFs
   * pushed at the local gateway on 2026-09-04 all came back
   * `422 Anthropic 400: Your credit balance is too low`. ADR 0104 D6 (PR #300)
   * made that survivable — the document is stored unread rather than discarded
   * — which leaves a real invoice sitting in `needs_review` with no lines and
   * no way to fill it. A Claude Code session can read the PDF and post the JSON
   * `SYSTEM_PROMPT` describes; this applies it.
   *
   * THE GATEWAY'S OWN EXTRACTOR REMAINS THE PRODUCT PATH. This is a supply
   * door, not a second extractor: it does no reading of its own, and the only
   * parser it may use is `extractor.normalize`, so a body that reaches the
   * database has passed exactly the validation, tie-out and warning rules a
   * model's answer passes.
   *
   * IT FILLS AN UNREAD DOCUMENT AND NEVER OVERWRITES A READ ONE. A document
   * with lines, or with an extraction that was not the D6 degradation, is
   * refused. Overwriting one would silently discard a manager's `editLine`
   * corrections and the tie-out those corrections justify — the correction path
   * is slice 3's, with its own append-only shape.
   *
   * ORDER OF WRITES IS LOAD-BEARING: lines first, header second. The other way
   * round, a line insert that failed would leave a document claiming to be a
   * read invoice with nothing on it — "the vendor billed nothing", which is a
   * claim nobody made — AND closed to this door forever. This way a failure
   * leaves the document exactly as degraded as it was, and the door open.
   *
   * NO STOCK, COST OR ORDER WRITES. Same as intake: this produces a document
   * and its lines. Applying it to a delivery is still a separate, human step.
   */
  async applyExternalExtraction(
    restaurantId: string,
    documentId: string,
    rawText: string,
    model: string,
    userId: string | null,
  ): Promise<ExternalExtractionResult> {
    const client = this.db.getClient();

    // ---- 1. the document, scoped by tenant --------------------------------
    // The gateway holds the service role, so this `eq` is the whole of tenant
    // isolation on this route.
    const { data: doc, error: docErr } = await client
      .from("procurement_documents")
      .select("id, status, doc_type, extraction_confidence")
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    // `data: null` means BOTH "no such document" and "the read failed".
    // Checking `error` first is what keeps a broken query from reporting as a
    // document that does not exist (ADR 0067).
    if (docErr) throw new Error(docErr.message);
    if (!doc) throw new Error("NOT_FOUND");

    if (doc.status !== "needs_review" && doc.status !== "received")
      throw new Error(
        `ALREADY_READ:this document is ${doc.status}, and only a document still awaiting review can be filled from outside`,
      );

    // ---- 2. is it actually unread? ----------------------------------------
    // The D6 degradation is exactly `doc_type unknown`, confidence 0, no lines.
    // Anything else has been read — by the model, by EDI, or by a person — and
    // is refused rather than overwritten.
    const confidence =
      doc.extraction_confidence == null
        ? null
        : Number(doc.extraction_confidence);
    if (doc.doc_type !== "unknown")
      throw new Error(
        `ALREADY_READ:this document was already read as a ${doc.doc_type}; this door only fills a document stored unread`,
      );
    if (confidence !== null && confidence > 0)
      throw new Error(
        `ALREADY_READ:this document already carries an extraction (confidence ${confidence}); this door only fills a document stored unread`,
      );

    const { data: existingLines, error: linesErr } = await client
      .from("procurement_document_lines")
      .select("id")
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .limit(1);
    // A line read that FAILED must never be read as "this document has no
    // lines" — that is the absence-reported-as-health fault, and here it would
    // authorise overwriting a document that already has lines on it.
    if (linesErr) throw new Error(linesErr.message);
    if ((existingLines ?? []).length)
      throw new Error(
        "ALREADY_READ:this document already has lines; correcting a read document is not what this door does",
      );

    // ---- 3. parse, through the ONE parser ---------------------------------
    // `normalize` is forgiving by design: prose comes back as an `unknown`
    // document with a warning rather than as an error. That is right for a
    // model's answer arriving mid-ingest and wrong here, where the caller is a
    // person who can fix the body and retry — so the two shapes `normalize`
    // would swallow are named and refused first.
    let candidate: unknown;
    try {
      candidate = JSON.parse(stripJsonFence(rawText));
    } catch (err: any) {
      throw new Error(
        `UNPARSABLE:rawText is not the JSON the extraction contract describes — ${err?.message ?? "unknown parse error"}`,
      );
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      throw new Error(
        "UNPARSABLE:rawText parsed to a JSON value that is not an object, so it carries no document",
      );

    const parsed = this.extractor.normalize(rawText, model);

    // A zero-line extraction is refused rather than applied. Applying it would
    // raise the document's confidence above zero and close this door, leaving a
    // document that is still degraded on screen and no longer fillable — a
    // permanent lock-out bought for nothing. A 422 is recoverable; that is not.
    if (!parsed.lines.length)
      throw new Error(
        "UNPARSABLE:the extraction carries no lines. Applying it would close this door on a document that is still unread, so it is refused rather than written",
      );

    // ---- 4. lines FIRST ---------------------------------------------------
    // `schemaLagNote: null` — migration 20260904120000 is on main, and this
    // route did not exist before it. A database missing those columns fails
    // loudly here, before the header moves, rather than dropping BT-149/BT-150
    // quietly.
    const lineErr = await this.insertDocumentLines(
      documentId,
      restaurantId,
      parsed.lines,
      null,
    );
    if (lineErr)
      throw new Error(
        `the extracted lines could not be written, so the document was left unread: ${lineErr.message}`,
      );

    // ---- 5. then the header ----------------------------------------------
    const extractedSnapshot = parsed as unknown as Record<string, unknown>;
    // Inline, never spread, and never assembled by a helper shared with the
    // intake INSERT: `check_order_capture_contract.py` can only read a write
    // whose column names are literal, and a payload it cannot read is one it
    // cannot check for a column the table does not have.
    //
    // NOT WRITTEN, deliberately: `event_id`. No model call happened inside this
    // gateway, so there is no neural-footprint row to point at, and NULL is the
    // true statement. `source_channel`, `sha256`, `storage_path` and
    // `file_bytes` belong to how the paper ARRIVED and are untouched — this
    // door changes what we read off it, never where it came from.
    const { error: headerErr } = await client
      .from("procurement_documents")
      .update({
        printed: parsed.printed ?? null,
        doc_type: parsed.docType,
        doc_number: parsed.docNumber,
        doc_date: parsed.docDate,
        references_doc_number: parsed.referencesDocNumber,
        extracted: extractedSnapshot,
        extraction_confidence: parsed.confidence,
        // VERBATIM, and deliberately not the configured model's name: an
        // extraction this gateway did not perform must never be attributable to
        // the model it would have used.
        extraction_model: model,
        currency: parsed.currency || null,
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
        status: this.needsReview(parsed) ? "needs_review" : "received",
        notes: parsed.warnings.length ? parsed.warnings.join("\n") : null,
        // The D6 degradation ends with this write, so the fields that carry it
        // are cleared in the same statement. Written explicitly rather than
        // left alone: a stale "the intake gate rejected this" beside a freshly
        // read document is worse than either state on its own.
        intake_verdict: null,
        intake_reason: null,
      })
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId);
    if (headerErr)
      throw new Error(
        `${parsed.lines.length} line(s) were written and the header was not, so this document now has lines under an unread header and this door will refuse it: ${headerErr.message}`,
      );

    // ---- 6. the same tail intake runs -------------------------------------
    await this.linkAndMatch(documentId, restaurantId, null, parsed);

    // ---- 7. one appended revision (ADR 0104 D1/D5) ------------------------
    // Built from the COLUMNS rather than from `parsed`, so the revision records
    // what the database actually holds — including the pairings step 6 just
    // wrote — rather than what we hoped to write. `extracted` is the honest
    // source value: a model produced these numbers by reading the page, and
    // which model is in `extraction_model`.
    const built = await this.canonical.buildFromDocumentId(
      restaurantId,
      documentId,
    );
    const revision: ReadResult<{ revision: number; id: string }> = built.ok
      ? await this.canonical.persistRevision(
          documentId,
          built.value,
          "extracted",
          userId,
        )
      : { ok: false, error: built.error };
    if (!revision.ok)
      this.logger.warn(
        `document ${documentId} was filled but no revision was appended: ${revision.error}`,
      );

    return {
      warnings: parsed.warnings,
      tieOut: {
        computedLinesTotal: parsed.computedLinesTotal,
        tieOutDelta: parsed.tieOutDelta,
        tiesOut: parsed.tiesOut,
      },
      revision,
    };
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
          // ADR 0059. The same two numbers, written a second time into columns
          // nothing else may touch. match_confidence/match_method are LIVE
          // STATE and a human confirmation legitimately overwrites them; these
          // are the proposal, and the proposal is what used to be destroyed at
          // the exact instant the pair became a label.
          proposed_confidence: m.confidence,
          proposed_method: m.method,
        })
        .eq("id", m.documentLineId)
        .eq("restaurant_id", restaurantId);
      if (error)
        this.logger.warn(
          `failed to link document line ${m.documentLineId}: ${error.message}`,
        );
    }

    // ADR 0059. Everything the matcher considered and did not write, recorded
    // before anyone answers. These are the near-misses: the negative class of
    // the line-matching dataset, which is the half that teaches a matcher where
    // its boundary is. Until now they came back on the HTTP response and were
    // gone the moment the tab closed.
    //
    // Fire-and-forget, deliberately: a suggestion that cannot be recorded must
    // not fail the matching run a human is waiting on. The instrument never
    // breaks the thing it measures.
    void this.recordMatchSuggestions(
      documentId,
      restaurantId,
      result.suggested,
    );

    if (result.applied.length || result.suggested.length)
      this.logger.log(
        `document ${documentId}: ${result.applied.length} lines paired, ${result.suggested.length} awaiting confirmation`,
      );

    return result;
  }

  /**
   * Persist the pairings the matcher proposed but did not write (ADR 0059).
   *
   * One row per candidate, keyed on the pair. Re-running the matcher RESTATES a
   * suggestion rather than making a new one — the intake sweep runs every five
   * minutes, and without that a single unresolved suggestion would become a
   * pile. A duplicate key is therefore the design working, not an error.
   *
   * Never throws. Every failure is a warn.
   */
  private async recordMatchSuggestions(
    documentId: string,
    restaurantId: string,
    suggested: LineMatch[],
  ): Promise<void> {
    if (!suggested.length) return;
    try {
      const { error } = await this.db
        .getClient()
        .from("procurement_line_match_suggestions")
        .upsert(
          suggested.map((m) => ({
            restaurant_id: restaurantId,
            document_id: documentId,
            document_line_id: m.documentLineId,
            order_line_id: m.orderLineId,
            confidence: m.confidence,
            method: m.method,
            substitution: m.substitution,
            reason: m.reason,
          })),
          {
            onConflict: "document_line_id,order_line_id",
            ignoreDuplicates: true,
          },
        );
      if (error)
        this.logger.warn(
          `match suggestions not recorded for document ${documentId}: ${error.message}`,
        );
    } catch (err: any) {
      this.logger.warn(
        `match suggestions not recorded for document ${documentId}: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * The human half of line matching (ADR 0059).
   *
   * THE RULE: a machine proposal shown to a human is written before the human
   * answers, and the answer is APPENDED, never substituted.
   *
   * This endpoint used to write `match_confidence: 1, match_method: "manual"`
   * unconditionally. As live state that is not wrong — a person really did
   * confirm it — but it wrote over the model's estimate, in the same two
   * columns, at the exact instant the pair became a label. The proposal half was
   * deleted by the act of labelling it, which is the only moment it could never
   * be recovered afterwards.
   *
   * So:
   *
   *  - A pairing the MATCHER APPLIED already carries proposed_confidence /
   *    proposed_method. Confirming it adds confirmed_by / confirmed_at and
   *    touches neither match column: the machine's number stands, and a human
   *    standing behind it is a separate, additional fact.
   *
   *  - A pairing the matcher SUGGESTED was never written to the line, so the
   *    proposal lives in `procurement_line_match_suggestions`. Accepting it
   *    copies that proposal onto the line first, then records the confirmation.
   *    The match columns are set from the SUGGESTION's own numbers — not from
   *    `1`/`"manual"` — because the machine is what proposed this pairing and
   *    the confidence it had is the thing worth keeping.
   *
   *  - A pairing NO machine proposed is genuinely manual. `match_confidence: 1,
   *    match_method: "manual"` is then the honest live state and nothing is
   *    being destroyed by writing it.
   *
   * Unlinking clears the live pairing and the confirmation, and NEVER clears
   * proposed_*: "the model proposed this and a human rejected it" is the single
   * most valuable row in an entity-resolution corpus, and erasing the proposal
   * on rejection would keep only the examples the model already got right.
   */
  async confirmLineMatch(
    documentId: string,
    lineId: string,
    restaurantId: string,
    userId: string | null,
    orderLineId: string | null,
  ): Promise<Record<string, unknown>> {
    const client = this.db.getClient();

    const { data: before, error: readErr } = await client
      .from("procurement_document_lines")
      .select("id, order_line_id, proposed_confidence, proposed_method")
      .eq("id", lineId)
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!before) throw new Error("NOT_FOUND");

    const now = new Date().toISOString();

    if (!orderLineId) {
      const { data, error } = await client
        .from("procurement_document_lines")
        .update({
          order_line_id: null,
          match_confidence: null,
          match_method: null,
          confirmed_by: null,
          confirmed_at: null,
        })
        .eq("id", lineId)
        .eq("document_id", documentId)
        .eq("restaurant_id", restaurantId)
        .select(
          "id, order_line_id, match_method, match_confidence, proposed_method, proposed_confidence, confirmed_at",
        )
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("NOT_FOUND");

      // The pairing that WAS on the line has just been rejected by a person.
      // Record that against the suggestion it came from, if there was one.
      if (before.order_line_id)
        void this.resolveSuggestion(
          lineId,
          before.order_line_id as string,
          "rejected",
          userId,
          now,
        );
      return data;
    }

    // Was this pairing proposed? Either it is already on the line (the matcher
    // applied it) or it is sitting in the suggestions table.
    const alreadyProposed = before.proposed_method != null;
    let suggestion: {
      confidence: number | null;
      method: string | null;
    } | null = null;
    if (!alreadyProposed) {
      const { data } = await client
        .from("procurement_line_match_suggestions")
        .select("confidence, method")
        .eq("document_line_id", lineId)
        .eq("order_line_id", orderLineId)
        .maybeSingle();
      suggestion = data ?? null;
    }

    const update: Record<string, unknown> = {
      order_line_id: orderLineId,
      confirmed_by: userId,
      confirmed_at: now,
    };

    if (alreadyProposed) {
      // Nothing else. match_confidence / match_method already hold the
      // matcher's own answer and this endpoint must not overwrite them.
    } else if (suggestion) {
      // Promote the suggestion onto the line, into BOTH halves at once, so the
      // proposal is recorded in the same write that makes it live.
      update.match_confidence = suggestion.confidence;
      update.match_method = suggestion.method;
      update.proposed_confidence = suggestion.confidence;
      update.proposed_method = suggestion.method;
    } else {
      // A pairing no machine ever proposed. There is no proposal half here, so
      // proposed_* stay NULL — which is the true statement "the machine never
      // offered an opinion on this pair", not a missing value.
      update.match_confidence = 1;
      update.match_method = "manual";
    }

    const { data, error } = await client
      .from("procurement_document_lines")
      .update(update)
      .eq("id", lineId)
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .select(
        "id, order_line_id, match_method, match_confidence, proposed_method, proposed_confidence, confirmed_at",
      )
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("NOT_FOUND");

    void this.resolveSuggestion(lineId, orderLineId, "accepted", userId, now);
    // A different pairing being confirmed for this line invalidates every other
    // suggestion on it — but that is not a human rejection and must never be
    // scored as one, so it lands as `superseded`.
    void this.supersedeOtherSuggestions(lineId, orderLineId, now);

    return data;
  }

  /**
   * Record what a human did with one suggestion (ADR 0059).
   *
   * Fire-and-forget. A pairing a person just confirmed must not fail because
   * the instrument that grades it could not write.
   */
  private async resolveSuggestion(
    documentLineId: string,
    orderLineId: string,
    resolvedAs: "accepted" | "rejected",
    userId: string | null,
    at: string,
  ): Promise<void> {
    try {
      const { error } = await this.db
        .getClient()
        .from("procurement_line_match_suggestions")
        .update({
          resolved_as: resolvedAs,
          resolved_at: at,
          resolved_by: userId,
        })
        .eq("document_line_id", documentLineId)
        .eq("order_line_id", orderLineId)
        .is("resolved_at", null);
      if (error)
        this.logger.warn(
          `suggestion not resolved for line ${documentLineId}: ${error.message}`,
        );
    } catch (err: any) {
      this.logger.warn(
        `suggestion not resolved for line ${documentLineId}: ${err?.message ?? err}`,
      );
    }
  }

  /** Mark the losing candidates on a line `superseded`, never `rejected`. */
  private async supersedeOtherSuggestions(
    documentLineId: string,
    keptOrderLineId: string,
    at: string,
  ): Promise<void> {
    try {
      const { error } = await this.db
        .getClient()
        .from("procurement_line_match_suggestions")
        .update({ resolved_as: "superseded", resolved_at: at })
        .eq("document_line_id", documentLineId)
        .neq("order_line_id", keptOrderLineId)
        .is("resolved_at", null);
      if (error)
        this.logger.warn(
          `suggestions not superseded for line ${documentLineId}: ${error.message}`,
        );
    } catch (err: any) {
      this.logger.warn(
        `suggestions not superseded for line ${documentLineId}: ${err?.message ?? err}`,
      );
    }
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
   * Re-file a document's MONEY after a person has restated its currency.
   *
   * ---------------------------------------------------------------------------
   * WHY THIS LIVES HERE AND NOT ON THE CONTROLLER
   * ---------------------------------------------------------------------------
   * `computed_lines_total`, `tie_out_delta` and `ties_out` are the MACHINE'S OWN
   * PROPOSAL about a document, and ADR 0059's rule is that a proposal is written
   * by the thing that proposed it — a human's answer is APPENDED, never
   * substituted. `scripts/check_proposal_preservation.py` names this file as
   * their declared writer and it FAILED the first version of the currency
   * restatement, which wrote all three from `documents.controller.ts:820-822`.
   *
   * That failure was not a technicality. A controller computing a tie-out is a
   * second implementation of the arithmetic every other path runs through
   * `applyTieOut`, and the moment the two disagree the screen shows one verdict
   * while the review queue sorts on another. The restatement is a HUMAN act
   * (who, when, previous value — `procurement_document_currency_changes`); the
   * arithmetic that follows it is the machine's, and it is re-derived here,
   * through the same `applyTieOut` intake and `editLine` already use.
   *
   * ---------------------------------------------------------------------------
   * WHAT IT DOES, AND WHAT IT DELIBERATELY DOES NOT
   * ---------------------------------------------------------------------------
   * It reads the whole parse back off `procurement_documents.extracted` — kept
   * intact precisely so a document whose money rules 1 or 2 withheld does not
   * have to be uploaded again — and writes the figures under the currency the
   * person named. **NOTHING IS CONVERTED.** There is no exchange rate anywhere
   * in this system and inventing one would be inventing the answer
   * (`20260905120000_a_house_names_its_money.sql`, rule 3). The vendor's own
   * numbers go back exactly as the vendor wrote them; only what they are
   * denominated in has moved.
   *
   * It does NOT write `currency`, and it does not write the audit row. Those are
   * the caller's: the currency is the person's answer and the log is the record
   * of them giving it, and both must already have landed before this runs.
   *
   * `snapshotReadable: false` is returned rather than thrown, and NOTHING is
   * written in that case. A stored reading this gateway cannot parse leaves a
   * document labelled and unpriced, which is honest; writing nulls instead would
   * ERASE figures a document already carried, on an act that was only meant to
   * re-label them.
   */
  async refileMoneyForCurrency(
    documentId: string,
    restaurantId: string,
    currency: string,
  ): Promise<{
    snapshotReadable: boolean;
    sentence: string;
    document: DocumentMoney | null;
    lineCount: number;
    pricedLines: number;
    linesRefiled: number;
    lineFailures: string[];
  }> {
    const { data: doc, error: readError } = await this.db
      .getClient()
      .from("procurement_documents")
      .select("id, currency, total, extracted")
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    // A FAILED READ IS NEVER AN EMPTY ONE (ADR 0067). Without this, an outage
    // and a document with no stored reading both become "could not re-file",
    // and only one of those is worth re-uploading the paper over.
    if (readError) throw new Error(`REFILE_READ_FAILED:${readError.message}`);
    if (!doc) throw new Error("NOT_FOUND");

    const previousTotal = (doc as { total?: number | null }).total ?? null;
    const refiled = refiledMoney((doc as { extracted?: unknown }).extracted);

    if (!refiled)
      return {
        snapshotReadable: false,
        sentence:
          `The money could NOT be re-filed: this document's stored reading ` +
          `(procurement_documents.extracted) is not a parse this gateway can ` +
          `read, so there are no figures to put back. The currency now says ` +
          `${currency} and the figures are unchanged — nothing was erased, and ` +
          `nothing was invented. Upload the document again to price it.`,
        document: null,
        lineCount: 0,
        pricedLines: 0,
        linesRefiled: 0,
        lineFailures: [],
      };

    const pricedLines = refiled.lines.filter(
      (l) => l.unit_price != null || l.line_total != null,
    ).length;

    const sentence = refilingSentence({
      previous: null,
      next: currency,
      wasHeld: previousTotal == null,
      documentTotal: refiled.document.total,
      lineCount: refiled.lines.length,
      pricedLines,
    });

    // Inline literal, never a spread: `check_order_capture_contract.py` can
    // only read a write whose column names are literal, and a payload it
    // cannot read is a payload it cannot check for a column the table does
    // not have.
    const { error: moneyError } = await this.db
      .getClient()
      .from("procurement_documents")
      .update({
        subtotal: refiled.document.subtotal,
        freight: refiled.document.freight,
        fuel_surcharge: refiled.document.fuel_surcharge,
        split_case_fee: refiled.document.split_case_fee,
        delivery_fee: refiled.document.delivery_fee,
        deposit_total: refiled.document.deposit_total,
        tax: refiled.document.tax,
        other_charges: refiled.document.other_charges,
        discount_total: refiled.document.discount_total,
        total: refiled.document.total,
        computed_lines_total: refiled.document.computed_lines_total,
        tie_out_delta: refiled.document.tie_out_delta,
        ties_out: refiled.document.ties_out,
      })
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId);
    if (moneyError) throw new Error(`REFILE_WRITE_FAILED:${moneyError.message}`);

    // The lines carry their own money and it was withheld with the header's.
    // Written one at a time and each failure NAMED: a partial re-filing
    // reported as a success would leave a document priced in the header and
    // blank in the body, which reads as a vendor who billed a total for
    // nothing.
    const lineFailures: string[] = [];
    for (const l of refiled.lines) {
      const { error } = await this.db
        .getClient()
        .from("procurement_document_lines")
        .update({
          unit_price: l.unit_price,
          line_total: l.line_total,
          allowance: l.allowance,
          deposit: l.deposit,
        })
        .eq("document_id", documentId)
        .eq("restaurant_id", restaurantId)
        .eq("line_no", l.line_no);
      if (error) lineFailures.push(`line ${l.line_no}: ${error.message}`);
    }

    return {
      snapshotReadable: true,
      sentence,
      document: refiled.document,
      lineCount: refiled.lines.length,
      pricedLines,
      linesRefiled: refiled.lines.length - lineFailures.length,
      lineFailures,
    };
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
    tieOut: {
      computedLinesTotal: number;
      tieOutDelta: number | null;
      tiesOut: boolean | null;
    };
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
      throw new Error(`NOT_EDITABLE:${doc.status}`);

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

    // qty_bottles is derived (qty × pack size) and the matcher quotes it — a
    // qty or pack-size correction must carry it along unless the caller set
    // it explicitly (Opus correctness review, DEFECT 4).
    if (
      patch.qtyBottles === undefined &&
      (update.qty !== undefined || update.pack_size !== undefined)
    ) {
      const beforeRow = before as Record<string, unknown>;
      const effQty = (update.qty ?? beforeRow.qty) as number | null;
      const effPack = (update.pack_size ?? beforeRow.pack_size) as
        | number
        | null;
      if (finite(effQty) && finite(effPack))
        update.qty_bottles = effQty * effPack;
    }

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
      // Restore ONLY the columns this edit touched — a whole-row snapshot
      // write-back would silently revert a concurrent edit's already-200'd
      // correction, and rewriting order_line_id without its match_confidence/
      // match_method companions strands a pairing (Opus correctness review,
      // DEFECT 3).
      const beforeRow = before as Record<string, unknown>;
      const restore: Record<string, unknown> = {};
      for (const col of Object.keys(update)) restore[col] = beforeRow[col];
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
