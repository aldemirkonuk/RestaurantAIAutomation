import { ForbiddenException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import type { ApprovalThresholdsService } from "../settings/approval-thresholds.service";
import type { OrganizationsService } from "../organizations/organizations.service";
import type { ThresholdRow } from "../settings/approval-thresholds";
import {
  flaggedFirst,
  itemRunningOut,
  pendingOrderPriority,
} from "./pending-order-priority";

/**
 * "Waiting on you": oldest first, flagged first (ADR 0256, founder 2026-10-01).
 *
 * WHAT THIS SUITE PINS
 *  * The queue is read OLDEST first, and flagged rows move to the top without
 *    reordering either group. The fake honours the read's `.order(...)`, so
 *    flipping it to descending changes the answer, not just a recorded call.
 *  * Each reason, from the house's own rules (`decideApproval`) and the
 *    house's own stock predicate (`isBelowPar`) — and that a DISABLED rule
 *    raises nothing.
 *  * An unreadable rule, price or stock read is `unknown`, never "not flagged",
 *    and never fails the queue.
 *  * A reason is a word. No figure travels with it.
 *  * The flag and the approve gate cannot disagree: the same order, the same
 *    rules, the same facts — the gate refuses a manager on a price jump and the
 *    queue flags the same price jump.
 */

type Row = Record<string, any>;

const REST = "rest-1";
const USER = "22222222-2222-4222-8222-222222222222";

interface DbOpts {
  pending?: Row[];
  /** `count` on the gate's first-order-to-vendor probe, or a failed read. */
  priorOrdersToVendor?: number | "error";
  /** `final_price` of the last other order for the item, none, or a failed read. */
  priorPrice?: number | null | "error";
}

function makeDb(opts: DbOpts) {
  const log = {
    listOrder: [] as Array<[string, { ascending?: boolean } | undefined]>,
    listSelects: [] as string[],
    priceReads: 0,
    countReads: 0,
  };
  const supabase: any = {
    from(table: string) {
      let cols = "";
      let head = false;
      let op: "select" | "update" | "insert" = "select";
      let id: string | null = null;
      const orders: Array<[string, { ascending?: boolean } | undefined]> = [];

      const settle = (shape: "one" | "many") => {
        if (table !== "procurement_orders" || op !== "select") {
          return { data: null, error: null };
        }
        if (head) {
          log.countReads += 1;
          return opts.priorOrdersToVendor === "error"
            ? { data: null, count: null, error: { message: "count failed" } }
            : { data: null, count: opts.priorOrdersToVendor ?? 1, error: null };
        }
        if (cols.startsWith("final_price")) {
          log.priceReads += 1;
          if (opts.priorPrice === "error") {
            return { data: null, error: { message: "statement timeout" } };
          }
          return {
            data:
              opts.priorPrice == null ? [] : [{ final_price: opts.priorPrice }],
            error: null,
          };
        }
        if (shape === "one") {
          return {
            data: (opts.pending ?? []).find((r) => r.id === id) ?? null,
            error: null,
          };
        }
        // The pending list: honour the read's own ordering, as Postgres would.
        const rows = [...(opts.pending ?? [])];
        for (const [col, o] of [...orders].reverse()) {
          rows.sort((a, b) => {
            const x = String(a[col]);
            const y = String(b[col]);
            const c = x < y ? -1 : x > y ? 1 : 0;
            return o?.ascending === false ? -c : c;
          });
        }
        return { data: rows, error: null };
      };

      const q: any = {
        select(c?: string, o?: { head?: boolean }) {
          cols = c ?? "";
          head = Boolean(o?.head);
          if (table === "procurement_orders" && cols.startsWith("*")) {
            log.listSelects.push(cols);
          }
          return q;
        },
        eq(col: string, v: string) {
          if (col === "id") id = v;
          return q;
        },
        neq: () => q,
        in: () => q,
        gte: () => q,
        limit: () => q,
        order(col: string, o?: { ascending?: boolean }) {
          orders.push([col, o]);
          if (table === "procurement_orders" && cols.startsWith("*")) {
            log.listOrder.push([col, o]);
          }
          return q;
        },
        update() {
          op = "update";
          return q;
        },
        insert() {
          op = "insert";
          return q;
        },
        maybeSingle: async () => settle("one"),
        single: async () => settle("one"),
        then: (res: any, rej: any) =>
          Promise.resolve(settle("many")).then(res, rej),
      };
      return q;
    },
  };
  return { db: { supabase } as unknown as DatabaseService, log };
}

function rule(
  r: ThresholdRow["rule"],
  over: Partial<ThresholdRow> = {},
): ThresholdRow {
  return {
    rule: r,
    enabled: true,
    amountLimit: r === "manager_ceiling" ? 500 : null,
    percentLimit: r === "price_jump" ? 20 : null,
    requiredRole: "owner",
    setBy: null,
    updatedAt: null,
    ...over,
  };
}

function thresholds(rules: ThresholdRow[] | "unreadable" | "throws") {
  return {
    read: jest.fn(async () => {
      if (rules === "throws") throw new Error("thresholds exploded");
      if (rules === "unreadable") {
        return { readable: false, reason: "relation missing", thresholds: [] };
      }
      return { readable: true, reason: null, thresholds: rules };
    }),
  } as unknown as ApprovalThresholdsService;
}

function service(
  db: DatabaseService,
  t?: ApprovalThresholdsService,
  orgs?: OrganizationsService,
) {
  return new ProcurementService(
    db,
    { emit: jest.fn() } as unknown as EventsService,
    {} as unknown as InventoryLedgerService,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    t,
    orgs,
  );
}

/** One pending row as PostgREST hands it back, with the stock join. */
function row(id: string, day: number, over: Row = {}): Row {
  const at = `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;
  return {
    id,
    order_number: `ORD-${id}`,
    restaurant_id: REST,
    inventory_id: `inv-${id}`,
    provider_id: "prov-1",
    quantity: 2,
    unit_type: "bottle",
    bottles_total: 2,
    final_price: 100,
    total_cost: 200,
    status: "PENDING",
    requested_at: at,
    created_at: at,
    inventory: { wine_name: `Wine ${id}`, stock_live: 20, threshold_min: 5 },
    provider: { name: "Vinifera Imports" },
    ...over,
  };
}

async function list(
  opts: DbOpts,
  rules: ThresholdRow[] | "unreadable" | "throws" | null = [],
) {
  const { db, log } = makeDb(opts);
  const out = await service(
    db,
    rules === null ? undefined : thresholds(rules),
  ).listPendingOrders(REST);
  return { out, log };
}

const byId = (out: any[], id: string) => out.find((o) => o.id === id)!.priority;

describe("the pending queue is oldest first, flagged first", () => {
  it("reads oldest first and keeps that order when nothing is flagged", async () => {
    const { out, log } = await list({
      pending: [row("c", 3), row("a", 1), row("b", 2)],
    });
    expect(log.listOrder[0]).toEqual(["created_at", { ascending: true }]);
    expect(out.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(out.every((o) => o.priority.flagged === false)).toBe(true);
  });

  it("puts flagged rows first, oldest first among them, then the rest oldest first", async () => {
    const { out } = await list(
      {
        pending: [
          row("d", 4, { total_cost: 900 }),
          row("c", 3),
          row("b", 2, {
            inventory: { wine_name: "B", stock_live: 0, threshold_min: 5 },
          }),
          row("a", 1),
        ],
      },
      [rule("manager_ceiling")],
    );
    expect(out.map((o) => o.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("still joins the vendor, and does not send the stock join", async () => {
    const { out, log } = await list({ pending: [row("a", 1)] });
    expect(log.listSelects[0]).toContain("provider:provider_id(name)");
    expect(log.listSelects[0]).toContain(
      "inventory:inventory_id(wine_name, stock_live, threshold_min)",
    );
    expect(out[0].providerName).toBe("Vinifera Imports");
    expect(out[0]).not.toHaveProperty("inventory");
    expect(JSON.stringify(out[0])).not.toContain("stock_live");
  });
});

describe("each reason comes from the house's own rule or predicate", () => {
  it("price_jump: over the house's percent above the last price paid", async () => {
    const over = await list(
      { pending: [row("a", 1, { final_price: 130 })], priorPrice: 100 },
      [rule("price_jump")],
    );
    expect(byId(over.out, "a")).toEqual({
      flagged: true,
      reasons: ["price_jump", "needs_signature"],
      unknown: [],
    });

    const under = await list(
      { pending: [row("a", 1, { final_price: 118 })], priorPrice: 100 },
      [rule("price_jump")],
    );
    expect(byId(under.out, "a").flagged).toBe(false);
  });

  it("manager_ceiling: over the amount the house set", async () => {
    const over = await list({ pending: [row("a", 1, { total_cost: 501 })] }, [
      rule("manager_ceiling"),
    ]);
    expect(byId(over.out, "a").reasons).toEqual([
      "needs_signature",
      "manager_ceiling",
    ]);

    const at = await list({ pending: [row("a", 1, { total_cost: 500 })] }, [
      rule("manager_ceiling"),
    ]);
    expect(byId(at.out, "a").flagged).toBe(false);
  });

  it("needs_signature: a row parked in APPROVAL_NEEDED, with no rule at all", async () => {
    const { out } = await list(
      { pending: [row("a", 1, { status: "APPROVAL_NEEDED" })] },
      [],
    );
    expect(byId(out, "a")).toEqual({
      flagged: true,
      reasons: ["needs_signature"],
      unknown: [],
    });
  });

  it("needs_signature: any house rule fired, including new_vendor", async () => {
    const { out } = await list(
      { pending: [row("a", 1)], priorOrdersToVendor: 0 },
      [rule("new_vendor")],
    );
    expect(byId(out, "a").reasons).toEqual(["needs_signature"]);
  });

  it.each([
    ["out of stock", 0, 5, true],
    ["out of stock with no minimum set", 0, 0, true],
    ["below its minimum", 4, 5, true],
    ["exactly at its minimum", 5, 5, false],
    ["above its minimum", 6, 5, false],
    ["in stock with no minimum set", 4, 0, false],
  ])("running_out: %s", async (_label, stock, par, flagged) => {
    const { out } = await list({
      pending: [
        row("a", 1, {
          inventory: { wine_name: "A", stock_live: stock, threshold_min: par },
        }),
      ],
    });
    expect(byId(out, "a").reasons.includes("running_out")).toBe(flagged);
    expect(byId(out, "a").unknown).toEqual([]);
  });

  it("lists every reason that applies, in the founder's order", async () => {
    const { out } = await list(
      {
        pending: [
          row("a", 1, {
            final_price: 200,
            total_cost: 4000,
            inventory: { wine_name: "A", stock_live: 0, threshold_min: 5 },
          }),
        ],
        priorPrice: 100,
      },
      [rule("price_jump"), rule("manager_ceiling")],
    );
    expect(byId(out, "a").reasons).toEqual([
      "price_jump",
      "needs_signature",
      "manager_ceiling",
      "running_out",
    ]);
  });
});

describe("a disabled rule raises no flag", () => {
  it("price_jump, manager_ceiling and new_vendor switched off raise nothing and read nothing", async () => {
    const { out, log } = await list(
      {
        pending: [row("a", 1, { final_price: 300, total_cost: 9000 })],
        priorPrice: 100,
        priorOrdersToVendor: 0,
      },
      [
        rule("price_jump", { enabled: false }),
        rule("manager_ceiling", { enabled: false }),
        rule("new_vendor", { enabled: false }),
      ],
    );
    expect(byId(out, "a")).toEqual({
      flagged: false,
      reasons: [],
      unknown: [],
    });
    expect(log.priceReads).toBe(0);
    expect(log.countReads).toBe(0);
  });

  it("a disabled price_jump is not unknown when its price read would fail", async () => {
    const { out } = await list(
      { pending: [row("a", 1)], priorPrice: "error" },
      [rule("price_jump", { enabled: false }), rule("manager_ceiling")],
    );
    expect(byId(out, "a")).toEqual({
      flagged: false,
      reasons: [],
      unknown: [],
    });
  });
});

describe("an unreadable read is unknown, never 'not flagged'", () => {
  it.each([
    ["the rules could not be read", "unreadable" as const],
    ["the rules read threw", "throws" as const],
    ["the rules service is not wired", null],
  ])(
    "%s: the rule reasons are unknown and the queue still answers",
    async (_l, rules) => {
      const { out } = await list({ pending: [row("a", 1)] }, rules);
      expect(out).toHaveLength(1);
      expect(byId(out, "a")).toEqual({
        flagged: false,
        reasons: [],
        unknown: ["price_jump", "needs_signature", "manager_ceiling"],
      });
    },
  );

  it("a parked row still needs a signature when the rules cannot be read", async () => {
    const { out } = await list(
      { pending: [row("a", 1, { status: "APPROVAL_NEEDED" })] },
      "unreadable",
    );
    expect(byId(out, "a")).toEqual({
      flagged: true,
      reasons: ["needs_signature"],
      unknown: ["price_jump", "manager_ceiling"],
    });
  });

  it("a failed last-price read is unknown, not 'the price did not jump'", async () => {
    const { out } = await list(
      { pending: [row("a", 1, { final_price: 300 })], priorPrice: "error" },
      [rule("price_jump")],
    );
    expect(byId(out, "a")).toEqual({
      flagged: false,
      reasons: [],
      unknown: ["price_jump", "needs_signature"],
    });
  });

  it("no earlier price is NOT unknown: there is nothing to compare", async () => {
    const { out } = await list({ pending: [row("a", 1)], priorPrice: null }, [
      rule("price_jump"),
    ]);
    expect(byId(out, "a")).toEqual({
      flagged: false,
      reasons: [],
      unknown: [],
    });
  });

  it("an order with no total cannot be tested against the ceiling", async () => {
    const { out } = await list(
      { pending: [row("a", 1, { total_cost: null })] },
      [rule("manager_ceiling")],
    );
    expect(byId(out, "a").unknown).toEqual([
      "needs_signature",
      "manager_ceiling",
    ]);
  });

  it("a failed first-order read leaves the signature unknown", async () => {
    const { out } = await list(
      { pending: [row("a", 1)], priorOrdersToVendor: "error" },
      [rule("new_vendor")],
    );
    expect(byId(out, "a")).toEqual({
      flagged: false,
      reasons: [],
      unknown: ["needs_signature"],
    });
  });

  it.each([
    ["no item joined", null],
    [
      "an item with no stock figure",
      { wine_name: "A", stock_live: null, threshold_min: 5 },
    ],
  ])("running_out is unknown with %s", async (_l, inventory) => {
    const { out } = await list({ pending: [row("a", 1, { inventory })] });
    expect(byId(out, "a").unknown).toEqual(["running_out"]);
  });

  it("an order with only unknowns sorts with the unflagged, oldest first", async () => {
    const { out } = await list({
      pending: [
        row("c", 3, {
          inventory: { wine_name: "C", stock_live: 0, threshold_min: 5 },
        }),
        row("b", 2),
        row("a", 1, { inventory: null }),
      ],
    });
    expect(out.map((o) => o.id)).toEqual(["c", "a", "b"]);
  });
});

describe("a reason is a word", () => {
  it("carries no amount, percent or count", async () => {
    const { out } = await list(
      {
        pending: [
          row("a", 1, {
            final_price: 250,
            total_cost: 7777,
            inventory: { wine_name: "A", stock_live: 1, threshold_min: 9 },
          }),
        ],
        priorPrice: 100,
      },
      [rule("price_jump"), rule("manager_ceiling")],
    );
    const p = byId(out, "a");
    expect(p.reasons.length).toBe(4);
    for (const r of [...p.reasons, ...p.unknown])
      expect(r).toMatch(/^[a-z_]+$/);
    expect(JSON.stringify(p)).not.toMatch(/\d/);
  });
});

describe("the flag and the approve gate read the same facts", () => {
  function orgs(role: string) {
    return {
      resolveRestaurantRole: jest.fn(async () => role),
    } as unknown as OrganizationsService;
  }

  it("a price jump the gate refuses a manager on is the price jump the queue flags", async () => {
    const pending = [row("a", 1, { final_price: 150 })];
    const rules = [rule("price_jump", { requiredRole: "owner" })];
    const { db } = makeDb({ pending, priorPrice: 100 });
    const svc = service(db, thresholds(rules), orgs("manager"));

    await expect(
      (svc as any).assertApprovalAllowed(REST, "a", USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const out = await svc.listPendingOrders(REST);
    expect(byId(out, "a").reasons).toContain("price_jump");
  });

  it("a price the gate lets a manager seal is not flagged as a jump", async () => {
    const pending = [row("a", 1, { final_price: 110 })];
    const rules = [rule("price_jump", { requiredRole: "owner" })];
    const { db } = makeDb({ pending, priorPrice: 100 });
    const svc = service(db, thresholds(rules), orgs("manager"));

    await expect(
      (svc as any).assertApprovalAllowed(REST, "a", USER),
    ).resolves.toBeUndefined();
    const out = await svc.listPendingOrders(REST);
    expect(byId(out, "a").reasons).not.toContain("price_jump");
  });
});

describe("the pure pieces", () => {
  it("flaggedFirst is stable within each group", () => {
    const f = { flagged: true, reasons: [], unknown: [] };
    const n = { flagged: false, reasons: [], unknown: [] };
    const rows = [
      { id: "1", priority: n },
      { id: "2", priority: f },
      { id: "3", priority: n },
      { id: "4", priority: f },
    ];
    expect(flaggedFirst(rows).map((r) => r.id)).toEqual(["2", "4", "1", "3"]);
  });

  it("itemRunningOut answers null, never false, when it has nothing to read", () => {
    expect(itemRunningOut(null)).toBeNull();
    expect(itemRunningOut({ stockLive: undefined, parLevel: 5 })).toBeNull();
    expect(
      itemRunningOut({ stockLive: "not a number", parLevel: 5 }),
    ).toBeNull();
  });

  it("an empty policy is a house with no rules, not an unreadable one", () => {
    expect(
      pendingOrderPriority({
        parked: false,
        policy: [],
        test: {
          total: 99999,
          isFirstOrderToVendor: true,
          pricePremiumPct: 500,
        },
        priceUnread: false,
        stock: { stockLive: 10, parLevel: 2 },
      }),
    ).toEqual({ flagged: false, reasons: [], unknown: [] });
  });
});
