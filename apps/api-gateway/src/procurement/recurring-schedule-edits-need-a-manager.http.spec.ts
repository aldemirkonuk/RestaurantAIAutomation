/**
 * Editing or deactivating a recurring-order schedule needs a manager or an
 * owner; creating one does not (ADR 0246, founder ruling 2026-10-01).
 *
 * Why: `PUT /recurring-orders/:restaurantId/:id` had only the class-level
 * JwtAuthGuard. A staff member could edit a schedule a manager created, and the
 * 08:00 cron then raised that schedule's order as the schedule's `created_by`,
 * the manager (Audit of PR #538 at 46c74b08f, finding 1).
 *
 * The app below runs the REAL RecurringOrdersController, the REAL
 * RecurringOrdersService and the REAL OrganizationsService (the role check the
 * order-money paths use) over an in-memory store, and the REAL JwtAuthGuard
 * with passport stubbed: it sets `request.user` from test headers. Every case
 * marked [REVERT-FAILS] was run against the controller on origin/main
 * e88593bf8 and observed to fail.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import {
  PlatformOperatorGuard,
  PlatformOperatorService,
} from "../common/orchestrator/platform-operator.service";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { ProcurementService } from "./procurement.service";
import { RecurringOrdersController } from "./recurring-orders.controller";
import { RecurringOrdersService } from "./recurring-orders.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-000000000001";
const MANAGER = "a0000000-0000-4000-8000-000000000002";
const STAFF = "a0000000-0000-4000-8000-000000000003";
const UNREADABLE = "a0000000-0000-4000-8000-000000000004";
// Their house access read fails; the legacy `users` row decides (or not).
const LEGACY_MANAGER = "a0000000-0000-4000-8000-000000000005";
const LEGACY_STAFF = "a0000000-0000-4000-8000-000000000006";
const NO_LEGACY = "a0000000-0000-4000-8000-000000000007";
// An active staff access row, and a legacy `users` row naming manager.
const STAFF_ROW_LEGACY_MANAGER = "a0000000-0000-4000-8000-000000000008";
const INVENTORY = "33333333-3333-4333-8333-333333333333";
const VENDOR = "44444444-4444-4444-8444-444444444444";
const OF_MANAGER = "55555555-5555-4555-8555-555555555555";
const OF_STAFF = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let writes: string[];

function schedule(id: string, createdBy: string): Row {
  return {
    id,
    restaurant_id: HOUSE,
    inventory_id: INVENTORY,
    provider_id: VENDOR,
    quantity: 6,
    unit_type: "bottle",
    bottles_per_unit: 1,
    target_price: 300,
    frequency: "weekly",
    frequency_day: 1,
    auto_approve: true,
    next_order_date: "2026-10-05",
    last_order_date: null,
    active: true,
    created_by: createdBy,
    notes: null,
    execution_count: 0,
    created_at: "t0",
    updated_at: "t0",
  };
}

function fresh() {
  writes = [];
  tables = {
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
      {
        user_id: MANAGER,
        restaurant_id: HOUSE,
        role: "manager",
        is_active: true,
      },
      { user_id: STAFF, restaurant_id: HOUSE, role: "staff", is_active: true },
      {
        user_id: STAFF_ROW_LEGACY_MANAGER,
        restaurant_id: HOUSE,
        role: "staff",
        is_active: true,
      },
    ],
    users: [
      { user_id: LEGACY_MANAGER, role: "manager", restaurant_id: HOUSE },
      { user_id: LEGACY_STAFF, role: "staff", restaurant_id: HOUSE },
      {
        user_id: STAFF_ROW_LEGACY_MANAGER,
        role: "manager",
        restaurant_id: HOUSE,
      },
    ],
    recurring_orders: [
      schedule(OF_MANAGER, MANAGER),
      schedule(OF_STAFF, STAFF),
    ],
  };
}

/**
 * eq filters, insert/update/select, awaitable, single/maybeSingle. For
 * UNREADABLE both role reads fail; for LEGACY_MANAGER, LEGACY_STAFF and
 * NO_LEGACY only the `user_restaurant_access` read fails, the way a database
 * outage would.
 */
