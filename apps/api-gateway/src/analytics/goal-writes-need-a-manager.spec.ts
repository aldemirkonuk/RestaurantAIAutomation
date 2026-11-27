/**
 * The four goal WRITE routes are an owner's or a manager's (r108 reports
 * review). The three goal GETs hand the token's gate to `goalsForRole`, which
 * swaps a withheld goal for a stub; the writes returned the whole
 * `analytics_goals` row (name, target, baseline = the till's reading, current),
 * so staff read the till through `PATCH {}` while the GET said "withheld".
 * Closing the door is a role gate on the route itself (RolesGuard is exact).
 *
 * Everything on the request path is real except GoalsService, which records
 * calls: a refused request must never reach it.
 *
 * Tests marked [REVERT-FAILS] fail without the `@Roles("owner","manager")`.
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

const SECRET = "test-secret-for-goal-writes-need-a-manager";
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

const world = (): StubDb =>
  makeStubDb({
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

const GOAL_ROW = { id: "g1", name: "Wine push", baseline_value: 12345 };
const goals = {
  createGoal: jest.fn(async () => GOAL_ROW),
  updateGoal: jest.fn(async () => GOAL_ROW),
  updateGoalStatus: jest.fn(async () => GOAL_ROW),
  proposeCuttingSpec: jest.fn(async () => ({ available: false })),
};
const reached = () =>
  Object.values(goals).reduce((n, f) => n + f.mock.calls.length, 0);

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
      { provide: DayExclusionsService, useValue: {} },
      { provide: AnalyticsService, useValue: {} },
      { provide: AdvancedAnalyticsService, useValue: {} },
      { provide: RecommendationsService, useValue: {} },
      { provide: RecommendationActionsService, useValue: {} },
      { provide: TableAnalyticsService, useValue: {} },
      { provide: GoalsService, useValue: goals },
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
  Object.values(goals).forEach((f) => f.mockClear());
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

const G = `/analytics/goals/${HOUSE_A}`;
/** [label, method, path, body] */
const WRITES: Array<[string, string, string, unknown]> = [
  [
    "POST a goal",
    "POST",
    G,
    { name: "x", metricKey: "wine_revenue", targetValue: 1 },
  ],
  ["PATCH a goal with {}", "PATCH", `${G}/g1`, {}],
  ["PUT a goal's status", "PUT", `${G}/g1/status`, { status: "archived" }],
  ["POST a cutting-spec", "POST", `${G}/g1/cutting-spec`, undefined],
];

describe("staff may not write a goal, so the till does not come back in the row", () => {
  it.each(WRITES)(
    "[REVERT-FAILS] staff: %s answers 403 and never reaches the service",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("staff"), body);
      expect(res.status).toBe(403);
      expect(res.body?.message).toBe("Forbidden resource");
      expect(JSON.stringify(res.body)).not.toContain("baseline_value");
      expect(reached()).toBe(0);
    },
  );
  it.each(WRITES)(
    "[REVERT-FAILS] no role in the house: %s answers 403",
    async (_label, method, path, body) => {
      const res = await call(method, path, tokenFor("unroled"), body);
      expect(res.status).toBe(403);
      expect(reached()).toBe(0);
    },
  );
});

describe("an owner and a manager still write goals", () => {
  it.each(WRITES)("owner: %s reaches the service", async (_l, m, p, b) => {
    const res = await call(m, p, tokenFor("owner"), b);
    expect(res.status).toBeLessThan(300);
    expect(reached()).toBe(1);
  });
  it.each(WRITES)("manager: %s reaches the service", async (_l, m, p, b) => {
    const res = await call(m, p, tokenFor("manager"), b);
    expect(res.status).toBeLessThan(300);
    expect(reached()).toBe(1);
  });
  it("an owner of another house is refused at this house", async () => {
    const res = await call("PATCH", `${G}/g1`, tokenFor("ownerOfB"), {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(reached()).toBe(0);
  });
});
