import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { Roles } from "../decorators/roles.decorator";
import {
  controllersWithRoles,
  measureRouteAccess,
} from "./route-access.testing";
import expected from "./route-access.expected.json";

/**
 * "Keep managers in" (ADR 0164, founder 2026-09-18): `RolesGuard` became exact
 * and the ten owner-only decorators were relabelled owner-or-manager, so no
 * route's access changed except as decided.
 *
 * `route-access.expected.json` is the table `measureRouteAccess()` printed on
 * cb756083e (the guard and the decorators before this change) with one edit:
 * `admin` removed from every row whose route names roles, because the exact
 * guard no longer widens to it and no session in production holds it. The five
 * rows under `RolesGuard` with no `@Roles` at all still admit everyone,
 * `admin` and a null role included, as they did. One row is added, as decided:
 * `GET /auth/houses`, the chooser's list (ADR 0164, R7), which like every
 * `AuthController` route outside `@Roles` is recorded as "open" here (it is
 * `JwtAuthGuard`-only). Every other cell is the old measurement. A relabel
 * reverted, a route added or removed in one of these controllers, or the old
 * widening put back, all fail here.
 *
 * Two rows changed as decided by #436 (ADR 0175 D9/D10, founder 2026-09-21,
 * recorded when #436 merged main 2026-09-26): `POST /conversations/:id/approve`
 * lost its `@Roles("owner", "manager")` because a staff member holding a live
 * grant may send, and a grant is a row, not a token role — WHO is checked in
 * `VendorSendAuthorityService` and the send is sealed. Its new sibling
 * `POST /conversations/:id/approve-seal-challenge` is gated the same way. Both
 * therefore read "open" here; the gate they rely on is pinned by the
 * `ADR-0171-CONVERSATION-ROUTES-HOUSE-SCOPED` claim and
 * `vendor-send-authority.spec.ts`, not by `RolesGuard`.
 */

const ctx = (handler: object, cls: object, role: string | null) =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: "u", role } }),
    }),
  }) as any;

class Probe {
  @Roles("owner")
  ownerOnly() {
    return true;
  }
  @Roles("manager")
  managerOnly() {
    return true;
  }
  @Roles("owner", "manager")
  ownerOrManager() {
    return true;
  }
}

describe("RolesGuard is exact (ADR 0164, 'Keep managers in')", () => {
  const guard = new RolesGuard(new Reflector());
  const admits = (method: keyof Probe, role: string | null) =>
    guard.canActivate(ctx(Probe.prototype[method], Probe, role));

  it("lets only an owner through a route that names only owner", () => {
    expect(admits("ownerOnly", "owner")).toBe(true);
    expect(admits("ownerOnly", "manager")).toBe(false);
    expect(admits("ownerOnly", "admin")).toBe(false);
    expect(admits("ownerOnly", "staff")).toBe(false);
  });

  it("lets only a manager through a route that names only manager", () => {
    expect(admits("managerOnly", "manager")).toBe(true);
    expect(admits("managerOnly", "owner")).toBe(false);
  });

  it("lets owner and manager through owner-or-manager, and nobody else", () => {
    expect(admits("ownerOrManager", "owner")).toBe(true);
    expect(admits("ownerOrManager", "manager")).toBe(true);
    expect(admits("ownerOrManager", "admin")).toBe(false);
    expect(admits("ownerOrManager", "staff")).toBe(false);
    expect(admits("ownerOrManager", null)).toBe(false);
  });
});

