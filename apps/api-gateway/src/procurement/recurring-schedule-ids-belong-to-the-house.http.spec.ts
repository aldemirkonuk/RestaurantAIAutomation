/**
 * A recurring-order schedule names only the caller's own item and vendor
 * (ADR 0249).
 *
 * `POST /recurring-orders/:restaurantId` and `PUT /recurring-orders/
 * :restaurantId/:id` take `inventory_id` and `provider_id` from the body. At
 * 1c1a676f8 neither route checked either id's house, so a member of house A
 * could store house B's item or vendor on A's schedule. Measured with this
 * file's harness at 1c1a676f8, before the fix:
 *   - create naming B's item: 201. The response's `wine_name` was B's, the
 *     51 calendar rows written in A's house were titled with B's wine name,
 *     and the approval event carried B's wine name;
 *   - create naming B's vendor: 201. The response's `provider_name` was B's,
 *     and the 51 calendar rows in A's house carried B's `provider_id`;
 *   - create naming a vendor row with no house: 201;
 *   - update to B's item or B's vendor: 200, and the get-one and list reads
 *     then returned B's name.
 *
 * The app below runs the REAL controller, service, DTO validation and
 * JwtAuthGuard (only passport is stood in for, setting `request.user` from
 * test headers as JwtStrategy.validate would). The database is an in-memory
 * two-house store that applies the service's own `eq` filters. Its embeds
 * follow a foreign key to whatever row it names, in any house, as PostgREST
 * does with the service-role key.
 *
 * Cases marked [REVERT-FAILS] fail at 1c1a676f8 and pass with the fix.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { PlatformOperatorService } from "../common/orchestrator/platform-operator.service";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { ProcurementService } from "./procurement.service";
import { RecurringOrdersController } from "./recurring-orders.controller";
import { RecurringOrdersService } from "./recurring-orders.service";

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const HOUSE_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_OF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ITEM_A = "a1a1a1a1-0000-4000-8000-000000000001";
const ITEM_A2 = "a1a1a1a1-0000-4000-8000-000000000002";
const ITEM_B = "b2b2b2b2-0000-4000-8000-000000000001";
const VENDOR_A = "a1a1a1a1-1111-4111-8111-000000000001";
const VENDOR_A2 = "a1a1a1a1-1111-4111-8111-000000000002";
const VENDOR_B = "b2b2b2b2-1111-4111-8111-000000000001";
const VENDOR_NO_HOUSE = "c3c3c3c3-1111-4111-8111-000000000001";
const SCHEDULE_A = "5c5c5c5c-0000-4000-8000-000000000001";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
/** Tables read through `from()`. Embeds are resolved without a read. */
let reads: string[];
/** `insert:<table>` / `update:<table>` for every write attempted. */
let writes: string[];
/** Tables whose reads answer with a database error. */
let failingReads: Set<string>;

