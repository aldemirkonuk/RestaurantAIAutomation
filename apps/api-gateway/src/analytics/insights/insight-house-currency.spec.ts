import { stateBookFrom } from "./item-state";
import {
  HOUSE_CURRENCY_WORD,
  INSIGHT_GENERATOR_VERSION,
  InsightGeneratorService,
  writtenInOtherMoney,
} from "./insight-generator.service";
import { CURRENCY_NOT_RECORDED_SENTENCE as NOT_RECORDED, fmtMoney, verbalize } from "./insight-verbalizer";

/**
 * Every amount in an insight sentence is in the house's money (version 17).
 * r7 browser check, 2026-11-12: a lira house read "($181)" on /reports
 * because the verbalizer wrote `$` before every amount.
 */

const peer = { entity: "Table 4", measureLabel: "average check", unit: "currency" as const, value: 181, rank: 1, peerCount: 12, deltaPct: 0.31 };

describe("the verbalizer prints the house's money", () => {
  it("a lira house reads lira, never $; a dollar house still reads dollars", () => {
    const s = verbalize("peer", { ...peer, currency: "TRY" });
    expect(s).toBe("Table 4 ranks #1 of 12 by average check, 31% above the group average (₺181).");
    expect(verbalize("peer", { ...peer, currency: "USD" })).toContain("($181)");
  });

  it("thousands keep their short form; a code with no symbol is spaced", () => {
    expect(fmtMoney(10800, "TRY")).toBe("₺10.8k");
    expect(fmtMoney(1000, "GBP")).toBe("£1.0k");
    expect(fmtMoney(181, "CHF")).toBe("CHF 181");
  });

  it("both amounts of a comparison carry the mark", () => {
    const s = verbalize("baseline", { entity: "Tuesday", measureLabel: "sales", unit: "currency", value: 318, baseline: 504, deltaPct: -0.37, direction: "below", currency: "TRY" });
    expect(s).toContain("(₺318 vs ₺504)");
  });

  it("no stated currency: bare amounts, said once at the end", () => {
    const s = verbalize("peer", { ...peer, currency: null })!;
    expect(s).toBe(`Table 4 ranks #1 of 12 by average check, 31% above the group average (181). ${NOT_RECORDED}`);
    expect(verbalize("peer", { ...peer, unit: "count", currency: null })).not.toContain(NOT_RECORDED);
  });

  it("an unreadable currency withholds a sentence that prints an amount, not one that prints a percentage", () => {
    expect(verbalize("peer", { ...peer })).toBeNull();
    expect(verbalize("trend", { measureLabel: "sales", unit: "currency", trendPctPerWeek: 0.12, n: 28 })).toBe(
      "sales has been climbing about 12% per week over the last 28 days.",
    );
  });
});

const dayBack = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const weekdayOf = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** 90 days of checks; yesterday's weekday earns more, and yesterday came in soft. */
function checks() {
  const target = weekdayOf(dayBack(1));
  return Array.from({ length: 90 }, (_, i) => {
    const d = dayBack(90 - i);
    const total = i === 89 ? 600 : weekdayOf(d) === target ? 1000 : 800;
    return { id: `c-${d}`, source: "t", table_id: null, server_name: null, server_external_id: null, opened_at: `${d}T18:00:00.000Z`, closed_at: `${d}T20:00:00.000Z`, covers: 2, total, tip: 0, items: null };
  });
}

type House = { currency?: string | null; currencyError?: boolean };

