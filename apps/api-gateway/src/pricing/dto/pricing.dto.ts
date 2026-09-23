import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";

/**
 * The body of `PUT /pricing/target-margin` (ADR 0193).
 *
 * The bounds are the database's CHECKs verbatim
 * (`20260922230300_a_house_names_its_target_margin.sql`): a value this DTO
 * admits is a value the database admits. They are a UNITS check as much as a
 * range: 0.65, the fraction spelling of a 65 percent margin, is refused with a
 * sentence rather than stored as a 0.65 percent target.
 *
 * `null` for bottle or glass means "no target for that". At least one must be
 * a number (the service refuses the empty write). No field has a default.
 */
export class SetTargetMarginDto {
  @ApiPropertyOptional({
    description:
      "The gross margin this house needs on a BOTTLE, as a PERCENT of the price: 65 means cost is 35 percent of the price. Between 5 and 95. null = no bottle target.",
    example: 65,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(5, { message: "A target margin is a PERCENT between 5 and 95: 65, not 0.65. Nothing was recorded." })
  @Max(95, { message: "A target margin above 95 percent is a cost under a twentieth of the price. Nothing was recorded." })
  bottlePct?: number | null;

  @ApiPropertyOptional({
    description:
      "The gross margin this house needs on a GLASS, as a PERCENT of the glass price. Between 5 and 95. null = no glass target.",
    example: 75,
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(5, { message: "A target margin is a PERCENT between 5 and 95: 75, not 0.75. Nothing was recorded." })
  @Max(95, { message: "A target margin above 95 percent is a cost under a twentieth of the price. Nothing was recorded." })
  glassPct?: number | null;

  @ApiProperty({
    description:
      "\"Close enough\", a PERCENT OF THE ADVISED PRICE: a wine priced within this many percent of its advised price gets no advice. 0 means advise on any difference. Between 0 and 20. Required, no default (founder, 2026-09-21: \"percent is always shown everywhere\").",
    example: 3,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(20)
  bandPct: number;
}

/**
 * The body of `PUT /pricing/pour-size`: the pour this house serves, confirmed
 * once by an owner or manager (founder, 2026-09-21: glass advice appears only
 * after the house confirms its pour size). The bounds are the database
 * CHECK's (20260922230600).
 */
export class ConfirmPourSizeDto {
  @ApiProperty({ description: "The pour this house serves, in ml. Between 10 and 500.", example: 125 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 1 })
  @Min(10)
  @Max(500)
  pourMl: number;
}

/**
 * The body of `POST /pricing/advice/:inventoryId/accept`. It names WHICH
 * advice (bottle or glass) and the price the manager saw; the price that is
 * written is re-computed by the gateway, and a mismatch is refused (409).
 */
export class AcceptPriceAdviceDto {
  @ApiProperty({ enum: ["bottle", "glass"] })
  @IsIn(["bottle", "glass"])
  kind: "bottle" | "glass";

  @ApiProperty({ description: "The advised price exactly as the page showed it.", example: 57.14 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  advisedPrice: number;
}

/**
 * The body of `PUT /pricing/wines/:inventoryId/pour`: ONE wine's own pour,
 * confirmed by an owner or manager (founder, 2026-09-21, round 6c: "Yes,
 * confirmed per wine"). `null` sends the wine back to the house's pour.
 */
export class ConfirmWinePourDto {
  @ApiProperty({
    description: "This wine's pour in ml, between 10 and 500; null = use the house's confirmed pour.",
    example: 75,
    nullable: true,
  })
  @ValidateIf((_o, v) => v !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 1 })
  @Min(10)
  @Max(500)
  pourMl: number | null;
}

/** A person's optional words on a lock act, kept on the lock row. */
class LockNote {
  @ApiPropertyOptional({ description: "Why, in a few words. Kept on the record.", maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** `POST /pricing/locks`: hold the house's price for one kind of one wine, as it is now (ADR 0193 L1, L2). */
export class LockPriceDto extends LockNote {
  @ApiProperty({ description: "The house wine (restaurant_inventory.id)." })
  @IsUUID()
  inventoryId: string;

  @ApiProperty({ enum: ["bottle", "glass"] })
  @IsIn(["bottle", "glass"])
  kind: "bottle" | "glass";
}

/** `POST /pricing/locks/:lockId/release`. Releasing changes no price (L24). */
export class ReleaseLockDto extends LockNote {}

/** `POST /pricing/locks/:lockId/change`: change and keep locked, one act (L6). */
export class ChangeLockedPriceDto extends LockNote {
  @ApiProperty({ description: "The new price, 0 or more.", example: 98 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  price: number;
}

/**
 * `POST /pricing/locks/:lockId/move`: link a lock to another wine of this
 * house (L20). The price is named by the person; there is no default.
 */
export class MoveLockDto extends LockNote {
  @ApiProperty({ description: "The wine of this house the lock moves to (restaurant_inventory.id)." })
  @IsUUID()
  targetInventoryId: string;

  @ApiProperty({ description: "The price the target wine is locked at, 0 or more. Required.", example: 95 })
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  price: number;
}
