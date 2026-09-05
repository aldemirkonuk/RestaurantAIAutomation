/**
 * The registry, and the two things about it that must never quietly change.
 *
 * These are not shape tests. Each one asserts a POLITENESS or LICENCE fact that
 * was measured on 2026-09-05 and logged, and each would fail loudly if somebody
 * later pointed a fetcher at a host whose crawl rules cannot be read, or
 * upgraded an unstated licence to a permissive one.
 */

import {
  SERIES,
  fetchableSeries,
  seriesForJurisdiction,
} from "./commodity.registry";
import { commodityFetchArmed, COMMODITY_FETCH_FLAG } from "./commodity-admission";
import { commodityAlertDark } from "./commodity-alert.service";

describe("no fetcher may be pointed at a host whose robots.txt cannot be read", () => {
  it("leaves the USDA AMS shell-egg series out of the fetchable set", () => {
    // www.ams.usda.gov/robots.txt returned HTTP 403 on 2026-09-04 and again on
    // 2026-09-05. This repository's own rule (price-sources.md, K&L Wine
    // Merchants / Majestic / Tesco) is that such a host may not be fetched.
    const keys = fetchableSeries().map((s) => s.seriesKey);
    expect(keys).not.toContain("usda_ams.shell_egg_index.national");
    expect(keys.sort()).toEqual([
      "fao.food_price_index.all",
      "ons.d7bu.cpi_food_and_non_alcoholic_beverages",
    ]);
  });

  it("names the 403 on the series itself rather than dropping the series", () => {
    // Registered and withheld is a different fact from absent, and the panel
    // renders them differently.
    const egg = SERIES["usda_ams.shell_egg_index.national"];
    expect(egg.admission).toBe("upload_only");
    expect(egg.withheld?.reason).toMatch(/403/);
    expect(egg.withheld?.measuredOn).toBe("2026-09-05");
  });

  it("registers no BLS series at all, because that question is the founder's", () => {
    // api.bls.gov/robots.txt is 200 with `User-agent: * / Disallow: /` on the
    // host of a documented, key-issuing public API. Registering a series from
    // it would be answering the plan's Q1 in code.
    expect(
      Object.keys(SERIES).filter((k) => k.startsWith("bls.")),
    ).toEqual([]);
  });
});

describe("an unstated licence is recorded as unstated, never upgraded", () => {
  it("keeps FAO at `unstated` even though it is phase 0's best source", () => {
    const fao = SERIES["fao.food_price_index.all"];
    expect(fao.licence).toBe("unstated");
    expect(fao.redistribution).toBe("unstated");
    expect(fao.attribution).toBeNull();
  });

  it("carries the OGL attribution string on ONS, where one is required", () => {
    const ons = SERIES["ons.d7bu.cpi_food_and_non_alcoholic_beverages"];
    expect(ons.redistribution).toBe("attribution_required");
    expect(ons.attribution).toMatch(/Open Government Licence v3\.0/);
  });
});

describe("money and bases follow the value kind, on every registered series", () => {
  it("an index number carries no currency; a price and a rate both name one", () => {
    for (const s of Object.values(SERIES)) {
      if (s.valueKind === "index_number") expect(s.currency).toBeNull();
      else expect(s.currency).not.toBeNull();
    }
  });

  it("states a base for every index number and none for anything else", () => {
    for (const s of Object.values(SERIES)) {
      if (s.valueKind === "index_number") expect(s.basePeriod).toBeTruthy();
      else expect(s.basePeriod).toBeNull();
    }
  });
});

describe("a rate is a series, and it names its statute and its effective date", () => {
  const rates = Object.values(SERIES).filter((s) => s.valueKind === "rate");

  it("registers the three the founder named", () => {
    expect(rates.map((s) => s.seriesKey).sort()).toEqual([
      "gib.otv_iii_a.asgari_maktu",
      "hmrc.alcohol_duty.spirits_and_wine_8_5_to_22",
      "il_dor.liquor_gallonage_tax.above_20_abv",
    ]);
  });

  it("every rate carries a statute, an effective date and a declared denominator", () => {
    // A rate without its instrument is a rumour, and a rate without a stated
    // denominator cannot be multiplied by anything.
    for (const r of rates) {
      expect(r.statute).toBeTruthy();
      expect(r.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.dutyDenominator).toBeTruthy();
    }
  });

  it("GİB is registered SILENT because its issuer does not state what the figure is per", () => {
    // Measured and recorded verbatim in price-sources.md:269. Press reporting
    // of the same decision divides by 100, which IMPLIES per litre of pure
    // alcohol; that was never confirmed against Law 4760 and is not asserted.
    const gib = SERIES["gib.otv_iii_a.asgari_maktu"];
    expect(gib.dutyDenominator).toBe("unstated");
    expect(gib.silent?.kind).toBe("unit_denominator_not_stated");
    expect(gib.withheld).toBeNull();
  });

  it("no rate is fetchable: every one waits for a person to bring the numbers", () => {
    for (const r of rates) {
      expect(r.admission).toBe("upload_only");
      expect(r.awaitingHumanDownload).toBe(true);
    }
    expect(fetchableSeries().map((s) => s.valueKind)).not.toContain("rate");
  });
});

describe("which series speak for a house", () => {
  it("gives a WORLD series to every house, including one with no address", () => {
    expect(seriesForJurisdiction(null).map((s) => s.seriesKey)).toEqual([
      "fao.food_price_index.all",
    ]);
  });

  it("gives an Illinois house the state excise rate and not the UK duty", () => {
    const keys = seriesForJurisdiction("US-IL").map((s) => s.seriesKey).sort();
    expect(keys).toContain("il_dor.liquor_gallonage_tax.above_20_abv");
    expect(keys).toContain("usda_ams.shell_egg_index.national");
    expect(keys).not.toContain("hmrc.alcohol_duty.spirits_and_wine_8_5_to_22");
  });

  it("gives an England house the UK series by CONTAINMENT, not equality", () => {
    const keys = seriesForJurisdiction("GB-ENG").map((s) => s.seriesKey);
    expect(keys).toContain("ons.d7bu.cpi_food_and_non_alcoholic_beverages");
    expect(keys).toContain("fao.food_price_index.all");
  });

  it("gives a Turkish house the world index and its own excise rate, and nothing British or American", () => {
    const keys = seriesForJurisdiction("TR-07").map((s) => s.seriesKey).sort();
    expect(keys).toEqual([
      "fao.food_price_index.all",
      "gib.otv_iii_a.asgari_maktu",
    ]);
  });
});

describe("both flags are allow-lists, so a typo leaves them OFF", () => {
  it("arms on `true` and `1` only", () => {
    for (const on of ["true", "TRUE", " true ", "1"]) {
      expect(commodityFetchArmed(on)).toBe(true);
      expect(commodityAlertDark(on)).toBe(true);
    }
    for (const off of ["yes", "on", "True!", "", " ", "0", "false", null, undefined]) {
      expect(commodityFetchArmed(off)).toBe(false);
      expect(commodityAlertDark(off)).toBe(false);
    }
  });

  it("is off in this process, which is the default a deployment inherits", () => {
    expect(process.env[COMMODITY_FETCH_FLAG]).toBeUndefined();
    expect(commodityFetchArmed(process.env[COMMODITY_FETCH_FLAG])).toBe(false);
  });
});
