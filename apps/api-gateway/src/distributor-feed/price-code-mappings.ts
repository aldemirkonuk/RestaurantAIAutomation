/**
 * What a sender's price code means for THIS house — the manager's own
 * statement, and the provenance every row it admits carries.
 *
 * THE DECISION (ADR 0126 Q3; the founder, 2026-09-05)
 * --------------------------------------------------
 * > "Manager maps it, recorded on every row."
 *
 * An EDI 832 prices each line under a `CTP02` Price Identifier Code, and X12
 * leaves that code list to the two trading partners: CDW's published guide
 * defines `C01` as literally "CDW Price", SPS Commerce's MSSS guide uses `CON`
 * and `CAT` out of a list its own guide says holds 164. So there is no
 * universal "the licensee price", and a parser that picked the first CTP, or
 * the lowest, would be inventing a trade level and filing it against a house's
 * real money.
 *
 * The founder's answer is that the person who actually knows — a manager of the
 * house, holding their own distributor's implementation guide or their rep's
 * email — says what the code means, once. This module is the shape of that
 * statement and the rule for reading a set of them.
 *
 * WHAT DOES NOT CHANGE
 * --------------------
 * **The safe refusal is still the default.** A code with no live mapping is
 * still `unmapped_price_basis`, still refused, still counted. Nothing is
 * seeded, and `DistributorEntry` deliberately no longer carries a code map at
 * all — a per-distributor table of meanings shipped in a config file IS the
 * rejected alternative ("Mudavym maintains the mappings"), because Mudavym does
 * not have the house's distributor agreement and cannot know its trade levels.
 *
 * TWO LIVE MAPPINGS FOR ONE CODE IS A REFUSAL, NOT A CHOICE
 * ---------------------------------------------------------
 * The database forbids it (`uq_distributor_price_code_mappings_live`), and this
 * module refuses it a second time rather than trusting the index — because the
 * one thing the parser must never do is pick between two trade levels, and a
 * reader that silently took the newest would do exactly that.
 */

/** One manager statement, as the table stores it. */
export interface PriceCodeMapping {
  id: string;
  restaurantId: string;
  distributorKey: string;
  codeField: "edi_832_ctp02";
  priceCode: string;
  priceBasis: string;
  evidence: string;
  declaredBy: string;
  declaredByName: string;
  declaredAt: string;
  withdrawnBy: string | null;
  /**
   * The name of the person who withdrew it, AS IT WAS on the day.
   *
   * Stored beside `withdrawnBy` rather than joined, for the same reason
   * `declaredByName` is: a rename next year does not make it a different act,
   * and a deleted account does not erase who did it. Null exactly when
   * `withdrawnAt` is — the CHECK
   * `distributor_price_code_mappings_withdrawer_is_named` (migration
   * 20260906150000) refuses every other combination, so a withdrawal in this
   * register can never again say when and why but not by whom.
   */
  withdrawnByName: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
}

/**
 * What the parser needs to admit a line and to stamp the row.
 *
 * Deliberately narrower than `PriceCodeMapping`: the parser is a pure function
 * over bytes and has no business knowing about evidence, withdrawal or the
 * restaurant. What it must carry is the id, so a wrong mapping is one query
 * away, and the name, so a person is answerable for it.
 */
export interface PriceCodeMeaning {
  /** The mapping row's id. Null only in a test that supplies a bare meaning. */
  mappingId: string | null;
  priceBasis: string;
  declaredByName: string | null;
  declaredAt: string | null;
}

/** The only code field there is today. There is no CSV feed path in this repo:
 *  `distributor-feed` parses the 832 and nothing else, and adding a second
 *  format means adding a CHECK member in a migration, which is a decision. */
export const CODE_FIELD_EDI_832 = "edi_832_ctp02" as const;
export type PriceCodeField = typeof CODE_FIELD_EDI_832;

/** The database's own normalisation, enforced here too so a write is refused
 *  before it reaches a CHECK and the person gets a sentence, not a 23514. */
export function normalisePriceCode(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toUpperCase();
  if (!v || v.length > 16) return null;
  // X12 identifier codes are alphanumeric. Anything else is a typo or an
  // injection attempt, and neither should become a live trade level.
  return /^[A-Z0-9]+$/.test(v) ? v : null;
}

export interface MappingReadOutcome {
  /** Code -> meaning, for the parser. Empty when nothing is live. */
  byCode: Record<string, PriceCodeMeaning>;
  /** Codes with more than one live mapping. Refused, never resolved. */
  conflicted: string[];
  /** How many live statements this house holds for this sender. */
  live: number;
  /** How many it has withdrawn. Kept, never deleted. */
  withdrawn: number;
}

/**
 * Read a set of statements into the map the parser takes.
 *
 * A withdrawn statement is dropped from the map and counted — its meaning stops
 * admitting NEW rows the moment it is withdrawn, while the rows it already
 * admitted stay exactly where they are, marked by the join rather than
 * rewritten.
 */
export function liveMappingsByCode(rows: PriceCodeMapping[]): MappingReadOutcome {
  const byCode: Record<string, PriceCodeMeaning> = {};
  const seen = new Map<string, number>();
  let live = 0;
  let withdrawn = 0;
  for (const r of rows) {
    if (r.withdrawnAt) {
      withdrawn += 1;
      continue;
    }
    live += 1;
    const code = normalisePriceCode(r.priceCode);
    if (!code) continue;
    seen.set(code, (seen.get(code) ?? 0) + 1);
    byCode[code] = {
      mappingId: r.id,
      priceBasis: r.priceBasis,
      declaredByName: r.declaredByName,
      declaredAt: r.declaredAt,
    };
  }
  const conflicted = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([code]) => code)
    .sort();
  // A conflicted code is REMOVED from the map, not resolved by recency. The
  // parser then refuses it as unmapped, which is the correct answer: nobody has
  // told this register which of the two readings is the trade level.
  for (const code of conflicted) delete byCode[code];
  return { byCode, conflicted, live, withdrawn };
}

/**
 * The sentence a row carries about the statement that admitted it, for a panel
 * or a report. Never the only record — the mapping id is on the row.
 */
export function attributionFor(m: PriceCodeMeaning, code: string): string {
  const who = m.declaredByName ? ` by ${m.declaredByName}` : "";
  const when = m.declaredAt ? ` on ${m.declaredAt.slice(0, 10)}` : "";
  return `Priced as "${m.priceBasis}" because this house mapped the sender's code ${code}${who}${when}.`;
}
