import { stateBookFrom } from "./item-state";
import { InsightGeneratorService } from "./insight-generator.service";

/**
 * The catalogue's "open live items" (ADR 0191) reads ONE type's live list.
 *
 * Built first as a client-side filter over `GET insights/:id?categories=X`,
 * which returns the top five insights of the whole category — so a type whose
 * instances ranked sixth or lower read "Nothing live for this type right now"
 * while it had fired. Absence reported as health, one filter too late.
 *
 * Pinned here, against the real generator and a real trading history (no
 * stubbed ranking): a narrowed read filters BEFORE the cap, and it is never
 * persisted, because `persist()` replaces every stored row of the category —
 * writing one type's list back would erase every other type's.
 */

type Rows = Record<string, any[]>;

function makeClient(rowsByTable: Rows) {
  const writes: Array<{ table: string; op: string }> = [];
  const passthrough = [
    "select",
    "eq",
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
  ];
  const client = {
    writes,
    from: (table: string) => {
      const rows = rowsByTable[table] ?? [];
      const builder: any = {};
      for (const m of passthrough) builder[m] = () => builder;
      builder.delete = () => {
        writes.push({ table, op: "delete" });
        return builder;
      };
      builder.insert = () => {
        writes.push({ table, op: "insert" });
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

function dayBack(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

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
function generator() {
  const target = weekdayOf(dayBack(1));
  const checks: ReturnType<typeof check>[] = [];
  for (let back = 90; back >= 1; back--) {
    const total =
      back === 1 ? 600 : weekdayOf(dayBack(back)) === target ? 1000 : 800;
    checks.push(check(dayBack(back), total));
  }
  const client = makeClient({
    pos_checks: checks,
    wine_consumption_log: [],
    procurement_orders: [],
    restaurant_inventory: [],
    restaurant_tables: [],
    restaurant_venue_profiles: [],
    analytics_goals: [],
  });
  const svc = new InsightGeneratorService(
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
  return { svc, client };
}

/** A type that fired but is NOT the top of its category. */
async function aTypeBelowTheTop() {
  const { svc } = generator();
  const all = await svc.generate("r1", {
    persist: false,
    maxPerCategory: 1000,
  });
  const top = await svc.generate("r1", { persist: false, maxPerCategory: 1 });
  const shown = new Set(top.insights.map((i) => i.candidateKey));
  const hidden = all.insights.find(
    (i) =>
      !shown.has(i.candidateKey) &&
      top.insights.some((t) => t.category === i.category),
  );
  return hidden;
}

describe("a read narrowed to one catalogue type (ADR 0191)", () => {
  it("the fixture really has a type the capped category read hides", async () => {
    // Without this the next test could pass by finding nothing to find.
    expect(await aTypeBelowTheTop()).toBeDefined();
  });

  it("filters BEFORE the per-category cap, so a type below the top still opens", async () => {
    const hidden = (await aTypeBelowTheTop())!;
    const { svc } = generator();
    const out = await svc.generate("r1", {
      categories: [hidden.category as any],
      candidateKeys: [hidden.candidateKey],
      persist: false,
      maxPerCategory: 1,
    });
    expect(out.insights.length).toBeGreaterThan(0);
    expect(
      out.insights.every((i) => i.candidateKey === hidden.candidateKey),
    ).toBe(true);
  });

  it("is never persisted, even when the caller asks — persist() would replace the category", async () => {
    const hidden = (await aTypeBelowTheTop())!;
    const { svc, client } = generator();
    await svc.generate("r1", {
      categories: [hidden.category as any],
      candidateKeys: [hidden.candidateKey],
      persist: true,
    });
    expect(client.writes.filter((w) => w.table === "analytics_insights")).toEqual(
      [],
    );

    // The control: the same read, un-narrowed, DOES write — so the empty list
    // above is the narrowing, not a harness that cannot see writes.
    const control = generator();
    await control.svc.generate("r1", {
      categories: [hidden.category as any],
      persist: true,
    });
    expect(
      control.client.writes.some(
        (w) => w.table === "analytics_insights" && w.op === "delete",
      ),
    ).toBe(true);
  });
});
