import { ScheduledTasksService } from "./scheduled-tasks.service";
import {
  RECURRING_REMINDER_FLAG,
  describeRecurringOrder,
  recurringRemindersEnabled,
} from "./recurring-order-reminder";

/**
 * Recurring-order reminder — ADR 0061.
 *
 * This job filtered `procurement_orders` on `status = 'RECURRING'`, a value
 * that is not a member of `ProcurementOrderStatus` and never has been, so it
 * matched zero rows and never sent an email. It now reads `recurring_orders`,
 * the table its own field names already belonged to.
 *
 * Because the path emails real tenants, the two tests that matter most are
 * negative: nothing sends while the flag is off, and nothing sends to an
 * address that belongs to a different tenant.
 */

/** A legacy-shaped `recurring_orders` row: `wine_id`, no price, no provider. */
const MAIN_SHAPED_ROW = {
  id: "sched-1",
  quantity: 6,
  unit_type: "bottle",
  frequency: "monthly",
  next_order_date: "2026-09-04",
  active: true,
  wine_id: "W-123",
};

/**
 * A row exactly as `RecurringOrdersService.createRecurringOrder` writes one
 * TODAY, on `main`, with PR #220's migration applied — every key here is a key
 * that insert supplies, and nothing else.
 *
 * This is the fixture that matters, and it did not exist: the two above are a
 * "before #220" and an "after #220" that the writer never actually produces.
 * #220's insert populates `inventory_id`/`provider_id` and never writes
 * `wine_id` or `preferred_providers`, and #220 adds no `wine_name` or
 * `provider_name` column at all — it embeds the name through `inventory_id`,
 * an embed this job's flat `select("*")` does not perform. `target_price` IS
 * present, so the refusal is precondition 2 of ADR 0061 and not precondition 1.
 */
const WRITER_SHAPED_ROW = {
  id: "sched-2",
  restaurant_id: "rest-1",
  inventory_id: "11111111-1111-1111-1111-111111111111",
  provider_id: "22222222-2222-2222-2222-222222222222",
  quantity: 6,
  unit_type: "bottle",
  target_price: 42.5,
  frequency: "monthly",
  frequency_day: null,
  auto_approve: false,
  next_order_date: "2026-09-04",
  active: true,
  created_by: null,
  notes: null,
  execution_count: 0,
};

/** The same row once a wine name and a provider name are reachable. */
const COMPLETE_ROW = {
  ...MAIN_SHAPED_ROW,
  wine_name: "Barolo 2019",
  provider_name: "Chateau Distribution",
  target_price: 42.5,
};

function makeHarness(opts: {
  flag?: string;
  schedules?: any[];
  isLegacyDefault?: boolean;
}) {
  const queriedTables: string[] = [];
  const rowsByTable: Record<string, any[]> = {
    recurring_orders: opts.schedules ?? [],
    // Production truth: the old query matched nothing, so the pre-fix code
    // path finds an empty set here. Nothing about this mock hides the bug.
    procurement_orders: [],
  };

  const makeQuery = (table: string) => {
    const rows = rowsByTable[table] ?? [];
    const q: any = {};
    const self = () => q;
    q.select = jest.fn(self);
    q.eq = jest.fn(self);
    q.in = jest.fn(self);
    q.lte = jest.fn(self);
    q.gte = jest.fn(self);
    q.not = jest.fn(self);
    q.order = jest.fn(self);
    q.insert = jest.fn(() => Promise.resolve({ data: null, error: null }));
    // Thenable so `await client.from(x).select(y).eq(...)` resolves whether or
    // not the chain ends in `.order()`.
    q.then = (res: any, rej: any) =>
      Promise.resolve({ data: rows, error: null }).then(res, rej);
    return q;
  };

  const client = {
    from: jest.fn((table: string) => {
      queriedTables.push(table);
      return makeQuery(table);
    }),
  };

  const tenant = {
    id: "tenant-b",
    name: "Tenant B",
    isLegacyDefault: opts.isLegacyDefault ?? false,
  };

  const resolveRecipients = jest.fn(async () => ({
    emails: ["manager@tenant-b.test"],
    phones: [],
  }));
  const sendRecurringOrderReminder = jest.fn(async () => ({ success: true }));
  const runPerTenant = jest.fn(async (_name: string, fn: any) => {
    await fn(tenant);
  });

  const cfg: Record<string, string | undefined> = {};
  if (opts.flag !== undefined) cfg[RECURRING_REMINDER_FLAG] = opts.flag;

  const service = new ScheduledTasksService(
    { get: jest.fn((k: string) => cfg[k]) } as any,
    {} as any,
    {
      getClient: () => client,
      // Empty membership short-circuits both the preferences lookup (which
      // then defaults to enabled) and the in-app notification insert.
      getRestaurantMemberIds: jest.fn(async () => []),
    } as any,
    { sendRecurringOrderReminder } as any,
    { resolveRecipients } as any,
    { runPerTenant } as any,
  );

  return {
    service,
    queriedTables,
    resolveRecipients,
    sendRecurringOrderReminder,
    runPerTenant,
  };
}

