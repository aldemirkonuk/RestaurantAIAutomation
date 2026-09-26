import {
  INSIGHT_GENERATOR_VERSION,
  InsightGeneratorService,
} from "./insight-generator.service";
import { StateRow, stateBookFrom } from "./item-state";

/**
 * The generator's half of the ONE shared per-item state (ADR 0191; founder,
 * 2026-09-21: "Build it right, in order").
 *
 * The generator is what Reports, the contextual rails, the catalogue's live
 * items, the mobile tab, the overview and the goal suggestions are served
 * from, live or stored. Before this, it withheld dismissals only — and the
 * stored read withheld nothing written since the last persist. Pinned here:
 * a snooze holds until its instant and then the item returns, done holds,
 * each at the scope it was written, on the live compute AND the stored read.
 */

const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();
const EARLIER = new Date(Date.now() - 60_000).toISOString();

type Rows = Record<string, any[]>;

/** A Supabase stub that honours eq / gte / in and records writes. */
function makeClient(rowsByTable: Rows) {
  const writes: Array<{ table: string; op: string; rows: any }> = [];
  const client: any = {
    writes,
    from: (table: string) => {
      let rows = [...(rowsByTable[table] ?? [])];
      const builder: any = {};
      for (const m of [
        "select",
        "neq",
        "gt",
        "lte",
        "is",
        "or",
        "not",
        "order",
        "limit",
      ])
        builder[m] = () => builder;
      builder.eq = (col: string, v: any) => {
        if (rows.length && col in rows[0])
          rows = rows.filter((r) => r[col] === v);
        return builder;
      };
      builder.gte = (col: string, v: any) => {
        if (rows.length && col in rows[0])
          rows = rows.filter((r) => (r[col] ?? 0) >= v);
        return builder;
      };
      builder.lt = () => builder;
      builder.in = (col: string, vs: any[]) => {
        if (rows.length && col in rows[0])
          rows = rows.filter((r) => vs.includes(r[col]));
        return builder;
      };
      builder.delete = () => {
        writes.push({ table, op: "delete", rows: null });
        return builder;
      };
      builder.insert = (payload: any) => {
        writes.push({ table, op: "insert", rows: payload });
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.single = () =>
        Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      return builder;
    },
  };
  return client;
}

function generatorWith(
  rowsByTable: Rows,
  state: StateRow[] = [],
  readable = true,
) {
  const client = makeClient(rowsByTable);
  const svc = new InsightGeneratorService(
    { getClient: () => client, supabase: client } as any,
    {
      load: async () => ({ dates: new Set(), readable: true, problem: null }),
    } as any,
    {
      readState: async () => ({
        book: stateBookFrom(state),
        readable,
        problem: readable ? null : "timeout",
      }),
    } as any,
  );
  return { svc, client };
}

const row = (
  ruleKey: string,
  status: string,
  over: Partial<StateRow> = {},
) => ({
  ruleKey,
  status,
  reason: status === "dismissed" ? "not_now" : null,
  snoozeUntil: null,
  ...over,
});

// ---------------------------------------------------------------------------
// The stored read
// ---------------------------------------------------------------------------

const TYPE = "overall.revenue.vs_same_weekday";
const RULE = `insight:${TYPE}`;

function stored(over: Record<string, unknown> = {}) {
  return {
    restaurant_id: "r1",
    candidate_key: TYPE,
    category: "sales",
    sentence: "Wednesday sales came in 40% lower than your average Wednesday.",
    score: 3,
    subject: "Wednesday",
    period_key: "d:2026-09-16",
    generator_version: INSIGHT_GENERATOR_VERSION,
    ...over,
  };
}

const WED = `${RULE}#wednesday#d:2026-09-16`;

describe("the stored read honours the shared state", () => {
  it("serves an untouched row, with the keys an act on it must write", async () => {
    const { svc } = generatorWith({ analytics_insights: [stored()] });
    const out = await svc.readStored("r1");
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].suppression.key).toBe(WED);
    expect(out.rows[0].suppression.keys.rule).toBe(RULE);
    expect(out.read).toBe(1);
    expect(out.suppressionsReadable).toBe(true);
  });

  it("withholds a row dismissed AFTER it was persisted", async () => {
    const { svc } = generatorWith({ analytics_insights: [stored()] }, [
      row(WED, "dismissed"),
    ]);
    const out = await svc.readStored("r1");
    expect(out.rows).toEqual([]);
    expect(out.withheld).toEqual({ dismissed: 1, snoozed: 0, done: 0 });
    // Still an answer — the cache is warm, the row is withheld.
    expect(out.read).toBe(1);
  });

  it("withholds a snoozed row until its instant, then serves it again", async () => {
    const snoozed = generatorWith({ analytics_insights: [stored()] }, [
      row(WED, "snoozed", { snoozeUntil: LATER }),
    ]);
    expect((await snoozed.svc.readStored("r1")).withheld.snoozed).toBe(1);
    const woke = generatorWith({ analytics_insights: [stored()] }, [
      row(WED, "snoozed", { snoozeUntil: EARLIER }),
    ]);
    expect((await woke.svc.readStored("r1")).rows).toHaveLength(1);
  });

  it("withholds a done row, at the subject scope it was written", async () => {
    const { svc } = generatorWith(
      {
        analytics_insights: [
          stored(),
          stored({ subject: "Tuesday", sentence: "Tuesday came in low." }),
        ],
      },
      [row(`${RULE}#wednesday#*`, "done")],
    );
    const out = await svc.readStored("r1");
    expect(out.rows.map((r: any) => r.subject)).toEqual(["Tuesday"]);
    expect(out.withheld.done).toBe(1);
  });

  it("the getStored() every other reader uses is the filtered list", async () => {
    const { svc } = generatorWith({ analytics_insights: [stored()] }, [
      row(RULE, "dismissed"),
    ]);
    expect(await svc.getStored("r1")).toEqual([]);
  });

  it("says when the state could not be read rather than presenting the list as clean", async () => {
    const { svc } = generatorWith(
      { analytics_insights: [stored()] },
      [],
      false,
    );
    const out = await svc.readStored("r1");
    expect(out.suppressionsReadable).toBe(false);
  });

  it("a version-2 row (no subject, no period) is not served at all", async () => {
    const { svc } = generatorWith({
      analytics_insights: [stored({ generator_version: 2 })],
    });
    const out = await svc.readStored("r1");
    expect(out.rows).toEqual([]);
    expect(out.read).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The live compute
// ---------------------------------------------------------------------------

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

function check(date: string, total: number) {
  return {
    id: `chk-${date}-${total}`,
    source: "test",
    table_id: null,
    server_name: null,
    server_external_id: null,
    opened_at: `${date}T18:00:00.000Z`,
    closed_at: `${date}T20:00:00.000Z`,
    covers: 2,
    total,
    tip: 0,
    items: null,
  };
}

/** 90 days where one weekday out-earns the rest and yesterday came in soft. */
function history(): Rows {
  const target = weekdayOf(dayBack(1));
  const checks: ReturnType<typeof check>[] = [];
  for (let back = 90; back >= 1; back--) {
    const total =
      back === 1 ? 600 : weekdayOf(dayBack(back)) === target ? 1000 : 800;
    checks.push(check(dayBack(back), total));
  }
  return {
    pos_checks: checks,
    wine_consumption_log: [],
    procurement_orders: [],
    restaurant_inventory: [],
    restaurant_tables: [],
    restaurant_venue_profiles: [],
    analytics_goals: [],
    analytics_insights: [],
  };
}

async function oneLiveFinding() {
  const { svc } = generatorWith(history());
  const out = await svc.generate("r1", { persist: false });
  // A finding with a narrower key than its rule — the kind a person acts on.
  const it = out.insights.find(
    (i) => i.suppression.key !== i.suppression.keys.rule,
  );
  return { it: it!, count: out.insights.length };
}

describe("the live compute honours the shared state", () => {
  it("the fixture has a finding narrower than its rule", async () => {
    expect((await oneLiveFinding()).it).toBeDefined();
  });

  it("a snooze on the finding holds, and is counted as a snooze", async () => {
    const { it, count } = await oneLiveFinding();
    const { svc } = generatorWith(history(), [
      row(it.suppression.key, "snoozed", { snoozeUntil: LATER }),
    ]);
    const out = await svc.generate("r1", { persist: false });
    expect(
      out.insights.some((i) => i.suppression.key === it.suppression.key),
    ).toBe(false);
    expect(out.withheld).toEqual({ dismissed: 0, snoozed: 1, done: 0 });
    expect(out.suppressed).toBe(0);
    expect(out.insights).toHaveLength(count - 1);
  });

  it("an elapsed snooze returns the finding", async () => {
    const { it } = await oneLiveFinding();
    const { svc } = generatorWith(history(), [
      row(it.suppression.key, "snoozed", { snoozeUntil: EARLIER }),
    ]);
    const out = await svc.generate("r1", { persist: false });
    expect(
      out.insights.some((i) => i.suppression.key === it.suppression.key),
    ).toBe(true);
  });

  it("done on the finding holds, and carries no dismissal count", async () => {
    const { it } = await oneLiveFinding();
    const { svc } = generatorWith(history(), [row(it.suppression.key, "done")]);
    const out = await svc.generate("r1", { persist: false });
    expect(
      out.insights.some((i) => i.suppression.key === it.suppression.key),
    ).toBe(false);
    expect(out.withheld.done).toBe(1);
    expect(out.suppressed).toBe(0);
  });

  it("a finding snoozed while the cache is rebuilt is back on the stored read when its snooze ends", async () => {
    // The stored read is what Reports and the rails are served from, and the
    // cache is rebuilt on the category's cadence (daily 06:00 by default,
    // weekly, or never for `manual`). If the rebuild stored only what was
    // visible at that moment, a snoozed finding would be missing from the
    // cache when its snooze ended, and would not "return after" on those
    // surfaces until the next rebuild. The rebuild stores what fired; every
    // read applies the state.
    const { it } = await oneLiveFinding();
    const during = generatorWith(history(), [
      row(it.suppression.key, "snoozed", { snoozeUntil: LATER }),
    ]);
    const live = await during.svc.generate("r1", { persist: true });
    // Hidden on the live read while the snooze holds…
    expect(
      live.insights.some((i) => i.suppression.key === it.suppression.key),
    ).toBe(false);
    const insert = during.client.writes.find(
      (w: any) => w.table === "analytics_insights" && w.op === "insert",
    );
    // …and nothing hidden reached the cache as a row of its own twice.
    const keys = insert.rows.map(
      (r: any) => `${r.candidate_key}|${r.subject}|${r.period_key}`,
    );
    expect(new Set(keys).size).toBe(keys.length);

    // The snooze ends: the stored read serves the finding again.
    const after = generatorWith({ analytics_insights: insert.rows }, [
      row(it.suppression.key, "snoozed", { snoozeUntil: EARLIER }),
    ]);
    const back = await after.svc.readStored("r1");
    expect(
      back.rows.some((r: any) => r.suppression.key === it.suppression.key),
    ).toBe(true);

    // While it holds, the same cache withholds it on the stored read too.
    const still = generatorWith({ analytics_insights: insert.rows }, [
      row(it.suppression.key, "snoozed", { snoozeUntil: LATER }),
    ]);
    const held = await still.svc.readStored("r1");
    expect(
      held.rows.some((r: any) => r.suppression.key === it.suppression.key),
    ).toBe(false);
    expect(held.withheld.snoozed).toBe(1);
  });

  it("a persisted row carries its subject and period, so the stored read can resolve it", async () => {
    const { svc, client } = generatorWith(history());
    await svc.generate("r1", { persist: true });
    const insert = client.writes.find(
      (w: any) => w.table === "analytics_insights" && w.op === "insert",
    );
    const withKey = insert.rows.find((r: any) => r.subject || r.period_key);
    expect(withKey).toBeDefined();
    expect(
      insert.rows.every((r: any) => "subject" in r && "period_key" in r),
    ).toBe(true);
  });
});
