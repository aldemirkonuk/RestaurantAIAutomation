/**
 * A house item the wine library does not have waits for research by its id,
 * and a name that cannot identify a wine is skipped and flagged — the founder,
 * 2026-09-21 (ADR 0192's amendment): *"If its found that it s nowhere to be
 * found, like wine 1 and wine 2 and such, then we skip it and flag it."*
 *
 * Real: the classifier, the queue writer and reader, and
 * `InventoryService.updateInventoryItem` (the rename path the flag points at),
 * over one in-memory store (`FakeDb`, which enforces nothing it is not told
 * to; the unique index and the tenancy trigger are proven in PGlite,
 * p4-scratch/pglite-probe/E3-migrations.mjs).
 */
import {
  NAME_THIS_WINE_FLAG,
  classifyHouseItemName,
  enqueueHouseItemResearch,
  foldName,
  readHouseItemResearch,
} from "./house-item-research";
import { InventoryService } from "./inventory.service";
import { FakeDb } from "../notifications/producers/testing/fake-db";

const HOUSE = "house-1";
const ITEM = "11111111-1111-4111-8111-111111111111";
const ORDER = "44444444-4444-4444-8444-444444444444";
const PERSON = "u-manager";

describe("which names cannot identify a wine (the classifier)", () => {
  const placeholders = [
    "wine 1",
    "Wine 2",
    "WINE #3",
    "wine no. 4",
    "wine-5",
    "wine_6",
    "Wine",
    "item 14",
    "bottle 2",
    "sample b",
    "test",
    "n/a",
    "TBD",
    "house red",
    "House White Wine",
    "red wine",
    "red",
    "Rosé",
    "rose 2021",
    "sparkling 2",
    "house wine",
    "ev şarabı",
    "Kırmızı Şarap",
    "KIRMIZI",
    "beyaz şarap 2",
    "şarap 3",
    "yeni şarap",
    "12",
    "#7",
    "b",
    "",
    "   ",
  ];
  it.each(placeholders)("%j is not findable", (name) => {
    const verdict = classifyHouseItemName(name);
    expect(verdict.findable).toBe(false);
  });

  it("null and undefined are not findable, with a reason", () => {
    expect(classifyHouseItemName(null)).toEqual({ findable: false, reason: expect.stringMatching(/no name/) });
    expect(classifyHouseItemName(undefined)).toEqual({ findable: false, reason: expect.stringMatching(/no name/) });
  });

  const wines = [
    "Produttori del Barbaresco 2019",
    "Barolo",
    "Château Margaux 2015",
    "Kavaklıdere Yakut",
    "Red Obsession Shiraz",
    "White Horse",
    "Dom Pérignon",
    "Sancerre",
    "Wine of the Day Sangiovese",
    "Rosé de Provence Miraval",
    "Doluca DLC Öküzgözü",
  ];
  it.each(wines)("%j is researchable", (name) => {
    expect(classifyHouseItemName(name)).toEqual({ findable: true });
  });

  // Last call, 2026-09-21: the counter glued to the noun ("Wine1") was
  // researched as a wine, and a name in a script the fold drops read as "no
  // words in it" and was flagged — the one error the rule exists to avoid.
  it.each(["Wine1", "wine2", "WINE01", "wine 1a", "Wine12B", "item7", "red1", "house red2"])(
    "%j (a counter written without a space) is not findable",
    (name) => {
      expect(classifyHouseItemName(name).findable).toBe(false);
    },
  );

  it.each(["Ξινόμαυρο", "Саперави", "ქინძმარაული", "獺祭 純米大吟醸", "Саперави 2019"])(
    "%j (a script the fold does not read) is researchable, never a placeholder",
    (name) => {
      expect(classifyHouseItemName(name)).toEqual({ findable: true });
    },
  );

  it("a placeholder's reason quotes the name as the house wrote it", () => {
    const verdict = classifyHouseItemName("Wine 2");
    expect(verdict).toEqual({ findable: false, reason: expect.stringContaining('"Wine 2" is a placeholder') });
  });

  it("folds accents, Turkish letters and punctuation before comparing", () => {
    expect(foldName("Kırmızı  Şarap!")).toBe("kirmizi sarap");
    expect(foldName("Rosé-2021")).toBe("rose 2021");
    expect(foldName("İÇKİ")).toBe("icki");
  });
});

function store() {
  const db = new FakeDb();
  db.tables.house_item_research = [];
  return db;
}

