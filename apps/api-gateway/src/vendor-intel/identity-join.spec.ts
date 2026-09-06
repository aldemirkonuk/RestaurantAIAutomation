import {
  CANDIDATE_FLOOR,
  IdentityKeyRow,
  RegisteredIdentity,
  UNSTATED_CEILING,
  describeGroupingKey,
  joinByExactKey,
  proposeCandidates,
} from "./identity-join";

/**
 * The joiner and the candidate generator.
 *
 * The ambiguity case is not invented. UPC `081128001032` is published by the
 * Iowa Liquor Products file (fetched live 2026-09-05) against THREE distinct
 * item numbers: a 50 ml Van Gogh Fruit Sampler, a 50 ml Van Gogh Dessert
 * Sampler and a 1,000 ml Woodford Reserve Holiday 2026 from a different
 * supplier. 1,736 of that file's 9,118 distinct UPCs behave this way and every
 * one of the 13,762 passes its GS1 check digit, so this is what a WELL-FORMED
 * code looks like when it is not an identity.
 */

const IOWA_AMBIGUOUS_UPC = "00081128001032";

const keys: IdentityKeyRow[] = [
  {
    identityId: "id-van-gogh-fruit",
    keyNamespace: "gtin",
    keyClass: "global_standard",
    keyValue: IOWA_AMBIGUOUS_UPC,
  },
  {
    identityId: "id-van-gogh-dessert",
    keyNamespace: "gtin",
    keyClass: "global_standard",
    keyValue: IOWA_AMBIGUOUS_UPC,
  },
  {
    identityId: "id-woodford-holiday",
    keyNamespace: "gtin",
    keyClass: "global_standard",
    keyValue: IOWA_AMBIGUOUS_UPC,
  },
  {
    identityId: "id-fireball-bib",
    keyNamespace: "gtin",
    keyClass: "global_standard",
    keyValue: "00088004022723",
  },
  {
    identityId: "id-fireball-bib",
    keyNamespace: "source:iowa-liquor-products",
    keyClass: "source_local",
    keyValue: "100015",
  },
];

describe("joinByExactKey", () => {
  it("joins when the key names exactly one identity", () => {
    const r = joinByExactKey({ namespace: "gtin", value: "00088004022723" }, keys);
    expect(r.outcome).toBe("joined");
    if (r.outcome === "joined") expect(r.identityId).toBe("id-fireball-bib");
  });

  it("REFUSES when the key names more than one, and says so at 1/n", () => {
    const r = joinByExactKey({ namespace: "gtin", value: IOWA_AMBIGUOUS_UPC }, keys);
    expect(r.outcome).toBe("ambiguous");
    if (r.outcome === "ambiguous") {
      expect(r.identityIds.sort()).toEqual([
        "id-van-gogh-dessert",
        "id-van-gogh-fruit",
        "id-woodford-holiday",
      ]);
      expect(r.confidence).toBeCloseTo(0.333, 3);
      expect(r.reason).toContain("does not identify this row");
    }
  });

  it("says a key it has never seen is not recorded, not absent from the world", () => {
    const r = joinByExactKey({ namespace: "gtin", value: "00012345678905" }, keys);
    expect(r.outcome).toBe("unknown_key");
    if (r.outcome === "unknown_key") {
      expect(r.reason).toContain("not yet recorded");
    }
  });

  it("keeps namespaces apart, so a source item code is not read as a GTIN", () => {
    expect(
      joinByExactKey({ namespace: "gtin", value: "100015" }, keys).outcome,
    ).toBe("unknown_key");
    expect(
      joinByExactKey(
        { namespace: "source:iowa-liquor-products", value: "100015" },
        keys,
      ).outcome,
    ).toBe("joined");
  });

  it("counts one identity once even when two key rows assert it", () => {
    const doubled: IdentityKeyRow[] = [
      ...keys,
      {
        identityId: "id-fireball-bib",
        keyNamespace: "gtin",
        keyClass: "global_standard",
        keyValue: "00088004022723",
      },
    ];
    expect(
      joinByExactKey({ namespace: "gtin", value: "00088004022723" }, doubled).outcome,
    ).toBe("joined");
  });
});

// ---------------------------------------------------------------------------

const register: RegisteredIdentity[] = [
  {
    id: "margaux-750-2015",
    producerNormalised: "chateau margaux",
    nameNormalised: "chateau margaux grand vin",
    vintageText: "2015",
    sizeMl: 750,
    pack: 1,
    displayLabel: "Château Margaux Grand Vin 2015 (750ml)",
  },
  {
    id: "margaux-1500-2015",
    producerNormalised: "chateau margaux",
    nameNormalised: "chateau margaux grand vin",
    vintageText: "2015",
    sizeMl: 1500,
    pack: 1,
    displayLabel: "Château Margaux Grand Vin 2015 (1500ml)",
  },
  {
    id: "margaux-750-2016",
    producerNormalised: "chateau margaux",
    nameNormalised: "chateau margaux grand vin",
    vintageText: "2016",
    sizeMl: 750,
    pack: 1,
    displayLabel: "Château Margaux Grand Vin 2016 (750ml)",
  },
  {
    id: "krug-nv",
    producerNormalised: "krug",
    nameNormalised: "grande cuvee",
    vintageText: "nv",
    sizeMl: 750,
    pack: 1,
    displayLabel: "Krug Grande Cuvée (750ml)",
  },
];

