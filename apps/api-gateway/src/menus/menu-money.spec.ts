import { lineMoney, moneyOfMark, namesMoney, typedMark, typedMoneyOf, typedMoneyRefusal } from "./menu-money";

/**
 * r36 menu audit N1: a menu's prices were taken as the house's money whatever
 * the menu printed, so "€12" became 12 lira on Inventory. These pin which
 * money a mark names and what the house takes from a line.
 */
describe("moneyOfMark: the monies a printed mark could name", () => {
  it("reads an ISO code in any case, and the marks a menu prints", () => {
    expect(moneyOfMark("EUR")).toEqual(["EUR"]);
    expect(moneyOfMark(" try ")).toEqual(["TRY"]);
    expect(moneyOfMark("€")).toEqual(["EUR"]);
    expect(moneyOfMark("₺")).toEqual(["TRY"]);
    expect(moneyOfMark("TL")).toEqual(["TRY"]);
    expect(moneyOfMark("tl")).toEqual(["TRY"]);
    expect(moneyOfMark("US$")).toEqual(["USD"]);
  });

  it("reads $ and £ as a family, never as one money", () => {
    expect(moneyOfMark("$")).toEqual(expect.arrayContaining(["USD", "CAD", "AUD", "MXN"]));
    expect(moneyOfMark("$")).not.toContain("TRY");
    expect(moneyOfMark("£")).toEqual(expect.arrayContaining(["GBP", "EGP"]));
  });

  it("names nothing for an empty value, a non-string, or a word that is not money", () => {
    expect(moneyOfMark("")).toBeNull();
    expect(moneyOfMark("  ")).toBeNull();
    expect(moneyOfMark(undefined)).toBeNull();
    expect(moneyOfMark(12)).toBeNull();
    expect(moneyOfMark("ZZZ")).toBeNull();
    expect(moneyOfMark("glass")).toBeNull();
  });
});

describe("typedMark: the mark a typed price starts or ends with", () => {
  it("finds a mark at either end, spaces or not", () => {
    expect(typedMark("€12")).toBe("€");
    expect(typedMark("12 €")).toBe("€");
    expect(typedMark("45 TL")).toBe("TL");
    expect(typedMark("₺ 1 250")).toBe("₺");
    expect(typedMark("12 EUR")).toBe("EUR");
    expect(typedMark("EUR12")).toBe("EUR");
    expect(typedMark("US$12")).toBe("US$");
  });

  it("finds none on a bare number", () => {
    expect(typedMark("12")).toBeNull();
    expect(typedMark("45,50")).toBeNull();
    expect(typedMark("")).toBeNull();
    expect(typedMoneyOf("1.250,00")).toBeNull();
    expect(typedMoneyOf("€12")).toEqual(["EUR"]);
  });
});

describe("typedMoneyRefusal: a typed price in another money is refused", () => {
  it("refuses a mark naming another money than the house's, naming both", () => {
    const why = typedMoneyRefusal("€12", "TRY");
    expect(why).toMatch(/^"€12" is in EUR, and this house's money is TRY\./);
    expect(why).toMatch(/type the price in TRY\. Nothing was changed\.$/);
  });

  it("takes the house's own mark, no mark, a $ in a dollar house, and any price in a house that names no money", () => {
    expect(typedMoneyRefusal("₺12", "TRY")).toBeNull();
    expect(typedMoneyRefusal("45 TL", "TRY")).toBeNull();
    expect(typedMoneyRefusal("12", "TRY")).toBeNull();
    expect(typedMoneyRefusal("$12", "CAD")).toBeNull();
    expect(typedMoneyRefusal("€12", null)).toBeNull();
  });

  it("refuses a $ in a lira house, naming the mark as typed", () => {
    expect(typedMoneyRefusal("$70", "TRY")).toMatch(/^"\$70" is in "\$", and this house's money is TRY/);
  });
});

describe("lineMoney: what the house takes from one read line", () => {
  it("holds a line priced only in another money, naming the printed price and both monies", () => {
    const take = lineMoney({ name: "Chianti", currency: "EUR", bottle_price: 12, by_glass_price: 4 }, "TRY");
    expect(take.kind).toBe("held");
    const note = (take as { note: string }).note;
    expect(note).toMatch(/^The menu prints this line at 12\.00 EUR a bottle and 4\.00 EUR a glass, and this house's money is TRY\./);
    expect(note).toMatch(/Nothing converts between currencies, so no price was taken from this line/);
    expect(note).toMatch(/under Your price\.$/);
  });

  it("takes the column printed in the house's money when the menu prints two", () => {
    const take = lineMoney(
      { name: "Chianti", currency: "EUR", bottle_price: 12, also_priced: [{ currency: "₺", bottle_price: 450, by_glass_price: 150 }] },
      "TRY",
    );
    expect(take).toEqual({ kind: "house_column", glass: 150, bottle: 450 });
  });

  it("skips a second column with no price, and one in a third money", () => {
    const take = lineMoney(
      {
        name: "Chianti",
        currency: "EUR",
        bottle_price: 12,
        also_priced: [{ currency: "TRY" }, { currency: "GBP", bottle_price: 10 }, "junk", null],
      },
      "TRY",
    );
    expect(take.kind).toBe("held");
  });

  it("takes the price as read when it is the house's money, prints none, or the house names none", () => {
    expect(lineMoney({ name: "Raki", currency: "TRY", bottle_price: 900 }, "TRY")).toEqual({ kind: "as_read" });
    expect(lineMoney({ name: "Raki", currency: "₺", bottle_price: 900 }, "TRY")).toEqual({ kind: "as_read" });
    expect(lineMoney({ name: "Raki", bottle_price: 900 }, "TRY")).toEqual({ kind: "as_read" });
    expect(lineMoney({ name: "Chianti", currency: "EUR", bottle_price: 12 }, null)).toEqual({ kind: "as_read" });
    expect(lineMoney({ name: "IPA", currency: "$", by_glass_price: 9 }, "CAD")).toEqual({ kind: "as_read" });
  });

  it("has nothing to hold on a line with no price", () => {
    expect(lineMoney({ name: "Chianti", currency: "EUR" }, "TRY")).toEqual({ kind: "as_read" });
  });

  it("holds a marked price when the house's money could not be read, and says so", () => {
    const take = lineMoney({ name: "Chianti", currency: "EUR", bottle_price: 12 }, null, "statement timeout");
    expect(take.kind).toBe("held");
    expect((take as { note: string }).note).toMatch(/this house's own money could not be read \(statement timeout\)/);
    expect(lineMoney({ name: "Raki", bottle_price: 900 }, null, "statement timeout")).toEqual({ kind: "as_read" });
  });

  it("names money only when a column names one", () => {
    expect(namesMoney({ name: "Raki", bottle_price: 900 })).toBe(false);
    expect(namesMoney({ name: "Raki", currency: "glass", bottle_price: 900 })).toBe(false);
    expect(namesMoney({ name: "Raki", currency: "TRY" })).toBe(true);
    expect(namesMoney({ name: "Raki", also_priced: [{ currency: "€", bottle_price: 30 }] })).toBe(true);
  });
});
