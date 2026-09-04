import { Logger } from "@nestjs/common";
import {
  decideApproval,
  retrospective,
  type OrderUnderTest,
  type ThresholdRow,
} from "./approval-thresholds";
import {
  ApprovalThresholdsService,
  ENFORCED_AT,
} from "./approval-thresholds.service";

/**
 * The policy, and the three ways a threshold quietly stops meaning anything.
 *
 * 1. A rule fires on an UNKNOWN. "We could not tell whether this was a first
 *    order" must not become "it was", or a database hiccup escalates every
 *    order to the owner and people learn to route around the policy.
 * 2. The FIRST matching rule wins instead of the STRONGEST. An order that is
 *    both a first order to a vendor and over the ceiling must not get the
 *    weaker answer because of the order the rules happen to sit in.
 * 3. A house with no policy reads as a house that chose "unlimited". It did
 *    not; it chose nothing, and `policySet` is the difference.
 */

function row(p: Partial<ThresholdRow> & Pick<ThresholdRow, "rule">): ThresholdRow {
  return {
    enabled: true,
    amountLimit: null,
    percentLimit: null,
    requiredRole: "owner",
    setBy: null,
    updatedAt: null,
    ...p,
  };
}

function order(p: Partial<OrderUnderTest> = {}): OrderUnderTest {
  return { total: null, isFirstOrderToVendor: false, pricePremiumPct: null, ...p };
}

describe("decideApproval", () => {
  it("fires the ceiling only ABOVE the limit, never at it", () => {
    const policy = [row({ rule: "manager_ceiling", amountLimit: 15000 })];
    expect(decideApproval(policy, order({ total: 15000 })).requiredRole).toBeNull();
    expect(decideApproval(policy, order({ total: 15000.01 })).requiredRole).toBe("owner");
  });

  it("takes the STRONGEST role when two rules fire, not the first", () => {
    const policy = [
      row({ rule: "manager_ceiling", amountLimit: 100, requiredRole: "manager" }),
      row({ rule: "new_vendor", requiredRole: "owner" }),
    ];
    const d = decideApproval(
      policy,
      order({ total: 500, isFirstOrderToVendor: true }),
    );
    expect(d.requiredRole).toBe("owner");
    expect(d.firedBy).toEqual(["manager_ceiling", "new_vendor"]);
    expect(d.reasons).toHaveLength(2);
  });

  it("does NOT fire on an unknown — it reports the rule as untestable", () => {
    const policy = [row({ rule: "new_vendor" })];
    const d = decideApproval(policy, order({ isFirstOrderToVendor: null }));
    expect(d.requiredRole).toBeNull();
    expect(d.firedBy).toEqual([]);
    expect(d.untestable).toEqual(["new_vendor"]);
  });

  it("treats a total it cannot read as untestable rather than as under the ceiling", () => {
    const policy = [row({ rule: "manager_ceiling", amountLimit: 100 })];
    const d = decideApproval(policy, order({ total: null }));
    expect(d.untestable).toEqual(["manager_ceiling"]);
    expect(d.firedBy).toEqual([]);
  });

  it("ignores a disabled rule but keeps the house's policy non-empty", () => {
    const policy = [row({ rule: "manager_ceiling", amountLimit: 10, enabled: false })];
    const d = decideApproval(policy, order({ total: 9999 }));
    expect(d.requiredRole).toBeNull();
    // The house HAS a policy; it has switched this rule off.
    expect(d.policySet).toBe(true);
  });

  it("says a house with no rows has set no policy — which is not 'unlimited'", () => {
    const d = decideApproval([], order({ total: 9_000_000 }));
    expect(d.requiredRole).toBeNull();
    expect(d.policySet).toBe(false);
  });

  it("does not fire the price-jump rule when there is no earlier price at all", () => {
    const policy = [row({ rule: "price_jump", percentLimit: 12 })];
    const d = decideApproval(policy, order({ pricePremiumPct: null }));
    expect(d.firedBy).toEqual([]);
    // A first purchase has no premium; `new_vendor` is the rule that covers it.
    expect(d.untestable).toEqual([]);
  });

  it("fires the price-jump rule and says by how much", () => {
    const policy = [row({ rule: "price_jump", percentLimit: 12 })];
    const d = decideApproval(policy, order({ pricePremiumPct: 18.4 }));
    expect(d.firedBy).toEqual(["price_jump"]);
    expect(d.reasons[0]).toContain("18.4%");
  });
});

