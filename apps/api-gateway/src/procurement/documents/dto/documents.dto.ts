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

  /**
   * Which sender's price codes to read an 832 catalogue against (ADR 0126).
   *
   * NOT the same fact as `providerId`. `providerId` names a row in this house's
   * own provider list; this names an entry in the measured distributor register,
   * which is what a price-code statement is keyed on. A catalogue arriving
   * without it is stored and NOT priced, and the response says which keys exist
   * — the alternative, guessing the sender from the file's own `N1*SU`, would
   * read one house's statement of what `CON` means onto a different
   * distributor's paper.
   */
  @ApiPropertyOptional({
    description:
      "For an EDI 832 price catalogue: the distributor-register key whose price-code statements this file should be read against (e.g. southern-glazers-il). Ignored for every other document type. Omit it and the catalogue is stored but nothing on it is priced.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  distributorKey?: string;

  /**
   * The catalogue's currency, when the file itself states none.
   *
   * There is deliberately no default. An 832 with no `CUR` and no declaration
   * here is refused whole rather than stamped USD — the published MSSS sample
   * carries no `CUR` at all, so this is the common case, and
   * `own-paper-sighting.ts`'s `?? "USD"` is the measured defect that already
   * marks Turkish and British sightings as dollars.
   */
  @ApiPropertyOptional({
    description:
      "ISO 4217 code to read an 832 catalogue in when the file states no CUR segment. No default: a catalogue with neither is refused rather than assumed to be USD.",
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  declaredCurrency?: string;
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
