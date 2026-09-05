import {
  GROUP_SILENCE_SENTENCE,
  MIN_OUTLIER_SAMPLE,
  REJUDGE_CRON,
  REJUDGE_ENABLED_FLAG,
  REJUDGE_WINDOW_DAYS,
  RejudgeRow,
  isRejudgeArmed,
  planRejudge,
} from "./outlier-rejudge";
import { OutlierRejudgeService } from "./outlier-rejudge.service";
import { ObservationRow, priceBelowAverage } from "./price-below-average";

/**
 * The re-judge exists to do the one thing the write-time flag cannot: change
 * its mind when later evidence arrives. So the tests that matter are the
 * flips, the floor, and the refusals — not the arithmetic, which is
 * `flagOutliers`' and is tested where it lives.
 */

const NOW = new Date("2026-09-04T12:00:00.000Z");
const WINE = "11111111-2222-3333-4444-555555555555";

let seq = 0;
const rrow = (over: Partial<RejudgeRow> = {}): RejudgeRow => ({
  id: `row-${++seq}`,
  restaurant_id: "rest-1",
  master_wine_id: WINE,
  signature_hash: null,
  source_type: "invoice",
  observed_at: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
  raw_price: 20,
  currency: "USD",
  pack_size: 1,
  unit_volume_ml: 750,
  yield_factor: 1,
  is_outlier: false,
  outlier_basis: null,
  ...over,
});

