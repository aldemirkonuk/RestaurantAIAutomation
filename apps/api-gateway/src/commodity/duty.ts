/**
 * A rate IS a series, and a per-bottle duty line is derived from one — or the
 * derivation is refused BY NAME.
 *
 * The founder, 2026-09-05 (batch 51): *"rates ARE series (value_kind rate:
 * HMRC duty, GİB ÖTV, Illinois gallonage, each with statute and effective
 * date; a per-bottle duty line derivable and printed with its basis)"*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE RATES, THREE DIFFERENT DENOMINATORS, AND THAT IS THE WHOLE PROBLEM
 * ─────────────────────────────────────────────────────────────────────────────
 *   HMRC       GBP per litre of PURE ALCOHOL   needs the size AND the strength
 *   Illinois   USD per GALLON of liquid        needs only the size
 *   GİB ÖTV    TL, "asgari maktu vergi tutarı" — and the issuer DOES NOT STATE
 *              what it is per, on the face of the table
 *
 * A single `rate x volume` helper across those three would be wrong twice. So
 * the denominator is a declared value on the rate itself, the arithmetic is
 * chosen from it, and the third one is refused rather than guessed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE ITS TWO INPUTS COME FROM, AND WHY NEITHER IS THE OBVIOUS COLUMN
 * ─────────────────────────────────────────────────────────────────────────────
 *   THE SIZE is `beverage_identities.size_ml`, NOT
 *   `master_wine_library.bottle_size_ml`. That column is
 *   `integer DEFAULT 750 NOT NULL`, so a size read off it may be a value nobody
 *   stated, and a duty computed from it would print a figure derived from a
 *   column default and call it this bottle's tax — the
 *   `restaurants.currency DEFAULT 'USD'` defect in a new place, this time with
 *   a number attached. The identity register already solved this and says so in
 *   its own comment: *"NULL means unstated. NEVER 750: the library's 750 is a
 *   column default and this register exists partly to stop that default being
 *   read as a fact"* (20260905140000).
 *
 *   THE STRENGTH is `master_wine_library.abv_percent`. Measured 2026-09-05
 *   there was no such column anywhere — the table had `ml_derived_features` and
 *   `bottle_size_ml` and nothing else — so no HMRC figure was computable for any
 *   bottle, for any house. The founder's batch-57 answer added it: nullable, no
 *   default, carrying the person and the moment
 *   (`20260906120000_a_strength_is_stated_by_a_person.sql`). It is on the
 *   SHARED library row and never on a house's own alias, because strength is a
 *   property of the liquid rather than of one house's paperwork.
 *
 * So `perBottleDuty` takes both as EXPLICIT arguments with an explicit source
 * for each, and refuses when either is absent or is a default. The refusal names
 * which input is missing, so a page can say "somebody has to state this
 * bottle's strength" instead of showing nothing. `bottle-facts.ts` is what
 * resolves the two out of the schema.
 */

/** What the published rate is per. Declared on the rate, never inferred. */
export type DutyDenominator =
  | "litre_of_pure_alcohol"
  | "gallon_of_liquid"
  | "litre_of_liquid"
  | "unstated";

/** Where a number came from. A default is not a measurement. */
export type FigureSource = "typed_by_a_person" | "issuer_published" | "column_default";

export interface BottleFacts {
  sizeMl: number | null;
  sizeSource: FigureSource | null;
  /** Alcohol by volume as a PERCENTAGE (13.5 means 13.5%), or null. */
  abvPercent: number | null;
  abvSource: FigureSource | null;
}

export interface DutyDerivation {
  derived: true;
  /** In the rate's own currency. Never converted. */
  amount: number;
  currency: string;
  /** The whole working, in words, for the line the reader sees. */
  basis: string;
}

export interface DutyRefusal {
  derived: false;
  reason:
    | "denominator_unstated"
    | "no_size"
    | "size_is_a_default"
    | "no_strength"
    | "strength_is_a_default"
    | "not_a_rate"
    | "no_currency";
  /** Plain words naming the missing input, so a page can ask for it. */
  detail: string;
}

export type DutyOutcome = DutyDerivation | DutyRefusal;

/** Exactly, and by definition: 1 US gallon = 3.785411784 litres. */
export const LITRES_PER_US_GALLON = 3.785411784;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The per-bottle duty for one rate and one bottle, or a named refusal.
 *
 * Nothing here converts a currency, and nothing here rounds before the last
 * step: a duty rounded per litre and then multiplied is a different number from
 * one multiplied and then rounded, and the second is the one a tax authority
 * would recognise.
 */
