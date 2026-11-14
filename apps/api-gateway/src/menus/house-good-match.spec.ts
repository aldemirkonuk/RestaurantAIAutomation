import { foldName, kindFits, kindNoun, lineFamily, matchHouseGoods, matchLine, nameParts, type HouseGood } from "./house-good-match";

const g = (over: Partial<HouseGood> & { id: string }): HouseGood => ({
  display_name: null,
  wine_name: null,
  kind: "wine",
  master_wine_id: null,
  bottle_size_ml: null,
  ...over,
});

describe("nameParts: a name folded, with a year and a size at its end read off", () => {
  it.each([
    ["Local Check Cabernet 2020", "local check cabernet", "2020", null],
    ["Château Margaux 2015 75cl", "chateau margaux", "2015", 750],
    ["Château Margaux 75 cl (2015)", "chateau margaux", "2015", 750],
    ["Tonik 200 ml", "tonik", null, 200],
    ["Rakı 1,5 L", "raki", null, 1500],
    ["  House   London-Dry  Gin ", "house london dry gin", null, null],
    ["Chivas 18", "chivas 18", null, null],
  ])("%s", (raw, key, vintage, sizeMl) => {
    expect(nameParts(raw)).toEqual({ key, vintage, sizeMl });
  });
});

describe("r28 G6: the dotless ı is read as i, here and not in the library's fold", () => {
  it("folds Rakı and RAKI the same, and İ too", () => {
    expect(foldName("Yeni Rakı")).toBe("yeni raki");
    expect(foldName("Yeni RAKI")).toBe("yeni raki");
    expect(foldName("İSTANBUL Kırmızı")).toBe("istanbul kirmizi");
    expect(nameParts("Yeni Rakı 70cl").key).toBe("yeni raki");
  });

  it("a RAKI line finds the house's Rakı, under a Rakı section", () => {
    const goods = [g({ id: "r1", display_name: "Yeni Rakı", kind: "spirit" })];
    expect(matchLine({ name: "Yeni RAKI", category: "RAKI" }, goods)).toMatchObject({ outcome: "one", good: { id: "r1" } });
    expect(matchLine({ name: "Yeni Rakı 70cl", category: "Rakılar" }, goods)).toMatchObject({ outcome: "one", good: { id: "r1" } });
    // The producer, when the library states it, is folded the same way.
    expect(
      matchLine({ name: "Yaş Üzüm", producer: "Tekirdağ RAKISI" }, [g({ id: "r2", display_name: "Yaş Üzüm", kind: "spirit", producer: "Tekirdağ Rakısı" })]),
    ).toMatchObject({ outcome: "one", good: { id: "r2" } });
  });

  it("reads a Turkish drink section's kind", () => {
    expect(lineFamily("Biralar")).toBe("beer");
    expect(lineFamily("Kokteyller")).toBe("cocktail");
    expect(lineFamily("Alkolsüz İçecekler")).toBe("soft");
    expect(lineFamily("Meşrubatlar")).toBe("soft");
    expect(lineFamily("RAKILAR")).toBe("spirit");
    expect(lineFamily("Rakılar")).toBe("spirit");
    expect(lineFamily("Rakı")).toBe("spirit");
    expect(lineFamily("Viskiler")).toBe("spirit");
    expect(lineFamily("Kırmızı Şaraplar")).toBe("wine");
    expect(lineFamily("Köpüklü")).toBe("wine");
    // A Turkish beer line does not take the house's wine of the same name.
    expect(matchLine({ name: "Efes", category: "Biralar" }, [g({ id: "w", display_name: "Efes", kind: "wine" })])).toEqual({ outcome: "none" });
  });
});

describe("lineFamily and kindFits", () => {
  it("reads a category's kind, soft drinks first", () => {
    expect(lineFamily("Spirits")).toBe("spirit");
    expect(lineFamily("whiskey")).toBe("spirit");
    expect(lineFamily("Red")).toBe("wine");
    expect(lineFamily("dessert wine")).toBe("wine");
    expect(lineFamily("Non-alcoholic beer")).toBe("soft");
    expect(lineFamily("beer")).toBe("beer");
    expect(lineFamily("cocktail")).toBe("cocktail");
    expect(lineFamily("")).toBeNull();
    expect(lineFamily("Specials")).toBeNull();
  });
  it("never fits a food or a supply; an untyped drink fits every line", () => {
    expect(kindFits(null, "food")).toBe(false);
    expect(kindFits("spirit", "supply")).toBe(false);
    expect(kindFits("soft", "other")).toBe(true);
    expect(kindFits("spirit", "whiskey")).toBe(true);
    expect(kindFits("spirit", "wine")).toBe(false);
    expect(kindFits(null, "wine")).toBe(true);
  });
  it("kindNoun names the good's kind", () => {
    expect(kindNoun("spirit")).toBe("spirit");
    expect(kindNoun("wine")).toBe("wine");
    expect(kindNoun("soft_drink")).toBe("drink");
    expect(kindNoun("food")).toBe("good");
    expect(kindNoun(null)).toBe("drink");
  });
});

