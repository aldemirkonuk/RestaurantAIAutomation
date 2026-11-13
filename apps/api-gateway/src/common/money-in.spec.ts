import { moneyIn } from "./money-in";

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
