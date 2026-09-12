import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";

/**
 * Only flags that a real column stores AND real code branches on appear here.
 * See `../feature-flag-registry.ts` for why the other 21 were removed or
 * demoted, and for what promoting one back would require.
 *
 * This DTO used to carry 22 booleans. None of the 22 columns existed in the
 * database, so every GET returned invented values and every PUT failed.
 */
export class FeatureFlagsDto {
  @ApiProperty({
    description:
      "AI reads and answers vendor email. Off = the responder does not analyse or reply to inbound at all.",
  })
  @IsBoolean()
  enable_ai_negotiation: boolean;

  @ApiProperty({
    description:
      "AI replies go to the vendor WITHOUT human approval, after a 2-minute cancel window, whenever no guardrail trips. Defaults to false and stays false unless explicitly set.",
  })
  @IsBoolean()
  enable_ai_autonomous_send: boolean;

  @ApiProperty({
    description:
      "A scheduled job reads this house's mailbox through a person's Gmail grant. Off = nothing is read; every uncertain answer is treated as off.",
  })
  @IsBoolean()
  enable_house_inbox_read: boolean;
}

export class UpdateFeatureFlagsDto {
  @ApiPropertyOptional({ description: "AI reads and answers vendor email." })
  @IsOptional()
  @IsBoolean()
  enable_ai_negotiation?: boolean;

  @ApiPropertyOptional({
    description: "AI replies send to the vendor without human approval.",
  })
  @IsOptional()
  @IsBoolean()
  enable_ai_autonomous_send?: boolean;

  /**
   * WITHHELD UNTIL THE ROUTE ASKED WHO WAS ASKING.
   *
   * The house-inbox commit `3925cde6` left this key out of this DTO on purpose:
   * `PUT /settings/feature-flags` had no role check, so adding it would have let
   * any authenticated member of a restaurant start a job that reads a
   * colleague's mailbox (ADR 0118 D8-D11, `06-pages/communications.md` §9). The
   * route now runs `assertCanManageRestaurant` like the approval thresholds
   * beside it — the condition that was being waited on — so the key joins the
   * DTO here and the switch finally has a way to be set.
   *
   * The global pipe is `whitelist: true, forbidNonWhitelisted: true`
   * (`main.ts:52-56`), so before this the key was not merely ignored: a body
   * carrying it was rejected outright.
   */
  @ApiPropertyOptional({
    description:
      "A scheduled job reads this house's mailbox through a person's Gmail grant. Owner or manager only.",
  })
  @IsOptional()
  @IsBoolean()
  enable_house_inbox_read?: boolean;
}

export class CheckFeatureFlagDto {
  @ApiProperty({ description: "Restaurant ID" })
  @IsUUID()
  restaurant_id: string;

  @ApiProperty({ description: "Feature flag name" })
  @IsString()
  feature_name: string;
}

export class FeatureFlagCheckResultDto {
  @ApiProperty({ description: "Whether the feature is enabled." })
  enabled: boolean;

  @ApiProperty({
    description:
      "Whether this flag gates anything at all. False means no code reads it, so `enabled` describes nothing — do not present it as a setting.",
  })
  active: boolean;

  @ApiProperty()
  feature_name: string;

  @ApiProperty()
  restaurant_id: string;
}
