/**
 * Ruling a day out of the analysis is an owner's or a manager's (OPS-04,
 * 2026-10-07).
 *
 * WHY THIS EXISTS
 * ---------------
 * At a323cc80b `POST /analytics/exclusions/:rid` and
 * `DELETE /analytics/exclusions/:rid/:businessDate` carried only the
 * class-level `JwtAuthGuard`. Any member of the house, staff included, could
 * strike a day out of every baseline the insight generator builds, or put one
 * back, and so move every "below your usual" figure it reports. Sales are
 * owners' and managers'
 * (ADR 0145's `sales` class; ADR 0290 §5). The write also stored `created_by`
 * from the request body, so a struck day could name anyone as its author.
 *
 * Everything on the request path is real: the AnalyticsController and its
 * decorators, `JwtAuthGuard` (tenant match, email and house checks), passport
 * verifying a token signed with @nestjs/jwt, `JwtStrategy`, and
 * `AuthService.validateJwtPayload` reading the caller's active access row from
 * the filter-honouring stub database. `DayExclusionsService` is the REAL
 * service over the same stub, so a write that got through is a row in the
 * table, not a call on a mock.
 *
 * Tests marked [REVERT-FAILS] fail against a323cc80b's controller.
 */
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { AddressInfo } from "net";
import { AuthService } from "../auth/auth.service";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { AdvancedAnalyticsService } from "./advanced-analytics.service";
import { RecommendationsService } from "./recommendations.service";
import { RecommendationActionsService } from "./recommendation-actions.service";
import { TableAnalyticsService } from "./table-analytics.service";
import { GoalsService } from "./goals.service";
import { GoalScenarioRequestsService } from "./goal-scenario-requests.service";
import { ConsultantsService } from "./consultants.service";
import { InsightGeneratorService } from "./insights/insight-generator.service";
import { InsightSchedulerService } from "./insights/insight-scheduler.service";
import { DayExclusionsService } from "./insights/day-exclusions.service";

const SECRET = "test-secret-for-day-exclusions-need-a-manager";
const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOMEONE_ELSE = "44444444-4444-4444-8444-444444444444";
/** Already struck in house A when each test starts. */
const STRUCK = "2026-09-02";
/** Not struck; the day a write tries to strike. */
const FRESH = "2026-09-09";

const PEOPLE = {
  staff: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  owner: "33333333-3333-4333-8333-333333333333",
  // An active access row that names no role, held by someone whose
  // account-wide `users.role` says manager: `JwtStrategy` gives no role for
  // the house (ADR 0162), and `users.role` must not decide it here.
  unroled: "55555555-5555-4555-8555-555555555555",
  // An owner, but of house B: the tenant match refuses them at house A.
  ownerOfB: "66666666-6666-4666-8666-666666666666",
} as const;
type Who = keyof typeof PEOPLE;
const HOUSE_OF: Record<Who, string> = {
  staff: HOUSE_A,
  manager: HOUSE_A,
  owner: HOUSE_A,
  unroled: HOUSE_A,
  ownerOfB: HOUSE_B,
};
const ROLE_OF: Record<Who, string | null> = {
  staff: "staff",
  manager: "manager",
  owner: "owner",
  unroled: null,
  ownerOfB: "owner",
};

const struckRows = () => [
  {
    id: "e1",
    restaurant_id: HOUSE_A,
    business_date: STRUCK,
    reason: "closed",
    created_by: null,
    created_at: "2026-09-03T08:00:00.000Z",
  },
];

function world(): StubDb {
  return makeStubDb({
    users: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      email: `${who}@house.test`,
      name: who,
      role: who === "unroled" ? "manager" : ROLE_OF[who],
      restaurant_id: HOUSE_OF[who],
      email_verified: true,
    })),
    user_restaurant_access: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      restaurant_id: HOUSE_OF[who],
      role: ROLE_OF[who],
      is_active: true,
    })),
    analytics_day_exclusions: struckRows(),
  });
}

let db: StubDb;
let app: INestApplication;
let base: string;
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (who: Who) =>
  jwt.sign({
    sub: PEOPLE[who],
    email: `${who}@house.test`,
    role: ROLE_OF[who] ?? "staff",
    restaurantId: HOUSE_OF[who],
  });
