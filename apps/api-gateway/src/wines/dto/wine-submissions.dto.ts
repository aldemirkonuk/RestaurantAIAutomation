import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";
import { Transform } from "class-transformer";
import {
  MENU_CATEGORY_VOCABULARY,
  type MenuCategory,
} from "../../menus/wine-extract-item.interface";

export class CreateWineSubmissionDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  producer!: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  vintage?: number | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? undefined : Number(value),
  )
  @IsNumber()
  priceReference?: number | null;

  /**
   * F-918: the ISO 4217 code `priceReference` is stated in, when the sender
   * knows it. Left out, the library records the price's currency as not
   * recorded — it is never assumed.
   */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, {
    message:
      "priceReferenceCurrency must be a three-letter currency code, such as USD or TRY",
  })
  priceReferenceCurrency?: string;

  @IsOptional()
  @IsString()
  primaryType?: string;

  /**
   * F-1221: a drink that is not a wine (beer, spirit, cider, …), as one of
   * MENU_CATEGORY_VOCABULARY. Written to `data_enrichment.menu_category`, the
   * beverage_kind trigger's second input; never part of the identity.
   */
  @IsOptional()
  @IsIn(MENU_CATEGORY_VOCABULARY)
  menuCategory?: MenuCategory;

  @IsOptional()
  @IsString()
  grapeVariety?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  appellation?: string;

  @IsOptional()
  @IsString()
  subRegion?: string;

  @IsOptional()
  @IsObject()
  wineStructure?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  sensoryProfile?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined ? undefined : Number(value),
  )
  @IsInt()
  @Min(50)
  @Max(18000)
  bottleSizeMl?: number;
}

export class SubmissionListQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ProcessSubmissionsDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
