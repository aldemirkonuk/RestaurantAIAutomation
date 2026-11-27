/**
 * r109 onboarding g3: the till's last 90 days of item sales, on day one,
 * without moving stock.
 */
import { ForbiddenException } from "@nestjs/common";
import {
  HISTORY_MAX_ROWS,
  readAmount,
  readHistoryCsv,
} from "./history-import";
import {
  HISTORY_CHUNK,
  PosHistoryImportService,
  houseDay,
} from "./pos-history-import.service";

const TODAY = "2026-11-27";
const read = (csv: string, moneySet = true) =>
  readHistoryCsv(csv, { todayDay: TODAY, moneySet });

describe("readHistoryCsv", () => {
  it("reads Square's item sales export and sums variation rows into one sale per day and item", () => {
    const csv = [
      "Date,Category,Item,Item Variation,Items Sold,Net Sales",
      "2026-11-20,Wine,House Red,Glass,4,$32.00",
      "2026-11-20,Wine,House Red,Bottle,1,$38.00",
      "2026-11-21,Wine,House Red,Glass,2,$16.00",
    ].join("\n");
    const r = read(csv);
    expect(r.fileRefused).toBeNull();
    expect(r.days).toBe(2);
    expect(r.sales).toHaveLength(2);
    const day20 = r.sales.find((s) => s.saleDate === "2026-11-20");
    expect(day20).toMatchObject({ itemName: "House Red", qty: 5, net: 70 });
    expect(day20?.itemKey).toMatch(/^hist:[0-9a-f]{64}$/);
  });

  it("reads Toast's and Lightspeed's header names", () => {
    expect(read("Order Date,Menu Item,Qty,Net Price\n2026-11-01,Burger,3,45.00").sales[0]).toMatchObject({
      saleDate: "2026-11-01",
      itemName: "Burger",
      qty: 3,
      net: 45,
    });
    expect(read("Date,Product,Quantity,Net\n2026-11-02,Raki,2,300").sales[0]).toMatchObject({
      itemName: "Raki",
      qty: 2,
      net: 300,
    });
  });

  it("the key carries no money, so a corrected re-upload replaces the day's figure", () => {
    const a = read("Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30").sales[0];
    const b = read("Date,Item,Qty,Net Sales\n2026-11-20,  meze ,3,27").sales[0];
    expect(a.itemKey).toBe(b.itemKey);
    expect(a.net).not.toBe(b.net);
  });

  it("refuses by name a quantity of 0 or less (refunds and voids)", () => {
    const r = read("Date,Item,Qty\n2026-11-20,Meze,-2\n2026-11-20,Soup,0\n2026-11-20,Bread,1");
    expect(r.sales.map((s) => s.itemName)).toEqual(["Bread"]);
    expect(r.refused).toEqual([
      "2026-11-20 Meze: not read, the quantity is 0 or less (a refund or a void)",
      "2026-11-20 Soup: not read, the quantity is 0 or less (a refund or a void)",
    ]);
  });

  it("refuses a day after the house's today and one more than 90 days back; day 90 is taken", () => {
    const r = read("Date,Item,Qty\n2026-11-28,Meze,1\n2026-08-28,Meze,1\n2026-08-29,Meze,1\n2026-11-27,Meze,1");
    expect(r.sales.map((s) => s.saleDate).sort()).toEqual(["2026-08-29", "2026-11-27"]);
    expect(r.refused).toEqual([
      "2026-11-28 Meze: not read, the day is after the house's today",
      "2026-08-28 Meze: not read, the day is more than 90 days back",
    ]);
  });

  it("drops the net and keeps the quantity when the house's money is unset", () => {
    const r = read("Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30", false);
    expect(r.sales[0]).toMatchObject({ qty: 3, net: null });
    expect(r.netDropped).toBe(true);
  });

  it("a day's net is unknown when one of its rows carried none", () => {
    const r = read("Date,Item,Qty,Net Sales\n2026-11-20,Meze,1,10\n2026-11-20,Meze,1,");
    expect(r.sales[0]).toMatchObject({ qty: 2, net: null });
  });

  it("slashed dates: the file decides day/month or month/day, and refuses them when it cannot", () => {
    expect(read("Date,Item,Qty\n11/20/2026,A,1\n11/03/2026,B,1").sales.map((s) => s.saleDate).sort()).toEqual([
      "2026-11-03",
      "2026-11-20",
    ]);
    expect(read("Date,Item,Qty\n20/11/2026,A,1\n03/11/2026,B,1").sales.map((s) => s.saleDate).sort()).toEqual([
      "2026-11-03",
      "2026-11-20",
    ]);
    const unsure = read("Date,Item,Qty\n11/03/2026,A,1");
    expect(unsure.sales).toHaveLength(0);
    expect(unsure.refused[0]).toContain("write it as YYYY-MM-DD");
    expect(read("Date,Item,Qty\n20.11.2026,A,1").sales[0].saleDate).toBe("2026-11-20");
    expect(read("Date,Item,Qty\n2026-02-30,A,1").refused).toHaveLength(1);
  });

  it("refuses the whole file over 5 MB or 50,000 rows, or with no date, item or quantity column", () => {
    expect(read("Date,Item,Qty\n" + "x".repeat(5 * 1024 * 1024)).fileRefused).toContain("over 5 MB");
    const many = ["Date,Item,Qty", ...Array.from({ length: HISTORY_MAX_ROWS + 1 }, (_, i) => `2026-11-20,I${i},1`)];
    expect(read(many.join("\n")).fileRefused).toContain("over the 50,000");
    expect(read("Day,Thing,Amount\n2026-11-20,A,1").fileRefused).toBe(
      "We could not find the item, quantity column. Use the till's item sales export, with a header row.",
    );
  });

  it("names at most 50 refused rows and counts the rest", () => {
    const rows = ["Date,Item,Qty", ...Array.from({ length: 70 }, (_, i) => `2026-11-20,I${i},0`)];
    const r = read(rows.join("\n"));
    expect(r.refused).toHaveLength(50);
    expect(r.refusedCount).toBe(70);
  });

  it("reads amounts without guessing", () => {
    expect(readAmount("$1,234.50")).toBe(1234.5);
    expect(readAmount("12,50")).toBe(12.5);
    expect(readAmount("1.234,50")).toBe(1234.5);
    expect(readAmount("₺300")).toBe(300);
    expect(readAmount("12.3.4")).toBeNull();
  });
});

