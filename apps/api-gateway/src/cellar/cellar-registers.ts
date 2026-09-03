/**
 * The cellar register vocabulary, and the pure half of the inference.
 *
 * Kept free of Nest and of the database client on purpose: every rule in this
 * file is a claim about what a word means, and a claim about what a word means
 * should be testable without a network.
 *
 * THE SEVEN NAMES are the founder's own list (review of 2026-09-03). Two pairs
 * overlap and the overlap is preserved rather than normalised away — see
 * `supabase/migrations/20260903092000_restaurant_cellar_registers.sql` for why.
 */

export const REGISTER_IDS = [
  "wines",
  "beer",
  "whiskey",
  "cocktails",
  "spirits",
  "non_alcoholic",
  "soft_drinks",
] as const;

export type RegisterId = (typeof REGISTER_IDS)[number];

export function isRegisterId(v: unknown): v is RegisterId {
  return (
    typeof v === "string" && (REGISTER_IDS as readonly string[]).includes(v)
  );
}

/**
 * How sure the inference is, and — this is the important one — `unknown`, which
 * is NOT the bottom of the scale. `none` means "we looked at this house's rows
 * and found nothing of this kind". `unknown` means "this house has no rows to
 * look at", which is a completely different sentence and must never be rendered
 * as "does not carry it".
 */
export type Confidence = "certain" | "likely" | "none" | "unknown";

/**
 * Where a register's answer came from. The founder's decision of 2026-09-03 is
 * "infer, then confirm at onboarding", with a manual switch afterwards, so
 * these four are the whole vocabulary:
 *
 *   inferred  — read off this house's own books. Either computed live, or a
 *               proposal recorded with `confirmed_at IS NULL`. Nobody agreed.
 *   confirmed — a human accepted or edited the proposal at onboarding.
 *   manual    — a human switched it later, from Settings. Typically for a
 *               category the books cannot yet see.
 *   unknown   — there was nothing to read and nobody has been asked.
 */
export type DecidedBy = "inferred" | "confirmed" | "manual" | "unknown";

/**
 * `master_wine_library.beverage_kind`, the database's own classifier
 * (20260817060000_beverage_kind_classification.sql:44-48). Eight values, and
 * only five of them land on one of the founder's seven registers.
 */
export type BeverageKind =
  | "wine"
  | "beer"
  | "spirit"
  | "sake"
  | "cider"
  | "cocktail"
  | "non_alcoholic"
  | "unknown";

/**
 * Which register a `beverage_kind` proves. `null` means the classifier's answer
 * does not map onto any of the seven — `sake` and `cider` are real categories
 * this house may well carry and the founder's list has no name for them, so
 * they are counted separately and reported, never folded into a neighbour.
 */
export function registerForKind(kind: string | null): RegisterId | null {
  switch (kind) {
    case "wine":
      return "wines";
    case "beer":
      return "beer";
    case "spirit":
      return "spirits";
    case "cocktail":
      return "cocktails";
    case "non_alcoholic":
      return "non_alcoholic";
    default:
      // sake, cider, unknown, and anything the CHECK constraint gains later.
      return null;
  }
}

/**
 * The two registers the database classifier CANNOT see.
 *
 * `beverage_kind` emits `spirit` for a bottle of rye and `non_alcoholic` for a
 * cola alike, so `whiskey` and `soft_drinks` can only ever be reached through a
 * name or a menu section — a weaker signal, and the readout says so rather than
 * quietly presenting a keyword match with the same authority as the classifier.
 */
export const NAME_ONLY_REGISTERS: readonly RegisterId[] = [
  "whiskey",
  "soft_drinks",
];

/**
 * `public.beverages.beverage_type` → the registers it belongs to.
 *
 * MEASURED, not guessed. The distinct values in the live table on 2026-09-03
 * (500-row sample, `GET /beverages/:rid?limit=500`) were: whiskey 211,
 * agave_spirit 60, beer 51, liqueur 44, amaro 30, sake 29, brandy 22, gin 13,
 * spirit_other 12, rum 10, non_alcoholic 8, vodka 6, cider 4. The column has no
 * CHECK constraint and defaults to 'other', so this map is a best-known
 * vocabulary rather than a closed one — which is why anything it does not
 * recognise is REPORTED as unmapped instead of being folded into a neighbour.
 *
 * `sake` and `cider` are deliberately unmapped: they are real categories with
 * no register in the founder's seven, and quietly counting a sake as a spirit
 * would be a lie in the direction that is hardest to notice.
 *
 * `soft_drinks` has NO entry at all. No value of `beverage_type` separates a
 * cola from a kombucha, so a soft-drinks count from this table is not available
 * — and the surface says that rather than showing the non-alcoholic figure
 * twice under two headings.
 */
