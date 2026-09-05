import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { DatabaseService } from "../../database/database.service";
import { DocumentIntakeService } from "./document-intake.service";
import { ApplyExtractionDto, UploadDocumentDto } from "./dto/documents.dto";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";
import { DeliverySpineService } from "../canonical/delivery-spine.service";
import { createHash } from "node:crypto";
import { looksLikeEdi832 } from "../../distributor-feed/parse-edi832";
import { DISTRIBUTORS } from "../../distributor-feed/distributor-feed.registry";
import { CatalogIngestService } from "../../distributor-feed/catalog-ingest.service";

/**
 * `fullName` and `email` are read for ONE purpose: an admitted class-C price
 * names the person who handed the catalogue over, as the session named them.
 * Optional because a token that carries neither is a real state, and the row
 * then says the name is unknown rather than inventing one.
 */
type AuthedUser = {
  userId: string;
  restaurantId: string;
  fullName?: string;
  email?: string;
};

/**
 * Vendor documents — upload, review, and the four-way match's evidence base.
 *
 *   POST /procurement/documents          upload/photograph a document (extract only)
 *   GET  /procurement/documents          list, newest first
 *   GET  /procurement/documents/:id      one document with its lines
 *   POST /procurement/documents/:id/verify   a human confirms the extraction
 *
 * EXTRACTION IS NOT APPLICATION. Every route here reads or annotates a document.
 * None of them writes stock, cost or an order — applying a document to a
 * delivery goes through verifyReceipt, where the match engine runs and a human
 * accepts the outcome. The dead InvoiceScannerModal this supersedes posted to
 * /invoices/:id/add-to-inventory, which would have stocked whatever a model read
 * off a photograph without the match ever running.
 *
 * restaurantId comes from the token on every route, never from the request.
 */
@ApiTags("procurement-documents")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("procurement/documents")
export class DocumentsController {
  constructor(
    private readonly intake: DocumentIntakeService,
    private readonly db: DatabaseService,
    private readonly canonical: CanonicalDocumentService,
    private readonly spine: DeliverySpineService,
    private readonly catalogIngest: CatalogIngestService,
  ) {}

  /**
   * Sign the stored original for viewing, or say why it could not be signed.
   *
   * Shared by `GET :id` and `GET :id/canonical` so the two panes cannot drift:
   * the canonical page's `OriginalPane` and the receipts page's `PaperPane`
   * show the same object through the same one-hour link. `null` with a reason
   * beats `null` alone — "no file was stored" and "the file exists and could
   * not be signed" send a manager to two different places.
   */
  private async signOriginal(
    storagePath: string | null,
  ): Promise<{ imageUrl: string | null; reason: string | null }> {
    if (!storagePath)
      return {
        imageUrl: null,
        reason: "no original was stored for this document",
      };
    try {
      const { data: signed, error } = await this.db
        .getClient()
        .storage.from("vendor-attachments")
        .createSignedUrl(storagePath, 3600);
      if (error || !signed?.signedUrl)
        return {
          imageUrl: null,
          reason: `the stored original could not be signed: ${error?.message ?? "no URL returned"}`,
        };
      return { imageUrl: signed.signedUrl, reason: null };
    } catch (err) {
      return {
        imageUrl: null,
        reason: `the stored original could not be signed: ${err?.message ?? "unknown error"}`,
      };
    }
  }

