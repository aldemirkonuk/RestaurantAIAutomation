import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class ApproveDraftDto {
  @ApiPropertyOptional({
    description: "Modified draft content (omit to approve as-is)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  modifiedContent?: string;

  @ApiPropertyOptional({ description: "Manager notes for audit log" })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  managerNotes?: string;

  @ApiPropertyOptional({ description: "Additional CC email addresses" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}

/**
 * The letter a drafted reply's hold is minted over
 * (`POST orders/:id/draft-seal-challenge`).
 *
 * A class, not an inline type, because Nest's ValidationPipe only validates a
 * body whose `design:paramtypes` entry is a class: an inline `{ ... }` or an
 * intersection is recorded as `Object` and passes unvalidated. It did, until
 * 2026-09-17 — a copy carrying CRLF and a `Bcc:` line, and a 6,000-character
 * body, were both accepted, and `gmail.service.ts` writes copies straight into
 * the MIME headers. The seal cannot catch that: the same caller mints over the
 * same copies. The limits match `ApproveDraftDto`, which spends this seal.
 */
export class DraftSealChallengeDto {
  @ApiProperty({ description: "The letter's words as the person read them" })
  @IsString()
  @MaxLength(5000)
  content!: string;

  @ApiPropertyOptional({
    description:
      "The recipient the person read. Refused unless it is the vendor's address on file.",
  })
  @IsOptional()
  @IsEmail()
  to?: string | null;

  @ApiPropertyOptional({ description: "The copies the person read" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}
