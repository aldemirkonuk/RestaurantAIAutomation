import { stateBookFrom } from "./item-state";
import { InsightGeneratorService, InsightRecord } from "./insight-generator.service";

/**
 * An insight sentence names the item, never its id (r39 walk, F5).
 *
 * Read on the walk: "10ca1c4e-…-c1 bottles sold rose 250%". The week-over-week
 * mover and the stockout rank took the item's name from the inventory list and
 * fell back to its id when the list held no name for it. A card never says an
 * id: with no name the sentence says "An item", and the suppression key stays
 * the item's own id so two unnamed items are still two cards.
 */

const MOVER = "wine.bottles.vs_prev_period_7d";
const STOCKOUT = "wine.stockout_risk.peer_rank";
const ID = "10ca1c4e-6b7d-4f0a-9d3e-5a1b2c3d4ec1";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Row = Record<string, any>;

function client(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      let gt: string | null = null;
      let limit = Number.POSITIVE_INFINITY;
      let single = false;
      const b: any = {};
      for (const m of ["eq", "neq", "gte", "lte", "lt", "in", "is", "order", "or", "not"]) b[m] = () => b;
      b.select = () => b;
      b.gt = (col: string, v: string) => {
        if (col === "id") gt = v;
        return b;
      };
      b.limit = (n: number) => ((limit = n), b);
      b.maybeSingle = () => ((single = true), b);
      const answer = () => {
        let out = [...rows].sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1));
        if (gt !== null) out = out.filter((r) => String(r.id) > gt!);
        if (single) return { data: out[0] ?? null, error: null };
        return { data: out.slice(0, limit), error: null };
      };
      b.then = (resolve: any, reject: any) => Promise.resolve().then(answer).then(resolve, reject);
      return b;
    },
  };
}

const at = (back: number) => new Date(Date.now() - back * 86400000 - 3600000).toISOString();

/** Quiet last fortnight-but-one, a jump this week: the mover fires. */
function pours() {
  const out: Row[] = [];
  let n = 0;
  for (let back = 1; back <= 14; back++) {
    const perDay = back <= 7 ? 7 : 2;
    for (let k = 0; k < perDay; k++)
      out.push({
        id: `c-${String(++n).padStart(4, "0")}`,
        inventory_id: "inv-1",
        consumption_type: "bottle",
        quantity: 1,
        volume_ml: null,
        created_at: at(back),
        restaurant_inventory: { master_wine_id: ID },
      });
  }
  return out;
}

async function fire(inventory: Row[]): Promise<InsightRecord[]> {
  const c = client({ wine_consumption_log: pours(), restaurant_inventory: inventory });
  const svc = new InsightGeneratorService(
    { getClient: () => c, supabase: c } as any,
    { load: async () => ({ dates: new Set(), readable: true, problem: null }) } as any,
    { readState: async () => ({ book: stateBookFrom([]), readable: true, problem: null }) } as any,
  );
  return (await svc.generate("r1", { candidateKeys: [MOVER, STOCKOUT] })).insights;
}

const inv = (wine_name: string | null) => ({
  id: "inv-1",
  wine_name,
  stock_live: 1,
  menu_price_current: 60,
  last_purchase_price: 20,
  master_wine_id: ID,
  master_wine_library: { primary_type: "red" },
});

describe("an insight names the item, never its id", () => {
  it("a named item is named", async () => {
    const out = await fire([inv("Barolo 2016")]);
    const mover = out.find((i) => i.candidateKey === MOVER)!;
    expect(mover.sentence).toMatch(/^Barolo 2016 bottles sold rose /);
    expect(mover.entityLabel).toBe("Barolo 2016");
  });

  it("an item with no name in the inventory list says 'An item', in the sentence and the label", async () => {
    const out = await fire([inv(null)]);
    const mover = out.find((i) => i.candidateKey === MOVER)!;
    expect(mover.sentence).toMatch(/^An item bottles sold rose /);
    expect(mover.entityLabel).toBe("An item");
    const risk = out.find((i) => i.candidateKey === STOCKOUT)!;
    expect(risk.sentence).toMatch(/^An item ranks #1 /);
    expect(risk.entityLabel).toBe("An item");
    for (const i of out) {
      expect(i.sentence).not.toMatch(UUID);
      expect(i.entityLabel ?? "").not.toMatch(UUID);
    }
  });

  it("a blank name counts as no name", async () => {
    const out = await fire([inv("   ")]);
    expect(out.find((i) => i.candidateKey === MOVER)!.sentence).toMatch(/^An item /);
  });

  it("an item missing from the inventory list altogether is 'An item' too", async () => {
    const out = await fire([]);
    const mover = out.find((i) => i.candidateKey === MOVER)!;
    expect(mover.sentence).toMatch(/^An item bottles sold rose /);
  });

  it("an unnamed item is still its own card: the suppression subject is its id", async () => {
    const out = await fire([inv(null)]);
    expect(out.find((i) => i.candidateKey === MOVER)!.subject).toBe(ID);
    expect(out.find((i) => i.candidateKey === STOCKOUT)!.subject).toBe(ID);
  });
});