  @Get(":id/canonical")
  @ApiOperation({
    summary: "One document as the canonical Mudavym document (ADR 0104)",
    description:
      "The three-layer canonical object, the delivery spine it sits on, the other documents on those deliveries, and a one-hour signed link to the original. READ-ONLY: no corrections, no claims, no writes of any kind. " +
      "A read that FAILED is reported in `failedRead` and the affected field is null — never an empty array, which would render as 'this document is on no delivery' (ADR 0067). `deliveries: []` is a real answer and means exactly that.",
  })
  async canonicalDocument(
    @Param("id") id: string,
    @CurrentUser() user: AuthedUser,
  ) {
    const built = await this.canonical.buildFromDocumentId(
      user.restaurantId,
      id,
    );
    if (!built.ok) {
      // "not found" is a 404; anything else is a read that broke.
      if (built.error.includes("not found"))
        throw new HttpException("Not found", HttpStatus.NOT_FOUND);
      throw new HttpException(built.error, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const [{ data: row, error: rowErr }, spine] = await Promise.all([
      this.db
        .getClient()
        .from("procurement_documents")
        /**
         * NO `filename` COLUMN. `procurement_documents` has never had one — the
         * web client's `ProcurementDocument.filename` is a field the API shapes,
         * not a column — and naming it here made PostgREST answer 42703 for the
         * WHOLE select, which then reported a stored original as "no original
         * was stored" (measured 2026-09-04, before this line was corrected).
         * The name comes off the end of `storage_path`, which is where intake
         * put it.
         */
        .select(
          "storage_path, content_type, status, intake_verdict, intake_reason, source_channel, extraction_model, sha256, created_at",
        )
        .eq("id", id)
        .eq("restaurant_id", user.restaurantId)
        .maybeSingle(),
      this.spine.forDocument(user.restaurantId, id),
    ]);

    const failedRead: string[] = [];
    if (rowErr) failedRead.push(`document metadata: ${rowErr.message}`);
    if (!spine.ok) failedRead.push(spine.error);

    /**
     * When the metadata read FAILED there is no `storage_path` to sign — and
     * "we could not read where the file is" is not "there is no file". Saying
     * the second would send someone to look for paper that is sitting in the
     * bucket, so the two answers are kept apart here.
     */
    const original = rowErr
      ? {
          imageUrl: null,
          reason:
            "the document's stored-file metadata could not be read, so this screen cannot say whether an original exists",
        }
      : await this.signOriginal((row?.storage_path as string) ?? null);
    const storagePath = (row?.storage_path as string) ?? null;

    const deliveries = spine.ok ? spine.value : null;
    const siblings = deliveries
      ? Array.from(
          new Map(
            deliveries
              .flatMap((d) => d.documents)
              .filter((d) => d.documentId !== id)
              .map((d) => [d.documentId, d]),
          ).values(),
        )
      : null;

    return {
      canonical: built.value,
      // NULL means the read failed and `failedRead` says so. An empty array
      // means the reads succeeded and this document is on no delivery — the
      // page then collapses the spine and shows the sheet alone.
      deliveries,
      siblings,
      original: {
        ...original,
        contentType: (row?.content_type as string) ?? null,
        // The last path segment intake wrote, not a column.
        filename: storagePath ? (storagePath.split("/").pop() ?? null) : null,
        // Page count is not derivable from any column we hold; it needs the
        // object itself. Stated as unknown rather than defaulted to 1.
        pages: null,
      },
      intake: {
        status: (row?.status as string) ?? null,
        verdict: (row?.intake_verdict as string) ?? null,
        reason: (row?.intake_reason as string) ?? null,
        sourceChannel: (row?.source_channel as string) ?? null,
        extractionModel: (row?.extraction_model as string) ?? null,
        sha256: (row?.sha256 as string) ?? null,
        createdAt: (row?.created_at as string) ?? null,
      },
      // Things that are true about this READ rather than about the document:
      // a schema lag, a partial failure. Absent when there is nothing to say.
      ...(built.notes?.length ? { notes: built.notes } : {}),
      ...(failedRead.length ? { failedRead } : {}),
    };
  }

  @Post()
  @ApiOperation({
    summary: "Upload or photograph a vendor document",
    description:
      "Accepts base64 content for a PDF, image or EDI file. Classifies it (invoice / packing slip / credit memo / EDI 832 price list), extracts lines, and stores it for review. Writes no stock, cost or orders. Identical content is deduplicated per restaurant, so the same invoice arriving by email and by photo is one document. " +
      "AN EDI 832 PRICE CATALOGUE IS ALSO ADMITTED HERE (ADR 0126, batch 56) rather than at a door of its own: it is stored as a `price_list`, and when `distributorKey` names a measured distributor its lines are read against the price-code meanings a manager of this house has stated. The per-line outcome comes back in `catalog` — what was priced, and for each refused line the reason and the code that refused it. There is never a bare row count.",
  })
  async upload(
    @Body() body: UploadDocumentDto,
    @CurrentUser() user: AuthedUser,
  ) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(body.contentBase64, "base64");
    } catch {
      throw new HttpException(
        "contentBase64 is not valid base64",
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!buffer.length)
      throw new HttpException("Document is empty", HttpStatus.BAD_REQUEST);

    const result = await this.intake.ingest({
      restaurantId: user.restaurantId,
      providerId: body.providerId ?? null,
      orderId: body.orderId ?? null,
      source: body.source ?? "upload",
      buffer,
      filename: body.filename ?? null,
      mimeType: body.mimeType ?? null,
      sourceRef: `user:${user.userId}`,
    });

    if (result.error)
      throw new HttpException(result.error, HttpStatus.UNPROCESSABLE_ENTITY);

    /**
     * The catalogue half.
     *
     * Run on the BYTES, not on `result.parsed`, and run even when the door
     * reports a duplicate: `ingest` returns `parsed: null` for a document it
     * has already stored, and a house re-uploading the same catalogue after
     * finally stating what its codes mean is the ordinary case, not an error.
     * The database's own unique index on (source_ref, content_hash) decides
     * what is genuinely new, so re-admitting is idempotent and the report says
     * how many rows were already there.
     *
     * The sha256 is recomputed here rather than plumbed back out of `ingest`:
     * it is the same one-line hash over the same bytes, and the provenance
     * stamped on each admitted row must be the FILE's hash, not a hash of the
     * text after decoding.
     */
    const text = buffer.toString("utf8");
    const catalog = looksLikeEdi832(text)
      ? await this.admitCatalogue(text, buffer, body, user, result.documentId)
      : null;

    return {
      documentId: result.documentId,
      duplicate: result.duplicate,
      // The parse is returned so the receiving screen can show what was read
      // immediately, without a second round trip.
      document: result.parsed,
      ...(catalog ? { catalog } : {}),
    };
  }

  /**
   * Price an 832's lines, or say in words why none of them was priced.
   *
   * A catalogue with no `distributorKey` is NOT an error and NOT a silent
   * nothing: the file is on the record, and the answer names the keys the
   * register holds so the person can send it again with one. Guessing the
   * sender from the file's own `N1*SU` was the rejected alternative — one
   * house's statement of what `CON` means is not a statement about another
   * distributor's paper.
   */
  private async admitCatalogue(
    text: string,
    buffer: Buffer,
    body: UploadDocumentDto,
    user: AuthedUser,
    documentId: string | null,
  ) {
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const receivedAt = new Date().toISOString();
    if (!body.distributorKey) {
      const known = Object.keys(DISTRIBUTORS).sort();
      return {
        distributorKey: null,
        sha256,
        documentId,
        uploadedBy: user.userId,
        uploadedAt: receivedAt,
        admitted: 0,
        refusedWhole:
          "This is an EDI 832 price catalogue and no sender was named with it, so not one line was priced. A price code means whatever ONE distributor's implementation guide says it means, and this house's statements are recorded per sender — reading them against the wrong distributor's paper would file an invented trade level against real money. Send the file again naming `distributorKey`.",
        knownDistributorKeys: known,
        sentence: `Stored, and nothing priced: name the sender (${known.join(", ")}) and upload the same file again.`,
      };
    }
    return this.catalogIngest.admit({
      restaurantId: user.restaurantId,
      distributorKey: body.distributorKey,
      raw: text,
      sha256,
      documentId,
      uploadedBy: user.userId,
      uploadedByName: (user.fullName ?? user.email ?? "").trim() || null,
      receivedAt,
      declaredCurrency: body.declaredCurrency ?? null,
      providerId: body.providerId ?? null,
      filename: body.filename ?? null,
    });
  }

  @Get()
  @ApiOperation({ summary: "List vendor documents, newest first" })
  @ApiQuery({ name: "status", required: false })
  @ApiQuery({ name: "docType", required: false })
  @ApiQuery({
    name: "orderId",
    required: false,
    description:
      "Only documents linked to this order. Resolved through procurement_document_links, which is many-to-many because one distributor invoice routinely covers several POs.",
  })
  @ApiQuery({ name: "limit", required: false })
  async list(
    @CurrentUser() user: AuthedUser,
    @Query("status") status?: string,
    @Query("docType") docType?: string,
    @Query("orderId") orderId?: string,
    @Query("limit") limit?: string,
  ) {
    const n = Math.min(200, Math.max(1, parseInt(limit ?? "50", 10) || 50));

    let documentIds: string[] | null = null;
    if (orderId) {
      const { data: links, error: linkErr } = await this.db
        .getClient()
        .from("procurement_document_links")
        .select("document_id")
        .eq("restaurant_id", user.restaurantId)
        .eq("order_id", orderId);
      if (linkErr)
        throw new HttpException(
          linkErr.message,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      documentIds = (links ?? []).map((l) => l.document_id);
      // No links means no documents, not "all documents". Falling through to an
      // unfiltered query here would hand the receiving screen every invoice the
      // restaurant has ever received and let it pre-fill from the wrong one.
      if (!documentIds.length) return { items: [] };
    }

    let q = this.db
      .getClient()
      .from("procurement_documents")
      .select("*")
      .eq("restaurant_id", user.restaurantId)
      .order("created_at", { ascending: false })
      .limit(n);
    if (status) q = q.eq("status", status);
    if (docType) q = q.eq("doc_type", docType);
    if (documentIds) q = q.in("id", documentIds);

    const { data, error } = await q;
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    return { items: data ?? [] };
  }

  @Get(":id")
  @ApiOperation({ summary: "One document with its lines and linked orders" })
  async detail(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const { data: doc, error } = await this.db
      .getClient()
      .from("procurement_documents")
      .select("*")
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId)
      .maybeSingle();
    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!doc) throw new HttpException("Not found", HttpStatus.NOT_FOUND);

    const [{ data: lines }, { data: links }] = await Promise.all([
      this.db
        .getClient()
        .from("procurement_document_lines")
        .select("*")
        .eq("document_id", id)
        .order("line_no"),
      this.db
        .getClient()
        .from("procurement_document_links")
        .select("*")
        .eq("document_id", id),
    ]);

    // Decision E48 — the receipts page renders the stored photo/PDF beside
    // the extracted lines. storage_path is a private-bucket object path, not
    // a URL, so it needs a short-lived signed URL to be viewable at all.
    // Best-effort: a signing failure must not take down the rest of the
    // document, since the extraction and match evidence do not depend on it.
    // Shared with `GET :id/canonical` so the two panes cannot drift.
    //
    // AND THE REASON TRAVELS WITH IT. This destructured `imageUrl` alone and
    // dropped `reason` on the floor, so "no file was ever stored", "the path is
    // there and signing failed" and "the bucket is unreachable" all reached the
    // screen as the same `null` — the canonical route has carried the reason
    // since slice 2 and this one had not (ADR 0067).
    const { imageUrl, reason: imageUrlReason } = await this.signOriginal(
      doc.storage_path ?? null,
    );

    return {
      document: { ...doc, imageUrl, imageUrlReason },
      lines: lines ?? [],
      links: links ?? [],
    };
  }

