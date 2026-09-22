import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  HouseCounterService,
  REGISTER_TIMEOUT_MS,
  mayManage,
  outcomeOfFailure,
} from "./house-counter.service";
import { HouseCounterController } from "./house-counter.controller";
import type {
  CounterRegister,
  CounterRegisterKey,
  HouseCounterResponse,
} from "./house-counter.types";

/**
 * The counter's one read, each register answering for itself.
 *
 * The unit under test is `HouseCounterService` — real. What is faked is what
 * it READS THROUGH (the owning services and the database client), because the
 * question here is what the aggregate does with each source's answer, not
 * whether each source's own query is right (their own suites pin that).
 *
 * Every case below is a way the counter could lie:
 *
 *   1. print a zero for a register that failed (absence reported as health);
 *   2. hand a staff member the house's money, or a 403 for the whole column
 *      instead of a refusal in words for the one register;
 *   3. let one hung source hold the whole column hostage;
 *   4. read a house that is not the token's;
 *   5. hand the page the database's own error text;
 *   6. publish a total over registers that did not all answer.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const DB_TEXT = "canceling statement due to statement timeout";

type Result = { data: unknown; error: { message: string } | null };

/** A supabase-js-shaped client whose `from(table)` answers per table. */
function makeDb(byTable: Record<string, Result | (() => Result)>) {
  const calls: { table: string; eqs: [string, unknown][] }[] = [];
  return {
    calls,
    getClient() {
      return {
        from(table: string) {
          const call = { table, eqs: [] as [string, unknown][] };
          calls.push(call);
          const answer = () => {
            const r = byTable[table];
            if (!r) throw new Error(`unexpected table ${table}`);
            return typeof r === "function" ? r() : r;
          };
          const q: any = {
            select: () => q,
            eq(col: string, val: unknown) {
              call.eqs.push([col, val]);
              return q;
            },
            order: () => q,
            limit: () => q,
            maybeSingle: () => Promise.resolve(answer()),
            then(res: (v: Result) => unknown, rej?: (e: unknown) => unknown) {
              return Promise.resolve(answer()).then(res, rej);
            },
          };
          return q;
        },
      };
    },
  };
}

function order(i: number) {
  return {
    id: `o-${i}`,
    orderNumber: `ORD-${i}`,
    providerName: "Kermit Lynch",
    wineName: "Chablis",
    quantity: 12,
    unitType: "bottle",
    totalCost: 100 * i,
    finalPrice: 9,
    status: "APPROVAL_NEEDED",
    requestedAt: "2026-09-21T09:00:00Z",
  };
}

function sources(over: Partial<Record<string, jest.Mock>> = {}) {
  return {
    procurement: {
      listPendingOrders:
        over.listPendingOrders ??
        jest.fn(async () => [1, 2, 3, 4, 5, 6, 7].map(order)),
    },
    receiving: {
      listUnverifiedCapped:
        over.listUnverifiedCapped ??
        jest.fn(async () => ({
          rows: [
            {
              orderId: "o-9",
              orderNumber: "ORD-9",
              countedQtyBottles: 36,
              countedAt: "2026-09-21T08:00:00Z",
              ageHours: 6,
              severity: "fresh",
            },
          ],
          capped: false,
        })),
    },
    conversations: {
      getPendingConversations:
        over.getPendingConversations ??
        jest.fn(async () => [
          {
            id: "c-1",
            providers: { name: "Revel Wine" },
            procurement_orders: { order_number: "ORD-3", negotiated_price: 41 },
            message_text: "We can do $41.00 a bottle",
            channel: "email",
            detected_intent: "price_offer",
            ai_generated: true,
            created_at: "2026-09-21T07:00:00Z",
          },
        ]),
    },
    identity: {
      pending: over.pending ?? jest.fn(async () => []),
    },
    members: {
      getInvites:
        over.getInvites ??
        jest.fn(async () => [
          {
            id: "i-1",
            code: "SECRET-INVITE-CODE",
            role: "staff",
            expires_at: "2026-09-28T00:00:00Z",
            created_at: "2026-09-20T00:00:00Z",
          },
        ]),
    },
    askAi: {
      listOpen:
        over.listOpen ??
        jest.fn(async () => [
          {
            id: "p-1",
            summary: "Order 2 cases of Chablis from Kermit Lynch",
            family: "procurement",
            action_type: "reorder",
            utterance: "reorder chablis",
            created_at: "2026-09-21T06:00:00Z",
          },
        ]),
    },
  };
}