const BEVERAGE_TYPE_REGISTERS: Record<string, readonly RegisterId[]> = {
  beer: ["beer"],
  ale: ["beer"],
  lager: ["beer"],
  whiskey: ["whiskey", "spirits"],
  whisky: ["whiskey", "spirits"],
  bourbon: ["whiskey", "spirits"],
  agave_spirit: ["spirits"],
  brandy: ["spirits"],
  vodka: ["spirits"],
  gin: ["spirits"],
  rum: ["spirits"],
  liqueur: ["spirits"],
  amaro: ["spirits"],
  spirit: ["spirits"],
  spirit_other: ["spirits"],
  non_alcoholic: ["non_alcoholic"],
  wine: ["wines"],
  cocktail: ["cocktails"],
};

/** The registers a `beverage_type` belongs to. Empty when it maps to none. */
export function registersForBeverageType(type: string | null): RegisterId[] {
  if (!type) return [];
  return [...(BEVERAGE_TYPE_REGISTERS[type.trim().toLowerCase()] ?? [])];
}

/**
 * The `beverage_type` values that serve one register, for a list query's
 * `IN (...)`. Empty when the register is not served by `public.beverages` at
 * all — wines live in `master_wine_library`, cocktails in `public.cocktails`,
 * and soft drinks nowhere yet.
 */
export function beverageTypesForRegister(id: RegisterId): string[] {
  return Object.entries(BEVERAGE_TYPE_REGISTERS)
    .filter(([, regs]) => regs.includes(id))
    .map(([type]) => type);
}

