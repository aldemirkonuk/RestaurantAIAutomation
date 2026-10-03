/**
 * `PATCH /procurement/orders/:id` is not a side door around the sealed acts.
 *
 * Founder, 2026-09-29: fix the verified live hole. Measured before this pass
 * (817-route audit at 5a20d774b, re-verified at c47fd8a01): the route checked
 * no role, and `assertStatusTransition` only asked whether the move was in
 * `order-transitions.ts`. So any member of the house could move a PENDING,
 * APPROVAL_NEEDED or NEGOTIATING order to APPROVED with no seal, no approval
 * rule, no `approved_by`/`approved_at` and no stock reservation — the whole of
 * what `POST orders/:id/approve` exists to require — and could reach REJECTED,
 * FAILED, DELIVERED, CONFIRMED, COMPLETED and the rest the same way. And any
 * member could rewrite `total_cost`, `negotiated_price`, `quoted_price`,
 * `final_price` (DB-guarded only while a priced line exists) and
 * `price_verified` (the verification's recorded verdict, which the vendor
 * scorecard reads) — the figures the approval rules and the seal are taken over.
 *
 * Callers of this PATCH, measured 2026-09-29 (`git grep` over apps/web/src,
 * apps/mobile, packages, services, scripts, apps/web/e2e): NONE in any client.
 * `ordersApi.updateOrder` / `updateOrderStatus` in apps/web are exported and
 * called by nothing; the legacy desk's "Mark as Ordered" that sent
 * `status: CONFIRMED` here was deleted in #494. The SERVICE method has two
 * callers: this controller, and `cancelOrder` — the only one that writes a
 * status through it, having already run the transition, the category, the
 * role and the seal, and saying so through `opts`.
 *
 * The app runs the REAL ProcurementController and the REAL ProcurementService
 * behind a global ValidationPipe with main.ts's options, over an in-memory
 * `procurement_orders` row. Replaced: JwtAuthGuard (a stub that sets the
 * `request.user` shape JwtStrategy.validate returns) and
 * `OrganizationsService.assertCanManageRestaurant`, stubbed at its boundary with
 * the real helper's contract — owner or manager returns, anything else throws
 * the real sentence (its own rule is `organizations.service.ts`'s spec).
 *
 * [REVERT-FAILS] marks a case that fails against the service as it stands
 * without this PR: base 597f728d9, where `git diff c47fd8a01 597f728d9` over
 * `apps/api-gateway/src/procurement` and `src/communications` is empty (#532
 * touched only auth), so the two are the same service for these cases.
 * Untagged cases pin behaviour that already held there, or that a named
 * mutation of this PR's code would break.
 */
import {
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AddressInfo } from "net";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { ProcurementOrderStatus as S } from "./dto/procurement.dto";
import { ProcurementController } from "./procurement.controller";
import { ProcurementService } from "./procurement.service";

type Row = Record<string, any>;

const HOUSE = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";

const OWNER = "a0000000-0000-4000-8000-000000000001";
const MANAGER = "a0000000-0000-4000-8000-000000000002";
const STAFF = "a0000000-0000-4000-8000-000000000003";
const ROLE: Record<string, string> = {
  [OWNER]: "owner",
  [MANAGER]: "manager",
  [STAFF]: "staff",
};

/** The one order row, and every UPDATE that reached `procurement_orders`. */
const state: {
  order: Row;
  writes: Row[];
  roleAsks: string[];
  audits: Row[];
  failOrderRead: boolean;
  /** Line writes (`procurement_order_items` delete + insert) the merge made. */
  lineWrites: string[];
  /** The order line's insert fails (the merge's second write). */
  failLineInsert: boolean;
  /** Runs once, right after the dedup lookup reads the open order. */
  afterLookup: (() => void) | null;
  /** The order's lines (`procurement_order_items`), as the merge reads them. */
  lines: Row[];
  /** The held-line read fails. */
  failLineRead: boolean;
} = {
  order: {},
  writes: [],
  roleAsks: [],
  audits: [],
  failOrderRead: false,
  lineWrites: [],
  failLineInsert: false,
  afterLookup: null,
  lines: [],
  failLineRead: false,
};

function seed(status: S): void {
  state.order = {
    id: ORDER,
    restaurant_id: HOUSE,
    status,
    total_cost: "2000.00",
    provider_id: "prov-1",
    inventory_id: null,
    quantity: 6,
    order_number: "PO-2026-0042",
  };
  state.writes = [];
  state.roleAsks = [];
  state.audits = [];
  state.failOrderRead = false;
  state.lineWrites = [];
  state.failLineInsert = false;
  state.afterLookup = null;
  state.lines = [];
  state.failLineRead = false;
}

