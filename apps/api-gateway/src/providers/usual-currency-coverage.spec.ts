/**
 * "N of M vendors have stated a usual currency" — the prompt that keeps the
 * order-currency chain alive.
 *
 * THE FOUNDER, 2026-09-06, batch 66, verbatim: *"Add the prompt panel"* — "One
 * panel on the providers page (and the orders sheet's empty field) saying how
 * many vendors have stated a usual currency and linking to the ones that have
 * not. No provenance lie."
 *
 * WHY EACH ASSERTION IS LOAD-BEARING
 *   1. The denominator is LIVE vendors. A retired vendor takes no order, so
 *      counting it makes the house's exposure look worse than it is — and the
 *      NULL `is_active` case must stay IN, because `is_active` is nullable with
 *      `DEFAULT true` and a `neq.false` filter would drop exactly those rows.
 *   2. Zero stated is a SENTENCE, never an empty panel. A panel that renders
 *      nothing when the answer is "none of them" cannot be told apart from one
 *      that failed to load — the absence-reported-as-health fault with a
 *      heading on it.
 *   3. A failed read is a 503 carrying the reason, never a coverage of zero.
 *      supabase-js resolves `{ data, error }` and never throws, so without the
 *      error arm an outage would tell a house that none of its vendors has
 *      stated anything and invite fourteen people to type it again.
 *   4. A stored value that is not an ISO 4217 currency is NOT stated. `ZZZ` was
 *      writable in this column until 2026-09-06 and the order sheet offers
 *      nothing for it, so counting it would report coverage the order sheet
 *      does not have.
 *
 * The route READS. Nothing here pre-fills an order sheet or writes a vendor row:
 * the repair for an unstated vendor is a person stating it, never a
 * house-derived default recorded as somebody's choice.
 */

import { ServiceUnavailableException } from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { ProvidersController } from "./providers.controller";
import { usualCurrencyCoverageSentence } from "./vendor-currency";

type Row = {
  id: string;
  name?: string | null;
  usual_currency?: string | null;
  usual_currency_source?: string | null;
  is_active?: boolean | null;
  deleted_at?: string | null;
};

function makeDb(opts: { rows?: Row[]; fails?: boolean }) {
  const seen: { table: string; columns: string; restaurantId: string }[] = [];
  const supabase: any = {
    from(table: string) {
      let columns = "";
      const q: any = {
        select: (c: string) => {
          columns = c;
          return q;
        },
        eq: (_col: string, value: string) => {
          seen.push({ table, columns, restaurantId: value });
          return q;
        },
        then: (res: any) =>
          res(
            opts.fails
              ? {
                  data: null,
                  error: { message: "statement timeout", code: "57014" },
                }
              : { data: opts.rows ?? [], error: null },
          ),
      };
      return q;
    },
  };
  return { supabase, seen };
}

const unusedProcurement = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `usual-currency-coverage.spec: ProcurementService.${String(prop)} was called; ` +
          `this suite covers one read and must reach no order path.`,
      );
    },
  },
) as any;

const svc = (supabase: any) =>
  new ProvidersService(
    { supabase } as any,
    { track: async () => undefined } as any,
    unusedProcurement,
  );

