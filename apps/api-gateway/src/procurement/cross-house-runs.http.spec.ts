/**
 * Two routes that, at c47fd8a01, ran scheduled work across every house for
 * any signed-in member of any house (fix/tenant-guard-and-cross-house-runs,
 * 817-route audit, 2026-09-29).
 *
 *   POST /procurement/deliveries/clocks/run
 *     The hourly delivery-clock poller (ADR 0103 A10), with a body `now` that
 *     "runs the ladder as if it were that moment". A member of house A could
 *     send `now` a year ahead and fire, up to 500 per call, every open timer
 *     from every house due before it: LAPSED with `lapse_deemed` written
 *     where the delivery was not already settled, and a high-priority
 *     `delivery_lapsed` notice to the house.
 *
 *   POST /recurring-orders/:restaurantId/execute-check
 *     The 08:00 recurring-order cron, which ignores the path house and executes
 *     every house's due schedules. Summarised "(dev/test)", with no
 *     environment or role gate.
 *
 * Callers: git grep over apps/, services/, scripts/, .github/, .railway/ and
 * vercel.json found none for either route. The runners that exist are the
 * in-process `@Cron`s (`DeliveryClockService.pollHourly`,
 * `executeDueRecurringOrders`), which call the services directly and are
 * unaffected.
 *
 * The app below runs the REAL JwtAuthGuard (only passport is stood in for,
 * setting `request.user` from test headers as JwtStrategy.validate would), the
 * REAL PlatformOperatorGuard / PlatformOperatorService over an in-memory
 * store that applies the service's own filters, and the REAL
 * NonProductionGuard. The work itself is a jest double, so "did it run?" is
 * observable.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import {
  PlatformOperatorGuard,
  PlatformOperatorService,
} from "../common/orchestrator/platform-operator.service";
import { DatabaseService } from "../database/database.service";
import { DeliveryClockService } from "./canonical/delivery-clock.service";
import { DeliverySpineService } from "./canonical/delivery-spine.service";
import { DeliveryService } from "./canonical/delivery.service";
import { DeliveriesController } from "./deliveries.controller";
import { RecurringOrdersController } from "./recurring-orders.controller";
import { RecurringOrdersService } from "./recurring-orders.service";

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const OWNER_OF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPERATOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // staff of A, plus the grant
const DEVELOPER_ONLY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; // no grant

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;

function freshTables(): Record<string, Row[]> {
  return {
    platform_operator_grants: [
      { user_id: OPERATOR, enabled: true, revoked_at: null },
    ],
    user_roles: [
      { id: "r1", user_id: OPERATOR, role: "developer", revoked_at: null },
      {
        id: "r2",
        user_id: DEVELOPER_ONLY,
        role: "developer",
        revoked_at: null,
      },
    ],
  };
}

/** eq/is filters over the in-memory rows; awaitable; maybeSingle. */
const client = {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let limit: number | null = null;
    const run = () => {
      let rows = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (limit !== null) rows = rows.slice(0, limit);
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const builder: any = {
      select: () => builder,
      eq: (c: string, v: unknown) => {
        filters.push((r) => r[c] === v);
        return builder;
      },
      is: (c: string, v: unknown) => {
        filters.push((r) => (r[c] ?? null) === v);
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: data[0] ?? null, error };
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
    };
    return builder;
  },
};

const clocks = { runDue: jest.fn() };
const recurring = { executeDueRecurringOrders: jest.fn() };

let app: INestApplication;
let base: string;
const savedEnv = process.env.NODE_ENV;

async function call(
  path: string,
  as: { user: string; house?: string; role?: string },
  body?: unknown,
) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer t",
      "content-type": "application/json",
      "x-test-user": as.user,
      "x-test-house": as.house ?? HOUSE_A,
      "x-test-role": as.role ?? "owner",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  const passport = Object.getPrototypeOf(JwtAuthGuard.prototype);
  jest.spyOn(passport, "canActivate").mockImplementation(async (ctx: any) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = {
      userId: req.headers["x-test-user"],
      restaurantId: req.headers["x-test-house"],
      role: req.headers["x-test-role"],
      emailVerified: true,
      // A cached Studio claim is not platform authority (ADR 0143).
      studioRoles: ["developer"],
    };
    return true;
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [DeliveriesController, RecurringOrdersController],
    providers: [
      PlatformOperatorService,
      PlatformOperatorGuard,
      { provide: DatabaseService, useValue: { client, supabase: client } },
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
      { provide: DeliveryClockService, useValue: clocks },
      { provide: DeliverySpineService, useValue: {} },
      { provide: DeliveryService, useValue: {} },
      { provide: RecurringOrdersService, useValue: recurring },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  process.env.NODE_ENV = savedEnv;
  await app?.close();
  jest.restoreAllMocks();
});