/**
 * An open order the dedup merge in `createOrder` will find: same house, same
 * item, same vendor, six bottles at 300.00, total 1,800.00.
 */
const INVENTORY = "33333333-3333-4333-8333-333333333333";
const VENDOR = "44444444-4444-4444-8444-444444444444";
function seedOpenOrder(status: S): void {
  seed(status);
  Object.assign(state.order, {
    inventory_id: INVENTORY,
    provider_id: VENDOR,
    quantity: 6,
    unit_type: "bottle",
    bottles_total: 6,
    quoted_price: null,
    negotiated_price: null,
    final_price: "300.00",
    total_cost: "1800.00",
    currency: "EUR",
  });
  // The line `createOrder` wrote for it: six bottles at 300.00, in euros.
  state.lines = [
    {
      id: "line-1",
      quantity: 6,
      unit_type: "bottle",
      bottles_per_unit: 1,
      quoted_unit_price: null,
      negotiated_unit_price: null,
      final_unit_price: "300.00",
      price_uom: null,
      price_pack_size: null,
      currency: "EUR",
      allowance: null,
      deposit: null,
      freight: null,
      line_total: "1800.00",
      vendor_sku: null,
    },
  ];
}

/**
 * Does a stored value satisfy a PostgREST `eq` / `is` filter? Numbers compare
 * as numbers (a stored "300.00" is `eq.300`), everything else as text.
 */
function holds(stored: unknown, op: "eq" | "is", value: unknown): boolean {
  if (op === "is") return (stored ?? null) === value;
  if (stored === null || stored === undefined) return false;
  const a = Number(stored);
  const b = Number(value);
  if (Number.isFinite(a) && Number.isFinite(b) && String(value).trim() !== "")
    return a === b;
  return String(stored) === String(value);
}

