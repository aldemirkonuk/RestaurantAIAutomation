/**
 * The three analytics reads that name each table's and each server's takings,
 * and the one write that adds a table, are an owner's or a manager's (the
 * founder, 2026-10-30: a waiter sees no figures for now; "Fix staff money
 * leak now", picked 2026-10-30 as its own PR before the floor work).
 *
 * WHY THIS EXISTS
 * ---------------
 * At 9914f5cbf these four AnalyticsController routes carried only the
 * class-level `JwtAuthGuard`, which checks the house and never the role. Any
 * staff login of the house could read every server's revenue, tip % and peer
 * rank by name (`waiters`), each table's average check, revenue per seat and
 * tip % (`table-performance`), and live spend on every open check with its
 * server's name (`hot-tables`), and could add or overwrite a table
 * (`POST tables`, ADR 0303 residual 12).
 *
 * NOT COVERED HERE, on the founder's 2026-10-31 ruling: the other analytics
 * reads that hand staff amounts (financial, overview, insights,
 * recommendations, goals and the rest) are withheld by a follow-up after
 * PR #617, the way #617 withholds them, before any waiter is invited.
 *
 * Everything on the request path is real: the AnalyticsController and its
 * decorators, `JwtAuthGuard` (tenant match, email and house checks), passport
 * verifying a token signed with @nestjs/jwt, `JwtStrategy`, `RolesGuard`, and
 * `AuthService.validateJwtPayload` reading the caller's active access row from
 * the filter-honouring stub database. The services behind the routes are
 * jest stubs that answer a marker, so a refused call is one that never
 * reached the service, and an admitted one is the service's own answer.
 *
 * Tests marked [REVERT-FAILS] fail against 9914f5cbf's controller.
 */
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { AddressInfo } from "net";
import { AuthService } from "../auth/auth.service";
import { JwtStrategy } from "../auth/strategies/jwt.strategy";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
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

const SECRET = "test-secret-for-analytics-money-needs-a-manager";
const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

/** What every stubbed service answers: the route's own name, so a body proves which service ran. */
const marker = (name: string) => ({ marker: name });

const tables = {
  getTablePerformance: jest.fn(async () => marker("table-performance")),
  getWaiterPerformance: jest.fn(async () => marker("waiters")),
  getHotTables: jest.fn(async () => marker("hot-tables")),
  upsertTable: jest.fn(async () => marker("add-table")),
  listTables: jest.fn(async () => marker("tables")),
  getVenueProfile: jest.fn(async () => marker("venue")),
};
const ALL_STUBS = [tables];

/**
 * [label, method, path, the stub that serves it, its method, success status,
 * the handler's name on the controller].
 */
type Row = [
  string,
  "GET" | "POST",
  string,
  Record<string, jest.Mock>,
  string,
  number,
  string,
];
const GATED: Row[] = [
  [
    "table-performance",
    "GET",
    `/analytics/table-performance/${HOUSE_A}?sinceDays=90`,
    tables,
    "getTablePerformance",
    200,
    "getTablePerformance",
  ],
  [
    "waiters",
    "GET",
    `/analytics/waiters/${HOUSE_A}?sinceDays=90`,
    tables,
    "getWaiterPerformance",
    200,
    "getWaiters",
  ],
  [
    "hot-tables",
    "GET",
    `/analytics/hot-tables/${HOUSE_A}`,
    tables,
    "getHotTables",
    200,
    "getHotTables",
  ],
  [
    "add-table",
    "POST",
    `/analytics/tables/${HOUSE_A}`,
    tables,
    "upsertTable",
    201,
    "upsertTable",
  ],
];

/**
 * Reads this PR leaves alone that carry no amount and no person: the house's
 * tables as geometry facts (`GET tables`) and its venue features (`venue`).
 * They are here so a staff 403 above is known to be the role and not the
 * token: the same staff token reads these.
 */
const OPEN: Row[] = [
  [
    "tables",
    "GET",
    `/analytics/tables/${HOUSE_A}`,
    tables,
    "listTables",
    200,
    "listTables",
  ],
  [
    "venue",
    "GET",
    `/analytics/venue/${HOUSE_A}`,
    tables,
    "getVenueProfile",
    200,
    "getVenue",
  ],
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
  });
}

