import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { ApprovalThresholdsService } from "../settings/approval-thresholds.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { roleSatisfies, refusalSentence, policyNote } from "./order-approval-gate";
import type { ThresholdRow } from "../settings/approval-thresholds";

/**
 * A threshold stops an order.
 *
 * For two passes `/settings` carried the house's approval rules and printed, as
 * its first sentence, that nothing read them: `approveOrder` wrote
 * `status/approved_at/approved_by` without consulting a role or an amount, so
 * anyone who could reach `POST /procurement/orders/:id/approve` could seal any
 * figure. These are the tests that make that sentence false.
 *
 * WHAT EACH CASE IS FOR, because a suite of "it works" tests proves nothing:
 *
 *  * below / at / above the ceiling — the boundary is `>`, not `>=`, and a
 *    ceiling of 5,000 must not stop an order OF 5,000. A house that set 5,000
 *    said five thousand is allowed.
 *  * each role — a manager refused where an owner passes, on the same order,
 *    against the same rule.
 *  * an unknown fact — `isFirstOrderToVendor: null` must NOT fire `new_vendor`.
 *    A rule that fires on an unknown is a rule that fires during a database
 *    outage.
 *  * a house with no rule — seals exactly as before. Silence is not "nobody may
 *    approve".
 *  * an UNREADABLE policy — refuses. This is the opposite of the case above and
 *    the whole point of separating them: a table that cannot be read has not
 *    said "anyone, any amount".
 *  * the audit row — a refusal that leaves no trace is a policy quietly blocking
 *    a house's work with nothing to point at.
 */

type Row = Record<string, any>;

interface Calls {
  orderUpdates: Row[];
  auditInserts: Row[];
}

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";

function ceiling(amount: number, requiredRole: "owner" | "manager" = "owner"): ThresholdRow {
  return {
    rule: "manager_ceiling",
    enabled: true,
    amountLimit: amount,
    percentLimit: null,
    requiredRole,
    setBy: null,
    updatedAt: null,
  };
}

function newVendorRule(): ThresholdRow {
  return {
    rule: "new_vendor",
    enabled: true,
    amountLimit: null,
    percentLimit: null,
    requiredRole: "owner",
    setBy: null,
    updatedAt: null,
  };
}

/**
 * Supabase stub that records what the gate tries to write.
 *
 * `priorOrdersToVendor` is returned as the `count` on the head query the gate
 * uses for first-order-ness; `countErrors` makes that read fail so the
 * "unknown is not false" case can be driven.
 */
