import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";
import { ISO_4217_CODES } from "../../common/iso-4217";

/**
 * The one field of `PUT /settings/currency`.
 *
 * The pattern is `restaurants_currency_check`'s, verbatim
 * (`20260905120000_a_house_names_its_money.sql`): a value this DTO admits is a
 * value the database admits, so the two can never disagree about what a shape
 * is.
 *
 * The VOCABULARY is checked too, and it did not used to be. This comment said
 * the closed list lived in `apps/web/src/lib/currency.ts` and was "deliberately
 * not copied here; a second list of the world's currencies is a second thing to
 * keep true". A browser list is not a validator of an HTTP route, and the
 * shape check admitted `ZZZ` — which `restaurants.currency` then supplied to
 * `invoice-currency.ts` as the rung an unmarked invoice's money is filed under.
 * The list is now `common/iso-4217.ts`, and `iso-4217.spec.ts` fails if it
 * differs from the web's by one code, so the copy cannot become a second
 * table.
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
  @IsIn(ISO_4217_CODES as string[], {
    message:
      "$value is three letters but names no currency, so nothing was recorded. Send a code this product knows — the currency picker lists them.",
  })
  code: string;
}
