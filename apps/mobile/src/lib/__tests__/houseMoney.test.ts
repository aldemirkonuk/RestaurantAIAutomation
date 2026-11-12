/**
 * Money on the phone names its currency or says it cannot. It used to print a
 * bare "$" on the Today strip, Insights, the wine page and every order row.
 * `invoiceMatch` imports the design tokens for verdict colours; plain values,
 * so no renderer is needed.
 */
jest.mock("@/design/tokens", () => ({
  color: new Proxy({}, { get: () => "#000" }),
  space: new Proxy({}, { get: () => 0 }),
}));

import { houseMoney, orderMoney } from "@/lib/houseMoney";
import { orderAmount } from "@/components/supply/OrderRow";

jest.mock("@/components/ui/AppText", () => ({ AppText: () => null }));
jest.mock("@/components/ui/PressableScale", () => ({ PressableScale: () => null }));
jest.mock("react-native", () => ({ View: () => null }));

describe("houseMoney", () => {
  it("not read yet: the bare number, no sign, no sentence", () => {
    expect(houseMoney(1240, undefined)).toBe("1,240");
  });
  it("unreadable (readable false or null): says it could not be read", () => {
    expect(houseMoney(1240, { code: "TRY", readable: false })).toBe(
      "1,240 (currency could not be read)",
    );
    expect(houseMoney(1240, null)).toBe("1,240 (currency could not be read)");
  });
  it("a stated code prefixes the figure", () => {
    expect(houseMoney(1240, { code: "TRY", readable: true })).toBe("TRY 1,240");
  });
  it("no code recorded: says so", () => {
    expect(houseMoney(1240, { code: null, readable: true })).toBe(
      "1,240 (currency not recorded)",
    );
  });
  it("honours digits", () => {
    expect(houseMoney(12.345, { code: "EUR", readable: true }, 2)).toBe("EUR 12.35");
  });
  it("an invalid code is treated as not recorded", () => {
    expect(houseMoney(5, { code: "XX", readable: true })).toBe("5 (currency not recorded)");
    expect(houseMoney(5, { code: "tr1", readable: true })).toBe("5 (currency not recorded)");
  });
  it("never prints $ or USD unless the code is USD", () => {
    const states = [undefined, null, { code: null, readable: true }, { code: "XX", readable: true },
      { code: "TRY", readable: false }, { code: "EUR", readable: true }, { code: "GBP", readable: true }] as const;
    for (const s of states) {
      const out = houseMoney(99, s as any);
      expect(out).not.toContain("$");
      expect(out).not.toContain("USD");
    }
    expect(houseMoney(99, { code: "USD", readable: true })).toBe("USD 99");
  });
});

describe("orderMoney", () => {
  it("valid code: prefixed", () => {
    expect(orderMoney(1240, "EUR")).toBe("EUR 1,240");
  });
  it("lowercase code is normalised by the shared validator", () => {
    expect(orderMoney(1240, "try")).toBe("TRY 1,240");
  });
  it("null, undefined or invalid: not stated, never the house currency or $", () => {
    for (const c of [null, undefined, "", "XX", "EURO"]) {
      const out = orderMoney(1240, c);
      expect(out).toBe("1,240 (currency not stated)");
      expect(out).not.toContain("$");
      expect(out).not.toContain("USD");
    }
  });
});

describe("orderAmount", () => {
  const base = { id: "o1", status: "PENDING" } as any;
  it("EUR order", () => {
    expect(orderAmount({ ...base, totalCost: 1240, currency: "EUR" })).toBe("EUR 1,240");
  });
  it("currency null: says not stated", () => {
    expect(orderAmount({ ...base, totalCost: 1240, currency: null })).toContain(
      "(currency not stated)",
    );
  });
  it("currency absent from the route: says not stated", () => {
    expect(orderAmount({ ...base, quotedPrice: 10 })).toContain("(currency not stated)");
  });
  it("no amount: null", () => {
    expect(orderAmount({ ...base, currency: "EUR" })).toBeNull();
  });
});
