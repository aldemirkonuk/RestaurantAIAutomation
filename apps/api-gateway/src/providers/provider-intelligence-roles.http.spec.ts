/**
 * Who may read provider intelligence: owner or manager, the same gate
 * `GET /promotions` has (ADR 0124:357-362, `promotions.controller.ts:63-64`).
 *
 * Until 2026-10-07 `ProviderIntelligenceController` carried `JwtAuthGuard` and
 * nothing else. House-scoped (ADR 0147) but not role-scoped, so a staff member
 * read through `/providers/promotions/*` the very `provider_promotions` rows
 * `GET /promotions` refuses them, plus the Digital Twin's vendor price points,
 * the conversation memory's extracted entities, sentiment (ADR 0207 round 3:
 * owners and managers only, staff never see it) and the leverage signals.
 *
 * TWO HALVES, BECAUSE EACH ALONE CAN PASS BY LOOKING AT NOTHING.
 *
 *   1. A real HTTP request through the real Nest pipeline: the real controller,
 *      the real `RolesGuard`, the real `@Roles` metadata, on ONE fixture. Only
 *      `JwtAuthGuard` is replaced, by a stub that sets `req.user.role` from a
 *      header. A staff caller, a caller with no role in the house and `admin`
 *      (ADR 0164: exact match) get 403 and the service is never asked; owner and
 *      manager reach the handler. The staff refusal's body is compared with what
 *      `GET /promotions` answers the same staff caller in the same app, so "the
 *      house's usual sentence" is measured, not typed in.
 *   2. The two routes that return no figure, outreach and onboard, still answer
 *      a staff caller. A gate that swept them up would pass every 403 above.
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import { DatabaseService } from "../database/database.service";
import { PromotionsController } from "../promotions/promotions.controller";
import { PromotionsService } from "../promotions/promotions.service";
import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { ProviderIntelligenceService } from "./provider-intelligence.service";

const HOUSE = "12823c23-277c-5ae9-b49b-e17d33704e04";
const VENDOR = "6f1c2a8e-5d4b-4c3a-9e2f-1a2b3c4d5e6f";
const SESSION = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const FACT = "7a8b9c0d-1e2f-4a3b-8c5d-6e7f8a9b0c1d";

/** [what, method, path, the service method the handler calls] */
const GATED: Array<[string, string, string, string]> = [
  ["the Digital Twin", "GET", `/providers/${VENDOR}/knowledge`, "getKnowledge"],
  ["its contradictions", "GET", `/providers/${VENDOR}/knowledge/contradictions`, "getContradictions"],
  ["verifying a twin fact", "PUT", `/providers/${VENDOR}/knowledge/${FACT}/verify`, "verifyKnowledge"],
  ["one vendor's promotions", "GET", `/providers/${VENDOR}/promotions`, "getPromotions"],
  ["active promotions", "GET", "/providers/promotions/active", "getAllActivePromotions"],
  ["expiring promotions", "GET", "/providers/promotions/expiring", "getExpiringPromotions"],
  ["the promotion comparison", "GET", "/providers/promotions/compare", "comparePromotions"],
  ["promotion savings", "GET", "/providers/promotions/savings", "getPromoSavings"],
  ["conversation memory", "GET", `/providers/${VENDOR}/conversation-memory`, "getConversationMemory"],
  ["conversation memory search", "POST", `/providers/${VENDOR}/conversation-memory/search`, "searchConversationMemory"],
  ["conversation sessions", "GET", `/providers/${VENDOR}/sessions`, "getSessions"],
  ["a session summary", "GET", `/providers/${VENDOR}/sessions/${SESSION}/summary`, "getSessionSummary"],
  ["sentiment", "GET", `/providers/${VENDOR}/sentiment`, "getSentimentTrend"],
  ["the cross-vendor comparison", "GET", "/providers/intelligence/compare", "compareProviders"],
  ["leverage signals", "GET", "/providers/intelligence/leverage", "getLeverageSignals"],
];

const OPEN: Array<[string, string]> = [
  ["outreach", `/providers/${VENDOR}/outreach`],
  ["onboarding", `/providers/${VENDOR}/onboard`],
];

