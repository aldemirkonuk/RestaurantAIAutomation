import "reflect-metadata";
import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { AskAiController } from "./ask-ai.controller";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import {
  AUTHED_RATE_LIMIT_KEY,
  AuthedRateLimitGuard,
  AuthedRateLimitRule,
} from "../common/rate-limit/authed-rate-limit.guard";
import { ConfirmDto, ProposeDto } from "./dto/ask-ai.dto";

/**
 * Four faults were measured on this controller on 2026-09-12 and closed the
 * same day. Each was invisible in exactly the same way: the defence LOOKED
 * present. A global ValidationPipe was installed and validated nothing here; a
 * global rate limiter was bound and could not see who was calling; a spend
 * ceiling existed and never saw a first call; a guard was declared and did not
 * check a role.
 *
 * So these tests do not test behaviour — the guards have their own suites for
 * that. They assert the WIRING, because the wiring is what was missing, and a
 * decorator silently deleted in a refactor is the way it comes back.
 */
describe("Ask AI is gated, and the gating is wired to the routes", () => {
  const guards = (): any[] =>
    Reflect.getMetadata("__guards__", AskAiController) ?? [];

  it("the controller is guarded by JWT, the authenticated limiter, and roles", () => {
    const names = guards().map((g: any) => g?.name ?? String(g));
    expect(names).toContain(JwtAuthGuard.name);
    expect(names).toContain(AuthedRateLimitGuard.name);
    expect(names).toContain(RolesGuard.name);
  });

  it("JwtAuthGuard runs FIRST — the other two read request.user", () => {
    // Not a style preference. AuthedRateLimitGuard keys on userId and
    // RolesGuard reads user.role; both see nothing if they run first.
    // AuthedRateLimitGuard fails closed in that case, so a reordering
    // surfaces as a refusal rather than as a silently absent limit -- this
    // test is what catches it before that happens in production.
    const names = guards().map((g: any) => g?.name ?? String(g));
    expect(names.indexOf(JwtAuthGuard.name)).toBe(0);
    expect(names.indexOf(AuthedRateLimitGuard.name)).toBeGreaterThan(0);
    expect(names.indexOf(RolesGuard.name)).toBeGreaterThan(0);
  });

  it("propose declares a per-person AND a per-house limit", () => {
    const rules: AuthedRateLimitRule[] = Reflect.getMetadata(
      AUTHED_RATE_LIMIT_KEY,
      AskAiController.prototype.propose,
    );
    expect(Array.isArray(rules)).toBe(true);
    const scopes = rules.map((r) => r.scope);
    expect(scopes).toContain("user");
    expect(scopes).toContain("restaurant");
    // The per-house rule is the one that stops several members each running
    // at their own per-person limit, so it must be the wider window.
    const user = rules.find((r) => r.scope === "user")!;
    const house = rules.find((r) => r.scope === "restaurant")!;
    expect(house.windowSeconds).toBeGreaterThan(user.windowSeconds);
    // A limit nobody could ever reach is not a limit. Measured against the
    // global default this route used to fall through to: 100 per minute.
    expect(user.limit).toBeLessThan(100);
  });

  it.each(["sealChallenge", "sealedConfirm"])(
    "%s — the only way to apply a proposal — is owner-or-manager, not any member",
    (handler) => {
      const roles: string[] = Reflect.getMetadata(
        ROLES_KEY,
        (AskAiController.prototype as any)[handler],
      );
      expect(roles).toEqual(expect.arrayContaining(["owner", "manager"]));
      expect(roles).not.toContain("staff");
    },
  );

  it("propose and the sealed routes take DTO CLASSES, so ValidationPipe has a metatype", () => {
    // The original fault in one line: an inline TypeScript type erases, Nest
    // hands ValidationPipe `Object`, and the pipe returns the body untouched.
    // `design:paramtypes` is what the pipe reads, so that is what is asserted.
    const proposeParams = Reflect.getMetadata(
      "design:paramtypes",
      AskAiController.prototype,
      "propose",
    );
    // Position 0 is the @Body(). Position 1 is @CurrentUser(), whose type is
    // a TS alias and therefore legitimately erases to Object — the pipe never
    // sees it, because a custom param decorator is not a body.
    expect(proposeParams[0]).toBe(ProposeDto);

    // The edit travels in both sealed bodies: minted on, then carried back.
    for (const handler of ["sealChallenge", "sealedConfirm"]) {
      const params = Reflect.getMetadata(
        "design:paramtypes",
        AskAiController.prototype,
        handler,
      );
      expect(params).toContain(ConfirmDto);
    }
  });

  it("the real ValidationPipe refuses the bodies it used to wave through", async () => {
    // Not a metadata assertion: this constructs the pipe with main.ts's exact
    // options and runs it, because the fault was never "no decorators" — it
    // was that the pipe could not reach them. class-validator stores its
    // metadata in module-level storage rather than on the class, so reading
    // the class proves nothing either way. Running the pipe proves both.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const meta = { type: "body" as const, metatype: ProposeDto };

    // A real ask passes and arrives as an instance, not a bare object.
    const ok = await pipe.transform({ utterance: "order more rakı" }, meta);
    expect(ok).toBeInstanceOf(ProposeDto);
    expect(ok.utterance).toBe("order more rakı");

    // An absent utterance is refused here rather than reaching the service.
    await expect(pipe.transform({}, meta)).rejects.toThrow(BadRequestException);

    // The wrong type is refused.
    await expect(
      pipe.transform({ utterance: { $ne: null } }, meta),
    ).rejects.toThrow(BadRequestException);

    // An unbounded string is what used to reach the model prompt.
    await expect(
      pipe.transform({ utterance: "x".repeat(2001) }, meta),
    ).rejects.toThrow(BadRequestException);

    // forbidNonWhitelisted only bites when the pipe has a metatype, which is
    // the whole point of this change.
    await expect(
      pipe.transform(
        { utterance: "hello", model: "something-expensive" },
        meta,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("an inline type is what the pipe CANNOT validate — the original fault", async () => {
    // The control for the test above. With `Object` as the metatype — which
    // is what `@Body() body: { utterance?: string }` compiles to — the very
    // same pipe returns the very same hostile body untouched. This is the
    // defect, reproduced, so that reverting the DTO fails a committed test.
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const hostile = { utterance: "x".repeat(50_000), model: "anything" };
    const out = await pipe.transform(hostile, {
      type: "body",
      metatype: Object,
    });
    expect(out).toEqual(hostile);
  });

  it("the sealed routes' payload is validated as an object, not trusted as one", async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const meta = { type: "body" as const, metatype: ConfirmDto };
    // Absent payload is legitimate — applying without edits.
    await expect(pipe.transform({}, meta)).resolves.toBeInstanceOf(ConfirmDto);
    // A non-object payload is not.
    await expect(
      pipe.transform({ payload: "not-an-object" }, meta),
    ).rejects.toThrow(BadRequestException);
    // An unknown top-level field is refused rather than carried along.
    await expect(
      pipe.transform({ payload: {}, restaurantId: "someone-elses" }, meta),
    ).rejects.toThrow(BadRequestException);
  });
});
