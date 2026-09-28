import { ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import {
  UpdateFeatureFlagsDto,
  FeatureFlagsDto,
} from "./dto/feature-flags.dto";
import { ACTIVE_FEATURE_FLAG_KEYS } from "./feature-flag-registry";

/**
 * `updateFeatureFlags` (`settings.service.ts:95`) reads every key in
 * `ACTIVE_FEATURE_FLAG_KEYS` off the raw request object. Until now
 * `UpdateFeatureFlagsDto` only declared three of them. `settings.service.spec.ts`
 * calls `updateFeatureFlags()` directly with a plain object, so it could never
 * catch this — the global pipe (`main.ts:51-56`,
 * `whitelist: true, forbidNonWhitelisted: true`) sits in front of the
 * controller, not the service, and no existing test ran a request through it.
 *
 * MEASURED (2026-09-17), before the fix: a real `ValidationPipe` built with
 * `main.ts`'s exact options, given `{ mudavym_design_dashboard: true }`
 * against `UpdateFeatureFlagsDto`, threw
 * `400 "property mudavym_design_dashboard should not exist"`. Every one of
 * the `mudavym_design_*` toggles `FeaturesSection.tsx` renders — and sends as
 * `PUT /settings/feature-flags` with exactly one such key in the body
 * (`useSettingsNextData.ts` `saveFlag`) — was rejected before it ever reached
 * `SettingsController.updateFeatureFlags`. This file pins that path through
 * the real pipe so a future DTO/registry drift fails CI instead of silently
 * shipping a switch that 400s.
 */

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const UPDATE_METADATA: ArgumentMetadata = {
  type: "body",
  metatype: UpdateFeatureFlagsDto,
  data: "",
};

const FLAGS_METADATA: ArgumentMetadata = {
  type: "body",
  metatype: FeatureFlagsDto,
  data: "",
};

describe("UpdateFeatureFlagsDto through the REAL global ValidationPipe", () => {
  it("still declares the registry keys this test assumes exist", () => {
    // If the registry ever drops these, the rest of this file is testing
    // nothing — fail loudly rather than silently passing on an empty list.
    expect(ACTIVE_FEATURE_FLAG_KEYS).toEqual(
      expect.arrayContaining([
        "enable_ai_negotiation",
        "mudavym_design_dashboard",
        "mudavym_design_settings",
      ]),
    );
  });

  it("accepts a body carrying ONLY a mudavym_design_* key — this is exactly what the Settings page sends", async () => {
    const result = await pipe.transform(
      { mudavym_design_dashboard: true },
      UPDATE_METADATA,
    );
    expect(result).toEqual({ mudavym_design_dashboard: true });
  });

  it("accepts enable_ai_negotiation together with a redesign key", async () => {
    const result = await pipe.transform(
      { enable_ai_negotiation: true, mudavym_design_settings: false },
      UPDATE_METADATA,
    );
    expect(result).toEqual({
      enable_ai_negotiation: true,
      mudavym_design_settings: false,
    });
  });

  it("accepts every single ACTIVE_FEATURE_FLAG_KEYS entry, one request per key", async () => {
    for (const key of ACTIVE_FEATURE_FLAG_KEYS) {
      const result = await pipe.transform({ [key]: true }, UPDATE_METADATA);
      expect(result).toEqual({ [key]: true });
    }
  });

  it("still rejects a key the registry does not carry — whitelist protection survives the fix", async () => {
    await expect(
      pipe.transform({ not_a_real_flag: true }, UPDATE_METADATA),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: ["property not_a_real_flag should not exist"],
      },
    });
  });

  it("still rejects a mudavym_design_* key of the wrong type", async () => {
    await expect(
      pipe.transform({ mudavym_design_dashboard: "on" }, UPDATE_METADATA),
    ).rejects.toMatchObject({ response: { statusCode: 400 } });
  });

  it("still refuses an EMPTY body's unknown-and-known mix — a stray unknown key fails the whole request, not just itself", async () => {
    await expect(
      pipe.transform(
        { mudavym_design_dashboard: true, also_unknown: true },
        UPDATE_METADATA,
      ),
    ).rejects.toMatchObject({
      response: { message: ["property also_unknown should not exist"] },
    });
  });
});

describe("FeatureFlagsDto through the real pipe (response shape, defence in depth)", () => {
  it("accepts a full registry-shaped response object", async () => {
    const body = Object.fromEntries(
      ACTIVE_FEATURE_FLAG_KEYS.map((key) => [key, false]),
    );
    const result = await pipe.transform(body, FLAGS_METADATA);
    expect(result).toEqual(body);
  });
});
