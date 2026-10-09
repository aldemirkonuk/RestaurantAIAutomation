import "reflect-metadata";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { Roles } from "../decorators/roles.decorator";
import {
  controllersWithRoles,
  measureRouteAccess,
} from "./route-access.testing";
import expected from "./route-access.expected.json";
import { InventoryController } from "../../inventory/inventory.controller";
import { InventoryLedgerController } from "../../inventory-ledger/inventory-ledger.controller";
import { DeliveriesController } from "../../procurement/deliveries.controller";

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
    // ProviderIntelligenceController is F-563's: its five promotions reads
    // (one vendor's, active, expiring, compare, savings) gained
    // @Roles("owner", "manager"), the /promotions gate, because they carried
    // the same vendor money round it. Its other routes stay "open".
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
      "providers/provider-intelligence.controller.ts",
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

/**
 * Beyond the route gate: reads that carry the house's money send it to
 * holders only (F-562, F-564,
 * F-565; ADR 0145). One test, `holdsHouseMoney`: owners and managers get the
 * money; staff, an unknown role and no role get the same rows without it.
 * Each case drives the real controller handler over a stubbed service, so a
 * handler that stops passing the role through fails here, not only the helper.
 */

const OWNER = { userId: "u-o", restaurantId: "r-1", role: "owner" };
const MANAGER = { userId: "u-m", restaurantId: "r-1", role: "manager" };
const STAFF = { userId: "u-s", restaurantId: "r-1", role: "staff" };
const NO_ROLE = { userId: "u-n", restaurantId: "r-1", role: null };

describe("GET /inventory/:restaurantId withholds what the house paid (F-562)", () => {
  const row = () => ({
    id: "inv-1",
    wineName: "Barolo",
    stock_live: 6,
    menuPriceBottle: 120,
    menuPriceGlass: 24,
    retailPriceAvg: 60,
    wac: 41.5,
    last_purchase_price: 42,
    negotiated_price: 40,
    target_price: 38,
    max_price: 45,
    custom_price: 39,
    margin_percentage: 65.4,
    markup_ratio: 2.89,
    markupRatio: 2.89,
    costProvenance: "invoice",
    locations: [{ locationId: "loc-1", qty: 6, wac: 41.5 }],
  });
  const controller = () =>
    new InventoryController(
      { getRestaurantInventory: jest.fn(async () => [row()]) } as any,
      {} as any,
      {} as any,
    );
  const COST_KEYS = [
    "wac",
    "last_purchase_price",
    "negotiated_price",
    "target_price",
    "max_price",
    "custom_price",
    "margin_percentage",
    "markup_ratio",
    "markupRatio",
  ];

  it.each([
    ["staff", STAFF],
    ["a session with no role", NO_ROLE],
  ])("sends %s stock and menu prices, and no cost", async (_who, user) => {
    const [item] = await controller().getRestaurantInventory("r-1", user);
    for (const k of COST_KEYS) expect(item).not.toHaveProperty(k);
    expect(item.locations).toEqual([{ locationId: "loc-1", qty: 6 }]);
    expect(item).toMatchObject({
      stock_live: 6,
      menuPriceBottle: 120,
      menuPriceGlass: 24,
      retailPriceAvg: 60,
    });
  });

  it.each([
    ["an owner", OWNER],
    ["a manager", MANAGER],
  ])("sends %s the whole row", async (_who, user) => {
    const [item] = await controller().getRestaurantInventory("r-1", user);
    expect(item).toEqual(row());
  });

  // Every other route that answers with a wine row: the drill-down, low
  // stock, the Toast lookup and map/unmap, and each write that hands the
  // saved item back (the audit of this branch found the drill-down and low
  // stock still carrying the cost).
  const service = () => ({
    getLowStockItems: jest.fn(async () => [row()]),
    getInventoryItem: jest.fn(async () => row()),
    findByToastGuid: jest.fn(async () => row()),
    mapToastItem: jest.fn(async () => row()),
    unmapToastItem: jest.fn(async () => row()),
    createInventoryItem: jest.fn(async () => row()),
    updateInventoryItem: jest.fn(async () => row()),
    transferStock: jest.fn(async () => row()),
    recordPour: jest.fn(async () => ({ pour: { pours: 1 }, item: row() })),
    recordSpotCount: jest.fn(async () => ({ item: row(), variance: 0 })),
  });
  const routes: Array<[string, (c: InventoryController, u: any) => Promise<any>]> = [
    ["low-stock", async (c, u) => (await c.getLowStockItems("r-1", u))[0]],
    ["item/:itemId", (c, u) => c.getInventoryItem("r-1", "inv-1", u)],
    ["toast/lookup", (c, u) => c.findByToastGuid("r-1", "g-1", u)],
    ["toast/map", (c, u) => c.mapToastItem("r-1", {} as any, u)],
    ["toast/map DELETE", (c, u) => c.unmapToastItem("r-1", "inv-1", u)],
    ["items POST", (c, u) => c.createInventoryItem("r-1", {} as any, u)],
    ["item PATCH", (c, u) => c.updateInventoryItem("r-1", "inv-1", {} as any, u)],
    ["transfer", (c, u) => c.transferStock("r-1", "inv-1", { qty: 1 }, u)],
    ["pour", async (c, u) => (await c.recordPour("r-1", "inv-1", {}, u)).item],
    [
      "count",
      async (c, u) =>
        (await c.recordSpotCount("r-1", "inv-1", { countedQty: 6, clientCountId: "k" }, u)).item,
    ],
  ];
  const withService = () =>
    new InventoryController(service() as any, {} as any, {} as any);

  it.each(routes)("%s sends staff the wine with no cost", async (_route, call) => {
    for (const user of [STAFF, NO_ROLE]) {
      const item = await call(withService(), user);
      for (const k of COST_KEYS) expect(item).not.toHaveProperty(k);
      expect(item.locations).toEqual([{ locationId: "loc-1", qty: 6 }]);
      expect(item).toMatchObject({ stock_live: 6, menuPriceBottle: 120 });
    }
  });

  it.each(routes)("%s sends an owner and a manager the whole row", async (_route, call) => {
    for (const user of [OWNER, MANAGER]) {
      expect(await call(withService(), user)).toEqual(row());
    }
  });
});

