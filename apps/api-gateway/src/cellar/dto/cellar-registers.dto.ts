import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { REGISTER_IDS } from "../cellar-registers";

export class CellarRegisterAnswerDto {
  @ApiProperty({ enum: REGISTER_IDS as unknown as string[] })
  @IsIn(REGISTER_IDS as unknown as string[])
  id: string;

  /**
   * REQUIRED, and `false` is a real answer. There is no "unset" here on
   * purpose: to un-answer a register the row is deleted, not written with a
   * third state every reader would then have to guess about.
   */
  @ApiProperty({ description: "Whether the house carries this register" })
  @IsBoolean()
  carried: boolean;
}

export class SetCellarRegistersDto {
  @ApiProperty({ type: [CellarRegisterAnswerDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(REGISTER_IDS.length)
  @ValidateNested({ each: true })
  @Type(() => CellarRegisterAnswerDto)
  registers: CellarRegisterAnswerDto[];

  /**
   * Which act this write records (founder's shape, 2026-09-03: infer → confirm
   * at onboarding → manual switch afterwards).
   *
   *   inferred  — record the machine's proposal. `confirmed_at` stays null and
   *               every surface keeps calling it a guess.
   *   confirmed — a human accepted or edited the proposal at onboarding.
   *   manual    — a human switched a register later, from Settings.
   *
   * Defaults to `confirmed`, the value the onboarding step sends, because that
   * is the only act with a human physically in front of it. It deliberately
   * does NOT default to `inferred`: a write arriving without a source is a
   * human act whose label was forgotten, and recording a human's answer as a
   * machine's guess is the more damaging of the two mistakes — it makes the
   * onboarding step re-ask a house that already answered.
   */
  @ApiPropertyOptional({
    enum: ["inferred", "confirmed", "manual"],
    default: "confirmed",
  })
  @IsIn(["inferred", "confirmed", "manual"])
  source: "inferred" | "confirmed" | "manual" = "confirmed";
}

/**
 * Confirming a zone, or renaming it. `name` absent means "the name as it
 * stands is right"; present and different means a rename. There is no
 * "unconfirm" and no `confirmedBy` on the body — the actor comes from the JWT,
 * because a body cannot name who decided this any more than it can name which
 * restaurant.
 */
export class ConfirmZoneDto {
  @ApiPropertyOptional({
    description: "A new name for the zone. Omit to confirm the name it carries.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