describe("retrospective", () => {
  it("counts what each rule WOULD have caught, and what it could test", () => {
    const policy = [
      row({ rule: "manager_ceiling", amountLimit: 1000 }),
      row({ rule: "new_vendor" }),
    ];
    const orders = [
      order({ total: 500, isFirstOrderToVendor: true }),
      order({ total: 5000, isFirstOrderToVendor: false }),
      order({ total: 900, isFirstOrderToVendor: false }),
      // Unreadable total: testable for new_vendor, not for the ceiling.
      order({ total: null, isFirstOrderToVendor: false }),
    ];
    const counts = retrospective(policy, orders);
    expect(counts).toContainEqual({ rule: "manager_ceiling", tested: 3, wouldHaveFired: 1 });
    expect(counts).toContainEqual({ rule: "new_vendor", tested: 4, wouldHaveFired: 1 });
    // A rule the house has not set is counted as tested against nothing.
    expect(counts).toContainEqual({ rule: "price_jump", tested: 0, wouldHaveFired: 0 });
  });

  it("counts a DISABLED rule as if it were on, because that is the question being asked", () => {
    const counts = retrospective(
      [row({ rule: "manager_ceiling", amountLimit: 100, enabled: false })],
      [order({ total: 500 })],
    );
    expect(counts[0]).toEqual({ rule: "manager_ceiling", tested: 1, wouldHaveFired: 1 });
  });
});

/* ── The service ─────────────────────────────────────────────────────────── */

