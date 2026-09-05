/**
 * The merchant-shop sweep's decisions: whether it is armed, whether a host's
 * own visit window permits a request now, and what its silence means.
 *
 * The window test is not hypothetical. `www.bbr.com` publishes
 * `Visit-time: 0200-0700` (fetched 2026-09-05, 1,502 bytes), and this session
 * was at 11:14Z when it wanted to re-read that host — so it did not.
 */

import {
  SHOP_SILENCE_SENTENCE,
  isShopSweepArmed,
  parseVisitTime,
  visitWindowOf,
  withinVisitWindow,
} from "./shop-reference-sweep";
import { SHOPS, FETCHABLE_SHOP_KEYS, shopsForJurisdiction } from "./price-reference-shops";
import { toRow } from "./shop-reference-sweep.service";
import { PostingSighting } from "../price-index/price-index.types";

describe("isShopSweepArmed", () => {
  it("is off for anything that is not an exact arming value", () => {
    for (const off of [undefined, null, "", " ", "yess", "0", "no", "off", "enabled"]) {
      expect(isShopSweepArmed(off as string | undefined)).toBe(false);
    }
    // Trimmed and lower-cased before the comparison, matching `isSweepArmed`.
    expect(isShopSweepArmed("TRUE ")).toBe(true);
    for (const on of ["true", "1", "yes", "on", " On "]) {
      expect(isShopSweepArmed(on)).toBe(true);
    }
  });
});

describe("parseVisitTime", () => {
  it("reads the window Berry Bros publishes", () => {
    const w = parseVisitTime(
      "# Limit rate and time for visit\nRequest-rate: 1/10\n\nCrawl-delay: 10\n\nVisit-time: 0200-0700\n",
    );
    expect(w).toEqual({ startMinute: 120, endMinute: 420, raw: "Visit-time: 0200-0700" });
  });

  it("returns null when there is no window, so every hour is permitted", () => {
    expect(parseVisitTime("User-agent: *\nDisallow: /cart\n")).toBeNull();
    expect(parseVisitTime(null)).toBeNull();
    expect(withinVisitWindow(null, new Date("2026-09-05T11:14:00Z"))).toBe(true);
  });

  it("refuses an impossible window rather than inventing one", () => {
    expect(parseVisitTime("Visit-time: 2500-0700")).toBeNull();
    expect(parseVisitTime("Visit-time: 0200-0200")).toBeNull();
  });
});

describe("withinVisitWindow", () => {
  const bbr = visitWindowOf(SHOPS["bbr-gb"].robots.visitTimeUtc);

  it("permits the hour the committed Berry Bros fixtures were fetched at", () => {
    expect(withinVisitWindow(bbr, new Date("2026-09-05T02:08:18Z"))).toBe(true);
  });

  it("refuses the hour this session asked at", () => {
    expect(withinVisitWindow(bbr, new Date("2026-09-05T11:14:35Z"))).toBe(false);
  });

  it("handles a window that wraps midnight", () => {
    const night = { startMinute: 22 * 60, endMinute: 4 * 60 };
    expect(withinVisitWindow(night, new Date("2026-09-05T23:30:00Z"))).toBe(true);
    expect(withinVisitWindow(night, new Date("2026-09-05T03:59:00Z"))).toBe(true);
    expect(withinVisitWindow(night, new Date("2026-09-05T12:00:00Z"))).toBe(false);
  });
});

