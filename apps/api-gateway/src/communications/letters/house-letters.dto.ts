import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
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
      "One of the vendor purposes. A staff broadcast is deliberately not one of them (founder, 2026-09-04): the composer writes to the vendor book only.",
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
