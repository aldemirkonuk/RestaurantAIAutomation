import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsIn, IsOptional } from "class-validator";
import { TAX_BASES } from "../house-tax-basis.service";

/**
 * The two answers of `PUT /settings/tax-basis` (ADR 0359 C2/C3). `unset` is
 * not among them: an answer cannot be taken back to "not answered".
 */
export class SetHouseTaxBasisDto {
  @ApiProperty({
    description:
      "Whether the house's own prices hold tax: `prices_include_tax`, `prices_exclude_tax`, or `not_vat_charging` for a house that charges no VAT.",
    enum: TAX_BASES,
    example: "prices_include_tax",
  })
  @IsIn(TAX_BASES as unknown as string[], {
    message:
      '$value is not an answer this product knows. Send "prices_include_tax", "prices_exclude_tax" or "not_vat_charging". Nothing was recorded.',
  })
  basis: string;

  @ApiPropertyOptional({
    description:
      "Whether the house reclaims the tax it pays on its purchases. Required for a house that charges VAT; a house that charges none reclaims none, so leave it out or send false.",
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: "Whether the house reclaims tax is a yes or a no. Nothing was recorded." })
  reclaimsInputTax?: boolean;
}
