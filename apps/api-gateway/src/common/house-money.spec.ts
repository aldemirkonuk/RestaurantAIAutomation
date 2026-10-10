import { houseMoney, readHouseMoney } from "./house-money";

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

/**
 * F-866: the figure is grouped by the house's own mark. A lira house groups
 * with ".", so "TRY 12,400" read as 12.4 there; the web already reads the
 * house's mark for what it is typed.
 */
describe("houseMoney in the house's own formats (F-866)", () => {
  it("a Turkish house reads its sign and its own grouping", () => {
    expect(houseMoney(12400.4, "TRY", { locale: "tr-TR" })).toBe("₺12.400");
    expect(houseMoney(12400, "TRY", { compact: true, locale: "tr-TR" })).toBe(
      "₺12,4k",
    );
  });

  it("a German house puts the sign where it writes it", () => {
    expect(houseMoney(12400, "EUR", { locale: "de-DE" })).toBe("12.400\u00a0€");
  });

  it("a house with no currency still groups by its own mark", () => {
    expect(houseMoney(12400, null, { locale: "tr-TR" })).toBe("12.400");
  });

  it("an unknown or unusable locale keeps en-US, as before", () => {
    expect(houseMoney(12400, "TRY", { locale: null })).toBe("TRY\u00a012,400");
    expect(houseMoney(12400, "USD", { locale: "not a tag" })).toBe("$12,400");
  });
});

describe("readHouseMoney", () => {
  const client = (result: unknown) => ({
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.limit = () => Promise.resolve(result);
      return b;
    },
  });

  it("reads the code and the formats of the house's country, else its zone", async () => {
    expect(
      await readHouseMoney(
        client({
          data: [{ currency: "try", country: "Türkiye", timezone: null }],
          error: null,
        }),
        "r1",
      ),
    ).toEqual({ currency: "TRY", locale: "tr-TR" });
    expect(
      await readHouseMoney(
        client({
          data: [
            { currency: null, country: null, timezone: "Europe/Istanbul" },
          ],
          error: null,
        }),
        "r1",
      ),
    ).toEqual({ currency: null, locale: "tr-TR" });
  });

  it("answers both null for a failed read, a throw, or no client", async () => {
    const none = { currency: null, locale: null };
    expect(
      await readHouseMoney(
        client({ data: null, error: { message: "no" } }),
        "r1",
      ),
    ).toEqual(none);
    expect(
      await readHouseMoney(
        {
          from: () => {
            throw new Error("down");
          },
        },
        "r1",
      ),
    ).toEqual(none);
    expect(await readHouseMoney(null, "r1")).toEqual(none);
  });
});