const client: any = {
  from(table: string) {
    const filters: Array<[string, unknown]> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    const asks = (who: string[]) =>
      filters.some(([c, v]) => c === "user_id" && who.includes(String(v)));
    const failsForUnreadable = () =>
      (table === "users" && asks([UNREADABLE])) ||
      (table === "user_restaurant_access" &&
        asks([UNREADABLE, LEGACY_MANAGER, LEGACY_STAFF, NO_LEGACY]));
    const run = (): { data: any; error: any } => {
      if (failsForUnreadable()) {
        return { data: null, error: { message: "connection refused" } };
      }
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "insert") {
        const list = Array.isArray(payload) ? payload : [payload as Row];
        const made = list.map((r, i) => ({
          id: `new-${rows.length + i}`,
          created_at: "t1",
          updated_at: "t1",
          ...r,
        }));
        rows.push(...made);
        writes.push(`insert:${table}`);
        return { data: made, error: null };
      }
      const matched = rows.filter((r) =>
        filters.every(([c, v]) => String(r[c]) === String(v)),
      );
      if (op === "update") {
        matched.forEach((r) => Object.assign(r, payload));
        if (matched.length) writes.push(`update:${table}`);
      }
      return { data: matched.map((r) => ({ ...r })), error: null };
    };
    const builder: any = {
      select: () => builder,
      insert: (row: Row | Row[]) => {
        op = "insert";
        payload = row;
        return builder;
      },
      update: (values: Row) => {
        op = "update";
        payload = values;
        return builder;
      },
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return builder;
      },
      is: () => builder,
      in: () => builder,
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: error ? null : (data[0] ?? null), error };
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return data[0]
          ? { data: data[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } };
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
    };
    return builder;
  },
};

const orchestrator = { publishEvent: jest.fn().mockResolvedValue(undefined) };
let app: INestApplication;
let base: string;

