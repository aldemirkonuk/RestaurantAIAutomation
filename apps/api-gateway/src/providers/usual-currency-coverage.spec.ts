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
      "id, name, usual_currency, is_active, deleted_at",
    );
    expect(seen[0].restaurantId).toBe("rest-9");
  });

  it("is zero of zero for a house with no vendors, not an error", async () => {
    const { supabase } = makeDb({ rows: [] });
    const counted = await svc(supabase).usualCurrencyCoverage("rest-1");
    expect(counted).toEqual({ stated: 0, total: 0, unstated: [] });
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

describe("usualCurrencyCoverageSentence — never an empty panel", () => {
  it("says none of them, with the number, when nobody has stated one", () => {
    const s = usualCurrencyCoverageSentence({ stated: 0, total: 14 });
    expect(s).toContain("None of your 14 vendors has stated a usual currency");
    expect(s).toContain("Nothing is assumed in their place");
  });

  it("prints the fraction the founder asked for", () => {
    expect(usualCurrencyCoverageSentence({ stated: 3, total: 14 })).toContain(
      "3 of your 14 vendors have stated a usual currency",
    );
  });

  it("counts down the remainder so the reader knows what is left", () => {
    expect(usualCurrencyCoverageSentence({ stated: 3, total: 14 })).toContain(
      "remaining 11",
    );
  });

  it("says so when every vendor has been asked", () => {
    expect(usualCurrencyCoverageSentence({ stated: 14, total: 14 })).toContain(
      "All 14 of your vendors have stated a usual currency",
    );
  });

  it("has a sentence for a house with no vendors at all", () => {
    const s = usualCurrencyCoverageSentence({ stated: 0, total: 0 });
    expect(s).toContain("no vendors on this house's book");
    expect(s.trim()).not.toBe("");
  });

  it("agrees with itself in the singular", () => {
    expect(usualCurrencyCoverageSentence({ stated: 1, total: 1 })).toContain(
      "All 1 of your vendor has stated",
    );
    expect(usualCurrencyCoverageSentence({ stated: 0, total: 1 })).toContain(
      "None of your 1 vendor has stated",
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
      id: "u-1",
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
    await c.usualCurrencyCoverage({ id: "u-1", restaurantId: "rest-1" });
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
      c.usualCurrencyCoverage({ id: "u-1", restaurantId: "rest-1" }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
