import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";
import { ACTIVE_FEATURE_FLAG_KEYS } from "../feature-flag-registry";

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

  // See the dynamic-decoration block below the class — every other
  // ACTIVE_FEATURE_FLAG_KEYS entry (the mudavym_design_* redesign flags) is a
  // real key on a response object of this shape, just not one of the three
  // hand-written above.
  [key: string]: boolean;
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

  // See the dynamic-decoration block below — every other
  // ACTIVE_FEATURE_FLAG_KEYS entry (the mudavym_design_* redesign flags) is
  // accepted here too, just not one of the three hand-written above.
  [key: string]: boolean | undefined;
}

/**
 * MEASURED, NOT ASSUMED (2026-09-17): a real `ValidationPipe` built with
 * `main.ts`'s exact config (`whitelist: true, forbidNonWhitelisted: true,
 * transform: true`) run against `UpdateFeatureFlagsDto` with a body of
 * `{ mudavym_design_dashboard: true }` returned
 * `400 "property mudavym_design_dashboard should not exist"` — the mudavym
 * redesign toggles in `FeaturesSection.tsx` could not be saved through the
 * real HTTP API at all, only through direct-service unit tests that bypass
 * the pipe. See `settings/feature-flags-dto-validation.spec.ts`.
 *
 * The three flags above are hand-declared because they carry a real per-flag
 * description worth showing in Swagger and to a reviewer reading this file.
 * The other twenty-one-and-growing keys are `mudavym_design_<page>` — one
 * per rebuilt page, added to `ACTIVE_FEATURE_FLAGS` by whichever page team
 * ships next (`feature-flag-registry.ts`) — and hand-adding a property here
 * every time is exactly the kind of drift that produced this bug: the
 * registry already grew to include `mudavym_design_logs` (2026-09-12) after
 * this DTO was last hand-edited (2026-09-05), and the two silently went out
 * of sync.
 *
 * So the remaining keys are decorated here, from the registry, once, at
 * module load — the same effect as writing `@IsOptional() @IsBoolean()` by
 * hand for each, applied programmatically because the list is the registry's
 * to own. `class-validator`'s decorators are plain functions that register
 * metadata on the prototype; calling them directly is identical to using the
 * `@decorator` syntax, and it is what lets `ACTIVE_FEATURE_FLAG_KEYS` stay
 * the single source of truth for "which keys does this route accept" instead
 * of a second hand-kept list that can drift from the first one again.
 */
const HAND_DECLARED_FLAG_KEYS = new Set<string>([
  "enable_ai_negotiation",
  "enable_ai_autonomous_send",
  "enable_house_inbox_read",
]);

for (const key of ACTIVE_FEATURE_FLAG_KEYS) {
  if (HAND_DECLARED_FLAG_KEYS.has(key)) continue;

  ApiProperty({ description: `Declared active by the feature-flag registry.` })(
    FeatureFlagsDto.prototype,
    key,
  );
  IsBoolean()(FeatureFlagsDto.prototype, key);

  ApiPropertyOptional({
    description: `Declared active by the feature-flag registry.`,
  })(UpdateFeatureFlagsDto.prototype, key);
  IsOptional()(UpdateFeatureFlagsDto.prototype, key);
  IsBoolean()(UpdateFeatureFlagsDto.prototype, key);
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
