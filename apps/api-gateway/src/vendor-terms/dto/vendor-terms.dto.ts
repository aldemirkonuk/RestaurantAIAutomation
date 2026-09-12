import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * What a person is stating about one vendor.
 *
 * EVERY FIELD IS OPTIONAL, AND THAT IS THE POINT. Five terms are five separate
 * statements — a house can know a cutoff and have no idea what the minimum is —
 * so the DTO must be able to carry one of them. An absent key means "do not
 * change what is recorded"; an explicit `null` means "the house is withdrawing
 * this statement", which is different and is honoured by the service.
 *
 * `class-validator`'s decorators skip `null` under `IsOptional`, so a null
 * reaches the service intact rather than being rejected as a bad number.
 */
export class SetVendorTermsDto {
  @ApiPropertyOptional({
    description:
      "Days the vendor delivers. 0=Sunday .. 6=Saturday. An empty array states 'no fixed days'; null withdraws the statement.",
    type: [Number],
    example: [1, 3, 5],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  deliveryWeekdays?: number[] | null;

  @ApiPropertyOptional({
    description: "Local clock time the vendor stops taking orders, HH:MM.",
    example: "14:00",
  })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: "orderCutoffTime must be HH:MM on a 24-hour clock",
  })
  orderCutoffTime?: string | null;

  @ApiPropertyOptional({
    description:
      "How many days before the delivery day the cutoff falls. 0 = same day, 1 = the day before.",
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(14)
  orderCutoffOffsetDays?: number | null;

  @ApiPropertyOptional({ description: "Smallest order the vendor will take." })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumOrderAmount?: number | null;

  @ApiPropertyOptional({ description: "Days from order to delivery, as stated." })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  leadTimeDays?: number | null;

  @ApiPropertyOptional({
    description: "Free text: 'Net 30', '2% 10 net 30', 'cash on delivery'.",
    example: "Net 30",
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  paymentTerms?: string | null;

  @ApiPropertyOptional({ description: "Anything the five fields cannot hold." })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/** One threshold rule as the house sets it. */
export class SetApprovalThresholdDto {
  @ApiProperty({
    description: "Which rule. The set is closed by a CHECK constraint.",
    enum: ["manager_ceiling", "new_vendor", "price_jump"],
  })
  @IsString()
  @Matches(/^(manager_ceiling|new_vendor|price_jump)$/)
  rule!: "manager_ceiling" | "new_vendor" | "price_jump";

  @ApiProperty({ description: "Whether the house wants this rule at all." })
  enabled!: boolean;

  @ApiPropertyOptional({
    description: "manager_ceiling only — money above which a manager may not seal alone.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountLimit?: number | null;

  @ApiPropertyOptional({
    description: "price_jump only — percent above the last price paid.",
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  percentLimit?: number | null;

  @ApiProperty({
    description: "Who has to sign when the rule fires.",
    enum: ["owner", "manager"],
  })
  @IsString()
  @Matches(/^(owner|manager)$/)
  requiredRole!: "owner" | "manager";
}