async function call(method: string, path: string, as: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: "Bearer t",
      "content-type": "application/json",
      "x-test-user": as,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const row = (id: string) => tables.recurring_orders.find((r) => r.id === id)!;
const put = (id: string, as: string) =>
  call("PUT", `/recurring-orders/${HOUSE}/${id}`, as, {
    quantity: 60,
    target_price: 1,
  });
const del = (id: string, as: string) =>
  call("DELETE", `/recurring-orders/${HOUSE}/${id}`, as);

beforeAll(async () => {
  const passport = Object.getPrototypeOf(JwtAuthGuard.prototype);
  jest.spyOn(passport, "canActivate").mockImplementation(async (ctx: any) => {
    const req = ctx.switchToHttp().getRequest();
    req.user = {
      userId: req.headers["x-test-user"],
      restaurantId: HOUSE,
      emailVerified: true,
    };
    return true;
  });
  const db = { supabase: client, client, getClient: () => client };
  const moduleRef = await Test.createTestingModule({
    controllers: [RecurringOrdersController],
    providers: [
      RecurringOrdersService,
      OrganizationsService,
      // execute-check's guard; that route is not exercised here.
      PlatformOperatorService,
      PlatformOperatorGuard,
      { provide: DatabaseService, useValue: db },
      { provide: ProcurementService, useValue: {} },
      { provide: OrchestratorService, useValue: orchestrator },
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const { port } = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app?.close();
  jest.restoreAllMocks();
});

beforeEach(() => fresh());

describe("staff may not edit or deactivate a schedule", () => {
  it.each([
    ["a manager's", OF_MANAGER],
    ["their own", OF_STAFF],
  ])(
    "[REVERT-FAILS] refuses staff a PUT on %s schedule with 403 and writes nothing",
    async (_label, id) => {
      const res = await put(id, STAFF);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        "Only managers and owners can edit a recurring order schedule",
      );
      expect(row(id)).toMatchObject({
        quantity: 6,
        target_price: 300,
        updated_at: "t0",
      });
      expect(writes).toEqual([]);
    },
  );

  it.each([
    ["a manager's", OF_MANAGER],
    ["their own", OF_STAFF],
  ])(
    "[REVERT-FAILS] refuses staff a DELETE on %s schedule with 403 and writes nothing",
    async (_label, id) => {
      const res = await del(id, STAFF);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        "Only managers and owners can deactivate a recurring order schedule",
      );
      expect(row(id)).toMatchObject({ active: true, updated_at: "t0" });
      expect(writes).toEqual([]);
    },
  );

  it("[REVERT-FAILS] refuses a caller when both role reads fail, with 403, and writes nothing", async () => {
    // Both the access read and the legacy `users` read fail, so the helper
    // (`strict: false`) has no role for the caller and refuses.
    expect((await put(OF_MANAGER, UNREADABLE)).status).toBe(403);
    expect((await del(OF_MANAGER, UNREADABLE)).status).toBe(403);
    expect(row(OF_MANAGER)).toMatchObject({
      quantity: 6,
      active: true,
      updated_at: "t0",
    });
    expect(writes).toEqual([]);
  });
});

describe("when the access read fails, the legacy users row decides", () => {
  // `lookupRestaurantRole` (organizations.service.ts:40-64) falls back to the
  // legacy `users` row (its role, when its restaurant_id is this house) when
  // the access read fails or finds no active row. These pin both directions.
  it("lets a legacy manager of this house edit and deactivate", async () => {
    expect((await put(OF_STAFF, LEGACY_MANAGER)).status).toBe(200);
    expect(row(OF_STAFF)).toMatchObject({ quantity: 60 });
    expect((await del(OF_MANAGER, LEGACY_MANAGER)).status).toBe(200);
    expect(row(OF_MANAGER).active).toBe(false);
  });

  it.each([
    ["a legacy staff member of this house", LEGACY_STAFF],
    ["a caller with no legacy row", NO_LEGACY],
  ])(
    "[REVERT-FAILS] refuses %s, with 403, and writes nothing",
    async (_label, as) => {
      expect((await put(OF_MANAGER, as)).status).toBe(403);
      expect((await del(OF_MANAGER, as)).status).toBe(403);
      expect(row(OF_MANAGER)).toMatchObject({
        quantity: 6,
        active: true,
        updated_at: "t0",
      });
      expect(writes).toEqual([]);
    },
  );
});

describe("an active access row decides, whatever the legacy row says", () => {
  // `if (fromAccess) return` (organizations.service.ts:48-49): the legacy
  // `users` row is read only when the access read fails or finds no active
  // row, so an active staff row is refused even if the legacy row says
  // manager.
  it("[REVERT-FAILS] refuses an active staff access row with a legacy manager row, with 403, and writes nothing", async () => {
    expect((await put(OF_MANAGER, STAFF_ROW_LEGACY_MANAGER)).status).toBe(403);
    expect((await del(OF_MANAGER, STAFF_ROW_LEGACY_MANAGER)).status).toBe(403);
    expect(row(OF_MANAGER)).toMatchObject({
      quantity: 6,
      active: true,
      updated_at: "t0",
    });
    expect(writes).toEqual([]);
  });
});

describe("managers and owners may", () => {
  it.each([
    ["a manager", MANAGER],
    ["an owner", OWNER],
  ])("lets %s edit a schedule", async (_label, as) => {
    const res = await put(OF_STAFF, as);
    expect(res.status).toBe(200);
    expect(row(OF_STAFF)).toMatchObject({ quantity: 60, target_price: 1 });
  });

  it.each([
    ["a manager", MANAGER],
    ["an owner", OWNER],
  ])("lets %s deactivate a schedule", async (_label, as) => {
    const res = await del(OF_MANAGER, as);
    expect(res.status).toBe(200);
    expect(row(OF_MANAGER).active).toBe(false);
  });
});

describe("staff may still create a schedule", () => {
  it("creates one, recorded as the staff member's", async () => {
    const res = await call("POST", `/recurring-orders/${HOUSE}`, STAFF, {
      inventory_id: INVENTORY,
      provider_id: VENDOR,
      quantity: 6,
      frequency: "weekly",
      frequency_day: 1,
      next_order_date: "2026-10-12",
      auto_approve: true,
    });
    expect(res.status).toBe(201);
    const made = tables.recurring_orders.find((r) => r.id.startsWith("new-"));
    expect(made).toMatchObject({ created_by: STAFF, quantity: 6 });
  });
});
