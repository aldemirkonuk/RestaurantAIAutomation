import { houseMoney, readHouseCurrency } from "./house-money";

/**
 * F-341: gateway sentences printed `$` in front of every figure, whatever the
 * house's `restaurants.currency` held. These pin the formatter the mobile
 * feed, the recommendation cards and the insight lines now share.
 */
describe("houseMoney — a figure in the house's own money", () => {
  it("prints the house's symbol, whole, grouped", () => {
    expect(houseMoney(12400.4, "USD")).toBe("$12,400");
    expect(houseMoney(12400.4, "EUR")).toBe("€12,400");
    expect(houseMoney(12400.4, "GBP")).toBe("£12,400");
  });

  it("sets a code en-US has no symbol for as the code itself", () => {
    expect(houseMoney(12400, "TRY")).toBe("TRY 12,400");
  });

  it("prints no symbol at all when no currency is recorded — never a dollar", () => {
    expect(houseMoney(12400, null)).toBe("12,400");
    expect(houseMoney(12400, undefined)).toBe("12,400");
    expect(houseMoney(12400, "")).toBe("12,400");
  });

  it("keeps the insight lines' compact form", () => {
    expect(houseMoney(600, "USD", { compact: true })).toBe("$600");
    expect(houseMoney(1040, "USD", { compact: true })).toBe("$1.0k");
    expect(houseMoney(12400, "EUR", { compact: true })).toBe("€12.4k");
    expect(houseMoney(12400, null, { compact: true })).toBe("12.4k");
  });
});

describe("readHouseCurrency", () => {
  const client = (result: unknown) => ({
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.limit = () => Promise.resolve(result);
      return b;
    },
  });

  it("reads the house's code", async () => {
    expect(
      await readHouseCurrency(client({ data: [{ currency: "gbp" }], error: null }), "r1"),
    ).toBe("GBP");
  });

  it("answers null for no code, a failed read, a throw, or no client", async () => {
    expect(
      await readHouseCurrency(client({ data: [{ currency: null }], error: null }), "r1"),
    ).toBeNull();
    expect(
      await readHouseCurrency(client({ data: null, error: { message: "no" } }), "r1"),
    ).toBeNull();
    expect(
      await readHouseCurrency(
        { from: () => { throw new Error("down"); } },
        "r1",
      ),
    ).toBeNull();
    expect(await readHouseCurrency(undefined, "r1")).toBeNull();
  });
});