export function perBottleDuty(
  rate: {
    valueKind: string;
    value: number;
    currency: string | null;
    denominator: DutyDenominator;
    issuer: string;
    effectiveFrom: string | null;
    unit: string;
  },
  bottle: BottleFacts,
): DutyOutcome {
  if (rate.valueKind !== "rate") {
    return {
      derived: false,
      reason: "not_a_rate",
      detail:
        "This series is not a rate, so there is no per-bottle duty to derive from it. An index number is not a tax.",
    };
  }
  if (!rate.currency) {
    return {
      derived: false,
      reason: "no_currency",
      detail:
        "This rate states no currency, so any figure derived from it would be a number with no money attached. The absence of a currency is never reported as a currency.",
    };
  }
  if (rate.denominator === "unstated") {
    return {
      derived: false,
      reason: "denominator_unstated",
      detail: `${rate.issuer} does not state what this figure is per, on the face of the table. The rate is real and dated; what it multiplies is not published, so no per-bottle line is derived. Guessing the denominator is exactly the ambiguity ADR 0117's unit rule exists to refuse.`,
    };
  }

  if (bottle.sizeMl === null || bottle.sizeMl <= 0) {
    return {
      derived: false,
      reason: "no_size",
      detail:
        "This bottle's size is not recorded, so there is nothing to multiply the rate by. Somebody has to state the size before a duty line can be shown.",
    };
  }
  if (bottle.sizeSource === "column_default") {
    return {
      derived: false,
      reason: "size_is_a_default",
      detail:
        "This bottle's size comes from a column default (`master_wine_library.bottle_size_ml DEFAULT 750`) rather than from anybody stating it. A duty computed from a default is a number nobody chose, printed as this bottle's tax.",
    };
  }

  const litres = bottle.sizeMl / 1000;

  if (rate.denominator === "litre_of_pure_alcohol") {
    // NULL and 0 are different answers and must not be collapsed. NULL is
    // "nobody has stated a strength"; 0.0 is a person stating a de-alcoholised
    // product, and HMRC's own 0-1.2% band is GBP 0.00. Refusing a stated zero
    // would refuse an answer that is both correct and useful.
    if (bottle.abvPercent === null || bottle.abvPercent < 0) {
      return {
        derived: false,
        reason: "no_strength",
        detail: `${rate.issuer} publishes this rate per litre of PURE ALCOHOL, so this bottle's strength is required and nobody has stated one. It is typed onto the shared library row (master_wine_library.abv_percent) with the person and the moment, and it is never inferred from a category.`,
      };
    }
    if (bottle.abvSource === "column_default") {
      return {
        derived: false,
        reason: "strength_is_a_default",
        detail:
          "This bottle's strength comes from a default rather than from anybody stating it, and a duty per litre of pure alcohol computed from a defaulted strength is a tax figure nobody chose.",
      };
    }
    const pureAlcoholLitres = litres * (bottle.abvPercent / 100);
    return {
      derived: true,
      amount: round2(rate.value * pureAlcoholLitres),
      currency: rate.currency,
      basis:
        `${rate.issuer}, ${rate.unit}${rate.effectiveFrom ? `, in force from ${rate.effectiveFrom}` : ""}: ` +
        `${rate.value} ${rate.currency} per litre of pure alcohol, on ${bottle.sizeMl} ml at ${bottle.abvPercent}% ` +
        `= ${round2(pureAlcoholLitres * 1000) / 1000} litres of pure alcohol. Duty only; no VAT, no margin, no price.`,
    };
  }

  const perLitre =
    rate.denominator === "gallon_of_liquid"
      ? rate.value / LITRES_PER_US_GALLON
      : rate.value;
  return {
    derived: true,
    amount: round2(perLitre * litres),
    currency: rate.currency,
    basis:
      `${rate.issuer}, ${rate.unit}${rate.effectiveFrom ? `, in force from ${rate.effectiveFrom}` : ""}: ` +
      `${rate.value} ${rate.currency} per ${rate.denominator === "gallon_of_liquid" ? "US gallon" : "litre"} of liquid, ` +
      `on ${bottle.sizeMl} ml` +
      `${rate.denominator === "gallon_of_liquid" ? ` (1 US gallon = ${LITRES_PER_US_GALLON} litres, exactly)` : ""}. ` +
      `Duty only; no VAT, no margin, no price.`,
  };
}

/**
 * Can a per-bottle line ever be derived from this rate, ignoring the bottle?
 *
 * The panel prints this per series, because "this product cannot yet show you a
 * duty for your bottle" and "this publisher does not say what its number is
 * per" are different facts and only the first one is fixable by typing
 * something in.
 */
export function derivability(rate: {
  valueKind: string;
  denominator: DutyDenominator;
  issuer: string;
}): { supported: boolean; sentence: string } {
  if (rate.valueKind !== "rate") {
    return {
      supported: false,
      sentence: "Not a rate, so no duty is derived from it.",
    };
  }
  switch (rate.denominator) {
    case "unstated":
      return {
        supported: false,
        sentence: `${rate.issuer} does not state what this figure is per, so no per-bottle duty can be derived from it at all. The rate is recorded, dated and shown as published; the denominator is not published and is not guessed.`,
      };
    case "litre_of_pure_alcohol":
      return {
        supported: true,
        sentence:
          "A per-bottle duty is size x strength x rate, and both are person-stated facts: the strength on the shared library row, the size on the bottle's own identity — never the library's 750 ml column default.",
      };
    case "gallon_of_liquid":
      return {
        supported: true,
        sentence:
          "A per-bottle duty is size x rate, converting 1 US gallon = 3.785411784 litres exactly. The size is the one somebody stated on the bottle's identity, never the library's 750 ml column default.",
      };
    case "litre_of_liquid":
      return {
        supported: true,
        sentence:
          "A per-bottle duty is size x rate. It needs a bottle size somebody stated rather than a column default.",
      };
  }
}
