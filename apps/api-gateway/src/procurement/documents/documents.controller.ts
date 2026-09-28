import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Logger,
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
import {
  ApplyExtractionDto,
  CorrectFieldDto,
  UploadDocumentDto,
  VerifyFieldDto,
} from "./dto/documents.dto";
import { CanonicalDocumentService } from "../canonical/canonical-document.service";
import { DeliverySpineService } from "../canonical/delivery-spine.service";
import { DocumentCorrectionService } from "../canonical/document-correction.service";
import { createHash } from "node:crypto";
import { looksLikeEdi832 } from "../../distributor-feed/parse-edi832";
import { DISTRIBUTORS } from "../../distributor-feed/distributor-feed.registry";
import { CatalogIngestService } from "../../distributor-feed/catalog-ingest.service";
import { OrganizationsService } from "../../organizations/organizations.service";
import { isIso4217, notACurrencyBecause } from "../../common/iso-4217";
import { documentMoneyState } from "./invoice-currency";
import { DeliveryService } from "../canonical/delivery.service";
import { DeliveryStockService } from "../canonical/delivery-stock.service";
import { LineMappingService } from "../canonical/line-mapping.service";
import { DoorCountDto } from "../dto/deliveries.dto";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import {
  DOCUMENT_SEAL_SUBJECT_KIND,
  DocumentSealAct,
  documentCurrencySealArgs,
  documentLineEditSealArgs,
  documentVerifySealArgs,
} from "./document-seal";

/**
 * The document columns a verify seal is taken over, as ONE literal string.
 *
 * A module-level `const` of literal names IN THIS FILE, rather than an import
 * from `document-seal.ts`: `scripts/check_read_columns_exist.py` resolves a
 * const only within the file that reads it, so an imported list would count as
 * an unreadable read — a `.select()` nobody is checking. `document-seal.spec.ts`
 * asserts that every field the seal functions touch is named here, so the pure
 * module and this list cannot drift apart in silence.
 */
export const DOCUMENT_SEAL_DOC_COLUMNS =
  "id, status, currency, doc_number, doc_date, total, freight, fuel_surcharge, split_case_fee, delivery_fee, deposit_total, tax, other_charges, discount_total";

/** The line columns a verify seal is taken over. See above for why it is here. */
export const DOCUMENT_SEAL_LINE_COLUMNS =
  "id, line_no, qty, uom, pack_size, qty_bottles, free_goods_qty, unit_price, line_total, allowance, description, vintage, vendor_sku";

/**
 * `fullName`, `name` and `email` are read for ONE purpose: an admitted class-C
 * price names the person who handed the catalogue over, as the session named
 * them. All three optional because a token that carries none of them is a real
 * state, and the row then says the name is unknown rather than inventing one.
 *
 * `name` IS THE FIELD THE SESSION ACTUALLY HAS, and it was missing from this
 * type until 2026-09-06. `JwtStrategy.validate` (`auth/strategies/
 * jwt.strategy.ts:55-69`) returns `{ userId, email, name, role, restaurantId,
 * … }` and sets no `fullName` anywhere in this gateway, so `uploadedByName`
 * below carried the uploader's EMAIL ADDRESS while claiming to be a name —
 * silently, because the fallback made it look deliberate. The same defect was
 * measured and fixed on `distributor-feed.controller.ts` on 2026-09-05 and
 * named there as still open here (ADR 0126 §7); this is that one line.
 */
type AuthedUser = {
  userId: string;
  restaurantId: string;
  fullName?: string;
  name?: string;
  email?: string;
};

/** The house shape (`procurement.service.ts`, `vendor-intel.controller.ts`). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A path param that is not a uuid is the CALLER'S mistake, and it is caught
 * here rather than by Postgres.
 *
 * Every `:id` and `:lineId` on this controller lands in a `uuid` column. Passed
 * a malformed one, PostgREST answers `22P02 invalid input syntax for type uuid`,
 * the route's catch-all turns that into a 500, and the caller is told the server
 * broke when nothing did. Measured on the slice 4 live re-drive against
 * `…/lines/:lineId/link-item`, and its `link`, `PATCH lines/:lineId` and
 * `line-mappings` siblings all carried the same hole.
 *
 * This runs BEFORE the handler's `try`, so the 400 cannot be re-wrapped as a
 * 500 by the catch that exists for real failures.
 */