describe("provider intelligence: owner or manager only, like GET /promotions", () => {
  let app: INestApplication;
  let base: string;
  const service: Record<string, jest.Mock> = {
    assertProviderInHouse: jest.fn(async () => undefined),
  };
  for (const [, , , fn] of GATED) {
    service[fn] = jest.fn(async () => []);
  }
  const promotionsRead = jest.fn(async () => ({ read_at: "", offers: [], ledger: {} }));
  const inserts: unknown[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProviderIntelligenceController, PromotionsController],
      providers: [
        { provide: ProviderIntelligenceService, useValue: service },
        { provide: PromotionsService, useValue: { readForHouse: promotionsRead } },
        {
          provide: DatabaseService,
          useValue: {
            supabase: {
              from: () => ({
                insert: async (row: unknown) => {
                  inserts.push(row);
                  return { error: null };
                },
              }),
            },
          },
        },
      ],
    })
      // Authentication is not what is under test; the role a request carries is.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest();
          const role = req.headers["x-test-role"];
          if (!role) return false;
          req.user = {
            userId: "a5bede6d-3c34-4627-8771-a488ba5275de",
            restaurantId: HOUSE,
            // "none" is a session the house has no role for: `JwtStrategy`
            // sets null there, and `@Roles` refuses it.
            role: role === "none" ? null : role,
          };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const fn of Object.values(service)) fn.mockClear();
    promotionsRead.mockClear();
    inserts.length = 0;
  });

  const call = (method: string, path: string, role: string) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", "x-test-role": role },
      ...(method === "POST" ? { body: JSON.stringify({ query: "price" }) } : {}),
    });

  describe.each(GATED)("%s (%s %s)", (_what, method, path, fn) => {
    it.each(["staff", "none", "admin"])(
      "refuses a %s caller with 403 before the service is asked",
      async (role) => {
        const res = await call(method, path, role);
        expect(res.status).toBe(403);
        expect(service[fn]).not.toHaveBeenCalled();
        expect(service.assertProviderInHouse).not.toHaveBeenCalled();
      },
    );

    it.each(["owner", "manager"])("lets a %s through to the handler, for this house", async (role) => {
      const res = await call(method, path, role);
      expect(res.status).toBe(method === "POST" ? 201 : 200);
      expect(service[fn]).toHaveBeenCalledTimes(1);
      expect(service[fn].mock.calls[0]).toContain(HOUSE);
    });
  });

  it("refuses staff here in the same words GET /promotions refuses them", async () => {
    const promotions = await call("GET", "/promotions", "staff");
    const sideDoor = await call("GET", "/providers/promotions/active", "staff");
    expect(promotions.status).toBe(403);
    expect(sideDoor.status).toBe(403);
    expect(await sideDoor.json()).toEqual(await promotions.json());
    expect(promotionsRead).not.toHaveBeenCalled();
    expect(service.getAllActivePromotions).not.toHaveBeenCalled();
  });

  it.each(OPEN)("leaves %s open: a staff caller still reaches it", async (_what, path) => {
    const res = await call("POST", path, "staff");
    expect(res.status).toBe(201);
    expect(service.assertProviderInHouse).toHaveBeenCalledWith(VENDOR, HOUSE);
    expect(inserts).toHaveLength(1);
  });
});

describe("the gate is on the right handlers and only those (metadata)", () => {
  const proto = ProviderIntelligenceController.prototype as unknown as Record<string, object>;
  const guardsOf = (target: object) =>
    (Reflect.getMetadata("__guards__", target) as unknown[]) ?? [];
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (n) => n !== "constructor" && typeof proto[n] === "function",
  );

  it("keeps JwtAuthGuard alone at the class, so no handler inherits a role gate it was not given", () => {
    expect(guardsOf(ProviderIntelligenceController)).toEqual([JwtAuthGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, ProviderIntelligenceController)).toBeUndefined();
  });

  it("gates every handler but outreach and onboard with RolesGuard and owner/manager", () => {
    const gated = handlers.filter((n) => n !== "triggerOutreach" && n !== "triggerOnboarding");
    // If this list is short the test is looking at less than the controller has.
    expect(gated.sort()).toEqual(GATED.map(([, , , fn]) => fn).sort());
    for (const name of gated) {
      expect([name, guardsOf(proto[name])]).toEqual([name, [RolesGuard]]);
      expect([name, Reflect.getMetadata(ROLES_KEY, proto[name])]).toEqual([name, ["owner", "manager"]]);
    }
  });

  it("leaves outreach and onboard with no role gate", () => {
    for (const name of ["triggerOutreach", "triggerOnboarding"]) {
      expect(handlers).toContain(name);
      expect(guardsOf(proto[name])).toEqual([]);
      expect(Reflect.getMetadata(ROLES_KEY, proto[name])).toBeUndefined();
    }
  });
});
