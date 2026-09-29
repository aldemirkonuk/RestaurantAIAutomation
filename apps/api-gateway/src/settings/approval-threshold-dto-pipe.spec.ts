import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { SettingsController } from "./settings.controller";

/**
 * PUT /settings/approval-thresholds — the body must survive the global pipe.
 *
 * The fault this pins (web endpoint sweep 2026-09-28, row 23): `enabled` on
 * `SetApprovalThresholdDto` carried only `@ApiProperty`, no class-validator
 * decorator. Under `whitelist: true` a property with no validation metadata is
 * not whitelisted, and `forbidNonWhitelisted: true` turns that into a 400
 * ("property enabled should not exist"). The web page always sends `enabled`
 * (apps/web/src/pages/settings/next/ThresholdsSection.tsx:190, :301), and the
 * service writes it straight to the row (approval-thresholds.service.ts
 * `write`, `enabled: dto.enabled`), so the field is meant to exist and every
 * save was refused.
 *
 * The test reads the metatype the compiler emitted for the handler's @Body()
 * and runs the same pipe config main.ts installs, so it fails for exactly
 * that reason.
 */

// Mirrors apps/api-gateway/src/main.ts (app.useGlobalPipes).
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function bodyMetatype(): any {
  const types = Reflect.getMetadata(
    "design:paramtypes",
    SettingsController.prototype,
    "setApprovalThreshold",
  );
  // (restaurantId, dto, userId) — the body is the second parameter.
  return types?.[1];
}

const validateBody = (value: unknown) =>
  pipe.transform(value, {
    type: "body",
    metatype: bodyMetatype(),
    data: "",
  } as any);

// The exact body the web page sends from the toggle and the editor.
const WEB_BODY = {
  rule: "manager_ceiling",
  enabled: true,
  amountLimit: 500,
  percentLimit: null,
  requiredRole: "owner",
};

describe("PUT /settings/approval-thresholds — body through the real ValidationPipe", () => {
  it("declares a class DTO, so the global pipe actually runs", () => {
    expect(bodyMetatype()).toBeDefined();
    expect(bodyMetatype()).not.toBe(Object);
  });

  it.each<[string, Record<string, unknown>]>([
    ["the editor's save (enabled: true)", WEB_BODY],
    ["the toggle switching a rule off (enabled: false)", { ...WEB_BODY, enabled: false }],
    [
      "a price_jump rule",
      { rule: "price_jump", enabled: true, amountLimit: null, percentLimit: 15, requiredRole: "manager" },
    ],
  ])("accepts %s and keeps enabled intact", async (_, body) => {
    const out = await validateBody(body);
    expect(out.enabled).toBe(body.enabled);
    expect(out.rule).toBe(body.rule);
  });

  it.each<[string, unknown]>([
    ["a missing enabled", { rule: "new_vendor", requiredRole: "owner" }],
    ["a string enabled", { ...WEB_BODY, enabled: "true" }],
    ["a numeric enabled", { ...WEB_BODY, enabled: 1 }],
    ["a null enabled", { ...WEB_BODY, enabled: null }],
    ["an unknown extra field", { ...WEB_BODY, setBy: "someone" }],
  ])("refuses %s with 400", async (_, body) => {
    await expect(validateBody(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