function storedScheduleA(): Row {
  return {
    id: SCHEDULE_A,
    restaurant_id: HOUSE_A,
    inventory_id: ITEM_A,
    provider_id: VENDOR_A,
    quantity: 6,
    unit_type: "bottle",
    bottles_per_unit: null,
    target_price: null,
    frequency: "weekly",
    frequency_day: 0,
    auto_approve: false,
    next_order_date: "2099-01-05",
    last_order_date: null,
    active: true,
    created_by: MEMBER_OF_A,
    notes: null,
    execution_count: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

function freshTables(): Record<string, Row[]> {
  return {
    restaurant_inventory: [
      { id: ITEM_A, restaurant_id: HOUSE_A, wine_name: "A's Barolo" },
      { id: ITEM_A2, restaurant_id: HOUSE_A, wine_name: "A's Chianti" },
      { id: ITEM_B, restaurant_id: HOUSE_B, wine_name: "B's private cuvee" },
    ],
    providers: [
      { id: VENDOR_A, restaurant_id: HOUSE_A, name: "A's vendor" },
      { id: VENDOR_A2, restaurant_id: HOUSE_A, name: "A's second vendor" },
      { id: VENDOR_B, restaurant_id: HOUSE_B, name: "B's vendor" },
      { id: VENDOR_NO_HOUSE, restaurant_id: null, name: "Houseless vendor" },
    ],
    recurring_orders: [storedScheduleA()],
    calendar_events: [],
  };
}

/** PostgREST embeds with the service-role key: no RLS, any house. */
function withEmbeds(row: Row, columns: string): Row {
  const out = { ...row };
  if (columns.includes("inventory:inventory_id(")) {
    const inv = tables.restaurant_inventory.find(
      (r) => r.id === row.inventory_id,
    );
    out.inventory = inv
      ? { wine_name: inv.wine_name, master_wine_library: null }
      : null;
  }
  if (columns.includes("provider:provider_id(")) {
    const p = tables.providers.find((r) => r.id === row.provider_id);
    out.provider = p ? { name: p.name } : null;
  }
  return out;
}

let nextId = 1;
const client = {
  from(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | Row[] | null = null;
    let columns = "*";
    let head = false;

    const run = () => {
      if (op === "insert") {
        writes.push(`insert:${table}`);
        const rows = (Array.isArray(payload) ? payload : [payload]).map(
          (p) => ({
            id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
            execution_count: 0,
            ...p,
          }),
        );
        (tables[table] ??= []).push(...rows);
        return {
          data: rows.map((r) => withEmbeds(r, columns)),
          count: null,
          error: null,
        };
      }
      if (op === "select") {
        reads.push(table);
        if (failingReads.has(table)) {
          return {
            data: null,
            count: null,
            error: { message: "connection reset" },
          };
        }
      }
      const matched = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (op === "update") {
        writes.push(`update:${table}`);
        for (const r of matched) Object.assign(r, payload);
      }
      return {
        data: head ? null : matched.map((r) => withEmbeds(r, columns)),
        count: matched.length,
        error: null,
      };
    };

    const builder: any = {
      select: (cols?: string, opts?: { head?: boolean }) => {
        columns = cols ?? "*";
        head = Boolean(opts?.head);
        return builder;
      },
      insert: (p: Row | Row[]) => {
        op = "insert";
        payload = p;
        return builder;
      },
      update: (p: Row) => {
        op = "update";
        payload = p;
        return builder;
      },
      eq: (c: string, v: unknown) => {
        filters.push((r) => r[c] === v);
        return builder;
      },
      lte: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        const rows = (data ?? []) as Row[];
        if (rows.length !== 1)
          return {
            data: null,
            error: { code: "PGRST116", message: "no single row" },
          };
        return { data: rows[0], error: null };
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: ((data ?? []) as Row[])[0] ?? null, error };
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
    };
    return builder;
  },
};

const orchestrator = { publishEvent: jest.fn() };

let app: INestApplication;
let base: string;

async function call(
  method: "POST" | "PUT" | "GET",
  path: string,
  body?: unknown,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: "Bearer t",
      "content-type": "application/json",
      "x-test-user": MEMBER_OF_A,
      "x-test-house": HOUSE_A,
      // The OrganizationsService stub below admits every caller to the
      // manager-or-owner check the edit-needs-a-manager change adds to PUT.
      "x-test-role": "owner",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A week ahead, so the twelve-month calendar window holds events. */
const SOON = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

const schedule = (over: Row = {}) => ({
  inventory_id: ITEM_A,
  provider_id: VENDOR_A,
  quantity: 6,
  frequency: "weekly",
  frequency_day: 0,
  next_order_date: SOON,
  ...over,
});

const createIn = (body: Row) =>
  call("POST", `/recurring-orders/${HOUSE_A}`, body);
const updateA = (body: Row) =>
  call("PUT", `/recurring-orders/${HOUSE_A}/${SCHEDULE_A}`, body);

/** Nothing was stored, laid out on the calendar or announced. */
function expectNothingCreated() {
  expect(writes).toEqual([]);
  expect(tables.recurring_orders).toEqual([storedScheduleA()]);
  expect(tables.calendar_events).toEqual([]);
  expect(orchestrator.publishEvent).not.toHaveBeenCalled();
}

/** The stored schedule is exactly as it was seeded. */
function expectScheduleUntouched() {
  expect(writes).toEqual([]);
  expect(tables.recurring_orders).toEqual([storedScheduleA()]);
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
    };
    return true;
  });

  const moduleRef = await Test.createTestingModule({
    controllers: [RecurringOrdersController],
    providers: [
      RecurringOrdersService,
      { provide: DatabaseService, useValue: { client, supabase: client } },
      // Create and update never call it; only the 08:00 run does.
      { provide: ProcurementService, useValue: {} },
      { provide: OrchestratorService, useValue: orchestrator },
      // Only the execute-check route's guard needs it; never called here.
      { provide: PlatformOperatorService, useValue: {} },
      // Not injected at 1c1a676f8. The edit-needs-a-manager change injects
      // it into this controller; it admits every caller here.
      {
        provide: OrganizationsService,
        useValue: { assertCanManageRestaurant: async () => undefined },
      },
      {
        provide: TokenBlacklistService,
        useValue: { isBlacklisted: async () => false },
      },
    ],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  // The same pipe options as main.ts.
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

beforeEach(() => {
  tables = freshTables();
  reads = [];
  writes = [];
  failingReads = new Set();
  orchestrator.publishEvent.mockReset().mockResolvedValue(undefined);
});

describe("POST /recurring-orders/:restaurantId — the item and the vendor are this house's", () => {
  it("[REVERT-FAILS] refuses another house's inventory_id with 403 and stores nothing", async () => {
    const res = await createIn(schedule({ inventory_id: ITEM_B }));
    expect(res.status).toBe(403);
    expect(res.body.message).toBe(
      `Item ${ITEM_B} does not belong to this restaurant. A stock movement ` +
        `can only move this restaurant's own inventory, so nothing was written.`,
    );
    expect(JSON.stringify(res.body)).not.toContain("B's private cuvee");
    expectNothingCreated();
  });

  it("[REVERT-FAILS] refuses another house's provider_id with 404 'Vendor not found' and stores nothing", async () => {
    const res = await createIn(schedule({ provider_id: VENDOR_B }));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Vendor not found");
    expect(JSON.stringify(res.body)).not.toContain("B's vendor");
    expectNothingCreated();
  });

  it("[REVERT-FAILS] refuses a vendor row with no house with the same 404", async () => {
    const res = await createIn(schedule({ provider_id: VENDOR_NO_HOUSE }));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Vendor not found");
    expectNothingCreated();
  });

  it("[REVERT-FAILS] refuses with 422 when the item's house cannot be read, and stores nothing", async () => {
    failingReads.add("restaurant_inventory");
    const res = await createIn(schedule());
    expect(res.status).toBe(422);
    expectNothingCreated();
  });

  it("[REVERT-FAILS] refuses with 503 when the vendor's house cannot be read, and stores nothing", async () => {
    failingReads.add("providers");
    const res = await createIn(schedule());
    expect(res.status).toBe(503);
    expect(res.body.message).toBe(
      "Could not confirm this vendor belongs to this restaurant, so the " +
        "schedule was not saved. Please try again.",
    );
    expectNothingCreated();
  });

  it("stores a schedule naming the caller's own item and vendor", async () => {
    const res = await createIn(schedule());
    expect(res.status).toBe(201);
    expect(res.body.wine_name).toBe("A's Barolo");
    expect(res.body.provider_name).toBe("A's vendor");
    expect(tables.recurring_orders).toHaveLength(2);
    expect(tables.recurring_orders[1]).toMatchObject({
      restaurant_id: HOUSE_A,
      inventory_id: ITEM_A,
      provider_id: VENDOR_A,
    });
    expect(tables.calendar_events.length).toBeGreaterThan(0);
    for (const ev of tables.calendar_events) {
      expect(ev).toMatchObject({
        restaurant_id: HOUSE_A,
        provider_id: VENDOR_A,
      });
    }
  });
});

describe("PUT /recurring-orders/:restaurantId/:id — a new item or vendor is this house's", () => {
  it("[REVERT-FAILS] refuses another house's inventory_id with 403 and leaves the schedule as it was", async () => {
    const res = await updateA({ inventory_id: ITEM_B });
    expect(res.status).toBe(403);
    expectScheduleUntouched();
    const get = await call("GET", `/recurring-orders/${HOUSE_A}/${SCHEDULE_A}`);
    expect(get.body.wine_name).toBe("A's Barolo");
  });

  it("[REVERT-FAILS] refuses another house's provider_id with 404 and leaves the schedule as it was", async () => {
    const res = await updateA({ provider_id: VENDOR_B });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Vendor not found");
    expectScheduleUntouched();
    const get = await call("GET", `/recurring-orders/${HOUSE_A}/${SCHEDULE_A}`);
    expect(get.body.provider_name).toBe("A's vendor");
  });

  it("[REVERT-FAILS] refuses a vendor row with no house with the same 404", async () => {
    const res = await updateA({ provider_id: VENDOR_NO_HOUSE });
    expect(res.status).toBe(404);
    expectScheduleUntouched();
  });

  it("[REVERT-FAILS] refuses the whole edit when only the vendor is foreign, so the item does not move either", async () => {
    const res = await updateA({
      inventory_id: ITEM_A2,
      provider_id: VENDOR_B,
      notes: "half of this must not land",
    });
    expect(res.status).toBe(404);
    expectScheduleUntouched();
  });

  it("moves a schedule to another of the caller's own items and vendors", async () => {
    const res = await updateA({
      inventory_id: ITEM_A2,
      provider_id: VENDOR_A2,
    });
    expect(res.status).toBe(200);
    expect(res.body.wine_name).toBe("A's Chianti");
    expect(res.body.provider_name).toBe("A's second vendor");
    expect(tables.recurring_orders[0]).toMatchObject({
      inventory_id: ITEM_A2,
      provider_id: VENDOR_A2,
    });
  });

  it("checks no id the body did not send: an edit leaving both out reads neither table", async () => {
    const res = await updateA({ notes: "ring before delivery", quantity: 12 });
    expect(res.status).toBe(200);
    expect(reads).not.toContain("restaurant_inventory");
    expect(reads).not.toContain("providers");
    expect(tables.recurring_orders[0]).toMatchObject({
      inventory_id: ITEM_A,
      provider_id: VENDOR_A,
      notes: "ring before delivery",
      quantity: 12,
    });
  });

  it("[REVERT-FAILS] checks only the id the body sent: a new vendor alone is checked and no item is read", async () => {
    const res = await updateA({ provider_id: VENDOR_A2 });
    expect(res.status).toBe(200);
    expect(reads).not.toContain("restaurant_inventory");
    expect(reads).toContain("providers");
  });
});
