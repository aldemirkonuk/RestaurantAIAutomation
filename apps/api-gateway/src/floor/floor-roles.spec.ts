import "reflect-metadata";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { RolesGuard } from "../auth/guards/roles.guard";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { FloorEnabledGuard } from "./floor-enabled.guard";
import { FloorManagerController } from "./floor-manager.controller";
import { FloorStaffController } from "./floor-staff.controller";
import { floorActorOf } from "./floor-common";

/**
 * ADR 0345 E6: every floor route carries its own `@Roles`, and a staff token
 * is refused on every figure and admin route. E7: the house switch hides the
 * whole floor (404) while it is off, and a failed read counts as off.
 */

const ctx = (handler: object, cls: object, role: string | null, restaurantId = "r1") =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user: { userId: "u", role, restaurantId } }) }),
  }) as any;

const methodsOf = (cls: any): string[] =>
  Object.getOwnPropertyNames(cls.prototype).filter((m) => m !== "constructor");

/**
 * Staff-admitted on the manager controller: Out tonight, lead-checked in the
 * service (OD-242), and merge/split, holder-checked in the service.
 */
const STAFF_ON_MANAGER = new Set(["markOut", "backOn", "merge", "split"]);

describe("floor route roles (E6)", () => {
  const guard = new RolesGuard(new Reflector());

  it("both controllers run JwtAuthGuard, RolesGuard and the switch, in that order", () => {
    for (const cls of [FloorManagerController, FloorStaffController]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, cls)).toEqual([JwtAuthGuard, RolesGuard, FloorEnabledGuard]);
    }
  });

  const figureRoutes = methodsOf(FloorManagerController).filter((m) => !STAFF_ON_MANAGER.has(m));

  it("covers every figure and admin route (no route left unchecked)", () => {
    expect(figureRoutes.sort()).toEqual(
      [
        "apply", "archiveSection", "assign", "assignments", "confirmLink", "createSection", "createTable",
        "foodUps", "getBoard", "patchTable", "posLinks", "propose", "release", "report", "saveSettings",
        "seatingsCsv", "sections", "setSectionTables", "settings", "unlink", "updateSection", "waitersCsv",
      ].sort(),
    );
  });

  it.each(figureRoutes)("a staff token is refused on /floor %s; owners and managers pass", (m) => {
    const h = (FloorManagerController.prototype as any)[m];
    expect(guard.canActivate(ctx(h, FloorManagerController, "staff"))).toBe(false);
    expect(guard.canActivate(ctx(h, FloorManagerController, null))).toBe(false);
    expect(guard.canActivate(ctx(h, FloorManagerController, "admin"))).toBe(false);
    expect(guard.canActivate(ctx(h, FloorManagerController, "owner"))).toBe(true);
    expect(guard.canActivate(ctx(h, FloorManagerController, "manager"))).toBe(true);
  });

  it.each([...STAFF_ON_MANAGER])("%s admits staff at the role gate (the lead or holder check is the service's)", (m) => {
    const h = (FloorManagerController.prototype as any)[m];
    expect(guard.canActivate(ctx(h, FloorManagerController, "staff"))).toBe(true);
    expect(guard.canActivate(ctx(h, FloorManagerController, "admin"))).toBe(false);
  });

  it.each(methodsOf(FloorStaffController))("/floor/me %s admits owner, manager and staff only", (m) => {
    const h = (FloorStaffController.prototype as any)[m];
    for (const r of ["owner", "manager", "staff"]) expect(guard.canActivate(ctx(h, FloorStaffController, r))).toBe(true);
    expect(guard.canActivate(ctx(h, FloorStaffController, "admin"))).toBe(false);
    expect(guard.canActivate(ctx(h, FloorStaffController, null))).toBe(false);
  });
});

describe("floor house switch (E7)", () => {
  const dbWith = (result: { data: unknown; error: unknown } | "throw") => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => {
        if (result === "throw") throw new Error("network");
        return result;
      },
    };
    return { supabase: { from: () => builder } } as any;
  };
  const run = (db: any, rid = "r1") => new FloorEnabledGuard(db).canActivate(ctx(() => 0, Object, "owner", rid));

  it("passes when the switch is on", async () => {
    await expect(run(dbWith({ data: { floor_checker: true }, error: null }))).resolves.toBe(true);
  });
  it("404s when the switch is off", async () => {
    await expect(run(dbWith({ data: { floor_checker: false }, error: null }))).rejects.toBeInstanceOf(NotFoundException);
  });
  it("404s when there is no settings row", async () => {
    await expect(run(dbWith({ data: null, error: null }))).rejects.toBeInstanceOf(NotFoundException);
  });
  it("404s when the read fails or throws (fail closed)", async () => {
    await expect(run(dbWith({ data: null, error: { message: "x" } }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(run(dbWith("throw"))).rejects.toBeInstanceOf(NotFoundException);
  });
  it("404s with no house on the token", async () => {
    await expect(run(dbWith({ data: { floor_checker: true }, error: null }), "")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("floorActorOf", () => {
  it("refuses a role outside owner/manager/staff", () => {
    expect(() => floorActorOf({ user: { userId: "u", restaurantId: "r", role: "admin" } })).toThrow(ForbiddenException);
  });
});