describe("the queue row, keyed by the item's id", () => {
  const base = {
    restaurantId: HOUSE,
    inventoryId: ITEM,
    queuedFrom: "delivery" as const,
    sourceOrderId: ORDER,
    queuedBy: PERSON,
  };

  it("queues a real name, and keeps no copy of the name", async () => {
    const db = store();
    const out = await enqueueHouseItemResearch(db, { ...base, name: "Barolo" });
    expect(out).toEqual({ ok: true, status: "queued", reason: expect.any(String), changed: true });
    expect(db.tables.house_item_research).toEqual([
      expect.objectContaining({
        restaurant_id: HOUSE,
        inventory_id: ITEM,
        status: "queued",
        queued_from: "delivery",
        source_order_id: ORDER,
        queued_by: PERSON,
      }),
    ]);
    expect(JSON.stringify(db.tables.house_item_research[0])).not.toContain("Barolo");
  });

  it("marks a placeholder not_findable at once, and it is never queued for research", async () => {
    const db = store();
    const out = await enqueueHouseItemResearch(db, { ...base, name: "wine 1" });
    expect(out).toMatchObject({ ok: true, status: "not_findable" });
    expect(db.tables.house_item_research[0].status).toBe("not_findable");
  });

  it("a second call for the same item changes nothing", async () => {
    const db = store();
    await enqueueHouseItemResearch(db, { ...base, name: "Barolo" });
    const again = await enqueueHouseItemResearch(db, { ...base, name: "Barolo" });
    expect(again).toMatchObject({ ok: true, status: "queued", changed: false });
    expect(db.tables.house_item_research).toHaveLength(1);
  });

  it("a rename to a real wine moves not_findable to queued, on the same row", async () => {
    const db = store();
    await enqueueHouseItemResearch(db, { ...base, name: "Wine 2" });
    const renamed = await enqueueHouseItemResearch(db, {
      ...base,
      name: "Kavaklıdere Yakut 2019",
      queuedFrom: "rename",
      sourceOrderId: null,
    });
    expect(renamed).toMatchObject({ ok: true, status: "queued", changed: true });
    expect(db.tables.house_item_research).toHaveLength(1);
    expect(db.tables.house_item_research[0]).toMatchObject({ status: "queued", queued_from: "rename" });
  });

  it("a row research already matched is never moved back by a rename", async () => {
    const db = store();
    db.tables.house_item_research.push({
      id: "hir-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      status: "matched",
      reason: "Matched to the library by research.",
      matched_master_wine_id: "55555555-5555-4555-8555-555555555555",
    });
    const out = await enqueueHouseItemResearch(db, { ...base, name: "wine 1", queuedFrom: "rename" });
    expect(out).toMatchObject({ ok: true, status: "matched", changed: false });
    expect(db.tables.house_item_research[0].status).toBe("matched");
  });

  // Two layers hold "matched is never moved back": the early return (no write
  // at all) and the write's own `status <> matched` condition (a match that
  // lands between the read and the write). Each is proved on its own.
  const counting = (db: FakeDb, beforeUpdate?: () => void) => {
    const updates: unknown[] = [];
    const client = {
      from: (table: string) => {
        const q: any = db.from(table);
        const update = q.update.bind(q);
        q.update = (values: unknown) => {
          updates.push(values);
          beforeUpdate?.();
          return update(values);
        };
        return q;
      },
    };
    return { client, updates };
  };

  it("a matched row is left alone without even a write", async () => {
    const db = store();
    db.tables.house_item_research.push({
      id: "hir-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      status: "matched",
      reason: "Matched to the library by research.",
      matched_master_wine_id: "55555555-5555-4555-8555-555555555555",
    });
    const { client, updates } = counting(db);
    const out = await enqueueHouseItemResearch(client, { ...base, name: "Barolo", queuedFrom: "rename" });
    expect(out).toMatchObject({ ok: true, status: "matched", changed: false });
    expect(updates).toHaveLength(0);
  });

  it("research that matches the row between the read and the write wins", async () => {
    const db = store();
    db.tables.house_item_research.push({
      id: "hir-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      status: "not_findable",
      reason: "placeholder",
      matched_master_wine_id: null,
    });
    const { client, updates } = counting(db, () => {
      Object.assign(db.tables.house_item_research[0], {
        status: "matched",
        matched_master_wine_id: "55555555-5555-4555-8555-555555555555",
      });
    });
    const out = await enqueueHouseItemResearch(client, { ...base, name: "Barolo", queuedFrom: "rename" });
    expect(updates).toHaveLength(1);
    expect(out).toMatchObject({ ok: true, status: "matched", changed: false });
    expect(db.tables.house_item_research[0].status).toBe("matched");
  });

  it("another house's row for the same item id is not read as this house's", async () => {
    const db = store();
    db.tables.house_item_research.push({
      id: "hir-x",
      restaurant_id: "another-house",
      inventory_id: ITEM,
      status: "matched",
      reason: "x",
    });
    // The read is scoped by house: this house sees no row and tries to write
    // its own (the unique index and the tenancy trigger refuse it in Postgres).
    const out = await enqueueHouseItemResearch(db, { ...base, name: "Barolo" });
    expect(out).toMatchObject({ ok: true, status: "queued", changed: true });
  });

  it("a queue that cannot be read is an error, never an empty queue", async () => {
    const db = store();
    db.failures.house_item_research = "connection reset";
    const out = await enqueueHouseItemResearch(db, { ...base, name: "Barolo" });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/could not be read \(connection reset\)/) });
  });

  it("a duplicate insert from a concurrent request is one row, not an error", async () => {
    const client = {
      from: () => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async () => ({ data: null, error: { code: "23505", message: "duplicate key value" } }),
        };
        return q;
      },
    };
    const out = await enqueueHouseItemResearch(client, { ...base, name: "Barolo" });
    expect(out).toMatchObject({ ok: true, status: "queued", changed: false });
  });

  it("a refused insert is said", async () => {
    const client = {
      from: () => {
        const q: any = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: async () => ({ data: null, error: { code: "42501", message: "not an item of restaurant" } }),
        };
        return q;
      },
    };
    const out = await enqueueHouseItemResearch(client, { ...base, name: "Barolo" });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/not an item of restaurant/) });
  });
});

