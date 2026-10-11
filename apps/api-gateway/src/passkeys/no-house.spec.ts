import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { OrganizationsController } from "../organizations/organizations.controller";
import { PasskeysController } from "./passkeys.controller";

/**
 * F-1262: a passkey is the person's, not the house's (ADR 0229, round 7, item
 * 44), so a session in no house may enrol, list, check and revoke one.
 *
 * Driven through the real `JwtAuthGuard` with the real `Reflector` and the
 * real controller classes, so the marker is read where the guard reads it --
 * the passkeys service specs call the service directly and never meet the
 * guard, which is how the 403 went unseen.
 */
function guardFor(cls: any, handler: string) {
  const guard = new JwtAuthGuard(new Reflector(), {
    isBlacklisted: jest.fn().mockResolvedValue(false),
  } as any);
  // Stand in for passport: report success and leave `request.user` as seeded.
  const parent = Object.getPrototypeOf(Object.getPrototypeOf(guard));
  jest.spyOn(parent, "canActivate").mockResolvedValue(true as any);
  const request: any = {
    headers: {},
    params: {},
    query: {},
    body: {},
    user: { userId: "u1", emailVerified: true, restaurantId: null, role: null },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => cls.prototype[handler],
    getClass: () => cls,
  } as any;
  return guard.canActivate(context);
}

describe("a session in no house and its own passkeys (F-1262)", () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    "list",
    "startRegistration",
    "sendStepUpCode",
    "finishRegistration",
    "revoke",
    "startCheck",
    "finishCheck",
  ])("is let through to PasskeysController.%s", async (handler) => {
    await expect(guardFor(PasskeysController, handler)).resolves.toBe(true);
  });

  it("is still refused a house's route, with HOUSE_REQUIRED", async () => {
    const err = await guardFor(OrganizationsController, "getChains").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "HOUSE_REQUIRED",
    });
  });
});
