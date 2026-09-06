import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { SOURCE_CHANNELS, SourceChannel } from "../document-types";

/**
 * Channels a person can claim when uploading. `email`, `edi` and `sftp` are
 * deliberately excluded: those are asserted by the transport that received the
 * document, and letting a client name them would let a hand-uploaded file
 * masquerade as one that arrived electronically from the distributor — which is
 * precisely the provenance a credit claim rests on.
 */
const CLIENT_SOURCES = ["upload", "photo", "manual"] as const;

export class UploadDocumentDto {
  @ApiProperty({
    description:
      "Base64-encoded file bytes (PDF, image, or EDI text). Roughly 10MB decoded is the practical ceiling.",
  })
  @IsString()
  @MaxLength(14_000_000)
  contentBase64!: string;

  @ApiPropertyOptional({
    description: "Original filename, used to route EDI files",
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @ApiPropertyOptional({
    description: "Content type; magic bytes win if it disagrees",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  mimeType?: string;

  @ApiPropertyOptional({ enum: CLIENT_SOURCES, default: "upload" })
  @IsOptional()
  @IsIn(CLIENT_SOURCES as unknown as string[])
  source?: Extract<SourceChannel, "upload" | "photo" | "manual">;

  @ApiPropertyOptional({ description: "Distributor this document came from" })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiPropertyOptional({
    description:
      "Order to attach it to. Omit to let the document's own PO number find one — an exact match only, since a wrong link produces a confident, wrong discrepancy.",
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;
}

/**
 * The extraction door's body.
 *
 * `rawText` is the JSON the model contract in `DocumentExtractorService`'s
 * SYSTEM_PROMPT describes, produced somewhere other than this gateway's model
 * client — today, a Claude Code session reading the PDF, because the configured
 * `ANTHROPIC_API_KEY` has no credit. `model` is a free-text label recorded
 * verbatim in `extraction_model`, so the row says who read the page.
 */
export class ApplyExtractionDto {
  @ApiProperty({
    description:
      "The extraction JSON, in the same shape DocumentExtractorService's SYSTEM_PROMPT asks a model for. A body that is not JSON, or that carries no lines, is refused with 422 rather than written.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(4_000_000)
  rawText!: string;

  @ApiProperty({
    description:
      'Who read the document, recorded verbatim in `extraction_model` — e.g. "claude-code:claude-fable-5-1". Never the configured model\'s name: an extraction this gateway did not perform must not be attributable to the model it would have used.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  model!: string;
}

/** Exported so the CHECK-constraint vocabulary has exactly one definition. */
export const ALL_SOURCE_CHANNELS = SOURCE_CHANNELS;

/**
 * The correction door's body (ADR 0104 D5, slice 3).
 *
 * `value` IS DELIBERATELY UNTYPED HERE and validated in
 * `DocumentCorrectionService` against the field's declared type in
 * `correctable-paths.ts`. class-validator cannot express "a number for BT-129,
 * text for BT-153, and null for either when the paper printed nothing" without
 * duplicating that registry — and two registries drift.
 *
 * `null` is a real, reachable value: "the document states nothing here" is the
 * correction an extraction that invented a figure needs.
 */
export class CorrectFieldDto {
  @ApiProperty({
    description:
      "The layer-1 field to correct: a field name (`documentNumber`, `seller.name`, `totals.taxInclusiveAmount`) or `lines[n].field` with a zero-based line index. A path outside the closed list in correctable-paths.ts is refused with 400 — this is never a generic object path.",
    example: "lines[0].quantity",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  path!: string;

  @ApiPropertyOptional({
    description:
      "The corrected value, typed by the field (number or text), or null to record that the document states nothing there.",
  })
  @IsOptional()
  value?: unknown;

  @ApiPropertyOptional({
    description:
      "Why, in the corrector's words. Recorded on the append-only correction row — a log of changes with no reasons is a change history, not evidence.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** The per-field `verified_by` tick (ADR 0104 D5). */
export class VerifyFieldDto {
  @ApiProperty({
    description:
      "The layer-1 field a human is standing behind. The field's `source` does NOT change — an extracted value that a person confirmed is still an extracted value.",
    example: "totals.taxInclusiveAmount",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  path!: string;
}
