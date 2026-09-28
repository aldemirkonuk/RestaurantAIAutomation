import {
  STOCKING_WITHHELD,
  composeRegister,
  registersForHouseRow,
  toHouseRecord,
  unregistered,
  type CatalogueRow,
  type LedgerRow,
  type SourceStatus,
} from "./house-record";

/**
 * What these tests pin is the difference between four sentences a register can
 * say about one bottle, all of which the first build flattened into "nothing
 * here is yours":
 *
 *   1. this house bought it, poured it, and the catalogue knows it
 *   2. this house bought it and the catalogue has never heard of it
 *   3. the catalogue has it and this house has never touched it
 *   4. we could not read this house's books at all
 *
 * Plus the one thing that must be true on every row of every register: nothing
 * here can be stocked, and the reason is OD-113 rather than an empty column.
 */

const OK: SourceStatus = { readable: true, reason: null, rows: 1 };
const RID = "550e8400-e29b-41d4-a716-446655440000";

function ledger(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    house_key: "ipa lagunitas",
    label: "Lagunitas IPA",
    books: ["invoice"],
    first_seen: "2026-03-02T00:00:00Z",
    menu_lines: 0,
    menu_bottle_price: null,
    menu_glass_price: null,
    menu_sections: null,
    invoice_lines: 3,
    first_bought: "2026-03-02",
    last_bought: "2026-08-19",
    bottles_bought: 72,
    paid_total: 618.4,
    last_unit_price: 8.6,
    last_bought_from: "Anadolu Içecek",
    order_lines: 0,
    last_ordered_at: null,
    last_order_price: null,
    last_ordered_from: null,
    quote_count: 0,
    last_quote_at: null,
    last_quote_price: null,
    last_quote_source: null,
    last_quote_from: null,
    pos_lines: 0,
    poured_qty: null,
    poured_revenue: null,
    first_poured: null,
    last_poured: null,
    beverage_id: null,
    match_method: null,
    ...over,
  };
}

function cat(over: Partial<CatalogueRow> = {}): CatalogueRow {
  return {
    id: "b-1",
    beverage_type: "beer",
    name: "IPA",
    display_name: null,
    producer: "Lagunitas",
    country: "United States",
    region: null,
    abv_pct: 6.2,
    volume_ml: 355,
    package_format: "bottle",
    price_reference: 0,
    ...over,
  };
}

function compose(over: Partial<Parameters<typeof composeRegister>[0]> = {}) {
  return composeRegister({
    restaurantId: RID,
    register: "beer",
    ledger: [],
    ledgerStatus: OK,
    ledgerTruncated: false,
    ledgerLimit: 600,
    catalogue: [],
    catalogueStatus: OK,
    catalogueTruncated: false,
    catalogueLimit: 400,
    matchedTypes: ["beer", "ale", "lager"],
    servedByThisTable: true,
    ...over,
  });
}

describe("toHouseRecord", () => {
  it("carries first bought, what was paid and who it came from", () => {
    const r = toHouseRecord(ledger());
    expect(r.bought).toEqual({
      lines: 3,
      first: "2026-03-02",
      last: "2026-08-19",
      bottles: 72,
      paidTotal: 618.4,
      lastUnitPrice: 8.6,
      lastFrom: "Anadolu Içecek",
    });
  });

  it("drops a book that names it nowhere instead of zeroing it", () => {
    // The whole point: `quoted: { count: 0 }` renders as a confident nought.
    // `quoted: null` renders as an em dash, which is the truth.
    const r = toHouseRecord(ledger());
    expect(r.quoted).toBeNull();
    expect(r.poured).toBeNull();
    expect(r.ordered).toBeNull();
    expect(r.onMenu).toBeNull();
  });

  it("reads a paid total of zero as unrecorded, never as free", () => {
    const r = toHouseRecord(ledger({ paid_total: 0, last_unit_price: 0 }));
    expect(r.bought?.paidTotal).toBeNull();
    expect(r.bought?.lastUnitPrice).toBeNull();
  });

  it("accepts the strings PostgREST returns for numerics", () => {
    const r = toHouseRecord(
      ledger({ paid_total: "618.40" as unknown as number }),
    );
    expect(r.bought?.paidTotal).toBe(618.4);
  });

  it("keeps a pour record when the till sold it", () => {
    const r = toHouseRecord(
      ledger({
        books: ["invoice", "pos"],
        pos_lines: 41,
        poured_qty: 58,
        poured_revenue: 464,
        first_poured: "2026-03-09T19:04:00Z",
        last_poured: "2026-09-01T22:11:00Z",
      }),
    );
    expect(r.poured).toMatchObject({ lines: 41, qty: 58, revenue: 464 });
    expect(r.books).toEqual(["invoice", "pos"]);
  });
});

