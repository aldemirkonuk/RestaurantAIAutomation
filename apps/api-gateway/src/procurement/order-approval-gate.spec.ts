import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { ApprovalThresholdsService } from "../settings/approval-thresholds.service";
import { OrganizationsService } from "../organizations/organizations.service";
import {
  roleSatisfies,
  refusalSentence,
  policyNote,
} from "./order-approval-gate";
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
  /** The seals this harness has issued, and whether each was spent. */
  seals: Row[];
  /** `notifications` updates with their eq filters (F-526). */
  notificationUpdates: Array<{ payload: Row; filters: Row }>;
}

const REST = "rest-1";
const ORDER = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";

function ceiling(
  amount: number,
  requiredRole: "owner" | "manager" = "owner",
): ThresholdRow {
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
 * The facts builder reads each vendor with the house's orders to it embedded,
 * oldest first, for first-order-ness (F-731). `vendorOrders` are those rows as
 * written; `priorOrdersToVendor: n` is shorthand for n placed orders requested
 * before this one. `countErrors` makes that read fail so the "unknown is not
 * false" case can be driven. `priorPrices` are the item's earlier orders,
 * newest first, embedded behind the item the same way (F-449).
 */
function makeDb(opts: {
  order?: Row | null;
  orderReadError?: { message: string } | null;
  priorOrdersToVendor?: number;
  vendorOrders?: Row[];
  countErrors?: boolean;
  priorPrices?: Row[];
  ledgerRows?: Row[];
  ledgerError?: { message: string } | null;
  auditFails?: boolean;
  /** `restaurants.currency` — the currency the ceiling is in (F-648). */
  houseCurrency?: string | null;
}) {
  const calls: Calls = {
    orderUpdates: [],
    auditInserts: [],
    seals: [],
    notificationUpdates: [],
  };

  const supabase: any = {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select";
      // Filters the prior-price probe applies, honoured here so a stub row the
      // query would never return is not handed back (F-479).
      let statusIn: string[] | null = null;
      // The vendors or items a set read asks for (F-449).
      let inIds: string[] = [];
      let pricedOnly = false;

      const settle = (shape: "one" | "many") => {
        if (table === "restaurants") {
          return {
            data: { currency: opts.houseCurrency ?? null },
            error: null,
          };
        }
        if (table === "providers") {
          if (opts.countErrors)
            return { data: null, error: { message: "count failed" } };
          const prior = Array.from(
            { length: opts.priorOrdersToVendor ?? 0 },
            (_, i) => ({
              id: `prior-${i}`,
              status: "DELIVERED",
              requested_at: "2026-01-01T00:00:00Z",
              created_at: "2026-01-01T00:00:00Z",
            }),
          );
          return {
            data: inIds.map((id) => ({
              id,
              orders: [...prior, ...(opts.vendorOrders ?? [])],
            })),
            error: null,
          };
        }
        if (table === "restaurant_inventory") {
          return {
            data: inIds.map((id) => ({
              id,
              orders: (opts.priorPrices ?? [])
                .map((r, i): Row => ({ id: `prior-price-${i}`, ...r }))
                .filter(
                  (r) =>
                    (statusIn === null || statusIn.includes(r.status)) &&
                    (!pricedOnly || r.final_price !== null),
                )
                .slice(0, 2),
            })),
            error: null,
          };
        }
        if (table === "system_audit_log") {
          return {
            data: null,
            error: opts.auditFails
              ? { message: "audit table unreachable" }
              : null,
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
          if (shape === "one") {
            if (opts.orderReadError)
              return { data: null, error: opts.orderReadError };
            return { data: opts.order ?? null, error: null };
          }
          if (opts.ledgerError) return { data: null, error: opts.ledgerError };
          return { data: opts.ledgerRows ?? [], error: null };
        }
        return { data: shape === "many" ? [] : null, error: null };
      };

      // ── The seal challenges (founder, 2026-09-04) ───────────────────────
      // A tiny in-memory table rather than the generic stub, because "exactly
      // once" is a property of the redeeming UPDATE's own `redeemed_at IS NULL`
      // filter and a stub that always answers `{data:null}` cannot express it.
      if (table === "mcp_seal_challenges") {
        const api: any = {};
        let tokenHash: string | null = null;
        let rowId: string | null = null;
        api.select = () => api;
        api.eq = (col: string, value: string) => {
          if (col === "token_hash") tokenHash = value;
          if (col === "id") rowId = value;
          return api;
        };
        api.maybeSingle = async () => ({
          data:
            calls.seals.find((sl: Row) => sl.token_hash === tokenHash) ?? null,
          error: null,
        });
        api.insert = (row: Row) => {
          calls.seals.push({ id: `seal-${calls.seals.length + 1}`, ...row });
          return Promise.resolve({ error: null });
        };
        api.update = (patch: Row) => {
          const upd: any = {};
          let unspentOnly = false;
          upd.eq = (col: string, value: string) => {
            if (col === "id") rowId = value;
            return upd;
          };
          upd.is = (col: string, value: unknown) => {
            if (col === "redeemed_at" && value === null) unspentOnly = true;
            return upd;
          };
          upd.select = () => ({
            then: (res: any) => {
              const row = calls.seals.find((sl: Row) => sl.id === rowId);
              if (!row || (unspentOnly && row.redeemed_at)) {
                return Promise.resolve({ data: [], error: null }).then(res);
              }
              row.redeemed_at = String(patch.redeemed_at);
              return Promise.resolve({
                data: [{ id: row.id }],
                error: null,
              }).then(res);
            },
          });
          return upd;
        };
        return api;
      }

      const filters: Row = {};
      const q: any = {
        select: () => q,
        eq: (col: string, value: unknown) => {
          filters[col] = value;
          return q;
        },
        neq: () => q,
        in: (col: string, values: string[]) => {
          if (col === "id") inIds = values;
          if (col === "orders.status") statusIn = values;
          return q;
        },
        not: (col: string, op: string, value: unknown) => {
          if (col === "orders.final_price" && op === "is" && value === null)
            pricedOnly = true;
          return q;
        },
        gte: () => q,
        gt: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        update(payload: Row) {
          op = "update";
          if (table === "notifications") {
            calls.notificationUpdates.push({ payload, filters });
            return q;
          }
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

const events = {
  createEvent: jest.fn().mockResolvedValue({}),
} as unknown as EventsService;
const ledger = {
  recordTransaction: jest.fn().mockResolvedValue({}),
} as unknown as InventoryLedgerService;

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
    // The seal (founder, 2026-09-04). Supplied here rather than left undefined
    // because `approveOrder` REFUSES when it is missing — a gate spec running
    // against an unwired seal would be testing the refusal, not the gate.
    new SealChallengeService(db),
  );
}

/**
 * Seal an order the way the page does: begin the hold (mint), then approve
 * carrying what it minted.
 *
 * Every APPROVING case below goes through this. The refusing cases still call
 * `approveOrder` directly with no seal, and still fail for the reason they were
 * written for, because `assertApprovalAllowed` runs BEFORE the redemption —
 * that ordering is itself asserted in `order-seal.spec.ts`.
 */
async function sealedApprove(svc: ProcurementService) {
  const issued = await svc.issueOrderSealChallenge(REST, ORDER, USER);
  return svc.approveOrder(REST, ORDER, USER, issued.challenge);
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
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);

    expect(calls.auditInserts).toHaveLength(0);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("AT the ceiling: a manager seals it — a house that set 1000 allowed 1000", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 1000 } });
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);

    expect(calls.auditInserts).toHaveLength(0);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("ABOVE the ceiling: a manager is refused with the rule and the number in words", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 1001 } });
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    // Nothing was sealed.
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
    // The order is parked where the row itself says it is waiting.
    expect(calls.orderUpdates.some((u) => u.status === "APPROVAL_NEEDED")).toBe(
      true,
    );
  });

  it("ABOVE the ceiling: the OWNER seals the same order", async () => {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 1001 } });
    const svc = service(db, thresholdsStub([ceiling(1000)]), orgsStub("owner"));

    await sealedApprove(svc);

    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
    expect(calls.auditInserts).toHaveLength(0);
  });

  it("the refusal message carries the whole sentence, not a code", async () => {
    const { db } = makeDb({ order: { ...ORDER_ROW, total_cost: 5000 } });
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /over the 1000 ceiling this house set for a manager/,
    );
    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /waits for an owner to seal it/,
    );
  });
});