/** Lowercase, strip punctuation to single spaces, pad so \b-style tests are easy. */
export function normalizeLabel(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Word lists, per register. These are matched as WHOLE WORDS against a
 * normalised label — never as substrings — because the short ones are exactly
 * the dangerous ones: "na" inside "banana", "pop" inside "popcorn", "ale"
 * inside "alentejo" (a Portuguese wine region that would otherwise mark a
 * cellar as carrying beer).
 */
const REGISTER_WORDS: Record<RegisterId, readonly string[]> = {
  wines: [
    "wine", "wines", "red", "reds", "white", "whites", "rose", "rosé",
    "sparkling", "champagne", "prosecco", "cava", "cremant", "orange",
    "fortified", "port", "sherry", "madeira", "riesling", "chardonnay",
    "sauvignon", "pinot", "cabernet", "merlot", "syrah", "shiraz",
    "tempranillo", "sangiovese", "nebbiolo", "malbec", "grenache", "zinfandel",
    "bottles", "glass", "btg", "vin", "vino",
  ],
  beer: [
    "beer", "beers", "ale", "ales", "lager", "lagers", "ipa", "ipas", "stout",
    "stouts", "pilsner", "porter", "saison", "hefeweizen", "witbier", "draft",
    "draught", "tap", "taps", "brew", "brews", "brewery", "cerveza", "bira",
  ],
  whiskey: [
    "whiskey", "whiskeys", "whisky", "whiskies", "bourbon", "bourbons", "rye",
    "scotch", "islay", "speyside", "malt", "malts",
  ],
  spirits: [
    "spirit", "spirits", "liquor", "liquors", "gin", "gins", "vodka", "vodkas",
    "rum", "rums", "tequila", "tequilas", "mezcal", "brandy", "cognac",
    "armagnac", "calvados", "grappa", "raki", "ouzo", "pisco", "cachaca",
    "liqueur", "liqueurs", "amaro", "amari", "aperitif", "digestif", "agave",
    "absinthe", "schnapps", "bitters",
    // Whiskey's own words are NOT repeated here — SUBSET_OF below carries
    // "bourbon implies spirits" once, rather than in two word lists that would
    // drift apart the first time one of them gained a word.
  ],
  cocktails: [
    "cocktail", "cocktails", "martini", "martinis", "negroni", "highball",
    "highballs", "spritz", "sour", "sours", "old fashioned", "oldfashioned",
    "margarita", "margaritas", "daiquiri", "manhattan", "mule", "punch",
    "signature", "mixology", "shaken", "stirred", "aperitivo",
  ],
  non_alcoholic: [
    "non alcoholic", "nonalcoholic", "nonalc", "alcohol free", "alcoholfree",
    "zero proof", "zeroproof", "mocktail", "mocktails", "coffee", "espresso",
    "cappuccino", "latte", "tea", "teas", "chai", "matcha", "kombucha",
    "juice", "juices", "smoothie", "smoothies", "lemonade", "soda", "sodas",
    "cola", "water", "waters", "ayran", "kahve", "cay",
  ],
  soft_drinks: [
    "soft drink", "soft drinks", "softdrink", "softdrinks", "soda", "sodas",
    "cola", "colas", "coke", "pepsi", "sprite", "fanta", "lemonade", "juice",
    "juices", "iced tea", "icedtea", "sparkling water", "still water",
    "mineral water", "tonic", "ginger ale", "root beer", "gazoz",
  ],
};

/**
 * The two containments in the founder's seven names, written down ONCE.
 *
 * A whiskey bar carries spirits; a house with a Soft Drinks section carries
 * non-alcoholic drinks. Encoding this here rather than by copying whiskey's
 * words into the spirits list means the fact has one home: adding "islay" to
 * the whiskey list automatically teaches the spirits list too, and the two
 * cannot drift.
 *
 * It runs in one direction only. Spirits does NOT imply whiskey — that is the
 * distinction the founder asked for, and the reason whiskey is `nameOnly`.
 */
const SUBSET_OF: Partial<Record<RegisterId, RegisterId>> = {
  whiskey: "spirits",
  soft_drinks: "non_alcoholic",
};

/**
 * Which registers a single free-text label (a menu section, an item name)
 * points at. A label may point at several: "Whiskey & Rye" is whiskey AND
 * spirits, and both are true.
 */
export function registersForLabel(label: string | null | undefined): RegisterId[] {
  if (!label) return [];
  const hay = normalizeLabel(label);
  if (hay.trim() === "") return [];
  const hit = new Set<RegisterId>();
  for (const id of REGISTER_IDS) {
    for (const word of REGISTER_WORDS[id]) {
      if (hay.includes(` ${word} `)) {
        hit.add(id);
        const parent = SUBSET_OF[id];
        if (parent) hit.add(parent);
        break;
      }
    }
  }
  return REGISTER_IDS.filter((id) => hit.has(id));
}

/* ── the readout ───────────────────────────────────────────────────────── */

export interface RegisterEvidence {
  /**
   * Rows in the SHARED reference catalogues of this kind — `master_wine_library`
   * by `beverage_kind`, plus `public.beverages` by `beverage_type`. These are
   * NOT this house's: they never move `carried`, and the surface labels them as
   * the catalogue's size, not the cellar's. They exist so a register the house
   * does carry can show what it would have to browse.
   */
  catalogueRows: number | null;
  /**
   * Inventory rows of this kind that this house actually holds. `null` when the
   * inventory read failed — never 0, which would say "none in the building".
   */
  inventoryRows: number | null;
  /** Menu rows whose section or name names this register. Null when unread. */
  menuRows: number | null;
  /**
   * True when this register can be reached only through a word in a name or a
   * menu section, because the database's own classifier has no value for it.
   */
  nameOnly: boolean;
}

export interface RegisterReadout {
  id: RegisterId;
  /**
   * Does this house carry it? `null` is a first-class answer meaning nobody has
   * said and there is nothing to infer from — a brand new house, an empty
   * cellar, an unimported menu.
   */
  carried: boolean | null;
  decidedBy: DecidedBy;
  confidence: Confidence;
  /** One sentence, safe to render verbatim. Never a template with a hole in it. */
  basis: string;
  evidence: RegisterEvidence;
  /**
   * The register is ON, and this house's books contain nothing of the kind.
   *
   * This is the founder's change-over-time case: a house adds whiskey in March,
   * switches the register on, and there is no menu line and no inventory row to
   * sense it with. The register is not wrong — the books are behind — so the
   * surface asks for the menu or the inventory items rather than doubting the
   * human. False whenever `carried` is not true, because "add your rows" is
   * nonsense advice about a register nobody turned on.
   */
  needsEvidence: boolean;
  /**
   * The SYMMETRIC state, and the one the founder's brief named that the first
   * build had no state for at all: the register is OFF and this house's books
   * still hold items of the kind. A seasonal spritz list switched off in
   * September leaves menu rows and stock behind it; the old copy said the same
   * words about that register as about one nobody ever turned on.
   *
   * The count is of THIS HOUSE'S rows only — cellar plus menu, never the shared
   * catalogue, which belongs to nobody. `null` when both sources were
   * unreadable: "we could not look" is not "there is nothing there".
   *
   * Turning a register off at the end of a season is a correct, deliberate act.
   * Nothing built on this field may be a confirm dialog on the toggle.
   */
  strandedItems: number | null;
}

export interface InferenceInput {
  /** beverage_kind → count, over this tenant's ACTIVE inventory rows. */
  kindCounts: Map<string, number> | null;
  /**
   * Register → count, from names on this tenant's inventory rows. Carries the
   * two registers `beverage_kind` cannot express.
   */
  inventoryNameCounts: Map<RegisterId, number> | null;
  /** Register → count, over this tenant's menu_items rows. */
  menuCounts: Map<RegisterId, number> | null;
  /** Rows this tenant owns in public.cocktails. */
  cocktailRows: number | null;
  /** Kinds the classifier emitted that no register in the seven can hold. */
  unmappedKinds: Record<string, number>;
  /**
   * Register → rows in the shared reference catalogues. Never evidence of what
   * this house carries; carried through only so a register can say how much
   * there is to browse.
   */
  catalogueCounts: Map<RegisterId, number> | null;
  /** True when at least one source returned at least one row. */
  hasAnyEvidence: boolean;
}

const HUMAN: Record<RegisterId, string> = {
  wines: "Wines",
  beer: "Beer",
  whiskey: "Whiskey",
  cocktails: "Cocktails",
  spirits: "Spirits",
  non_alcoholic: "Non-alcoholic",
  soft_drinks: "Soft drinks",
};

export function registerTitle(id: RegisterId): string {
  return HUMAN[id];
}

/**
 * The inference, as a pure function of counts.
 *
 * The rule, stated once: **a count of rows is evidence; the absence of rows is
 * evidence only when there were rows to look at.** So a house with an empty
 * inventory and no menu gets `unknown` on every register, not `false` on every
 * register — because "we read your books and you sell nothing" is a claim this
 * function is not entitled to make about a house that has no books yet.
 */
export function inferRegisters(input: InferenceInput): RegisterReadout[] {
  return REGISTER_IDS.map((id) => {
    const nameOnly = NAME_ONLY_REGISTERS.includes(id);

    const byKind =
      input.kindCounts === null
        ? null
        : sumKindsFor(id, input.kindCounts);
    const byName =
      input.inventoryNameCounts === null
        ? null
        : (input.inventoryNameCounts.get(id) ?? 0);
    const inventoryRows =
      byKind === null && byName === null ? null : (byKind ?? 0) + (byName ?? 0);

    let menuRows = input.menuCounts === null ? null : (input.menuCounts.get(id) ?? 0);
    if (id === "cocktails" && input.cocktailRows !== null) {
      menuRows = (menuRows ?? 0) + input.cocktailRows;
    }

    const catalogueRows =
      input.catalogueCounts === null
        ? null
        : (input.catalogueCounts.get(id) ?? 0);

    const evidence: RegisterEvidence = {
      inventoryRows,
      menuRows,
      catalogueRows,
      nameOnly,
    };

    if (!input.hasAnyEvidence) {
      return {
        id,
        carried: null,
        decidedBy: "unknown" as const,
        confidence: "unknown" as const,
        basis:
          "Nothing has been counted into the cellar and no menu has been read, so this cannot be inferred yet. It is unasked, not absent.",
        evidence,
        needsEvidence: false,
        strandedItems: 0,
      };
    }

    // The classifier is the strongest signal there is: the row is IN THE
    // BUILDING and the database itself said what it is.
    if (byKind !== null && byKind > 0) {
      return {
        id,
        carried: true,
        decidedBy: "inferred" as const,
        confidence: "certain" as const,
        basis: `${byKind} ${byKind === 1 ? "bottle" : "bottles"} in this cellar ${byKind === 1 ? "is" : "are"} classified as ${HUMAN[id].toLowerCase()} by the library's own classifier.`,
        evidence,
        needsEvidence: false,
        strandedItems: 0,
      };
    }

    // In the building, but only a word in the name says which register.
    if (byName !== null && byName > 0) {
      return {
        id,
        carried: true,
        decidedBy: "inferred" as const,
        confidence: nameOnly ? ("likely" as const) : ("certain" as const),
        basis: nameOnly
          ? `${byName} ${byName === 1 ? "row" : "rows"} in this cellar ${byName === 1 ? "names" : "name"} ${HUMAN[id].toLowerCase()}. The library's classifier has no value for this register, so this reads the name, not a classification.`
          : `${byName} ${byName === 1 ? "row" : "rows"} in this cellar ${byName === 1 ? "names" : "name"} ${HUMAN[id].toLowerCase()}.`,
        evidence,
        needsEvidence: false,
        strandedItems: 0,
      };
    }

    // On the menu, not in the cellar. True of a house that sells it and does
    // not track it — which is most houses, for soft drinks.
    if (menuRows !== null && menuRows > 0) {
      return {
        id,
        carried: true,
        decidedBy: "inferred" as const,
        confidence: "likely" as const,
        basis: `${menuRows} menu ${menuRows === 1 ? "line names" : "lines name"} ${HUMAN[id].toLowerCase()}, though nothing of the kind is counted in the cellar.`,
        evidence,
        needsEvidence: false,
        strandedItems: 0,
      };
    }

    return {
      id,
      carried: false,
      decidedBy: "inferred" as const,
      confidence: "none" as const,
      basis: `Nothing in this cellar and nothing on this menu names ${HUMAN[id].toLowerCase()}.`,
      evidence,
      needsEvidence: false,
      // Nothing to strand: the books hold none of this kind either.
      strandedItems: 0,
    };
  });
}

function sumKindsFor(id: RegisterId, counts: Map<string, number>): number {
  let total = 0;
  for (const [kind, n] of counts) {
    if (registerForKind(kind) === id) total += n;
  }
  return total;
}

/**
 * Lay the house's recorded answers over the live inference.
 *
 * A stored row always wins — including a stored `false` against an inference of
 * `certain`. That is deliberate: a house that says "we do not run a whiskey
 * programme" while three bottles of rye sit in the cellar is describing its
 * business, and the software is describing its shelves. The business wins, and
 * the disagreement stays visible in `basis` so nobody has to guess why the
 * register vanished.
 *
 * A stored row whose source is `inferred` is a PROPOSAL, not an answer. It wins
 * over the live inference (so the page does not flicker as the books change
 * under a house that has not been asked yet) but it is still reported as
 * `inferred`, and its sentence says nobody has confirmed it.
 */
export interface StoredAnswer {
  carried: boolean;
  source: "inferred" | "confirmed" | "manual";
  confirmedAt: string | null;
}

export function applyAnswers(
  inferred: RegisterReadout[],
  stored: Map<RegisterId, StoredAnswer>,
): RegisterReadout[] {
  return inferred.map((r) => {
    const d = stored.get(r.id);
    if (!d) return r;

    // Whether THIS HOUSE'S BOOKS show anything of the kind, right now. The
    // stored answer does not change this, and it is what both notices key off:
    // ON with nothing behind it asks for rows; OFF with rows behind it says
    // the rows are still there.
    const ownRows =
      r.evidence.inventoryRows === null && r.evidence.menuRows === null
        ? null
        : (r.evidence.inventoryRows ?? 0) + (r.evidence.menuRows ?? 0);
    const booksShowNothing = ownRows === 0;

    const said = d.carried ? "carries" : "does not carry";
    const name = HUMAN[r.id].toLowerCase();

    if (d.source === "inferred") {
      return {
        ...r,
        carried: d.carried,
        decidedBy: "inferred" as const,
        // A recorded proposal is no surer than the reading that produced it.
        confidence: r.confidence === "unknown" ? "unknown" : r.confidence,
        basis: `Read from this house's own books: ${lowerFirst(r.basis)} Nobody has confirmed it yet.`,
        needsEvidence: false,
        // A proposal nobody confirmed does not strand anything: the register
        // is off because the books are empty, not despite them being full.
        strandedItems: d.carried === false ? (ownRows ?? null) : 0,
      };
    }

    const disagrees = r.carried !== null && r.carried !== d.carried;
    const how =
      d.source === "manual"
        ? "The house switched this register on itself"
        : "The house confirmed at onboarding that it";

    return {
      ...r,
      carried: d.carried,
      decidedBy: d.source,
      confidence: "certain" as const,
      basis:
        d.source === "manual"
          ? d.carried
            ? disagrees || booksShowNothing
              ? `${how}. The books show nothing of the kind yet — ${lowerFirst(r.basis)}`
              : `${how}, and the books agree — ${lowerFirst(r.basis)}`
            : `The house switched this register off itself.${disagrees ? ` The books disagree — ${lowerFirst(r.basis)}` : ""}`
          : disagrees
            ? `${how} ${said} ${name}. That overrides the books — ${lowerFirst(r.basis)}`
            : `${how} ${said} ${name}.`,
      needsEvidence: d.carried === true && booksShowNothing,
      // OFF, with this house's own rows still behind it.
      strandedItems: d.carried === false ? (ownRows ?? null) : 0,
    };
  });
}

/**
 * The sentence the surface shows when a register is on and the books hold
 * nothing of the kind. One string, one home — the onboarding step, the settings
 * control and the cellar page all render this exact text, so it cannot drift
 * into three slightly different asks.
 */
export const ADD_THE_ROWS_PROMPT =
  "Add the menu or the items to /inventory so the house can see them.";

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}