describe("houseDay", () => {
  it("is the house's own day, and null with no zone or an unknown one", () => {
    const at = new Date("2026-11-27T22:30:00Z");
    expect(houseDay("UTC", at)).toBe("2026-11-27");
    expect(houseDay("Europe/Istanbul", at)).toBe("2026-11-28");
    expect(houseDay("America/Los_Angeles", at)).toBe("2026-11-27");
    expect(houseDay(null, at)).toBeNull();
    expect(houseDay("Not/AZone", at)).toBeNull();
  });
});

describe("PosHistoryImportService", () => {
  const NOW = new Date("2026-11-27T12:00:00Z");
  function build(house: { timezone: string | null; currency: string | null } | null = { timezone: "Europe/Istanbul", currency: "TRY" }) {
    const upserts: { table: string; rows: any[]; opts: any }[] = [];
    const tables: string[] = [];
    const rpc = jest.fn();
    const client = {
      rpc,
      from: jest.fn((table: string) => {
        tables.push(table);
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: house, error: null }) }) }),
          upsert: async (rows: any[], opts: any) => {
            upserts.push({ table, rows, opts });
            return { error: null };
          },
        };
      }),
    };
    const organizations = { assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined) };
    const svc = new PosHistoryImportService({ getClient: () => client } as any, organizations as any);
    return { svc, client, rpc, upserts, tables, organizations };
  }

  it("saves sales to pos_sales_history and never touches checks or stock", async () => {
    const { svc, rpc, upserts, tables } = build();
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30\n2026-11-21,Meze,1,10", NOW);
    expect(out).toMatchObject({ daysRead: 2, salesSaved: 2, stockMoved: false, fileRefused: null, errors: [] });
    expect(rpc).not.toHaveBeenCalled();
    expect(new Set(tables)).toEqual(new Set(["restaurants", "pos_sales_history"]));
    expect(upserts[0].opts).toEqual({ onConflict: "restaurant_id,sale_date,item_key" });
    expect(upserts[0].rows[0]).toMatchObject({
      restaurant_id: "h1",
      sale_date: "2026-11-20",
      item_name: "Meze",
      qty: 3,
      net: 30,
      currency: "TRY",
      imported_by: "u1",
    });
  });

  it("a re-upload writes the same keys (an upsert, not a second row)", async () => {
    const { svc, upserts } = build();
    await svc.importHistory("u1", "h1", "Date,Item,Qty\n2026-11-20,Meze,3", NOW);
    await svc.importHistory("u1", "h1", "Date,Item,Qty\n2026-11-20,Meze,4", NOW);
    expect(upserts[0].rows[0].item_key).toBe(upserts[1].rows[0].item_key);
  });

  it("a staff member is refused before anything is read or written", async () => {
    const { svc, organizations, tables } = build();
    organizations.assertCanManageRestaurant.mockRejectedValue(new ForbiddenException("owner or manager"));
    await expect(svc.importHistory("staff", "h1", "Date,Item,Qty\n2026-11-20,Meze,3", NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith("staff", "h1", expect.any(String));
    expect(tables).toEqual([]);
  });

  it("with the house's money unset, keeps quantities and writes no money", async () => {
    const { svc, upserts } = build({ timezone: "UTC", currency: null });
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty,Net Sales\n2026-11-20,Meze,3,30", NOW);
    expect(out.netDropped).toBe(true);
    expect(upserts[0].rows[0]).toMatchObject({ qty: 3, net: null, currency: null });
  });

  it("with no house clock, reads nothing and says why", async () => {
    const { svc, upserts } = build({ timezone: null, currency: "TRY" });
    const out = await svc.importHistory("u1", "h1", "Date,Item,Qty\n2026-11-20,Meze,3", NOW);
    expect(out.fileRefused).toContain("clock is not set");
    expect(upserts).toHaveLength(0);
  });

  it("upserts in chunks of 500", async () => {
    const { svc, upserts } = build();
    const rows = ["Date,Item,Qty", ...Array.from({ length: 1201 }, (_, i) => `2026-11-20,I${i},1`)];
    const out = await svc.importHistory("u1", "h1", rows.join("\n"), NOW);
    expect(upserts.map((u) => u.rows.length)).toEqual([HISTORY_CHUNK, HISTORY_CHUNK, 201]);
    expect(out.salesSaved).toBe(1201);
  });
});