describe("the registry", () => {
  it("names a shop for every jurisdiction it claims to cover", () => {
    expect(shopsForJurisdiction("GB-ENG").map((s) => s.key).sort()).toEqual([
      "bbr-gb",
      "hedonism-gb",
      "slurp-gb",
      "tanners-gb",
    ]);
    expect(shopsForJurisdiction("US-CA").map((s) => s.key).sort()).toEqual([
      "hitime-us-ca",
      "klwines-us-ca",
    ]);
    expect(shopsForJurisdiction(null)).toEqual([]);
  });

  it("records every unfetchable shop with a reason rather than omitting it", () => {
    for (const shop of Object.values(SHOPS)) {
      if (!shop.unarmed) continue;
      expect(shop.unarmed.detail.length).toBeGreaterThan(40);
      expect(shop.unarmed.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Michigan, Illinois and Türkiye each hold houses and none has a shop that
    // may be fetched today. If that ever changes, this test changes with it.
    expect(FETCHABLE_SHOP_KEYS).toEqual([
      "bbr-gb",
      "slurp-gb",
      "tanners-gb",
      "hitime-us-ca",
    ]);
  });

  it("gives every shop a jurisdiction the register's own CHECK would accept, or says why not", () => {
    const CHECK = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
    for (const shop of Object.values(SHOPS)) {
      if (CHECK.test(shop.jurisdiction)) continue;
      // The one exception is recorded, not tolerated silently: a bare country
      // code cannot be written to `price_index_postings.state`, and the only
      // shop carrying one is unarmed for a different reason anyway.
      expect(shop.key).toBe("kavaklidere-tr");
      expect(shop.unarmed).toBeDefined();
    }
  });
});

describe("toRow", () => {
  const sighting: PostingSighting = {
    sourceKey: "tanners-gb",
    sourceClass: "retail_reference",
    state: "GB-ENG",
    region: null,
    issuer: "Tanners Wines",
    issuedAt: "2026-09-05",
    priceBasis: "retail shelf price",
    productName: "Andre Clouet Silver",
    brand: null,
    producer: null,
    packageDesc: null,
    containerType: null,
    sizeValue: 750,
    sizeUnit: "ml",
    price: 35,
    currency: "GBP",
    priceUnit: "per bottle",
    pack: 1,
    containerCharge: null,
    isPromotion: false,
    sourceStatus: "InStock",
    attribution: null,
    sourceUrl: "https://www.tanners-wines.co.uk/products/x",
    sourceRef: "https://www.tanners-wines.co.uk/products/x#Andre Clouet Silver",
    externalIds: { sku: "FC018" },
    raw: {},
  };

  it("writes every column explicitly, and no restaurant column at all", () => {
    const row = toRow(sighting, "2026-09-05T11:00:00.000Z", "issuer_stated");
    expect(Object.keys(row)).toEqual([
      "source_key",
      "source_class",
      "state",
      "region",
      "issuer",
      "issued_at",
      "issued_at_basis",
      "fetched_at",
      "price_basis",
      "product_name",
      "brand",
      "producer",
      "package_desc",
      "container_type",
      "size_value",
      "size_unit",
      "price",
      "currency",
      "price_unit",
      "pack",
      "container_charge",
      "is_promotion",
      "source_status",
      "attribution",
      "source_url",
      "source_ref",
      "content_hash",
      "external_ids",
      "raw",
    ]);
    expect(Object.keys(row)).not.toContain("restaurant_id");
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.fetched_at).toBe("2026-09-05T11:00:00.000Z");
    // The issuer's date and our fetch clock are different columns and must
    // never be filled from the same value.
    expect(row.issued_at).not.toEqual(row.fetched_at);
  });

  it("hashes a price change to a different row and an unchanged read to the same", () => {
    const a = toRow(sighting, "2026-09-05T11:00:00.000Z", "issuer_stated");
    const b = toRow(sighting, "2026-09-06T11:00:00.000Z", "issuer_stated");
    const c = toRow({ ...sighting, price: 36 }, "2026-09-05T11:00:00.000Z", "issuer_stated");
    expect(a.content_hash).toBe(b.content_hash);
    expect(a.content_hash).not.toBe(c.content_hash);
  });

  it("writes the basis it is handed, and never a default", () => {
    // Both values reach the column, and neither writer may omit it: a NULL here
    // would mean "written before a basis was recorded", which is a claim about
    // history this writer has none of.
    expect(toRow(sighting, "2026-09-05T11:00:00.000Z", "fetch_date").issued_at_basis).toBe(
      "fetch_date",
    );
    expect(toRow(sighting, "2026-09-05T11:00:00.000Z", "issuer_stated").issued_at_basis).toBe(
      "issuer_stated",
    );
    // The basis is NOT part of the content hash: re-reading the same shop page
    // tomorrow must dedup, and it would not if our own clock were hashed in.
    const stated = toRow(sighting, "2026-09-05T11:00:00.000Z", "issuer_stated");
    const fetched = toRow(sighting, "2026-09-05T11:00:00.000Z", "fetch_date");
    expect(stated.content_hash).toBe(fetched.content_hash);
  });
});

describe("the silence sentences", () => {
  it("say something different for every reason", () => {
    const sentences = Object.values(SHOP_SILENCE_SENTENCE);
    expect(new Set(sentences).size).toBe(sentences.length);
    for (const s of sentences) expect(s.length).toBeGreaterThan(40);
  });
});