function requireUuid(value: string, label: string): void {
  if (typeof value === "string" && UUID_RE.test(value)) return;
  throw new HttpException(
    `The ${label} in this address is not an id we can read: "${value}".`,
    HttpStatus.BAD_REQUEST,
  );
}

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
  private readonly logger = new Logger(DocumentsController.name);

  constructor(
    private readonly intake: DocumentIntakeService,
    private readonly db: DatabaseService,
    private readonly canonical: CanonicalDocumentService,
    private readonly spine: DeliverySpineService,
    private readonly corrections: DocumentCorrectionService,
    private readonly catalogIngest: CatalogIngestService,
    // WHO the caller is AT THIS HOUSE, for the deliberate currency change
    // (founder, 2026-09-06). `OrganizationsModule` is already a
    // `ProcurementModule` import for the approval gate, so this adds no edge to
    // the module graph and no `forwardRef`.
    private readonly organizations: OrganizationsService,
    private readonly deliveries: DeliveryService,
    private readonly deliveryStock: DeliveryStockService,
    private readonly mapping: LineMappingService,
    // THE SEAL ON THE THREE WRITE ACTS (founder, 2026-09-06, batch 64:
    // "Decide as a module: seal all three"). `SealModule` is already a
    // `ProcurementModule` import for the order seal, so this adds no edge to
    // the module graph. See `document-seal.ts` for what each act binds.
    private readonly seals: SealChallengeService,
  ) {}

  /**
   * Redeem the seal one of the three sealed acts has to carry back, or refuse in
   * the seal's own words.
   *
   * ONE HELPER, THREE ACTS, and the shape is `payment-methods.controller.ts`'s
   * `assertSealed` deliberately: a second policy for redeeming is a second
   * opinion about what "exactly once" means.
   *
   * AN ABSENT SEAL IS REFUSED BEFORE THE DOCUMENT IS READ. `readArgs` is only
   * called when a token was actually sent. Reading first would answer a caller
   * with no seal with whatever the read said — when the table is unreachable,
   * that is a 500 about Postgres rather than the sentence telling them to begin
   * the hold, and when the document is another house's it is a 404 that leaks
   * nothing but teaches nothing either. The cheap, certain refusal comes first.
   */
  private async assertSealed(
    user: AuthedUser,
    documentId: string,
    act: DocumentSealAct,
    challenge: string | undefined,
    readArgs: () => Promise<Record<string, unknown>>,
  ): Promise<void> {
    const present = (challenge ?? "").trim().length > 0;
    const args = present ? await readArgs() : {};
    await this.seals.redeem({
      restaurantId: user.restaurantId,
      actorUserId: user.userId,
      subjectKind: DOCUMENT_SEAL_SUBJECT_KIND,
      subjectId: documentId,
      action: act,
      args,
      challenge: challenge ?? null,
    });
  }

  /**
   * Mint the seal for one act on one document, at the moment the gesture BEGINS.
   *
   * The three mint routes below all land here. A token fetched at the moment of
   * the write would be one more thing the same request asked for itself, which
   * is the assertion model with extra steps (founder, 2026-09-04; ADR 0116
   * addendum) — so the pages call these when the hold STARTS, and
   * `HoldToApprove`/`SwipeToConfirm`'s `onChallenge` is what guarantees it.
   */
  private async mintSeal(
    user: AuthedUser,
    documentId: string,
    act: DocumentSealAct,
    args: Record<string, unknown>,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    const issued = await this.seals.issue({
      restaurantId: user.restaurantId,
      actorUserId: user.userId,
      subjectKind: DOCUMENT_SEAL_SUBJECT_KIND,
      subjectId: documentId,
      action: act,
      args,
    });
    return {
      challenge: issued.challenge,
      expiresAt: issued.expiresAt,
      act: issued.action,
    };
  }

  /**
   * The facts a VERIFY seal is taken over: the whole transcription.
   *
   * ONE READER, used by the mint and by the redemption. Two readers is how issue
   * and redemption learn to disagree, and the disagreement would surface as a
   * refusal nobody could explain.
   *
   * A FAILED READ IS NEVER AN EMPTY ONE (ADR 0067). supabase-js resolves
   * `{ data, error }` and never throws, so an outage here would otherwise hash
   * "a document with no lines" — and a seal minted over that would be redeemable
   * against a document whose lines had simply not loaded.
   */
  private async readVerifySealArgs(
    documentId: string,
    restaurantId: string,
  ): Promise<Record<string, unknown>> {
    const client = this.db.getClient();
    const { data: doc, error: docError } = await client
      .from("procurement_documents")
      .select(DOCUMENT_SEAL_DOC_COLUMNS)
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (docError)
      throw new HttpException(
        `This document could not be read, so nothing was sealed and nothing was changed: ${docError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    if (!doc) throw new HttpException("Not found", HttpStatus.NOT_FOUND);

    const { data: lines, error: linesError } = await client
      .from("procurement_document_lines")
      .select(DOCUMENT_SEAL_LINE_COLUMNS)
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId);
    if (linesError)
      throw new HttpException(
        `This document's lines could not be read, so nothing was sealed and nothing was changed: ${linesError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

    return documentVerifySealArgs(
      doc as Record<string, unknown>,
      (lines ?? []) as Record<string, unknown>[],
    );
  }

  /**
   * The facts a LINE EDIT seal is taken over: the document's status, the line as
   * it stands, and the correction about to be written to it.
   *
   * The PATCH comes from the caller at both ends and is canonicalised by
   * `documentLineEditSealArgs`, so the mint and the write have to name the same
   * correction. Everything else is read here.
   */
  private async readLineEditSealArgs(
    documentId: string,
    lineId: string,
    restaurantId: string,
    patch: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown>> {
    const client = this.db.getClient();
    const { data: doc, error: docError } = await client
      .from("procurement_documents")
      .select("id, status")
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (docError)
      throw new HttpException(
        `This document could not be read, so nothing was sealed and nothing was changed: ${docError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    if (!doc) throw new HttpException("Not found", HttpStatus.NOT_FOUND);

    const { data: line, error: lineError } = await client
      .from("procurement_document_lines")
      .select(DOCUMENT_SEAL_LINE_COLUMNS)
      .eq("id", lineId)
      .eq("document_id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (lineError)
      throw new HttpException(
        `This line could not be read, so nothing was sealed and nothing was changed: ${lineError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

    return documentLineEditSealArgs({
      documentId,
      lineId,
      status: (doc as { status?: unknown }).status ?? null,
      line: (line as Record<string, unknown> | null) ?? null,
      patch,
    });
  }

  /**
   * The facts a CURRENCY RESTATEMENT seal is taken over: the code the document
   * carries NOW, the code being written, and the document's status.
   */
  private async readCurrencySealArgs(
    documentId: string,
    restaurantId: string,
    next: string,
  ): Promise<Record<string, unknown>> {
    const { data: doc, error } = await this.db
      .getClient()
      .from("procurement_documents")
      .select("id, status, currency")
      .eq("id", documentId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error)
      throw new HttpException(
        `This document could not be read, so nothing was sealed and nothing was changed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    if (!doc) throw new HttpException("Not found", HttpStatus.NOT_FOUND);
    return documentCurrencySealArgs({
      documentId,
      status: (doc as { status?: unknown }).status ?? null,
      previous: (doc as { currency?: string | null }).currency ?? null,
      next,
    });
  }

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

    const [{ data: row, error: rowErr }, spine, log] = await Promise.all([
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
      this.corrections.correctionLog(user.restaurantId, id),
    ]);

    const failedRead: string[] = [];
    if (rowErr) failedRead.push(`document metadata: ${rowErr.message}`);
    if (!spine.ok) failedRead.push(spine.error);
    if (!log.ok) failedRead.push(log.error);

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
      /**
       * ADR 0104 D5. NULL means the log could not be read and `failedRead` says
       * so; `[]` means the reads succeeded and nobody has corrected or verified
       * a field on this document. Collapsing the two would let a broken query
       * render as "this document has never been touched", which is the sentence
       * a vendor dispute gets argued from.
       */
      corrections: log.ok ? log.value : null,
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

  /**
   * Correct one layer-1 field (ADR 0104 D5).
   *
   * NOT AN EDIT. Layer 1 is append-only: this writes revision n+1 carrying the
   * whole corrected document and an audit row saying who changed what, from
   * what, to what and why. Both tables refuse UPDATE and DELETE by trigger, so
   * a correction can be superseded but never rewritten.
   *
   * Class-level `@UseGuards(JwtAuthGuard)` covers it; `restaurantId` comes from
   * the token and scopes the document read, so another tenant's id is a 404.
   */
  @Post(":id/corrections")
  @ApiOperation({
    summary: "Correct one field of the canonical document (ADR 0104 D5)",
    description:
      "Appends a new revision and an append-only correction row. The corrected value is replayed through the same mapper the read path uses, so the bottle-equivalent, the tie-out and every EN 16931 invariant follow it — a correction is never a cosmetic overlay. 400 names the field when the path is not in the closed correctable list; 409 means another correction landed first and nothing was written.",
  })
  async correctField(
    @Param("id") id: string,
    @Body() body: CorrectFieldDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const result = await this.corrections.correct(
      user.restaurantId,
      id,
      user.userId,
      { path: body.path, value: body.value ?? null, reason: body.reason },
    );
    if (!result.ok) throw new HttpException(result.error, result.status);
    return result.value;
  }

  /**
   * The per-field `verified_by` tick (ADR 0104 D5).
   *
   * A human standing behind a value they did NOT change. The field's `source`
   * stays whatever it was — an extracted number that a manager confirmed is
   * still an extracted number, now with a name against it.
   */
  @Post(":id/fields/verify")
  @ApiOperation({
    summary: "Tick one field as verified by a human (ADR 0104 D5)",
    description:
      "Records `verified_by` and `verified_at` on one field's envelope as a new revision, with an append-only row of kind `verification`. The value and its `source` are unchanged.",
  })
  async verifyFieldTick(
    @Param("id") id: string,
    @Body() body: VerifyFieldDto,
    @CurrentUser() user: AuthedUser,
  ) {
    const result = await this.corrections.verifyField(
      user.restaurantId,
      id,
      user.userId,
      { path: body.path },
    );
    if (!result.ok) throw new HttpException(result.error, result.status);
    return result.value;
  }

  /**
   * THE DOOR COUNT — a document we AUTHOR (ADR 0104 D2/D11, ADR 0103 A6).
   *
   * `POST /procurement/documents` reads a document somebody else wrote. This one
   * records what a person at the door SAYS they counted: `doc_type
   * receiving_advice`, `source manual`, `direction issued_by_us`, explicit lines,
   * an optional photograph as evidence, and no extraction at all — so
   * `extraction_confidence` is NULL rather than 0.
   *
   * WHY IT IS ITS OWN ROUTE AND NOT A BRANCH INSIDE THE UPLOAD DOOR. The upload
   * door's whole contract is "here are bytes, tell me what they say". A count
   * has no bytes to read and nothing to be confident about; folding it in would
   * have made `contentBase64` optional on a route whose only job is to receive
   * it, and every reader would then have to work out which kind of document a
   * given request was. The two doors are different sentences, so they are
   * different routes.
   *
   * A LINE NOBODY COUNTED IS ABSENT, NOT ZERO. There is no `notCounted` flag:
   * the lines somebody counted are submitted and the rest keep the canonical
   * `not counted` they already carry (ADR 0103 A6).
   */
  @Post("door-count")
  @ApiOperation({
    summary:
      "Record a door count as a receiving_advice document (ADR 0104 D11)",
    description:
      "Writes the count as OUR document, with the lines somebody actually counted and, optionally, one photograph as evidence. `createDelivery` makes the commercial event in the same call and attaches the count to it with the `door_count` role; `deliveryId` attaches it to an existing one. Nothing here writes stock — a count is a record (ADR 0078), not a booking.",
  })
  async doorCount(@Body() body: DoorCountDto, @CurrentUser() user: AuthedUser) {
    let photo: {
      bytes: Buffer;
      filename: string | null;
      mimeType: string | null;
    } | null = null;
    if (body.photoBase64) {
      let bytes: Buffer;
      try {
        bytes = Buffer.from(body.photoBase64, "base64");
      } catch {
        throw new HttpException(
          "photoBase64 is not valid base64",
          HttpStatus.BAD_REQUEST,
        );
      }
      if (!bytes.length)
        throw new HttpException(
          "photoBase64 decoded to no bytes. Send a photograph or send none — an empty one is a failed upload wearing the shape of evidence.",
          HttpStatus.BAD_REQUEST,
        );
      photo = {
        bytes,
        filename: body.photoFilename ?? null,
        mimeType: body.photoMimeType ?? null,
      };
    }

    const result = await this.intake.recordDoorCount({
      restaurantId: user.restaurantId,
      providerId: body.providerId ?? null,
      countedBy: user.userId,
      countedAt: body.countedAt ?? null,
      lines: body.lines,
      signedBy: body.signedBy ?? null,
      note: body.note ?? null,
      photo,
    });
    /**
     * THE SAME COUNT TWICE IS A CONFLICT, AND IT NAMES THE DOCUMENT.
     *
     * 409, not 422. 422 says "I understood the request and cannot process this
     * content" — but the content is fine; it is the SECOND request for a state
     * that already exists, which is what 409 is for, and it lets a caller tell
     * "you already recorded this" from "your body is wrong" without parsing
     * prose. The document id travels in the message and in `documentId`, so the
     * receiver is taken to the count rather than told to type it again.
     */
    if (result.duplicate && result.documentId)
      throw new HttpException(
        `This count was already recorded as document ${result.documentId}. A re-count at a different moment is a different document — change the time it was counted, or open the one that exists.`,
        HttpStatus.CONFLICT,
      );
    if (result.error || !result.documentId)
      throw new HttpException(
        result.error ?? "the door count could not be recorded",
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    let delivery: unknown = null;
    let differsOnLines: number | null = null;
    let deliveryId: string | null = null;
    if (body.deliveryId) {
      const linked = await this.deliveries.linkDocument(
        user.restaurantId,
        body.deliveryId,
        result.documentId,
        "door_count",
      );
      if (!linked.ok)
        throw new HttpException(
          // The COUNT landed. Saying "the door count failed" would send a
          // receiver to type it again on top of a document that already exists.
          `The door count was recorded as ${result.documentId} but could not be attached to delivery ${body.deliveryId}: ${linked.error}`,
          linked.status,
        );
      delivery = linked.value.delivery;
      deliveryId = body.deliveryId;
    } else if (body.createDelivery) {
      const created = await this.deliveries.create(
        user.restaurantId,
        user.userId,
        {
          orderId: body.orderId ?? null,
          providerId: body.providerId ?? null,
          jurisdiction: body.jurisdiction ?? null,
          deliveredAt: body.countedAt ?? null,
          documents: [{ documentId: result.documentId, role: "door_count" }],
        },
      );
      if (!created.ok)
        throw new HttpException(
          `The door count was recorded as ${result.documentId} but the delivery could not be created: ${created.error}`,
          created.status,
        );
      delivery = created.value.delivery;
      differsOnLines = created.value.differsOnLines;
      deliveryId = created.value.delivery.id;
    }

    /**
     * STOCK IS BOOKED AT THE DOOR (ADR 0103 A1 / A5).
     *
     * The bottles are on the shelf and the staff can pour them; what nobody has
     * yet is a price, so the lots are `cost_state = provisional` and carry NO
     * unit cost — absent, never zero. Verification settles the cost later.
     *
     * A count with no delivery books nothing, and that is not a silent skip:
     * `booking` is null and the caller can see that the count was recorded as a
     * document without becoming stock. A line that names no item comes back in
     * `booking.notBooked` with its reason rather than being guessed onto a
     * shelf by its description.
     */
    let booking: unknown = null;
    if (deliveryId) {
      const booked = await this.deliveryStock.bookAtTheDoor(
        user.restaurantId,
        deliveryId,
        result.documentId,
        user.userId,
      );
      /**
       * A FAILED BOOKING DOES NOT FAIL THE COUNT — AND IS NOT HIDDEN EITHER.
       *
       * Measured live on 2026-09-06 against a database that did not yet carry
       * this stop's migration: the booking read failed, the endpoint answered
       * 500, and the response carried no `deliveryId` — although the count AND
       * the delivery were both already durable. The receiver's only move is to
       * press the button again, which then 409s on the content hash. The door's
       * whole promise is that one tap in a stairwell succeeds.
       *
       * So the count is 201 with the ids, and the booking's failure travels in
       * the receipt: `failed: true`, `bottlesMoved: 0`, and the reason in words.
       * That is the opposite of a silent success — a caller reading `booking`
       * at all sees the failure, and one ignoring it sees zero bottles moved,
       * never a number that did not happen.
       */
      booking = booked.ok
        ? booked.value
        : {
            failed: true,
            deliveryId,
            documentId: result.documentId,
            booked: [],
            notBooked: [],
            bottlesMoved: 0,
            error: booked.error,
          };
      if (!booked.ok)
        this.logger.error(
          `door count ${result.documentId} was recorded and attached to delivery ${deliveryId} but booked no stock: ${booked.error}`,
        );
    }

    return {
      documentId: result.documentId,
      document: result.parsed,
      delivery,
      // NULL = the count is a document and nothing more: no delivery, so no
      // stock. Never an empty booking receipt, which would read as "booked
      // nothing" (ADR 0103 A6).
      booking,
      // NULL = no comparison was possible (no order, or the read failed).
      // 0 = compared, and nothing differed. The two are never the same answer.
      differsOnLines,
      ...(result.storageError ? { storageError: result.storageError } : {}),
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
      // `fullName ?? name ?? email`, in that order: `fullName` stays first in
      // case a future strategy sets it, `name` is what resolves today, and the
      // email is the last resort rather than the first answer. A session with
      // none of the three stays `null`, which the row reads as "unknown" — an
      // absent name is never filled in with a placeholder.
      uploadedByName:
        (user.fullName ?? user.name ?? user.email ?? "").trim() || null,
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

    /*
     * B4 — THE INVOICE AND ITS ORDER, SIDE BY SIDE (founder, 2026-09-06 batch
     * 65: *"we will have time To make sure that the invoice is good with the
     * order we had"*).
     *
     * Two derived fields per document, computed HERE rather than in the client:
     *
     *   `moneyState` — whether this document's money is filed, and the sentence
     *     saying why not. `documentMoneyState` is the same function
     *     `verifyReceipt` refuses a price with, so the screen and the gate
     *     cannot disagree about whether a document is held. A second
     *     implementation of that verdict in the browser is how a page comes to
     *     show an enabled field the server will reject.
     *
     *   `orderCurrency` — what the order this document is filed against was
     *     PLACED in, so a reconciliation screen can print it beside the
     *     invoice's own. NOTHING IS CONVERTED and nothing is judged here: the
     *     two codes are handed over as they are, and a screen that shows them
     *     differing has said the useful thing.
     *
     * Only present when the caller asked for one order's documents. Reading an
     * order per row on an unfiltered list would be a query per document for a
     * comparison nothing on that screen makes.
     */
    const items = (data ?? []).map((row) => ({
      ...(row as Record<string, unknown>),
      moneyState: documentMoneyState(
        row as { currency?: string | null; extracted?: unknown },
      ),
    }));

    if (!orderId) return { items };

    const { data: order, error: orderError } = await this.db
      .getClient()
      .from("procurement_orders")
      .select("order_number, currency, currency_source")
      .eq("id", orderId)
      .eq("restaurant_id", user.restaurantId)
      .maybeSingle();
    // A FAILED READ IS NOT AN ORDER WITHOUT A CURRENCY (ADR 0067). The screen
    // must not print "the order names no currency" because the read broke, so
    // the failure is named and the comparison says it could not be made.
    if (orderError)
      return {
        items,
        order: {
          id: orderId,
          currency: null,
          currencySource: null,
          orderNumber: null,
          failure: `The order's own currency could not be read (${orderError.message}), so the invoice cannot be compared against it here. That is a failed read, not an order without a currency.`,
        },
      };

    const orderRow = order as {
      order_number?: string | null;
      currency?: string | null;
      currency_source?: string | null;
    } | null;
    return {
      items,
      order: {
        id: orderId,
        currency: orderRow?.currency ?? null,
        currencySource: orderRow?.currency_source ?? null,
        orderNumber: orderRow?.order_number ?? null,
        failure: null,
      },
    };
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

  @Post(":id/lines/:lineId/link-item")
  @ApiOperation({
    summary: "Link this line to a shelf, and remember the pairing for this vendor",
    description:
      "ADR 0104 D12 slice 4. A person names the restaurant item this line is about; the line carries it from then on (`procurement_document_lines.inventory_id`), which is what lets a VERIFIED delivery finalise the cost for that item (ADR 0103 A1/A12). " +
      "The act is also APPENDED to the mapping memory, so the next document from the same vendor carries the shelf as a PROPOSAL — a tick a person gives, never a booking and never a number. " +
      "`source` says whether the person accepted what the memory proposed (`remembered`) or chose the shelf themselves (`chosen`). " +
      "Pass `inventoryId: null` for \"not this one\": the line is cleared AND the memory FORGETS the pairing — it is not averaged away, it is gone, because a majority of wrong ticks is still the wrong shelf. " +
      "Nothing here books stock or writes a cost.",
  })
  async linkLineToItem(
    @Param("id") documentId: string,
    @Param("lineId") lineId: string,
    @Body() body: { inventoryId?: string | null; source?: "chosen" | "remembered" },
    @CurrentUser() user: AuthedUser,
  ) {
    requireUuid(documentId, "document id");
    requireUuid(lineId, "line id");
    try {
      return await this.mapping.linkLineToItem({
        documentId,
        lineId,
        restaurantId: user.restaurantId,
        userId: user.userId,
        inventoryId: body?.inventoryId ?? null,
        // Default `chosen`: claiming a person merely confirmed what we proposed,
        // when we do not know that, would overstate the memory's own record.
        source: body?.source === "remembered" ? "remembered" : "chosen",
      });
    } catch (error) {
      const msg: string = error?.message ?? "Failed to link the line to an item";
      if (msg === "NOT_FOUND")
        throw new HttpException(
          "Document or line not found",
          HttpStatus.NOT_FOUND,
        );
      if (msg === "ITEM_NOT_FOUND")
        throw new HttpException(
          "That item does not belong to this restaurant, so the line was not linked.",
          HttpStatus.NOT_FOUND,
        );
      throw new HttpException(msg, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(":id/line-mappings")
  @ApiOperation({
    summary: "Who linked which line to which shelf on this document, and when",
    description:
      "The append-only log behind the mapping memory (ADR 0104 D5/D12). Newest first. An `unlinked` row is a person saying \"not this one\" — a real act, kept, not a gap.",
  })
  async lineMappings(@Param("id") id: string, @CurrentUser() user: AuthedUser) {
    requireUuid(id, "document id");
    const log = await this.mapping.logFor(id, user.restaurantId);
    // A failed read is not an empty log (ADR 0067).
    if (!log.ok)
      throw new HttpException(log.error, HttpStatus.INTERNAL_SERVER_ERROR);
    return { entries: log.value };
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
    requireUuid(documentId, "document id");
    requireUuid(lineId, "line id");
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

  /**
   * Begin the hold on a line correction. Returns a one-time seal, once.
   *
   * THE PATCH IS IN THE BODY HERE TOO, and that is the point rather than an
   * inconvenience: the seal is taken over the correction about to be made, so a
   * token obtained for "qty 12" cannot be spent to write 120. The page sends the
   * same patch to both routes; anything else refuses with "This document changed
   * after the seal was issued".
   */
  @Post(":id/lines/:lineId/edit-seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal a line correction has to carry back",
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act` — the act is `line_edit`, so this token cannot be spent on `POST :id/verify` or `PATCH :id/currency`. It is bound to this actor, this document, this line AS IT STANDS and this exact patch: a second manager's correction landing in between refuses it.",
  })
  async mintLineEditSeal(
    @Param("id") documentId: string,
    @Param("lineId") lineId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthedUser,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    return this.mintSeal(
      user,
      documentId,
      "line_edit",
      await this.readLineEditSealArgs(
        documentId,
        lineId,
        user.restaurantId,
        body ?? {},
      ),
    );
  }

  @Patch(":id/lines/:lineId")
  @ApiOperation({
    summary: "Correct one extracted line by hand, behind a redeemed seal",
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
    // The seal travels in the SAME header as the order and payment writes, so a
    // caller has one thing to learn and the acts cannot be confused by shape —
    // only by the act the token was minted for, which the seal service compares.
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    requireUuid(documentId, "document id");
    requireUuid(lineId, "line id");
    // BEFORE the write, and outside the try/catch below: a refused seal is a
    // 403 with a whole sentence, and this method's catch turns unknown messages
    // into 500s. It is deliberately NOT wrapped.
    await this.assertSealed(user, documentId, "line_edit", challenge, () =>
      this.readLineEditSealArgs(
        documentId,
        lineId,
        user.restaurantId,
        (body ?? {}) as Record<string, unknown>,
      ),
    );

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

  /**
   * RULE 3 — the house deliberately changes an invoice's currency.
   *
   * Founder, 2026-09-06 (batch 63): *"take the houses own currency, but AI needs
   * to or otherwise house delibaretly chnage it to other currency if the invoice
   * is other than their default"*. Rules 1 and 2 (`invoice-currency.ts`) file an
   * invoice's money under the document's own currency, or the house's, or
   * WITHHOLD it — refused when neither states one, held when the model saw a
   * different one. This is the door out of both.
   *
   * WHAT IT DOES
   *   1. Refuses anyone who is not a manager or an owner here, in a sentence
   *      that names what they are and who can do it. Staff are DISABLED with the
   *      sentence on the page, never shown a button that fails.
   *   2. Writes the audit row FIRST — who, when, the previous value, the
   *      document's status at the time, and what the re-filing is about to
   *      move. If the log cannot be written the currency is not changed:
   *      a restatement nobody recorded is exactly what this rule exists to stop.
   *   3. Re-files the money off `procurement_documents.extracted` — the whole
   *      parse, kept precisely so a held document does not have to be uploaded
   *      again — and says what moved.
   *
   * SEALED SINCE 2026-09-06 (batch 64), AND THE QUESTION BELOW IS WHY.
   *
   * This docblock used to end "NOT SEALED, DELIBERATELY", on the grounds that
   * sealing one route inside an unsealed corridor *"would read as a policy while
   * leaving the other six non-GET routes on this controller open"*, and that
   * whether procurement as a whole should be sealed was a founder question
   * rather than a decision to take one route at a time. It was put to the
   * founder and the answer was **"Decide as a module: seal all three"** — verify,
   * line edit and currency restatement, each taking a redeemed seal like the
   * payment and register acts do. So the gate here is now role, PLUS a
   * one-time seal bound to this document and to the pair of codes
   * (`document-seal.ts`), PLUS the append-only log.
   *
   * The rest of the controller is still unsealed and is meant to be visible as
   * such: `scripts/check_money_routes_are_sealed.py` prints every write route on
   * this file that no census names, rather than passing over it in silence.
   *
   * A VERIFIED DOCUMENT MAY STILL BE RESTATED, unlike a line edit
   * (`PATCH :id/lines/:lineId` refuses anything past review). The two are not
   * the same act: an edit changes what the paper is claimed to SAY, and a
   * verified document is the transcription somebody stood behind; this changes
   * what its figures are DENOMINATED IN, which is a fact about the vendor that
   * a verification never asserted. The status at the time is written to the log
   * so a restatement after verification is legible as one.
   */
  /**
   * Begin the hold on a restatement. Returns a one-time seal, once.
   *
   * EVERYTHING THAT WOULD REFUSE THE WRITE REFUSES THE SEAL FIRST — the currency
   * has to be a real ISO 4217 code and the caller has to be a manager or an
   * owner here, checked in the same words as below. A manager handed a seal that
   * is going to be refused a second and a half later learns that the seal is
   * decoration.
   */
  @Post(":id/currency-seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal a currency restatement has to carry back",
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act` — the act is `currency_restate`. Bound to this actor, this document, the code being written AND the code the document carries now, so a seal minted to move a held invoice to EUR cannot be spent after somebody else filed it in USD. Refused with the same sentences the write gives: a code that is not a currency is a 400, a caller who is not a manager or an owner is a 403.",
  })
  async mintCurrencySeal(
    @Param("id") id: string,
    @Body() body: { currency?: string },
    @CurrentUser() user: AuthedUser,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    const next = String(body?.currency ?? "")
      .trim()
      .toUpperCase();
    if (!isIso4217(next))
      throw new HttpException(
        `${notACurrencyBecause(body?.currency)} Nothing was sealed and nothing was changed: a seal names the act it approves, and there is no act here to approve.`,
        HttpStatus.BAD_REQUEST,
      );
    await this.assertMayRestateCurrency(user);
    return this.mintSeal(
      user,
      id,
      "currency_restate",
      await this.readCurrencySealArgs(id, user.restaurantId, next),
    );
  }

  /**
   * MAY THIS PERSON RESTATE A CURRENCY HERE — asked twice, in one place.
   *
   * The role is asserted when the seal is ISSUED and again when the write
   * arrives, so a manager demoted between the two cannot spend a token they were
   * legitimately given (the rule `payment-methods.controller.ts` states for the
   * same reason). The sentence is this route's own, because
   * `assertCanManageRestaurant`'s does not say what the caller IS, that nothing
   * was written, or what to do next.
   */
  private async assertMayRestateCurrency(user: AuthedUser): Promise<string | null> {
    // WHO THIS PERSON IS HERE. `null` means "not proven to hold any role" —
    // a read that failed and a person with no row are indistinguishable at this
    // layer, and neither may pass (`order-approval-gate.ts`'s header).
    const role = await this.organizations.resolveRestaurantRole(
      user.userId,
      user.restaurantId,
    );
    try {
      await this.organizations.assertCanManageRestaurant(
        user.userId,
        user.restaurantId,
        "restate an invoice's currency",
      );
    } catch {
      throw new HttpException(
        `Restating an invoice's currency re-files its money, so it is a manager's or an owner's decision. ` +
          `${role ? `You are signed in as ${role} at this house` : "This session could not be shown to hold any role at this house"}, so nothing was changed. Ask a manager or an owner to restate it.`,
        HttpStatus.FORBIDDEN,
      );
    }
    return role;
  }

  @Patch(":id/currency")
  @ApiOperation({
    summary:
      "Restate what currency this invoice's money is in, behind a redeemed seal",
    description:
      "The house's deliberate change (founder, 2026-09-06). Managers and owners only; staff are refused in words. Takes a one-time seal in `X-Seal-Challenge`, minted by `POST :id/currency-seal-challenge` when the hold begins and redeemed exactly once here. Writes an append-only row naming who, when and the previous value, then re-files the document's money — including money rules 1 and 2 withheld — under the currency named, and returns a sentence saying what moved. NOTHING IS CONVERTED: there is no exchange rate in this system, so the vendor's own figures are restored and only their denomination changes.",
  })
  async restateCurrency(
    @Param("id") id: string,
    @Body() body: { currency?: string; reason?: string },
    @CurrentUser() user: AuthedUser,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    /*
     * MEMBERSHIP, NOT SHAPE. This route used to ask `/^[A-Z]{3}$/`, so
     * `PATCH :id/currency` with `"ZZZ"` re-filed a whole invoice's money under
     * a denomination that does not exist — and wrote an append-only audit row
     * saying a manager had decided it. `common/iso-4217.ts` holds the list and
     * is mirrored against the web's own picker by a spec.
     */
    const next = String(body?.currency ?? "").trim().toUpperCase();
    if (!isIso4217(next))
      throw new HttpException(
        `${notACurrencyBecause(body?.currency)} Nothing was changed: this route re-files an invoice's money under the code it is given, and money cannot be denominated in something that is not a currency.`,
        HttpStatus.BAD_REQUEST,
      );

    /*
     * ROLE FIRST, THEN THE SEAL.
     *
     * `assertMayRestateCurrency` is ONE implementation of "may this person
     * manage this house" (`assertCanManageRestaurant`, the same helper
     * `settings.controller.ts` and `mcp-connections` call) with this route's own
     * sentence around it, and it is the same call the MINT makes — so the role
     * is asserted when the seal is issued and again here, and a manager demoted
     * in between cannot spend a token they were legitimately given.
     *
     * `role` comes back for the AUDIT ROW, which records what the actor was.
     * `null` means "not proven to hold any role" — a read that failed and a
     * person with no row are indistinguishable at this layer, and neither may
     * pass (`order-approval-gate.ts`'s header).
     *
     * The order matters: a person who may not restate anything is told so,
     * rather than being told their seal is wrong.
     */
    const role = await this.assertMayRestateCurrency(user);

    // THE SEAL, before the log and before the write. A restatement is a
    // manager's own act on the record a vendor dispute leans on, and a role
    // check answers "may this role" and cannot answer "did a person".
    await this.assertSealed(user, id, "currency_restate", challenge, () =>
      this.readCurrencySealArgs(id, user.restaurantId, next),
    );

    const { data: doc, error: readError } = await this.db
      .getClient()
      .from("procurement_documents")
      .select("id, restaurant_id, currency, status, extracted, total")
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId)
      .maybeSingle();
    // A FAILED READ IS NEVER AN EMPTY ONE (ADR 0067): supabase-js resolves
    // `{ data, error }` and never throws, so without this the outage and the
    // missing document both become "Not found".
    if (readError)
      throw new HttpException(
        `This document could not be read, so nothing was changed: ${readError.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    if (!doc) throw new HttpException("Not found", HttpStatus.NOT_FOUND);

    const previous = (doc as { currency?: string | null }).currency ?? null;

    /*
     * RESTATE, OR CONFIRM. The founder added the second one on 2026-09-06 (batch
     * 64): *"let them approve if otherwise"*.
     *
     * Until then `previous === next` was a 409 — right for a page with a sticky
     * button, wrong for the act the receiving refusal now depends on. Item A
     * refuses a keyed-in unit price for a document whose money is not filed, and
     * the act that clears it is a manager saying which currency is right,
     * INCLUDING when the right one is the one the document already carries. A
     * manager who reads a held invoice, sees the model misread a glyph and says
     * "no, USD is correct" has made a decision; under the old rule that decision
     * was an error message, and the only way out was to name a currency they did
     * not believe in.
     *
     * The distinction is RECORDED rather than inferred. `change_kind` is written
     * on the audit row and the database refuses the two lies it could tell — a
     * confirmation whose codes differ, and a restatement that restates nothing
     * (`20260906180000`).
     *
     * A no-op is still refused where it is genuinely a no-op: a document whose
     * currency is NOT RECORDED cannot be "confirmed" as anything, because there
     * is nothing there to agree with — that is a restatement from nothing, and
     * it is what the `previous === null` branch below produces.
     */
    const kind: "restated" | "confirmed" =
      previous !== null && previous === next ? "confirmed" : "restated";

    /*
     * WHAT THE RE-FILING WILL MOVE, computed but NOT written here.
     *
     * The WRITE of `computed_lines_total`, `tie_out_delta` and `ties_out`
     * belongs to `DocumentIntakeService` — they are the machine's own proposal
     * about this document and ADR 0059's rule is that a proposal is written by
     * the thing that proposed it, with a human's answer appended rather than
     * substituted. `scripts/check_proposal_preservation.py` names that file as
     * their declared writer and FAILED this route when it wrote them itself.
     *
     * `planRefileForCurrency` is READ-ONLY and lives on the intake service for
     * the same reason: it reads the document's CURRENT lines and decides which
     * reading a re-filing will use, and a second copy of that decision here is
     * how the log comes to describe a re-filing different from the one that
     * happens. The log is written BEFORE the change lands, so it has to be
     * asked first.
     *
     * IT NAMES ITS SOURCE, and that is BLOCKER 2's other half. Until 2026-09-06
     * this preview read `procurement_documents.extracted` — the parse as it was
     * at intake, which `editLine` never updates — so a hand-corrected line was
     * reverted by a restatement and the audit row recorded the reverted figures
     * as though they were the document's. `source` on the row now says whether
     * the figures came from the document as it stands or from the reading a
     * hold had withheld.
     */
    let preview: Awaited<
      ReturnType<DocumentIntakeService["planRefileForCurrency"]>
    >["plan"];
    let previousTotal: number | null;
    try {
      const planned = await this.intake.planRefileForCurrency(
        id,
        user.restaurantId,
      );
      preview = planned.plan;
      previousTotal = planned.previousTotal;
    } catch (err: any) {
      // A FAILED READ IS NEVER AN EMPTY ONE. Without this the outage would be
      // logged as "this document has nothing to re-file" and the currency would
      // change anyway, on a row saying no money moved.
      throw new HttpException(
        `This document's figures could not be read, so nothing was changed: ${String(
          err?.message ?? "unknown error",
        ).replace(/^REFILE_READ_FAILED:/, "")}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    const pricedLines = preview
      ? preview.lines.filter((l) => l.unit_price != null || l.line_total != null)
          .length
      : 0;

    // THE LOG FIRST. A restatement nobody recorded is the thing this rule
    // exists to prevent, so a log that cannot be written stops the change
    // rather than riding along behind it.
    const { error: logError } = await this.db
      .getClient()
      .from("procurement_document_currency_changes")
      .insert({
        document_id: id,
        restaurant_id: user.restaurantId,
        previous_currency: previous,
        new_currency: next,
        // Which of the two acts this row is. An EXPLICIT key, never a
        // conditional spread — `check_order_capture_contract.py` reads this
        // literal without executing it.
        change_kind: kind,
        // `public.users.user_id`, which is the id the JWT carries. NOT an
        // `auth.users` id: the two tables are disjoint in this database.
        changed_by: user.userId,
        // The name AS IT IS NOW, stored rather than joined. `name` is the field
        // the session actually has; `fullName` is set nowhere in this gateway,
        // and falling back to the email address while calling it a name is the
        // defect fixed on `uploadedByName` in this same file.
        changed_by_label:
          user.name?.trim() || user.email?.trim() || "an unnamed session",
        changed_by_role: role as string,
        document_status: (doc as { status?: string | null }).status ?? null,
        money_refiled: {
          previous_currency: previous,
          new_currency: next,
          previous_total: previousTotal,
          refiled_document: preview?.document ?? null,
          refiled_line_count: preview?.lines.length ?? 0,
          priced_lines: pricedLines,
          snapshot_readable: preview != null,
          // WHICH READING THESE FIGURES CAME FROM. `current_rows` means the
          // document as it stands, corrections included; `withheld_snapshot`
          // means the reading a hold had stripped and kept. A row that does
          // not say cannot be used afterwards to tell a re-filing from a
          // revert, which is exactly what went wrong here.
          source: preview?.source ?? null,
          source_said: preview?.sourceSaid ?? null,
        },
        reason: body?.reason?.trim() || null,
      });
    if (logError)
      throw new HttpException(
        `The currency was NOT changed: the change could not be recorded (${logError.message}), and a restatement nobody can see afterwards is worse than one that never happened.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

    /*
     * THE CURRENCY IS THE PERSON'S ANSWER, so this route writes it. One key,
     * one inline literal — `check_order_capture_contract.py` can only read a
     * write whose column names are literal.
     *
     * It moves on its own, ahead of the figures, so that a document whose
     * stored reading cannot be parsed is still re-LABELLED without having the
     * money it already carries erased by a null fallback.
     */
    const { error: writeError } = await this.db
      .getClient()
      .from("procurement_documents")
      .update({ currency: next })
      .eq("id", id)
      .eq("restaurant_id", user.restaurantId);
    if (writeError)
      throw new HttpException(
        `The change was logged but the document could not be written (${writeError.message}), so its currency is UNCHANGED and the log now names a restatement that did not land. Try again.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

    /*
     * THE FIGURES ARE THE MACHINE'S, so the machine's own writer writes them.
     * `DocumentIntakeService` is the declared writer of `computed_lines_total`,
     * `tie_out_delta` and `ties_out` (ADR 0059,
     * `scripts/check_proposal_preservation.py`), and it re-derives the tie-out
     * through the same `applyTieOut` intake and `editLine` run — so a restated
     * document's arithmetic cannot disagree with an extracted one's.
     */
    let refile: Awaited<
      ReturnType<DocumentIntakeService["refileMoneyForCurrency"]>
    >;
    try {
      refile = await this.intake.refileMoneyForCurrency(
        id,
        user.restaurantId,
        next,
      );
    } catch (err: any) {
      const msg: string = err?.message ?? "unknown error";
      throw new HttpException(
        `The currency is now ${next} and the change is logged, but the figures could not be re-filed (${msg.replace(/^REFILE_(READ|WRITE)_FAILED:/, "")}). The document is labelled and its money is unchanged — restate it again once the write works.`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      id,
      currency: next,
      previousCurrency: previous,
      changedByRole: role,
      /** `restated` or `confirmed` — the row says which, and so does this. */
      kind,
      sentence:
        kind === "confirmed"
          ? `Currency CONFIRMED as ${next}: it did not change, and a manager has now said it is right. That is what ends a hold — the receiving screen will accept a price on this document from here. ${refile.sentence}`
          : `Currency restated ${previous ? `from ${previous}` : "from NOT RECORDED (its money was withheld)"} to ${next}. ${refile.sentence}`,
      moneyRefiled: refile.snapshotReadable,
      linesRefiled: refile.linesRefiled,
      lineFailures: refile.lineFailures,
    };
  }

  /**
   * Begin the hold on a verification. Returns a one-time seal, once.
   *
   * The seal is taken over the WHOLE TRANSCRIPTION — every line as well as the
   * document's own figures — because that is what a verification asserts and
   * because there is no un-verify. A token minted while the reviewer was reading
   * the lines cannot be spent after one of them was corrected: the person's name
   * would otherwise stand behind a figure they never saw, on the record a vendor
   * dispute leans on. See `document-seal.ts`.
   */
  @Post(":id/verify-seal-challenge")
  @ApiOperation({
    summary: "Mint the one-time seal a verification has to carry back",
    description:
      "`challenge` (returned once, never stored in the clear), `expiresAt` and `act` — the act is `verify`, so this token cannot be spent on a line correction or a currency restatement. Bound to this actor, this document and the transcription AS IT STANDS: a line corrected between the hold and the write refuses it with 'This document changed after the seal was issued'.",
  })
  async mintVerifySeal(
    @Param("id") id: string,
    @CurrentUser() user: AuthedUser,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    return this.mintSeal(
      user,
      id,
      "verify",
      await this.readVerifySealArgs(id, user.restaurantId),
    );
  }

  @Post(":id/verify")
  @ApiOperation({
    summary:
      "Confirm the extraction is faithful to the paper document, behind a redeemed seal",
    description:
      "Records who checked it and when. This asserts only that the transcription is right — it does not accept the charges, apply anything to stock, or settle a discrepancy. Takes a one-time seal in `X-Seal-Challenge`, minted by `POST :id/verify-seal-challenge` when the gesture begins and redeemed exactly once here: the transcription somebody is standing behind has to be the one they read.",
  })
  async verify(
    @Param("id") id: string,
    @CurrentUser() user: AuthedUser,
    @Headers("x-seal-challenge") challenge?: string,
  ) {
    await this.assertSealed(user, id, "verify", challenge, () =>
      this.readVerifySealArgs(id, user.restaurantId),
    );

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
