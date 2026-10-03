/**
 * Goal writes are an owner's or a manager's (ADR 0250, the founder,
 * 2026-10-01: "Same rule as writes" for "Ask the book"; created_by "Take it
 * from the token").
 *
 * WHY THIS EXISTS
 * ---------------
 * At 1c1a676f8 the four goal write routes carried only the class-level
 * `JwtAuthGuard`, so a staff token created, edited, archived and asked the
 * paid model about goals — 201/200/201/200, measured with this harness — while
 * the /reports desk told staff "the controls are theirs" (owners' and
 * managers'). `createGoal` also stored `created_by` from the request body, so
 * a caller could name anyone as a goal's author.
 *
 * Everything on the request path is real: the AnalyticsController and its
 * decorators, `JwtAuthGuard` (tenant match, email and house checks), passport
 * verifying a token signed with @nestjs/jwt, `JwtStrategy`, and
 * `AuthService.validateJwtPayload` reading the caller's active access row from
 * the filter-honouring stub database. `GoalsService` is the REAL service over
 * the same stub; its methods are spied, not replaced, except the two progress
 * reads, whose model of the engine is not under test here.
 *
 * Tests marked [REVERT-FAILS] fail against origin/main's controller.
 */
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
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

const SECRET = "test-secret-for-goal-writes-need-a-manager";
const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GOAL = "99999999-9999-4999-8999-999999999999";
const SOMEONE_ELSE = "44444444-4444-4444-8444-444444444444";

const PEOPLE = {
  staff: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  owner: "33333333-3333-4333-8333-333333333333",
  // An active access row that names no role, held by someone whose
  // account-wide `users.role` says manager in this same house: `JwtStrategy`
  // gives no role (ADR 0162), and `users.role` must not decide it here.
  unroled: "55555555-5555-4555-8555-555555555555",
} as const;
type Who = keyof typeof PEOPLE;

function world(): StubDb {
  return makeStubDb({
    users: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      email: `${who}@house.test`,
      name: who,
      role: who === "unroled" ? "manager" : who,
      restaurant_id: HOUSE_A,
      email_verified: true,
    })),
    user_restaurant_access: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      restaurant_id: HOUSE_A,
      role: who === "unroled" ? null : who,
      is_active: true,
    })),
    analytics_goals: [
      {
        id: GOAL,
        restaurant_id: HOUSE_A,
        name: "Checks served",
        metric_key: "checks",
        target_value: 100,
        baseline_value: 0,
        current_value: 0,
        direction: "at_least",
        period: "month",
        deadline: null,
        status: "active",
        created_by: null,
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    pos_checks: [],
  });
}

let db: StubDb;
let goals: GoalsService;
let scenarioRequests: { record: jest.Mock };
let app: INestApplication;
let base: string;
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (who: Who, house = HOUSE_A) =>
  jwt.sign({
    sub: PEOPLE[who],
    email: `${who}@house.test`,
    role: who,
    restaurantId: house,
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
  // No ANTHROPIC_API_KEY: "Ask the book" answers `available:false` and calls
  // no model, so a request that reaches it costs nothing here.
  const config = { get: () => undefined } as unknown as ConfigService;
  goals = new GoalsService(
    asDatabaseService(db),
    {} as InsightGeneratorService,
    config,
    {} as any,
    {} as any,
    {} as AnalyticsService,
  );
  scenarioRequests = {
    record: jest.fn(async () => ({ recorded: true, note: "Mudavym has it." })),
  };
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
      { provide: GoalsService, useValue: goals },
      { provide: GoalScenarioRequestsService, useValue: scenarioRequests },
      { provide: AnalyticsService, useValue: {} },
      { provide: AdvancedAnalyticsService, useValue: {} },
      { provide: RecommendationsService, useValue: {} },
      { provide: RecommendationActionsService, useValue: {} },
      { provide: TableAnalyticsService, useValue: {} },
      { provide: ConsultantsService, useValue: {} },
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
  jest.restoreAllMocks();
});

const spies: Record<string, jest.SpyInstance> = {};
beforeEach(() => {
  jest.restoreAllMocks();
  scenarioRequests.record.mockClear();
  db.ops.length = 0;
  for (const m of [
    "createGoal",
    "updateGoal",
    "updateGoalStatus",
    "proposeCuttingSpec",
    "listGoals",
  ] as const)
    spies[m] = jest.spyOn(goals, m);
  spies.listGoalsWithProgress = jest
    .spyOn(goals, "listGoalsWithProgress")
    .mockResolvedValue({ goals: [] } as any);
  spies.getGoalProgress = jest
    .spyOn(goals, "getGoalProgress")
    .mockResolvedValue({ goal: { id: GOAL } } as any);
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

const goalWrites = () =>
  db.ops.filter((o) => o.table === "analytics_goals" && o.op !== "select");

/** [label, method, path, body, the GoalsService method the handler calls, success status] */
const WRITES: Array<[string, string, string, unknown, string, number]> = [
  [
    "create",
    "POST",
    `/analytics/goals/${HOUSE_A}`,
    { name: "Checks", metricKey: "checks", targetValue: 5 },
    "createGoal",
    201,
  ],
  [
    "edit",
    "PATCH",
    `/analytics/goals/${HOUSE_A}/${GOAL}`,
    { targetValue: 9 },
    "updateGoal",
    200,
  ],
  [
    "status",
    "PUT",
    `/analytics/goals/${HOUSE_A}/${GOAL}/status`,
    { status: "archived" },
    "updateGoalStatus",
    200,
  ],
  [
    "Ask the book (cutting-spec)",
    "POST",
    `/analytics/goals/${HOUSE_A}/${GOAL}/cutting-spec`,
    {},
    "proposeCuttingSpec",
    201,
  ],
];

describe("a staff member of the house is refused every goal write", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] staff: %s answers 403 and nothing reaches GoalsService",
    async (_label, method, path, body, svc) => {
      const res = await call(method, path, tokenFor("staff"), body);
      expect(res.status).toBe(403);
      // RolesGuard's own refusal. The web maps exactly this body to words
      // (useGoalsDesk.ts `goalWriteRoleRefusal`), so it is pinned here.
      expect(res.body?.message).toBe("Forbidden resource");
      expect(spies[svc]).not.toHaveBeenCalled();
      expect(goalWrites()).toEqual([]);
    },
  );
});

