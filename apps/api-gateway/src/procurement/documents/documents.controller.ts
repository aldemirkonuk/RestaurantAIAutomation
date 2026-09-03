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
import { UploadDocumentDto } from "./dto/documents.dto";

type AuthedUser = { userId: string; restaurantId: string };

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
  ) {}

  @Post()
  @ApiOperation({
    summary: "Upload or photograph a vendor document",
    description:
      "Accepts base64 content for a PDF, image or EDI file. Classifies it (invoice / packing slip / credit memo), extracts lines, and stores it for review. Writes no stock, cost or orders. Identical content is deduplicated per restaurant, so the same invoice arriving by email and by photo is one document.",
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

    return {
      documentId: result.documentId,
      duplicate: result.duplicate,
      // The parse is returned so the receiving screen can show what was read
      // immediately, without a second round trip.
      document: result.parsed,
    };
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
    let imageUrl: string | null = null;
    if (doc.storage_path) {
      try {
        const { data: signed } = await this.db
          .getClient()
          .storage.from("vendor-attachments")
          .createSignedUrl(doc.storage_path, 3600);
        imageUrl = signed?.signedUrl ?? null;
      } catch {
        /* best-effort — a missing object just yields no image */
      }
    }

    return {
      document: { ...doc, imageUrl },
      lines: lines ?? [],
      links: links ?? [],
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
        throw new HttpException("Document or line not found", HttpStatus.NOT_FOUND);
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
