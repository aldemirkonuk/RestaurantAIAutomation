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
 * [REVERT-FAILS] marks a case that fails on c47fd8a01.
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
} = {
  order: {},
  writes: [],
  roleAsks: [],
  audits: [],
  failOrderRead: false,
  lineWrites: [],
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
  });
}

const supabase: any = {
  from(table: string) {
    const q: any = {
      select: () => q,
      insert: (row: Row) => {
        if (table === "system_audit_log") state.audits.push(row);
        if (table === "procurement_order_items")
          state.lineWrites.push("insert");
        return q;
      },
      delete: () => {
        if (table === "procurement_order_items")
          state.lineWrites.push("delete");
        return q;
      },
      update: (payload: Row) => {
        // supabase-js drops `undefined` keys before PostgREST sees them.
        const sent = Object.fromEntries(
          Object.entries(payload).filter(([, v]) => v !== undefined),
        );
        if (table === "procurement_orders") {
          state.writes.push(sent);
          Object.assign(state.order, sent);
        }
        return q;
      },
      eq: () => q,
      in: () => q,
      is: () => q,
      not: () => q,
      neq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () =>
        table === "procurement_orders"
          ? state.failOrderRead
            ? { data: null, error: { message: "connection reset" } }
            : { data: { ...state.order }, error: null }
          : table === "restaurant_inventory"
            ? { data: { id: INVENTORY, wine_name: "Barolo 2019" }, error: null }
            : { data: null, error: null },
      single: async () =>
        table === "procurement_orders"
          ? { data: { ...state.order }, error: null }
          : { data: null, error: null },
      // A list read. `providers` is only ever counted here (the vendor is the
      // house's, and the house has an active vendor); `procurement_orders` as
      // a list is the dedup lookup, which finds the one open order.
      then: (resolve: any, reject: any) =>
        Promise.resolve(
          table === "providers"
            ? { count: 1, data: [], error: null }
            : table === "procurement_orders"
              ? { data: [{ ...state.order }], error: null }
              : { data: [], error: null },
        ).then(resolve, reject),
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

  it("files nothing for a refused price change, or for notes", async () => {
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
    expect(row.changes.fields).toEqual({
      final_price: { from: "300.00", to: 400 },
      total_cost: { from: "1800.00", to: 2400 },
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

  it("a re-post that moves no figure is not refused and files nothing", async () => {
    seedOpenOrder(S.APPROVED);
    const res = await place(STAFF, { quantity: 6, finalPrice: 300 });
    expect(res.status).toBe(201);
    expect(state.roleAsks).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
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
