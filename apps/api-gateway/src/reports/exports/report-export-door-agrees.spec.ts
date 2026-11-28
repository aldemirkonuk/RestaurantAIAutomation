import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { AnalyticsController } from "../../analytics/analytics.controller";
import { ReportExportsController } from "./report-exports.controller";

/**
 * The export door and the page agree on who reads "Margin against movement"
 * (r110 reports-8). The export reader asks `advanced.getMenuEngineering` with
 * no role (report-cutting-reader.service.ts, case "quadrants"): it leans on the
 * door, `RolesGuard` + `@Roles("owner", "manager")` on the class. The page's
 * route answers a reader who does not see money and suppliers as withheld
 * (#2361). So the door must never let in a role the page holds back, or margin
 * per bottle (menu price less lot WAC) leaves by the export.
 */
const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MENU = { items: [{ id: "w1", marginPerBottle: 31.77 }], medians: { marginPerBottle: 28.5 }, counts: {} };
const NO_USER = Symbol("no user on the request");
type Caller = string | null | undefined | typeof NO_USER;

const HANDLERS = Object.getOwnPropertyNames(ReportExportsController.prototype).filter(
  (k) => k !== "constructor" && typeof (ReportExportsController.prototype as any)[k] === "function"
    && Reflect.getMetadata("method", (ReportExportsController.prototype as any)[k]) !== undefined,
);

function doorAdmits(caller: Caller, handler: string): boolean {
  const guard = new RolesGuard(new Reflector());
  const user = caller === NO_USER ? undefined : { role: caller };
  const ctx = {
    getHandler: () => (ReportExportsController.prototype as any)[handler],
    getClass: () => ReportExportsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
  return guard.canActivate(ctx);
}

async function pageReads(caller: Caller): Promise<{ reads: boolean; asked: boolean }> {
  const advanced = { getMenuEngineering: jest.fn().mockResolvedValue(MENU) };
  const c = Object.create(AnalyticsController.prototype) as AnalyticsController;
  Object.assign(c, { advanced });
  const out = await c.getMenuEngineering(HOUSE, caller === NO_USER ? undefined : ({ role: caller } as never));
  const reads = JSON.stringify(out).includes("31.77");
  return { reads, asked: advanced.getMenuEngineering.mock.calls.length > 0 };
}

/** Every role the house can carry, plus the shapes a token can arrive in. */
const CALLERS: Caller[] = ["owner", "manager", "staff", null, undefined, "", NO_USER, "waiter", "OWNER", "Manager", "admin", " owner "];
/** The roles `users.role` and the access rows can hold (roles.guard.ts), and a missing one. */
const REAL: Caller[] = ["owner", "manager", "staff", null, undefined, "", NO_USER];
/** The recommendations feed's third door: what it asks the service for, by caller. */
async function feedAsksMargin(caller: Caller): Promise<boolean | undefined> {
  const recommendationsService = { getRecommendations: jest.fn().mockResolvedValue({ recommendations: [] }) };
  const c = Object.create(AnalyticsController.prototype) as AnalyticsController;
  Object.assign(c, { recommendationsService });
  await c.getRecommendations(HOUSE, undefined, caller === NO_USER ? undefined : ({ role: caller } as never));
  return recommendationsService.getRecommendations.mock.calls[0][1].withMargin;
}

const label = (c: Caller) => (c === NO_USER ? "no user" : JSON.stringify(c) ?? "undefined");

describe("the export door and the page agree on Margin against movement (r110 reports-8)", () => {
  it("the export controller has handlers to check, so the agreement is not vacuous", () => {
    expect(HANDLERS.length).toBeGreaterThanOrEqual(5);
  });

  it.each(CALLERS.map((c) => [label(c), c] as const))(
    "[REVERT-FAILS] %s: no export handler admits a caller the page withholds margin from",
    async (_l, caller) => {
      const page = await pageReads(caller);
      for (const h of HANDLERS) if (doorAdmits(caller, h)) expect({ handler: h, pageReads: page.reads }).toEqual({ handler: h, pageReads: true });
    },
  );

  it.each(REAL.map((c) => [label(c), c] as const))(
    "[REVERT-FAILS] %s: the door and the page give the same answer, and a withheld page never reads the books",
    async (_l, caller) => {
      const page = await pageReads(caller);
      for (const h of HANDLERS) expect({ handler: h, door: doorAdmits(caller, h) }).toEqual({ handler: h, door: page.reads });
      if (!page.reads) expect(page.asked).toBe(false);
    },
  );

  it("a role-less caller is refused at the door and told withheld on the page", async () => {
    for (const caller of [undefined, null, "", NO_USER] as Caller[]) {
      expect(HANDLERS.some((h) => doorAdmits(caller, h))).toBe(false);
      expect(await pageReads(caller)).toEqual({ reads: false, asked: false });
    }
  });

  it.each(CALLERS.map((c) => [label(c), c] as const))(
    "[REVERT-FAILS] %s: the recommendations feed is told to read margin exactly when the page does",
    async (_l, caller) => {
      expect(await feedAsksMargin(caller)).toBe((await pageReads(caller)).reads);
    },
  );
});
