import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";

/**
 * The one field of `PUT /settings/currency`.
 *
 * The pattern is `restaurants_currency_check`'s, verbatim
 * (`20260905120000_a_house_names_its_money.sql`): a value this DTO admits is a
 * value the database admits, so the two can never disagree about what a
 * currency is. The closed VOCABULARY — which codes a manager may pick — is
 * `CURRENCY_CODES` in `apps/web/src/lib/currency.ts`, and is deliberately not
 * copied here; a second list of the world's currencies is a second thing to
 * keep true.
 *
 * There is no "clear it" value. Nulling the column happened once, under the
 * founder's explicit word, through `scripts/correct_restaurant_currency.py`;
 * a button that silently un-answers the question every money figure on every
 * screen depends on is not the same kind of act as answering it.
 */
export class SetHouseCurrencyDto {
  @ApiProperty({
    description:
      "ISO 4217 alpha-3, in capitals — TRY, GBP, USD. The money this house REPORTS in. It is not the currency of any recorded price: each invoice keeps the currency its vendor billed in, and nothing anywhere converts.",
    example: "TRY",
  })
  @IsString()
  @Matches(/^[A-Z]{3}$/, {
    message:
      'A currency is an ISO 4217 alpha-3 code in capitals — "TRY", "GBP", "USD". Nothing was recorded.',
  })
  code: string;
}
