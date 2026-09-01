import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import {
  CellarAgingController,
  CountFreshnessController,
  PurchaseReasonController,
} from "./dashboard-signals.controller";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

/**
 * The route contract, pinned.
 *
 * The web worker builds against these exact paths in parallel with this
 * service being written, so a rename here is a broken page there — and it
 * would break silently, as a 404 the page renders as "no data" rather than as
 * an error. That is the same failure mode ADR 0051 exists to prevent: a
 * surface that shows an empty state when the truth is "the call failed".
 *
 * Also pins the guard. OD-20 was exactly this: a dashboard controller with no
 * guard and no `@Public()`, serving a restaurant's data to an unauthenticated
 * caller — verified live before the fix. TenantGuard does not save it, because
 * that guard fails OPEN by design.
 */

type Ctor = new (...args: any[]) => any;

function routesOf(controller: Ctor) {
  const prefix = Reflect.getMetadata(PATH_METADATA, controller);
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== "constructor")
    .map((name) => {
      const handler = proto[name];
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      return {
        method: RequestMethod[method],
        path: `/${prefix}${path && path !== "/" ? `/${path}` : ""}`,
      };
    })
    .filter((r) => r.method !== undefined)
    .sort((a, b) => a.path.localeCompare(b.path));
}

describe("dashboard-signals route contract", () => {
  it("serves the drink window at the path the dashboard calls", () => {
    expect(routesOf(CellarAgingController)).toEqual([
      { method: "GET", path: "/cellar/drink-window/:restaurantId" },
    ]);
  });

  it("serves the purchase-reason write, chip list and reads at their agreed paths", () => {
    // Sorted by path, so the POST at the bare prefix comes first.
    expect(routesOf(PurchaseReasonController)).toEqual([
      { method: "POST", path: "/purchase-reasons" },
      { method: "GET", path: "/purchase-reasons/:restaurantId" },
      { method: "GET", path: "/purchase-reasons/:restaurantId/idle-stock" },
      { method: "GET", path: "/purchase-reasons/options" },
    ]);
  });

  it("declares /options before /:restaurantId, or the literal is swallowed as an id", () => {
    // Nest matches in declaration order, so this ordering is load-bearing and
    // an innocent-looking reshuffle turns GET /purchase-reasons/options into a
    // lookup for a restaurant whose UUID is the word "options".
    const declared = Object.getOwnPropertyNames(
      PurchaseReasonController.prototype,
    ).filter((n) => n !== "constructor");
    expect(declared.indexOf("listOptions")).toBeLessThan(
      declared.indexOf("forItems"),
    );
  });

  it("serves count freshness at the path the dashboard calls", () => {
    expect(routesOf(CountFreshnessController)).toEqual([
      { method: "GET", path: "/counts/freshness/:restaurantId" },
    ]);
  });

  it("guards every controller with JwtAuthGuard — none of this is public", () => {
    for (const controller of [
      CellarAgingController,
      PurchaseReasonController,
      CountFreshnessController,
    ]) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      expect(guards).toContain(JwtAuthGuard);
    }
  });
});
