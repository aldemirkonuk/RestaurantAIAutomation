import { BadRequestException } from "@nestjs/common";
import { AuctionLotRecordsService } from "./auction-lot-records.service";
import { DatabaseService } from "../database/database.service";

/**
 * `auction_lot_records` — an auction lot's own details, kept WITH a currency
 * (founder, 2026-09-21). See the service's own header and
 * `20260926140400_an_auction_lot_keeps_its_own_details.sql`.
 *
 * What this suite pins:
 *  - currency is checked for real ISO-4217 MEMBERSHIP, not merely three
 *    capital letters — "ZZZ" and "usd" are both refused, before any write;
 *  - the inventory item is verified as this restaurant's own before the
 *    insert runs, and a failed verification read is an error, never treated
 *    as "not found";
 *  - a failed insert or list read is an error, never an empty answer.
 */

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });
const failed: Answer = { data: null, error: { message: "connection reset" } };

function makeService(opts: {
  /** The house row the service reads its currency from; defaults to a USD house. */
  houseAnswer?: Answer;
  invAnswer?: Answer;
  insertAnswer?: Answer;
  listAnswer?: Answer;
  captureInsert?: (payload: Record<string, unknown>) => void;
  // Every `.eq(column, value)` each read applied, in order. The tenant gate
  // is the `restaurant_id` filter on these two reads; a builder that ignored
  // its arguments would let that filter be deleted with every test green.
  captureInvFilters?: (filters: Array<[string, unknown]>) => void;
  captureListFilters?: (filters: Array<[string, unknown]>) => void;
}) {
  const from = (table: string) => {
    if (table === "restaurants") {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          // The house is read by the caller's own id, and nothing else.
          if (!filters.some(([c, v]) => c === "id" && v === "r-1")) return ok(null);
          return opts.houseAnswer ?? ok({ id: "r-1", currency: "USD" });
        },
      };
      return { select: () => builder };
    }
    if (table === "restaurant_inventory") {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        eq: (col: string, val: unknown) => {
          filters.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          opts.captureInvFilters?.(filters);
          return opts.invAnswer ?? ok({ id: "inv-1" });
        },
      };
      return { select: () => builder };
    }
    if (table === "auction_lot_records") {
      return {
        insert: (payload: Record<string, unknown>) => {
          opts.captureInsert?.(payload);
          return {
            select: () => ({ single: async () => opts.insertAnswer ?? ok({}) }),
          };
        },
        select: () => {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq: (col: string, val: unknown) => {
              filters.push([col, val]);
              return builder;
            },
            order: async () => {
              opts.captureListFilters?.(filters);
              return opts.listAnswer ?? ok([]);
            },
          };
          return builder;
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  };

  const databaseService = { supabase: { from } } as unknown as DatabaseService;
  return new AuctionLotRecordsService(databaseService);
}

const DTO = {
  inventoryId: "inv-1",
  auctionHouse: "Christie's",
  lotNumber: "112",
  saleDate: "2026-09-01",
  hammerPrice: 1200,
  buyersPremium: 300,
  currency: "USD",
  bottles: 6,
  // (1200 + 300) / 6 = 250, in a USD house: the lot's own per-bottle cost.
  bookedUnitCost: 250,
};