describe("recurringRemindersEnabled — off unless explicitly armed", () => {
  it.each([
    undefined,
    null,
    "",
    "   ",
    "false",
    "0",
    "no",
    "off",
    "yes",
    "on",
    "enabled",
    "ture",
  ])("reads %p as OFF", (raw) => {
    expect(recurringRemindersEnabled(raw as any)).toBe(false);
  });

  it.each(["true", "TRUE", " True ", "1"])("reads %p as ON", (raw) => {
    expect(recurringRemindersEnabled(raw)).toBe(true);
  });
});

describe("describeRecurringOrder — refuses what it cannot name or price", () => {
  it("refuses a row in the shape main's schema can actually produce", () => {
    const d = describeRecurringOrder(MAIN_SHAPED_ROW);
    expect(d.sendable).toBe(false);
    if (d.sendable) throw new Error("unreachable");
    // The wine is nameable from the legacy `wine_id`; the price and provider
    // are not, because this shape predates #220's columns entirely.
    expect(d.missing).toEqual(
      expect.arrayContaining([
        "provider_name/preferred_providers",
        "target_price",
      ]),
    );
  });

  it("refuses the row the CURRENT writer produces, and for the right reason", () => {
    // ADR 0061 said the reminder was inert because `target_price` was absent
    // until PR #220 merged. #220 had already merged twelve hours earlier
    // (`e50d912c` is an ancestor of ADR 0061's own commit `e3acc79a`), so the
    // stated reason was never true on `main`. The job is inert anyway — for the
    // OTHER precondition — and this pins which one, so the next reader arming
    // the flag knows what to fix.
    const d = describeRecurringOrder(WRITER_SHAPED_ROW);
    expect(d.sendable).toBe(false);
    if (d.sendable) throw new Error("unreachable");

    // Not the price: #220 added `target_price` and the writer supplies it.
    expect(d.missing).not.toContain("target_price");
    // The name and the provider: #220 adds no column for either, and this job
    // reads the table flat with no embed.
    expect(d.missing).toEqual([
      "wine_name/wine_id",
      "provider_name/preferred_providers",
    ]);
  });

  it("never substitutes a placeholder provider or a zero price", () => {
    const d = describeRecurringOrder({
      ...MAIN_SHAPED_ROW,
      wine_name: "Barolo 2019",
    });
    expect(JSON.stringify(d)).not.toContain("Unknown Provider");
    expect(d.sendable).toBe(false);
  });

  it("describes a complete row without inventing anything", () => {
    const d = describeRecurringOrder(COMPLETE_ROW);
    expect(d).toMatchObject({
      sendable: true,
      label: "Barolo 2019",
      providerName: "Chateau Distribution",
      quantity: 6,
      unitPrice: 42.5,
      totalAmount: 255,
      frequency: "monthly",
      scheduledDate: "2026-09-04",
    });
  });
});

describe("sendRecurringOrderReminders", () => {
  beforeEach(() => {
    delete process.env[RECURRING_REMINDER_FLAG];
  });

  it("sends nothing — and does not even look — while the flag is off", async () => {
    const h = makeHarness({ schedules: [COMPLETE_ROW] });

    await h.service.sendRecurringOrderReminders();

    expect(h.runPerTenant).not.toHaveBeenCalled();
    expect(h.queriedTables).toEqual([]);
    expect(h.resolveRecipients).not.toHaveBeenCalled();
    expect(h.sendRecurringOrderReminder).not.toHaveBeenCalled();
  });

  it("stays off for a flag value that is not exactly true/1", async () => {
    const h = makeHarness({ flag: "yes", schedules: [COMPLETE_ROW] });

    await h.service.sendRecurringOrderReminders();

    expect(h.sendRecurringOrderReminder).not.toHaveBeenCalled();
  });

  it("reads recurring_orders, never a procurement_orders status", async () => {
    const h = makeHarness({ flag: "true", schedules: [COMPLETE_ROW] });

    await h.service.sendRecurringOrderReminders();

    expect(h.queriedTables).toContain("recurring_orders");
    expect(h.queriedTables).not.toContain("procurement_orders");
  });

  it("addresses the tenant's own manager, never the global env address", async () => {
    const h = makeHarness({ flag: "true", schedules: [COMPLETE_ROW] });

    await h.service.sendRecurringOrderReminders();

    // The tenant is not the legacy default, so the MANAGER_EMAIL fallback must
    // be refused outright — OD-87 / ADR 0022. A `true` here mails tenant B's
    // schedule to tenant A's inbox.
    expect(h.resolveRecipients).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: "tenant-b",
        roles: ["manager"],
        channels: ["email"],
        allowDefaultFallback: false,
      }),
    );

    expect(h.sendRecurringOrderReminder).toHaveBeenCalledTimes(1);
    expect(h.sendRecurringOrderReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["manager@tenant-b.test"],
        restaurantName: "Tenant B",
        orderName: "Barolo 2019",
        providerName: "Chateau Distribution",
        totalAmount: 255,
      }),
    );
  });

  it("emails nothing for a row it cannot describe, even when armed", async () => {
    const h = makeHarness({ flag: "true", schedules: [MAIN_SHAPED_ROW] });

    await h.service.sendRecurringOrderReminders();

    expect(h.queriedTables).toContain("recurring_orders");
    expect(h.sendRecurringOrderReminder).not.toHaveBeenCalled();
  });
});