const supabase: any = {
  from(table: string) {
    // An UPDATE is applied when its chain ends, and only to a row every
    // filter matches: the way PostgREST applies `?col=eq.x` to a PATCH. A
    // write whose filters no longer match changes nothing and returns no row.
    let pending: Row | null = null;
    let inserting = false;
    let deleting = false;
    let inserted: Row | null = null;
    const filters: Array<[string, "eq" | "is", unknown]> = [];
    const settle = (): Row | null => {
      const sent = pending;
      pending = null;
      if (!sent || table !== "procurement_orders") return null;
      if (!filters.every(([c, op, v]) => holds(state.order[c], op, v)))
        return null;
      state.writes.push(sent);
      Object.assign(state.order, sent);
      return { ...state.order };
    };
    const q: any = {
      select: () => q,
      insert: (row: Row) => {
        inserting = true;
        inserted = row;
        if (table === "system_audit_log") state.audits.push(row);
        if (table === "procurement_order_items")
          state.lineWrites.push("insert");
        return q;
      },
      delete: () => {
        deleting = true;
        if (table === "procurement_order_items")
          state.lineWrites.push("delete");
        return q;
      },
      update: (payload: Row) => {
        // supabase-js drops `undefined` keys before PostgREST sees them.
        pending = Object.fromEntries(
          Object.entries(payload).filter(([, v]) => v !== undefined),
        );
        return q;
      },
      eq: (c: string, v: unknown) => {
        filters.push([c, "eq", v]);
        return q;
      },
      is: (c: string, v: unknown) => {
        filters.push([c, "is", v]);
        return q;
      },
      in: () => q,
      not: () => q,
      neq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => {
        if (pending) return { data: settle(), error: null };
        return table === "procurement_orders"
          ? state.failOrderRead
            ? { data: null, error: { message: "connection reset" } }
            : { data: { ...state.order }, error: null }
          : table === "restaurant_inventory"
            ? { data: { id: INVENTORY, wine_name: "Barolo 2019" }, error: null }
            : { data: null, error: null };
      },
      single: async () => {
        if (pending) {
          const row = settle();
          return row
            ? { data: row, error: null }
            : {
                data: null,
                error: { code: "PGRST116", message: "no rows returned" },
              };
        }
        return table === "procurement_orders"
          ? { data: { ...state.order }, error: null }
          : { data: null, error: null };
      },
      // A list read. `providers` is only ever counted here (the vendor is the
      // house's, and the house has an active vendor); `procurement_orders` as
      // a list is the dedup lookup, which finds the one open order.
      then: (resolve: any, reject: any) => {
        if (pending) {
          settle();
          return Promise.resolve({ data: [], error: null }).then(
            resolve,
            reject,
          );
        }
        if (table === "procurement_order_items") {
          if (inserting && state.failLineInsert)
            return Promise.resolve({
              data: null,
              error: { message: "line refused" },
            }).then(resolve, reject);
          if (deleting) state.lines = [];
          else if (inserting && inserted) state.lines.push({ ...inserted });
          else
            return Promise.resolve(
              state.failLineRead
                ? { data: null, error: { message: "connection reset" } }
                : { data: state.lines.map((l) => ({ ...l })), error: null },
            ).then(resolve, reject);
          return Promise.resolve({ data: [], error: null }).then(
            resolve,
            reject,
          );
        }
        let result: Row;
        if (table === "providers") result = { count: 1, data: [], error: null };
        else if (table === "procurement_orders") {
          result = { data: [{ ...state.order }], error: null };
          const after = state.afterLookup;
          state.afterLookup = null;
          after?.();
        } else result = { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return q;
  },
};

let app: INestApplication;
let base: string;

async function patch(
  as: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  return send("PATCH", `/procurement/orders/${ORDER}`, as, body);
}

/** `POST /procurement/orders` for the seeded open order's wine and vendor. */
async function place(
  as: string,
  body: Row,
): Promise<{ status: number; body: any }> {
  return send("POST", "/procurement/orders", as, {
    inventoryId: INVENTORY,
    providerId: VENDOR,
    ...body,
  });
}

async function send(
  method: "PATCH" | "POST",
  path: string,
  as: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": as },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* a non-JSON body is kept as text */
  }
  return { status: res.status, body: parsed };
}

beforeAll(async () => {
  const db = { supabase, getClient: () => supabase };
  const moduleRef = await Test.createTestingModule({
    controllers: [ProcurementController],
    providers: [
      ProcurementService,
      { provide: DatabaseService, useValue: db },
      { provide: EventsService, useValue: { createEvent: jest.fn() } },
      {
        provide: InventoryLedgerService,
        useValue: { recordTransaction: jest.fn() },
      },
      {
        provide: OrchestratorService,
        useValue: { publishEvent: jest.fn(), triggerDraftHttp: jest.fn() },
      },
      {
        provide: SealChallengeService,
        useValue: new SealChallengeService(db as any),
      },
      {
        provide: OrganizationsService,
        useValue: {
          assertCanManageRestaurant: async (
            userId: string,
            _restaurantId: string,
            action: string,
          ) => {
            state.roleAsks.push(action);
            const role = ROLE[userId];
            if (role !== "owner" && role !== "manager") {
              throw new ForbiddenException(
                `Only managers and owners can ${action}`,
              );
            }
          },
        },
      },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        req.user = {
          userId: req.headers["x-test-user"] || null,
          restaurantId: HOUSE,
        };
        return true;
      },
    })
    .compile();
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
});

// ===========================================================================
// 1. No status moves through the PATCH — every one has its own act
// ===========================================================================

describe("the PATCH does not move an order", () => {
  // Every row is a move `order-transitions.ts` PERMITS, so on c47fd8a01 each
  // answered 200 and wrote the status. Sent as the OWNER: no role unlocks a
  // status here, because the acts that own these moves check more than a role.
  const PERMITTED_BY_THE_TABLE: Array<[S, S]> = [
    [S.PENDING, S.APPROVED],
    [S.APPROVAL_NEEDED, S.APPROVED],
    [S.NEGOTIATING, S.APPROVED],
    [S.PENDING, S.REJECTED],
    [S.NEGOTIATING, S.REJECTED],
    [S.PENDING, S.FAILED],
    [S.APPROVED, S.CONFIRMED],
    [S.CONFIRMED, S.IN_TRANSIT],
    [S.APPROVED, S.DELIVERED],
    [S.APPROVED, S.PARTIALLY_RECEIVED],
    [S.DELIVERED, S.COMPLETED],
    [S.APPROVED, S.NEGOTIATING],
    [S.PENDING, S.APPROVAL_NEEDED],
    [S.PENDING, S.PENDING],
  ];

  it.each(PERMITTED_BY_THE_TABLE)(
    "[REVERT-FAILS] %s -> %s is a 422 in words, and nothing is written",
    async (from, to) => {
      seed(from);
      const res = await patch(OWNER, { status: to });
      expect(res.status).toBe(422);
      expect(res.body.reason).toBe("status_through_its_act");
      expect(res.body.to).toBe(to);
      expect(String(res.body.message)).toMatch(/not by editing its status/);
      expect(String(res.body.message)).toMatch(/Nothing was changed\.$/);
      expect(state.writes).toHaveLength(0);
      expect(state.order.status).toBe(from);
    },
  );

  it("[REVERT-FAILS] a member of staff cannot approve an order by editing it", async () => {
    // The audit's headline: no seal, no approval rule, no approved_by.
    seed(S.PENDING);
    const res = await patch(STAFF, { status: S.APPROVED });
    expect(res.status).toBe(422);
    expect(String(res.body.message)).toMatch(/hold(ing)? to approve/);
    expect(state.writes).toHaveLength(0);
    expect(state.order.approved_by).toBeUndefined();
  });

  it("[REVERT-FAILS] names where each kind of move is actually made", async () => {
    const where = async (from: S, to: S) => {
      seed(from);
      return String((await patch(OWNER, { status: to })).body.message);
    };
    expect(await where(S.PENDING, S.APPROVED)).toMatch(/approval rules/);
    expect(await where(S.APPROVED, S.DELIVERED)).toMatch(/receiving door/);
    expect(await where(S.PENDING, S.REJECTED)).toMatch(/whose failure it was/);
    expect(await where(S.APPROVED, S.CONFIRMED)).toMatch(
      /vendor's own confirmation/,
    );
  });

  it("still refuses a cancel by PATCH with the cancel's own sentence", async () => {
    // ADR 0207 round 4 — held on c47fd8a01 already; pinned so the new rule
    // did not swallow the older, more specific one.
    seed(S.CONFIRMED);
    const res = await patch(OWNER, { status: S.CANCELLED });
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("cancel_through_the_sealed_act");
    expect(state.writes).toHaveLength(0);
  });

  it("[REVERT-FAILS] a status riding with a note refuses the whole request", async () => {
    seed(S.PENDING);
    const res = await patch(OWNER, {
      status: S.APPROVED,
      managerNotes: "approved on the phone",
    });
    expect(res.status).toBe(422);
    expect(state.writes).toHaveLength(0);
    expect(state.order.manager_notes).toBeUndefined();
  });
});

// ===========================================================================
// 2. The money on an order is a manager's or an owner's to change
// ===========================================================================

describe("the order's money is changed by a manager or an owner", () => {
  const MONEY: Array<[string, Row, string]> = [
    ["totalCost", { totalCost: 1 }, "total_cost"],
    ["negotiatedPrice", { negotiatedPrice: 1 }, "negotiated_price"],
    ["quotedPrice", { quotedPrice: 1 }, "quoted_price"],
    ["finalPrice", { finalPrice: 1 }, "final_price"],
    ["priceVerified", { priceVerified: true }, "price_verified"],
  ];

  it.each(MONEY)(
    "[REVERT-FAILS] staff sending %s is a 403 and nothing is written",
    async (_label, body) => {
      seed(S.PENDING);
      const res = await patch(STAFF, body);
      expect(res.status).toBe(403);
      expect(String(res.body.message)).toMatch(
        /Only managers and owners can change an order's price/,
      );
      expect(state.writes).toHaveLength(0);
      expect(state.order.total_cost).toBe("2000.00");
    },
  );

  it("[REVERT-FAILS] staff cannot slip a price in beside a note", async () => {
    seed(S.PENDING);
    const res = await patch(STAFF, {
      managerNotes: "fixed a typo",
      totalCost: 10,
    });
    expect(res.status).toBe(403);
    expect(state.writes).toHaveLength(0);
    expect(state.order.manager_notes).toBeUndefined();
  });

  it.each([
    ["a manager", MANAGER],
    ["an owner", OWNER],
  ])(
    "[REVERT-FAILS] %s may change the price, and the role helper is asked",
    async (_l, who) => {
      seed(S.PENDING);
      const res = await patch(who, {
        totalCost: 1850.5,
        negotiatedPrice: 308.4,
      });
      expect(res.status).toBe(200);
      expect(state.roleAsks).toContain("change an order's price");
      expect(state.writes).toHaveLength(1);
      expect(state.writes[0].total_cost).toBe(1850.5);
      expect(state.writes[0].negotiated_price).toBe(308.4);
    },
  );

  it("a null price says nothing, so it asks nobody and writes no price", async () => {
    seed(S.PENDING);
    const res = await patch(STAFF, { totalCost: null, managerNotes: "n" });
    expect(res.status).toBe(200);
    expect(state.roleAsks).toHaveLength(0);
    expect(state.writes[0]).not.toHaveProperty("total_cost");
  });
});

// ===========================================================================
// 2b. A price change leaves paper (ADR 0244)
// ===========================================================================

describe("a price change leaves paper", () => {
  it("[REVERT-FAILS] files order_price_changed naming who, and each figure from and to", async () => {
    seed(S.PENDING);
    const res = await patch(MANAGER, {
      totalCost: 1850.5,
      priceVerified: true,
    });
    expect(res.status).toBe(200);
    expect(state.audits).toHaveLength(1);
    const row = state.audits[0];
    expect(row.action).toBe("order_price_changed");
    expect(row.actor_id).toBe(MANAGER);
    expect(row.actor_type).toBe("user");
    expect(row.entity_type).toBe("procurement_order");
    expect(row.entity_id).toBe(ORDER);
    expect(row.restaurant_id).toBe(HOUSE);
    expect(row.changes.status).toBe(S.PENDING);
    expect(row.changes.fields).toEqual({
      total_cost: { from: "2000.00", to: 1850.5 },
      price_verified: { from: null, to: true },
    });
  });

  it("files nothing when no figure actually moved", async () => {
    seed(S.PENDING);
    const res = await patch(OWNER, { totalCost: 2000 });
    expect(res.status).toBe(200);
    expect(state.audits).toHaveLength(0);
  });

  it("[REVERT-FAILS] files nothing for a refused price change, or for notes", async () => {
    seed(S.PENDING);
    expect((await patch(STAFF, { totalCost: 1 })).status).toBe(403);
    expect((await patch(STAFF, { managerNotes: "n" })).status).toBe(200);
    expect(state.audits).toHaveLength(0);
  });

  it("[REVERT-FAILS] refuses the change when the figures it replaces cannot be read", async () => {
    seed(S.PENDING);
    state.failOrderRead = true;
    const res = await patch(OWNER, { totalCost: 10 });
    expect(res.status).toBe(500);
    expect(String(res.body.message)).toMatch(/price was not changed/);
    expect(state.writes).toHaveLength(0);
  });
});

// ===========================================================================
// 2c. The dedup merge is the second door to an open order's money (ADR 0244)
// ===========================================================================
//
// `POST /procurement/orders` checks no role. When an open order already exists
// for the same house, wine and vendor, `createOrder` folds the new request into
// it — and on c47fd8a01 and at e5edf9af1 that fold rewrote the quantity and
// every price of an APPROVAL_NEEDED, NEGOTIATING or APPROVED order for any
// member, with no paper. Found by the ADR 0090 security review of #538.

describe("a new order folded into an open one moves its money only for a manager or an owner", () => {
  it.each([S.APPROVAL_NEEDED, S.NEGOTIATING, S.APPROVED])(
    "[REVERT-FAILS] staff re-pricing a %s order by posting it again is a 403, and nothing is written",
    async (status) => {
      seedOpenOrder(status);
      const res = await place(STAFF, { quantity: 6, finalPrice: 400 });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe("merge_would_change_price");
      expect(String(res.body.message)).toMatch(
        /only managers and owners can change an order's price\. Nothing was changed\.$/,
      );
      expect(state.writes).toHaveLength(0);
      expect(state.lineWrites).toHaveLength(0);
      expect(state.audits).toHaveLength(0);
      expect(state.order.final_price).toBe("300.00");
    },
  );

  it("[REVERT-FAILS] raising only the quantity of an approved order is money too", async () => {
    // The approval rules test the order's TOTAL, and the merge recomputes the
    // total from the quantity: 12 bottles at 300 is 3,600, not 1,800.
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, { quantity: 12, finalPrice: 300 });
    expect(res.status).toBe(403);
    expect(state.writes).toHaveLength(0);
    expect(state.order.quantity).toBe(6);
  });

  it("[REVERT-FAILS] a quantity change with the total held is still money", async () => {
    // The body can state its own total, so the quantity has to be tested on
    // its own: twelve bottles "for" 1,800 is still twice the wine approved.
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, {
      quantity: 12,
      finalPrice: 300,
      totalCost: 1800,
    });
    expect(res.status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });

  it("[REVERT-FAILS] a manager may fold it in, the role helper is asked, and it leaves paper", async () => {
    seedOpenOrder(S.APPROVED);
    const res = await place(MANAGER, { quantity: 6, finalPrice: 400 });
    expect(res.status).toBe(201);
    expect(state.roleAsks).toContain("change an order's price");
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].final_price).toBe(400);
    expect(state.writes[0].total_cost).toBe(2400);
    expect(state.audits).toHaveLength(1);
    const row = state.audits[0];
    expect(row.action).toBe("order_price_changed");
    expect(row.actor_id).toBe(MANAGER);
    expect(row.changes.door).toBe("merge");
    expect(row.changes.status).toBe(S.APPROVED);
    // The header's two figures, and (round 3) the line's two that moved with
    // them, named as `line.<column>`.
    expect(row.changes.fields).toEqual({
      final_price: { from: "300.00", to: 400 },
      total_cost: { from: "1800.00", to: 2400 },
      "line.final_unit_price": { from: "300.00", to: 400 },
      "line.line_total": { from: "1800.00", to: 2400 },
    });
  });

  it("[REVERT-FAILS] a PENDING order keeps today's re-quote for staff, and now leaves paper", async () => {
    // Nobody has approved a PENDING order; approving it tests the new figures.
    seedOpenOrder(S.PENDING);
    const res = await place(STAFF, { quantity: 6, finalPrice: 400 });
    expect(res.status).toBe(201);
    expect(state.roleAsks).toHaveLength(0);
    expect(state.writes).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].actor_id).toBe(STAFF);
    expect(state.audits[0].changes.door).toBe("merge");
  });

  it("[REVERT-FAILS] an order approved between the lookup and the write is not repriced by a staff fold", async () => {
    // The gate decided on the status the lookup read (PENDING, so no role was
    // needed); a manager approves before the write lands. The write is
    // conditional on that status, so it matches nothing and is refused whole.
    seedOpenOrder(S.PENDING);
    state.afterLookup = () => {
      state.order.status = S.APPROVED;
    };
    const res = await place(STAFF, { quantity: 6, finalPrice: 400 });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("merge_target_changed");
    expect(String(res.body.message)).toMatch(
      /Nothing was changed|nothing was changed/,
    );
    expect(state.writes).toHaveLength(0);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(state.order.status).toBe(S.APPROVED);
    expect(state.order.final_price).toBe("300.00");
  });

  it("[REVERT-FAILS] a price somebody else set in between is not overwritten by a stale fold", async () => {
    seedOpenOrder(S.APPROVED);
    state.afterLookup = () => {
      state.order.final_price = "450.00";
      state.order.total_cost = "2700.00";
    };
    const res = await place(MANAGER, { quantity: 6, finalPrice: 350 });
    expect(res.status).toBe(409);
    expect(state.writes).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(state.order.final_price).toBe("450.00");
  });

  it("[REVERT-FAILS] the paper is filed with the header, before the line that can still fail", async () => {
    seedOpenOrder(S.APPROVED);
    state.failLineInsert = true;
    const res = await place(MANAGER, { quantity: 6, finalPrice: 400 });
    expect(res.status).toBe(500);
    // The header moved; the log says so even though the line write failed.
    expect(state.writes).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].changes.door).toBe("merge");
  });

  it("a re-post that moves no figure is not refused and files nothing", async () => {
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, { quantity: 6, finalPrice: 300 });
    expect(res.status).toBe(201);
    expect(state.roleAsks).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });
});

