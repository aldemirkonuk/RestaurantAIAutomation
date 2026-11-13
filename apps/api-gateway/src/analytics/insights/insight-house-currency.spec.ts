import { stateBookFrom } from "./item-state";
import {
  HOUSE_CURRENCY_WORD,
  INSIGHT_GENERATOR_VERSION,
  InsightGeneratorService,
  writtenInOtherMoney,
} from "./insight-generator.service";
import {
  CURRENCY_NOT_RECORDED_SENTENCE,
  fmtMoney,
  verbalize,
} from "./insight-verbalizer";

/**
 * Every amount in an insight sentence is in the house's money (version 17).
 *
 * The r7 browser check (2026-11-12) set the local house to TRY and read
 * /reports: "($181)" and "($318 vs $504…)", verbatim, because `fmtMoney` in
 * the verbalizer wrote `$` before every amount, whatever the house reports in.
 * These tests pin the three states of a house's currency — stated, not stated,
 * unreadable — and the stored read that refuses a sentence written in money
 * the house no longer reports in.
 */

const peer = {
  entity: "Table 4",
  measureLabel: "average check",
  unit: "currency" as const,
  value: 181,
  rank: 1,
  peerCount: 12,
  deltaPct: 0.31,
};

describe("the verbalizer prints the house's money", () => {
  it("a lira house reads lira, never $", () => {
    const s = verbalize("peer", { ...peer, currency: "TRY" });
    expect(s).toBe(
      "Table 4 ranks #1 of 12 by average check, 31% above the group average (₺181).",
    );
    expect(s).not.toContain("$");
  });

  it("a dollar house still reads dollars", () => {
    expect(verbalize("peer", { ...peer, currency: "USD" })).toContain("($181)");
  });

  it("thousands keep their short form in the house's money", () => {
    expect(fmtMoney(10800, "TRY")).toBe("₺10.8k");
    expect(fmtMoney(1000, "GBP")).toBe("£1.0k");
  });

  it("a code with no symbol is printed as the code, spaced", () => {
    expect(fmtMoney(181, "CHF")).toBe("CHF 181");
  });

  it("both amounts of a comparison carry the mark", () => {
    const s = verbalize("baseline", {
      entity: "Tuesday",
      measureLabel: "sales",
      unit: "currency",
      value: 318,
      baseline: 504,
      deltaPct: -0.37,
      direction: "below",
      currency: "TRY",
    });
    expect(s).toContain("(₺318 vs ₺504)");
  });

  it("no stated currency: bare amounts, said once at the end", () => {
    const s = verbalize("peer", { ...peer, currency: null })!;
    expect(s).toBe(
      `Table 4 ranks #1 of 12 by average check, 31% above the group average (181). ${CURRENCY_NOT_RECORDED_SENTENCE}`,
    );
    expect(s.split(CURRENCY_NOT_RECORDED_SENTENCE)).toHaveLength(2);
  });

  it("an unreadable currency withholds a sentence that prints an amount", () => {
    expect(verbalize("peer", { ...peer })).toBeNull();
  });

  it("a money measure that prints only a percentage needs no currency", () => {
    const s = verbalize("trend", {
      measureLabel: "sales",
      unit: "currency",
      trendPctPerWeek: 0.12,
      n: 28,
    });
    expect(s).toBe(
      "sales has been climbing about 12% per week over the last 28 days.",
    );
  });

  it("a count is never given a currency caveat", () => {
    const s = verbalize("peer", { ...peer, unit: "count", currency: null });
    expect(s).not.toContain(CURRENCY_NOT_RECORDED_SENTENCE);
  });
});

// ---------------------------------------------------------------------------
// The generator, with a client that answers per house
// ---------------------------------------------------------------------------

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** 90 days of checks; yesterday's weekday earns more, yesterday came in soft. */
function checks() {
  const target = weekdayOf(dayBack(1));
  const out: any[] = [];
  for (let back = 90; back >= 1; back--) {
    const d = dayBack(back);
    const total = back === 1 ? 600 : weekdayOf(d) === target ? 1000 : 800;
    out.push({
      id: `c-${d}`,
      source: "t",
      table_id: null,
      server_name: null,
      server_external_id: null,
      opened_at: `${d}T18:00:00.000Z`,
      closed_at: `${d}T20:00:00.000Z`,
      covers: 2,
      total,
      tip: 0,
      items: null,
    });
  }
  return out;
}

type House = { currency?: string | null; currencyError?: boolean };

/**
 * A client whose `restaurants` read answers by the `id` asked for, so two
 * houses computed at once by ONE service each get their own money.
 */