describe("matchLine", () => {
  it("one good by its display name or its wine name", () => {
    const goods = [g({ id: "a", display_name: "Barolo Riserva" }), g({ id: "b", wine_name: "Etna Rosso" })];
    expect(matchLine({ name: "BAROLO riserva" }, goods)).toEqual({ outcome: "one", good: goods[0] });
    expect(matchLine({ name: "Etna Rosso" }, goods)).toEqual({ outcome: "one", good: goods[1] });
    expect(matchLine({ name: "Etna" }, goods)).toEqual({ outcome: "none" });
  });
  it("a stated vintage or size on both sides must agree; unknown on one side is no difference", () => {
    const goods = [g({ id: "19", display_name: "Barolo", vintage: 2019 }), g({ id: "20", display_name: "Barolo", vintage: "2020" })];
    expect(matchLine({ name: "Barolo 2020" }, goods)).toEqual({ outcome: "one", good: goods[1] });
    expect(matchLine({ name: "Barolo", vintage: "2019" }, goods)).toEqual({ outcome: "one", good: goods[0] });
    expect(matchLine({ name: "Barolo" }, goods).outcome).toBe("many");
    expect(matchLine({ name: "Barolo 2017" }, goods)).toEqual({ outcome: "none" });
    const sizes = [g({ id: "half", display_name: "Tonik", kind: "other", bottle_size_ml: 200 })];
    expect(matchLine({ name: "Tonik 330 ml" }, sizes)).toEqual({ outcome: "none" });
    expect(matchLine({ name: "Tonik 20cl" }, sizes).outcome).toBe("one");
    expect(matchLine({ name: "Tonik" }, sizes).outcome).toBe("one");
  });
  it("a line whose producer is split off finds a good named with it", () => {
    const goods = [g({ id: "c", display_name: "Caymus Cabernet Sauvignon" })];
    expect(matchLine({ name: "Cabernet Sauvignon", producer: "Caymus" }, goods).outcome).toBe("one");
    expect(matchLine({ name: "Cabernet Sauvignon" }, goods).outcome).toBe("none");
  });
  it("a line that is only a year names nothing", () => {
    expect(matchLine({ name: "2020" }, [g({ id: "x", display_name: "2020" })])).toEqual({ outcome: "none" });
  });
});

/** A builder that honours what the read uses: eq, is, gt, order by id, limit. */
function pagingClient(tables: Record<string, Array<Record<string, any>>>, fails: Record<string, string> = {}) {
  const reads: string[] = [];
  return {
    reads,
    from(table: string) {
      const preds: Array<(r: Record<string, any>) => boolean> = [];
      let cap = Infinity;
      const api: any = {
        select: () => api,
        eq: (c: string, v: unknown) => (preds.push((r) => r[c] === v), api),
        is: (c: string, v: unknown) => (preds.push((r) => (r[c] ?? null) === v), api),
        gt: (c: string, v: string) => (preds.push((r) => String(r[c]) > v), api),
        in: (c: string, vs: unknown[]) => (preds.push((r) => vs.includes(r[c])), api),
        order: () => api,
        limit: (n: number) => ((cap = n), api),
        then(resolve: (v: unknown) => void) {
          reads.push(table);
          if (fails[table]) return resolve({ data: null, error: { message: fails[table] } });
          const rows = (tables[table] ?? [])
            .filter((r) => preds.every((p) => p(r)))
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .slice(0, cap);
          resolve({ data: rows, error: null });
        },
      };
      return api;
    },
  };
}