describe("proposeCandidates", () => {
  it("suggests only the identity whose stated size matches", () => {
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2015,
        sizeMl: 750,
        pack: 1,
      },
      register,
    );
    expect(run.candidates.map((c) => c.identityId)).toEqual(["margaux-750-2015"]);
    expect(run.candidates[0].confidence).toBeGreaterThan(0.9);
    expect(run.candidates[0].evidence.unstated).toEqual([]);
  });

  it("disqualifies a different stated size rather than scoring it lower", () => {
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2015,
        sizeMl: 3000,
        pack: 1,
      },
      register,
    );
    expect(run.candidates).toHaveLength(0);
    expect(run.refusal?.reason).toBe("all_disqualified");
    expect(run.refusal?.note).toContain("different trade items");
  });

  it("disqualifies a different stated pack", () => {
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2015,
        sizeMl: 750,
        pack: 6,
      },
      register,
    );
    expect(run.candidates).toHaveLength(0);
    expect(run.refusal?.reason).toBe("all_disqualified");
  });

  it("disqualifies a different stated vintage", () => {
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2019,
        sizeMl: 750,
        pack: 1,
      },
      register,
    );
    expect(run.candidates).toHaveLength(0);
  });

  it("treats an asserted nv and a year as different bottles", () => {
    const run = proposeCandidates(
      { producer: "Krug", name: "Grande Cuvee", vintage: 2008, sizeMl: 750, pack: 1 },
      register,
    );
    expect(run.candidates).toHaveLength(0);
  });

  it("caps confidence when a part is unstated, and names which", () => {
    const run = proposeCandidates(
      { producer: "Chateau Margaux", name: "Chateau Margaux Grand Vin", vintage: 2015 },
      register,
    );
    expect(run.candidates.length).toBeGreaterThan(0);
    for (const c of run.candidates) {
      expect(c.confidence).toBeLessThanOrEqual(UNSTATED_CEILING);
      expect(c.evidence.unstated).toEqual(["size", "pack"]);
    }
    // Both formats of the 2015 come back, because nothing said which it is.
    expect(run.candidates.map((c) => c.identityId).sort()).toEqual([
      "margaux-1500-2015",
      "margaux-750-2015",
    ]);
  });

  it("never links: every result is a suggestion carrying its evidence", () => {
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2015,
        sizeMl: 750,
        pack: 1,
      },
      register,
    );
    for (const c of run.candidates) {
      expect(c.method).toBe("normalised_key");
      expect(c.evidence.subjectKey).toContain("|750|1");
      expect(c.evidence.identityKey).toContain("|750|1");
      expect(Object.keys(c)).not.toContain("linked");
    }
  });

  it("reports a producer with no distinctive word rather than scanning everything", () => {
    const run = proposeCandidates(
      { producer: "The Wine Company", name: "Grande Cuvee", vintage: "nv" },
      register,
    );
    expect(run.candidates).toHaveLength(0);
    expect(run.refusal?.reason).toBe("no_block");
    expect(run.scanned.blocked).toBe(0);
  });

  it("reports a producer nobody in the register shares", () => {
    const run = proposeCandidates(
      { producer: "Sazerac", name: "Fireball", vintage: "nv", sizeMl: 750, pack: 1 },
      register,
    );
    expect(run.candidates).toHaveLength(0);
    expect(run.refusal?.reason).toBe("no_block");
    expect(run.refusal?.note).toContain("nothing was guessed");
  });

  it("refuses a subject it cannot read at all", () => {
    const run = proposeCandidates({ producer: "Krug", name: "" }, register);
    expect(run.refusal?.reason).toBe("subject_unreadable");
  });

  it("keeps a weak name below the floor instead of showing the best of a bad lot", () => {
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Pavillon Rouge Second Wine",
        vintage: 2015,
        sizeMl: 750,
        pack: 1,
      },
      register,
      { floor: 0.9 },
    );
    expect(run.candidates).toHaveLength(0);
    expect(run.refusal?.reason).toBe("below_floor");
    expect(run.scanned.blocked).toBeGreaterThan(0);
  });

  it("has a floor that is a display threshold and not a merge threshold", () => {
    expect(CANDIDATE_FLOOR).toBeLessThan(1);
    const run = proposeCandidates(
      {
        producer: "Chateau Margaux",
        name: "Chateau Margaux Grand Vin",
        vintage: 2015,
        sizeMl: 750,
        pack: 1,
      },
      register,
    );
    // A perfect score still produces a candidate, never a link.
    expect(run.candidates[0].confidence).toBeGreaterThan(0.9);
    expect(run.candidates[0]).not.toHaveProperty("status");
  });
});

describe("describeGroupingKey", () => {
  it("says so when nothing carries an identity", () => {
    expect(describeGroupingKey({ identity: 0, wine: 4, signature: 2 })).toContain(
      "grouped the old way",
    );
  });

  it("says so when everything does", () => {
    expect(describeGroupingKey({ identity: 6, wine: 0, signature: 0 })).toContain(
      "cannot be averaged away",
    );
  });

  it("counts the mixture rather than rounding it to one story", () => {
    expect(describeGroupingKey({ identity: 2, wine: 3, signature: 1 })).toBe(
      "2 of 6 comparisons are grouped by confirmed bottle identity; the remaining 4 fall back to wine and name, where a size or pack difference is not visible.",
    );
  });

  it("says nothing was grouped rather than dividing by zero", () => {
    expect(describeGroupingKey({ identity: 0, wine: 0, signature: 0 })).toBe(
      "No sightings were grouped.",
    );
  });
});
