import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional } from "class-validator";

/**
 * The bodies of `PUT /settings/tax-basis` and `POST /settings/tax-rates`
 * (F-620 / F-1537, lane 2).
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
