import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
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
  @ApiQuery({ name: "limit", required: false })
  async list(
    @CurrentUser() user: AuthedUser,
    @Query("status") status?: string,
    @Query("docType") docType?: string,
    @Query("limit") limit?: string,
  ) {
    const n = Math.min(200, Math.max(1, parseInt(limit ?? "50", 10) || 50));
    let q = this.db
      .getClient()
      .from("procurement_documents")
      .select("*")
      .eq("restaurant_id", user.restaurantId)
      .order("created_at", { ascending: false })
      .limit(n);
    if (status) q = q.eq("status", status);
    if (docType) q = q.eq("doc_type", docType);

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

    return { document: doc, lines: lines ?? [], links: links ?? [] };
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