function makeClient(
  houses: Record<string, House>,
  stored: any[] = [],
  log: { inserts: any[][] } = { inserts: [] },
) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const b: any = {};
      for (const m of [
        "select",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "is",
        "or",
        "not",
        "order",
        "limit",
        "in",
        "range",
        "delete",
      ])
        b[m] = () => b;
      b.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return b;
      };
      b.insert = (rows: any[]) => {
        log.inserts.push(rows);
        return Promise.resolve({ error: null });
      };
      const answer = () => {
        if (table === "restaurants") {
          const h = houses[String(filters.id)] ?? {};
          if (h.currencyError)
            return { data: null, error: { message: "permission denied" } };
          return {
            data: {
              currency: h.currency ?? null,
              timezone: null,
              country: null,
            },
            error: null,
          };
        }
        if (table === "pos_checks")
          return { data: checks(), error: null, count: 90 };
        if (table === "analytics_insights")
          return {
            data: stored.filter(
              (r) => r.restaurant_id === filters.restaurant_id,
            ),
            error: null,
          };
        return { data: [], error: null };
      };
      b.maybeSingle = () => Promise.resolve(answer());
      b.single = () => Promise.resolve(answer());
      b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
      return b;
    },
  };
}

function generator(client: any) {
  return new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({ dates: new Set(), readable: true, problem: null }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom([]),
        readable: true,
        problem: null,
      }),
    } as any,
  );
}

const BASELINE = "overall.revenue.vs_same_weekday";

describe("the generator writes each house's money, and stamps it", () => {
  it("a lira house's sentence is in lira, and its row says so", async () => {
    const out = await generator(
      makeClient({ r1: { currency: "TRY" } }),
    ).generate("r1", { persist: false });
    const hit = out.insights.find((i) => i.candidateKey === BASELINE)!;
    expect(hit.sentence).toMatch(/\(₺600 vs ₺1\.0k, over \d+ past \w+s\)\.$/);
    expect(hit.evidence.currency).toBe("TRY");
    for (const i of out.insights) expect(i.sentence).not.toContain("$");
  });

  it("two houses computed at once by one service never share a currency", async () => {
    const svc = generator(
      makeClient({ lira: { currency: "TRY" }, pound: { currency: "GBP" } }),
    );
    const [a, b] = await Promise.all([
      svc.generate("lira", { persist: false }),
      svc.generate("pound", { persist: false }),
    ]);
    expect(
      a.insights.find((i) => i.candidateKey === BASELINE)!.sentence,
    ).toContain("₺600");
    expect(
      b.insights.find((i) => i.candidateKey === BASELINE)!.sentence,
    ).toContain("£600");
  });

  it("an unreadable currency withholds the amounts, names the read, and stores nothing", async () => {
    const log = { inserts: [] as any[][] };
    const out = await generator(
      makeClient({ r1: { currencyError: true } }, [], log),
    ).generate("r1", { persist: true });
    expect(
      out.insights.find((i) => i.candidateKey === BASELINE),
    ).toBeUndefined();
    expect(out.sourcesUnread).toContain(HOUSE_CURRENCY_WORD);
    expect(out.persisted).toBe(false);
    expect(log.inserts).toHaveLength(0);
  });
});

describe("the stored read refuses a sentence written in other money", () => {
  const row = (currency: string | null | undefined, unit = "currency") => ({
    restaurant_id: "r1",
    candidate_key: BASELINE,
    category: "sales",
    sentence: "x",
    score: 1,
    subject: null,
    period_key: null,
    generator_version: INSIGHT_GENERATOR_VERSION,
    evidence: {
      measureLabel: "sales",
      unit,
      ...(currency === undefined ? {} : { currency }),
    },
  });

  it("a row stamped in dollars on a house that now reports in lira is absent", async () => {
    const svc = generator(
      makeClient({ r1: { currency: "TRY" } }, [row("USD"), row(null, "count")]),
    );
    const out = await svc.readStored("r1");
    expect(out.read).toBe(0);
    expect(out.rows).toEqual([]);
  });

  it("a row stamped with no currency is absent once the house states one", async () => {
    const svc = generator(makeClient({ r1: { currency: "TRY" } }, [row(null)]));
    expect(await svc.getStored("r1")).toEqual([]);
  });

  it("rows in the house's own money are served", async () => {
    const svc = generator(
      makeClient({ r1: { currency: "TRY" } }, [
        row("TRY"),
        row(undefined, "count"),
      ]),
    );
    expect(await svc.getStored("r1")).toHaveLength(2);
  });

  it("when the currency cannot be read, rows go out in the money they name", async () => {
    const svc = generator(
      makeClient({ r1: { currencyError: true } }, [row("USD")]),
    );
    expect(await svc.getStored("r1")).toHaveLength(1);
  });

  it("only a money row can be in other money", () => {
    expect(
      writtenInOtherMoney({ measureLabel: "x", unit: "count" }, "TRY"),
    ).toBe(false);
    expect(
      writtenInOtherMoney(
        { measureLabel: "x", unit: "currency", currency: "TRY" },
        "TRY",
      ),
    ).toBe(false);
    expect(
      writtenInOtherMoney(
        { measureLabel: "x", unit: "currency", currency: "USD" },
        "TRY",
      ),
    ).toBe(true);
    expect(
      writtenInOtherMoney(
        { measureLabel: "x", unit: "currency", currency: null },
        null,
      ),
    ).toBe(false);
  });
});