function makeDb(opts: {
  order?: Row | null;
  orderReadError?: { message: string } | null;
  priorOrdersToVendor?: number;
  countErrors?: boolean;
  priorPrices?: Row[];
  ledgerRows?: Row[];
  ledgerError?: { message: string } | null;
  auditFails?: boolean;
}) {
  const calls: Calls = { orderUpdates: [], auditInserts: [] };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select";
      let head = false;
      let selectedColumns = "";

      const settle = (shape: "one" | "many") => {
        if (table === "system_audit_log") {
          return {
            data: null,
            error: opts.auditFails ? { message: "audit table unreachable" } : null,
          };
        }
        if (table === "procurement_orders") {
          // The seal is `update(...).select(...).single()`, so the update has
          // to hand the row back or `mapOrderRow` has nothing to map.
          if (op === "update")
            return {
              data: opts.order ? { ...opts.order, status: "APPROVED" } : null,
              error: null,
            };
          if (head) {
            if (opts.countErrors)
              return { data: null, count: null, error: { message: "count failed" } };
            return { data: null, count: opts.priorOrdersToVendor ?? 0, error: null };
          }
          if (shape === "one") {
            if (opts.orderReadError)
              return { data: null, error: opts.orderReadError };
            return { data: opts.order ?? null, error: null };
          }
          if (opts.ledgerError)
            return { data: null, error: opts.ledgerError };
          // The prior-price probe selects exactly two columns; the whole-house
          // walk selects seven. Told apart by the projection so one stub can
          // answer both without either quietly receiving the other's rows.
          if (selectedColumns.includes("final_price, requested_at"))
            return { data: opts.priorPrices ?? [], error: null };
          return { data: opts.ledgerRows ?? [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      const q: any = {
        select: (cols?: string, o?: { head?: boolean }) => {
          selectedColumns = cols ?? "";
          if (o?.head) head = true;
          return q;
        },
        eq: () => q,
        neq: () => q,
        gte: () => q,
        order: () => q,
        limit: () => q,
        update(payload: Row) {
          op = "update";
          calls.orderUpdates.push(payload);
          return q;
        },
        insert(payload: Row) {
          op = "insert";
          if (table === "system_audit_log") calls.auditInserts.push(payload);
          return Promise.resolve(settle("one"));
        },
        single: async () => settle("one"),
        maybeSingle: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
  };

  const db = {
    supabase,
    getClient: () => supabase,
    client: supabase,
  } as unknown as DatabaseService;

  return { db, calls };
}

const events = { createEvent: jest.fn().mockResolvedValue({}) } as unknown as EventsService;
const ledger = { recordTransaction: jest.fn().mockResolvedValue({}) } as unknown as InventoryLedgerService;

function thresholdsStub(
  rows: ThresholdRow[],
  opts: { readable?: boolean; reason?: string | null } = {},
): ApprovalThresholdsService {
  return {
    read: jest.fn().mockResolvedValue({
      restaurantId: REST,
      thresholds: rows,
      policyEmpty: rows.length === 0,
      readable: opts.readable ?? true,
      reason: opts.reason ?? null,
      retrospective: {
        counts: [],
        ordersRead: 0,
        windowDays: 365,
        readable: true,
        reason: null,
        caveat: "",
      },
      enforcement: { enforcedBy: [], wouldBeEnforcedAt: "", note: "" },
    }),
  } as unknown as ApprovalThresholdsService;
}

function orgsStub(role: string | null): OrganizationsService {
  return {
    resolveRestaurantRole: jest.fn().mockResolvedValue(role),
  } as unknown as OrganizationsService;
}

function service(
  db: DatabaseService,
  thresholds?: ApprovalThresholdsService,
  orgs?: OrganizationsService,
) {
  return new ProcurementService(
    db,
    events,
    ledger,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    thresholds,
    orgs,
  );
}

const ORDER_ROW = {
  id: ORDER,
  order_number: "ORD-2026-00001",
  restaurant_id: REST,
  inventory_id: "inv-1",
  provider_id: "prov-1",
  quantity: 5,
  final_price: 400,
  total_cost: 2000,
  status: "PENDING",
  inventory: { wine_name: "Barolo Riserva" },
};

describe("roleSatisfies — the rank rule, and the null trap", () => {
  it("owner satisfies both rules; manager satisfies only the manager rule", () => {
    expect(roleSatisfies("owner", "owner")).toBe(true);
    expect(roleSatisfies("owner", "manager")).toBe(true);
    expect(roleSatisfies("manager", "manager")).toBe(true);
    expect(roleSatisfies("manager", "owner")).toBe(false);
  });

  it("null, undefined, staff and an unknown string all satisfy NOTHING", () => {
    // The load-bearing case. `resolveRestaurantRole` returns null both for "no
    // row" and for "the read failed", so a null that satisfied `manager` would
    // open the ceiling during a database outage.
    for (const role of [null, undefined, "staff", "chef", ""]) {
      expect(roleSatisfies(role as string | null, "manager")).toBe(false);
      expect(roleSatisfies(role as string | null, "owner")).toBe(false);
    }
  });
});

describe("refusalSentence and policyNote — the words the person reads", () => {
  it("names the rule, the number and who may sign", () => {
    const s = refusalSentence(
      {
        requiredRole: "owner",
        firedBy: ["manager_ceiling"],
        reasons: ["over the 1000 ceiling this house set for a manager"],
        policySet: true,
        untestable: [],
      },
      "manager",
    );
    expect(s).toContain("over the 1000 ceiling this house set for a manager");
    expect(s).toContain("an owner");
    expect(s).toContain("signed in as manager");
    expect(s).toContain("nothing was approved");
  });

  it("a house with no rule says so in those words", () => {
    expect(policyNote(false)).toBe("no threshold is set for this house");
    expect(policyNote(true)).toContain("recorded at least one approval rule");
  });
});

describe("approveOrder — the ceiling", () => {
  it("BELOW the ceiling: a manager seals it, and no refusal is filed", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 900 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    await svc.approveOrder(REST, ORDER, USER);

    expect(calls.auditInserts).toHaveLength(0);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("AT the ceiling: a manager seals it — a house that set 1000 allowed 1000", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 1000 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    await svc.approveOrder(REST, ORDER, USER);

    expect(calls.auditInserts).toHaveLength(0);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("ABOVE the ceiling: a manager is refused with the rule and the number in words", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 1001 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // Nothing was sealed.
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
    // The order is parked where the row itself says it is waiting.
    expect(calls.orderUpdates.some((u) => u.status === "APPROVAL_NEEDED")).toBe(true);
  });

  it("ABOVE the ceiling: the OWNER seals the same order", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 1001 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("owner"));

    await svc.approveOrder(REST, ORDER, USER);

    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
    expect(calls.auditInserts).toHaveLength(0);
  });

  it("the refusal message carries the whole sentence, not a code", async () => {
    const { db } = makeDb({ order: { ...ORDER_ROW, total_cost: 5000 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /over the 1000 ceiling this house set for a manager/,
    );
    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /waits for an owner to seal it/,
    );
  });
});

describe("approveOrder — an unknown fact never fires a rule", () => {
  it("a first-order count that ERRORS is not read as 'first order'", async () => {
    // `new_vendor` is the only enabled rule and the count read fails. If `null`
    // were read as `false` the order would seal (wrong for a different reason);
    // if it were read as `true` a database outage would refuse every order.
    // `decideApproval` marks it untestable, so the seal goes through.
    const { db, calls } = makeDb({
      order: ORDER_ROW,
      countErrors: true,
    });
    const svc = service(db, thresholdsStub([newVendorRule()]), orgsStub("manager"));

    await svc.approveOrder(REST, ORDER, USER);

    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("a genuine first order to a vendor DOES fire new_vendor", async () => {
    const { db, calls } = makeDb({ order: ORDER_ROW, priorOrdersToVendor: 0 });
    const svc = service(db, thresholdsStub([newVendorRule()]), orgsStub("manager"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /first order this house has placed with this vendor/,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });

  it("a vendor already ordered from does NOT fire new_vendor", async () => {
    const { db, calls } = makeDb({ order: ORDER_ROW, priorOrdersToVendor: 3 });
    const svc = service(db, thresholdsStub([newVendorRule()]), orgsStub("manager"));

    await svc.approveOrder(REST, ORDER, USER);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });
});

describe("approveOrder — a house with no policy, and a policy that cannot be read", () => {
  it("NO rule at all: seals exactly as before", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 999999 } });
    const svc = service(db, thresholdsStub([]), orgsStub("staff"));

    await svc.approveOrder(REST, ORDER, USER);

    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
    expect(calls.auditInserts).toHaveLength(0);
  });

  it("an UNREADABLE policy refuses — silence is not permission", async () => {
    const { db, calls } = makeDb({ order: ORDER_ROW });
    const svc = service(
      db,
      thresholdsStub([], { readable: false, reason: "the table is not present" }),
      orgsStub("owner"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /could not be read.*not a rule that does not exist/s,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });

  it("a missing order is a 404 with a sentence, not a PostgREST error", async () => {
    const { db } = makeDb({ order: null });
    const svc = service(db, thresholdsStub([]), orgsStub("owner"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("the gate REFUSES when its own dependency is missing", async () => {
    // Unreachable in the running gateway (ProcurementModule imports both
    // modules). It is asserted so a future wiring mistake cannot make the gate
    // open by default.
    const { db, calls } = makeDb({ order: ORDER_ROW });
    const svc = service(db);

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /thresholds service is not wired into procurement/,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });
});

describe("approveOrder — the refusal is filed", () => {
  it("writes one system_audit_log row naming the rule, the roles and the amount", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 7500 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(calls.auditInserts).toHaveLength(1);
    const row = calls.auditInserts[0];
    expect(row.action).toBe("order_approval_refused");
    expect(row.actor_type).toBe("user");
    // public.users.user_id, from the request. Never an auth.users id — the two
    // are disjoint and system_audit_log.actor_id has no FK to catch it.
    expect(row.actor_id).toBe(USER);
    expect(row.entity_type).toBe("procurement_order");
    expect(row.entity_id).toBe(ORDER);
    expect(row.restaurant_id).toBe(REST);
    expect(row.changes.requiredRole).toBe("owner");
    expect(row.changes.actorRole).toBe("manager");
    expect(row.changes.firedBy).toEqual(["manager_ceiling"]);
    expect(row.changes.total).toBe(7500);
    expect(row.reason).toContain("1000 ceiling");
  });

  it("an audit row that FAILS to write does not turn the 403 into a 500", async () => {
    const { db } = makeDb({ order: { ...ORDER_ROW, total_cost: 7500 }, auditFails: true });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("approvalGate — what the page is allowed to draw", () => {
  it("marks each pending order with the role it needs and whether the caller has it", async () => {
    const { db } = makeDb({
      ledgerRows: [
        { id: "o-small", status: "PENDING", provider_id: "p1", inventory_id: null, total_cost: 100, final_price: null },
        { id: "o-big", status: "PENDING", provider_id: "p1", inventory_id: null, total_cost: 9000, final_price: null },
        { id: "o-done", status: "DELIVERED", provider_id: "p1", inventory_id: null, total_cost: 9000, final_price: null },
      ],
    });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("manager"));

    const gate = await svc.approvalGate(REST, USER);

    expect(gate.readable).toBe(true);
    expect(gate.callerRole).toBe("manager");
    expect(gate.policySet).toBe(true);
    // Only orders still waiting for a signature are listed.
    expect(gate.orders.map((o) => o.orderId).sort()).toEqual(["o-big", "o-small"]);

    const small = gate.orders.find((o) => o.orderId === "o-small")!;
    expect(small.mayApprove).toBe(true);
    expect(small.sentence).toBeNull();

    const big = gate.orders.find((o) => o.orderId === "o-big")!;
    expect(big.mayApprove).toBe(false);
    expect(big.requiredRole).toBe("owner");
    expect(big.sentence).toContain("1000 ceiling");
  });

  it("an unreadable ledger says so and lists NOTHING — never an empty book", async () => {
    const { db } = makeDb({ ledgerError: { message: "relation missing" } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("owner"));

    const gate = await svc.approvalGate(REST, USER);

    expect(gate.readable).toBe(false);
    expect(gate.reason).toBe("relation missing");
    expect(gate.orders).toEqual([]);
  });

  it("a house with no rule says 'no threshold is set for this house'", async () => {
    const { db } = makeDb({
      ledgerRows: [
        { id: "o1", status: "PENDING", provider_id: "p1", inventory_id: null, total_cost: 50000, final_price: null },
      ],
    });
    const svc = service(db, thresholdsStub([]), orgsStub("staff"));

    const gate = await svc.approvalGate(REST, USER);

    expect(gate.policySet).toBe(false);
    expect(gate.policyNote).toBe("no threshold is set for this house");
    expect(gate.orders[0].mayApprove).toBe(true);
  });
});