// ===========================================================================
// 2d. The fold's LINE is held to the same rule (ADR 0244 D2, round 3)
// ===========================================================================
//
// Found by the v3 audit at e9c6ffe89 (the adversary's BLOCK, reproduced by the
// correctness reviewer): the gate compared the header's seven columns only,
// while `upsertOrderLine` deleted and rewrote the whole line on every fold —
// the unit pair, the fees, the currency, the unit prices and the SKU the
// invoice is paired on. A staff re-post that held the header could rewrite an
// approved order's line with no role and no paper; one that merely omitted
// those fields wiped them. The founder's pick, 2026-09-30: "Third round: gate
// the line".

describe("the line a fold would write is gated like the header", () => {
  // The header held exactly: same quantity, price and total as stored.
  const HELD = { quantity: 6, finalPrice: 300, totalCost: 1800 };

  it("[REVERT-FAILS] staff moving only the line's fees and currency past PENDING is a 403, with no line write and no paper", async () => {
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, {
      ...HELD,
      deposit: 50,
      freight: 20,
      currency: "USD",
    });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("merge_would_change_price");
    expect(state.writes).toHaveLength(0);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
    expect(state.lines[0].currency).toBe("EUR");
    expect(state.lines[0].deposit).toBeNull();
  });

  it("[REVERT-FAILS] staff changing only the vendor SKU of an approved order is a 403", async () => {
    // Not a price, but it decides which invoice line the agreed price is held
    // against (the delivery comparison pairs lines by vendor SKU).
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, { ...HELD, vendorSku: "OTHER-1" });
    expect(res.status).toBe(403);
    expect(state.lineWrites).toHaveLength(0);
  });

  it("[REVERT-FAILS] a manager may move the line, and the paper names each line column", async () => {
    seedOpenOrder(S.APPROVED);
    const res = await place(MANAGER, {
      ...HELD,
      deposit: 50,
      currency: "USD",
    });
    expect(res.status).toBe(201);
    expect(state.roleAsks).toContain("change an order's price");
    expect(state.lineWrites).toEqual(["delete", "insert"]);
    expect(state.audits).toHaveLength(1);
    const fields = state.audits[0].changes.fields;
    expect(fields["line.deposit"]).toEqual({ from: null, to: 50 });
    expect(fields["line.currency"]).toEqual({ from: "EUR", to: "USD" });
    expect(fields).not.toHaveProperty("total_cost");
    expect(state.lines[0].deposit).toBe(50);
  });

  it("[REVERT-FAILS] a re-post that omits the line's unit prices, currency and SKU does not wipe them", async () => {
    seedOpenOrder(S.APPROVED);
    Object.assign(state.order, {
      quoted_price: "280.00",
      negotiated_price: "290.00",
    });
    Object.assign(state.lines[0], {
      quoted_unit_price: "280.00",
      negotiated_unit_price: "290.00",
      vendor_sku: "BAR-19",
    });
    const res = await place(STAFF, { quantity: 6, finalPrice: 300 });
    expect(res.status).toBe(201);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.lines[0]).toMatchObject({
      quoted_unit_price: "280.00",
      negotiated_unit_price: "290.00",
      currency: "EUR",
      vendor_sku: "BAR-19",
    });
  });

  it("[REVERT-FAILS] omitting a fee the line holds is a change, and staff are refused it past PENDING", async () => {
    // The fees and the unit pair are not carried forward: the header's total
    // is worked out from the request's fees and unit, so an omission there
    // changes the money, and it is decided like any other change.
    seedOpenOrder(S.APPROVED);
    // A consistent order with a 50.00 deposit: header and line both 1,850.00.
    state.order.total_cost = "1850.00";
    Object.assign(state.lines[0], { deposit: "50.00", line_total: "1850.00" });
    // The header held exactly (its total stated), the deposit left out.
    const res = await place(STAFF, { ...HELD, totalCost: 1850 });
    expect(res.status).toBe(403);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.lines[0].deposit).toBe("50.00");
  });

  it("[REVERT-FAILS] a manager's re-post that leaves out a held fee clears it, and the paper says so", async () => {
    seedOpenOrder(S.APPROVED);
    state.order.total_cost = "1850.00";
    Object.assign(state.lines[0], { deposit: "50.00", line_total: "1850.00" });
    const res = await place(MANAGER, { ...HELD, totalCost: 1850 });
    expect(res.status).toBe(201);
    expect(state.lines[0].deposit).toBeNull();
    const fields = state.audits[0].changes.fields;
    expect(fields["line.deposit"]).toEqual({ from: "50.00", to: null });
    expect(fields["line.line_total"]).toEqual({ from: "1850.00", to: 1800 });
  });

  it("[REVERT-FAILS] a re-post that changes nothing writes no header and no line", async () => {
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, { quantity: 6, finalPrice: 300 });
    expect(res.status).toBe(201);
    expect(state.writes).toHaveLength(0);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("[REVERT-FAILS] a notes-only re-post writes the header, never the line", async () => {
    // Before round 3 every fold rewrote the line, and a re-post that restated
    // nothing about the fees wiped them. Now only a line that moves is written.
    seedOpenOrder(S.APPROVED);
    state.order.total_cost = "1850.00";
    Object.assign(state.lines[0], { deposit: "50.00", line_total: "1850.00" });
    const res = await place(STAFF, {
      quantity: 6,
      finalPrice: 300,
      deposit: 50,
      managerNotes: "call the rep before Friday",
    });
    expect(res.status).toBe(201);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].manager_notes).toBe("call the rep before Friday");
    expect(state.lineWrites).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  it("[REVERT-FAILS] a PENDING fold stays free for staff, rewrites the line, and names it on paper", async () => {
    seedOpenOrder(S.PENDING);
    const res = await place(STAFF, { ...HELD, deposit: 50 });
    expect(res.status).toBe(201);
    expect(state.roleAsks).toHaveLength(0);
    expect(state.lineWrites).toEqual(["delete", "insert"]);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0].changes.fields["line.deposit"]).toEqual({
      from: null,
      to: 50,
    });
  });

  it("[REVERT-FAILS] an order holding two lines is a change a fold would make, refused for staff past PENDING", async () => {
    seedOpenOrder(S.APPROVED);
    state.lines.push({ ...state.lines[0], id: "line-2" });
    const res = await place(STAFF, { quantity: 6, finalPrice: 300 });
    expect(res.status).toBe(403);
    expect(state.lines).toHaveLength(2);
  });

  it("[REVERT-FAILS] an order touched between the lookup and the write is not folded into (updated_at)", async () => {
    // A line price written by confirm-deal or the vendor's acceptance reaches
    // the header through the echo trigger, and the table stamps updated_at on
    // every update: the write is conditional on it.
    seedOpenOrder(S.APPROVED);
    state.order.updated_at = "2026-09-30T10:00:00.000001+00:00";
    state.afterLookup = () => {
      state.order.updated_at = "2026-09-30T10:00:05.000001+00:00";
    };
    const res = await place(MANAGER, { ...HELD, deposit: 50 });
    expect(res.status).toBe(409);
    expect(state.writes).toHaveLength(0);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  // ROUND 4 (founder, 2026-09-30: "Disclose + pin tests; RPC next
  // (Recommended)"). Three pins, each killing a mutation the v4 reviewers
  // found surviving at 0167bcbb9.

  it.each([
    ["an APPROVED order, by a manager", S.APPROVED, MANAGER],
    ["a PENDING order, by staff", S.PENDING, STAFF],
  ])(
    "[REVERT-FAILS] a fold that rewrites the line keeps the unit prices, currency and SKU it left out (%s)",
    async (_label, status, who) => {
      // Kills: `held: heldLine` dropped from the fold's upsertOrderLine call.
      // The carry has to survive the WRITE, not only the gate's no-move path.
      seedOpenOrder(status as S);
      Object.assign(state.order, {
        quoted_price: "280.00",
        negotiated_price: "290.00",
      });
      Object.assign(state.lines[0], {
        quoted_unit_price: "280.00",
        negotiated_unit_price: "290.00",
        vendor_sku: "BAR-19",
      });
      const res = await place(who as string, { ...HELD, deposit: 50 });
      expect(res.status).toBe(201);
      expect(state.lineWrites).toEqual(["delete", "insert"]);
      expect(state.lines).toHaveLength(1);
      expect(state.lines[0]).toMatchObject({
        quoted_unit_price: "280.00",
        negotiated_unit_price: "290.00",
        currency: "EUR",
        vendor_sku: "BAR-19",
        deposit: 50,
      });
    },
  );

  it("[REVERT-FAILS] staff changing only the unit (bottle to each) past PENDING is a 403, and nothing is written", async () => {
    // Kills: `unit_type` dropped from TEXT_FIGURES. Compared as numbers, two
    // unit words both read as "not a number" and look the same.
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, { ...HELD, unitType: "each" });
    expect(res.status).toBe(403);
    expect(state.writes).toHaveLength(0);
    expect(state.lineWrites).toHaveLength(0);
    expect(state.lines[0].unit_type).toBe("bottle");
  });

  it("[REVERT-FAILS] a manager's new vendor SKU is the one written on the line, on paper", async () => {
    // Kills: the carry's precedence swapped to `held ?? dto`, which would keep
    // the old SKU over the one the manager stated. The base wrote the
    // request's SKU too; it is red there only because the base files no row.
    seedOpenOrder(S.APPROVED);
    state.lines[0].vendor_sku = "BAR-19";
    const res = await place(MANAGER, { ...HELD, vendorSku: "BAR-20" });
    expect(res.status).toBe(201);
    expect(state.lines[0].vendor_sku).toBe("BAR-20");
    expect(state.audits[0].changes.fields["line.vendor_sku"]).toEqual({
      from: "BAR-19",
      to: "BAR-20",
    });
  });

  it("[REVERT-FAILS] refuses the fold when the held line cannot be read", async () => {
    seedOpenOrder(S.APPROVED);
    state.failLineRead = true;
    const res = await place(MANAGER, { ...HELD, deposit: 50 });
    expect(res.status).toBe(500);
    expect(state.writes).toHaveLength(0);
    expect(state.lineWrites).toHaveLength(0);
  });
});

