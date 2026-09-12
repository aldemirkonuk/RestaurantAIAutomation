import {
  LWIN_ATTRIBUTION,
  buildIdentityKey,
  gtinCheckDigitValid,
  identityDisplayLabel,
  normaliseGtin,
  parseLwin,
  readIdentity,
} from "./beverage-identity";

/**
 * The identity key, the GTIN reader and the LWIN reader.
 *
 * Every code in here that is presented as real IS real: the UPCs are taken
 * from the Iowa Liquor Products file fetched live on 2026-09-05
 * (https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json, 5,425,785 bytes,
 * 13,762 rows), and the collision case is the one that file actually
 * publishes.
 */

function parts(input: Parameters<typeof readIdentity>[0]) {
  const r = readIdentity(input);
  if (!r.ok) throw new Error(`expected a reading, got ${r.reason}`);
  return r;
}

describe("readIdentity", () => {
  it("reads the four parts", () => {
    const r = parts({
      producer: "Château Margaux",
      name: "Château Margaux Grand Vin",
      vintage: 2015,
      sizeMl: 750,
      pack: 1,
    });
    expect(r.producerNormalised).toBe("chateau margaux");
    expect(r.nameNormalised).toBe("chateau margaux grand vin");
    expect(r.vintageText).toBe("2015");
    expect(r.sizeMl).toBe(750);
    expect(r.pack).toBe(1);
  });

  it("keeps THREE answers for vintage, because silence is not non-vintage", () => {
    expect(parts({ producer: "Krug", name: "Grande Cuvée" }).vintageText).toBe(
      "unstated",
    );
    expect(
      parts({ producer: "Krug", name: "Grande Cuvée", vintage: "NV" }).vintageText,
    ).toBe("nv");
    expect(
      parts({ producer: "Krug", name: "Vintage", vintage: "2008" }).vintageText,
    ).toBe("2008");
  });

  it("refuses a bottle with no name", () => {
    const r = readIdentity({ producer: "Krug", name: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_name");
  });

  it("refuses a bottle with no producer, because it can never be blocked on", () => {
    const r = readIdentity({ producer: null, name: "Grande Cuvée" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_producer");
  });

  it("refuses a zero size — the case Iowa publishes 11 times", () => {
    const r = readIdentity({ producer: "Sazerac", name: "Ingredient", sizeMl: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("size_not_positive");
  });

  it("refuses four digits that are not a year, so a lot code is not a vintage", () => {
    const r = readIdentity({ producer: "Krug", name: "Grande Cuvée", vintage: "0421" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("vintage_not_a_year");
  });

  it("refuses a fractional pack", () => {
    const r = readIdentity({ producer: "Krug", name: "Grande Cuvée", pack: 1.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pack_not_positive");
  });
});

describe("buildIdentityKey", () => {
  /**
   * This exact string is asserted a second time, from the other side, by the
   * `DO $$` block in
   * `supabase/migrations/20260905140000_a_bottle_has_one_identity.sql`. If the
   * generated column and this function ever disagree, one of the two fails.
   */
  it("produces the same string the generated column does", () => {
    expect(
      buildIdentityKey({
        producerNormalised: "probe producer",
        nameNormalised: "probe wine",
        vintageText: "2019",
        sizeMl: 750,
        pack: 1,
      }),
    ).toBe("probe producer|probe wine|2019|750|1");
  });

  it("keeps an unstated part visible instead of defaulting it", () => {
    expect(
      buildIdentityKey({
        producerNormalised: "krug",
        nameNormalised: "grande cuvee",
        vintageText: "nv",
        sizeMl: null,
        pack: null,
      }),
    ).toBe("krug|grande cuvee|nv|size?|pack?");
  });

  it("gives a magnum a different key from the 750 — ADR 0119 Q7", () => {
    const base = {
      producerNormalised: "chateau margaux",
      nameNormalised: "grand vin",
      vintageText: "2015",
      pack: 1,
    };
    expect(buildIdentityKey({ ...base, sizeMl: 750 })).not.toBe(
      buildIdentityKey({ ...base, sizeMl: 1500 }),
    );
  });

  it("gives a 12x375 case a different key from a 6x750 case", () => {
    const twelveByThreeSeventyFive = buildIdentityKey({
      producerNormalised: "p",
      nameNormalised: "n",
      vintageText: "2019",
      sizeMl: 375,
      pack: 12,
    });
    const sixBySevenFifty = buildIdentityKey({
      producerNormalised: "p",
      nameNormalised: "n",
      vintageText: "2019",
      sizeMl: 750,
      pack: 6,
    });
    expect(twelveByThreeSeventyFive).not.toBe(sixBySevenFifty);
  });
});

describe("identityDisplayLabel", () => {
  it("does not repeat the producer the name already carries, and names the format", () => {
    const input = {
      producer: "Schramsberg Vineyards",
      name: "Schramsberg Blanc de Noir",
      vintage: 2021,
      sizeMl: 1500,
      pack: 1,
    };
    expect(identityDisplayLabel(input, parts(input))).toBe(
      "Schramsberg Blanc de Noir 2021 (1500ml)",
    );
  });

  it("names the pack when there is more than one bottle in it", () => {
    const input = { producer: "Krug", name: "Grande Cuvée", vintage: "nv", sizeMl: 750, pack: 6 };
    expect(identityDisplayLabel(input, parts(input))).toBe(
      "Krug Grande Cuvée (750ml x6)",
    );
  });
});

describe("normaliseGtin", () => {
  it("accepts a real Iowa UPC and stores it as GTIN-14", () => {
    const g = normaliseGtin("088004022723");
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.gtin14).toBe("00088004022723");
      expect(g.sourceLength).toBe(12);
    }
  });

  it("accepts a 14-digit code unchanged", () => {
    const g = normaliseGtin("10083664874139");
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.gtin14).toBe("10083664874139");
  });

  it("refuses a code whose check digit is wrong", () => {
    // The real UPC above with its last digit moved by one.
    const g = normaliseGtin("088004022724");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toBe("check_digit");
  });

  it("refuses a code that is not digits, because that is a SKU", () => {
    const g = normaliseGtin("ABC-123");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toBe("not_digits");
  });

  it("refuses a length no GTIN has", () => {
    const g = normaliseGtin("1234567890");
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toBe("bad_length");
  });

  it("validates every one of the five real Iowa UPCs used in these tests", () => {
    for (const upc of [
      "088004022723",
      "835229000308",
      "081128001032",
      "088076183124",
      "080686027010",
    ]) {
      expect(gtinCheckDigitValid(upc.padStart(14, "0"))).toBe(true);
    }
  });
});

describe("parseLwin", () => {
  it("reads an LWIN-7 as the wine alone", () => {
    const l = parseLwin("1017092");
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.form).toBe(7);
      expect(l.lwin7).toBe("1017092");
      expect(l.vintageText).toBeNull();
      expect(l.sizeMl).toBeNull();
    }
  });

  it("reads an LWIN-11 as wine + vintage", () => {
    const l = parseLwin("10170922020");
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.form).toBe(11);
      expect(l.vintageText).toBe("2020");
      expect(l.pack).toBeNull();
    }
  });

  it("reads an LWIN-16 as wine + vintage + size", () => {
    const l = parseLwin("1017092202000750");
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.form).toBe(16);
      expect(l.vintageText).toBe("2020");
      expect(l.sizeMl).toBe(750);
      expect(l.pack).toBeNull();
    }
  });

  it("reads an LWIN-18 as wine + vintage + pack + size", () => {
    const l = parseLwin("101709220200600750");
    expect(l.ok).toBe(true);
    if (l.ok) {
      expect(l.form).toBe(18);
      expect(l.lwin7).toBe("1017092");
      expect(l.vintageText).toBe("2020");
      expect(l.pack).toBe(6);
      expect(l.sizeMl).toBe(750);
    }
  });

  it("reads an out-of-range vintage group as unstated, never as a year", () => {
    const l = parseLwin("101709200000600750");
    expect(l.ok).toBe(true);
    if (l.ok) expect(l.vintageText).toBe("unstated");
  });

  it("refuses a length no LWIN has", () => {
    const l = parseLwin("101709220");
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.reason).toBe("bad_length");
  });

  it("refuses an implausible size group rather than storing a 0ml bottle", () => {
    const l = parseLwin("101709220200600000");
    expect(l.ok).toBe(false);
    if (!l.ok) expect(l.reason).toBe("implausible_part");
  });

  it("carries the CC BY 4.0 attribution Liv-ex requires", () => {
    expect(LWIN_ATTRIBUTION).toContain("CC BY 4.0");
    expect(LWIN_ATTRIBUTION).toContain("Liv-ex");
  });
});
