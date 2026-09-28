import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/**
 * The body of `PUT /settings/carrying-cost`.
 *
 * The bounds are `restaurants_carrying_cost_is_a_plausible_percent`'s, verbatim
 * (`20260906140000_a_carrying_cost_is_typed_by_a_person.sql`): a value this DTO
 * admits is a value the database admits, so the two can never disagree about
 * what a carrying cost is.
 *
 * **They are a units check as much as a range.** `NUMERIC(5,3)` would store
 * `0.0075` and `75` without complaint, and each is the same mistake in a
 * different direction — the fraction spelling understates the cost by a hundred
 * and makes every commodity alert look profitable; `75` reads as 900 percent a
 * year and makes every saving vanish. Both are refused with a sentence that
 * says which spelling the field wants.
 *
 * There is no "clear it" value. Un-answering the question the alert's money
 * clause depends on is a different kind of act from answering it — the same
 * rule `SetHouseCurrencyDto` holds for the same reason.
 */
export class SetHouseCarryingCostDto {
  @ApiProperty({
    description:
      "What holding stock costs this house, as a PERCENT of the goods' value PER MONTH: cash, space and shrink together. Three quarters of one percent a month is 0.75 — not 0.0075 and not 75. The commodity alert states a saving in money only when this is stated, and says the saving is unmeasured otherwise.",
    example: 0.75,
    minimum: 0.01,
    maximum: 25,
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 },
    {
      message:
        "A carrying cost is a number with at most three decimals: what holding stock costs this house, as a percent of the goods' value per month. Nothing was recorded.",
    },
  )
  @Min(0.01, {
    message:
      "That is below 0.01 percent a month, which is a tenth of a percent a year — no house holds stock that cheaply. This field is a PERCENT: three quarters of one percent a month is 0.75, not 0.0075. Nothing was recorded.",
  })
  @Max(25, {
    message:
      "That is more than 25 percent a MONTH, which is 300 percent a year. If you meant three quarters of one percent, type 0.75. Nothing was recorded.",
  })
  percentPerMonth: number;

  @ApiPropertyOptional({
    description:
      "What you counted, in your own words — \"cash at 9 percent plus the walk-in\", \"just the money\". Optional. Two houses can type the same number meaning different things and only the person typing knows which.",
    example: "cash at 9 percent plus the walk-in",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message:
      "The basis is a sentence, not a document. Keep it under 500 characters. Nothing was recorded.",
  })
  basis?: string;
}