/** A client whose `restaurants` read answers by the `id` asked for. */
function makeClient(houses: Record<string, House>, stored: any[] = [], inserts: any[] = []) {
  return {
    from(table: string) {
      const f: Record<string, unknown> = {};
      const b: any = {};
      for (const m of ["select", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range", "delete"]) b[m] = () => b;
      b.eq = (col: string, v: unknown) => ((f[col] = v), b);
      b.insert = (rows: any[]) => (inserts.push(rows), Promise.resolve({ error: null }));
      const answer = () => {
        if (table === "restaurants") {
          const h = houses[String(f.id)] ?? {};
          return h.currencyError ? { data: null, error: { message: "permission denied" } } : { data: { currency: h.currency ?? null, timezone: null, country: null }, error: null };
        }
        if (table === "pos_checks") return { data: checks(), error: null, count: 90 };
        if (table === "analytics_insights") return { data: stored.filter((r) => r.restaurant_id === f.restaurant_id), error: null };
        return { data: [], error: null };
      };
      b.maybeSingle = () => Promise.resolve(answer());
      b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
      return b;
    },
  };
}

const generator = (client: any) =>
  new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    { load: async () => ({ dates: new Set(), readable: true, problem: null }) } as any,
    { readState: async () => ({ book: stateBookFrom([]), readable: true, problem: null }) } as any,
  );

const BASELINE = "overall.revenue.vs_same_weekday";
const said = (out: any) => out.insights.find((i: any) => i.candidateKey === BASELINE);

describe("the generator writes each house's money, and stamps it", () => {
  it("a lira house's sentence is in lira, and its row says so", async () => {
    const out = await generator(makeClient({ r1: { currency: "TRY" } })).generate("r1", { persist: false });
    expect(said(out).sentence).toMatch(/\(₺600 vs ₺1\.0k, over \d+ past \w+s\)\.$/);
    expect(said(out).evidence.currency).toBe("TRY");
    for (const i of out.insights) expect(i.sentence).not.toContain("$");
  });

  it("two houses computed at once by one service never share a currency", async () => {
    const svc = generator(makeClient({ lira: { currency: "TRY" }, pound: { currency: "GBP" } }));
    const [a, b] = await Promise.all([svc.generate("lira", { persist: false }), svc.generate("pound", { persist: false })]);
    expect(said(a).sentence).toContain("₺600");
    expect(said(b).sentence).toContain("£600");
  });

  it("an unreadable currency withholds the amounts, names the read, and stores nothing", async () => {
    const inserts: any[] = [];
    const out = await generator(makeClient({ r1: { currencyError: true } }, [], inserts)).generate("r1", { persist: true });
    expect(said(out)).toBeUndefined();
    expect(out.sourcesUnread).toContain(HOUSE_CURRENCY_WORD);
    expect(out.persisted).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("the stored read refuses a sentence written in other money", () => {
  const row = (currency: string | null | undefined, unit = "currency") => ({
    restaurant_id: "r1", candidate_key: BASELINE, category: "sales", sentence: "x", score: 1, subject: null, period_key: null,
    generator_version: INSIGHT_GENERATOR_VERSION,
    evidence: { measureLabel: "sales", unit, ...(currency === undefined ? {} : { currency }) },
  });

  it("a set holding a dollar row on a house that now reports in lira is absent, so the caller recomputes", async () => {
    const out = await generator(makeClient({ r1: { currency: "TRY" } }, [row("USD"), row(null, "count")])).readStored("r1");
    expect(out).toMatchObject({ read: 0, rows: [] });
    expect(await generator(makeClient({ r1: { currency: "TRY" } }, [row(null)])).getStored("r1")).toEqual([]);
  });

  it("rows in the house's own money are served; an unreadable currency serves rows as written", async () => {
    expect(await generator(makeClient({ r1: { currency: "TRY" } }, [row("TRY"), row(undefined, "count")])).getStored("r1")).toHaveLength(2);
    expect(await generator(makeClient({ r1: { currencyError: true } }, [row("USD")])).getStored("r1")).toHaveLength(1);
  });

  it("only a money row can be in other money", () => {
    const ev = (unit: "count" | "currency", currency?: string | null) => ({ measureLabel: "x", unit, currency });
    expect(writtenInOtherMoney(ev("count"), "TRY")).toBe(false);
    expect(writtenInOtherMoney(ev("currency", "TRY"), "TRY")).toBe(false);
    expect(writtenInOtherMoney(ev("currency", "USD"), "TRY")).toBe(true);
    expect(writtenInOtherMoney(ev("currency", null), null)).toBe(false);
  });
});
