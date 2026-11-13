import { moneyFromMinor, moneyIn } from "./money-in";

describe("moneyIn", () => {
  it("says lira with its own sign", () => {
    expect(moneyIn(1240.5, "TRY")).toBe("₺1,240.50");
  });
  it("says dollars with $", () => {
    expect(moneyIn(1240.5, "USD")).toBe("$1,240.50");
  });
  it("keeps the code where a sign is shared", () => {
    expect(moneyIn(1240.5, "CHF")).toBe("CHF\u00a01,240.50");
  });
  it("prints the bare figure for no code", () => {
    expect(moneyIn(1240.5, null)).toBe("1,240.50");
    expect(moneyIn(1240.5, undefined)).toBe("1,240.50");
  });
  it("prints the bare figure for a code that is not three letters", () => {
    expect(moneyIn(1240.5, "tl")).toBe("1,240.50");
  });
  it("drops the minor unit for a whole figure", () => {
    expect(moneyIn(1240.5, "TRY", true)).toBe("₺1,241");
    expect(moneyIn(1240, null, true)).toBe("1,240");
  });
  it("puts the minus before the sign", () => {
    expect(moneyIn(-12.3, "TRY")).toBe("-₺12.30");
  });
});

describe("moneyIn — the money's own places", () => {
  it("says yen and won with no decimals", () => {
    expect(moneyIn(1240, "JPY")).toBe("¥1,240");
    expect(moneyIn(1240, "KRW")).toBe("₩1,240");
  });
  it("says the three-place dinars with three", () => {
    expect(moneyIn(1240.5, "KWD")).toBe("KWD\u00a01,240.500");
    expect(moneyIn(1.234, "BHD")).toBe("BHD\u00a01.234");
  });
  it("keeps ISO's two places where CLDR's cash rule would drop them", () => {
    expect(moneyIn(1240.5, "HUF")).toBe("HUF\u00a01,240.50");
  });
  it("a bare figure keeps two places", () => {
    expect(moneyIn(1240, null)).toBe("1,240.00");
  });
  it("a whole figure is whole in any money", () => {
    expect(moneyIn(1240.5, "KWD", true)).toBe("KWD\u00a01,241");
  });
});

describe("moneyFromMinor", () => {
  it("scales minor units by the money's own exponent", () => {
    expect(moneyFromMinor(5000, "TRY")).toBe("₺50.00");
    expect(moneyFromMinor(123456, "usd")).toBe("$1,234.56");
    expect(moneyFromMinor(5000, "JPY")).toBe("¥5,000");
    expect(moneyFromMinor(5000, "KWD")).toBe("KWD\u00a05.000");
    expect(moneyFromMinor(-250, "EUR")).toBe("-€2.50");
  });
  it("refuses to guess a scale", () => {
    expect(moneyFromMinor(5000, null)).toBeNull();
    expect(moneyFromMinor(5000, "tl")).toBeNull();
    expect(moneyFromMinor(5000, "UGX")).toBeNull();
    expect(moneyFromMinor(5000, "ISK")).toBeNull();
    expect(moneyFromMinor(5000, "MGA")).toBeNull();
    expect(moneyFromMinor(12.5, "TRY")).toBeNull();
  });
});
