import { Logger } from "@nestjs/common";
import { VendorTermsService } from "./vendor-terms.service";

/**
 * Two reads on this service used to bind `data` and drop `error`.
 *
 * supabase-js RESOLVES with `{ data, error }` — it never throws — so both sites
 * turned a failed query into the same value a clean query returns when there is
 * nothing there:
 *
 *   `resolveActors`   a dead `users` read became an empty name map, and every
 *                     row's `statedBy.name` came back null. Null is what "nobody
 *                     stated this" looks like, so the readout reported the
 *                     absence of the lookup as the absence of an author.
 *   `readStatedOne`   a dead `restaurant_vendor_terms` read became `null`, which
 *                     `maybeSingle()` also returns for "no row yet". The audit
 *                     row then recorded a first-ever statement of terms where in
 *                     fact terms existed and could not be read — and the warning
 *                     written to catch exactly that was unreachable, because the
 *                     `try/catch` around a resolving promise never fires.
 *
 * These cases fail against the pre-fix file (verified against a `git show HEAD:`
 * copy): there, `sources.actors` did not exist at all and the `readStatedOne`
 * warning was never logged.
 */

type Rows = Record<string, unknown[]>;
type Errs = Record<string, { message: string; code?: string }>;

function makeDb(rows: Rows, errors: Errs = {}) {
  const client = {
    from(table: string) {
      const result = errors[table]
        ? { data: null, error: errors[table] }
        : { data: rows[table] ?? [], error: null };
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        is: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        upsert: () => chain,
        maybeSingle: async () =>
          errors[table]
            ? { data: null, error: errors[table] }
            : { data: (rows[table] ?? [])[0] ?? null, error: null },
        single: async () => result,
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  return { client } as any;
}

const audit = {
  record: async () => ({ recorded: true, reason: null }),
} as any;

const RID = "rest-1";
const PID = "prov-1";

const HOUSE = [{ timezone: "UTC", currency: "TRY" }];
const PROVIDERS = [
  {
    id: PID,
    name: "Kavaklidere",
    minimum_order: null,
    lead_time_days: null,
    payment_terms: null,
  },
];
const STATED = [
  {
    provider_id: PID,
    delivery_weekdays: [2, 5],
    order_cutoff_time: "16:00",
    order_cutoff_offset_days: 1,
    minimum_order_amount: 5000,
    lead_time_days: 2,
    payment_terms: "Net 30",
    notes: null,
    stated_by: "user-9",
    stated_at: "2026-09-01T10:00:00.000Z",
    updated_at: "2026-09-01T10:00:00.000Z",
  },
];

describe("VendorTermsService — a failed read is never an absent one", () => {
  it("says the authors could not be looked up instead of showing every rule unsigned", async () => {
    const db = makeDb(
      {
        restaurants: HOUSE,
        providers: PROVIDERS,
        restaurant_providers: [],
        restaurant_vendor_terms: STATED,
        procurement_orders: [],
        users: [],
      },
      { users: { message: "connection terminated unexpectedly" } },
    );

    const out = await new VendorTermsService(db, audit).read(RID);

    // The names are unknown either way. What must NOT be the same either way is
    // the readout's account of WHY.
    expect(out.sources.actors.readable).toBe(false);
    expect(out.sources.actors.reason).toContain(
      "connection terminated unexpectedly",
    );
    // Never 0: an unreadable source has an unknown row count.
    expect(out.sources.actors.rows).toBeNull();
    // The rest of the register still renders — degrading loudly, not failing.
    expect(out.vendors).toHaveLength(1);
    expect(out.vendors[0].statedBy?.name ?? null).toBeNull();
  });

  it("reports a clean authors read as readable, so the two cases are distinguishable", async () => {
    const db = makeDb({
      restaurants: HOUSE,
      providers: PROVIDERS,
      restaurant_providers: [],
      restaurant_vendor_terms: STATED,
      procurement_orders: [],
      users: [{ user_id: "user-9", name: "Deniz Aksoy" }],
    });

    const out = await new VendorTermsService(db, audit).read(RID);

    expect(out.sources.actors).toEqual({
      readable: true,
      reason: null,
      rows: 1,
    });
    expect(out.vendors[0].statedBy?.name).toBe("Deniz Aksoy");
  });

  it("warns that the before-state was unreadable rather than auditing a write as the first ever", async () => {
    // `restaurant_vendor_terms` fails on read; `providers` still resolves, so
    // `requireProvider` passes and the write path is genuinely exercised.
    const db = makeDb(
      {
        restaurants: HOUSE,
        providers: PROVIDERS,
        restaurant_providers: [],
        restaurant_vendor_terms: [],
        procurement_orders: [],
        users: [],
      },
      {
        restaurant_vendor_terms: {
          message: "statement timeout",
        },
      },
    );

    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    try {
      // The upsert shares the failing table, so the write itself is refused —
      // which is correct, and is not what this case is about. The claim under
      // test is that the BEFORE-state read announced its failure first.
      await new VendorTermsService(db, audit)
        .write(RID, PID, { paymentTerms: "Net 45" } as any, "user-9")
        .catch(() => undefined);

      const said = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(said).toContain(
        `The previous vendor terms for ${PID} could not be read`,
      );
    } finally {
      jest.restoreAllMocks();
    }
  });
});