beforeEach(() => {
  process.env.NODE_ENV = "test";
  tables = freshTables();
  clocks.runDue.mockReset().mockResolvedValue({
    ok: true,
    value: {
      examined: 0,
      notifiedHalf: 0,
      escalated: 0,
      lapsed: 0,
      blocked: 0,
    },
  });
  recurring.executeDueRecurringOrders.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  process.env.NODE_ENV = savedEnv;
});

const FAR_FUTURE = "2099-01-01T00:00:00Z";

describe("POST /procurement/deliveries/clocks/run — platform operators only", () => {
  it.each([
    ["an owner of a house", { user: OWNER_OF_A, role: "owner" }],
    ["a manager", { user: OWNER_OF_A, role: "manager" }],
    [
      "a Studio developer with no operator grant",
      { user: DEVELOPER_ONLY, role: "staff" },
    ],
  ])(
    "refuses %s a far-future `now` with 403 and runs nothing",
    async (_l, as) => {
      const res = await call("/procurement/deliveries/clocks/run", as, {
        now: FAR_FUTURE,
      });
      expect(res.status).toBe(403);
      expect(clocks.runDue).not.toHaveBeenCalled();
    },
  );

  it("refuses an owner even with no `now` (the hourly cron is the runner)", async () => {
    const res = await call("/procurement/deliveries/clocks/run", {
      user: OWNER_OF_A,
    });
    expect(res.status).toBe(403);
    expect(clocks.runDue).not.toHaveBeenCalled();
  });

  it("refuses in production for a non-operator too (403, nothing run)", async () => {
    process.env.NODE_ENV = "production";
    const res = await call("/procurement/deliveries/clocks/run", {
      user: OWNER_OF_A,
    });
    expect(res.status).toBe(403);
    expect(clocks.runDue).not.toHaveBeenCalled();
  });

  it("lets an operator run the catch-up at the real time in production", async () => {
    process.env.NODE_ENV = "production";
    const before = Date.now();
    const res = await call("/procurement/deliveries/clocks/run", {
      user: OPERATOR,
      role: "staff",
    });
    expect(res.status).toBe(201);
    expect(clocks.runDue).toHaveBeenCalledTimes(1);
    const at = (clocks.runDue.mock.calls[0][0] as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("never honours a caller's `now` in production, even an operator's (400, nothing run)", async () => {
    process.env.NODE_ENV = "production";
    const res = await call(
      "/procurement/deliveries/clocks/run",
      { user: OPERATOR, role: "staff" },
      { now: FAR_FUTURE },
    );
    expect(res.status).toBe(400);
    expect(clocks.runDue).not.toHaveBeenCalled();
  });

  it("still honours an operator's `now` outside production (the test/dev use)", async () => {
    const res = await call(
      "/procurement/deliveries/clocks/run",
      { user: OPERATOR, role: "staff" },
      { now: FAR_FUTURE },
    );
    expect(res.status).toBe(201);
    expect((clocks.runDue.mock.calls[0][0] as Date).toISOString()).toBe(
      "2099-01-01T00:00:00.000Z",
    );
  });
});

describe("POST /recurring-orders/:restaurantId/execute-check — non-production, operators only", () => {
  it.each([
    ["an owner naming their own house", { user: OWNER_OF_A, role: "owner" }],
    ["a manager naming their own house", { user: OWNER_OF_A, role: "manager" }],
    [
      "a Studio developer with no operator grant",
      { user: DEVELOPER_ONLY, role: "staff" },
    ],
  ])("refuses %s with 403 and executes nothing", async (_l, as) => {
    const res = await call(`/recurring-orders/${HOUSE_A}/execute-check`, as);
    expect(res.status).toBe(403);
    expect(recurring.executeDueRecurringOrders).not.toHaveBeenCalled();
  });

  it("answers 404 in production to a signed-in caller that JwtAuthGuard admits, operators included", async () => {
    process.env.NODE_ENV = "production";
    for (const as of [
      { user: OWNER_OF_A },
      { user: OPERATOR, role: "staff" },
    ]) {
      const res = await call(`/recurring-orders/${HOUSE_A}/execute-check`, as);
      expect(res.status).toBe(404);
    }
    expect(recurring.executeDueRecurringOrders).not.toHaveBeenCalled();
  });

  it("lets an operator run it outside production, naming their own house", async () => {
    const res = await call(`/recurring-orders/${HOUSE_A}/execute-check`, {
      user: OPERATOR,
      role: "staff",
    });
    expect(res.status).toBe(201);
    expect(recurring.executeDueRecurringOrders).toHaveBeenCalledTimes(1);
  });

  it("still refuses an operator naming another house in the path (tenant guard)", async () => {
    const res = await call(`/recurring-orders/${HOUSE_B}/execute-check`, {
      user: OPERATOR,
      role: "staff",
    });
    expect(res.status).toBe(403);
    expect(recurring.executeDueRecurringOrders).not.toHaveBeenCalled();
  });
});
