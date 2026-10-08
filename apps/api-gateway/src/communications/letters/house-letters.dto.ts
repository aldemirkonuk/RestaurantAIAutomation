import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

/**
 * One engine sentence, carried into the letter WHOLE.
 *
 * The merge unit is the sentence the engine already computed, with its
 * provenance — never a figure scraped back out of one. `rec-forward.ts:16-21`
 * already gives the reason on the recommendations side: a figure re-derived on
 * the client is a second arithmetic that can disagree with the first, and the
 * letter is the worst possible place for that disagreement to surface.
 *
 * The client sends the sentence it displayed AND the row's provenance; the
 * server re-reads that row and refuses anything it cannot match (see
 * `house-letters.service.ts`, `verifyInsertions`). A client-supplied sentence is
 * therefore never trusted — it is checked.
 */
export class InsertedInsightDto {
  @ApiProperty({ description: "analytics_insights.candidate_key" })
  @IsString()
  @MaxLength(300)
  candidateKey: string;

  @ApiProperty({ description: "The sentence as it was inserted." })
  @IsString()
  @MaxLength(2000)
  sentence: string;
}

export class QueueLetterDto {
  @ApiProperty({ description: "The provider this letter is addressed to." })
  @IsUUID()
  providerId: string;

  @ApiProperty({
    description:
      "The recipient address. It must already be in the book for that provider; an unknown address is refused, never quietly added.",
  })
  @IsEmail()
  to: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  subject: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;

  @ApiPropertyOptional({
    description:
      "The order this letter belongs to, when it belongs to one. A letter with an order is counted by the AI reply path's round limit for that order; a letter without one is not (there is no thread for it to be a round of).",
  })
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @ApiPropertyOptional({
    description:
      "The draft this letter is sent from (ADR 0230). Sending it is the approval: the draft row becomes the queued letter, and a draft that is no longer a draft is refused rather than sent twice.",
  })
  @IsOptional()
  @IsUUID()
  draftId?: string;

  @ApiPropertyOptional({ description: "The house template this started from." })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({ type: [InsertedInsightDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InsertedInsightDto)
  insights?: InsertedInsightDto[];

  @ApiPropertyOptional({
    description:
      "A manager releasing a staff member's waiting letter names its request (founder answer 3, 2026-09-21). The request is taken once; the letter keeps the composer's undo window.",
  })
  @IsOptional()
  @IsUUID()
  requestId?: string;
}

/**
 * An owner or a manager declines a staff member's letter request, saying why
 * (founder, 2026-09-21: "Decline/withdraw; undo re-waits"). The person who
 * asked reads the reason on the bell.
 */
export class DeclineLetterRequestDto {
  @ApiProperty({ description: "Why it is declined; the person who asked reads it." })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason: string;
}

export class UpsertLetterTemplateDto {
  @ApiPropertyOptional({ description: "Omit to create." })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiProperty({
    description:
      "One of the vendor purposes. `order_request` is the house's one order letter (ADR 0313): owner or manager only, checked against the STORED purpose of an edited row, its words checked by the order letter's prose rules, and saved as a draft that renders nothing until it is previewed and published. A staff broadcast is deliberately not one of them (founder, 2026-09-04): the composer writes to the vendor book only.",
  })
  @IsString()
  @MaxLength(60)
  category: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body: string;
}

/** The two languages an order letter is written in (ADR 0313 R4, F3). */
export const ORDER_LETTER_LOCALES = ["en", "tr"] as const;

/**
 * Preview the house's order letter (ADR 0313, 0173 D2: draft, preview,
 * publish). Without `body`, the saved draft is previewed; with one, the
 * words given (the sheet previews what is being typed). The answer carries a
 * `previewHash`, and publish refuses unless the hash it is given is the one
 * the SAVED draft previews to.
 */
export class PreviewOrderLetterDto {
  @ApiPropertyOptional({ description: "Words to preview instead of the saved draft." })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body?: string;

  @ApiPropertyOptional({
    enum: ORDER_LETTER_LOCALES,
    description: "The letter's language. Default: the house's own (restaurants.country, ADR 0313).",
  })
  @IsOptional()
  @IsIn(ORDER_LETTER_LOCALES as unknown as string[])
  locale?: "en" | "tr";
}

/** Publish the saved draft as a new version. Owner or manager only. */
export class PublishOrderLetterDto {
  @ApiProperty({
    description:
      "The previewHash the preview of the saved draft answered. A draft saved after that preview, or another language, does not match and nothing is published.",
  })
  @IsString()
  @MinLength(64)
  @MaxLength(64)
  previewHash: string;

  @ApiPropertyOptional({ enum: ORDER_LETTER_LOCALES })
  @IsOptional()
  @IsIn(ORDER_LETTER_LOCALES as unknown as string[])
  locale?: "en" | "tr";
}

/** Publish Mudavym's default words as a new version (0173 D2: a reset is a version). */
export class ResetOrderLetterDto {
  @ApiPropertyOptional({ enum: ORDER_LETTER_LOCALES })
  @IsOptional()
  @IsIn(ORDER_LETTER_LOCALES as unknown as string[])
  locale?: "en" | "tr";
}

/** Copy an earlier version's words into the draft. Nothing is published. */
export class RestoreOrderLetterDto {
  @ApiProperty({ description: "letter_template_versions.id of this house's order letter." })
  @IsUUID()
  versionId: string;
}