describe("GET /procurement/deliveries/:id/proposals withholds the dispute's money (F-564)", () => {
  const proposal = () => ({
    id: "p-1",
    reason: "PRICE_DIFFERENCE",
    qty_proposed: 2,
    unit_price_proposed: 18.5,
    money_at_risk: 37,
    status: "open",
  });
  const controller = () =>
    new DeliveriesController(
      {} as any,
      {
        proposalsFor: jest.fn(async () => ({ ok: true, value: [proposal()] })),
      } as any,
      {} as any,
    );

  it("sends staff the reason, quantity and status without the money", async () => {
    const { proposals } = await controller().proposals("d-1", STAFF as any);
    expect(proposals[0]).not.toHaveProperty("unit_price_proposed");
    expect(proposals[0]).not.toHaveProperty("money_at_risk");
    expect(proposals[0]).toMatchObject({
      reason: "PRICE_DIFFERENCE",
      qty_proposed: 2,
    });
  });

  it("sends a manager the whole proposal", async () => {
    const { proposals } = await controller().proposals("d-1", MANAGER as any);
    expect(proposals[0]).toEqual(proposal());
  });
});

describe("inventory-ledger reads withhold each movement's cost (F-565)", () => {
  const tx = () =>
    ({
      id: "t-1",
      quantityChange: 6,
      unitCost: 41.5,
      totalCost: 249,
      reason: "delivery",
    }) as any;
  const controller = () =>
    new InventoryLedgerController({
      listTransactions: jest.fn(async () => ({
        transactions: [tx()],
        total: 1,
        page: 1,
        limit: 50,
        hasMore: false,
      })),
      getTransaction: jest.fn(async () => tx()),
      getTransactionHistory: jest.fn(async () => [tx()]),
    } as any);

  it("sends staff no unit or total cost on the list, one movement or the history", async () => {
    const c = controller();
    const list = await c.listTransactions({} as any, STAFF);
    const one = await c.getTransaction("t-1", STAFF);
    const history = await c.getTransactionHistory("inv-1", 30, STAFF);
    for (const t of [list.transactions[0], one, history[0]]) {
      expect(t).not.toHaveProperty("unitCost");
      expect(t).not.toHaveProperty("totalCost");
      expect(t).toMatchObject({ quantityChange: 6, reason: "delivery" });
    }
    expect(list.total).toBe(1);
  });

  it("sends an owner the cost", async () => {
    const c = controller();
    expect((await c.getTransaction("t-1", OWNER)).unitCost).toBe(41.5);
    expect(
      (await c.listTransactions({} as any, OWNER)).transactions[0].totalCost,
    ).toBe(249);
    expect(
      (await c.getTransactionHistory("inv-1", 30, OWNER))[0].unitCost,
    ).toBe(41.5);
  });
});
