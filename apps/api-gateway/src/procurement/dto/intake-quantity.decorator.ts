import { applyDecorators } from "@nestjs/common";
import { IsNumber, IsPositive, Max } from "class-validator";
import { Type } from "class-transformer";
import { INTAKE_DECIMAL_PLACES } from "../documents/document-types";

/**
 * The validator every INTAKE quantity carries, replacing `@IsInt() @Min(1)`.
 *
 * WHY `@IsInt()` HAD TO GO
 *
 * A receiver could not record a delivery of flour. `@IsInt()` answered 4.5 with
 * a 400 before the value reached a `numeric(12,3)` column that would have stored
 * it perfectly well — and one level below that, the `uom` CHECK had no mass unit
 * to state it in, so there was no spelling of "4.5 kg" the system could hold.
 * ADR 0071 fixed the vocabulary; this fixes the validator that would still have
 * refused it.
 *
 * WHY NOT SIMPLY `@IsNumber()`
 *
 * Because the column is `numeric(12,3)`, and Postgres does not REFUSE a fourth
 * decimal place — it ROUNDS it. 0.5 g of saffron entered as 0.0005 kg is stored
 * as 0.001 kg: double the real quantity, recorded as fact, with no error
 * anywhere and nothing downstream able to tell it was ever wrong. That is this
 * repo's cardinal fault (`memory/absence-reported-as-health`) reached through a
 * relaxed validator, so the precision the column actually has is stated here
 * rather than left to be discovered.
 *
 * `maxDecimalPlaces` is deliberately tied to `INTAKE_DECIMAL_PLACES`, which the
 * migration's `numeric(12,3)` is the other half of. `scripts/check_intake_units.py`
 * fails the build if the two drift.
 *
 * WHAT THIS DOES **NOT** DECIDE
 *
 * Whether a fraction is legal AT ALL, because that depends on the unit and a
 * property decorator cannot see its siblings reliably. Half a gram is a real
 * quantity; half a case is a receiving mistake. `resolveOrderUnits` owns that
 * rule — it resolves the unit first and then judges the quantity against it —
 * and it is the single place every writer funnels through. Duplicating the rule
 * here would create two answers that can disagree, which is the failure mode the
 * unit vocabulary itself was just consolidated to avoid.
 *
 * So this decorator says: a number, positive, no finer than the column, not
 * absurd. The unit-aware refusal happens once, downstream, with a message that
 * can name the unit.
 */
export function IsIntakeQuantity(): PropertyDecorator {
  return applyDecorators(
    Type(() => Number),
    IsNumber(
      { maxDecimalPlaces: INTAKE_DECIMAL_PLACES },
      {
        message: ({ property, value }) =>
          `${property} must be a number with at most ${INTAKE_DECIMAL_PLACES} decimal places (got ${JSON.stringify(value)}). ` +
          `The quantity column stores three and ROUNDS the rest, so a finer value would be recorded as a different quantity than the one entered. ` +
          `State it in a finer unit instead — 0.5 g rather than 0.0005 kg.`,
      },
    ),
    IsPositive({
      message: ({ property, value }) =>
        `${property} must be greater than zero (got ${JSON.stringify(value)}).`,
    }),
    // numeric(12,3) holds 999,999,999.999. A value above it is a 22003 from
    // Postgres — an opaque 500 — rather than a 400 naming the field, so the
    // ceiling is stated where it can still be explained.
    Max(999_999_999, {
      message: ({ property, value }) =>
        `${property} of ${JSON.stringify(value)} is beyond what the quantity column can hold. ` +
        `If this is genuinely a quantity that large, it is stated in the wrong unit — use kg rather than g.`,
    }),
  );
}