const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  db = world();
  const auth = new AuthService(
    new JwtService({}),
    { get: (k: string) => (k === "JWT_SECRET" ? SECRET : undefined) } as any,
    asDatabaseService(db),
    { isBlacklisted: async () => false } as any,
    { sendEmail: async () => undefined } as any,
  );
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
    controllers: [AnalyticsController],
    providers: [
      JwtAuthGuard,
      JwtStrategy,
      { provide: AuthService, useValue: auth },
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
      {
        provide: DayExclusionsService,
        useValue: new DayExclusionsService(asDatabaseService(db)),
      },
      { provide: AnalyticsService, useValue: {} },
      { provide: AdvancedAnalyticsService, useValue: {} },
      { provide: RecommendationsService, useValue: {} },
      { provide: RecommendationActionsService, useValue: {} },
      { provide: TableAnalyticsService, useValue: {} },
      { provide: GoalsService, useValue: {} },
      { provide: GoalScenarioRequestsService, useValue: {} },
      { provide: ConsultantsService, useValue: {} },
      { provide: InsightGeneratorService, useValue: {} },
      { provide: InsightSchedulerService, useValue: {} },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  process.env.JWT_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  db.tables.analytics_day_exclusions = struckRows();
  db.ops.length = 0;
});

async function call(
  method: string,
  path: string,
  token: string | null,
  body?: unknown,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Every write the exclusion store received. */
const writes = () =>
  db.ops.filter(
    (o) => o.table === "analytics_day_exclusions" && o.op !== "select",
  );
const struckDays = () =>
  db.tables.analytics_day_exclusions
    .filter((r) => r.restaurant_id === HOUSE_A)
    .map((r) => String(r.business_date))
    .sort();

/** [label, method, path, body, the days struck in house A afterwards when allowed, success status] */
const WRITES: Array<[string, string, string, unknown, string[], number]> = [
  [
    "rule a day out (POST)",
    "POST",
    `/analytics/exclusions/${HOUSE_A}`,
    { businessDate: FRESH, reason: "closed" },
    [STRUCK, FRESH],
    201,
  ],
  [
    "count a day again (DELETE)",
    "DELETE",
    `/analytics/exclusions/${HOUSE_A}/${STRUCK}`,
    undefined,
    [],
    200,
  ],
];

describe("a staff member of the house may not strike or restore a day", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] staff: %s answers 403 and the store is not written",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("staff"), body);
      expect(res.status).toBe(403);
      // RolesGuard's own refusal, before the handler runs.
      expect(res.body?.message).toBe("Forbidden resource");
      expect(writes()).toEqual([]);
      expect(struckDays()).toEqual([STRUCK]);
    },
  );
});

describe("an access row that names no role is not a manager, whatever users.role says", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] no role in the house: %s answers 403",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("unroled"), body);
      expect(res.status).toBe(403);
      expect(writes()).toEqual([]);
      expect(struckDays()).toEqual([STRUCK]);
    },
  );
});

describe("an owner of another house is refused at this one", () => {
  it.each(WRITES)("owner of house B: %s answers 403", async (_l, method, path, body) => {
    const res = await call(method, path, tokenFor("ownerOfB"), body);
    expect(res.status).toBe(403);
    expect(writes()).toEqual([]);
  });
});

describe.each(["owner", "manager"] as const)("as %s of the house", (who) => {
  it.each(WRITES)("may %s", async (_label, method, path, body, after, ok) => {
    const res = await call(method, path, tokenFor(who), body);
    expect(res.status).toBe(ok);
    expect(struckDays()).toEqual(after);
  });
});

describe("staff still read which days are struck (the marker is read-only, not hidden)", () => {
  it("staff: GET answers 200 with the struck day and its reason", async () => {
    const res = await call(
      "GET",
      `/analytics/exclusions/${HOUSE_A}`,
      tokenFor("staff"),
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        {
          businessDate: STRUCK,
          reason: "closed",
          createdAt: "2026-09-03T08:00:00.000Z",
        },
      ],
      readable: true,
      problem: null,
    });
  });

  it("the manager reads the same list the staff member reads", async () => {
    const staff = await call("GET", `/analytics/exclusions/${HOUSE_A}`, tokenFor("staff"));
    const manager = await call("GET", `/analytics/exclusions/${HOUSE_A}`, tokenFor("manager"));
    expect(manager.status).toBe(200);
    expect(manager.body).toEqual(staff.body);
  });
});

describe("who struck the day is the signed-in person", () => {
  it("[REVERT-FAILS] a body createdBy naming someone else is ignored", async () => {
    const res = await call(
      "POST",
      `/analytics/exclusions/${HOUSE_A}`,
      tokenFor("manager"),
      { businessDate: FRESH, reason: "closed", createdBy: SOMEONE_ELSE },
    );
    expect(res.status).toBe(201);
    const row = db.tables.analytics_day_exclusions.find(
      (r) => r.business_date === FRESH,
    );
    expect(row?.created_by).toBe(PEOPLE.manager);
  });
});
