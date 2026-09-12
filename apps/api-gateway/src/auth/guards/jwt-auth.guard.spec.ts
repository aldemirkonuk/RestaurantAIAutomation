import { ForbiddenException } from "@nestjs/common";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { ALLOW_UNVERIFIED_KEY } from "../decorators/allow-unverified.decorator";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

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
      guard.canActivate(makeContext({ userId: "u1", emailVerified: true })),
    ).resolves.toBe(true);
  });

  it("admits an unverified user on an @AllowUnverified route", async () => {
    const guard = makeGuard({ [ALLOW_UNVERIFIED_KEY]: true });
    stubPassport(guard);

    await expect(
      guard.canActivate(makeContext({ userId: "u1", emailVerified: false })),
    ).resolves.toBe(true);
  });

  it("does not touch @Public routes", async () => {
    const guard = makeGuard({ [IS_PUBLIC_KEY]: true });
    const passport = stubPassport(guard);

    await expect(guard.canActivate(makeContext(null))).resolves.toBe(true);
    expect(passport).not.toHaveBeenCalled();
  });
});
