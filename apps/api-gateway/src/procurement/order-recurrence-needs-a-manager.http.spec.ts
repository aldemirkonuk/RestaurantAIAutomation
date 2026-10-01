/**
 * Pause, resume and end on an order's recurrence need a manager or an owner,
 * and so does replacing a rule an order already carries. Setting the first
 * rule does not (ADR 0247, founder ruling 2026-10-01: "Managers and owners
 * only (Recommended)").
 *
 * Why: the four routes under `POST /procurement/orders/:id/recurrence` had only
 * the class-level JwtAuthGuard, so any member of the house could pause, resume
 * or end a rule a manager set. Replacing a rule is in scope because the set
 * route writes `active` and a new next date over whatever is there, which
 * resumes a paused rule or restarts an ended one.
 *
 * The app below runs the REAL OrderRecurrenceController, the REAL
 * OrderRecurrenceService and the REAL OrganizationsService (the role check
 * order cancel uses) over an in-memory store, and the REAL JwtAuthGuard with
 * passport stubbed: it sets `request.user` from a test header. Every case
 * marked [REVERT-FAILS] was run against the service on origin/main c4fe6a68b
 * and observed to fail.
 */
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { TokenBlacklistService } from "../auth/services/token-blacklist.service";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { OrderRecurrenceController } from "./order-recurrence.controller";
import { OrderRecurrenceService } from "./order-recurrence.service";
import { ProcurementService } from "./procurement.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OWNER = "a0000000-0000-4000-8000-000000000001";
const MANAGER = "a0000000-0000-4000-8000-000000000002";
const STAFF = "a0000000-0000-4000-8000-000000000003";
const UNREADABLE = "a0000000-0000-4000-8000-000000000004";
const NO_RULE = "b0000000-0000-4000-8000-000000000001";
const ACTIVE = "b0000000-0000-4000-8000-000000000002";
const PAUSED = "b0000000-0000-4000-8000-000000000003";
const ENDED = "b0000000-0000-4000-8000-000000000004";

type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let writes: string[];
/** Runs once, just before the next update is applied: a write landing between. */
let beforeNextUpdate: (() => void) | null;

function order(id: string, status: string | null): Row {
  return {
    id,
    order_number: `ORD-${id.slice(-4)}`,
    restaurant_id: HOUSE,
    inventory_id: "inv-1",
    provider_id: "prov-1",
    quantity: 5,
    unit_type: "case",
    bottles_total: 60,
    final_price: "38.99",
    status: "APPROVED",
    approved_at: "2026-09-01T10:00:00.000Z",
    manager_notes: null,
    recurrence_frequency: status ? "weekly" : null,
    recurrence_anchor_day: status ? 1 : null,
    recurrence_anchored_on: status ? "2026-09-05" : null,
    recurrence_next_due_on: status ? "2026-10-06" : null,
    recurrence_status: status,
    recurrence_status_by: status ? MANAGER : null,
    recurrence_status_at: status ? "t0" : null,
    recurrence_parent_order_id: null,
    recurrence_occurrence_on: null,
  };
}

function fresh() {
  writes = [];
  beforeNextUpdate = null;
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
    ],
    users: [],
    procurement_orders: [
      order(NO_RULE, null),
      order(ACTIVE, "active"),
      order(PAUSED, "paused"),
      order(ENDED, "ended"),
    ],
    system_audit_log: [],
  };
}

/**
 * eq and is(null) filters, insert/update/select, awaitable, single and
 * maybeSingle. Reads of the role tables for UNREADABLE fail, the way a
 * database outage would.
 */
const client: any = {
  from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let readsUnreadable = false;
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const run = (): { data: any; error: any } => {
      if (
        (table === "user_restaurant_access" || table === "users") &&
        readsUnreadable
      ) {
        return { data: null, error: { message: "connection refused" } };
      }
      const rows = tables[table] ?? (tables[table] = []);
      if (op === "insert") {
        rows.push({ ...(payload as Row) });
        writes.push(`insert:${table}`);
        return { data: null, error: null };
      }
      if (op === "update" && beforeNextUpdate) {
        const hook = beforeNextUpdate;
        beforeNextUpdate = null;
        hook();
      }
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        matched.forEach((r) => Object.assign(r, payload));
        if (matched.length) writes.push(`update:${table}`);
      }
      return { data: matched.map((r) => ({ ...r })), error: null };
    };
    const builder: any = {
      select: () => builder,
      insert: (row: Row) => {
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
        if (c === "user_id" && v === UNREADABLE) readsUnreadable = true;
        filters.push((r) => String(r[c]) === String(v));
        return builder;
      },
      is: (c: string, v: unknown) => {
        filters.push((r) => (r[c] ?? null) === v);
        return builder;
      },
      maybeSingle: async () => {
        const { data, error } = run();
        return { data: error ? null : (data[0] ?? null), error };
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        return data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "0 rows" } };
      },
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, ko),
    };
    return builder;
  },
};

let app: INestApplication;
let base: string;

