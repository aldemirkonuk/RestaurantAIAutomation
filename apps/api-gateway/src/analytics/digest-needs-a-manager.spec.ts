/**
 * The house's daily post is an owner's or a manager's, and a change to it is
 * filed in "What changed here" (F-622, 2026-10-09).
 *
 * WHY THIS EXISTS
 * ---------------
 * `PUT /analytics/recommendations/:rid/digest` carried only the class-level
 * `JwtAuthGuard`, while Settings shows the digest switch to owners and
 * managers only. /recommendations is open to every role, so a server could
 * arm or disarm the post for the whole house from "The house's post", and no
 * row said who did it.
 *
 * Everything on the request path is real: the AnalyticsController and its
 * decorators, `JwtAuthGuard`, passport over a signed token, `JwtStrategy`, and
 * `AuthService.validateJwtPayload` reading the caller's access row from the
 * stub database. `RecommendationActionsService` and `SettingsAuditService` are
 * the REAL services over the same stub, so a write that got through is a row.
 *
 * Tests marked [REVERT-FAILS] fail against the controller before F-622.
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
import { SettingsAuditService } from "../settings-audit/settings-audit.service";
import { SettingsAuditModule } from "../settings-audit/settings-audit.module";
import { AnalyticsModule } from "./analytics.module";
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

const SECRET = "test-secret-for-digest-needs-a-manager";
const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const PEOPLE = {
  staff: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  owner: "33333333-3333-4333-8333-333333333333",
} as const;
type Who = keyof typeof PEOPLE;

/** The house armed its post at 07:00 before each test. */
const armedRow = () => [
  {
    restaurant_id: HOUSE_A,
    digest_enabled: true,
    digest_hour: 7,
    digest_min_urgency: "this_week",
    recipient_email: null,
    last_sent_at: null,
  },
];

function world(): StubDb {
  return makeStubDb({
    users: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      email: `${who}@house.test`,
      name: who,
      role: who,
      restaurant_id: HOUSE_A,
      email_verified: true,
    })),
    user_restaurant_access: (Object.keys(PEOPLE) as Who[]).map((who) => ({
      user_id: PEOPLE[who],
      restaurant_id: HOUSE_A,
      role: who,
      is_active: true,
    })),
    recommendation_digest_prefs: armedRow(),
    system_audit_log: [],
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
    role: who,
    restaurantId: HOUSE_A,
  });
const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = SECRET;
  db = world();
  const dbService = asDatabaseService(db);
  const auth = new AuthService(
    new JwtService({}),
    { get: (k: string) => (k === "JWT_SECRET" ? SECRET : undefined) } as any,
    dbService,
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
        provide: RecommendationActionsService,
        useValue: new RecommendationActionsService(dbService),
      },
      {
        provide: SettingsAuditService,
        useValue: new SettingsAuditService(dbService),
      },
      { provide: DayExclusionsService, useValue: {} },
      { provide: AnalyticsService, useValue: {} },
      { provide: AdvancedAnalyticsService, useValue: {} },
      { provide: RecommendationsService, useValue: {} },
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
  db.tables.recommendation_digest_prefs = armedRow();
  db.tables.system_audit_log = [];
  db.ops.length = 0;
});

async function put(who: Who, body: unknown) {
  const res = await fetch(
    `${base}/analytics/recommendations/${HOUSE_A}/digest`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${tokenFor(who)}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const digestWrites = () =>
  db.ops.filter(
    (o) => o.table === "recommendation_digest_prefs" && o.op !== "select",
  );

describe("a staff member may not arm or disarm the house's post", () => {
  it("[REVERT-FAILS] staff: PUT answers 403 and nothing is written", async () => {
    const res = await put("staff", { digestEnabled: false });
    expect(res.status).toBe(403);
    expect(res.body?.message).toBe("Forbidden resource");
    expect(digestWrites()).toEqual([]);
    expect(db.tables.recommendation_digest_prefs[0].digest_enabled).toBe(true);
    expect(db.tables.system_audit_log).toEqual([]);
  });
});

describe.each(["owner", "manager"] as const)("as %s of the house", (who) => {
  it("[REVERT-FAILS] the change is saved and filed under the signed-in person", async () => {
    const res = await put(who, { digestEnabled: false, digestHour: 7 });
    expect(res.status).toBe(200);
    expect(res.body.digestEnabled).toBe(false);
    expect(res.body.audited).toBe(true);
    expect(db.tables.recommendation_digest_prefs[0].digest_enabled).toBe(false);
    expect(db.tables.system_audit_log).toHaveLength(1);
    const row = db.tables.system_audit_log[0];
    expect(row.actor_id).toBe(PEOPLE[who]);
    expect(row.action).toBe("recommendation_digest_changed");
    expect(row.restaurant_id).toBe(HOUSE_A);
    // Only the field that moved: the hour was sent but stayed 7.
    expect(row.changes.register).toBe("notifications");
    expect(row.changes.fields).toEqual({
      digestEnabled: { from: true, to: false },
    });
  });

  it("a save that changes nothing files no row", async () => {
    const res = await put(who, { digestEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.audited).toBe(false);
    expect(db.tables.system_audit_log).toEqual([]);
  });
});

describe("the app wires the settings log into analytics", () => {
  it("AnalyticsModule imports SettingsAuditModule", () => {
    const imports = Reflect.getMetadata("imports", AnalyticsModule) as unknown[];
    expect(imports).toContain(SettingsAuditModule);
  });
});
