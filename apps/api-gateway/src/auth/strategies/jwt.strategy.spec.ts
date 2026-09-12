import { UnauthorizedException } from "@nestjs/common";
import { JwtStrategy } from "./jwt.strategy";
import type { JwtPayload } from "../auth.service";

/**
 * OD-79: `validate()` builds the `request.user` every guard and controller
 * reads. It dropped `emailVerified`, so no server-side check could exist even
 * if one were written — the field simply was not there to check.
 */
function makeStrategy(userRow: Record<string, unknown> | null) {
  const authService = {
    validateJwtPayload: jest.fn().mockResolvedValue(userRow),
  } as any;
  return new JwtStrategy(authService);
}

const payload = (over: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: "u1",
  email: "a@b.com",
  role: "manager",
  restaurantId: "r1",
  ...over,
});

describe("JwtStrategy.validate — emailVerified", () => {
  it("carries emailVerified: true through to request.user", async () => {
    const strategy = makeStrategy({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      role: "manager",
      restaurant_id: "r1",
      email_verified: true,
    });

    const user = await strategy.validate(payload());
    expect(user.emailVerified).toBe(true);
  });

  it("carries emailVerified: false, not undefined", async () => {
    const strategy = makeStrategy({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      role: "manager",
      restaurant_id: "r1",
      email_verified: false,
    });

    const user = await strategy.validate(payload());
    expect(user.emailVerified).toBe(false);
    expect(user.emailVerified).not.toBeUndefined();
  });

  it("prefers the database row over a stale token claim", async () => {
    // A user who verified after their last login holds a token still saying
    // false for up to 15 minutes. The row is authoritative.
    const strategy = makeStrategy({
      user_id: "u1",
      email: "a@b.com",
      name: "Ada",
      role: "manager",
      restaurant_id: "r1",
      email_verified: true,
    });

    const user = await strategy.validate(payload({ emailVerified: false }));
    expect(user.emailVerified).toBe(true);
  });

  it("still rejects an unknown user", async () => {
    const strategy = makeStrategy(null);
    await expect(strategy.validate(payload())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