describe("matchHouseGoods: the reads", () => {
  const live = (i: number, over: Record<string, any> = {}) => ({
    id: `inv-${String(i).padStart(5, "0")}`,
    restaurant_id: "rest-1",
    is_active: true,
    deleted_at: null,
    display_name: `Good ${i}`,
    wine_name: null,
    kind: "wine",
    master_wine_id: null,
    bottle_size_ml: null,
    ...over,
  });

  it("r28 G5: each good's name is read once per index, not once per line", async () => {
    const goods = 300;
    let reads = 0;
    const rows = Array.from({ length: goods }, (_, i) => {
      const row = live(i);
      Object.defineProperty(row, "display_name", { enumerable: true, get: () => (reads++, `Good ${i}`) });
      return row;
    });
    const client = pagingClient({ restaurant_inventory: rows });
    const lines = Array.from({ length: 200 }, (_, i) => ({ name: i % 2 ? `Good ${i}` : `Not stocked ${i}`, category: "red" }));
    const out = await matchHouseGoods(client, "rest-1", lines);
    expect(out[1]).toMatchObject({ outcome: "one", good: { id: "inv-00001" } });
    expect(out[0]).toEqual({ outcome: "none" });
    expect(out.filter((m) => m.outcome === "one")).toHaveLength(100);
    // One fold per good, plus the named goods copied once with their library
    // details and indexed again: never lines x goods (60,000).
    expect(reads).toBeLessThanOrEqual(goods + 3 * 100);
  });

  it("r28 G5: two goods of one name answer 'many' in the order the house lists them", () => {
    const goods = [
      g({ id: "b", display_name: "Barolo 2019" }),
      g({ id: "x", display_name: "Chianti" }),
      g({ id: "a", display_name: "Barolo", wine_name: "Barolo 2018" }),
    ];
    expect(matchLine({ name: "Barolo" }, goods)).toEqual({ outcome: "many", goods: [goods[0], goods[2]] });
    expect(matchLine({ name: "Barolo 2018" }, goods)).toEqual({ outcome: "one", good: goods[2] });
    // The producer-and-name form finds an earlier good than the name alone: still list order.
    const two = [g({ id: "c1", display_name: "Caymus Cabernet" }), g({ id: "c2", display_name: "Cabernet" })];
    expect(matchLine({ name: "Cabernet", producer: "Caymus" }, two)).toEqual({ outcome: "many", goods: two });
  });

  it("reads past the 1000-row cap: a good on the second page is found", async () => {
    const rows = Array.from({ length: 1205 }, (_, i) => live(i));
    rows[1150] = live(1150, { display_name: "House London Dry Gin", kind: "spirit" });
    const client = pagingClient({ restaurant_inventory: rows });
    const [m] = await matchHouseGoods(client, "rest-1", [{ name: "House London Dry Gin", category: "Spirits" }]);
    expect(m).toMatchObject({ outcome: "one", good: { id: "inv-01150" } });
    expect(client.reads.filter((t) => t === "restaurant_inventory")).toHaveLength(2);
  });

  it("reads this house's live goods only", async () => {
    const client = pagingClient({
      restaurant_inventory: [
        live(1, { restaurant_id: "rest-2", display_name: "Gin" }),
        live(2, { is_active: false, display_name: "Gin" }),
        live(3, { deleted_at: "2026-11-01T00:00:00Z", display_name: "Gin" }),
      ],
    });
    expect(await matchHouseGoods(client, "rest-1", [{ name: "Gin" }])).toEqual([{ outcome: "none" }]);
  });

  it("the library's vintage and producer decide: a 2019 line does not take the 2020 wine, nor Caymus the Duckhorn", async () => {
    const client = pagingClient({
      restaurant_inventory: [live(1, { display_name: "Barolo", master_wine_id: "mw-20" }), live(2, { display_name: "Etna", master_wine_id: "mw-x" })],
      master_wine_library: [{ id: "mw-20", vintage: 2020, producer: "Duckhorn" }, { id: "mw-x", vintage: 2018, producer: null }],
    });
    const out = await matchHouseGoods(client, "rest-1", [
      { name: "Barolo 2019" },
      { name: "Barolo" },
      { name: "Barolo", producer: "Caymus" },
      { name: "Barolo", producer: "duckhorn" },
    ]);
    expect(out[0]).toEqual({ outcome: "none" });
    expect(out[1]).toMatchObject({ outcome: "one", good: { id: "inv-00001", vintage: 2020, producer: "Duckhorn" } });
    expect(out[2]).toEqual({ outcome: "none" });
    expect(out[3]).toMatchObject({ outcome: "one", good: { id: "inv-00001" } });
  });

  it("no drink line, no read; a failed read throws, never 'nothing carried'", async () => {
    const idle = pagingClient({});
    expect(await matchHouseGoods(idle, "rest-1", [null, null])).toEqual([{ outcome: "none" }, { outcome: "none" }]);
    expect(idle.reads).toHaveLength(0);
    await expect(
      matchHouseGoods(pagingClient({}, { restaurant_inventory: "timeout" }), "rest-1", [{ name: "Gin" }]),
    ).rejects.toThrow(/the house's goods could not be read: timeout/);
    await expect(
      matchHouseGoods(
        pagingClient({ restaurant_inventory: [live(1, { display_name: "Gin", master_wine_id: "mw-1" })] }, { master_wine_library: "gone" }),
        "rest-1",
        [{ name: "Gin" }],
      ),
    ).rejects.toThrow(/vintages and producers of the house's wines could not be read: gone/);
  });
});
