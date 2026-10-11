import "reflect-metadata";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { AnalyticsController } from "./analytics.controller";

/**
 * Staff see counts, never amounts (DASH-W22, founder 2026-10-01; ADR 0145).
 * The room and the server register carry each table's and each server's sales
 * and tip %, so only an owner or a manager reads them (sim F-203). The live
 * watchlist carries each open check's running spend and $/min pace, so it is
 * theirs too (F-1067). The till register carries the house's takings by
 * day and each wine's sales, so it is theirs as well (F-1200).
 */
describe("the house's sales by table and by server are the owner's or a manager's", () => {
  it.each([
    ["getTablePerformance", "table-performance/:restaurantId"],
    ["getWaiters", "waiters/:restaurantId"],
    ["getHotTables", "hot-tables/:restaurantId"],
    // F-1200: the till's takings and each wine's sales (re-hit of F-203).
    ["getPosRevenue", "pos-revenue/:restaurantId"],
  ] as const)(
    "guards %s with RolesGuard and ['owner', 'manager']",
    (name, path) => {
      const handler = AnalyticsController.prototype[name];
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([
        "owner",
        "manager",
      ]);
      expect(Reflect.getMetadata("__guards__", handler)).toContain(RolesGuard);
      expect(Reflect.getMetadata("path", handler)).toBe(path);
    },
  );
});
