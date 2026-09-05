import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { ORDER_RECURRENCE_FREQUENCIES } from "../order-recurrence";

/**
 * The rule an order repeats by.
 *
 * THREE FIELDS, AND A FOURTH THAT IS DELIBERATELY NOT HERE
 *
 * There is no `nextDueOn`. The next date is DERIVED from the rule and the start
 * date by `planRecurrence`, and every date after it by `nextOccurrenceOn`. A
 * caller-supplied next date would be a fourth writer of a column whose whole
 * value is that exactly one thing computes it — and it would be the one writer
 * that can put a series' date somewhere the rule never goes, which the generator
 * would then mint against forever.
 *
 * There is no `autoApprove` either, and that absence is the design. The sibling
 * `recurring_orders` table has one, and `recurring-orders.service.ts:888` spends
 * it by calling `approveOrder` with no seal challenge and no threshold check —
 * so a schedule with that box ticked commits money with nobody holding anything.
 * Recurrence on the order approves nothing: each occurrence is born PENDING and
 * a person seals it (ADR 0116, ADR 0125).
 *
 * The gateway runs `forbidNonWhitelisted`, so a body naming any of the above is
 * 400'd by name rather than accepted and silently dropped.
 */
export class SetOrderRecurrenceDto {
  @ApiProperty({
    enum: ORDER_RECURRENCE_FREQUENCIES as unknown as string[],
    example: "weekly",
    description:
      "How often the order repeats. The same five members recurring_orders.frequency has, so the two recurrence surfaces in this house cannot disagree about what 'weekly' means.",
  })
  @IsIn(ORDER_RECURRENCE_FREQUENCIES as unknown as string[], {
    message: `frequency must be one of: ${ORDER_RECURRENCE_FREQUENCIES.join(", ")}. Refusing rather than defaulting to monthly — a daily rule that quietly runs monthly is a wrong answer nobody can see.`,
  })
  frequency!: string;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: 28,
    example: 1,
    description:
      "What to anchor the rule to. Weekly/biweekly: a weekday, 0 = Monday to 6 = Sunday. Monthly/quarterly: a day of the month, 1 to 28 — 28 so that every month has one, which is why 29-31 are refused rather than clamped silently. Daily takes no anchor and is refused if given one. Omit for 'every N days from the start date'.",
  })
  @IsOptional()
  @IsInt({ message: "anchorDay must be a whole number." })
  // The outer bounds only. Which of 0-6 and 1-28 applies depends on the
  // frequency, and `validateAnchorDay` in `order-recurrence.ts` decides that —
  // one place, shared with the generator and asserted by the same tests, rather
  // than a class-validator rule that can only see one field at a time.
  @Min(0, { message: "anchorDay must be 0 or more." })
  @Max(28, { message: "anchorDay must be 28 or less." })
  anchorDay?: number;

  @ApiPropertyOptional({
    example: "2026-09-08",
    description:
      "The date the series is measured from, YYYY-MM-DD. Defaults to today. NOT the order's own approval date: an order approved three weeks ago would start a series three weeks overdue, and the generator reads an overdue series as work to catch up on.",
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "startsOn must be a calendar date written YYYY-MM-DD.",
  })
  startsOn?: string;
}
