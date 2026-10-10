/**
 * Money, settings and order-state writes are owners' and managers' acts
 * (roles sweep, 2026-10-08: F-299, F-311, F-312, F-314, F-315, F-317), and
 * a group ("chain") is its organisation owner's (F-313, at the foot).
 *
 * WHY THIS EXISTS
 * ---------------
 * Each route below carried the class's `JwtAuthGuard` and nothing else, so a
 * staff token could import till checks over the house's takings and tips, set
 * what a wine cost, turn down a vendor's deal, settle a delivery, change the
 * house's analytics settings, run the finance consultant, or set and edit the
 * house's goals.
 *
 * Each route is driven over HTTP through its REAL controller and decorators,
 * `RolesGuard` included. Only the token check is stood in for: the stand-in
 * `JwtAuthGuard` puts the role the request names on `req.user`, the way
 * `JwtStrategy` puts the caller's role at this house there. The services are
 * recording mocks, so "refused" means the service was never called.
 * `OrganizationsService.assertCanManageRestaurant` (the inventory price gate)
 * is mocked by the same owner-or-manager rule it applies to the access row.
 *
 * Every staff case fails against 09b08b68c, where each of these routes
 * answered staff 2xx and called its service.
 */
import "reflect-metadata";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Type,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { ServiceKeyGuard } from "./service-key.guard";
import { PlatformOperatorGuard } from "../../common/orchestrator/platform-operator.service";
import { AnalyticsController } from "../../analytics/analytics.controller";
import { InventoryController } from "../../inventory/inventory.controller";
import { OrganizationsService } from "../../organizations/organizations.service";
import { PosHubController } from "../../pos-hub/pos-hub.controller";
import { ProcurementController } from "../../procurement/procurement.controller";
import { DeliveriesController } from "../../procurement/deliveries.controller";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../../team/testing/supabase-stub";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLES = ["staff", "manager", "owner"] as const;
type Role = (typeof ROLES)[number];
const userIdOf = (role: Role) => `user-${role}`;

/** Puts the role the request names on `req.user`, as `JwtStrategy` would. */
class RoleFromHeader implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const role = String(req.headers["x-test-role"]) as Role;
    req.user = { userId: userIdOf(role), restaurantId: HOUSE, role };
    return true;
  }
}

/** Every service method a route reaches. One answer fits every caller here. */
const calls: string[] = [];
function recordingMock(name: string) {
  return new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return jest.fn(async () => {
          calls.push(`${name}.${String(prop)}`);
          return { ok: true, value: { done: true }, bellNote: null, id: "x" };
        });
      },
    },
  );
}

const organizations = {
  assertCanManageRestaurant: jest.fn(async (userId: string) => {
    if (userId !== userIdOf("owner") && userId !== userIdOf("manager")) {
      throw new ForbiddenException("Only managers and owners can do this");
    }
  }),
};

