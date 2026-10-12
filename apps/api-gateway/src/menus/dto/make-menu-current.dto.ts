import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

/** The owner's answer to one wine at two prices (ADR 0340 rule 19, S198). */
export class MenuPricePickDto {
  @ApiProperty({
    description: "The conflict's `wineLibraryId`, as the plan serves it.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  wineLibraryId: string;

  @ApiProperty({ enum: ["bottle", "glass"] })
  @IsIn(["bottle", "glass"])
  kind: "bottle" | "glass";

  @ApiProperty({ description: "One of the prices the conflict shows." })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  price: number;
}

/**
 * The body of `POST /menu-versions/:menuId/make-current` (ADR 0193 round 3,
 * L13): the fingerprint of the plan the person was shown. The gateway
 * recomputes the plan and refuses (409, nothing changed) when it differs, so
 * no menu becomes current on a plan nobody saw -- an old client, onboarding,
 * or a page left open while a price or a lock moved.
 */
export class MakeMenuCurrentDto {
  @ApiProperty({ description: "GET /menu-versions/:menuId/plan's `fingerprint`, exactly as served." })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  fingerprint: string;

  @ApiPropertyOptional({
    description:
      "True when the person confirmed making current a menu that was read only in part (the plan's `partRead`). Without it such a menu is refused, nothing changed (F-1292).",
  })
  @IsOptional()
  @IsBoolean()
  partReadAccepted?: boolean;

  @ApiPropertyOptional({
    description:
      "ADR 0340 rule 20: the other menus that go live with this one, one per kind (Drinks, Food, Desserts). Omitted: this menu alone.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsUUID("all", { each: true })
  menuIds?: string[];

  @ApiPropertyOptional({
    description:
      "ADR 0340 rule 19: one price per conflict the plan shows. Each is written on the batch's drafts only, before the switch; never on a live line.",
    type: [MenuPricePickDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MenuPricePickDto)
  picks?: MenuPricePickDto[];

  @ApiPropertyOptional({
    description:
      "ADR 0340 rule 17: the kinds whose part-read menu the person confirmed making live.",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(["beverage", "food", "desserts"], { each: true })
  partReadAcceptedKinds?: string[];
}
