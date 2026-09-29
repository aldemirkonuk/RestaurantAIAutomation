import { ArgumentMetadata, ValidationPipe } from "@nestjs/common";
import {
  UpdateFeatureFlagsDto,
  FeatureFlagsDto,
} from "./dto/feature-flags.dto";
import { ACTIVE_FEATURE_FLAG_KEYS } from "./feature-flag-registry";

/**
 * ADR 0236. `updateFeatureFlags` (`settings.service.ts:95`) reads every key in
 * `ACTIVE_FEATURE_FLAG_KEYS` off the request body, but the global pipe
 * (`main.ts:53-57`, `whitelist: true, forbidNonWhitelisted: true`) sits in
 * front of the controller and only lets through properties the DTO class
 * decorates. `settings.service.spec.ts` and `flag-writes-are-role-gated.spec.ts`
 * both call the service/controller method directly, so neither runs a body
 * through the pipe — which is how a registry key the DTO did not declare
 * shipped as a Settings toggle that answers 400.
 *
 * MEASURED on origin/main 2ba1326e3 (2026-09-28), before the fix: this pipe,
 * given `{ mudavym_design_arrival: true }` against `UpdateFeatureFlagsDto`,
 * threw `400 "property mudavym_design_arrival should not exist"` — the exact
 * body `useSettingsNextData.ts` `saveFlag` sends for the Arrival toggle
 * `FeaturesSection.tsx` renders.
 */

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const body = (metatype: ArgumentMetadata["metatype"]): ArgumentMetadata => ({
  type: "body",
  metatype,
  data: "",
});

const UPDATE = body(UpdateFeatureFlagsDto);

describe("UpdateFeatureFlagsDto through the REAL global ValidationPipe", () => {
  it("accepts the Arrival toggle's body — the 400 this ADR was opened for", async () => {
    // If mudavym_design_arrival is retired from ACTIVE_FEATURE_FLAGS (an open
    // founder question), delete this case; the registry-driven cases below
    // keep the guarantee.
    await expect(
      pipe.transform({ mudavym_design_arrival: true }, UPDATE),
    ).resolves.toEqual({ mudavym_design_arrival: true });
  });

  it("accepts every ACTIVE_FEATURE_FLAG_KEYS entry, one request per key", async () => {
    expect(ACTIVE_FEATURE_FLAG_KEYS.length).toBeGreaterThan(0);
    for (const key of ACTIVE_FEATURE_FLAG_KEYS) {
      await expect(pipe.transform({ [key]: false }, UPDATE)).resolves.toEqual({
        [key]: false,
      });
    }
  });

  it("accepts a key added to the registry later without the DTO being edited", async () => {
    // Load the DTO module against a registry that carries one more key than
    // today's, the way the next page team would add one.
    const FUTURE = "mudavym_design_future_page_probe";
    let FreshDto: unknown;
    jest.isolateModules(() => {
      jest.doMock("./feature-flag-registry", () => {
        const real = jest.requireActual("./feature-flag-registry");
        return {
          ...real,
          ACTIVE_FEATURE_FLAG_KEYS: [...real.ACTIVE_FEATURE_FLAG_KEYS, FUTURE],
        };
      });
      // requireActual loads the real DTO module; its own import of the
      // registry still resolves to the doMock above.
      FreshDto = jest.requireActual<typeof import("./dto/feature-flags.dto")>(
        "./dto/feature-flags.dto",
      ).UpdateFeatureFlagsDto;
    });
    jest.dontMock("./feature-flag-registry");
    await expect(
      pipe.transform({ [FUTURE]: true }, body(FreshDto as never)),
    ).resolves.toEqual({ [FUTURE]: true });
  });

  it("still rejects a key the registry does not carry — the whitelist survives", async () => {
    await expect(
      pipe.transform({ not_a_real_flag: true }, UPDATE),
    ).rejects.toMatchObject({
      response: {
        statusCode: 400,
        message: ["property not_a_real_flag should not exist"],
      },
    });
  });

  it("still rejects a demoted LIVE_IN_CODE key — only ACTIVE keys are settable", async () => {
    await expect(
      pipe.transform({ mudavym_design_dashboard: true }, UPDATE),
    ).rejects.toMatchObject({
      response: {
        message: ["property mudavym_design_dashboard should not exist"],
      },
    });
  });

  it("still rejects a registry key of the wrong type", async () => {
    await expect(
      pipe.transform({ mudavym_design_arrival: "on" }, UPDATE),
    ).rejects.toMatchObject({ response: { statusCode: 400 } });
  });

  it("one unknown key fails the whole request, not just itself", async () => {
    await expect(
      pipe.transform(
        { mudavym_design_arrival: true, also_unknown: true },
        UPDATE,
      ),
    ).rejects.toMatchObject({
      response: { message: ["property also_unknown should not exist"] },
    });
  });
});

describe("FeatureFlagsDto through the real pipe (response shape)", () => {
  it("accepts a full registry-shaped object", async () => {
    const flags = Object.fromEntries(
      ACTIVE_FEATURE_FLAG_KEYS.map((key) => [key, false]),
    );
    await expect(pipe.transform(flags, body(FeatureFlagsDto))).resolves.toEqual(
      flags,
    );
  });
});
