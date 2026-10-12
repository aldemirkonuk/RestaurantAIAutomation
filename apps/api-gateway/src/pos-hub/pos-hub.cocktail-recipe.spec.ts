import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * A COCKTAIL SOLD ON THE TILL TAKES ITS RECIPE OFF THE SHELF (F-1329, OD-113,
 * founder S195: the industry approach).
 *
 * A recipe line may name one of the house's stock rows and an amount. A till
 * sale of the cocktail takes each linked line off its row by the recipe's
 * amount times the quantity sold, through the same pours and keys a glass
 * uses, so a replay is a no-op and a void finds what the sale took. A line
 * that names no stock row takes nothing.
 *
 * The database below keeps stock as the real RPCs do (sealed bottles plus
 * open ml, idempotent on the key), as pos-hub.check-ledger.spec.ts does, and
 * the assertions are on the resulting stock.
 */

type Row = Record<string, any>;

const MAPPINGS = [
  {
    external_item_id: "negroni",
    item_name: "Negroni",
    is_wine: false,
    inventory_id: null,
    cocktail_id: "ck-negroni",
  },
  {
    external_item_id: "sour",
    item_name: "Whisky Sour",
    is_wine: false,
    inventory_id: null,
    cocktail_id: "ck-sour",
  },
  {
    external_item_id: "bitter",
    item_name: "Bitter",
    is_wine: false,
    inventory_id: null,
    cocktail_id: "ck-bitter",
  },
  // F-1469: a button mapped onto a stock row before its cocktail was
  // written down. Its mapping names no cocktail.
  {
    external_item_id: "spritz-btn",
    item_name: "Aperol Spritz",
    is_wine: true,
    inventory_id: "inv-gin",
    sale_unit: "glass",
    sale_volume_ml: 50,
    cocktail_id: null,
  },
];

/** The house's cocktails, read by name for a line no mapping names. */
const COCKTAILS = [
  {
    id: "ck-spritz",
    name: "Aperol Spritz",
    display_name: null,
    deleted_at: null,
  },
];

const RECIPES: Row[] = [
  {
    cocktail_id: "ck-negroni",
    inventory_id: "inv-gin",
    free_text: "gin",
    quantity: 30,
    unit: "ml",
    sort_order: 0,
  },
  {
    cocktail_id: "ck-negroni",
    inventory_id: "inv-campari",
    free_text: "Campari",
    quantity: 3,
    unit: "cl",
    sort_order: 1,
  },
  {
    cocktail_id: "ck-negroni",
    inventory_id: null,
    free_text: "orange peel",
    quantity: null,
    unit: null,
    sort_order: 2,
  },
  {
    cocktail_id: "ck-spritz",
    inventory_id: "inv-campari",
    free_text: "Aperol",
    quantity: 60,
    unit: "ml",
    sort_order: 0,
  },
  {
    cocktail_id: "ck-sour",
    inventory_id: "inv-gin",
    free_text: "whisky",
    quantity: 50,
    unit: "ml",
    sort_order: 0,
  },
  {
    cocktail_id: "ck-sour",
    inventory_id: "inv-egg",
    free_text: "egg",
    quantity: 1,
    unit: "each",
    sort_order: 1,
  },
  {
    cocktail_id: "ck-bitter",
    inventory_id: "inv-campari",
    free_text: "Angostura",
    quantity: 2,
    unit: "dash",
    sort_order: 0,
  },
];

