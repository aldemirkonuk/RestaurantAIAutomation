import { InventoryService } from "./inventory.service";

/**
 * ADR 0341 F3 (founder S218: "Yes, stamp cost basis"); ledger S234, owed by
 * w106-cost-truth: a manual receipt, a wine added with stock and an opening
 * count recorded a cost but never whether tax was inside it, so margin advice
 * at a house whose till prices include tax refused every such cost as "cost
 * basis not stated".
 *
 * Each now stamps what an owner or a manager said, on the bottles that write
 * costed and on no other. Unset and excluding houses, and a cost nobody said
 * anything about, stay exactly as they were.
 */
const HOUSE = "house-a";
const ITEM = "item-1";

type Lot = {
  id: string;
  unit_cost: number | null;
  unit_cost_tax_basis: string | null;
};

function fake(
  taxBasis: string,
  lots: Lot[],
  opts: { costApplied?: boolean } = {},
) {
  const updates: { table: string; patch: any; ids: unknown[] | null }[] = [];
  const lotReads: string[] = [];
  let nextLot = 1;
  const rpc = jest.fn(async (fn: string, args: any) => {
    if (fn === "apply_stock_movement" && args.p_delta > 0) {
      lots.push({
        id: `new-${nextLot++}`,
        unit_cost: args.p_unit_cost ?? null,
        unit_cost_tax_basis: null,
      });
      return { data: "txn-1", error: null };
    }
    if (fn === "record_stock_count") {
      if (opts.costApplied)
        lots.push({
          id: `new-${nextLot++}`,
          unit_cost: args.p_unit_cost,
          unit_cost_tax_basis: null,
        });
      return {
        data: {
          count_id: "c1",
          counted_qty: args.p_counted_qty,
          replayed: false,
          ...(args.p_unit_cost != null
            ? { cost_applied: opts.costApplied === true }
            : {}),
        },
        error: null,
      };
    }
    return { data: null, error: null };
  });
  const from = (table: string) => {
    let patch: any = null;
    let ids: unknown[] | null = null;
    let costedOnly = false;
    const rows = () => {
      if (table === "restaurants") return [{ tax_basis: taxBasis }];
      if (table === "inventory_lots")
        return lots.filter((l) => !costedOnly || l.unit_cost != null);
      if (table === "restaurant_inventory") return [{ id: ITEM }];
      return [];
    };
    const settle = () => {
      if (patch) {
        updates.push({ table, patch, ids });
        return { data: null, error: null };
      }
      if (table === "inventory_lots")
        lotReads.push(costedOnly ? "costed" : "all");
      return { data: rows(), error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      not: (col: string) => {
        if (col === "unit_cost") costedOnly = true;
        return chain;
      },
      in: (_c: string, v: unknown[]) => {
        ids = v;
        return chain;
      },
      update: (p: any) => {
        patch = p;
        return chain;
      },
      insert: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      single: () =>
        Promise.resolve({ data: { id: ITEM, ...rows()[0] }, error: null }),
      then: (res: any, rej: any) => Promise.resolve(settle()).then(res, rej),
    };
    return chain;
  };
  const client = { rpc, from };
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client, supabase: client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  svc.resolveBulkLineWine = jest.fn().mockResolvedValue({
    masterWineId: "mw-1",
    wineName: "Kavaklıdere Yakut",
    matched: true,
    libraryTier: 1,
  });
  svc.houseDefaultParMin = jest.fn().mockResolvedValue(3);
  svc.refuseCountOvertakenByStock = jest.fn().mockResolvedValue(undefined);
  svc.fetchLotRollup = jest.fn().mockResolvedValue(new Map());
  svc.fetchLocationBreakdown = jest.fn().mockResolvedValue(new Map());
  svc.gradePhotoCountSuggestion = jest.fn().mockResolvedValue(undefined);
  const stamps = () =>
    updates.filter(
      (u) => u.table === "inventory_lots" && "unit_cost_tax_basis" in u.patch,
    );
  return {
    svc: svc as InventoryService & Record<string, any>,
    stamps,
    lotReads,
  };
}

const receipt = (extra: Record<string, unknown>) => ({
  source: "manual_receipt",
  items: [
    {
      wineDraft: { name: "Kavaklıdere Yakut" },
      stockLive: 6,
      costPerBottle: 420,
      costProvenance: "manual",
      ...extra,
    },
  ],
});

describe("a manual receipt stamps whether tax is inside its cost (ADR 0341 F3)", () => {
  it("[REVERT-FAILS] stamps the bottles it booked, and only those", async () => {
    // The wine already has a costed lot at the same figure, stated by nobody.
    const t = fake("prices_include_tax", [
      { id: "old-1", unit_cost: 420, unit_cost_tax_basis: null },
    ]);
    await t.svc.bulkCreateInventoryItems(
      HOUSE,
      receipt({ costTaxBasis: "excludes_tax" }) as any,
    );
    expect(t.stamps()).toEqual([
      {
        table: "inventory_lots",
        patch: { unit_cost_tax_basis: "excludes_tax" },
        ids: ["new-1"],
      },
    ]);
  });

  it("stamps nothing when nobody said, and reads no lot for it", async () => {
    const t = fake("prices_include_tax", []);
    await t.svc.bulkCreateInventoryItems(HOUSE, receipt({}) as any);
    expect(t.stamps()).toEqual([]);
    expect(t.lotReads).toEqual([]);
  });

  it("is an exact no-op at an unset or an excluding house (ADR 0341 §2)", async () => {
    for (const basis of ["unset", "prices_exclude_tax", "not_vat_charging"]) {
      const t = fake(basis, []);
      await t.svc.bulkCreateInventoryItems(
        HOUSE,
        receipt({ costTaxBasis: "includes_tax" }) as any,
      );
      expect(t.stamps()).toEqual([]);
      expect(t.lotReads).toEqual([]);
    }
  });

  it("never stamps a sample's deliberate zero", async () => {
    const t = fake("prices_include_tax", []);
    await t.svc.bulkCreateInventoryItems(
      HOUSE,
      receipt({
        costPerBottle: 0,
        costProvenance: "sample",
        costTaxBasis: "includes_tax",
      }) as any,
    );
    expect(t.stamps()).toEqual([]);
  });
});

describe("a wine added with stock stamps its cost (ADR 0341 F3)", () => {
  it("[REVERT-FAILS] stamps the new wine's first bottles", async () => {
    const t = fake("prices_include_tax", []);
    await t.svc
      .createInventoryItem(
        HOUSE,
        {
          wineId: "mw-1",
          stockLive: 4,
          costPerBottle: 380,
          costTaxBasis: "includes_tax",
        } as any,
        null,
      )
      .catch(() => undefined);
    expect(t.stamps()).toEqual([
      {
        table: "inventory_lots",
        patch: { unit_cost_tax_basis: "includes_tax" },
        ids: ["new-1"],
      },
    ]);
  });
});

describe("an opening count stamps the cost it applied (ADR 0341 F3, F-1524)", () => {
  const opening = {
    countedQty: 6,
    clientCountId: "opening-stock:1",
    opening: true,
    costPerBottle: 300,
    costProvenance: "manual" as const,
    costTaxBasis: "excludes_tax",
  };

  it("[REVERT-FAILS] stamps the bottles the count costed", async () => {
    const t = fake("prices_include_tax", [], { costApplied: true });
    await t.svc.recordSpotCount(HOUSE, ITEM, opening);
    expect(t.stamps()).toEqual([
      {
        table: "inventory_lots",
        patch: { unit_cost_tax_basis: "excludes_tax" },
        ids: ["new-1"],
      },
    ]);
  });

  it("stamps nothing when the wine kept the cost it had", async () => {
    const t = fake(
      "prices_include_tax",
      [{ id: "old-1", unit_cost: 250, unit_cost_tax_basis: null }],
      { costApplied: false },
    );
    await t.svc.recordSpotCount(HOUSE, ITEM, opening);
    expect(t.stamps()).toEqual([]);
  });
});
