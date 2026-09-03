import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class ListBeveragesQueryDto {
  /**
   * A cellar register — `beer`, `whiskey`, `spirits`, `non_alcoholic`. Resolved
   * to the measured `beverage_type` vocabulary in one place
   * (`cellar/cellar-registers.ts`), so the browser never carries its own copy
   * of which types count as spirits.
   */
  @ApiPropertyOptional({ description: "Filter by cellar register" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  register?: string;

  @ApiPropertyOptional({ description: "Filter on beverage_type (ilike)" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string;

  @ApiPropertyOptional({ description: "Search name or producer" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /**
   * Always has a value, and the response says whether it was hit. A list
   * endpoint whose caller cannot tell a full page from a complete table teaches
   * the browser to print a floor as a total — the exact error the cellar's
   * parent card was already caught making about `/wines?limit=500`.
   */
  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}

export class ListCocktailsQueryDto {
  @ApiPropertyOptional({ description: "Search name" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 200, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit: number = 200;
}

/**
 * The register read: one register, whole — this house's own rows with their
 * record, then the shared catalogue rows nobody here has touched.
 */
export class ReadRegisterQueryDto {
  @ApiPropertyOptional({ description: "Search name, producer, type, origin" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ default: 400, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  catalogueLimit: number = 400;

  @ApiPropertyOptional({ default: 600, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  ledgerLimit: number = 600;
}

/* ── cocktails: the one register a house can write ─────────────────────────
   `public.cocktails` is the only table in this module carrying a
   `restaurant_id`, so it is the only one these DTOs describe. There is
   deliberately no CreateBeverageDto: a tenant writing into the shared
   reference catalogue would be a second writer for an identity a database
   trigger owns (`set_beverage_identity`), and the register says so instead of
   offering a button that should not exist.                                  */

export class CocktailFieldsDto {
  @ApiPropertyOptional({ description: "What the house calls it on the list" })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string;

  @ApiPropertyOptional({ description: "The menu section it sits under" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  menuSection?: string;

  @ApiPropertyOptional({ description: "Built, stirred, shaken, …" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  method?: string;

  @ApiPropertyOptional({ description: "The glass it is served in" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  glass?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  garnish?: string;

  /**
   * The price the house charges. Optional, and absent means unpriced — never
   * zero, which on this page would read as "free".
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class CreateCocktailDto extends CocktailFieldsDto {
  @ApiProperty({ description: "The cocktail's name. Required and non-empty." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;
}

export class UpdateCocktailDto extends CocktailFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;
}

/**
 * One line of a recipe. The CHECK constraint
 * (`cocktail_ingredients_has_a_referent`) requires at least one of
 * beverage_id / wine_id / free_text, and this DTO does not restate that rule —
 * the database owns it, and a duplicate copy here would be a second home for
 * one invariant. A line with none of the three is refused by Postgres and the
 * error reaches the operator as words.
 */
export class CocktailIngredientDto {
  @ApiPropertyOptional({ description: "Free text: 'fresh lime juice', 'egg white'" })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  freeText?: string;

  @ApiPropertyOptional({ description: "A row of public.beverages, when the base spirit is catalogued" })
  @IsOptional()
  @IsUUID()
  beverageId?: string;

  @ApiPropertyOptional({ description: "A row of master_wine_library" })
  @IsOptional()
  @IsUUID()
  wineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ description: "oz, ml, dash, …" })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(200)
  sortOrder?: number;
}

export class SetCocktailIngredientsDto {
  /**
   * The whole recipe, replacing whatever was there. An empty array is a
   * legitimate value and means "this recipe has no lines recorded" — which is
   * how a recipe is un-recorded without deleting the cocktail.
   */
  @ApiProperty({ type: [CocktailIngredientDto] })
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CocktailIngredientDto)
  lines!: CocktailIngredientDto[];
}