// ===========================================================================
// 3. What a member of the house may still do here
// ===========================================================================

describe("the notes on an order stay a member's to write", () => {
  it("staff may write the order's notes, and no role is asked", async () => {
    seed(S.APPROVED);
    const res = await patch(STAFF, {
      managerNotes: "call the rep before Friday",
      deliveryNotes: "back door, before 11",
      trackingNumber: "1Z999",
    });
    expect(res.status).toBe(200);
    expect(state.roleAsks).toHaveLength(0);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0]).toEqual({
      manager_notes: "call the rep before Friday",
      delivery_notes: "back door, before 11",
      tracking_number: "1Z999",
    });
    expect(state.order.status).toBe(S.APPROVED);
    expect(state.audits).toHaveLength(0);
  });
});

// ===========================================================================
// 4. The gate refuses when it cannot see
// ===========================================================================

describe("the price gate fails closed", () => {
  it("[REVERT-FAILS] refuses a price change when the role helper is not wired", async () => {
    seed(S.PENDING);
    // Positional construction, the way seven older specs build this service:
    // no OrganizationsService. The running gateway always has one.
    const bare = new ProcurementService(
      { supabase, getClient: () => supabase } as any,
      {} as any,
      {} as any,
    );
    await expect(
      bare.updateOrder(HOUSE, ORDER, { totalCost: 5 } as any, {
        actorUserId: OWNER,
      }),
    ).rejects.toMatchObject({ status: 500 });
    expect(state.writes).toHaveLength(0);
  });

  it("[REVERT-FAILS] refuses a price change that names nobody", async () => {
    seed(S.PENDING);
    const bare = new ProcurementService(
      { supabase, getClient: () => supabase } as any,
      {} as any,
      {} as any,
    );
    (bare as any).organizations = {
      assertCanManageRestaurant: async () => undefined,
    };
    await expect(
      bare.updateOrder(HOUSE, ORDER, { totalCost: 5 } as any),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.writes).toHaveLength(0);
  });
});