function makeDb(
  rows: Record<string, unknown[]>,
  errors: Record<string, { message: string; code?: string }> = {},
) {
  const upserts: Array<{ table: string; row: any }> = [];
  const client = {
    from(table: string) {
      const result = errors[table]
        ? { data: null, error: errors[table] }
        : { data: rows[table] ?? [], error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        upsert: async (row: any) => {
          upserts.push({ table, row });
          return errors[table] ? { error: errors[table] } : { error: null };
        },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { upserts, databaseService: { client } as any };
}

function makeAudit() {
  const filed: any[] = [];
  return {
    filed,
    service: {
      record: async (c: any) => {
        filed.push(c);
        return { recorded: true, reason: null };
      },
    } as any,
  };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

describe("ApprovalThresholdsService", () => {
  /**
   * REGRESSION OF ADR 0116, and the reason this test was inverted rather than
   * deleted.
   *
   * It used to assert `enforcedBy: []` and a note ending "guarded by
   * JwtAuthGuard alone", because for two passes nothing in the gateway read
   * these rows before an order could be sealed and the register's opening
   * sentence said so. `ProcurementService.assertApprovalAllowed` now does read
   * them, so the OLD assertion is the one that would be lying.
   *
   * The field it guards is MEASURED, not asserted: the page renders "Nothing
   * stops an order yet" from this array being empty. If enforcement is ever
   * ripped out and this array is not emptied with it, the page starts claiming
   * a gate that is gone — [[absence-reported-as-health]] pointed at money, and
   * exactly what this line exists to catch in both directions.
   */
  it("names the one path that now enforces these thresholds", async () => {
    const { databaseService } = makeDb({
      restaurant_approval_thresholds: [],
      procurement_orders: [],
      users: [],
    });
    const out = await new ApprovalThresholdsService(
      databaseService,
      makeAudit().service,
    ).read("rest-1");

    expect(out.policyEmpty).toBe(true);
    expect(out.enforcement.enforcedBy).toEqual([ENFORCED_AT]);
    expect(out.enforcement.wouldBeEnforcedAt).toBe(ENFORCED_AT);
    expect(out.enforcement.wouldBeEnforcedAt).toContain("procurement.service.ts");
    // The note describes the gate that exists, not the guard that used to be
    // the only thing on the route.
    expect(out.enforcement.note).not.toContain("JwtAuthGuard alone");
    expect(out.enforcement.note).toContain("refuses the seal");
    expect(out.enforcement.note).toContain("APPROVAL_NEEDED");
    expect(out.enforcement.note).toContain("order_approval_refused");
  });

  it("computes the retrospective from the tenant's own orders, with the window caveat attached", async () => {
    const { databaseService } = makeDb({
      restaurant_approval_thresholds: [
        {
          rule: "manager_ceiling",
          enabled: true,
          amount_limit: "1000.00",
          percent_limit: null,
          required_role: "owner",
          set_by: "u-1",
          updated_at: "2026-09-01T00:00:00Z",
        },
      ],
      procurement_orders: [
        { provider_id: "p1", inventory_id: "i1", requested_at: "2026-09-01T08:00:00Z", total_cost: "500", final_price: "10" },
        { provider_id: "p1", inventory_id: "i1", requested_at: "2026-09-02T08:00:00Z", total_cost: "5000", final_price: "13" },
      ],
      users: [{ user_id: "u-1", name: "Deniz Aksoy" }],
    });
    const out = await new ApprovalThresholdsService(
      databaseService,
      makeAudit().service,
    ).read("rest-1");

    expect(out.thresholds[0]).toMatchObject({
      rule: "manager_ceiling",
      amountLimit: 1000,
      requiredRole: "owner",
      setBy: { userId: "u-1", name: "Deniz Aksoy" },
    });
    expect(out.retrospective.counts).toContainEqual({
      rule: "manager_ceiling",
      tested: 2,
      wouldHaveFired: 1,
    });
    expect(out.retrospective.caveat).toContain("reads as new here");
  });

  it("derives a price premium from the PREVIOUS price of the same item, in order", async () => {
    const { databaseService } = makeDb({
      restaurant_approval_thresholds: [
        {
          rule: "price_jump",
          enabled: true,
          amount_limit: null,
          percent_limit: "12",
          required_role: "owner",
          set_by: null,
          updated_at: null,
        },
      ],
      procurement_orders: [
        { provider_id: "p1", inventory_id: "i1", requested_at: "2026-09-01T08:00:00Z", total_cost: "100", final_price: "10" },
        // +30% on the same item — over the 12% the house allows.
        { provider_id: "p1", inventory_id: "i1", requested_at: "2026-09-02T08:00:00Z", total_cost: "130", final_price: "13" },
        // A different item, so no comparison exists for it yet.
        { provider_id: "p1", inventory_id: "i2", requested_at: "2026-09-03T08:00:00Z", total_cost: "90", final_price: "9" },
      ],
      users: [],
    });
    const out = await new ApprovalThresholdsService(
      databaseService,
      makeAudit().service,
    ).read("rest-1");

    expect(out.retrospective.counts).toContainEqual({
      rule: "price_jump",
      tested: 1,
      wouldHaveFired: 1,
    });
  });

  it("reports an unreadable ledger rather than a retrospective of zero", async () => {
    const { databaseService } = makeDb(
      { restaurant_approval_thresholds: [], users: [] },
      { procurement_orders: { message: "connection reset" } },
    );
    const out = await new ApprovalThresholdsService(
      databaseService,
      makeAudit().service,
    ).read("rest-1");
    expect(out.retrospective.readable).toBe(false);
    expect(out.retrospective.reason).toBe("connection reset");
  });

  it("reports a missing table by name rather than as 'no policy'", async () => {
    const { databaseService } = makeDb(
      {},
      { restaurant_approval_thresholds: { message: "relation does not exist", code: "42P01" } },
    );
    const out = await new ApprovalThresholdsService(
      databaseService,
      makeAudit().service,
    ).read("rest-1");
    expect(out.readable).toBe(false);
    expect(out.reason).toContain("not present on this database");
  });

  it("files who set the threshold, with the previous number", async () => {
    const { databaseService, upserts } = makeDb({
      restaurant_approval_thresholds: [
        {
          rule: "manager_ceiling",
          enabled: true,
          amount_limit: "10000",
          percent_limit: null,
          required_role: "owner",
          set_by: "u-1",
          updated_at: "2026-08-27T16:58:00Z",
        },
      ],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const service = new ApprovalThresholdsService(databaseService, audit.service);

    const result = await service.write(
      "rest-1",
      { rule: "manager_ceiling", enabled: true, amountLimit: 15000, requiredRole: "owner" },
      "u-4",
    );

    expect(upserts[0].row).toMatchObject({
      restaurant_id: "rest-1",
      rule: "manager_ceiling",
      amount_limit: 15000,
      set_by: "u-4",
    });
    expect(audit.filed[0]).toMatchObject({
      action: "approval_threshold_changed",
      register: "thresholds",
      subject: "manager_ceiling",
      actorUserId: "u-4",
    });
    expect(audit.filed[0].fields.amount_limit).toEqual({ from: 10000, to: 15000 });
    // The role did not move, so it is not in the row.
    expect(audit.filed[0].fields.required_role).toBeUndefined();
    expect(result.audited).toBe(true);
  });
});
