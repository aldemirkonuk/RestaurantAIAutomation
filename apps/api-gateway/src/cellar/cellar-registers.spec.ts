import {
  ADD_THE_ROWS_PROMPT,
  applyAnswers,
  inferRegisters,
  registerForKind,
  registersForLabel,
  REGISTER_IDS,
  type InferenceInput,
  type RegisterId,
  type StoredAnswer,
} from "./cellar-registers";

/**
 * The inference is a claim about what words and counts MEAN, so it is tested
 * without a database. Every case below is one of the sentences the founder's
 * review named, or one of the ways an earlier version of this page would have
 * told a house something untrue about itself.
 */

const EMPTY: InferenceInput = {
  kindCounts: new Map(),
  inventoryNameCounts: new Map(),
  menuCounts: new Map(),
  cocktailRows: 0,
  unmappedKinds: {},
  catalogueCounts: new Map(),
  hasAnyEvidence: false,
};

const by = (rows: ReturnType<typeof inferRegisters>, id: RegisterId) =>
  rows.find((r) => r.id === id)!;

describe("registersForLabel", () => {
  it("reads a menu section header into every register it names", () => {
    expect(registersForLabel("Whiskey & Rye")).toEqual(
      expect.arrayContaining(["whiskey", "spirits"]),
    );
    expect(registersForLabel("Draft Beer")).toContain("beer");
    expect(registersForLabel("Signature Cocktails")).toContain("cocktails");
    expect(registersForLabel("Soft Drinks")).toEqual(
      expect.arrayContaining(["soft_drinks", "non_alcoholic"]),
    );
  });

  it("matches whole words only, so a wine region does not become a beer programme", () => {
    // "Alentejo" contains "ale". A substring match here would put a beer
    // register on the screen of every Portuguese wine list in the product.
    expect(registersForLabel("Alentejo")).not.toContain("beer");
    // "banana" contains "na"; "popcorn" contains "pop".
    expect(registersForLabel("Banana Bread Pudding")).toEqual([]);
    expect(registersForLabel("Popcorn Shrimp")).toEqual([]);
  });

  it("returns nothing for an empty or missing label rather than guessing", () => {
    expect(registersForLabel(null)).toEqual([]);
    expect(registersForLabel("")).toEqual([]);
    expect(registersForLabel("   ")).toEqual([]);
  });
});

describe("registerForKind", () => {
  it("maps the five classifier values that have a register", () => {
    expect(registerForKind("wine")).toBe("wines");
    expect(registerForKind("beer")).toBe("beer");
    expect(registerForKind("spirit")).toBe("spirits");
    expect(registerForKind("cocktail")).toBe("cocktails");
    expect(registerForKind("non_alcoholic")).toBe("non_alcoholic");
  });

  it("refuses to fold sake, cider or unknown into a neighbouring register", () => {
    expect(registerForKind("sake")).toBeNull();
    expect(registerForKind("cider")).toBeNull();
    expect(registerForKind("unknown")).toBeNull();
    expect(registerForKind(null)).toBeNull();
  });
});

describe("inferRegisters", () => {
  it("says UNKNOWN, not false, for a house with no books at all", () => {
    const rows = inferRegisters(EMPTY);
    expect(rows).toHaveLength(REGISTER_IDS.length);
    for (const r of rows) {
      expect(r.carried).toBeNull();
      expect(r.confidence).toBe("unknown");
      expect(r.decidedBy).toBe("unknown");
      expect(r.basis).toContain("unasked");
    }
  });

  it("is CERTAIN about a kind the library's own classifier counted in the cellar", () => {
    const rows = inferRegisters({
      ...EMPTY,
      kindCounts: new Map([["beer", 12]]),
      hasAnyEvidence: true,
    });
    const beer = by(rows, "beer");
    expect(beer.carried).toBe(true);
    expect(beer.confidence).toBe("certain");
    expect(beer.evidence.inventoryRows).toBe(12);
    expect(beer.basis).toContain("classifier");
  });

  it("is only LIKELY about whiskey, because the classifier cannot separate it from spirits", () => {
    const rows = inferRegisters({
      ...EMPTY,
      kindCounts: new Map([["spirit", 9]]),
      inventoryNameCounts: new Map<RegisterId, number>([["whiskey", 4]]),
      hasAnyEvidence: true,
    });
    expect(by(rows, "spirits").confidence).toBe("certain");
    const whiskey = by(rows, "whiskey");
    expect(whiskey.carried).toBe(true);
    expect(whiskey.confidence).toBe("likely");
    expect(whiskey.evidence.nameOnly).toBe(true);
    expect(whiskey.basis).toContain("no value for this register");
  });

  it("is LIKELY about a register that is on the menu but not in the cellar", () => {
    const rows = inferRegisters({
      ...EMPTY,
      kindCounts: new Map([["non_alcoholic", 3]]),
      menuCounts: new Map<RegisterId, number>([["soft_drinks", 7]]),
      hasAnyEvidence: true,
    });
    const soft = by(rows, "soft_drinks");
    expect(soft.carried).toBe(true);
    expect(soft.confidence).toBe("likely");
    expect(soft.basis).toContain("nothing of the kind is counted in the cellar");
  });

  it("the founder's non-alcoholic house: soft drinks and nothing else", () => {
    const rows = inferRegisters({
      ...EMPTY,
      kindCounts: new Map([["non_alcoholic", 41]]),
      menuCounts: new Map<RegisterId, number>([
        ["non_alcoholic", 22],
        ["soft_drinks", 18],
      ]),
      hasAnyEvidence: true,
    });
    const on = rows.filter((r) => r.carried === true).map((r) => r.id).sort();
    expect(on).toEqual(["non_alcoholic", "soft_drinks"]);
    for (const off of ["wines", "beer", "whiskey", "spirits", "cocktails"] as RegisterId[]) {
      expect(by(rows, off).carried).toBe(false);
      expect(by(rows, off).confidence).toBe("none");
    }
  });

  it("counts this house's own cocktail rows towards the cocktails register", () => {
    const rows = inferRegisters({
      ...EMPTY,
      kindCounts: new Map([["wine", 200]]),
      cocktailRows: 14,
      hasAnyEvidence: true,
    });
    const c = by(rows, "cocktails");
    expect(c.carried).toBe(true);
    expect(c.evidence.menuRows).toBe(14);
  });

  it("leaves inventoryRows null — never 0 — when the cellar could not be read", () => {
    const rows = inferRegisters({
      ...EMPTY,
      kindCounts: null,
      inventoryNameCounts: null,
      menuCounts: new Map<RegisterId, number>([["wines", 5]]),
      hasAnyEvidence: true,
    });
    expect(by(rows, "wines").evidence.inventoryRows).toBeNull();
  });
});

