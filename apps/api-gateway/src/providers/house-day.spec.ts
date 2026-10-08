import { calendarDayWords, houseDayWords } from "./house-day";
import { ProvidersService } from "./providers.service";
import { makeFmt } from "./scorecard/vendor-scorecard.copy";
import { vendorCurrencySentence } from "./vendor-currency";

/**
 * VEN-W23 (founder, 2026-10-01): a day on the vendor sheet is the HOUSE's own
 * calendar day, written out in English. The defect that triggered it: a
 * currency stated at 9:20 pm in Chicago on Oct 1 read "on 2026-10-02".
 */
describe("houseDayWords — the house's calendar day, in words", () => {
  // 02:20 UTC on Oct 2 is 9:20 pm on Oct 1 in Chicago (CDT, UTC-5).
  const EVENING_IN_CHICAGO = "2026-10-02T02:20:00.000Z";

  it("reads a 02:20 UTC moment as the PREVIOUS Chicago day", () => {
    expect(houseDayWords(EVENING_IN_CHICAGO, "America/Chicago")).toBe(
      "Oct 1, 2026",
    );
  });

  it("reads the same moment as the next day in Istanbul", () => {
    expect(houseDayWords(EVENING_IN_CHICAGO, "Europe/Istanbul")).toBe(
      "Oct 2, 2026",
    );
  });

  it("with no zone, reads UTC and SAYS so — never a guessed zone", () => {
    expect(houseDayWords(EVENING_IN_CHICAGO, null)).toBe("Oct 2, 2026 (UTC)");
    expect(houseDayWords(EVENING_IN_CHICAGO, "Not/AZone")).toBe(
      "Oct 2, 2026 (UTC)",
    );
  });

  it("an unreadable moment is null, not a date", () => {
    expect(houseDayWords("not a date", "America/Chicago")).toBeNull();
    expect(houseDayWords(null, "America/Chicago")).toBeNull();
  });
});

describe("calendarDayWords — a day that is already the house's", () => {
  it("writes it out without shifting it", () => {
    expect(calendarDayWords("2026-09-13")).toBe("Sep 13, 2026");
    expect(calendarDayWords("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("the scorecard's dates are words in every locale, never 09/13 or 13.09", () => {
    expect(makeFmt("tr-TR").date("2026-09-13")).toBe("Sep 13, 2026");
    expect(makeFmt("en-US").date("2026-09-13")).toBe("Sep 13, 2026");
    expect(makeFmt(null).date("2026-09-13")).toBe("Sep 13, 2026");
  });
});

describe("vendorCurrencySentence — 'stated on' is the house's day", () => {
  const base = {
    code: "USD",
    setByName: "Aldemir Konuk",
    setAt: "2026-10-02T02:20:00.000Z",
    vendorName: "Sysco",
  };

  it("a Chicago evening is stated on Oct 1, not 2026-10-02", () => {
    const s = vendorCurrencySentence({ ...base, houseZone: "America/Chicago" });
    expect(s).toContain("Stated by Aldemir Konuk on Oct 1, 2026.");
    expect(s).not.toContain("2026-10-02");
  });

  it("a house with no zone gets the UTC day, labelled", () => {
    const s = vendorCurrencySentence({ ...base, houseZone: null });
    expect(s).toContain("Stated by Aldemir Konuk on Oct 2, 2026 (UTC).");
  });
});

describe("ProvidersService.getUsualCurrency — the house's zone travels with the day", () => {
  function fakeDb(house: { data: unknown; error: unknown }) {
    const asked: { table: string; eq: [string, unknown][] }[] = [];
    const answers: Record<string, { data: unknown; error: unknown }> = {
      providers: {
        data: {
          name: "Sysco",
          usual_currency: "USD",
          usual_currency_set_by: "u-1",
          usual_currency_set_at: "2026-10-02T02:20:00.000Z",
          usual_currency_source: "person",
        },
        error: null,
      },
      users: { data: { name: "Aldemir Konuk" }, error: null },
      restaurants: house,
    };
    const from = (table: string) => {
      const entry = { table, eq: [] as [string, unknown][] };
      asked.push(entry);
      const q: any = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === "maybeSingle" || prop === "single")
              return () =>
                Promise.resolve(answers[table] ?? { data: null, error: null });
            if (prop === "then")
              return (ok: (v: unknown) => unknown) =>
                ok({ data: [], error: null });
            if (prop === "eq")
              return (col: string, val: unknown) => {
                entry.eq.push([col, val]);
                return q;
              };
            return () => q;
          },
        },
      );
      return q;
    };
    return { supabase: { from }, asked };
  }

  const svc = (supabase: unknown) =>
    new ProvidersService(
      { supabase } as never,
      { track: async () => undefined } as never,
      {} as never,
    );

  it("reads restaurants.timezone by the token's house id and returns it", async () => {
    const { supabase, asked } = fakeDb({
      data: { timezone: "America/Chicago", country: "US" },
      error: null,
    });
    const got = await svc(supabase).getUsualCurrency("p-1", "r-1");
    expect(got.houseZone).toBe("America/Chicago");
    const house = asked.find((a) => a.table === "restaurants");
    expect(house?.eq).toEqual([["id", "r-1"]]);
    expect(
      vendorCurrencySentence({ ...got, houseZone: got.houseZone }),
    ).toContain("on Oct 1, 2026.");
  });

  it("a failed house read leaves the zone null (UTC, labelled) and the currency on screen", async () => {
    const { supabase } = fakeDb({ data: null, error: { message: "boom" } });
    const got = await svc(supabase).getUsualCurrency("p-1", "r-1");
    expect(got.code).toBe("USD");
    expect(got.houseZone).toBeNull();
  });
});