describe("AuctionLotRecordsService.create", () => {
  it("refuses a well-formed but non-existent currency, before writing anything", async () => {
    let inserted = false;
    const svc = makeService({ captureInsert: () => (inserted = true) });
    await expect(
      svc.create("r-1", "u-1", "Ayşe", { ...DTO, currency: "ZZZ" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toBe(false);
  });

  it("refuses a currency that is not even three letters", async () => {
    const svc = makeService({});
    await expect(
      svc.create("r-1", "u-1", "Ayşe", { ...DTO, currency: "$" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses when the account has no name on file, before writing anything", async () => {
    let inserted = false;
    const svc = makeService({ captureInsert: () => (inserted = true) });
    await expect(svc.create("r-1", "u-1", "   ", DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inserted).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a blank auction house", { auctionHouse: "   " }],
  ])("refuses %s with a 400, before writing anything", async (_l, over) => {
    let inserted = false;
    const svc = makeService({ captureInsert: () => (inserted = true) });
    await expect(
      svc.create("r-1", "u-1", "Ayşe", { ...DTO, ...over } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toBe(false);
  });

  it.each<[string, Record<string, unknown>]>([
    ["no lot number at all", { lotNumber: undefined }],
    ["a blank lot number", { lotNumber: "   " }],
    ["a null lot number", { lotNumber: null }],
  ])("records a lot with %s as not stated (founder answer 11: optional)", async (_l, over) => {
    let captured: Record<string, unknown> | null = null;
    const svc = makeService({ captureInsert: (p) => (captured = p) });
    await svc.create("r-1", "u-1", "Ayşe", { ...DTO, ...over } as never);
    expect(captured).toMatchObject({ lot_number: null });
  });

  describe("a lot in another currency books its cost in the house's money (founder answer 10)", () => {
    const EUR_HOUSE = ok({ id: "r-1", currency: "EUR" });

    it("refuses a foreign lot that states neither a rate nor a house cost, before writing", async () => {
      let inserted = false;
      const svc = makeService({ houseAnswer: EUR_HOUSE, captureInsert: () => (inserted = true) });
      await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toThrow(
        /state the exchange rate you used, or type what each bottle cost in EUR/,
      );
      expect(inserted).toBe(false);
    });

    it("books the lot's per-bottle cost times the STATED rate, and records both", async () => {
      let captured: Record<string, unknown> | null = null;
      const svc = makeService({ houseAnswer: EUR_HOUSE, captureInsert: (p) => (captured = p) });
      await svc.create("r-1", "u-1", "Ayşe", { ...DTO, exchangeRate: 0.9, bookedUnitCost: 225 });
      expect(captured).toMatchObject({
        currency: "USD",
        house_currency: "EUR",
        exchange_rate: 0.9,
        house_unit_cost: null,
        booked_unit_cost: 225,
      });
    });

    it("a typed house cost WINS over the rate, and both are recorded", async () => {
      let captured: Record<string, unknown> | null = null;
      const svc = makeService({ houseAnswer: EUR_HOUSE, captureInsert: (p) => (captured = p) });
      await svc.create("r-1", "u-1", "Ayşe", { ...DTO, exchangeRate: 0.9, houseUnitCost: 230, bookedUnitCost: 230 });
      expect(captured).toMatchObject({ exchange_rate: 0.9, house_unit_cost: 230, booked_unit_cost: 230 });
    });

    it("refuses a record whose carried cost is not what the stated figures give", async () => {
      let inserted = false;
      const svc = makeService({ houseAnswer: EUR_HOUSE, captureInsert: () => (inserted = true) });
      await expect(
        svc.create("r-1", "u-1", "Ayşe", { ...DTO, exchangeRate: 0.9, bookedUnitCost: 250 }),
      ).rejects.toThrow(/give 225 EUR/);
      expect(inserted).toBe(false);
    });

    it("refuses when the house has stated no currency: nothing is inferred", async () => {
      const svc = makeService({ houseAnswer: ok({ id: "r-1", currency: null }) });
      await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toThrow(/has not stated the currency/);
    });

    it("a failed read of the house's currency is an error, not a guess", async () => {
      const svc = makeService({ houseAnswer: failed });
      await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toThrow(/currency could not be read/);
    });

    it("a same-currency lot books its own per-bottle cost and states no rate", async () => {
      let captured: Record<string, unknown> | null = null;
      const svc = makeService({ captureInsert: (p) => (captured = p) });
      await svc.create("r-1", "u-1", "Ayşe", DTO);
      expect(captured).toMatchObject({ house_currency: "USD", exchange_rate: null, booked_unit_cost: 250 });
    });
  });

  it("refuses an inventory item that does not belong to this restaurant", async () => {
    let inserted = false;
    const svc = makeService({
      invAnswer: ok(null),
      captureInsert: () => (inserted = true),
    });
    await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inserted).toBe(false);
  });

  it("checks ownership against the caller's own restaurant — never the inventory id alone", async () => {
    let filters: Array<[string, unknown]> = [];
    const svc = makeService({ captureInvFilters: (f) => (filters = f) });
    await svc.create("r-1", "u-1", "Ayşe", DTO);
    // Without the restaurant_id filter, another house's inventory id would
    // verify as "found" and the record would be written against it.
    expect(filters).toEqual(
      expect.arrayContaining([
        ["id", "inv-1"],
        ["restaurant_id", "r-1"],
      ]),
    );
  });

  it("raises a failed verification read as an error — never as 'not found'", async () => {
    const svc = makeService({ invAnswer: failed });
    await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toMatchObject({
      message: "connection reset",
    });
  });

  it("writes the normalised code and the caller's own ids, never the raw input", async () => {
    let captured: Record<string, unknown> | null = null;
    const svc = makeService({
      captureInsert: (p) => (captured = p),
      insertAnswer: ok({
        id: "rec-1",
        inventory_id: "inv-1",
        auction_house: "Christie's",
        lot_number: "112",
        sale_date: "2026-09-01",
        hammer_price: 1200,
        buyers_premium: 300,
        currency: "USD",
        bottles: 6,
        recorded_by_name: "Ayşe",
        created_at: "2026-09-01T10:00:00Z",
      }),
    });
    // A real code sent lower-case ("usd") is a real code, and it is stored
    // upper-cased — currencyCode() normalises case; it does not refuse it.
    const result = await svc.create("r-1", "u-1", "  Ayşe  ", {
      ...DTO,
      currency: "usd",
    });
    expect(captured).toMatchObject({
      restaurant_id: "r-1",
      inventory_id: "inv-1",
      currency: "USD",
      recorded_by: "u-1",
      recorded_by_name: "Ayşe",
    });
    expect(result.currency).toBe("USD");
  });

  it("raises the database's own error on a failed insert", async () => {
    const svc = makeService({ insertAnswer: failed });
    await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toMatchObject({
      message: "connection reset",
    });
  });
});

describe("AuctionLotRecordsService.listForInventoryItem", () => {
  it("raises a failed read rather than returning an empty list — absence is not health", async () => {
    const svc = makeService({ listAnswer: failed });
    await expect(
      svc.listForInventoryItem("r-1", "inv-1"),
    ).rejects.toMatchObject({
      message: "connection reset",
    });
  });

  it("scopes the read to the caller's own restaurant as well as the inventory item", async () => {
    let filters: Array<[string, unknown]> = [];
    const svc = makeService({ captureListFilters: (f) => (filters = f) });
    await svc.listForInventoryItem("r-1", "inv-1");
    expect(filters).toEqual(
      expect.arrayContaining([
        ["restaurant_id", "r-1"],
        ["inventory_id", "inv-1"],
      ]),
    );
  });

  it("maps hammer price and premium back as numbers, not strings", async () => {
    const svc = makeService({
      listAnswer: ok([
        {
          id: "rec-1",
          inventory_id: "inv-1",
          auction_house: "Christie's",
          lot_number: "112",
          sale_date: "2026-09-01",
          hammer_price: "1200.00",
          buyers_premium: "300.00",
          currency: "USD",
          bottles: 6,
          recorded_by_name: "Ayşe",
          created_at: "2026-09-01T10:00:00Z",
        },
      ]),
    });
    const rows = await svc.listForInventoryItem("r-1", "inv-1");
    expect(rows[0].hammerPrice).toBe(1200);
    expect(rows[0].buyersPremium).toBe(300);
    expect(typeof rows[0].hammerPrice).toBe("number");
  });
});