function makeDb() {
  const stock: Record<string, { sealed: number; openMl: number; ml: number }> =
    {
      "inv-gin": { sealed: 12, openMl: 0, ml: 700 },
      "inv-campari": { sealed: 12, openMl: 0, ml: 700 },
      "inv-egg": { sealed: 30, openMl: 0, ml: 0 },
    };
  const tx = new Map<string, Row>();
  const pours = new Map<string, Row>();
  const consumption = new Map<string, Row>();
  const queued: Row[] = [];

  const client: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({ data: null, error: null }),
        like: async (_col: string, pattern: string) => {
          const prefix = pattern.replace(/%$/, "").replace(/\\(.)/g, "$1");
          const rows =
            table === "inventory_transactions"
              ? [...tx.values()]
              : table === "pour_events"
                ? [...pours.values()]
                : [];
          return {
            data: rows.filter((r) => r.idempotency_key.startsWith(prefix)),
            error: null,
          };
        },
        upsert: async () => ({ error: null }),
        update: (patch: Row) => {
          const keep: Array<(r: Row) => boolean> = [];
          const u: any = {
            eq: (c: string, v: any) => (keep.push((r) => r[c] === v), u),
            neq: (c: string, v: any) => (keep.push((r) => r[c] !== v), u),
            is: (c: string, v: any) => (
              keep.push((r) => (r[c] ?? null) === v),
              u
            ),
            like: async (c: string, pattern: string) => {
              const prefix = pattern.replace(/%$/, "").replace(/\\(.)/g, "$1");
              for (const r of consumption.values()) {
                if (String(r[c]).startsWith(prefix) && keep.every((k) => k(r)))
                  Object.assign(r, patch);
              }
              return { error: null };
            },
          };
          return u;
        },
        insert: async (row: Row) => {
          if (table === "pos_unresolved_lines") queued.push(row);
          if (table === "wine_consumption_log") {
            if (consumption.has(row.notes)) {
              return { error: { code: "23505", message: "duplicate key" } };
            }
            consumption.set(row.notes, row);
          }
          return { error: null };
        },
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: MAPPINGS, error: null });
      }
      if (table === "cocktails") {
        q.eq = async () => ({ data: COCKTAILS, error: null });
      }
      if (table === "cocktail_ingredients") {
        q.in = (_c: string, ids: string[]) => ({
          order: async () => ({
            data: RECIPES.filter((r) => ids.includes(r.cocktail_id)),
            error: null,
          }),
        });
      }
      if (table === "restaurant_inventory") {
        q.in = async () => ({
          data: [
            { id: "inv-gin", bottle_size_ml: 700, pour_size_ml: 50 },
            { id: "inv-campari", bottle_size_ml: 700, pour_size_ml: 50 },
            { id: "inv-egg", bottle_size_ml: null, pour_size_ml: null },
          ],
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({ eq: async () => ({ data: [], error: null }) });
      }
      return q;
    },
    rpc: async (name: string, args: Row) => {
      const key = args.p_idempotency_key as string;
      const item = stock[args.p_inventory_id];
      if (name === "apply_stock_movement") {
        if (tx.has(key)) return { data: tx.get(key)!.id, error: null };
        item.sealed += Number(args.p_delta);
        const id = `tx-${tx.size + 1}`;
        tx.set(key, {
          id,
          idempotency_key: key,
          inventory_id: args.p_inventory_id,
          quantity_change: Number(args.p_delta),
        });
        return { data: id, error: null };
      }
      if (name === "record_glass_pour") {
        if (pours.has(key)) return { data: { idempotent: true }, error: null };
        let need = args.p_pours * args.p_pour_ml;
        const take = Math.min(item.openMl, need);
        item.openMl -= take;
        need -= take;
        while (need > 0) {
          item.sealed -= 1;
          item.openMl += item.ml;
          const t = Math.min(item.openMl, need);
          item.openMl -= t;
          need -= t;
        }
        pours.set(key, {
          idempotency_key: key,
          inventory_id: args.p_inventory_id,
          pours: args.p_pours,
          pour_ml: args.p_pour_ml,
        });
        return { data: {}, error: null };
      }
      return { data: null, error: null };
    },
  };

  return {
    service: new PosHubService({
      getClient: () => client,
    } as unknown as DatabaseService),
    stock,
    consumption,
    queued,
  };
}

const check = (id: string, items: Row[], over: Row = {}) => ({
  externalCheckId: id,
  openedAt: "2026-10-02T18:00:00Z",
  closedAt: "2026-10-02T19:00:00Z",
  items,
  ...over,
});

