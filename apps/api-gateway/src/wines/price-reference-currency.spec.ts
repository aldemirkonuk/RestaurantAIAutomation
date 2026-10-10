import { priceReferenceCurrencyFromPayload } from "./price-reference-currency";
import { WineSubmissionsService } from "./wine-submissions.service";
import { WinesService } from "./wines.service";

/**
 * F-918 follow-up — every writer of `master_wine_library.price_reference`
 * also writes `price_reference_currency`, from the currency the source named,
 * and NULL when the source named none. Before this, both submission writers
 * left the column out, so every new row read "not recorded" even when the
 * sender had said which currency its price was in.
 */

type Row = Record<string, any>;

describe("priceReferenceCurrencyFromPayload", () => {
  it("takes the code the payload names, in any of the spellings submissions use", () => {
    expect(
      priceReferenceCurrencyFromPayload({ priceReferenceCurrency: "TRY" }, 62),
    ).toBe("TRY");
    expect(
      priceReferenceCurrencyFromPayload(
        { price_reference_currency: "USD" },
        62,
      ),
    ).toBe("USD");
    expect(priceReferenceCurrencyFromPayload({ currency: " eur " }, 62)).toBe(
      "EUR",
    );
  });

  it("never assumes one: no code, a symbol, or junk is not recorded", () => {
    expect(priceReferenceCurrencyFromPayload({}, 62)).toBeNull();
    expect(priceReferenceCurrencyFromPayload(null, 62)).toBeNull();
    expect(priceReferenceCurrencyFromPayload({ currency: "$" }, 62)).toBeNull();
    expect(
      priceReferenceCurrencyFromPayload({ currency: "dollars" }, 62),
    ).toBeNull();
    expect(priceReferenceCurrencyFromPayload({ currency: 840 }, 62)).toBeNull();
  });

  it("an unreadable first spelling does not fall through to a looser one", () => {
    expect(
      priceReferenceCurrencyFromPayload(
        { priceReferenceCurrency: "₺", currency: "USD" },
        62,
      ),
    ).toBeNull();
  });

  it("writes no currency for a price that is not there", () => {
    expect(
      priceReferenceCurrencyFromPayload({ currency: "TRY" }, null),
    ).toBeNull();
    expect(
      priceReferenceCurrencyFromPayload({ currency: "TRY" }, undefined),
    ).toBeNull();
  });
});

/** A library that accepts any write and keeps what it was given. */
function submissionsDb(payload: Row) {
  const written: Row[] = [];
  const library = () => {
    let pending: Row | null = null;
    const q: any = {
      upsert: (row: Row) => ((pending = row), q),
      insert: (row: Row) => ((pending = row), q),
      select: () => q,
      eq: () => q,
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => {
        if (!pending) return { data: null, error: null };
        written.push(pending);
        return { data: { id: "mw-new" }, error: null };
      },
      single: async () => {
        written.push(pending!);
        return { data: { id: "mw-new" }, error: null };
      },
    };
    return q;
  };
  const submissions = () => {
    const q: any = {
      select: () => q,
      order: () => q,
      eq: (col: string) =>
        col === "id" ? Promise.resolve({ error: null }) : q,
      update: () => q,
      limit: async () => ({
        data: [{ id: "sub-1", status: "pending", payload }],
        error: null,
      }),
    };
    return q;
  };
  const supabase = {
    from: (t: string) =>
      t === "master_wine_library" ? library() : submissions(),
    rpc: async () => ({ data: [], error: null }),
  };
  return { db: { supabase, getClient: () => supabase } as any, written };
}

const specific = { name: "Etna Rosso", producer: "Benanti", vintage: 2021 };

describe("WineSubmissionsService worker writes the price's currency (F-918)", () => {
  const run = async (payload: Row) => {
    const t = submissionsDb(payload);
    const s = new WineSubmissionsService(t.db);
    (s as any).logger.error = jest.fn();
    await s.processPendingSubmissions();
    expect(t.written).toHaveLength(1);
    return t.written[0];
  };

  it("records the currency the submission named", async () => {
    const row = await run({
      ...specific,
      priceReference: 62,
      priceReferenceCurrency: "TRY",
    });
    expect(row.price_reference).toBe(62);
    expect(row.price_reference_currency).toBe("TRY");
  });

  it("leaves it NULL when the submission did not say — never USD", async () => {
    const row = await run({ ...specific, priceReference: 62 });
    expect(row).toHaveProperty("price_reference_currency", null);
  });
});

describe("WinesService.processPendingSubmissions writes the price's currency (F-918)", () => {
  const run = async (payload: Row) => {
    const t = submissionsDb(payload);
    const s = new WinesService(t.db);
    (s as any).logger.error = jest.fn();
    await s.processPendingSubmissions();
    expect(t.written).toHaveLength(1);
    return t.written[0];
  };

  it("records the currency the submission named", async () => {
    const row = await run({
      ...specific,
      price_reference: 48,
      price_reference_currency: "USD",
    });
    expect(row.price_reference).toBe(48);
    expect(row.price_reference_currency).toBe("USD");
  });

  it("leaves it NULL when the submission did not say — never USD", async () => {
    const row = await run({ ...specific, price: 48 });
    expect(row).toHaveProperty("price_reference_currency", null);
  });
});