async function call(path: string, as: string, body?: unknown) {
  const res = await fetch(`${base}/procurement/orders/${path}`, {
    method: "POST",
    headers: {
      authorization: "Bearer t",
      "content-type": "application/json",
      "x-test-user": as,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const row = (id: string) => tables.procurement_orders.find((r) => r.id === id)!;
const act = (verb: "pause" | "resume" | "end", id: string, as: string) =>
  call(`${id}/recurrence/${verb}`, as);
const setRule = (id: string, as: string) =>
  call(`${id}/recurrence`, as, {
    frequency: "monthly",
    startsOn: "2027-06-01",
  });

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
    controllers: [OrderRecurrenceController],
    providers: [
      OrderRecurrenceService,
      OrganizationsService,
      { provide: DatabaseService, useValue: db },
      // The routes exercised here never mint a child, so never call it.
      { provide: ProcurementService, useValue: {} },
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

const VERBS: Array<["pause" | "resume" | "end", string, string]> = [
  ["pause", ACTIVE, "active"],
  ["resume", PAUSED, "paused"],
  ["end", ACTIVE, "active"],
];

describe("staff may not pause, resume or end a rule", () => {
  it.each(VERBS)(
    "[REVERT-FAILS] refuses staff the %s route with 403 and writes nothing",
    async (verb, id, was) => {
      const res = await act(verb, id, STAFF);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        `Only managers and owners can ${verb} an order's recurrence`,
      );
      expect(row(id)).toMatchObject({
        recurrence_status: was,
        recurrence_status_by: MANAGER,
        recurrence_status_at: "t0",
      });
      expect(writes).toEqual([]);
    },
  );

  it("[REVERT-FAILS] refuses a caller whose role cannot be read, with 403, and writes nothing", async () => {
    // The role helper reads a failed lookup as no role (`strict: false`), so
    // an outage is refused the same way staff are: closed, not open.
    for (const [verb, id] of VERBS) {
      expect((await act(verb, id, UNREADABLE)).status).toBe(403);
    }
    expect(row(ACTIVE).recurrence_status).toBe("active");
    expect(row(PAUSED).recurrence_status).toBe("paused");
    expect(writes).toEqual([]);
  });
});

describe("staff may not replace a rule that is already there", () => {
  it.each([
    ["an active", ACTIVE, "active"],
    ["a paused", PAUSED, "paused"],
    ["an ended", ENDED, "ended"],
  ])(
    "[REVERT-FAILS] refuses staff a replace of %s rule with 403 and writes nothing",
    async (_label, id, was) => {
      const res = await setRule(id, STAFF);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(
        "Only managers and owners can replace an order's recurrence",
      );
      expect(row(id)).toMatchObject({
        recurrence_status: was,
        recurrence_frequency: "weekly",
        recurrence_next_due_on: "2026-10-06",
        recurrence_status_by: MANAGER,
      });
      expect(writes).toEqual([]);
    },
  );
});

describe("managers and owners may", () => {
  it.each([
    ["a manager", MANAGER],
    ["an owner", OWNER],
  ])("lets %s pause, resume and end a rule", async (_label, as) => {
    expect((await act("pause", ACTIVE, as)).status).toBe(201);
    expect(row(ACTIVE)).toMatchObject({
      recurrence_status: "paused",
      recurrence_status_by: as,
    });
    expect((await act("resume", PAUSED, as)).status).toBe(201);
    expect(row(PAUSED)).toMatchObject({
      recurrence_status: "active",
      recurrence_status_by: as,
    });
    expect((await act("end", ACTIVE, as)).status).toBe(201);
    expect(row(ACTIVE)).toMatchObject({
      recurrence_status: "ended",
      recurrence_status_by: as,
    });
  });

  it.each([
    ["a manager", MANAGER],
    ["an owner", OWNER],
  ])("lets %s replace a paused rule", async (_label, as) => {
    const res = await setRule(PAUSED, as);
    expect(res.status).toBe(201);
    expect(row(PAUSED)).toMatchObject({
      recurrence_status: "active",
      recurrence_frequency: "monthly",
      recurrence_status_by: as,
    });
  });
});

describe("staff may still set up the first rule on an order", () => {
  it("sets one, recorded as the staff member's", async () => {
    const res = await setRule(NO_RULE, STAFF);
    expect(res.status).toBe(201);
    expect(row(NO_RULE)).toMatchObject({
      recurrence_status: "active",
      recurrence_frequency: "monthly",
      recurrence_next_due_on: "2027-06-01",
      recurrence_status_by: STAFF,
    });
  });

  it("[REVERT-FAILS] does not overwrite a rule that landed between the read and the write", async () => {
    // A manager's rule lands after the set route read "no rule" and before it
    // wrote. The first-rule write is conditioned on the order still carrying
    // none, so it matches nothing and is refused.
    beforeNextUpdate = () =>
      Object.assign(row(NO_RULE), {
        recurrence_frequency: "weekly",
        recurrence_next_due_on: "2026-10-06",
        recurrence_status: "paused",
        recurrence_status_by: MANAGER,
      });
    const res = await setRule(NO_RULE, STAFF);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("rule_set_meanwhile");
    expect(row(NO_RULE)).toMatchObject({
      recurrence_status: "paused",
      recurrence_status_by: MANAGER,
      recurrence_frequency: "weekly",
    });
    expect(writes).toEqual([]);
  });
});
