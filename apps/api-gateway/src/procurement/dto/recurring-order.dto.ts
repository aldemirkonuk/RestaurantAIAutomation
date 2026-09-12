import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from "class-validator";
import { ORDER_UNIT_TYPES } from "../order-units";
import { RECURRING_FREQUENCIES } from "../recurring-orders.service";

/**
 * A standing order: what to re-buy, from whom, and how often.
 *
 * WHY THIS DTO EXISTS AT ALL
 *
 * `RecurringOrdersController` typed its body as
 * `Omit<RecurringOrderTemplate, ...>` — a TypeScript type, which is erased at
 * runtime and validates nothing. So `apps/web`'s form could POST `wine_id`,
 * `preferred_providers`, `negotiated_price`, `manager_override_price` and four
 * other fields this table has never had; the service silently ignored the ones
 * it did not name and the update path spread the rest straight into an UPDATE,
 * where they failed the whole statement with a 42703.
 *
 * A field this endpoint cannot honour is now REFUSED by name rather than
 * accepted and dropped. That is the same rule applied to `RetroactiveOrderDto`
 * in this change, and it is the difference between a user learning their price
 * override did not save and a user believing it did.
 */
export class CreateRecurringOrderDto {
  @ApiProperty({
    description:
      "The restaurant_inventory row to re-order. A uuid — the old `wine_id` " +
      "varchar could not reach ProcurementService.createOrder, whose inventory_id " +
      "is uuid NOT NULL.",
    format: "uuid",
  })
  @IsUUID()
  inventory_id: string;

  @ApiProperty({
    description:
      "The vendor to order from. One provider, not the old `preferred_providers` " +
      "array of names: an order needs exactly one provider_id, and resolving a name " +
      "list can match zero vendors or two.",
    format: "uuid",
  })
  @IsUUID()
  provider_id: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description: "Purchase unit. Omitted means bottles.",
    enum: ORDER_UNIT_TYPES as unknown as string[],
  })
  @IsString()
  @IsOptional()
  unit_type?: string;

  @ApiPropertyOptional({
    description:
      "Bottles in one purchase unit. REQUIRED when unit_type is case, pack or " +
      "split_case — otherwise the schedule is un-materialisable and the 8 AM cron " +
      "would be refused every morning forever.",
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  bottles_per_unit?: number;

  @ApiPropertyOptional({
    description: "Target price per bottle, used as the order's opening price.",
  })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  target_price?: number;

  @ApiProperty({ enum: RECURRING_FREQUENCIES as unknown as string[] })
  @IsIn(RECURRING_FREQUENCIES as unknown as string[])
  frequency: (typeof RECURRING_FREQUENCIES)[number];

  @ApiPropertyOptional({
    description:
      "Weekly/biweekly: day of week, 0=Mon..6=Sun. Monthly/quarterly: day of month, 1-28. " +
      "Ignored for daily.",
    minimum: 0,
    maximum: 28,
  })
  @IsInt()
  @Min(0)
  @Max(28)
  @IsOptional()
  frequency_day?: number;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  auto_approve?: boolean;

  @ApiProperty({ description: "First order date, YYYY-MM-DD" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "next_order_date must be YYYY-MM-DD",
  })
  next_order_date: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional({
    description:
      "Free-text note. Carried onto every order this schedule materialises as part of " +
      "manager_notes — it is not a field that is stored and never read.",
  })
  @IsString()
  @IsOptional()
  notes?: string;
}

/** Every field of the create DTO, all optional. Same refusal rules. */
export class UpdateRecurringOrderDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsUUID()
  @IsOptional()
  inventory_id?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsUUID()
  @IsOptional()
  provider_id?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @ApiPropertyOptional({ enum: ORDER_UNIT_TYPES as unknown as string[] })
  @IsString()
  @IsOptional()
  unit_type?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  bottles_per_unit?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsPositive()
  @IsOptional()
  target_price?: number;

  @ApiPropertyOptional({ enum: RECURRING_FREQUENCIES as unknown as string[] })
  @IsIn(RECURRING_FREQUENCIES as unknown as string[])
  @IsOptional()
  frequency?: (typeof RECURRING_FREQUENCIES)[number];

  @ApiPropertyOptional({ minimum: 0, maximum: 28 })
  @IsInt()
  @Min(0)
  @Max(28)
  @IsOptional()
  frequency_day?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  auto_approve?: boolean;

  @ApiPropertyOptional({ description: "YYYY-MM-DD" })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: "next_order_date must be YYYY-MM-DD",
  })
  @IsOptional()
  next_order_date?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  notes?: string;
}
