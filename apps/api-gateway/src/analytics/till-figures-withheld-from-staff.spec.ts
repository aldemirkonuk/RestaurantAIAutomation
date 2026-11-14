/**
 * The till's takings (`pos-revenue`) and which items sell together (`basket`)
 * are sales figures (ADR 0298 decision 9). A staff login of the house keeps
 * both routes and is told the figures are withheld; the services behind them
 * are never asked (ADR 0348 decision 3, the follow-up's first slice).
 *
 * Everything on the request path is real, as in
 * `analytics-money-needs-a-manager.spec.ts`: the controller, `JwtAuthGuard`,
 * passport with a signed token, `JwtStrategy` and `AuthService` reading the
 * caller's access row from the stub database. The services are jest stubs, so
 * a withheld answer is one whose service never ran.
 *
 * Tests marked [REVERT-FAILS] fail against the controller before this change.
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
import { asDatabaseService, makeStubDb } from "../team/testing/supabase-stub";
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

const SECRET = "test-secret-for-till-figures-withheld-from-staff";
const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const PEOPLE = {
  staff: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  owner: "33333333-3333-4333-8333-333333333333",
  // An access row naming no role; users.role says manager. No role reads the
  // staff row of ROLE_POLICY, so the figures are withheld.
  unroled: "55555555-5555-4555-8555-555555555555",
  // Made staff by the house; the token and users.role still say manager.
  demoted: "77777777-7777-4777-8777-777777777777",
} as const;
type Who = keyof typeof PEOPLE;
const ROLE_OF: Record<Who, string | null> = {
  staff: "staff",
  manager: "manager",
  owner: "owner",
  unroled: null,
  demoted: "staff",
};
const CLAIMED_ROLE_OF: Partial<Record<Who, string>> = {
  unroled: "manager",
  demoted: "manager",
};

const WINDOW = {
  restaurantId: HOUSE,
  from: "2026-10-15",
  to: "2026-11-13",
  days: 30,
  timezone: "Europe/Istanbul",
  zoneUnset: false,
  posConnected: true,
  revenue: 48210.5,
  checkCount: 311,
  dailySeries: [{ date: "2026-11-12", revenue: 1840 }],
};
const goals = { getPosRevenueWindow: jest.fn(async () => WINDOW) };
const analytics = {
  getPosConsumptionBreakdown: jest.fn(async () => [
    { masterWineId: "w1", bottles: 3, glasses: 4 },
  ]),
};
const tables = {
  getBasketAffinity: jest.fn(async () => ({
    sinceDays: 90,
    transactionCount: 120,
    pairs: [{ a: "Rakı", b: "Meze", count: 31 }],
  })),
};
const STUBS = [goals, analytics, tables];

let app: INestApplication;
let base: string;
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (who: Who) =>
  jwt.sign({
    sub: PEOPLE[who],
    email: `${who}@house.test`,
    role: who === "unroled" ? "staff" : (CLAIMED_ROLE_OF[who] ?? ROLE_OF[who]),
    restaurantId: HOUSE,
  });
const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  const db = makeStubDb({
    users: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      email: `${who}@house.test`,
      name: who,
      role: CLAIMED_ROLE_OF[who] ?? ROLE_OF[who],
      restaurant_id: HOUSE,
      email_verified: true,
    })),
    user_restaurant_access: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      restaurant_id: HOUSE,
      role: ROLE_OF[who],
      is_active: true,
    })),
  });
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
      { provide: AnalyticsService, useValue: analytics },
      { provide: AdvancedAnalyticsService, useValue: {} },
      { provide: TableAnalyticsService, useValue: tables },
      { provide: GoalsService, useValue: goals },
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
  if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  for (const stub of STUBS)
    for (const fn of Object.values(stub)) (fn as jest.Mock).mockClear();
});

async function get(path: string, who: Who) {
  const res = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${tokenFor(who)}` },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const serviceCalls = () =>
  STUBS.flatMap((stub) =>
    Object.entries(stub).flatMap(([name, fn]) =>
      (fn as jest.Mock).mock.calls.map(() => name),
    ),
  );

const WITHOUT_SALES: Who[] = ["staff", "unroled", "demoted"];

describe.each(WITHOUT_SALES)("as %s of the house", (who) => {
  it("[REVERT-FAILS] pos-revenue answers 200 with every figure withheld, and the till is never read", async () => {
    const res = await get(`/analytics/pos-revenue/${HOUSE}?days=7`, who);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      restaurantId: HOUSE,
      days: 7,
      salesWithheld: true,
      from: null,
      to: null,
      timezone: null,
      zoneUnset: null,
      posConnected: null,
      revenue: null,
      checkCount: null,
      dailySeries: null,
      consumption: null,
    });
    expect(serviceCalls()).toEqual([]);
  });

  it("[REVERT-FAILS] basket answers 200 with no pair and no count, and the checks are never read", async () => {
    const res = await get(`/analytics/basket/${HOUSE}`, who);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      restaurantId: HOUSE,
      salesWithheld: true,
      transactionCount: null,
      pairs: null,
    });
    expect(serviceCalls()).toEqual([]);
  });
});

describe.each(["owner", "manager"] as const)("as %s of the house", (who) => {
  it("pos-revenue reads the till and its breakdown", async () => {
    const res = await get(`/analytics/pos-revenue/${HOUSE}?days=30`, who);
    expect(res.status).toBe(200);
    expect(res.body.salesWithheld).toBeUndefined();
    expect(res.body.revenue).toBe(48210.5);
    expect(res.body.consumption).toHaveLength(1);
    expect(goals.getPosRevenueWindow).toHaveBeenCalledWith(HOUSE, 30);
  });

  it("basket reads the checks", async () => {
    const res = await get(`/analytics/basket/${HOUSE}`, who);
    expect(res.status).toBe(200);
    expect(res.body.salesWithheld).toBeUndefined();
    expect(res.body.pairs).toHaveLength(1);
    expect(tables.getBasketAffinity).toHaveBeenCalledWith(HOUSE);
  });
});
