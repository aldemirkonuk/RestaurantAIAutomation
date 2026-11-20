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

  it("a year-less M/D that has passed stays passed: never pushed a year ahead to look live", () => {
    const p = extractPromotion("Deal", "5% off, offer ends 1/15.", NOW)!;
    // Jan 15 is nearer behind July 8 (174 days) than ahead (191), so it is
    // the January that has gone, and the offer had ended when it was read.
    expect(p.valid_until).toBe("2026-01-15");
    expect(p.ended).toBe(true);
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

  describe("a percentage on a wine's spec sheet is not a discount (QA round 4, H1)", () => {
    it("a new-arrivals mail quoting ABV carries no discount", () => {
      const p = extractPromotion(
        "New arrivals from Barolo",
        "Our 2019 Barolo 14.5% ABV is just arrived. Stock limited.",
        NOW,
      )!;
      expect(p.promo_type).toBe("new_vintage");
      expect(p.discount_pct).toBeNull();
      expect(p.summary).not.toContain("% off");
    });

    it.each([
      ["Alc. 13.5% vol, a classic Rioja. New release now in."],
      ["ABV: 13.5% — new vintage of the Chablis now available."],
      ["Alcohol 14% | 85% Sangiovese, 15% Merlot. New release."],
      ["Aged in 40% new French oak, 13% alc. Just arrived."],
      ["60% Öküzgözü, 40% Boğazkere — the new vintage is in."],
    ])("%s", (body) => {
      const p = extractPromotion("From the cellar", body, NOW)!;
      expect(p.discount_pct).toBeNull();
    });

    it("a real discount in the same mail is still read, past the ABV", () => {
      const p = extractPromotion(
        "New arrivals",
        "The 2019 Barolo (14.5% ABV) just arrived — 15% off by the case until July 31.",
        NOW,
      )!;
      expect(p.discount_pct).toBe(15);
    });

    it("a volume discount is not mistaken for a volume-by-alcohol figure", () => {
      const p = extractPromotion("Volume pricing", "Volume discount 10% on 5+ cases.", NOW)!;
      expect(p.discount_pct).toBe(10);
    });
  });

  describe("an offer that ended before it was read is ended (QA round 4, H3)", () => {
    const READ = new Date(2026, 10, 7); // 2026-11-07, local

    it('"Offer ends Nov 6" read on Nov 7 ended yesterday, not next November', () => {
      const p = extractPromotion("Last call", "10% off all Rioja. Offer ends Nov 6.", READ)!;
      expect(p.valid_until).toBe("2026-11-06");
      expect(p.ended).toBe(true);
      expect(p.summary).toContain("ended 2026-11-06");
    });

    it('"Valid through November 6" the same', () => {
      const p = extractPromotion("Offer", "15% off, valid through November 6.", READ)!;
      expect(p.valid_until).toBe("2026-11-06");
      expect(p.ended).toBe(true);
    });

    it("a date later this month is open", () => {
      const p = extractPromotion("Offer", "15% off, valid through November 30.", READ)!;
      expect(p.valid_until).toBe("2026-11-30");
      expect(p.ended).toBe(false);
    });

    it("across the turn of the year: January read in December is next month", () => {
      const p = extractPromotion("Offer", "15% off until Jan 15.", new Date(2026, 11, 20))!;
      expect(p.valid_until).toBe("2027-01-15");
      expect(p.ended).toBe(false);
    });

    it("across the turn of the year: December 31 read on January 2 ended two days ago", () => {
      const p = extractPromotion("Offer", "15% off, ends Dec 31.", new Date(2027, 0, 2))!;
      expect(p.valid_until).toBe("2026-12-31");
      expect(p.ended).toBe(true);
    });

    it("a stated year is kept as stated", () => {
      const p = extractPromotion("Offer", "10% off, offer ends 11/6/2026.", READ)!;
      expect(p.valid_until).toBe("2026-11-06");
      expect(p.ended).toBe(true);
    });

    it('"June 30, 2027" keeps its stated year', () => {
      const p = extractPromotion("Offer", "Offer valid through June 30, 2027. 10% off", READ)!;
      expect(p.valid_until).toBe("2027-06-30");
      expect(p.ended).toBe(false);
    });

    it('"valid until May 31, 2027" is May 2027, not May 2026', () => {
      const p = extractPromotion("Offer", "15% off Rioja, valid until May 31, 2027", READ)!;
      expect(p.valid_until).toBe("2027-05-31");
      expect(p.ended).toBe(false);
    });

    it('a stated year in "Nov 6, 2026" read on Nov 7 ended yesterday', () => {
      const p = extractPromotion("Offer", "10% off, offer ends Nov 6, 2026.", READ)!;
      expect(p.valid_until).toBe("2026-11-06");
      expect(p.ended).toBe(true);
    });

    it("a passed date with no validity cue does not end a live offer", () => {
      const p = extractPromotion(
        "Special offer",
        "Special offer: 20% off all Barolo. Harvest finished Sept 3",
        READ,
      )!;
      expect(p.discount_pct).toBe(20);
      expect(p.valid_until).toBeNull();
      expect(p.ended).toBe(false);
    });

    it("a cue-less scan passes over a passed date to a later one", () => {
      const p = extractPromotion(
        "Tasting",
        "20% off Barolo. Harvest finished Sept 3; tasting on Nov 20",
        READ,
      )!;
      expect(p.valid_until).toBe("2026-11-20");
      expect(p.ended).toBe(false);
    });

    it('"Market 12 cases" is not March 12', () => {
      const p = extractPromotion("By the case", "Market 12 cases of Rioja at $15 off per case.", READ)!;
      expect(p.valid_until).toBeNull();
      expect(p.ended).toBe(false);
    });
  });

  describe("an amount off states what it is off (QA round 4, H2)", () => {
    it('"$15 off per case" is per case', () => {
      const p = extractPromotion("By the case", "Rioja at $15 off per case this month.", NOW)!;
      expect(p.discount_amount).toBe(15);
      expect(p.amount_unit).toBe("case");
      expect(p.pack_size).toBeNull();
      expect(p.summary).toContain("$15 off per case");
    });

    it("the case's bottle count is kept when the mail states it", () => {
      const p = extractPromotion(
        "By the case",
        "Rioja Reserva 12 x 750ml — save $15 a case through July 31.",
        NOW,
      )!;
      expect(p.amount_unit).toBe("case");
      expect(p.pack_size).toBe(12);
    });

    it("a per-bottle amount is per bottle", () => {
      const p = extractPromotion("Deal", "$2 off each bottle of Chablis, 6-bottle case.", NOW)!;
      expect(p.amount_unit).toBe("bottle");
      expect(p.pack_size).toBe(6);
    });

    it.each([
      ["$15 off any case of Rioja.", null],
      ["$15 off case orders this month.", null],
      ["$15 off per mixed case.", null],
      ["$15 off each 12-bottle case.", 12],
      ["Case special: $15 off Rioja this month.", null],
    ])('a case named in "%s" makes the amount per case', (body, pack) => {
      const p = extractPromotion("By the case", body, NOW)!;
      expect(p.discount_amount).toBe(15);
      expect(p.amount_unit).toBe("case");
      expect(p.pack_size).toBe(pack);
    });

    it('"$2 off any bottle" is per bottle', () => {
      const p = extractPromotion("Deal", "$2 off any bottle of Chablis.", NOW)!;
      expect(p.amount_unit).toBe("bottle");
    });

    it("an amount with no unit says none, and keeps its old dedup signature", () => {
      const p = extractPromotion("Deal", "$5 off your next order until July 31.", NOW)!;
      expect(p.amount_unit).toBeNull();
      expect(p.signature).toBe("seasonal||5|||2026-07-31|");
    });
  });
});