describe("no route's access changed except as decided (ADR 0164)", () => {
  it("finds the controllers it measures", () => {
    // Nine controller files used @Roles on cb756083e. Four more reached main
    // before this branch landed (conversations, the house counter and day,
    // report exports), each written with @Roles naming owner AND manager, so
    // the exact guard admits them what the old guard did, less admin
    // (re-measured 2026-09-25). A fourteenth, analytics, reached main while
    // this branch was in flight (PR #471's merge with main, 2026-09-26): it
    // adds 52 new /analytics/* routes, 51 of them outside @Roles (recorded
    // "open" below, `JwtAuthGuard`-only, same as the rest of this table's
    // open rows) and exactly one, the insight-catalog toggle, naming owner
    // AND manager like every other row here. A fifteenth and sixteenth are
    // PR #395's own change (ADR 0167, locked 2026-09-19, merged with this
    // table 2026-09-26): the receiving queue and credit ledger controllers
    // gained @Roles("owner", "manager") on four routes (the three credits
    // routes and the queue); the door, receivedSoFar and unverified routes in
    // ReceivingController stay open, on purpose (staff use them). A
    // seventeenth is PR #474's own change (ADR 0124:357-362): the
    // new promotions controller gained @Roles("owner", "manager") on all
    // three of its routes (the read and the two dismiss/restore writes) —
    // this read carries what a vendor charges the house, the same reason
    // /vendor-intel and the pricing column are gated. An
    // eighteenth, HouseLettersController, is PR #476's own audit fix (round
    // 1, R1): `drafts` and `discard` carried only `JwtAuthGuard`, so any
    // staff member could read a credit draft's claimed amount, reason and
    // invoice/order numbers through this door, the same figures ADR 0167
    // already refuses them on the ledger — closed with the identical
    // @Roles("owner", "manager"). Every other route on this controller
    // (sender, book, queued, templates, queue, cancel) is unchanged and
    // stays "open": writing and sending a letter by hand was never gated by
    // ADR 0167, which named only the credit ledger's own four routes.
    // PR #480 (the receiving desk, merged with this table 2026-09-28) adds one
    // route to ReceivingController, not a controller: GET
    // orders/:id/history, a line's history on the desk, with
    // @Roles("owner", "manager") on the method, the queue's rule (ADR 0167)
    // applied to the desk's newest route. It admits no admin, like the queue.
    expect(controllersWithRoles()).toEqual([
      "analytics/analytics.controller.ts",
      "ask-ai/ask-ai.controller.ts",
      "auth/auth.controller.ts",
      "commodity/commodity.controller.ts",
      "common/orchestrator/prospects.controller.ts",
      "common/orchestrator/sender-trust.controller.ts",
      "communications/archive/house-mail-archive.controller.ts",
      "communications/letters/house-letters.controller.ts",
      "conversations/conversations.controller.ts",
      "distributor-feed/distributor-feed.controller.ts",
      "house/house-counter.controller.ts",
      "house/house-day.controller.ts",
      "price-index/price-index.controller.ts",
      "procurement/documents/credits.controller.ts",
      "procurement/receiving.controller.ts",
      "promotions/promotions.controller.ts",
      "reports/exports/report-exports.controller.ts",
      "vendor-intel/vendor-intel.controller.ts",
    ]);
  });

  it("admits exactly the roles each route admitted before, less admin", () => {
    const measured = measureRouteAccess();
    expect(measured).toEqual(expected);
  });

  it("still lets managers through every route that was labelled owner-only", () => {
    const measured = measureRouteAccess();
    const relabelled = [
      "POST /vendor-intel/scrape (VendorIntelController.scrape)",
      "POST /vendor-intel/sweep (VendorIntelController.sweep)",
      "GET /vendor-intel/site-sweep/status (VendorIntelController.siteSweepStatus)",
      "POST /vendor-intel/site-sweep/run (VendorIntelController.runSiteSweep)",
      "GET /vendor-intel/outlier-rejudge/status (VendorIntelController.outlierRejudgeStatus)",
      "POST /vendor-intel/outlier-rejudge/run (VendorIntelController.runOutlierRejudge)",
      "GET /vendor-intel/shop-sweep/status (VendorIntelController.shopSweepStatus)",
      "POST /vendor-intel/shop-sweep/run (VendorIntelController.runShopSweep)",
      "POST /price-index/uploads/:reviewId/reopen-challenge (PriceIndexController.reopenChallenge)",
      "POST /price-index/uploads/:reviewId/reopen (PriceIndexController.reopenUpload)",
    ];
    for (const route of relabelled) {
      expect([route, measured[route]]).toEqual([route, ["owner", "manager"]]);
    }
  });
});
