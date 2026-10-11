import { registerForRole, rowRecordForRole } from "./beverages.controller";
import type { RegisterResult } from "./house-record";
import type { RowRecord } from "./row-record";

/**
 * F-1220: the beer, whisky and spirits registers follow the wine inventory's
 * rule (ADR 0145, F-562) — staff see stock and the menu, never what the house
 * paid. A buying figure is omitted, never nulled.
 */
const register = {
  restaurantId: "r1",
  register: "beer",
  rows: [
    {
      key: "k1",
      name: "Efes Pilsen",
      producer: null,
      catalogue: null,
      house: {
        books: ["menu", "invoice", "order", "quote"],
        firstSeen: null,
        onMenu: { lines: 1, bottlePrice: 180, glassPrice: null, sections: [] },
        bought: {
          lines: 2,
          doorChecked: 0,
          first: "2026-09-01",
          firstDoorChecked: false,
          last: "2026-10-01",
          lastDoorChecked: false,
          bottles: 48,
          paidTotal: 2400,
          lastUnitPrice: 50,
          lastFrom: "Anadolu",
        },
        ordered: {
          lines: 1,
          lastAt: "2026-10-02",
          lastPrice: 52,
          lastFrom: "Anadolu",
        },
        quoted: {
          count: 1,
          lastAt: null,
          lastPrice: 49,
          lastSource: "quote",
          lastFrom: null,
        },
        poured: null,
      },
    },
  ],
} as unknown as RegisterResult;

const record = {
  restaurantId: "r1",
  label: "Efes Pilsen",
  matchRule: "",
  named: ["menu", "invoice"],
  nothingNamesIt: false,
  books: (["menu", "invoice", "order", "quote", "pos"] as const).map(
    (book) => ({
      book,
      readable: true,
      reason: null,
      rows: 1,
      price: [{ at: "2026-10-01", value: 50, unit: "money" }],
      quantity: [{ at: "2026-10-01", value: 24, unit: "count" }],
      ledger: [
        {
          at: "2026-10-01",
          label: "Efes",
          who: null,
          qty: 24,
          unitPrice: 50,
          total: 1200,
          note: null,
          matchedBy: "exact",
        },
      ],
      source: "x",
      truncated: false,
    }),
  ),
} as unknown as RowRecord;

describe("beverage registers hide what the house paid from staff (F-1220)", () => {
  it.each(["staff", null])(
    "a %s reads no Paid, last unit price, order or quote price",
    (role) => {
      const h = registerForRole(register, role).rows[0].house!;
      expect(h.bought).not.toHaveProperty("paidTotal");
      expect(h.bought).not.toHaveProperty("lastUnitPrice");
      expect(h.ordered).not.toHaveProperty("lastPrice");
      expect(h.quoted).not.toHaveProperty("lastPrice");
      // Stock and the menu stay.
      expect(h.bought!.bottles).toBe(48);
      expect(h.onMenu!.bottlePrice).toBe(180);
    },
  );

  it.each(["staff", null])(
    "a %s reads the buying books with no price on any line",
    (role) => {
      const books = rowRecordForRole(record, role).books;
      for (const b of books.filter((x) =>
        ["invoice", "order", "quote"].includes(x.book),
      )) {
        expect(b.price).toEqual([]);
        expect(b.ledger[0]).not.toHaveProperty("unitPrice");
        expect(b.ledger[0]).not.toHaveProperty("total");
        expect(b.ledger[0].qty).toBe(24);
      }
      const menu = books.find((b) => b.book === "menu")!;
      expect(menu.price).toHaveLength(1);
      expect(menu.ledger[0].unitPrice).toBe(50);
    },
  );

  // F-1300: an omitted figure and a figure never recorded drew the same dash
  // on the page; the reply now says which it is.
  it.each(["staff", null])(
    "a %s reply says its amounts are withheld",
    (role) => {
      expect(registerForRole(register, role).amountsWithheld).toBe(true);
      expect(rowRecordForRole(record, role).amountsWithheld).toBe(true);
    },
  );

  it.each(["owner", "manager"])("a %s reads every figure", (role) => {
    expect(registerForRole(register, role)).toBe(register);
    expect(rowRecordForRole(record, role)).toBe(record);
    expect(registerForRole(register, role)).not.toHaveProperty(
      "amountsWithheld",
    );
  });
});
