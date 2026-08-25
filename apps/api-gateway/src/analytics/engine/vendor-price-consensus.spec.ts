import { median, medianAbsoluteDeviation } from "./statistics";
import {
  flagOutliers,
  normalizeUnitPrice,
  observationWeight,
  priceTrend,
  standardTrends,
  trimmedMean,
  vendorPriceConsensus,
  weightedMedian,
  type PriceObservation,
} from "./vendor-price-consensus";

/**
 * These tests are mostly about resisting bad data, because that is the actual
 * job. Scraped vendor prices arrive with lost decimals, case prices read as
 * bottle prices, and stale pages that re-confirm a price nobody honours any
 * more. A consensus function that produces a clean number from that input is
 * not working — it is hiding.
 */

const DAY = 86_400_000;
const NOW = new Date("2026-08-05T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const obs = (over: Partial<PriceObservation> = {}): PriceObservation => ({
  price: 20,
  sourceType: "website_scrape",
  observedAt: daysAgo(1),
  ...over,
});

describe("normalizeUnitPrice", () => {
  it("divides a case price by pack size", () => {
    const r = normalizeUnitPrice(obs({ price: 240, packSize: 12 }));
    expect(r.unitPrice).toBeCloseTo(20, 6);
    expect(r.note).toMatch(/÷ 12 per pack/);
  });

  it("scales a magnum to the 750ml reference", () => {
    // 1500ml at $60 is $30 per 750ml equivalent.
    const r = normalizeUnitPrice(obs({ price: 60, unitVolumeMl: 1500 }));
    expect(r.unitPrice).toBeCloseTo(30, 6);
    expect(r.note).toMatch(/1500ml → 750ml/);
  });

  it("divides by yield so food comparisons rank by usable unit", () => {
    // This is the case that makes a cheaper headline price the worse buy:
    // $40 at 85% yield = $47.06/usable; $36 at 70% = $51.43/usable.
    const better = normalizeUnitPrice(obs({ price: 40, yieldFactor: 0.85 }));
    const worse = normalizeUnitPrice(obs({ price: 36, yieldFactor: 0.7 }));
    expect(better.unitPrice!).toBeCloseTo(47.06, 1);
    expect(worse.unitPrice!).toBeCloseTo(51.43, 1);
    expect(better.unitPrice!).toBeLessThan(worse.unitPrice!);
  });

  it("leaves wine untouched — yield defaults to 1", () => {
    const r = normalizeUnitPrice(obs({ price: 25 }));
    expect(r.unitPrice).toBe(25);
  });

  it("refuses rather than guesses on impossible inputs", () => {
    expect(normalizeUnitPrice(obs({ packSize: 0 })).unitPrice).toBeNull();
    expect(normalizeUnitPrice(obs({ yieldFactor: 0 })).unitPrice).toBeNull();
    expect(normalizeUnitPrice(obs({ yieldFactor: 1.5 })).unitPrice).toBeNull();
  });
});

describe("observationWeight", () => {
  it("ranks an invoice above a social post of the same age", () => {
    const invoice = observationWeight(obs({ sourceType: "invoice" }), NOW);
    const social = observationWeight(obs({ sourceType: "social" }), NOW);
    expect(invoice.weight).toBeGreaterThan(social.weight);
  });

  it("decays with age at the source half-life", () => {
    const fresh = observationWeight(
      obs({ sourceType: "website_scrape", observedAt: daysAgo(0) }),
      NOW,
    );
    const halfLifeOld = observationWeight(
      obs({ sourceType: "website_scrape", observedAt: daysAgo(30) }),
      NOW,
    );
    expect(halfLifeOld.weight).toBeCloseTo(fresh.weight / 2, 5);
  });

  it("lets a bad parse sink a trusted source", () => {
    const clean = observationWeight(obs({ sourceType: "invoice" }), NOW);
    const garbled = observationWeight(
      obs({ sourceType: "invoice", parseConfidence: 0.1 }),
      NOW,
    );
    expect(garbled.weight).toBeCloseTo(clean.weight * 0.1, 6);
  });
});

describe("robust statistics", () => {
  it("median ignores an extreme value that would wreck a mean", () => {
    const xs = [20, 21, 22, 23, 2400];
    expect(median(xs)).toBe(22);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(400);
  });

  it("MAD does not get masked by the outlier it is measuring", () => {
    const mad = medianAbsoluteDeviation([20, 21, 22, 23, 2400]);
    expect(mad).toBeLessThan(10);
  });

  it("flags a lost-decimal parse error", () => {
    // $12.00 scraped as $1200 — the canonical scrape failure.
    const flags = flagOutliers([20, 21, 22, 20.5, 1200]);
    expect(flags[4]).toBe(true);
    expect(flags.slice(0, 4).every((f) => !f)).toBe(true);
  });

  it("treats anything different as an outlier when MAD is zero", () => {
    // Repeated scrapes of an unchanged page: >half identical, MAD = 0.
    const flags = flagOutliers([20, 20, 20, 20, 35]);
    expect(flags).toEqual([false, false, false, false, true]);
  });

  it("weightedMedian follows weight, not count", () => {
    // Four cheap low-trust rows against one heavy high-trust row.
    const v = weightedMedian([10, 10, 10, 10, 30], [0.1, 0.1, 0.1, 0.1, 10]);
    expect(v).toBe(30);
  });

  it("trimmedMean drops the tails", () => {
    expect(trimmedMean([1, 20, 21, 22, 500], 0.2)).toBeCloseTo(21, 6);
  });
});