describe("usualCurrencyCoverage — the count", () => {
  it("counts only vendors this house can still order from", async () => {
    const { supabase } = makeDb({
      rows: [
        { id: "a", name: "Anadolu Şarap", usual_currency: "TRY" },
        { id: "b", name: "Bodega Álvaro", usual_currency: null },
        // retired two different ways: neither may reach the denominator
        {
          id: "c",
          name: "Closed Cellars",
          usual_currency: null,
          is_active: false,
        },
        {
          id: "d",
          name: "Departed Imports",
          usual_currency: null,
          deleted_at: "2026-01-02T00:00:00Z",
        },
      ],
    });

    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");

    expect(counted).toEqual({
      stated: 1,
      total: 2,
      fromInvoices: 0,
      unstated: [{ id: "b", name: "Bodega Álvaro", recorded: null }],
    });
  });

  it("keeps a vendor whose is_active was never written", async () => {
    // The trap this pins: `is_active` is nullable with DEFAULT true, and
    // filtering `is_active=neq.false` in PostgREST DROPS NULL rows — a vendor
    // the house orders from every week would vanish from both halves of the
    // fraction and nobody would be asked to state its currency.
    const { supabase } = makeDb({
      rows: [
        { id: "a", name: "Null Flag Wines", usual_currency: null, is_active: null },
      ],
    });

    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted.total).toBe(1);
    expect(counted.unstated.map((u) => u.id)).toEqual(["a"]);
  });

  it("reads the columns it names, scoped to the caller's house", async () => {
    const { supabase, seen } = makeDb({ rows: [] });
    await svc(supabase).usualCurrencyCoverage("rest-9");
    expect(seen).toHaveLength(1);
    expect(seen[0].table).toBe("providers");
    expect(seen[0].columns).toBe(
      "id, name, usual_currency, usual_currency_source, is_active, deleted_at",
    );
    expect(seen[0].restaurantId).toBe("rest-9");
  });

  it("is zero of zero for a house with no vendors, not an error", async () => {
    const { supabase } = makeDb({ rows: [] });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted).toEqual({
      stated: 0,
      total: 0,
      fromInvoices: 0,
      unstated: [],
    });
  });

  it("counts none of them when nobody has been asked", async () => {
    const { supabase } = makeDb({
      rows: [
        { id: "a", name: "A", usual_currency: null },
        { id: "b", name: "B", usual_currency: "   " },
      ],
    });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted.stated).toBe(0);
    expect(counted.total).toBe(2);
    expect(counted.unstated).toHaveLength(2);
  });

  it("does not count a stored value that is not a currency, and names it", async () => {
    const { supabase } = makeDb({
      rows: [{ id: "z", name: "Zed Cellars", usual_currency: "ZZZ" }],
    });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted.stated).toBe(0);
    expect(counted.unstated).toEqual([
      { id: "z", name: "Zed Cellars", recorded: "ZZZ" },
    ]);
  });

  it("names an unnamed vendor rather than printing an empty link", async () => {
    const { supabase } = makeDb({
      rows: [{ id: "n", name: "  ", usual_currency: null }],
    });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted.unstated[0].name).toBe("This vendor");
  });

  it("lists the unstated ones in reading order", async () => {
    const { supabase } = makeDb({
      rows: [
        { id: "b", name: "Zed", usual_currency: null },
        { id: "a", name: "Ada", usual_currency: null },
      ],
    });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted.unstated.map((u) => u.name)).toEqual(["Ada", "Zed"]);
  });

  it("refuses in words when the read FAILS — never a coverage of zero", async () => {
    const { supabase } = makeDb({ fails: true });
    await expect(
      svc(supabase).usualCurrencyCoverage("rest-1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      svc(supabase).usualCurrencyCoverage("rest-1"),
    ).rejects.toThrow(/statement timeout/);
  });
});

describe("usualCurrencyCoverage — VEN-W13, codes written from invoices", () => {
  it("counts them as on file and says how many came from invoices", async () => {
    const { supabase } = makeDb({
      rows: [
        { id: "a", name: "A", usual_currency: "USD", usual_currency_source: "invoices" },
        { id: "b", name: "B", usual_currency: "EUR", usual_currency_source: "person" },
        { id: "c", name: "C", usual_currency: null },
      ],
    });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted.stated).toBe(2);
    expect(counted.fromInvoices).toBe(1);
    expect(
      usualCurrencyCoverageSentence({ stated: 2, total: 3, fromInvoices: 1 }),
    ).toBe(
      "2 of your 3 vendors have a usual currency on file. Orders to the other 1 start with no currency until one is noted. 1 of them was filled in from their invoices.",
    );
  });

  it("falls back to the old columns before the migration is applied (42703)", async () => {
    const calls: string[] = [];
    const supabase: any = {
      from() {
        let cols = "";
        const q: any = {
          select: (c: string) => {
            cols = c;
            calls.push(c);
            return q;
          },
          eq: () => q,
          then: (res: any) =>
            res(
              cols.includes("usual_currency_source")
                ? { data: null, error: { code: "42703", message: "column does not exist" } }
                : { data: [{ id: "a", name: "A", usual_currency: "USD" }], error: null },
            ),
        };
        return q;
      },
    };
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(calls).toHaveLength(2);
    expect(counted).toMatchObject({ stated: 1, total: 1, fromInvoices: 0 });
  });
});

