import { readFileSync } from "fs";
import { join } from "path";

/**
 * The naming rule — ADR 0124, the founder 2026-09-05 (batch 49):
 * **"One alias on the item, library immutable."**
 * *"Names are the house's; identity is the library's."*
 *
 * `restaurant_inventory.wine_name` ALREADY existed and this service already
 * preferred it over the library's name when reading. What did not exist was a
 * way for a house to SET it, and a way for the library's name to stay findable
 * once a house had. Both are asserted here, plus the thing the rule forbids:
 * this path must never write to `master_wine_library`.
 */

/** The pure half of the mapping, lifted so it can be asserted without a DB. */
function mapRow(row: any) {
  const wineName: string | null =
    row.wine_name || row.master_wine_library?.name || null;
  const libraryName: string | null = row.master_wine_library?.name ?? null;
  const houseAlias: string | null = row.wine_name || null;
  return { wineName, libraryName, houseAlias };
}

describe("the house's alias and the library's name", () => {
  it("shows the house's alias when it has set one", () => {
    const m = mapRow({
      wine_name: "Wine X",
      master_wine_library: { name: "1988 Wine X" },
    });
    expect(m.wineName).toBe("Wine X");
    expect(m.houseAlias).toBe("Wine X");
  });

  it("keeps the library's name findable beside it — the founder's 'both names searchable'", () => {
    const m = mapRow({
      wine_name: "Wine X",
      master_wine_library: { name: "1988 Wine X" },
    });
    expect(m.libraryName).toBe("1988 Wine X");
    // The case the rule exists for: searching the vintage must still find it.
    const query = "1988";
    const matches =
      (m.wineName ?? "").toLowerCase().includes(query) ||
      (m.libraryName ?? "").toLowerCase().includes(query);
    expect(matches).toBe(true);
    // And it is NOT what is displayed.
    expect(m.wineName).not.toBe(m.libraryName);
  });

  it("falls back to the library's name, and says the house set nothing", () => {
    const m = mapRow({ wine_name: null, master_wine_library: { name: "1988 Wine X" } });
    expect(m.wineName).toBe("1988 Wine X");
    expect(m.houseAlias).toBeNull();
    expect(m.libraryName).toBe("1988 Wine X");
  });

  it("carries a null library name rather than echoing the alias into it", () => {
    const m = mapRow({ wine_name: "House White", master_wine_library: null });
    expect(m.libraryName).toBeNull();
    expect(m.wineName).toBe("House White");
  });
});

describe("setting the alias", () => {
  const dto = (wineName?: string) => ({ wineName }) as any;

  /** The exact branch `updateInventoryItem` runs, asserted in isolation. */
  function aliasPatch(d: { wineName?: string }): Record<string, any> {
    const updateData: Record<string, any> = {};
    if (d.wineName !== undefined) {
      const alias = d.wineName.trim();
      updateData.wine_name = alias.length > 0 ? alias : null;
    }
    return updateData;
  }

  it("writes the trimmed alias", () => {
    expect(aliasPatch(dto("  Wine X  "))).toEqual({ wine_name: "Wine X" });
  });

  it("CLEARS the alias on an empty string rather than storing a name of nothing", () => {
    expect(aliasPatch(dto(""))).toEqual({ wine_name: null });
    expect(aliasPatch(dto("   "))).toEqual({ wine_name: null });
  });

  it("leaves the alias alone when the field is absent", () => {
    expect(aliasPatch(dto(undefined))).toEqual({});
    expect("wine_name" in aliasPatch(dto(undefined))).toBe(false);
  });

  it("never names master_wine_library in the patch it builds", () => {
    const patch = aliasPatch(dto("Wine X"));
    expect(Object.keys(patch)).toEqual(["wine_name"]);
    expect(JSON.stringify(patch)).not.toContain("master_wine");
  });
});

describe("the rule holds in the source itself", () => {
  it("the update path writes wine_name and nothing on the library", () => {
    // Read the real file: a future edit that starts writing the library from
    // this path is the thing the founder's rule forbids, and a test that only
    // exercises a copy of the branch cannot see it.
    const src = readFileSync(join(__dirname, "inventory.service.ts"), "utf8");
    const start = src.indexOf("async updateInventoryItem(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 4000);
    expect(body).toContain("updateData.wine_name");
    expect(body).not.toContain('from("master_wine_library")');
  });
});
