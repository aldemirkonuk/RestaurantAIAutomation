/**
 * The house's clock and formats come from its own record — ADR 0207
 * (questions 6 and 7). Nothing is mocked: `houseFrame` is pure and reads only
 * what `Intl` in this Node build knows, the same `Intl` production runs.
 */

import {
  countryCodeOf,
  countryZone,
  houseFrame,
  localeFor,
  regionOfZone,
} from "./house-frame";

const likely = (region: string) =>
  `${new Intl.Locale("und", { region }).maximize().language}-${region}`;

describe("houseFrame — the zone", () => {
  it("takes the house's own zone first", () => {
    expect(
      houseFrame({ timezone: "America/Los_Angeles", country: "Türkiye" }),
    ).toMatchObject({ zone: "America/Los_Angeles", zoneSource: "house" });
  });

  it("falls back to the country's zone only when the country keeps exactly one", () => {
    expect(houseFrame({ timezone: null, country: "Türkiye" })).toMatchObject({
      zone: "Europe/Istanbul",
      zoneSource: "country",
    });
    expect(countryZone("JP")).toBe("Asia/Tokyo");
    // Twenty-nine zones: no default, and never UTC.
    expect(countryZone("US")).toBeNull();
    expect(
      houseFrame({ timezone: null, country: "United States" }),
    ).toMatchObject({ zone: null, zoneSource: "none", region: "US" });
    expect(
      houseFrame({ timezone: null, country: "United States" }).countryZones,
    ).toBeGreaterThan(1);
  });

  it("does not take a recorded zone this server cannot read, and keeps what it said", () => {
    expect(
      houseFrame({ timezone: "Mars/Olympus_Mons", country: null }),
    ).toMatchObject({
      zone: null,
      zoneSource: "none",
      unreadZone: "Mars/Olympus_Mons",
    });
  });

  it("has no zone at all for an empty record", () => {
    expect(houseFrame(null)).toMatchObject({
      zone: null,
      zoneSource: "none",
      region: null,
      locale: null,
      localeSource: "none",
    });
  });
});

describe("houseFrame — the formats", () => {
  it("reads the country as a code, an English name, a short name or its own name", () => {
    expect(countryCodeOf("TR")).toBe("TR");
    expect(countryCodeOf("tr")).toBe("TR");
    expect(countryCodeOf("Türkiye")).toBe("TR");
    expect(countryCodeOf("Turkiye")).toBe("TR");
    expect(countryCodeOf("United Kingdom")).toBe("GB");
    expect(countryCodeOf("UK")).toBe("GB");
    expect(countryCodeOf("Italia")).toBe("IT");
    expect(countryCodeOf("日本")).toBe("JP");
    expect(countryCodeOf("Atlantis")).toBeNull();
    expect(countryCodeOf("")).toBeNull();
  });

  it("formats in the region's own language, derived — Japanese, Italian, Chinese houses included", () => {
    expect(localeFor("TR")).toBe(likely("TR"));
    expect(localeFor("JP")).toBe(likely("JP"));
    expect(localeFor("IT")).toBe(likely("IT"));
    expect(localeFor("CN")).toBe(likely("CN"));
    expect(houseFrame({ country: "Italia" })).toMatchObject({
      region: "IT",
      locale: likely("IT"),
      localeSource: "country",
    });
  });

  it("finds the region from the zone when the country is one it cannot read", () => {
    expect(regionOfZone("Europe/Istanbul")).toBe("TR");
    expect(
      houseFrame({ timezone: "Europe/Istanbul", country: "Atlantis" }),
    ).toMatchObject({ region: "TR", localeSource: "zone" });
  });
});
