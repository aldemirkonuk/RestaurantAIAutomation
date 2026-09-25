/**
 * The house shell's two aggregate reads admit a MEMBER of the house the token
 * names, and nobody else (ADR 0162: "null is no role, and `@Roles` refuses
 * it").
 *
 * WHY THIS EXISTS
 * ---------------
 * `JwtStrategy.validate` fills `req.user.role` with the role IN THE TOKEN'S
 * HOUSE, and null when the person holds no active access row there — a member
 * whose access was deactivated while their token still names the house. Both
 * routes were `JwtAuthGuard` only, so such a session read the house's counter
 * (orders, replies, proposals, and the identity queue whose own route refuses
 * it) and the day's ticks. One aggregate read must never be a wider door than
 * the reads it sums.
 *
 * The guard below is the REAL `RolesGuard`, run over the REAL metadata on the
 * two controllers — nothing here is a stand-in for the unit under test.
 */
import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { HouseCounterController } from "./house-counter.controller";
import { HouseDayController } from "./house-day.controller";

function contextFor(
  controller: new (...args: any[]) => unknown,
  handler: (...args: any[]) => unknown,
  role: string | null | undefined,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { userId: "u-1", restaurantId: "house-a", role },
      }),
    }),
  } as unknown as ExecutionContext;
}

const ROUTES: Array<
  [string, new (...args: any[]) => unknown, (...args: any[]) => unknown]
> = [
  [
    "GET /house/counter",
    HouseCounterController,
    HouseCounterController.prototype.read,
  ],
  ["GET /house/day", HouseDayController, HouseDayController.prototype.read],
];

describe.each(ROUTES)("%s", (_name, controller, handler) => {
  const guard = new RolesGuard(new Reflector());

  it("runs JwtAuthGuard, then RolesGuard, and asks for a member's role", () => {
    const guards: unknown[] =
      Reflect.getMetadata("__guards__", controller) ?? [];
    expect(guards[0]).toBe(JwtAuthGuard);
    expect(guards.indexOf(RolesGuard)).toBeGreaterThan(0);
    expect(Reflect.getMetadata(ROLES_KEY, controller)).toEqual([
      "owner",
      "manager",
      "staff",
    ]);
  });

  it.each(["owner", "manager", "staff", "admin", "STAFF"])(
    "admits a %s of the house",
    (role) => {
      expect(guard.canActivate(contextFor(controller, handler, role))).toBe(
        true,
      );
    },
  );

  it.each([
    ["null (no active access row in the token's house)", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["an unknown role", "guest"],
  ])("refuses a session whose role is %s", (_label, role) => {
    expect(guard.canActivate(contextFor(controller, handler, role))).toBe(
      false,
    );
  });
});