function priceJump(percent: number): ThresholdRow {
  return {
    rule: "price_jump",
    enabled: true,
    amountLimit: null,
    percentLimit: percent,
    requiredRole: "owner",
    setBy: null,
    updatedAt: null,
  };
}

describe("approveOrder — money is compared in one currency and one unit (F-648)", () => {
  it("[REVERT-FAILS] a GBP order under a USD ceiling is not sealed by a manager", async () => {
    const { db, calls } = makeDb({
      order: { ...ORDER_ROW, total_cost: 2400, currency: "GBP" },
      houseCurrency: "USD",
    });
    const svc = service(
      db,
      thresholdsStub([ceiling(2500)]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /in GBP, while the 2500 ceiling this house set for a manager is in USD/,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });

  it("an order in the house's own currency is tested against the ceiling as before", async () => {
    const { db, calls } = makeDb({
      order: { ...ORDER_ROW, total_cost: 2400, currency: "USD" },
      houseCurrency: "USD",
    });
    const svc = service(
      db,
      thresholdsStub([ceiling(2500)]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("[REVERT-FAILS] a bottle price is compared with last month's CASE price per bottle", async () => {
    // $420 per case of 12 is $35 a bottle; $38 a bottle today is +8.6%, over a
    // 5% limit. Divided raw it read -91% and never fired.
    const { db } = makeDb({
      order: { ...ORDER_ROW, final_price: 38, currency: "USD" },
      priorPrices: [
        {
          final_price: 420,
          status: "DELIVERED", // a price PAID is the comparison (F-479)
          currency: "USD",
          procurement_order_items: [{ price_uom: "case", price_pack_size: 12 }],
        },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([priceJump(5)]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /8\.6% above the last price this house paid/,
    );
  });

  it("[REVERT-FAILS] a routine case reorder is not read as a +1,000% jump", async () => {
    const { db, calls } = makeDb({
      order: {
        ...ORDER_ROW,
        final_price: 420,
        currency: "USD",
        procurement_order_items: [{ price_uom: "case", price_pack_size: 12 }],
      },
      priorPrices: [{ final_price: 35, currency: "USD" }],
    });
    const svc = service(
      db,
      thresholdsStub([priceJump(5)]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("a last price in another currency leaves price_jump untestable, not fired on a raw division", async () => {
    const { db, calls } = makeDb({
      order: { ...ORDER_ROW, final_price: 400, currency: "USD" },
      priorPrices: [{ final_price: 30, currency: "GBP" }],
    });
    const svc = service(
      db,
      thresholdsStub([priceJump(5)]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
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
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);

    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("a genuine first order to a vendor DOES fire new_vendor", async () => {
    const { db, calls } = makeDb({ order: ORDER_ROW, priorOrdersToVendor: 0 });
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /first order this house has placed with this vendor/,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });

  it("a vendor already ordered from does NOT fire new_vendor", async () => {
    const { db, calls } = makeDb({ order: ORDER_ROW, priorOrdersToVendor: 3 });
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });
});

describe("approveOrder — the first order to a vendor, one test everywhere (F-731)", () => {
  const AT = "2026-10-01T10:00:00Z";
  const FIRST_LINE = { ...ORDER_ROW, requested_at: AT, created_at: AT };

  it("[REVERT-FAILS] the earliest line of a first cart is held although its sibling exists", async () => {
    // /orders posts one order per cart line. The sibling used to make the
    // vendor "known", so no line of a first cart was ever held.
    const { db, calls } = makeDb({
      order: FIRST_LINE,
      vendorOrders: [
        { id: ORDER, status: "PENDING", requested_at: AT, created_at: AT },
        {
          id: "99999999-9999-4999-8999-999999999999",
          status: "PENDING",
          requested_at: AT,
          created_at: "2026-10-01T10:00:01Z",
        },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /first order this house has placed with this vendor/,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });

  it("[REVERT-FAILS] a cancelled earlier order does not make the vendor known", async () => {
    const { db } = makeDb({
      order: FIRST_LINE,
      vendorOrders: [
        {
          id: "o-cancelled",
          status: "CANCELLED",
          requested_at: "2026-09-01T00:00:00Z",
          created_at: "2026-09-01T00:00:00Z",
        },
        {
          id: "o-rejected",
          status: "rejected",
          requested_at: "2026-09-02T00:00:00Z",
          created_at: "2026-09-02T00:00:00Z",
        },
        { id: ORDER, status: "PENDING", requested_at: AT, created_at: AT },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /first order this house has placed with this vendor/,
    );
  });

  it("the later line of the same cart is not first — only the earliest is held", async () => {
    const LATER = {
      ...ORDER_ROW,
      requested_at: AT,
      created_at: "2026-10-01T10:00:01Z",
    };
    const { db, calls } = makeDb({
      order: LATER,
      vendorOrders: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          status: "PENDING",
          requested_at: AT,
          created_at: AT,
        },
        {
          id: ORDER,
          status: "PENDING",
          requested_at: AT,
          created_at: LATER.created_at,
        },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("[REVERT-FAILS] the /orders walk marks the same line the gate holds", async () => {
    const ledgerRows = [
      {
        id: "o-cancelled",
        status: "CANCELLED",
        provider_id: "p1",
        inventory_id: null,
        requested_at: "2026-09-01T00:00:00Z",
        created_at: "2026-09-01T00:00:00Z",
        total_cost: 10,
        final_price: null,
      },
      {
        id: "o-b",
        status: "PENDING",
        provider_id: "p1",
        inventory_id: null,
        requested_at: AT,
        created_at: AT,
        total_cost: 10,
        final_price: null,
      },
      {
        id: "o-a",
        status: "PENDING",
        provider_id: "p1",
        inventory_id: null,
        requested_at: AT,
        created_at: AT,
        total_cost: 10,
        final_price: null,
      },
    ];
    // The walk reads the pending orders whole (ADR 0292, F-331) and asks each
    // one's vendor history with the gate's own probe, so the probe is fed the
    // same ledger the database would hand it.
    const { db } = makeDb({
      ledgerRows,
      vendorOrders: ledgerRows.map(
        ({ id, status, requested_at, created_at }) => ({
          id,
          status,
          requested_at,
          created_at,
        }),
      ),
    });
    const svc = service(
      db,
      thresholdsStub([newVendorRule()]),
      orgsStub("manager"),
    );

    const gate = await svc.approvalGate(REST, USER);
    const held = gate.orders.filter((o) => !o.mayApprove).map((o) => o.orderId);
    // Same time, same created_at: the smaller id is the earlier line.
    expect(held).toEqual(["o-a"]);
  });
});

describe("approveOrder — price_jump compares against the last price PAID (F-479)", () => {
  function priceJumpRule(percent: number): ThresholdRow {
    return {
      rule: "price_jump",
      enabled: true,
      amountLimit: null,
      percentLimit: percent,
      requiredRole: "owner",
      setBy: null,
      updatedAt: null,
    };
  }

  it("a CANCELLED cheap order newer than the last delivery does not make a normal reorder a jump", async () => {
    // Newest first, as the probe orders them. The cancelled draft at 200 would
    // make 400 a 100% jump; the last price actually paid was 390.
    const { db, calls } = makeDb({
      order: ORDER_ROW,
      priorOrdersToVendor: 3,
      priorPrices: [
        { final_price: 200, status: "CANCELLED", requested_at: "2026-10-01" },
        { final_price: 390, status: "DELIVERED", requested_at: "2026-09-01" },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([priceJumpRule(20)]),
      orgsStub("manager"),
    );

    await sealedApprove(svc);
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
  });

  it("a newer UNPRICED or pending order does not hide a real jump over the last price paid", async () => {
    const { db, calls } = makeDb({
      order: ORDER_ROW,
      priorOrdersToVendor: 3,
      priorPrices: [
        { final_price: null, status: "PENDING", requested_at: "2026-10-02" },
        { final_price: 420, status: "PENDING", requested_at: "2026-10-01" },
        { final_price: 250, status: "COMPLETED", requested_at: "2026-09-01" },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([priceJumpRule(20)]),
      orgsStub("manager"),
    );

    // 400 over the 250 paid is 60% — the rule names the jump, not the seal.
    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toThrow(
      /60\.0% above the last price this house paid/,
    );
    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(false);
  });
});

describe("approveOrder — a house with no policy, and a policy that cannot be read", () => {
  it("NO rule at all: seals exactly as before", async () => {
    const { db, calls } = makeDb({
      order: { ...ORDER_ROW, total_cost: 999999 },
    });
    const svc = service(db, thresholdsStub([]), orgsStub("staff"));

    await sealedApprove(svc);

    expect(calls.orderUpdates.some((u) => u.status === "APPROVED")).toBe(true);
    expect(calls.auditInserts).toHaveLength(0);
  });

  it("an UNREADABLE policy refuses — silence is not permission", async () => {
    const { db, calls } = makeDb({ order: ORDER_ROW });
    const svc = service(
      db,
      thresholdsStub([], {
        readable: false,
        reason: "the table is not present",
      }),
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
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

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
    const { db } = makeDb({
      order: { ...ORDER_ROW, total_cost: 7500 },
      auditFails: true,
    });
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe("approvalGate — what the page is allowed to draw", () => {
  it("marks each pending order with the role it needs and whether the caller has it", async () => {
    const { db } = makeDb({
      ledgerRows: [
        {
          id: "o-small",
          status: "PENDING",
          provider_id: "p1",
          inventory_id: null,
          total_cost: 100,
          final_price: null,
        },
        {
          id: "o-big",
          status: "PENDING",
          provider_id: "p1",
          inventory_id: null,
          total_cost: 9000,
          final_price: null,
        },
        {
          id: "o-done",
          status: "DELIVERED",
          provider_id: "p1",
          inventory_id: null,
          total_cost: 9000,
          final_price: null,
        },
      ],
    });
    const svc = service(
      db,
      thresholdsStub([ceiling(1000)]),
      orgsStub("manager"),
    );

    const gate = await svc.approvalGate(REST, USER);

    expect(gate.readable).toBe(true);
    expect(gate.callerRole).toBe("manager");
    expect(gate.policySet).toBe(true);
    // Only orders still waiting for a signature are listed.
    expect(gate.orders.map((o) => o.orderId).sort()).toEqual([
      "o-big",
      "o-small",
    ]);

    const small = gate.orders.find((o) => o.orderId === "o-small")!;
    expect(small.mayApprove).toBe(true);
    expect(small.sentence).toBeNull();

    const big = gate.orders.find((o) => o.orderId === "o-big")!;
    expect(big.mayApprove).toBe(false);
    expect(big.requiredRole).toBe("owner");
    expect(big.sentence).toContain("1000 ceiling");
  });

  it("a CANCELLED cheaper order is not the price a pending order is measured against (F-479)", async () => {
    const jump: ThresholdRow = {
      rule: "price_jump",
      enabled: true,
      amountLimit: null,
      percentLimit: 20,
      requiredRole: "owner",
      setBy: null,
      updatedAt: null,
    };
    const { db } = makeDb({
      // Oldest first, as the walk reads them.
      ledgerRows: [
        {
          id: "o-paid",
          status: "DELIVERED",
          provider_id: "p1",
          inventory_id: "inv-1",
          total_cost: 390,
          final_price: 390,
        },
        {
          id: "o-void",
          status: "CANCELLED",
          provider_id: "p1",
          inventory_id: "inv-1",
          total_cost: 200,
          final_price: 200,
        },
        {
          id: "o-now",
          status: "PENDING",
          provider_id: "p1",
          inventory_id: "inv-1",
          total_cost: 400,
          final_price: 400,
        },
      ],
    });
    const svc = service(db, thresholdsStub([jump]), orgsStub("manager"));

    const gate = await svc.approvalGate(REST, USER);

    const now = gate.orders.find((o) => o.orderId === "o-now")!;
    expect(now.mayApprove).toBe(true);
    expect(now.sentence).toBeNull();
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
        {
          id: "o1",
          status: "PENDING",
          provider_id: "p1",
          inventory_id: null,
          total_cost: 50000,
          final_price: null,
        },
      ],
    });
    const svc = service(db, thresholdsStub([]), orgsStub("staff"));

    const gate = await svc.approvalGate(REST, USER);

    expect(gate.policySet).toBe(false);
    expect(gate.policyNote).toBe("no threshold is set for this house");
    expect(gate.orders[0].mayApprove).toBe(true);
  });
});

describe("approveOrder — the people who may seal a parked order are told (F-527)", () => {
  const OWNER = "owner-1";
  const MANAGER = "manager-1";
  function told(role: string | null, rule = ceiling(1000)) {
    const { db, calls } = makeDb({ order: { ...ORDER_ROW, total_cost: 7500 } });
    const notifications = {
      persistForRestaurant: jest
        .fn()
        .mockResolvedValue({ inserted: 1, ids: ["n1"] }),
    };
    const authority = {
      ownersAndManagers: jest
        .fn()
        .mockResolvedValue({ owners: [OWNER], managers: [MANAGER, USER] }),
      namesOf: jest.fn().mockResolvedValue(new Map([[USER, "Selin"]])),
    };
    const svc = new ProcurementService(
      db,
      events,
      ledger,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      notifications as any,
      thresholdsStub([rule]),
      orgsStub(role),
      new SealChallengeService(db),
      authority as any,
    );
    return { svc, calls, notifications };
  }

  it("a manager refused by an owner's ceiling: the owners get one line naming the order, once per order", async () => {
    const { svc, notifications } = told("manager");

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const [rest, payload, opts] =
      notifications.persistForRestaurant.mock.calls[0];
    expect(rest).toBe(REST);
    // `order_pending` + `metadata.orderId` is what lights the bell's "Approve it".
    expect(payload.type).toBe("order_pending");
    expect(payload.metadata).toEqual({ orderId: ORDER, requiredRole: "owner" });
    expect(payload.title).toBe("ORD-2026-00001 waits for your seal");
    expect(payload.message).toContain("Selin tried to approve ORD-2026-00001");
    expect(payload.message).not.toMatch(/7500|7,500|\$/);
    expect(payload.priority).toBe("high");
    expect(payload.groupKey).toBe(`order_awaiting_seal:${ORDER}`);
    // Owners only, for an owner's rule; the refused manager is never told about themself.
    expect(opts.onlyUserIds).toEqual([OWNER]);
    expect(opts.dedupeWithinMinutes).toBeGreaterThanOrEqual(365 * 24 * 60);
  });

  it("a staff member refused by a manager's rule: owners and managers are told", async () => {
    const { svc, notifications } = told("staff", ceiling(1000, "manager"));

    await expect(svc.approveOrder(REST, ORDER, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const [, , opts] = notifications.persistForRestaurant.mock.calls[0];
    expect(opts.onlyUserIds).toEqual([OWNER, MANAGER]);
  });

  it("the owner's seal clears the waiting line for everyone it went to", async () => {
    const { svc, calls, notifications } = told("owner");

    await sealedApprove(svc);

    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(calls.notificationUpdates).toContainEqual({
      payload: expect.objectContaining({ status: "read" }),
      filters: expect.objectContaining({
        restaurant_id: REST,
        group_key: `order_awaiting_seal:${ORDER}`,
        status: "unread",
      }),
    });
  });
});
