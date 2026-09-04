import { VendorTermsService, PROVIDER_COLUMN_DEFAULTS } from "./vendor-terms.service";

/**
 * The register's own rules, pinned.
 *
 * The one this file exists for is the DEFAULT TRAP: `providers.lead_time_days`
 * is `DEFAULT 7` and `providers.payment_terms` is `DEFAULT 'Net 30'`, so those
 * two values are indistinguishable from "nobody has ever been asked". A test
 * suite that only checked "the value on the row is returned" would pass while
 * the page told every house its vendors deliver in a week on Net 30 — a
 * fabricated term with a database column standing behind it.
 */

type Rows = Record<string, unknown[]>;

/**
 * A PostgREST chain double.
 *
 * Thenable, because the service awaits some chains at `.order(...)` and others
 * at `.maybeSingle()`. Records the tables it was asked for so tenant scoping
 * can be asserted on the filters rather than on faith.
 */
function makeDb(rows: Rows, errors: Record<string, { message: string; code?: string }> = {}) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const upserts: Array<{ table: string; row: any; options: unknown }> = [];

  const client = {
    from(table: string) {
      const result = errors[table]
        ? { data: null, error: errors[table] }
        : { data: rows[table] ?? [], error: null };
      const chain: any = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          filters.push({ table, column, value });
          return chain;
        },
        in: () => chain,
        is: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        upsert: (row: any, options: unknown) => {
          upserts.push({ table, row, options });
          return chain;
        },
        maybeSingle: async () =>
          errors[table]
            ? { data: null, error: errors[table] }
            : { data: (rows[table] ?? [])[0] ?? null, error: null },
        single: async () => result,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { filters, upserts, databaseService: { client } as any };
}

function makeAudit() {
  const filed: any[] = [];
  return {
    filed,
    service: {
      record: async (change: any) => {
        filed.push(change);
        return { recorded: true, reason: null };
      },
    } as any,
  };
}

const RID = "rest-1";
const PID = "prov-1";

/** A house with a real zone and currency, so nothing under test is a default. */
const HOUSE = [{ timezone: "UTC", currency: "TRY" }];