describe("applyAnswers", () => {
  const booksSayBeer = inferRegisters({
    ...EMPTY,
    kindCounts: new Map([["beer", 30]]),
    hasAnyEvidence: true,
  });

  const stored = (a: Partial<StoredAnswer> & { carried: boolean }): StoredAnswer => ({
    source: "confirmed",
    confirmedAt: "2026-09-03T10:00:00.000Z",
    ...a,
  });

  it("a confirmation wins over the books, and says that it disagreed", () => {
    const rows = applyAnswers(
      booksSayBeer,
      new Map([["beer" as RegisterId, stored({ carried: false })]]),
    );
    const beer = by(rows, "beer");
    expect(beer.carried).toBe(false);
    expect(beer.decidedBy).toBe("confirmed");
    expect(beer.basis).toContain("overrides the books");
  });

  it("a recorded proposal is still reported as a guess nobody confirmed", () => {
    const rows = applyAnswers(
      booksSayBeer,
      new Map([
        ["beer" as RegisterId, stored({ carried: true, source: "inferred", confirmedAt: null })],
      ]),
    );
    const beer = by(rows, "beer");
    expect(beer.decidedBy).toBe("inferred");
    expect(beer.basis).toContain("Nobody has confirmed it yet");
    expect(beer.needsEvidence).toBe(false);
  });

  it("MANUAL-ON with nothing in the books asks for the rows instead of doubting the house", () => {
    // The founder's change-over-time case: the house starts carrying whiskey,
    // switches the register on, and no menu line or inventory row exists yet.
    const rows = applyAnswers(
      booksSayBeer,
      new Map([
        ["whiskey" as RegisterId, stored({ carried: true, source: "manual" })],
      ]),
    );
    const w = by(rows, "whiskey");
    expect(w.carried).toBe(true);
    expect(w.decidedBy).toBe("manual");
    expect(w.needsEvidence).toBe(true);
    expect(w.basis).toContain("The books show nothing of the kind yet");
    expect(ADD_THE_ROWS_PROMPT).toContain("/inventory");
  });

  it("MANUAL-ON that the books already agree with does not nag", () => {
    const rows = applyAnswers(
      booksSayBeer,
      new Map([["beer" as RegisterId, stored({ carried: true, source: "manual" })]]),
    );
    const beer = by(rows, "beer");
    expect(beer.needsEvidence).toBe(false);
    expect(beer.basis).toContain("the books agree");
  });

  it("a register switched OFF with rows behind it strands them, and says how many", () => {
    // The founder's seasonal case, and the state the first build had none for:
    // a spritz list off in September with a case of prosecco still in the book.
    const booksSayCocktails = inferRegisters({
      ...EMPTY,
      kindCounts: new Map([["cocktail", 9]]),
      menuCounts: new Map<RegisterId, number>([["cocktails", 3]]),
      hasAnyEvidence: true,
    });
    const rows = applyAnswers(
      booksSayCocktails,
      new Map([["cocktails" as RegisterId, stored({ carried: false, source: "manual" })]]),
    );
    const c = by(rows, "cocktails");
    expect(c.carried).toBe(false);
    expect(c.strandedItems).toBe(12);
    expect(c.needsEvidence).toBe(false);
  });

  it("strands nothing when the register is OFF and the books are empty too", () => {
    const rows = applyAnswers(
      booksSayBeer,
      new Map([["whiskey" as RegisterId, stored({ carried: false, source: "confirmed" })]]),
    );
    expect(by(rows, "whiskey").strandedItems).toBe(0);
  });

  it("leaves strandedItems NULL — never 0 — when both books were unreadable", () => {
    const unreadable = inferRegisters({
      ...EMPTY,
      kindCounts: null,
      inventoryNameCounts: null,
      menuCounts: null,
      cocktailRows: null,
      hasAnyEvidence: true,
    });
    const rows = applyAnswers(
      unreadable,
      new Map([["beer" as RegisterId, stored({ carried: false, source: "confirmed" })]]),
    );
    expect(by(rows, "beer").strandedItems).toBeNull();
  });

  it("never asks for rows behind a register that is switched OFF", () => {
    const rows = applyAnswers(
      booksSayBeer,
      new Map([["whiskey" as RegisterId, stored({ carried: false, source: "manual" })]]),
    );
    expect(by(rows, "whiskey").needsEvidence).toBe(false);
  });

  it("leaves an unanswered register exactly as the inference left it", () => {
    const rows = applyAnswers(booksSayBeer, new Map());
    expect(by(rows, "beer").decidedBy).toBe("inferred");
    expect(by(rows, "beer").carried).toBe(true);
  });
});
