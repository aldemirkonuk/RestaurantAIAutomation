import { extractPromotion, PROMO_TYPES, PromoType } from "./promo-extract";

const NOW = new Date(2026, 6, 8); // 2026-07-08 (Wed), local — deterministic date math

describe("promo-extract (deterministic, no LLM)", () => {
  it('volume discount: "15% off cases of 12+"', () => {
    const p = extractPromotion(
      "Spring release",
      "Enjoy 15% off cases of 12+ this month.",
      NOW,
    )!;
    expect(p).not.toBeNull();
    expect(p.promo_type).toBe("volume_discount");
    expect(p.discount_pct).toBe(15);
    expect(p.threshold_qty).toBe(12);
  });

  it('closeout: "Clearance — last cases, 40% off"', () => {
    const p = extractPromotion(
      "Clearance",
      "Final sale — last cases of the 2018, 40% off.",
      NOW,
    )!;
    expect(p.promo_type).toBe("closeout");
    expect(p.discount_pct).toBe(40);
  });

  it("free shipping over a threshold", () => {
    const p = extractPromotion(
      "This week",
      "Free shipping on orders over $2,000.",
      NOW,
    )!;
    expect(p.promo_type).toBe("free_shipping");
    expect(p.free_shipping).toBe(true);
    expect(p.threshold_amount).toBe(2000);
    expect(p.currency).toBe("USD");
  });

  it("new vintage", () => {
    const p = extractPromotion(
      "New release",
      "The 2022 Margaux just arrived — new vintage now available.",
      NOW,
    )!;
    expect(p.promo_type).toBe("new_vintage");
  });

  it("promo code + percent", () => {
    const p = extractPromotion(
      "Members",
      "Use code SPRING20 for 20% off your next order.",
      NOW,
    )!;
    expect(p.discount_pct).toBe(20);
    expect(p.promo_code).toBe("SPRING20");
  });

  it('parses an absolute validity date ("until July 31")', () => {
    const p = extractPromotion(
      "Spring sale",
      "10% off everything, valid until July 31.",
      NOW,
    )!;
    expect(p.discount_pct).toBe(10);
    expect(p.valid_until).toBe("2026-07-31");
  });

  it("parses a M/D validity date and rolls to next year when past", () => {
    const p = extractPromotion("Deal", "5% off, offer ends 1/15.", NOW)!;
    expect(p.valid_until).toBe("2027-01-15"); // Jan 15 already passed in July → next year
  });

  it('parses a weekday validity ("ends Friday") to a future ISO date', () => {
    const p = extractPromotion("Flash", "30% off, ends Friday!", NOW)!;
    expect(p.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(p.valid_until!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("returns null for a non-promotional email", () => {
    expect(
      extractPromotion(
        "Re: your order",
        "We can do $128 per bottle on the Brunello, ships Tuesday.",
        NOW,
      ),
    ).toBeNull();
    expect(extractPromotion("", "", NOW)).toBeNull();
  });

  it("every produced promo_type is a valid provider_promotions CHECK enum value", () => {
    const samples: Array<[string, string]> = [
      ["", "15% off by the case"],
      ["", "clearance 40% off"],
      ["", "free shipping"],
      ["", "new arrivals just landed"],
      ["", "loyalty members save 10%"],
      ["", "refer a friend and save"],
      ["", "mixed case bundle deal"],
      ["", "prepay / early payment 2% discount"],
      ["", "free samples with any order"],
      ["", "spring holiday sale 10% off"],
    ];
    for (const [s, b] of samples) {
      const p = extractPromotion(s, b, NOW);
      if (p) expect(PROMO_TYPES).toContain(p.promo_type as PromoType);
    }
  });

  it("produces a stable dedup signature for identical promos", () => {
    const a = extractPromotion("x", "15% off cases of 12+ until July 31", NOW)!;
    const b = extractPromotion("y", "15% off cases of 12+ until July 31", NOW)!;
    expect(a.signature).toBe(b.signature);
  });
});

/**
 * F-322: the offer is dated on the house's clock, not the server's. The
 * instants are chosen so a server on UTC and one on US Eastern both read a
 * different date from the house, so these fail on either without the zone.
 */
describe("promo-extract on the house's clock", () => {
  afterEach(() => jest.useRealTimers());

  it("an LA house at 22:30 Thursday still reads Thursday", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-09T05:30:00Z"));
    const LA = "America/Los_Angeles";
    const at = (b: string) =>
      extractPromotion("Sale", b, undefined, LA)!.valid_until;
    expect(at("20% off, offer ends Oct 8.")).toBe("2026-10-08");
    expect(at("20% off, valid until Friday.")).toBe("2026-10-09");
    expect(at("20% off, today only!")).toBe("2026-10-08");
  });

  it("an Istanbul house at 01:30 Friday already reads Friday", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-08T22:30:00Z"));
    const IST = "Europe/Istanbul";
    const at = (b: string) =>
      extractPromotion("Sale", b, undefined, IST)!.valid_until;
    expect(at("20% off, today only!")).toBe("2026-10-09");
    expect(at("20% off, offer ends Oct 8.")).toBe("2027-10-08");
    expect(at("20% off, valid until Friday.")).toBe("2026-10-16");
  });
});