describe("VendorTermsService — a defaulted column is not a term", () => {
  /**
   * REGRESSION OF THE MIGRATION, and the reason this case was inverted rather
   * than deleted.
   *
   * It used to assert the opposite: a vendor row reading 7 days on Net 30 was
   * reported UNKNOWN, because `providers.lead_time_days DEFAULT 7` and
   * `payment_terms DEFAULT 'Net 30'` made a stated seven and an unasked
   * question the same bytes. That was correct while the defaults stood.
   *
   * `20260903170000_a_default_is_not_an_answer.sql` dropped both and set every
   * row carrying them to NULL. A 7 that survives is a 7 somebody typed, so the
   * old assertion would make the register DISCARD a real answer — the same
   * fault inverted. This case is what pins the two halves together: revert the
   * migration without reverting the service and this fails, rather than the
   * register quietly reporting defaults as terms.
   */
  it("reads a lead time of 7 and terms of Net 30 as TERMS, because the defaults are gone", async () => {
    const { databaseService } = makeDb({
      restaurants: HOUSE,
      providers: [
        {
          id: PID,
          name: "Anadolu",
          minimum_order: null,
          // Exactly the two values the dropped defaults used to write.
          lead_time_days: PROVIDER_COLUMN_DEFAULTS.lead_time_days,
          payment_terms: PROVIDER_COLUMN_DEFAULTS.payment_terms,
        },
      ],
      restaurant_providers: [],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);

    const v = out.vendors[0];
    expect(v.leadTimeDays).toMatchObject({
      value: 7,
      source: "vendor_record",
      column: "providers.lead_time_days",
    });
    expect(v.paymentTerms).toMatchObject({
      value: "Net 30",
      source: "vendor_record",
      column: "providers.payment_terms",
    });
    // The old escape hatch is gone from the copy as well as the logic.
    expect(v.leadTimeDays.reason).toBeUndefined();
    expect(v.paymentTerms.reason).toBeUndefined();
  });

  it("an EMPTY column is still unknown — a null is the unasked question", async () => {
    const { databaseService } = makeDb({
      restaurants: HOUSE,
      providers: [
        {
          id: PID,
          name: "Anadolu",
          minimum_order: null,
          lead_time_days: null,
          payment_terms: null,
        },
      ],
      restaurant_providers: [],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);

    const v = out.vendors[0];
    expect(v.leadTimeDays.value).toBeNull();
    expect(v.leadTimeDays.source).toBe("unknown");
    expect(v.paymentTerms.value).toBeNull();
    expect(v.paymentTerms.source).toBe("unknown");
    expect(v.paymentTerms.reason).toBeTruthy();
  });

  it("reports lead time from the vendor record when it DIFFERS from the default", async () => {
    const { databaseService } = makeDb({
      restaurants: HOUSE,
      providers: [
        { id: PID, name: "Anadolu", minimum_order: null, lead_time_days: 3, payment_terms: "Net 15" },
      ],
      restaurant_providers: [],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);

    expect(out.vendors[0].leadTimeDays).toMatchObject({
      value: 3,
      source: "vendor_record",
      column: "providers.lead_time_days",
    });
    expect(out.vendors[0].paymentTerms).toMatchObject({
      value: "Net 15",
      source: "vendor_record",
    });
  });

  it("prefers the per-tenant override, which carries no default and so is always somebody's answer", async () => {
    const { databaseService } = makeDb({
      restaurants: HOUSE,
      providers: [
        {
          id: PID,
          name: "Anadolu",
          minimum_order: 800,
          lead_time_days: PROVIDER_COLUMN_DEFAULTS.lead_time_days,
          payment_terms: null,
        },
      ],
      restaurant_providers: [
        { provider_id: PID, custom_lead_time_days: 2, custom_minimum_order: 500, last_order_date: "2026-09-01" },
      ],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);

    expect(out.vendors[0].leadTimeDays).toMatchObject({
      value: 2,
      column: "restaurant_providers.custom_lead_time_days",
    });
    expect(out.vendors[0].minimumOrder).toMatchObject({
      value: 500,
      column: "restaurant_providers.custom_minimum_order",
    });
  });
});

describe("VendorTermsService — a stated term carries its author, and its contradiction", () => {
  it("names who stated it and when, and flags a delivery pattern that disagrees", async () => {
    const orders = [
      "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23",
      "2026-09-30", "2026-10-07",
    ].map((d) => ({
      provider_id: PID,
      requested_at: `${d}T08:00:00Z`,
      delivered_at: `${d}T14:00:00Z`,
      expected_delivery_date: d,
      total_cost: 900,
      status: "delivered",
    }));

    const { databaseService } = makeDb({
      restaurants: HOUSE,
      providers: [
        { id: PID, name: "Anadolu", minimum_order: null, lead_time_days: 7, payment_terms: null },
      ],
      restaurant_providers: [],
      restaurant_vendor_terms: [
        {
          provider_id: PID,
          // The house says Tuesday and Friday.
          delivery_weekdays: [2, 5],
          order_cutoff_time: "14:00:00",
          order_cutoff_offset_days: 1,
          minimum_order_amount: null,
          lead_time_days: null,
          payment_terms: null,
          notes: null,
          stated_by: "user-9",
          stated_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:00:00Z",
        },
      ],
      procurement_orders: orders,
      users: [{ user_id: "user-9", name: "Selin Kara" }],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);
    const v = out.vendors[0];

    expect(v.deliveryWeekdays.source).toBe("stated");
    expect(v.deliveryWeekdays.value).toEqual([2, 5]);
    expect(v.deliveryWeekdays.statedBy).toEqual({ userId: "user-9", name: "Selin Kara" });
    // Every one of those six receipts landed on a Wednesday.
    expect(v.deliveryWeekdays.contradiction).toContain("Wednesday");

    // The stated cutoff is rendered as HH:MM, not as Postgres's HH:MM:SS.
    expect(v.orderCutoff.value).toMatchObject({ time: "14:00", offsetDays: 1 });
  });
});

describe("VendorTermsService — an unreadable source is never an empty one", () => {
  it("says the ledger could not be read instead of inferring nothing from nothing", async () => {
    const { databaseService } = makeDb(
      {
        restaurants: HOUSE,
        providers: [
          { id: PID, name: "Anadolu", minimum_order: null, lead_time_days: 3, payment_terms: null },
        ],
        restaurant_providers: [],
        restaurant_vendor_terms: [],
        users: [],
      },
      { procurement_orders: { message: "connection reset" } },
    );
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);

    expect(out.sources.orders.readable).toBe(false);
    // Never 0 — an unreadable source has an unknown row count.
    expect(out.sources.orders.rows).toBeNull();
    expect(out.vendors[0].deliveryWeekdays.source).toBe("unknown");
    expect(out.vendors[0].deliveryWeekdays.reason).toContain("could not be read");
  });

  it("reports a missing terms table by name rather than as 'no terms recorded'", async () => {
    const { databaseService } = makeDb(
      {
        restaurants: HOUSE,
        providers: [],
        restaurant_providers: [],
        procurement_orders: [],
        users: [],
      },
      { restaurant_vendor_terms: { message: "relation does not exist", code: "42P01" } },
    );
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);
    expect(out.sources.statedTerms.readable).toBe(false);
    expect(out.sources.statedTerms.reason).toContain("not present on this database");
  });
});

describe("VendorTermsService — the house's own zone and currency", () => {
  /**
   * The zone and the currency now answer to DIFFERENT rules, and this pair is
   * the only place that difference is visible.
   *
   * `restaurants.timezone DEFAULT 'America/Los_Angeles'` was dropped by
   * `20260903170000_a_default_is_not_an_answer.sql`, so a house reading Los
   * Angeles today CHOSE Los Angeles. `restaurants.currency DEFAULT 'USD'`
   * (baseline:3576) was NOT dropped — it was not named in the founder's
   * decision — so a USD is still unattributable and still flagged.
   */
  it("BELIEVES a timezone a house has set, even the one that used to be the default", async () => {
    const { databaseService } = makeDb({
      restaurants: [{ timezone: "America/Los_Angeles", currency: "USD" }],
      providers: [],
      restaurant_providers: [],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);
    expect(out.zone).toEqual({ zone: "America/Los_Angeles", isColumnDefault: false });
    // The currency default still stands, so a USD is still flagged.
    expect(out.currency).toEqual({ code: "USD", isColumnDefault: true });
  });

  it("flags an UNSET timezone, because the weekday depends on it", async () => {
    // What the migration leaves behind: a house nobody has asked. The register
    // suppresses cutoff arithmetic over this, which is why the flag exists.
    const { databaseService } = makeDb({
      restaurants: [{ timezone: null, currency: null }],
      providers: [],
      restaurant_providers: [],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const out = await new VendorTermsService(databaseService, audit.service).read(RID);
    expect(out.zone).toEqual({ zone: "America/Los_Angeles", isColumnDefault: true });
    expect(out.currency).toEqual({ code: "USD", isColumnDefault: true });
  });
});

describe("VendorTermsService — writing states, and the write is filed", () => {
  it("scopes the write to the tenant and files only the fields that moved", async () => {
    const { databaseService, filters, upserts } = makeDb({
      restaurants: HOUSE,
      providers: [
        { id: PID, name: "Anadolu", minimum_order: null, lead_time_days: 7, payment_terms: null },
      ],
      restaurant_providers: [],
      restaurant_vendor_terms: [
        {
          provider_id: PID,
          delivery_weekdays: [1, 3],
          order_cutoff_time: "14:00:00",
          order_cutoff_offset_days: 1,
          minimum_order_amount: null,
          lead_time_days: null,
          payment_terms: null,
          notes: null,
          stated_by: "user-9",
          stated_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:00:00Z",
        },
      ],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const service = new VendorTermsService(databaseService, audit.service);

    const result = await service.write(
      RID,
      PID,
      { deliveryWeekdays: [1, 3], orderCutoffTime: "13:30" },
      "user-4",
    );

    // The provider was looked up under THIS restaurant before anything was
    // written, so a guessed provider id from another house cannot be reached.
    expect(filters).toContainEqual({ table: "providers", column: "restaurant_id", value: RID });
    expect(filters).toContainEqual({ table: "providers", column: "id", value: PID });

    const written = upserts.find((u) => u.table === "restaurant_vendor_terms");
    expect(written?.row).toMatchObject({
      restaurant_id: RID,
      provider_id: PID,
      stated_by: "user-4",
      order_cutoff_time: "13:30",
    });

    // Weekdays did not move, so they are NOT in the audit row.
    expect(audit.filed).toHaveLength(1);
    expect(Object.keys(audit.filed[0].fields)).toEqual(["order_cutoff_time"]);
    expect(audit.filed[0].fields.order_cutoff_time).toEqual({
      from: "14:00:00",
      to: "13:30",
    });
    expect(audit.filed[0]).toMatchObject({
      action: "vendor_terms_changed",
      register: "vendor-terms",
      actorUserId: "user-4",
      // The vendor's name at the time, so the log survives a rename.
      subject: "Anadolu",
    });
    expect(result.audited).toBe(true);
  });

  it("distinguishes 'leave it alone' from 'withdraw the statement'", async () => {
    const { databaseService, upserts } = makeDb({
      restaurants: HOUSE,
      providers: [
        { id: PID, name: "Anadolu", minimum_order: null, lead_time_days: 7, payment_terms: null },
      ],
      restaurant_providers: [],
      restaurant_vendor_terms: [
        {
          provider_id: PID,
          delivery_weekdays: [1, 3],
          order_cutoff_time: "14:00:00",
          order_cutoff_offset_days: 1,
          minimum_order_amount: null,
          lead_time_days: null,
          payment_terms: "Net 30",
          notes: null,
          stated_by: "user-9",
          stated_at: "2026-08-01T10:00:00Z",
          updated_at: "2026-08-01T10:00:00Z",
        },
      ],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const service = new VendorTermsService(databaseService, audit.service);

    await service.write(RID, PID, { paymentTerms: null }, "user-4");
    const written = upserts.find((u) => u.table === "restaurant_vendor_terms");
    expect(written?.row).toHaveProperty("payment_terms", null);
    // An untouched key is absent from the patch entirely, not sent as null.
    expect(written?.row).not.toHaveProperty("delivery_weekdays");
    expect(audit.filed[0].fields.payment_terms).toEqual({ from: "Net 30", to: null });
  });

  it("refuses a provider that does not belong to this restaurant", async () => {
    const { databaseService } = makeDb({
      restaurants: HOUSE,
      providers: [],
      restaurant_providers: [],
      restaurant_vendor_terms: [],
      procurement_orders: [],
      users: [],
    });
    const audit = makeAudit();
    const service = new VendorTermsService(databaseService, audit.service);
    await expect(
      service.write(RID, "someone-elses-vendor", { leadTimeDays: 1 }, "user-4"),
    ).rejects.toThrow(/does not belong to this restaurant/);
    expect(audit.filed).toHaveLength(0);
  });
});