  /**
   * The extraction door. Class-level `@UseGuards(JwtAuthGuard)` covers it, and
   * `restaurantId` comes from the token exactly as it does on every sibling
   * route — the id in the path is scoped by it, never trusted on its own.
   */
  @Post(":id/extraction")
  @ApiOperation({
    summary: "Apply an extraction produced outside this gateway",
    description:
      "Fills a document that was stored UNREAD (ADR 0104 D6) with an extraction someone else performed — today, a Claude Code session reading the PDF, because the configured Anthropic key has no credit. The body is the same JSON DocumentExtractorService asks a model for, and it goes through the same `normalize` (validation, tie-out, warnings) that a model's answer does; `model` is recorded verbatim in extraction_model so the row says who read the page. " +
      "409 if the document already has lines or a non-degraded extraction: this door FILLS an unread document and never overwrites a read one, because overwriting would silently discard a manager's corrections. 422 if the body is not the contract's JSON, or carries no lines. Writes no stock, cost or orders — the gateway's own extractor remains the product path.",
  })
  async applyExtraction(
    @Param("id") id: string,
    @Body() body: ApplyExtractionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    let applied: Awaited<
      ReturnType<DocumentIntakeService["applyExternalExtraction"]>
    >;
    try {
      applied = await this.intake.applyExternalExtraction(
        user.restaurantId,
        id,
        body.rawText,
        body.model,
        user.userId,
      );
    } catch (error) {
      const msg: string = error?.message ?? "Failed to apply the extraction";
      if (msg === "NOT_FOUND")
        throw new HttpException("Not found", HttpStatus.NOT_FOUND);
      if (msg.startsWith("ALREADY_READ:"))
        throw new HttpException(msg.slice(13), HttpStatus.CONFLICT);
      if (msg.startsWith("UNPARSABLE:"))
        throw new HttpException(msg.slice(11), HttpStatus.UNPROCESSABLE_ENTITY);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // The document as `GET :id` returns it, read back through that route's own
    // code rather than reassembled here — the two shapes cannot drift if there
    // is only one of them.
    const detail = await this.detail(id, user);
    return {
      ...detail,
      warnings: applied.warnings,
      tieOut: applied.tieOut,
      // Never omitted when it failed: a document whose lines landed and whose
      // revision did not is a different thing from one where both did.
      revision: applied.revision,
    };
  }

  @Post(":id/match")
  @ApiOperation({
    summary: "Pair this document's lines with the lines that were ordered",
    description:
      "Writes only unambiguous matches (exact vendor SKU, no substitution). Everything else comes back under `suggested` for one-tap confirmation and is NOT persisted — a wrong link writes one wine's invoice price onto another wine's cost lot, which looks fine and surfaces months later as margin drift on two products. Lines a human already paired are left alone, so re-running never reverts a correction.",
  })
  async match(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    try {
      return await this.intake.matchDocumentLines(id, user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to match lines",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post(":id/lines/:lineId/link")
  @ApiOperation({
    summary: "Confirm a suggested line pairing",
    description:
      "The human half of line matching. Pass orderLineId to accept a suggestion, or null to unlink one that was wrong. " +
      "The answer is APPENDED, never substituted (ADR 0059): a pairing the machine proposed keeps its proposed_confidence / proposed_method untouched, and this endpoint adds confirmed_by / confirmed_at beside them. " +
      "Only a pairing no machine ever proposed gets match_method 'manual' — there is no proposal there to preserve.",
  })
  async linkLine(
    @Param("id") documentId: string,
    @Param("lineId") lineId: string,
    @Body() body: { orderLineId?: string | null },
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.intake.confirmLineMatch(
        documentId,
        lineId,
        user.restaurantId,
        user.userId,
        body?.orderLineId ?? null,
      );
    } catch (error) {
      if (error?.message === "NOT_FOUND")
        throw new HttpException("Line not found", HttpStatus.NOT_FOUND);
      throw new HttpException(
        error?.message || "Failed to confirm the pairing",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":id/lines/:lineId")
  @ApiOperation({
    summary: "Correct one extracted line by hand",
    description:
      "The receipts brief's editable half (ADR 0045 §5): a manager fixes what the model misread, then confirms. Only a pre-verification document (received / needs_review) may be edited — a verified document is the record a vendor dispute leans on, and there is deliberately no un-verify. Edits are anonymous drafts; provenance is carried by verify, which stamps who confirmed the final transcription. The document's tie-out is recomputed through the same rule extraction uses, so an edit can never leave a stale ties-out claim standing. Note the tie-out arithmetic prefers a line's stated lineTotal over qty × unitPrice — that is the paper's own claim; correcting qty alone moves the tie-out only when the line has no stated total, which is the honest reading, not a bug. qty_bottles is derived and follows qty/packSize corrections automatically unless set explicitly.",
  })
  async editLine(
    @Param("id") documentId: string,
    @Param("lineId") lineId: string,
    @Body()
    body: {
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
    @CurrentUser() user: AuthedUser,
  ) {
    try {
      return await this.intake.editLine(
        documentId,
        lineId,
        user.restaurantId,
        body ?? {},
      );
    } catch (error) {
      const msg: string = error?.message ?? "Failed to edit line";
      if (msg === "NOT_FOUND")
        throw new HttpException(
          "Document or line not found",
          HttpStatus.NOT_FOUND,
        );
      if (msg.startsWith("NOT_EDITABLE:"))
        throw new HttpException(
          `Only a document awaiting review can be edited — this one is ${msg.slice(13)}.`,
          HttpStatus.CONFLICT,
        );
      if (msg.startsWith("BAD_FIELD:") || msg === "EMPTY_PATCH")
        throw new HttpException(msg, HttpStatus.BAD_REQUEST);
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post(":id/verify")
  @ApiOperation({
    summary: "Confirm the extraction is faithful to the paper document",
    description:
      "Records who checked it and when. This asserts only that the transcription is right — it does not accept the charges, apply anything to stock, or settle a discrepancy.",
  })
  async verify(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    const { data, error } = await this.db
      .getClient()
      .from("procurement_documents")
      .update({
        status: "verified",
        // Taken from the token. A reviewer the caller names for itself is not a
        // reviewer, and this record is what a vendor dispute leans on.
        verified_by: user.userId,
        verified_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId)
      .select("id, status, verified_at")
      .maybeSingle();

    if (error)
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    if (!data) throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    return data;
  }
}
