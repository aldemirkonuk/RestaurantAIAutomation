import {
  isValidTckn,
  isValidVkn,
  normalizeTaxId,
} from "./tax-identity";

/**
 * ADR 0104 D15 — the normaliser.
 *
 * Every case here is one of the adversarial pass's pitfalls. The shape of the
 * suite is deliberate: a refusal is asserted to carry a SENTENCE, because a
 * refusal that reaches the page as a bare `false` is the absence-as-health
 * fault this decision is built to avoid.
 */
describe("normalizeTaxId (ADR 0104 D15)", () => {
  const ok = (r: ReturnType<typeof normalizeTaxId>) => {
    if (!r.ok) throw new Error(`expected ok, got: ${r.reason}`);
    return r.identity;
  };
  const bad = (r: ReturnType<typeof normalizeTaxId>) => {
    if (r.ok)
      throw new Error(`expected a refusal, got: ${r.identity.normalized}`);
    return r.reason;
  };

  describe("Turkey — VKN vs TCKN", () => {
    it("reads a 10-digit VKN, with the country from the document", () => {
      const i = ok(normalizeTaxId("1234567890", "TR"));
      expect(i.scheme).toBe("TR_VKN");
      expect(i.normalized).toBe("TR:1234567890");
      expect(i.printed).toBe("1234567890");
    });

    it("reads an 11-digit TCKN — a sole trader is a legal seller too", () => {
      const i = ok(normalizeTaxId("10203040550", "TR"));
      expect(i.scheme).toBe("TR_TCKN");
      expect(i.normalized).toBe("TR:10203040550");
    });

    it("strips the separators a Turkish invoice prints", () => {
      expect(ok(normalizeTaxId("VKN: 123 456 78-90", "TR")).normalized).toBe(
        "TR:1234567890",
      );
    });

    it("refuses ten digits that fail the VKN check digit", () => {
      expect(bad(normalizeTaxId("1234567891", "TR"))).toMatch(/check digit/);
    });

    it("refuses eleven digits that fail the TCKN check digit", () => {
      expect(bad(normalizeTaxId("10203040551", "TR"))).toMatch(/check digit/);
    });

    it("refuses a Turkish identity of the wrong length", () => {
      expect(bad(normalizeTaxId("12345", "TR"))).toMatch(/10 digits/);
    });
  });

  describe("the United States — EIN", () => {
    it("reads a hyphenated EIN", () => {
      const i = ok(normalizeTaxId("12-3456789", "US"));
      expect(i.scheme).toBe("US_EIN");
      expect(i.normalized).toBe("US:123456789");
    });

    it("KEEPS a leading zero — the number is never parsed as a number", () => {
      expect(ok(normalizeTaxId("01-2345678", "US")).normalized).toBe(
        "US:012345678",
      );
    });

    it("refuses an EIN that is not nine digits", () => {
      expect(bad(normalizeTaxId("12-345678", "US"))).toMatch(/nine digits/);
    });
  });

  describe("the European Union — the prefix carries the country", () => {
    it("reads a prefixed VAT id and the prefix wins over the document", () => {
      const i = ok(normalizeTaxId("DE 811 569 869", "TR"));
      expect(i.country).toBe("DE");
      expect(i.scheme).toBe("EU_VAT");
      expect(i.normalized).toBe("DE:811569869");
    });

    it("folds Greece's EL prefix onto its ISO country code", () => {
      expect(ok(normalizeTaxId("EL123456789")).country).toBe("GR");
    });

    it("refuses a VAT id of the wrong length for its country", () => {
      expect(bad(normalizeTaxId("DE81156986"))).toMatch(/9 characters/);
    });
  });

  describe("what it refuses to invent", () => {
    it("refuses nothing printed", () => {
      expect(bad(normalizeTaxId(null, "TR"))).toMatch(/no tax identity/);
      expect(bad(normalizeTaxId("   ", "TR"))).toMatch(/no tax identity/);
    });

    it("refuses digits with no country anywhere — they are not an identity", () => {
      expect(bad(normalizeTaxId("1234567890", null))).toMatch(/no country/);
    });

    it("does not strip `No.` — it is Norway's VAT prefix and the rule must not choose", () => {
      expect(bad(normalizeTaxId("No: 1234567890", "TR"))).toMatch(/9 or 12/);
    });

    it("refuses punctuation that normalises to nothing", () => {
      expect(bad(normalizeTaxId("—", "TR"))).toMatch(/no letters or digits/);
    });

    it("does not treat two leading letters as a country unless they are one", () => {
      // `ZZ` is not a VAT prefix, so the whole string stays the value and the
      // country comes from the document — where it is then refused as an EIN
      // rather than silently becoming a "ZZ" identity that matches nothing.
      expect(bad(normalizeTaxId("ZZ12345678", "US"))).toMatch(/nine digits/);
      // And a real prefix is not stolen from a document that says otherwise.
      expect(ok(normalizeTaxId("FR12345678901", "TR")).country).toBe("FR");
    });
  });

  describe("the check digits themselves", () => {
    it.each(["1234567890", "9876543217", "1111111114", "5550001112"])(
      "%s is a valid VKN",
      (v) => expect(isValidVkn(v)).toBe(true),
    );
    it.each(["10203040550", "34567890170"])("%s is a valid TCKN", (v) =>
      expect(isValidTckn(v)).toBe(true),
    );
    it("rejects a non-numeric or wrong-length candidate", () => {
      expect(isValidVkn("12345678")).toBe(false);
      expect(isValidTckn("01203040550")).toBe(false);
    });
  });
});