async function boot(controller: Type<unknown>): Promise<{
  app: INestApplication;
  base: string;
}> {
  const moduleRef = await Test.createTestingModule({
    controllers: [controller],
    providers: [{ provide: OrganizationsService, useValue: organizations }],
  })
    .useMocker((token) =>
      recordingMock(typeof token === "function" ? token.name : String(token)),
    )
    .overrideGuard(JwtAuthGuard)
    .useValue(new RoleFromHeader())
    .overrideGuard(ServiceKeyGuard)
    .useValue({ canActivate: () => false })
    .overrideGuard(PlatformOperatorGuard)
    .useValue({ canActivate: () => false })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}` };
}

/** [label, controller, method, path, body] */
const ROUTES: Array<[string, Type<unknown>, string, string, unknown]> = [
  // F-311
  ["POS check import", PosHubController, "POST", `/pos-hub/import/${HOUSE}`, []],
  // F-312
  ["add a wine with its cost", InventoryController, "POST", `/inventory/${HOUSE}/items`, { wineId: "w1", stockLive: 6, costPerBottle: 18 }],
  ["add a wine as a free sample", InventoryController, "POST", `/inventory/${HOUSE}/items`, { wineId: "w1", stockLive: 6, costPerBottle: 0, costProvenance: "sample" }],
  ["receive a batch naming a cost", InventoryController, "POST", `/inventory/${HOUSE}/items/bulk`, { items: [{ wineId: "w1", stockLive: 6 }, { wineId: "w2", stockLive: 3, costPerBottle: 22 }] }],
  ["record an auction lot", InventoryController, "POST", "/inventory/auction-lots", { inventoryId: "i1" }],
  // F-314
  ["dismiss a deal", ProcurementController, "POST", "/procurement/orders/o1/dismiss-deal", {}],
  // F-317
  ["put a position on a delivery", DeliveriesController, "POST", "/procurement/deliveries/d1/proposals", { side: "restaurant", reason: "SHORT" }],
  ["counter a proposal", DeliveriesController, "POST", "/procurement/deliveries/proposals/p1/counter", { side: "restaurant", reason: "SHORT" }],
  ["accept a proposal", DeliveriesController, "POST", "/procurement/deliveries/proposals/p1/accept", {}],
  ["accept a difference as billed", DeliveriesController, "POST", "/procurement/deliveries/d1/accept-as-billed", { documentId: "doc1", lineNo: 1, reason: "fine" }],
  ["agree a delivery", DeliveriesController, "POST", "/procurement/deliveries/d1/agree", {}],
  ["verify a delivery", DeliveriesController, "POST", "/procurement/deliveries/d1/verify", {}],
  // F-315
  ["set an insight cadence", AnalyticsController, "PUT", `/analytics/insight-prefs/${HOUSE}/sales`, { cadence: "daily" }],
  ["add a floor table", AnalyticsController, "POST", `/analytics/tables/${HOUSE}`, { label: "T1", seats: 4 }],
  ["set the venue profile", AnalyticsController, "PUT", `/analytics/venue/${HOUSE}`, { features: { has_pool: true } }],
  ["turn the consultants on", AnalyticsController, "PUT", `/analytics/consultants/${HOUSE}/toggle`, { enabled: true }],
  ["run the finance consultant", AnalyticsController, "POST", `/analytics/consult/${HOUSE}`, { persona: "finance" }],
  // F-299
  ["set a goal", AnalyticsController, "POST", `/analytics/goals/${HOUSE}`, { name: "More wine", metricKey: "wine_revenue", targetValue: 9000 }],
  ["edit a goal", AnalyticsController, "PATCH", `/analytics/goals/${HOUSE}/g1`, { targetValue: 12000 }],
  ["change a goal's status", AnalyticsController, "PUT", `/analytics/goals/${HOUSE}/g1/status`, { status: "archived" }],
  // F-299, the reads: a goal's target and progress are money-class, as /ask holds them
  ["read the goals", AnalyticsController, "GET", `/analytics/goals/${HOUSE}`, undefined],
  ["read the goals' progress", AnalyticsController, "GET", `/analytics/goals/${HOUSE}/progress`, undefined],
  ["read one goal's progress", AnalyticsController, "GET", `/analytics/goals/${HOUSE}/g1/progress`, undefined],
  ["ask which analysis shows a goal", AnalyticsController, "POST", `/analytics/goals/${HOUSE}/g1/cutting-spec`, {}],
];

/** The goal reads (and the cutting a goal asks for) gate in the controller, so their refusal is in words. */
const isGoalRead = (method: string, path: string) =>
  path.includes("/goals/") && (method === "GET" || path.endsWith("/cutting-spec"));

const apps = new Map<Type<unknown>, { app: INestApplication; base: string }>();

beforeAll(async () => {
  for (const [, controller] of ROUTES) {
    if (!apps.has(controller)) apps.set(controller, await boot(controller));
  }
});

afterAll(async () => {
  for (const { app } of apps.values()) await app.close();
});

beforeEach(() => {
  calls.length = 0;
});

async function call(
  controller: Type<unknown>,
  method: string,
  path: string,
  role: Role,
  body: unknown,
) {
  const { base } = apps.get(controller)!;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-role": role, "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

describe.each(ROUTES)("%s", (_label, controller, method, path, body) => {
  it("refuses staff with 403 and calls no service", async () => {
    const res = await call(controller, method, path, "staff", body);
    expect(res.status).toBe(403);
    // `RolesGuard` (the analytics routes) answers Nest's own "Forbidden
    // resource"; the in-controller gates say whose act it is in words.
    if (controller !== AnalyticsController || isGoalRead(method, path)) {
      expect(res.text).toMatch(/owner|manager/i);
    }
    expect(calls).toEqual([]);
  });

  it.each(["manager", "owner"] as const)("lets a %s through", async (role) => {
    const res = await call(controller, method, path, role, body);
    expect([200, 201]).toContain(res.status);
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("what stays open to staff", () => {
  it("adds a wine with no cost for staff (its cost is recorded as unknown)", async () => {
    const res = await call(InventoryController, "POST", `/inventory/${HOUSE}/items`, "staff", { wineId: "w1", stockLive: 6 });
    expect(res.status).toBe(201);
    expect(calls).toContain("InventoryService.createInventoryItem");
  });

  it("receives a batch with no cost for staff", async () => {
    const res = await call(InventoryController, "POST", `/inventory/${HOUSE}/items/bulk`, "staff", { items: [{ wineId: "w1", stockLive: 6, costPerBottle: null }] });
    expect(res.status).toBe(201);
    expect(calls).toContain("InventoryService.bulkCreateInventoryItems");
  });
});

/**
 * Creating, renaming and deleting a group ("chain") are an organisation
 * owner's acts (F-313, 2026-10-08), the rule `createLocation` already applies
 * (ADR 0164; `org-role.ts`). Until then any `organization_members` row could
 * do all three, and a house grant writes one for invited staff too
 * (`orgRoleForHouseGrant`), so a waiter could delete a group and detach every
 * house from it.
 *
 * Every manager, staff and no-row case fails against 09b08b68c. Driven
 * through the service over a stub database, because the controller holds no
 * gate of its own here: the organisation role lives in the service's read.
 */

const CHAIN_ORG = "org-1";
const P = "user-p";

function chainWorld(orgRole: string | null): StubDb {
  return makeStubDb({
    organization_members: orgRole
      ? [{ organization_id: CHAIN_ORG, user_id: P, role: orgRole }]
      : [],
    organizations: [{ id: CHAIN_ORG, owner_id: null }],
    restaurant_chains: [
      { id: "chain-1", organization_id: CHAIN_ORG, name: "Harbour" },
    ],
    restaurants: [{ id: "house-1", organization_id: CHAIN_ORG, chain_id: "chain-1" }],
    // An owner of the house, so only the organisation row decides here; the
    // house-role half of the rule (F-935) is pinned in
    // `organizations/chains-owner-and-reads.spec.ts`.
    user_restaurant_access: [
      { user_id: P, restaurant_id: "house-1", role: "owner", is_active: true },
    ],
    users: [],
  });
}

const chainService = (db: StubDb) => new OrganizationsService(asDatabaseService(db));

const ACTS: Array<[string, (s: OrganizationsService) => Promise<unknown>]> = [
  ["create a group", (s) => s.createChain(P, { name: "Seaside" })],
  ["rename a group", (s) => s.renameChain(P, "chain-1", "Quay")],
  ["delete a group", (s) => s.deleteChain(P, "chain-1")],
];

describe.each(ACTS)("%s: organisation owners only (F-313)", (act, run) => {
  it.each(["manager", "staff", null])(
    "refuses an organisation %s and changes nothing",
    async (role) => {
      const db = chainWorld(role);
      const before = JSON.stringify(db.tables);

      const err = await run(chainService(db)).then(
        () => null,
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({
        code: "NOT_ORGANISATION_OWNER",
        message: `Only an owner of the organisation can ${act}. Nothing was changed.`,
      });
      expect(JSON.stringify(db.tables)).toBe(before);
    },
  );

  it("lets the organisation's owner do it", async () => {
    const db = chainWorld("owner");
    await run(chainService(db));
    const chains = db.tables.restaurant_chains;
    if (act === "create a group") {
      expect(chains.map((c: any) => c.name)).toContain("Seaside");
    } else if (act === "rename a group") {
      expect(chains.find((c: any) => c.id === "chain-1")?.name).toBe("Quay");
    } else {
      expect(chains.find((c: any) => c.id === "chain-1")).toBeUndefined();
      expect(db.tables.restaurants[0].chain_id).toBeNull();
    }
  });
});