describe("what the house reads", () => {
  it("the flag sits only on a not_findable item", async () => {
    const db = store();
    db.tables.house_item_research.push(
      { id: "a", restaurant_id: HOUSE, inventory_id: "i-1", status: "not_findable", reason: "r", updated_at: "2026-09-21T10:00:00Z" },
      { id: "b", restaurant_id: HOUSE, inventory_id: "i-2", status: "queued", reason: "r", updated_at: "2026-09-21T09:00:00Z" },
      { id: "c", restaurant_id: "another-house", inventory_id: "i-3", status: "not_findable", reason: "r", updated_at: "2026-09-21T08:00:00Z" },
    );
    const items = await readHouseItemResearch(db, HOUSE);
    expect(items.map((i) => [i.inventoryId, i.status, i.flag])).toEqual([
      ["i-1", "not_findable", NAME_THIS_WINE_FLAG],
      ["i-2", "queued", null],
    ]);
    expect(NAME_THIS_WINE_FLAG).toBe(
      "Tell us which wine this is and we can help you build better menus and promotions",
    );
  });

  it("a failed read throws; it is never an empty list", async () => {
    const db = store();
    db.failures.house_item_research = "permission denied";
    await expect(readHouseItemResearch(db, HOUSE)).rejects.toThrow(/could not be read \(permission denied\)/);
  });
});

describe("the rename the flag points at (InventoryService.updateInventoryItem)", () => {
  function inventory(item: Record<string, any>) {
    const db = store();
    db.tables.restaurant_inventory = [
      { id: ITEM, restaurant_id: HOUSE, master_wine_id: null, wine_name: "Wine 2", stock_live: 0, shadow_stock: 0, ...item },
    ];
    db.tables.house_item_research.push({
      id: "hir-1",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      status: "not_findable",
      reason: 'The name "Wine 2" is a placeholder.',
      queued_from: "delivery",
    });
    const svc = new InventoryService({ getClient: () => db, client: db, supabase: db } as any);
    return { db, svc };
  }

  it("naming a flagged item re-queues it for research, found by its id", async () => {
    const { db, svc } = inventory({});
    await svc.updateInventoryItem(HOUSE, ITEM, { wineName: "Kavaklıdere Yakut 2019" } as any, PERSON);
    expect(db.tables.restaurant_inventory[0].wine_name).toBe("Kavaklıdere Yakut 2019");
    expect(db.tables.house_item_research).toHaveLength(1);
    expect(db.tables.house_item_research[0]).toMatchObject({ status: "queued", queued_from: "rename" });
  });

  it("renaming it to another placeholder keeps it flagged", async () => {
    const { db, svc } = inventory({});
    await svc.updateInventoryItem(HOUSE, ITEM, { wineName: "house red" } as any, PERSON);
    expect(db.tables.house_item_research[0].status).toBe("not_findable");
    expect(db.tables.house_item_research[0].reason).toMatch(/"house red" is a placeholder/);
  });

  it("a library wine's rename touches no research row", async () => {
    const { db, svc } = inventory({ master_wine_id: "55555555-5555-4555-8555-555555555555" });
    db.tables.house_item_research = [];
    await svc.updateInventoryItem(HOUSE, ITEM, { wineName: "House alias" } as any, PERSON);
    expect(db.tables.house_item_research).toHaveLength(0);
  });

  it("a queue that cannot be written after the rename is a 500 that says the name was saved", async () => {
    const { db, svc } = inventory({});
    db.failures.house_item_research = "permission denied";
    await expect(
      svc.updateInventoryItem(HOUSE, ITEM, { wineName: "Kavaklıdere Yakut 2019" } as any, PERSON),
    ).rejects.toThrow(/The name was saved, but whether this wine can now be looked up was not recorded/);
    expect(db.tables.restaurant_inventory[0].wine_name).toBe("Kavaklıdere Yakut 2019");
  });

  it("the list the flag reads is this house's, and a failed read is a 503", async () => {
    const { db, svc } = inventory({});
    await expect(svc.listHouseItemResearch(HOUSE)).resolves.toEqual({
      items: [expect.objectContaining({ inventoryId: ITEM, status: "not_findable", flag: NAME_THIS_WINE_FLAG })],
    });
    db.failures.house_item_research = "permission denied";
    await expect(svc.listHouseItemResearch(HOUSE)).rejects.toMatchObject({ status: 503 });
  });
});
