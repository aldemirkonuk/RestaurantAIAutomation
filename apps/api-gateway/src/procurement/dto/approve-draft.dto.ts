import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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

/**
 * A staff member's hold on a letter becomes a REQUEST (founder, 2026-09-21):
 * `POST orders/:id/draft-send-request`. The words are the exact version they
 * edited, and the copies are the ones they chose; the manager releases this
 * version with one hold. A class so the ValidationPipe checks it; the limits
 * match `ApproveDraftDto`, which the release spends.
 */
export class DraftSendRequestDto {
  @ApiProperty({ description: "The letter exactly as the person edited it" })
  @IsString()
  @MaxLength(5000)
  content!: string;

  @ApiPropertyOptional({ description: "The copies the person chose" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}

/**
 * A reply a person writes into the thread (`POST orders/:id/manual-reply` and
 * its seal mint). Was an inline type — recorded as `Object` and never
 * validated — until the manual-reply door was sealed (ADR 0175 D9, 2026-09-21).
 */
export class ManualReplyDto {
  @ApiProperty({ description: "The reply's words" })
  @IsString()
  @MaxLength(5000)
  content!: string;

  @ApiPropertyOptional({ description: "Additional CC email addresses" })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  ccEmails?: string[];
}

/**
 * The terms a deal is confirmed at (`POST orders/:id/confirm-deal` and its
 * seal mint). Was an inline type until the confirm-deal door was sealed (ADR
 * 0175 D9, 2026-09-21).
 */
export class ConfirmDealDto {
  @ApiPropertyOptional({ description: "The confirmed unit price, if changed" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  finalPrice?: number;

  @ApiPropertyOptional({ description: "The confirmed quantity, if changed" })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ description: "Mail the vendor a confirmation (default true)" })
  @IsOptional()
  @IsBoolean()
  sendConfirmation?: boolean;
}
