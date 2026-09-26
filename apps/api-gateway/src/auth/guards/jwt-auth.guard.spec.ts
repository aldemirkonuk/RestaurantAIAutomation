import { ForbiddenException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { ALLOW_UNVERIFIED_KEY } from "../decorators/allow-unverified.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { ALLOWS_NO_HOUSE_KEY } from "../../common/tenant/allows-no-house.decorator";

/**
 * OD-79 — the wiring test, and the reason it exists.
 *
 * `assert-email-verified.spec.ts` proves the comparison is correct. It cannot
 * prove the guard CALLS it. That distinction is not academic here: the tenant
 * check had a correct comparison sitting in a guard that ran before
 * `request.user` was populated, so it was never reached on any authenticated
 * route, and a fix applied to the comparison itself was inert. This suite
 * drives `canActivate` end to end so a check that is present but unreachable
 * fails visibly.
 */
function makeGuard(metadata: Record<string, boolean>) {
  const reflector = {
    getAllAndOverride: jest.fn(
      (key: string) => metadata[key] as boolean | undefined,
    ),
  } as any;
  const blacklist = { isBlacklisted: jest.fn().mockResolvedValue(false) } as any;
  return new JwtAuthGuard(reflector, blacklist);
}

function makeContext(user: Record<string, unknown> | null) {
  const request: any = { headers: {}, params: {}, query: {}, body: {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any;
}

/** Stand in for passport: report success and leave `request.user` as seeded. */
function stubPassport(guard: JwtAuthGuard, result = true) {
  const parent = Object.getPrototypeOf(Object.getPrototypeOf(guard));
  return jest.spyOn(parent, "canActivate").mockResolvedValue(result as any);
}

describe("JwtAuthGuard — email verification is actually reached", () => {
  afterEach(() => jest.restoreAllMocks());

  it("rejects an authenticated but unverified user", async () => {
    const guard = makeGuard({});
    stubPassport(guard);

    await expect(
      guard.canActivate(makeContext({ userId: "u1", emailVerified: false })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("admits a verified user", async () => {
    const guard = makeGuard({});
    stubPassport(guard);

    await expect(
      guard.canActivate(
        makeContext({ userId: "u1", emailVerified: true, restaurantId: "r1" }),
      ),
    ).resolves.toBe(true);
  });

  it("admits an unverified user on an @AllowUnverified route", async () => {
    const guard = makeGuard({ [ALLOW_UNVERIFIED_KEY]: true });
    stubPassport(guard);

    await expect(
      guard.canActivate(
        makeContext({ userId: "u1", emailVerified: false, restaurantId: "r1" }),
      ),
    ).resolves.toBe(true);
  });

  it("does not touch @Public routes", async () => {
    const guard = makeGuard({ [IS_PUBLIC_KEY]: true });
    const passport = stubPassport(guard);

    await expect(guard.canActivate(makeContext(null))).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });
});

/**
 * ADR 0164, R4: a session in no house reaches only the routes that say it may.
 * The wiring test, for the reason the email one above exists: a check that is
 * present but never called would pass its own unit test.
 */
describe("JwtAuthGuard — a session in no house is held to @AllowsNoHouse routes", () => {
  afterEach(() => jest.restoreAllMocks());

  it("refuses a session in no house on an ordinary route, with HOUSE_REQUIRED", async () => {
    const guard = makeGuard({});
    stubPassport(guard);

    const err = await guard
      .canActivate(makeContext({ userId: "u1", emailVerified: true, restaurantId: null }))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "HOUSE_REQUIRED",
    });
  });

  it("admits a session in no house on an @AllowsNoHouse route", async () => {
    const guard = makeGuard({ [ALLOWS_NO_HOUSE_KEY]: true });
    stubPassport(guard);

    await expect(
      guard.canActivate(
        makeContext({ userId: "u1", emailVerified: true, restaurantId: null }),
      ),
    ).resolves.toBe(true);
  });

  it("sends an unverified person in no house to verify first", async () => {
    const guard = makeGuard({});
    stubPassport(guard);

    const err = await guard
      .canActivate(makeContext({ userId: "u1", emailVerified: false, restaurantId: null }))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: "EMAIL_NOT_VERIFIED",
    });
  });
});
