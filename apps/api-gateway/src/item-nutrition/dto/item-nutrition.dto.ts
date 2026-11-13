import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { ALLERGEN_STATUSES, ALLERGENS, BASES, SOURCES } from "../nutrition-figures";

/**
 * The figures a person confirmed, per 100 g or 100 ml. A figure left out or
 * null is "not known" and is stored as NULL, never 0. Ranges and the
 * part-within-whole rules are checked in checkWrite() so a refusal reads as a
 * sentence.
 */
export class NutritionFiguresDto {
  @ApiProperty({ enum: BASES })
  @IsIn(BASES as unknown as string[])
  basis: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() energyKcal?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() fatG?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() saturatesG?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() carbohydrateG?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() sugarsG?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() proteinG?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsNumber() saltG?: number | null;
  @ApiPropertyOptional({ nullable: true, description: "Alcohol by volume, %; only per 100 ml" })
  @IsOptional()
  @IsNumber()
  abvPct?: number | null;

  @ApiProperty({ enum: SOURCES })
  @IsIn(SOURCES as unknown as string[])
  source: string;

  @ApiPropertyOptional({ nullable: true, description: "Barcode or FoodData Central id, for a lookup" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceRef?: string | null;
}

export class AllergenStatementDto {
  @ApiProperty({ enum: ALLERGENS })
  @IsIn(ALLERGENS as unknown as string[])
  allergen: string;

  @ApiProperty({ enum: [...ALLERGEN_STATUSES, "not_stated"] })
  @IsIn([...ALLERGEN_STATUSES, "not_stated"])
  status: string;
}

export class SaveItemNutritionDto {
  @ApiPropertyOptional({ type: NutritionFiguresDto, nullable: true, description: "null removes the figures" })
  @IsOptional()
  @ValidateNested()
  @Type(() => NutritionFiguresDto)
  figures?: NutritionFiguresDto | null;

  @ApiProperty({ type: [AllergenStatementDto], description: "The whole stated set; one left out is not stated" })
  @IsArray()
  @ArrayMaxSize(ALLERGENS.length)
  @ValidateNested({ each: true })
  @Type(() => AllergenStatementDto)
  allergens: AllergenStatementDto[];
}