const CREDITS_OK: Result = {
  data: [
    {
      id: "cr-1",
      reason: "qty_short",
      summary: "3 bottles short",
      currency: "USD",
      claimed_amount: "96.00",
      promised_at: "2026-09-19T00:00:00Z",
      provider: { name: "Southern Glazer's" },
    },
  ],
  error: null,
};
const CURRENCY_OK: Result = { data: { currency: "USD" }, error: null };

function build(
  src = sources(),
  db = makeDb({ procurement_credits: CREDITS_OK, restaurants: CURRENCY_OK }),
) {
  const svc = new HouseCounterService(
    db as any,
    src.procurement as any,
    src.receiving as any,
    src.conversations as any,
    src.identity as any,
    src.members as any,
    src.askAi as any,
  );
  return { svc, src, db };
}

function reg(
  res: HouseCounterResponse,
  key: CounterRegisterKey,
): CounterRegister {
  const r = res.registers.find((x) => x.key === key);
  if (!r) throw new Error(`no register ${key}`);
  return r;
}

describe("the counter answers per register (answered)", () => {
  it("returns all seven registers in the drawn order, each with its own outcome", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER, "owner");
    expect(res.registers.map((r) => [r.key, r.verb])).toEqual([
      ["orders", "seal"],
      ["deliveries", "verify"],
      ["credits", "verify"],
      ["threads", "reply"],
      ["identities", "decide"],
      ["invitations", "decide"],
      ["proposals", "proposed"],
    ]);
    expect(res.registers.every((r) => r.state === "answered")).toBe(true);
  });

  it("counts every row it read but carries only the first five", async () => {
    const { svc } = build();
    const orders = reg(await svc.read(HOUSE, USER, "owner"), "orders");
    expect(orders.state).toBe("answered");
    if (orders.state !== "answered") return;
    expect(orders.count).toBe(7);
    expect(orders.complete).toBe(true);
    expect(orders.rows).toHaveLength(5);
  });

  it("an order's money is its total, never its unit price standing in", async () => {
    const { svc } = build();
    const orders = reg(await svc.read(HOUSE, USER, "owner"), "orders");
    if (orders.state !== "answered") throw new Error("not answered");
    expect((orders.rows[0] as any).total).toBe(100);
  });

  it("an empty register that WAS read answers zero — a real zero stays a zero", async () => {
    const { svc } = build();
    const ids = reg(await svc.read(HOUSE, USER, "owner"), "identities");
    expect(ids).toMatchObject({ state: "answered", count: 0, rows: [] });
  });

  it("a full page is a floor, not a total", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => ({ id: `c-${i}` }));
    const { svc } = build(sources({ pending: jest.fn(async () => fifty) }));
    const ids = reg(await svc.read(HOUSE, USER, "owner"), "identities");
    expect(ids).toMatchObject({
      state: "answered",
      count: 50,
      complete: false,
    });
  });

  it("deliveries is a floor, not a total, when its 500-event read is capped", async () => {
    // The register's own contract (house-counter.types.ts): `complete` is
    // false when the underlying read stopped at its page size. `deliveries`
    // reads `listUnverifiedCapped`, whose `capped` this must derive
    // `complete` from — not print `complete: true` unconditionally the way
    // `orders`/`threads`/`invitations` correctly do for their own,
    // genuinely-uncapped sources.
    const rows500 = Array.from({ length: 500 }, (_, i) => ({
      orderId: `o-${i}`,
      orderNumber: `ORD-${i}`,
      countedQtyBottles: 6,
      countedAt: "2026-09-21T08:00:00Z",
      ageHours: 1,
      severity: "fresh",
    }));
    const { svc } = build(
      sources({
        listUnverifiedCapped: jest.fn(async () => ({
          rows: rows500,
          capped: true,
        })),
      }),
    );
    const deliveries = reg(await svc.read(HOUSE, USER, "owner"), "deliveries");
    expect(deliveries).toMatchObject({
      state: "answered",
      count: 500,
      complete: false,
    });
  });

  it("deliveries is complete when its read did not hit the cap", async () => {
    const { svc } = build();
    const deliveries = reg(await svc.read(HOUSE, USER, "owner"), "deliveries");
    expect(deliveries).toMatchObject({ state: "answered", complete: true });
  });

  it("publishes no total across registers", async () => {
    const { svc } = build();
    const res = (await svc.read(HOUSE, USER, "owner")) as any;
    expect(Object.keys(res).sort()).toEqual([
      "house",
      "readAt",
      "registers",
      "role",
    ]);
  });

  it("reads every source for the TOKEN's house, never another", async () => {
    const { svc, src, db } = build();
    await svc.read(HOUSE, USER, "owner");
    expect(src.procurement.listPendingOrders).toHaveBeenCalledWith(HOUSE);
    expect(src.receiving.listUnverifiedCapped).toHaveBeenCalledWith(HOUSE);
    expect(src.conversations.getPendingConversations).toHaveBeenCalledWith(
      HOUSE,
    );
    expect(src.identity.pending).toHaveBeenCalledWith(HOUSE, 50);
    expect(src.members.getInvites).toHaveBeenCalledWith(USER, HOUSE);
    expect(src.askAi.listOpen).toHaveBeenCalledWith(HOUSE);
    const credits = db.calls.find((c) => c.table === "procurement_credits");
    expect(credits?.eqs).toEqual(
      expect.arrayContaining([
        ["restaurant_id", HOUSE],
        ["state", "promised"],
      ]),
    );
  });

  it("carries no invite code, no vendor message text and no negotiated price", async () => {
    const { svc } = build();
    const text = JSON.stringify(await svc.read(HOUSE, USER, "owner"));
    expect(text).not.toContain("SECRET-INVITE-CODE");
    expect(text).not.toContain("$41.00");
    expect(text).not.toContain("negotiated");
  });

  it("names a promised credit as promised, in its own currency", async () => {
    const { svc } = build();
    const credits = reg(await svc.read(HOUSE, USER, "manager"), "credits");
    if (credits.state !== "answered") throw new Error("not answered");
    expect(credits.rows[0]).toMatchObject({
      promisedAmount: 96,
      currency: "USD",
    });
  });
});

