import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { AuthController } from "./auth.controller";

/**
 * POST /auth/verify-email — the body must be validated before it reaches
 * `.eq("token", token)` on `email_verifications.token`, a `uuid` column
 * (supabase/migrations/20260805000000_baseline_from_production.sql:2736).
 *
 * The fault this pins: the handler declared `@Body() body: { token: string }`.
 * An inline type erases to `Object` in `design:paramtypes`, and the global
 * ValidationPipe skips `Object`, so a malformed, missing, non-string or
 * padded body went straight to the database. The test reads the metatype the
 * compiler actually emitted for the handler, then runs the same pipe main.ts
 * installs, so it fails for exactly that reason and no other.
 */

// Mirrors apps/api-gateway/src/main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const VALID = "3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f";

function bodyMetatype(): any {
  const types = Reflect.getMetadata(
    "design:paramtypes",
    AuthController.prototype,
    "verifyEmail",
  );
  // The body is the SECOND parameter since ADR 0229 fork 12 (item 81): the
  // first is the request, whose session the link now needs.
  return types?.[1];
}

const validateBody = (value: unknown) =>
  pipe.transform(value, {
    type: "body",
    metatype: bodyMetatype(),
    data: "",
  } as any);

describe("POST /auth/verify-email — body validation", () => {
  it("declares a class DTO, so the global ValidationPipe actually runs", () => {
    expect(bodyMetatype()).toBeDefined();
    expect(bodyMetatype()).not.toBe(Object);
  });

  it.each<[string, unknown]>([
    ["a malformed token", { token: "not-a-uuid" }],
    ["a SQL-shaped token", { token: "' OR 1=1 --" }],
    ["a missing token", {}],
    ["an empty token", { token: "" }],
    ["a non-string token", { token: { $ne: null } }],
    ["an array token", { token: [VALID] }],
    ["an unknown extra field", { token: VALID, email: "someone@example.com" }],
  ])("refuses %s with 400 before the database is touched", async (_, body) => {
    await expect(validateBody(body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("keeps the message a bad link already answered with", async () => {
    let caught: any;
    try {
      await validateBody({ token: "not-a-uuid" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const message = (caught.getResponse() as any).message;
    expect(JSON.stringify(message)).toContain("Invalid verification token");
  });

  it("passes the body real clients send ({ token: <uuid> }) through unchanged", async () => {
    const out: any = await validateBody({ token: VALID });
    expect(out.token).toBe(VALID);
  });

  it("hands the token to the service and keeps the response shape", async () => {
    const authService = {
      verifyEmail: jest
        .fn()
        .mockResolvedValue({ accessToken: "a", refreshToken: "r" }),
    };
    const controller = new AuthController(authService as any);
    const body: any = await validateBody({ token: VALID });

    await expect(
      controller.verifyEmail(
        { user: { userId: "u1", restaurantId: "h1" } } as any,
        body,
      ),
    ).resolves.toEqual({
      success: true,
      accessToken: "a",
      refreshToken: "r",
      message: "Email verified",
    });
    // The session's user and house go with the token (ADR 0229 fork 12).
    expect(authService.verifyEmail).toHaveBeenCalledWith(VALID, "u1", "h1");
  });

  it("is a signed-in route that unverified and houseless sessions reach (ADR 0229 fork 12, item 81)", () => {
    const h = AuthController.prototype.verifyEmail;
    expect(Reflect.getMetadata("isPublic", h)).toBeUndefined();
    const guards = Reflect.getMetadata("__guards__", h) ?? [];
    expect(guards.map((g: any) => g.name)).toContain("JwtAuthGuard");
  });
});