describe("setUsualCurrency before the VEN-W13 migration", () => {
  it("a missing source column (PGRST204 on an UPDATE) falls back to the three old columns, and the save lands", async () => {
    const writes: Record<string, unknown>[] = [];
    const supabase: any = {
      from() {
        let patch: Record<string, unknown> | null = null;
        const q: any = {
          select: () => q,
          eq: () => q,
          update: (p: Record<string, unknown>) => {
            patch = p;
            writes.push(p);
            return q;
          },
          maybeSingle: async () => {
            if (!patch) return { data: { usual_currency: null }, error: null };
            return "usual_currency_source" in patch
              ? {
                  data: null,
                  error: {
                    code: "PGRST204",
                    message:
                      "Could not find the 'usual_currency_invoice_count' column of 'providers' in the schema cache",
                  },
                }
              : { data: { usual_currency: "USD", usual_currency_set_at: "2026-10-01T00:00:00Z" }, error: null };
          },
        };
        return q;
      },
    };
    const s = svc(supabase);
    (s as any).getUsualCurrency = async () => ({ code: null });
    const out = await s.setUsualCurrency({ providerId: "p1", restaurantId: "rest-1", code: "USD", userId: "u1" });
    expect(out.code).toBe("USD");
    expect(writes).toHaveLength(2);
    expect(writes[1]).not.toHaveProperty("usual_currency_source");
  });
});

describe("usualCurrencyCoverageSentence — never an empty panel", () => {
  it("says none of them, with the number, when nobody has stated one", () => {
    const s = usualCurrencyCoverageSentence({ stated: 0, total: 14 });
    expect(s).toContain("None of your 14 vendors has a usual currency on file");
    // Nothing is assumed in their place: the sentence says an order starts empty.
    expect(s).toContain("an order starts with no currency");
  });

  it("prints the fraction the founder asked for", () => {
    expect(usualCurrencyCoverageSentence({ stated: 3, total: 14 })).toContain(
      "3 of your 14 vendors have a usual currency on file",
    );
  });

  it("counts down the remainder so the reader knows what is left", () => {
    expect(usualCurrencyCoverageSentence({ stated: 3, total: 14 })).toContain(
      "the other 11",
    );
  });

  it("says so when every vendor has been asked", () => {
    expect(usualCurrencyCoverageSentence({ stated: 14, total: 14 })).toContain(
      "All 14 of your vendors have a usual currency on file",
    );
  });

  it("has a sentence for a house with no vendors at all", () => {
    const s = usualCurrencyCoverageSentence({ stated: 0, total: 0 });
    expect(s).toContain("No vendors yet");
    expect(s.trim()).not.toBe("");
  });

  it("agrees with itself in the singular", () => {
    expect(usualCurrencyCoverageSentence({ stated: 1, total: 1 })).toContain(
      "Your one vendor has a usual currency on file",
    );
    expect(usualCurrencyCoverageSentence({ stated: 0, total: 1 })).toContain(
      "Your one vendor has no usual currency on file",
    );
  });

  it("never claims a currency for anybody", () => {
    for (const args of [
      { stated: 0, total: 0 },
      { stated: 0, total: 14 },
      { stated: 3, total: 14 },
      { stated: 14, total: 14 },
    ])
      expect(usualCurrencyCoverageSentence(args)).not.toMatch(/\bUSD\b/);
  });
});

describe("GET /providers/usual-currency/coverage", () => {
  const controller = (counted: any) =>
    new ProvidersController(
      { usualCurrencyCoverage: async () => counted } as any,
      { resolveRestaurantRole: async () => "staff" } as any,
    );

  it("returns the counts, the names and the sentence together", async () => {
    const counted = {
      stated: 3,
      total: 14,
      unstated: [{ id: "b", name: "Bodega Álvaro", recorded: null }],
    };
    const res = await controller(counted).usualCurrencyCoverage({
      userId: "u-1",
      restaurantId: "rest-1",
    });
    expect(res.stated).toBe(3);
    expect(res.total).toBe(14);
    expect(res.unstated).toEqual(counted.unstated);
    expect(res.sentence).toBe(
      usualCurrencyCoverageSentence({ stated: 3, total: 14 }),
    );
  });

  it("is readable by staff — it is information, not an act", async () => {
    // The role service is never consulted on this route. Stating a currency is
    // manager-gated; SEEING which vendors are unanswered is what makes a staff
    // member ask a manager to answer them.
    const roles = { resolveRestaurantRole: jest.fn() };
    const c = new ProvidersController(
      {
        usualCurrencyCoverage: async () => ({
          stated: 0,
          total: 2,
          unstated: [],
        }),
      } as any,
      roles as any,
    );
    await c.usualCurrencyCoverage({ userId: "u-1", restaurantId: "rest-1" });
    expect(roles.resolveRestaurantRole).not.toHaveBeenCalled();
  });

  it("lets the read's failure through as a failure", async () => {
    const c = new ProvidersController(
      {
        usualCurrencyCoverage: async () => {
          throw new ServiceUnavailableException("statement timeout");
        },
      } as any,
      { resolveRestaurantRole: async () => "manager" } as any,
    );
    await expect(
      c.usualCurrencyCoverage({ userId: "u-1", restaurantId: "rest-1" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