describe("a cocktail sold on the till takes its linked recipe lines (F-1329)", () => {
  it("takes each linked line by its amount times the quantity, and an unlinked line nothing", async () => {
    const { service, stock } = makeDb();

    const res = await service.ingest("r1", "generic_webhook", [
      check("c-1", [
        { name: "Negroni", externalItemId: "negroni", qty: 2, price: 400 },
      ]),
    ]);

    // 2 x 30 ml gin and 2 x 3 cl Campari, each from one opened 700 ml bottle.
    expect(stock["inv-gin"]).toMatchObject({ sealed: 11, openMl: 640 });
    expect(stock["inv-campari"]).toMatchObject({ sealed: 11, openMl: 640 });
    // The till line is two stock lines, both booked; the orange peel is not one.
    expect(res.stock).toMatchObject({
      lines: 2,
      booked: 2,
      notStock: 0,
      failed: 0,
    });
  });

  it("a replay of the check takes nothing more", async () => {
    const { service, stock } = makeDb();
    const sale = check("c-1", [
      { name: "Negroni", externalItemId: "negroni", qty: 2, price: 400 },
    ]);

    await service.ingest("r1", "generic_webhook", [sale]);
    const again = await service.ingest("r1", "generic_webhook", [sale]);

    expect(stock["inv-gin"]).toMatchObject({ sealed: 11, openMl: 640 });
    expect(again.stock).toMatchObject({ booked: 0, alreadyBooked: 2 });
  });

  it("a line no mapping names finds its cocktail by the house's exact name, in any case", async () => {
    const { service, stock, queued } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      check("c-1", [
        {
          name: "  aperol   SPRITZ ",
          externalItemId: "spritz",
          qty: 1,
          price: 350,
        },
      ]),
    ]);

    expect(stock["inv-campari"]).toMatchObject({ sealed: 11, openMl: 640 });
    expect(queued).toHaveLength(0);
  });

  it("a mapped button that names no cocktail still takes the recipe of the cocktail its name is (F-1469)", async () => {
    const { service, stock, queued } = makeDb();

    await service.ingest("r1", "generic_webhook", [
      check("c-1", [
        {
          name: "Aperol Spritz",
          externalItemId: "spritz-btn",
          qty: 1,
          price: 350,
        },
      ]),
    ]);

    // The recipe's 60 ml, not the mapping's 50 ml glass of the gin row.
    expect(stock["inv-campari"]).toMatchObject({ sealed: 11, openMl: 640 });
    expect(stock["inv-gin"]).toMatchObject({ sealed: 12, openMl: 0 });
    expect(queued).toHaveLength(0);
  });

  it("a void returns whole units and reverses the sale's consumption, and never a bottle per poured ml", async () => {
    const { service, stock, consumption } = makeDb();
    const sour = {
      name: "Whisky Sour",
      externalItemId: "sour",
      qty: 1,
      price: 380,
    };

    await service.ingest("r1", "generic_webhook", [check("c-1", [sour])]);
    expect(stock["inv-egg"].sealed).toBe(29);
    expect(stock["inv-gin"]).toMatchObject({ sealed: 11, openMl: 650 });

    const res = await service.ingest("r1", "generic_webhook", [
      check("c-1", [sour], { voided: true }),
    ]);

    // The egg comes back; the poured whisky does not, and is not a bottle.
    expect(stock["inv-egg"].sealed).toBe(30);
    expect(stock["inv-gin"]).toMatchObject({ sealed: 11, openMl: 650 });
    expect(res.errors.join(" ")).toMatch(
      /cannot be put back on the shelf automatically/,
    );
    // F-1197: none of the sale's consumption rows count once it is voided.
    expect([...consumption.values()].every((r) => r.reversed_at)).toBe(true);
  });

  it("a line whose measure stock cannot be taken in takes nothing and says why", async () => {
    const { service, stock } = makeDb();

    const res = await service.ingest("r1", "generic_webhook", [
      check("c-1", [
        { name: "Bitter", externalItemId: "bitter", qty: 1, price: 100 },
      ]),
    ]);

    expect(stock["inv-campari"]).toMatchObject({ sealed: 12, openMl: 0 });
    expect(res.stock.failed).toBe(1);
    expect(res.errors.join(" ")).toMatch(
      /"dash" is not a measure stock can be taken in/,
    );
  });
});

describe("a till mapping names the cocktail it sells (F-1329)", () => {
  function upsertDb() {
    const written: Row[] = [];
    const client: any = {
      from: () => ({
        upsert: (row: Row) => {
          written.push(row);
          return {
            select: () => ({
              single: async () => ({ data: row, error: null }),
            }),
          };
        },
      }),
    };
    return {
      service: new PosHubService({
        getClient: () => client,
      } as unknown as DatabaseService),
      written,
    };
  }

  it("writes the cocktail when it is sent, and leaves it alone when it is not", async () => {
    const { service, written } = upsertDb();

    await service.upsertItemMapping("r1", {
      item_name: "Negroni",
      cocktail_id: "ck-negroni",
    });
    await service.upsertItemMapping("r1", { item_name: "Negroni" });

    expect(written[0].cocktail_id).toBe("ck-negroni");
    expect("cocktail_id" in written[1]).toBe(false);
  });
});