describe("vendorPriceConsensus", () => {
  it("ranks vendors least to most on the normalized unit price", () => {
    const r = vendorPriceConsensus(
      [
        obs({ price: 300, packSize: 12, vendorName: "Case Vendor" }), // $25/unit
        obs({ price: 22, vendorName: "Bottle Vendor" }),
        obs({ price: 240, packSize: 12, vendorName: "Cheap Case" }), // $20/unit
      ],
      { now: NOW },
    );
    expect(r.ladder.map((q) => q.vendorName)).toEqual([
      "Cheap Case",
      "Bottle Vendor",
      "Case Vendor",
    ]);
    expect(r.bestVendorName).toBe("Cheap Case");
    expect(r.bestPrice).toBeCloseTo(20, 6);
  });

  it("does not let a mis-parsed price become the recommended vendor", () => {
    // Without outlier rejection, "$0.20" wins the ladder and the tool tells a
    // somm to buy Barolo for twenty cents.
    const r = vendorPriceConsensus(
      [
        obs({ price: 20, vendorName: "A" }),
        obs({ price: 21, vendorName: "B" }),
        obs({ price: 22, vendorName: "C" }),
        obs({ price: 0.2, vendorName: "Bad Parse" }),
      ],
      { now: NOW },
    );
    expect(r.outlierCount).toBe(1);
    expect(r.bestVendorName).not.toBe("Bad Parse");
    // Still visible in the ladder so someone can fix the source.
    expect(
      r.ladder.some((q) => q.vendorName === "Bad Parse" && q.isOutlier),
    ).toBe(true);
  });

  it("counts every source type for the badges", () => {
    const r = vendorPriceConsensus(
      [
        obs({ sourceType: "invoice" }),
        obs({ sourceType: "website_scrape" }),
        obs({ sourceType: "website_scrape" }),
        obs({ sourceType: "chat" }),
      ],
      { now: NOW },
    );
    expect(r.sourceBreakdown).toEqual({
      invoice: 1,
      website_scrape: 2,
      chat: 1,
    });
  });

  it("excludes unnormalizable rows and says how many", () => {
    const r = vendorPriceConsensus(
      [obs({ price: 20 }), obs({ price: 20, packSize: 0 })],
      { now: NOW },
    );
    expect(r.admittedCount).toBe(1);
    expect(r.notes.join(" ")).toMatch(/could not support a per-unit price/i);
  });

  it("warns that agreement within one source type is not corroboration", () => {
    const r = vendorPriceConsensus(
      [
        obs({ sourceType: "website_scrape", price: 20 }),
        obs({ sourceType: "website_scrape", price: 20.5 }),
        obs({ sourceType: "website_scrape", price: 21 }),
      ],
      { now: NOW },
    );
    expect(r.notes.join(" ")).toMatch(/not independent corroboration/i);
  });

  it("rates diverse corroborated sources above a pile of one kind", () => {
    const diverse = vendorPriceConsensus(
      [
        obs({ sourceType: "invoice", price: 20 }),
        obs({ sourceType: "quote", price: 21 }),
        obs({ sourceType: "api_catalog", price: 20.5 }),
      ],
      { now: NOW },
    );
    const monoculture = vendorPriceConsensus(
      [
        obs({ sourceType: "social", price: 20 }),
        obs({ sourceType: "social", price: 21 }),
        obs({ sourceType: "social", price: 20.5 }),
      ],
      { now: NOW },
    );
    expect(diverse.confidence).toBeGreaterThan(monoculture.confidence);
  });

  it("returns an empty, explained result with nothing usable", () => {
    const r = vendorPriceConsensus([], { now: NOW });
    expect(r.consensusPrice).toBeNull();
    expect(r.bestPrice).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.notes.join(" ")).toMatch(/no usable price observations/i);
  });
});

describe("priceTrend", () => {
  it("compares consensus to consensus across adjacent windows", () => {
    const observations: PriceObservation[] = [
      obs({ price: 22, observedAt: daysAgo(2), sourceType: "invoice" }),
      obs({ price: 22, observedAt: daysAgo(4), sourceType: "invoice" }),
      obs({ price: 20, observedAt: daysAgo(9), sourceType: "invoice" }),
      obs({ price: 20, observedAt: daysAgo(11), sourceType: "invoice" }),
    ];
    const t = priceTrend(observations, 7, NOW);
    expect(t.current).toBeCloseTo(22, 6);
    expect(t.previous).toBeCloseTo(20, 6);
    expect(t.pctChange).toBeCloseTo(0.1, 6);
    expect(t.note).toMatch(/up 10\.0%/i);
  });

  it("declines to invent a change with no prior window", () => {
    const t = priceTrend([obs({ price: 22, observedAt: daysAgo(1) })], 7, NOW);
    expect(t.current).not.toBeNull();
    expect(t.previous).toBeNull();
    expect(t.pctChange).toBeNull();
    expect(t.note).toMatch(/cannot be computed/i);
  });

  it("standardTrends returns the 7/30/90 set", () => {
    const trends = standardTrends([obs({ price: 20 })], NOW);
    expect(trends.map((t) => t.windowDays)).toEqual([7, 30, 90]);
  });
});