describe("registersForHouseRow", () => {
  it("files a till line by the catalogue's own classification, not a keyword", () => {
    // "MACALLAN 12" contains no spirits word at all.
    expect(registersForHouseRow("MACALLAN 12", [], "whiskey")).toEqual([
      "whiskey",
      "spirits",
    ]);
  });

  it("files a menu line by its section when the name says nothing", () => {
    expect(registersForHouseRow("House Pour", ["Soft Drinks"], null)).toContain(
      "soft_drinks",
    );
  });

  it("files nothing it cannot recognise, rather than guessing a neighbour", () => {
    expect(registersForHouseRow("Bread basket", [], null)).toEqual([]);
  });
});

describe("composeRegister", () => {
  it("puts this house's own rows before the strangers' catalogue", () => {
    const out = compose({
      ledger: [ledger({ beverage_id: "b-1", match_method: "exact" })],
      catalogue: [cat(), cat({ id: "b-2", name: "Pilsner", producer: "Bomonti" })],
    });
    expect(out.rows[0].house).not.toBeNull();
    expect(out.rows[0].key).toBe("b-1");
    expect(out.rows[1].house).toBeNull();
    expect(out.counts).toMatchObject({
      total: 2,
      houseRows: 1,
      matched: 1,
      matchedLoosely: 0,
      catalogueOnly: 1,
    });
  });

  it("keeps a bottle the house bought that the catalogue has never heard of", () => {
    const out = compose({
      ledger: [ledger({ label: "Bomonti Filtresiz — 50cl draught keg" })],
      catalogue: [],
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].catalogue).toBeNull();
    expect(out.rows[0].house?.bought?.paidTotal).toBe(618.4);
  });

  it("reports a loose match apart from an exact one so it can be shown apart", () => {
    const out = compose({
      ledger: [
        ledger({ beverage_id: "b-1", match_method: "contains", label: "LAGUNITAS IPA 6/12OZ NR" }),
      ],
      catalogue: [cat()],
    });
    expect(out.counts.matched).toBe(0);
    expect(out.counts.matchedLoosely).toBe(1);
    expect(out.rows[0].catalogue?.matchedBy).toBe("contains");
  });

  it("does not repeat the wine mapper's zero-price sentinel", () => {
    const out = compose({ catalogue: [cat({ price_reference: 0 })] });
    expect(out.rows[0].catalogue?.priceReference).toBeNull();
  });

  it("withholds stocking on every register, naming OD-113", () => {
    const out = compose();
    expect(out.stocking.available).toBe(false);
    expect(out.stocking.decision).toBe("OD-113");
    expect(out.stocking.reason).toBe(STOCKING_WITHHELD);
    expect(out.stocking.reason).toContain("master_wine_id");
  });

  it("carries an unreadable ledger as words, never as an empty register", () => {
    const out = compose({
      ledger: null,
      ledgerStatus: {
        readable: false,
        reason: "public.house_beverage_ledger is not on this database yet",
        rows: null,
      },
      catalogue: [cat()],
    });
    expect(out.house.readable).toBe(false);
    expect(out.house.reason).toContain("not on this database yet");
    expect(out.house.rows).toBeNull();
    // The catalogue still renders — one failed source does not blank the page.
    expect(out.rows).toHaveLength(1);
  });

  it("serves soft drinks from the house's books when no catalogue type can", () => {
    const out = compose({
      register: "soft_drinks",
      matchedTypes: [],
      servedByThisTable: false,
      catalogue: [],
      ledger: [
        ledger({
          house_key: "cola",
          label: "Coca-Cola 330ml",
          books: ["menu", "pos"],
          menu_lines: 1,
          menu_bottle_price: 4,
          menu_sections: ["Soft Drinks"],
          invoice_lines: 0,
          first_bought: null,
          last_bought: null,
          bottles_bought: null,
          paid_total: null,
          last_unit_price: null,
          last_bought_from: null,
          pos_lines: 220,
          poured_qty: 231,
          poured_revenue: 924,
        }),
      ],
    });
    expect(out.catalogue.servedByThisTable).toBe(false);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].house?.poured?.qty).toBe(231);
    expect(out.rows[0].house?.bought).toBeNull();
  });

  it("says the rows without a record belong to nobody", () => {
    expect(compose().scopeNote).toContain("belong to nobody");
  });
});

describe("unregistered", () => {
  it("reports a house line no register can hold instead of dropping it", () => {
    const out = unregistered(
      [ledger({ label: "Bread basket", beverage_id: null })],
      new Map(),
    );
    expect(out).toEqual([{ label: "Bread basket", books: ["invoice"] }]);
  });

  it("reports nothing when every line is filed", () => {
    expect(unregistered([ledger({ label: "Lagunitas IPA" })], new Map())).toEqual([]);
  });
});