describe("an access row that names no role is not a manager, whatever users.role says", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] no role in the house: %s answers 403",
    async (_label, method, path, body, svc) => {
      const res = await call(method, path, tokenFor("unroled"), body);
      expect(res.status).toBe(403);
      expect(spies[svc]).not.toHaveBeenCalled();
      expect(goalWrites()).toEqual([]);
    },
  );
});

describe.each(["owner", "manager"] as const)("as %s of the house", (who) => {
  it.each(WRITES)("may %s", async (_label, method, path, body, svc, ok) => {
    const res = await call(method, path, tokenFor(who), body);
    expect(res.status).toBe(ok);
    expect(spies[svc]).toHaveBeenCalledTimes(1);
  });
});

describe("created_by is the signed-in person (ADR 0250, 'Take it from the token')", () => {
  it("[REVERT-FAILS] a body createdBy naming someone else is ignored", async () => {
    const res = await call(
      "POST",
      `/analytics/goals/${HOUSE_A}`,
      tokenFor("manager"),
      {
        name: "Checks",
        metricKey: "checks",
        targetValue: 5,
        createdBy: SOMEONE_ELSE,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.created_by).toBe(PEOPLE.manager);
    const insert = db.ops.find(
      (o) => o.table === "analytics_goals" && o.op === "insert",
    );
    expect(insert?.payload).toMatchObject({ created_by: PEOPLE.manager });
    expect(spies.createGoal.mock.calls[0][1]).toMatchObject({
      createdBy: PEOPLE.manager,
    });
  });

  it("[REVERT-FAILS] a body that names nobody still records the caller", async () => {
    const res = await call(
      "POST",
      `/analytics/goals/${HOUSE_A}`,
      tokenFor("owner"),
      {
        name: "Checks",
        metricKey: "checks",
        targetValue: 5,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.created_by).toBe(PEOPLE.owner);
  });
});

describe("what stays open to every member", () => {
  it.each([
    ["the goal list", `/analytics/goals/${HOUSE_A}`, "listGoals"],
    [
      "every goal's progress",
      `/analytics/goals/${HOUSE_A}/progress`,
      "listGoalsWithProgress",
    ],
    [
      "one goal's progress",
      `/analytics/goals/${HOUSE_A}/${GOAL}/progress`,
      "getGoalProgress",
    ],
  ])("staff still read %s", async (_label, path, svc) => {
    const res = await call("GET", path, tokenFor("staff"));
    expect(res.status).toBe(200);
    expect(spies[svc]).toHaveBeenCalledTimes(1);
  });

  it("staff may still ask Mudavym for a scenario in words (unchanged; ADR 0120)", async () => {
    const res = await call(
      "POST",
      `/analytics/goal-scenarios/requests/${HOUSE_A}`,
      tokenFor("staff"),
      {
        words: "covers per hour",
      },
    );
    expect(res.status).toBe(201);
    expect(scenarioRequests.record).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: HOUSE_A,
        requestedBy: PEOPLE.staff,
      }),
    );
  });
});

describe("the gates around it still hold", () => {
  it("a manager of house A naming house B is refused by the tenant check", async () => {
    const res = await call(
      "POST",
      `/analytics/goals/${HOUSE_B}`,
      tokenFor("manager"),
      {
        name: "Checks",
        metricKey: "checks",
        targetValue: 5,
      },
    );
    expect(res.status).toBe(403);
    expect(spies.createGoal).not.toHaveBeenCalled();
  });

  it("no token is 401", async () => {
    const res = await call("POST", `/analytics/goals/${HOUSE_A}`, null, {});
    expect(res.status).toBe(401);
  });
});

describe("the four handlers carry the gate in the sibling pattern (metadata)", () => {
  const proto = AnalyticsController.prototype as unknown as Record<
    string,
    object
  >;
  it.each([
    "createGoal",
    "updateGoal",
    "updateGoalStatus",
    "proposeGoalCuttingSpec",
  ])("[REVERT-FAILS] %s: RolesGuard, owner and manager exactly", (handler) => {
    expect(Reflect.getMetadata("__guards__", proto[handler])).toEqual([
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, proto[handler])).toEqual([
      "owner",
      "manager",
    ]);
  });

  it.each([
    "listGoals",
    "listGoalsWithProgress",
    "getGoalProgress",
    "requestGoalScenario",
  ])("%s carries no role gate", (handler) => {
    expect(Reflect.getMetadata(ROLES_KEY, proto[handler])).toBeUndefined();
  });
});