describe("planRejudge", () => {
  it("flags the row that is genuinely deviant and leaves the rest clean", () => {
    const rows = [
      rrow({ raw_price: 20 }),
      rrow({ raw_price: 20.5 }),
      rrow({ raw_price: 19.8 }),
      rrow({ raw_price: 20.2 }),
      // $21.75 read as $2175 — the lost-decimal failure the register exists for.
      rrow({ raw_price: 2175 }),
    ];

    const plan = planRejudge(rows, NOW);
    expect(plan.groups).toHaveLength(1);
    const g = plan.groups[0];
    expect(g.judged).toBe(true);
    expect(g.updates.filter((u) => u.isOutlier).map((u) => u.id)).toEqual([
      rows[4].id,
    ]);
    expect(g.updates.every((u) => u.basis === "rejudge")).toBe(true);
    expect(g.updates.every((u) => u.judgedAt === NOW.toISOString())).toBe(true);
  });

  it("CLEARS a row flagged at write time once later evidence arrives", () => {
    // The whole reason this pass exists. The house's first invoice at $95
    // landed while four cheap siblings were on the register, so the write-time
    // judge flagged it. Six more invoices near $95 have arrived since, and the
    // $95 is now plainly ordinary — but the write-time judge can never look
    // again.
    const flagged = rrow({
      raw_price: 95,
      is_outlier: true,
      outlier_basis: "write_time",
    });
    const rows = [
      flagged,
      rrow({ raw_price: 94 }),
      rrow({ raw_price: 96 }),
      rrow({ raw_price: 95.5 }),
      rrow({ raw_price: 94.5 }),
      rrow({ raw_price: 95.2 }),
    ];

    const plan = planRejudge(rows, NOW);
    const verdict = plan.groups[0].updates.find((u) => u.id === flagged.id)!;

    expect(verdict.isOutlier).toBe(false);
    expect(verdict.flipped).toBe(true);
    expect(verdict.reason).toMatch(/Judged clean by the nightly re-judge/);
  });

  it("the cleared row then reaches the reader, which is the point", () => {
    // The readers are unchanged: they still filter `is_outlier`. This test
    // proves the contract end to end — apply the flip, filter exactly as
    // `belowTrailingAverage` does, and the previously-invisible own-paper row
    // is now part of the comparison.
    const at = (d: number) =>
      new Date(NOW.getTime() - d * 86_400_000).toISOString();
    const flagged = rrow({
      raw_price: 95,
      is_outlier: true,
      outlier_basis: "write_time",
      observed_at: at(1),
    });
    const rows = [
      // Ordered so that WITHOUT the flagged row the newest visible sighting is
      // the dearest one — i.e. there is no news at all until the flip lands.
      rrow({ raw_price: 100, observed_at: at(6) }),
      rrow({ raw_price: 98, observed_at: at(5) }),
      rrow({ raw_price: 99, observed_at: at(4) }),
      rrow({ raw_price: 101, observed_at: at(3) }),
      rrow({ raw_price: 102, observed_at: at(2) }),
      flagged,
    ];

    const toReaderRow = (r: RejudgeRow): ObservationRow => ({
      master_wine_id: r.master_wine_id,
      signature_hash: r.signature_hash,
      product_name_raw: "Chablis",
      vendor_name_raw: "A Vendor",
      provider_id: null,
      source_type: r.source_type,
      observed_at: r.observed_at,
      raw_price: r.raw_price,
      currency: r.currency,
      pack_size: r.pack_size,
      unit_volume_ml: r.unit_volume_ml,
      yield_factor: r.yield_factor,
    });

    // BEFORE: the reader's filter drops the flagged row, so its newest visible
    // sighting is the $98 and there is no news.
    const before = priceBelowAverage(
      rows.filter((r) => !r.is_outlier).map(toReaderRow),
    );
    expect(before.items).toHaveLength(0);

    // AFTER: apply the pass's verdicts, then filter exactly the same way.
    const plan = planRejudge(rows, NOW);
    const verdict = new Map(
      plan.groups.flatMap((g) => g.updates.map((u) => [u.id, u.isOutlier])),
    );
    expect(verdict.get(flagged.id)).toBe(false);

    const after = priceBelowAverage(
      rows
        .filter((r) => !(verdict.get(r.id) ?? r.is_outlier))
        .map(toReaderRow),
    );
    expect(after.items).toHaveLength(1);
    expect(after.items[0].latest.unitPrice).toBeCloseTo(95, 6);
    expect(after.items[0].average.unitPrice).toBeCloseTo(100, 6);
  });

  it("leaves a group below the floor exactly as it was, and says so", () => {
    const rows = [
      rrow({ raw_price: 20, is_outlier: true }),
      rrow({ raw_price: 40 }),
    ];
    const plan = planRejudge(rows, NOW);

    expect(MIN_OUTLIER_SAMPLE).toBe(5);
    expect(plan.groups[0].judged).toBe(false);
    expect(plan.groups[0].updates).toHaveLength(0);
    expect(plan.groups[0].silence?.reason).toBe("thin_window");
    // Not "clean". The sentence has to refuse the inference.
    expect(GROUP_SILENCE_SENTENCE.thin_window).toMatch(/none of them is claimed to be clean/);
  });

  it("never sets a quoted price beside a public-site one", () => {
    // ADR 0117's closing rule. Five scrapes near $20 must not be able to make
    // a $95 invoice look deviant: they are different kinds of number.
    const rows = [
      rrow({ raw_price: 95, source_type: "invoice" }),
      ...Array.from({ length: 5 }, () =>
        rrow({ raw_price: 20, source_type: "website_scrape" }),
      ),
    ];
    const plan = planRejudge(rows, NOW);

    const invoiceGroup = plan.groups.find((g) => g.sourceClass === "quoted")!;
    const siteGroup = plan.groups.find((g) => g.sourceClass === "public_site")!;
    expect(invoiceGroup.judged).toBe(false);
    expect(invoiceGroup.silence?.reason).toBe("thin_window");
    expect(siteGroup.judged).toBe(true);
  });

  it("never lets one house's prices judge another's, and keeps market rows their own", () => {
    const mine = Array.from({ length: 5 }, () => rrow({ raw_price: 20 }));
    const theirs = Array.from({ length: 5 }, () =>
      rrow({ raw_price: 500, restaurant_id: "rest-2" }),
    );
    const market = Array.from({ length: 5 }, () =>
      rrow({ raw_price: 9, restaurant_id: null }),
    );

    const plan = planRejudge([...mine, ...theirs, ...market], NOW);
    expect(plan.groups).toHaveLength(3);
    // Nothing is deviant, because nothing was compared across the scopes.
    expect(
      plan.groups.flatMap((g) => g.updates).filter((u) => u.isOutlier),
    ).toHaveLength(0);
    expect(plan.groups.map((g) => g.restaurantScope).sort()).toEqual([
      "market",
      "rest-1",
      "rest-2",
    ]);
  });

  it("refuses a mixed-currency window rather than inventing a rate", () => {
    const rows = [
      ...Array.from({ length: 4 }, () => rrow({ raw_price: 20 })),
      rrow({ raw_price: 18, currency: "EUR" }),
    ];
    const plan = planRejudge(rows, NOW);
    expect(plan.groups[0].judged).toBe(false);
    expect(plan.groups[0].silence?.reason).toBe("mixed_currency");
  });

  it("counts a source type it has no class for instead of folding it in", () => {
    const rows = Array.from({ length: 6 }, () =>
      rrow({ source_type: "posted_wholesale" }),
    );
    const plan = planRejudge(rows, NOW);
    expect(plan.groups[0].silence?.reason).toBe("unrecognised_class");
    expect(plan.groups[0].updates).toHaveLength(0);
  });

  it("counts a row with no product identity rather than grouping it by name", () => {
    const plan = planRejudge(
      [rrow({ master_wine_id: null, signature_hash: null })],
      NOW,
    );
    expect(plan.noProductKey).toBe(1);
    expect(plan.groups).toHaveLength(0);
  });

  it("reports the window it judged so a verdict can be checked against it", () => {
    const plan = planRejudge([], NOW);
    expect(plan.windowDays).toBe(REJUDGE_WINDOW_DAYS);
    expect(plan.windowFrom).toBe(
      new Date(NOW.getTime() - REJUDGE_WINDOW_DAYS * 86_400_000).toISOString(),
    );
  });
});

