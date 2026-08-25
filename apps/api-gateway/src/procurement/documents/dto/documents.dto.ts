import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
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

/** Exported so the CHECK-constraint vocabulary has exactly one definition. */
export const ALL_SOURCE_CHANNELS = SOURCE_CHANNELS;
