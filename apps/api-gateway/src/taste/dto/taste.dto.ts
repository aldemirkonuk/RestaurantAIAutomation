import { ApiPropertyOptional, ApiProperty } from "@nestjs/swagger";
import { IsArray, IsObject, IsOptional, IsString } from "class-validator";

/**
 * What staff may say about how something tastes. Every field's CONTENT is
 * checked by `parseHouseBody` (taste.service.ts), so a refusal is a sentence
 * about taste rather than a generic validator message. There is deliberately
 * no stated_by here: who said it comes from the session, never the body (the
 * global pipe forbids unknown fields, so a body that sends one is refused).
 */
export class AppendHouseTasteDto {
  @ApiPropertyOptional({ description: "axis name -> { v 0..10, sd? }" })
  @IsOptional()
  @IsObject()
  axes?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  descriptors?: unknown[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  texture?: unknown[];

  @ApiPropertyOptional({ description: "What the person wrote, kept verbatim" })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ enum: ["line", "cata", "ordinal"] })
  @IsString()
  method!: string;
}

/** A recipe typed on a sheet. Content is checked by `parsePreview` (taste.service.ts), so a refusal is a sentence. */
export class RollupPreviewDto {
  @ApiProperty({ enum: ["cocktail", "dish"] })
  @IsString()
  kind!: string;

  @ApiPropertyOptional({ description: "How it is made (shake, stir, build...)" })
  @IsOptional()
  method?: unknown;

  @ApiProperty({ description: "[{ name, lines: [{ name, qty, unit: g|ml, prep? }] }]" })
  @IsArray()
  components!: unknown[];
}