describe("isRejudgeArmed", () => {
  it("is off unless something explicitly turns it on", () => {
    for (const v of [undefined, null, "", "false", "0", "no", "off", "maybe"]) {
      expect(isRejudgeArmed(v as any)).toBe(false);
    }
    for (const v of ["true", "1", "YES", " on "]) {
      expect(isRejudgeArmed(v)).toBe(true);
    }
  });
});

/** A thenable PostgREST-shaped mock. */
function makeService(
  rows: any[],
  opts: { flag?: string; readError?: any; failIds?: string[] } = {},
) {
  const updates: Array<{ id: string; patch: any }> = [];

  const builder = (): any => {
    const b: any = {
      select: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      update: (patch: any) => ({
        eq: async (_col: string, id: string) => {
          if (opts.failIds?.includes(id))
            return { error: { message: `write refused for ${id}` } };
          updates.push({ id, patch });
          return { error: null };
        },
      }),
      then: (resolve: any) =>
        resolve({ data: rows, error: opts.readError ?? null }),
    };
    return b;
  };

  const databaseService = { supabase: { from: () => builder() } } as any;
  const config = { get: () => opts.flag } as any;
  return { svc: new OutlierRejudgeService(databaseService, config), updates };
}

describe("OutlierRejudgeService", () => {
  const cluster = [
    rrow({ raw_price: 20 }),
    rrow({ raw_price: 20.5 }),
    rrow({ raw_price: 19.8 }),
    rrow({ raw_price: 20.2 }),
    rrow({ raw_price: 2175 }),
  ];

  it("is disarmed by default and the scheduled run writes nothing", async () => {
    const { svc, updates } = makeService(cluster);
    await svc.scheduled();
    expect(updates).toHaveLength(0);
    expect(svc.armed()).toBe(false);
  });

  it("says WHY it is silent rather than reporting an empty flip count", async () => {
    const { svc } = makeService(cluster);
    const s = svc.status();
    expect(s.armed).toBe(false);
    expect(s.flag).toBe(REJUDGE_ENABLED_FLAG);
    expect(s.cron).toBe(REJUDGE_CRON);
    expect(s.lastRun).toBeNull();
    expect(s.sentence).toMatch(/switched off/);
    expect(s.sentence).toMatch(/every flag on the register is the one its writer set/);
  });

  it("distinguishes armed-and-never-run from armed-and-nothing-found", async () => {
    const { svc } = makeService(cluster, { flag: "true" });
    expect(svc.status().sentence).toMatch(/has not run yet in this process/);
    await svc.rejudge({});
    expect(svc.status().sentence).toMatch(/rows re-judged/);
  });

  it("writes the verdict, the reason, the basis and the time", async () => {
    const { svc, updates } = makeService(cluster, { flag: "true" });
    const summary = await svc.rejudge({});

    expect(updates).toHaveLength(5);
    expect(summary.rowsJudged).toBe(5);
    expect(summary.flippedToOutlier).toBe(1);
    const flagged = updates.find((u) => u.patch.is_outlier === true)!;
    expect(flagged.patch.outlier_basis).toBe("rejudge");
    expect(typeof flagged.patch.outlier_judged_at).toBe("string");
    expect(flagged.patch.outlier_reason).toMatch(/robust deviations/);
  });

  it("a dry run plans and writes nothing, and says which it was", async () => {
    const { svc, updates } = makeService(cluster, { flag: "true" });
    const summary = await svc.rejudge({ dryRun: true });
    expect(updates).toHaveLength(0);
    expect(summary.dryRun).toBe(true);
    expect(summary.rowsJudged).toBe(5);
    expect(svc.status().sentence).toMatch(/DRY RUN/);
  });

  it("one product's failed write never stops the others", async () => {
    const other = [
      rrow({ master_wine_id: "22222222-2222-2222-2222-222222222222", raw_price: 50 }),
      rrow({ master_wine_id: "22222222-2222-2222-2222-222222222222", raw_price: 50.5 }),
      rrow({ master_wine_id: "22222222-2222-2222-2222-222222222222", raw_price: 49.5 }),
      rrow({ master_wine_id: "22222222-2222-2222-2222-222222222222", raw_price: 50.2 }),
      rrow({ master_wine_id: "22222222-2222-2222-2222-222222222222", raw_price: 50.1 }),
    ];
    const { svc, updates } = makeService([...cluster, ...other], {
      flag: "true",
      failIds: [cluster[0].id],
    });

    const summary = await svc.rejudge({});
    expect(summary.groupsFailed).toBe(1);
    expect(summary.failures[0].message).toMatch(/write refused/);
    // The second product was still judged and written in full.
    expect(updates.filter((u) => other.some((o) => o.id === u.id))).toHaveLength(5);
    expect(summary.rowsJudged).toBe(5);
  });

  it("throws on an unreadable window rather than clearing every flag", async () => {
    const { svc, updates } = makeService([], {
      flag: "true",
      readError: { message: "connection reset" },
    });
    await expect(svc.rejudge({})).rejects.toThrow("connection reset");
    expect(updates).toHaveLength(0);
  });
});