describe("the counter refuses by role, in words, per register (refused)", () => {
  it("refuses staff the two registers that carry the house's money or its door", async () => {
    const { svc, src, db } = build();
    const res = await svc.read(HOUSE, USER, "staff");
    const credits = reg(res, "credits");
    const invites = reg(res, "invitations");
    expect(credits.state).toBe("refused");
    expect(invites.state).toBe("refused");
    if (credits.state === "refused")
      expect(credits.sentence).toMatch(/owner or a manager/);
    // Refused from the role, so the money is never read at all.
    expect(db.calls.some((c) => c.table === "procurement_credits")).toBe(false);
    expect(src.members.getInvites).not.toHaveBeenCalled();
  });

  it("still answers staff the registers the gateway hands them, marking the act as not theirs", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER, "staff");
    expect(reg(res, "orders")).toMatchObject({
      state: "answered",
      act: "not_yours",
    });
    expect(reg(res, "threads")).toMatchObject({
      state: "answered",
      act: "not_yours",
    });
    expect(reg(res, "proposals")).toMatchObject({
      state: "answered",
      act: "not_yours",
    });
    // Identity links are staff's to decide; door counts are theirs to do.
    expect(reg(res, "identities")).toMatchObject({
      state: "answered",
      act: "yours",
    });
    expect(reg(res, "deliveries")).toMatchObject({
      state: "answered",
      act: "yours",
    });
  });

  it("a null role (a house with no row for this person) never opens a manager's register", async () => {
    const { svc } = build();
    const res = await svc.read(HOUSE, USER, null);
    expect(reg(res, "credits").state).toBe("refused");
    expect(reg(res, "invitations").state).toBe("refused");
  });

  it("a source's own 403 is printed as the source said it, not as a failure", async () => {
    const { svc } = build(
      sources({
        getInvites: jest.fn(async () => {
          throw new ForbiddenException("Access denied to this restaurant");
        }),
      }),
    );
    const invites = reg(await svc.read(HOUSE, USER, "manager"), "invitations");
    expect(invites).toMatchObject({
      state: "refused",
      sentence: "Access denied to this restaurant",
    });
  });

  it("the whole read is refused when the session names no house", async () => {
    const { svc } = build();
    await expect(svc.read("", USER, "owner")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("a register that could not be read is never a zero (unreadable)", () => {
  it("a 503 from one source is that register unreadable, and the other six still answer", async () => {
    const { svc } = build(
      sources({
        listPendingOrders: jest.fn(async () => {
          throw new ServiceUnavailableException(
            "Could not read pending orders",
          );
        }),
      }),
    );
    const res = await svc.read(HOUSE, USER, "owner");
    const orders = reg(res, "orders");
    expect(orders).toMatchObject({ state: "unreadable", status: 503 });
    expect(orders).not.toHaveProperty("count");
    expect(res.registers.filter((r) => r.state === "answered")).toHaveLength(6);
  });

  it("a failed credits read is unreadable — never `count: 0`", async () => {
    const db = makeDb({
      procurement_credits: { data: null, error: { message: DB_TEXT } },
      restaurants: CURRENCY_OK,
    });
    const { svc } = build(sources(), db);
    const credits = reg(await svc.read(HOUSE, USER, "owner"), "credits");
    expect(credits.state).toBe("unreadable");
    expect(credits).not.toHaveProperty("count");
  });

  it("never hands the page the database's own error text", async () => {
    const { svc } = build(
      sources({
        pending: jest.fn(async () => {
          throw new BadRequestException(
            `The candidate queue could not be read (${DB_TEXT}). This is unknown, not an empty queue.`,
          );
        }),
        getPendingConversations: jest.fn(async () => {
          throw new Error(DB_TEXT);
        }),
      }),
    );
    const res = await svc.read(HOUSE, USER, "owner");
    expect(reg(res, "identities")).toMatchObject({
      state: "unreadable",
      status: 400,
    });
    expect(reg(res, "threads")).toMatchObject({
      state: "unreadable",
      status: 500,
    });
    expect(JSON.stringify(res)).not.toContain(DB_TEXT);
  });

  it("a source that hangs is unreadable after the timeout; it does not hold the column", async () => {
    jest.useFakeTimers();
    try {
      const { svc } = build(
        sources({
          listOpen: jest.fn(() => new Promise<never>(() => undefined)),
        }),
      );
      const pending = svc.read(HOUSE, USER, "owner");
      await jest.advanceTimersByTimeAsync(REGISTER_TIMEOUT_MS + 1);
      const res = await pending;
      expect(reg(res, "proposals")).toMatchObject({
        state: "unreadable",
        status: null,
      });
      expect(reg(res, "orders").state).toBe("answered");
    } finally {
      jest.useRealTimers();
    }
  });

  it("a failed currency read is `unreadable`, not `not_recorded`", async () => {
    const db = makeDb({
      procurement_credits: CREDITS_OK,
      restaurants: { data: null, error: { message: DB_TEXT } },
    });
    const { svc } = build(sources(), db);
    const res = await svc.read(HOUSE, USER, "owner");
    expect(res.house.currency).toEqual({ state: "unreadable", code: null });
  });

  it("a house with no currency says `not_recorded`", async () => {
    const db = makeDb({
      procurement_credits: CREDITS_OK,
      restaurants: { data: { currency: null }, error: null },
    });
    const { svc } = build(sources(), db);
    const res = await svc.read(HOUSE, USER, "owner");
    expect(res.house.currency).toEqual({ state: "not_recorded", code: null });
  });
});

describe("the pure pieces", () => {
  it("mayManage mirrors RolesGuard: owner, manager and admin; never staff or null", () => {
    expect(mayManage("owner")).toBe(true);
    expect(mayManage("Manager")).toBe(true);
    expect(mayManage("admin")).toBe(true);
    expect(mayManage("staff")).toBe(false);
    expect(mayManage(null)).toBe(false);
    expect(mayManage(undefined)).toBe(false);
  });

  it("outcomeOfFailure: 403 is refused with its sentence; anything else is unreadable", () => {
    expect(outcomeOfFailure(new ForbiddenException("no"), "X")).toEqual({
      state: "refused",
      sentence: "no",
    });
    expect(
      outcomeOfFailure(new ServiceUnavailableException("db"), "X"),
    ).toMatchObject({
      state: "unreadable",
      status: 503,
    });
    expect(outcomeOfFailure(new Error(DB_TEXT), "X").sentence).not.toContain(
      DB_TEXT,
    );
  });
});

describe("the controller takes the house and the role from the token only", () => {
  it("passes user.restaurantId, user.userId and user.role — nothing else", async () => {
    const read = jest.fn(async () => ({}) as HouseCounterResponse);
    const ctl = new HouseCounterController({ read } as any);
    await ctl.read({ userId: USER, restaurantId: HOUSE, role: "staff" });
    expect(read).toHaveBeenCalledWith(HOUSE, USER, "staff");
  });
});
