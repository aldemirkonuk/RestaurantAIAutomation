import { ForbiddenException } from "@nestjs/common";
import {
  assertEmailVerified,
  EMAIL_NOT_VERIFIED_CODE,
} from "./assert-email-verified";

/**
 * OD-79. The gate this replaces lived only in the browser and compared a
 * field the API never sent, so it evaluated `undefined === false` forever.
 * These tests exist to make that failure mode impossible to reintroduce
 * silently: each one asserts a REJECTION, so deleting the check fails them.
 */
describe("assertEmailVerified", () => {
  it("allows a verified user", () => {
    expect(() =>
      assertEmailVerified({ user: { emailVerified: true } }, false),
    ).not.toThrow();
  });

  it("blocks an unverified user", () => {
    expect(() =>
      assertEmailVerified({ user: { emailVerified: false } }, false),
    ).toThrow(ForbiddenException);
  });

  it("blocks when the field is missing — fails closed, not open", () => {
    // This is the original bug expressed as a test. `undefined` used to mean
    // "allowed" by accident; here it must mean "cannot tell, so no".
    expect(() => assertEmailVerified({ user: {} }, false)).toThrow(
      ForbiddenException,
    );
  });

  it("carries a machine-readable code so the client can route on it", () => {
    try {
      assertEmailVerified({ user: { emailVerified: false } }, false);
      throw new Error("expected a ForbiddenException");
    } catch (err: any) {
      expect(err.getResponse().code).toBe(EMAIL_NOT_VERIFIED_CODE);
    }
  });

  it("lets an allowlisted route through for an unverified user", () => {
    expect(() =>
      assertEmailVerified({ user: { emailVerified: false } }, true),
    ).not.toThrow();
  });

  it("leaves authentication to JwtAuthGuard when there is no user", () => {
    expect(() => assertEmailVerified({ user: null }, false)).not.toThrow();
  });
});