let app: INestApplication;
let base: string;
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (who: Who) =>
  jwt.sign({
    sub: PEOPLE[who],
    email: `${who}@house.test`,
    // The token's own claim says staff for the unroled caller; the house
    // role comes from the access row, which names none.
    role: ROLE_OF[who] ?? "staff",
    restaurantId: HOUSE_OF[who],
  });
const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  const db = world();
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
      { provide: AnalyticsService, useValue: {} },
      { provide: AdvancedAnalyticsService, useValue: {} },
      { provide: TableAnalyticsService, useValue: tables },
      { provide: GoalsService, useValue: {} },
      { provide: ConsultantsService, useValue: {} },
      { provide: RecommendationsService, useValue: {} },
      { provide: RecommendationActionsService, useValue: {} },
      { provide: GoalScenarioRequestsService, useValue: {} },
      { provide: InsightGeneratorService, useValue: {} },
      { provide: InsightSchedulerService, useValue: {} },
      { provide: DayExclusionsService, useValue: {} },
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
  for (const stub of ALL_STUBS)
    for (const fn of Object.values(stub)) (fn as jest.Mock).mockClear();
});

async function call(method: string, path: string, token: string) {
  const body = method === "POST" ? JSON.stringify({ label: "Bar" }) : undefined;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** Every call any stubbed service received. */
const serviceCalls = () =>
  ALL_STUBS.flatMap((stub) =>
    Object.entries(stub).flatMap(([name, fn]) =>
      (fn as jest.Mock).mock.calls.map(() => name),
    ),
  );

describe("a staff member of the house is refused the takings reads and the table write", () => {
  it.each(GATED)(
    "[REVERT-FAILS] staff: %s answers 403 and the service is never asked",
    async (_label, method, path) => {
      const res = await call(method, path, tokenFor("staff"));
      expect(res.status).toBe(403);
      // RolesGuard's own refusal, before the handler runs.
      expect(res.body?.message).toBe("Forbidden resource");
      expect(serviceCalls()).toEqual([]);
    },
  );
});

describe("an access row that names no role is not a manager, whatever users.role says", () => {
  it.each(GATED)(
    "[REVERT-FAILS] no role in the house: %s answers 403",
    async (_label, method, path) => {
      const res = await call(method, path, tokenFor("unroled"));
      expect(res.status).toBe(403);
      expect(serviceCalls()).toEqual([]);
    },
  );
});

describe("an owner of another house is refused at this one", () => {
  it.each(GATED)(
    "owner of house B: %s answers 403",
    async (_label, method, path) => {
      const res = await call(method, path, tokenFor("ownerOfB"));
      expect(res.status).toBe(403);
      expect(serviceCalls()).toEqual([]);
    },
  );
});

describe.each(["owner", "manager"] as const)("as %s of the house", (who) => {
  it.each(GATED)(
    "reads %s, answered by its own service",
    async (label, method, path, stub, fn, ok) => {
      const res = await call(method, path, tokenFor(who));
      expect(res.status).toBe(ok);
      expect(res.body?.marker).toBe(label);
      expect(stub[fn]).toHaveBeenCalledTimes(1);
      expect((stub[fn] as jest.Mock).mock.calls[0][0]).toBe(HOUSE_A);
    },
  );
});

describe("the same staff token still reads what carries no amount and no person", () => {
  it.each(OPEN)(
    "staff: %s answers 200",
    async (label, method, path, stub, fn, ok) => {
      const res = await call(method, path, tokenFor("staff"));
      expect(res.status).toBe(ok);
      expect(res.body?.marker).toBe(label);
      expect(stub[fn]).toHaveBeenCalledTimes(1);
    },
  );
});

describe("each gated handler declares the gate itself", () => {
  const proto = AnalyticsController.prototype as unknown as Record<
    string,
    object
  >;

  it.each(GATED)(
    "[REVERT-FAILS] %s carries RolesGuard and @Roles(owner, manager)",
    (_label, _m, _p, _s, _f, _ok, handler) => {
      const fn = proto[handler];
      // A renamed handler would make the two checks below look at nothing.
      expect(typeof fn).toBe("function");
      expect(Reflect.getMetadata(GUARDS_METADATA, fn) ?? []).toContain(
        RolesGuard,
      );
      expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual(["owner", "manager"]);
    },
  );

  it.each(OPEN)("%s names no roles", (_l, _m, _p, _s, _f, _ok, handler) => {
    const fn = proto[handler];
    expect(typeof fn).toBe("function");
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toBeUndefined();
  });
});
