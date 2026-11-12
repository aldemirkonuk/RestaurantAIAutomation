import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";

/** The closed vocabulary (F3). The database refuses any other unit too. */
export const RECIPE_UNITS = ["ml", "cl", "l", "oz", "tsp", "tbsp", "dash", "barspoon", "g", "kg", "each"] as const;

export class RecipeLineDto {
  @ApiProperty({ enum: ["stocked", "untracked"] })
  @IsIn(["stocked", "untracked"])
  role!: "stocked" | "untracked";

  /** The house item; absent or null on a stocked line means "not linked yet". */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  inventoryId?: string | null;

  @ApiProperty()
  @IsString()
  @MaxLength(200)
  label!: string;

  /** A number only; decimal commas are the client's to turn into points. */
  @ApiProperty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  qty!: number;

  @ApiProperty({ enum: RECIPE_UNITS })
  @IsIn(RECIPE_UNITS as unknown as string[])
  unit!: string;
}

export class SaveRecipeDto {
  /** The version the editor opened; null when the drink had none. */
  @ApiProperty({ nullable: true })
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  expectedVersionId!: string | null;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  yieldServes!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) glass?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) garnish?: string;

  @ApiProperty({ type: [RecipeLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  lines!: RecipeLineDto[];
}

/** One line of an unsaved draft, as a cost preview takes it. */
export class PreviewLineDto {
  @ApiProperty({ enum: ["stocked", "untracked"] })
  @IsIn(["stocked", "untracked"])
  role!: "stocked" | "untracked";

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  inventoryId?: string | null;

  // 100,000 is the most one saved line holds (MAX_LINE_QTY in recipes.service.ts,
  // which imports this file, so the number is repeated here).
  @ApiProperty()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(Number.MIN_VALUE)
  @Max(100_000)
  qtyEntered!: number;

  @ApiProperty({ enum: RECIPE_UNITS })
  @IsIn(RECIPE_UNITS as unknown as string[])
  unitCode!: string;
}

/** An unsaved draft to be priced. Nothing about it is stored. */
export class PreviewCostDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1000)
  yieldServes!: number;

  @ApiProperty({ type: [PreviewLineDto] })
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => PreviewLineDto)
  lines!: PreviewLineDto[];
}

export class ShelfQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search?: string;

  @ApiPropertyOptional({ default: 50, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
