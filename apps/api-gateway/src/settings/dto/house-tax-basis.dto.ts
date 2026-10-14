import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";

/**
 * The bodies of `PUT /settings/tax-basis`, `POST /settings/tax-rates`,
 * `POST /settings/tax-rates/withdraw` (F-620 / F-1537, lane 2; F-1586) and
 * `PUT /settings/tax-basis/cocktail-category` (F-1615).
 *
 * Only the property NAMES are declared here (the global pipe forbids any
 * other). Every value is checked in `HouseTaxBasisService` — the answer by
 * `confirm`, the rate by `notARateBecause` — so the sentence a refusal prints
 * is the service's, and a direct call to the service is held to the same rule
 * as the route.
 */
export class ConfirmHouseTaxBasisDto {
  @ApiProperty({
    description:
      "prices_include_tax (the till's prices include tax: KDV, VAT), prices_exclude_tax (tax is added on top, the US way) or not_vat_charging (the house charges no VAT). Never unset.",
    example: "prices_include_tax",
  })
  @IsOptional()
  basis: string;
}

export class AddHouseTaxRateDto {
  @ApiProperty({
    description:
      "What the rate covers: house (everything the house sells), pos_category (one till sales category, as the till names it) or house_item (one of the house's items, by its id).",
    example: "pos_category",
  })
  @IsOptional()
  keyKind: string;

  @ApiPropertyOptional({
    description:
      "The till category's name for pos_category, the item id for house_item; ignored for house.",
    example: "Alkol",
  })
  @IsOptional()
  key?: string;

  @ApiProperty({
    description:
      "A PERCENT (20 = 20 percent), 0 up to 100, two decimals at most. null withdraws the key from effectiveFrom.",
    example: 20,
    nullable: true,
  })
  @IsOptional()
  ratePct: number | null;

  @ApiProperty({
    description: "The first business date the rate applies (YYYY-MM-DD).",
    example: "2026-10-12",
  })
  @IsOptional()
  effectiveFrom: string;

  @ApiPropertyOptional({
    description:
      "The first business date it no longer applies (exclusive), or null for open.",
    example: null,
    nullable: true,
  })
  @IsOptional()
  effectiveTo?: string | null;
}

export class WithdrawHouseTaxRateDto {
  @ApiProperty({
    description:
      "The number (version) of this house's rate row to withdraw. Nothing is edited: rows are appended that restate what applied before it.",
    example: 2,
  })
  @IsOptional()
  version: number;
}

export class SetCocktailTaxCategoryDto {
  @ApiProperty({
    description:
      "The till category (one the house has a rate for, as the till names it) whose rate a cocktail's price holds; null takes the choice back (F-1615).",
    example: "Alkol",
    nullable: true,
  })
  @IsOptional()
  category: string | null;
}
