/**
 * How big a decision an uploaded price book actually is — the arithmetic, pure.
 *
 * ===========================================================================
 * WHY A TIER AND NOT A RULE
 * ===========================================================================
 * The founder's words, 2026-09-05: *"Yes, it needs an approval however we can't
 * wait 2 people to approve a small decision, or a big one."* Both halves are
 * constraints. An approval is needed; waiting for two people on every book is
 * not acceptable; and — the half that is easy to miss — waiting for two people
 * on a BIG one is not acceptable either when there is no second person to wait
 * for. Measured on production the same day (see ADR 0128): of the fifteen
 * houses, TEN have one owner-or-manager or none, and of the eight jurisdictions
 * this estate resolves to, FIVE have exactly one person who could ever sign
 * anything. A rule that says "always two" is, for most of this estate, a rule
 * that says "never".
 *
 * So the question this file answers is not "who approves" but "how big is
 * this?", and it answers it from the book itself.
 *
 * ===========================================================================
 * WHAT A TIER CAN AND CANNOT DEFEND AGAINST — stated before the constants,
 * because the constants are worthless if this is misread
 * ===========================================================================
 * A doctored workbook that moves ONE bottle's price by thirty percent is
 * 1 row in 12,530 (the measured row count of the real MLCC book). No share
 * band, no median, no row-count check will ever see it. Neither will a second
 * human being: nobody reads 12,530 rows.
 *
 * Therefore:
 *
 *  * The tier is a **sizing** control, not a fraud detector. It catches the
 *    faults that are common, detectable and estate-wide: the wrong book, the
 *    wrong state, a mangled parse, a bulk rewrite, and the FIRST book — which
 *    has no baseline at all, so every comparison below is vacuous for it.
 *  * `oneMovedALot` is the exception and the only tripwire aimed at a targeted
 *    edit: a forged price that is worth forging has to move a long way, and a
 *    single large move is visible even when the aggregate is not.
 *  * The defence against a doctored book stays what ADR 0117 said it was:
 *    provenance. The row names the person and carries the sha256, so anyone can
 *    re-download that edition and compare byte for byte. That comparison is
 *    what a confirming second person should actually DO, which is why the
 *    confirm route accepts the bytes as evidence and records that it did
 *    (`byte_match`) rather than treating a click as proof.
 *
 * ===========================================================================
 * THE BANDS ARE NOT MEASURED, AND THIS FILE SAYS SO
 * ===========================================================================
 * Setting these numbers from evidence needs two real consecutive editions of a
 * state book. This repository holds ONE (the 2025-08-03 MLCC workbook), so the
 * natural quarter-over-quarter movement of a posted list is UNMEASURED here.
 * Every constant below is therefore reasoned, not measured, and says which.
 * `EditionDiff` records the real numbers for every book that is ever uploaded,
 * so the second edition replaces the reasoning with evidence rather than
 * confirming it. A founder question in ADR 0128 asks for the bands.
 *
 * Nothing here touches a database, Nest, or the clock.
 */

import type { PostingSighting } from "./price-index.types";

/**
 * ROUTINE: one person's upload stands, with provenance, and the other owners
 * and managers in the jurisdiction are TOLD.
 *
 * SECOND_PAIR_OF_EYES: the rows are written but held out of the market until
 * somebody confirms. Named for what it asks for rather than for a severity
 * word, because the sentence a manager reads is "this book is waiting for a
 * second pair of eyes", and a status called `high` would have to be translated
 * into that sentence somewhere else.
 */
export type UploadTier = "routine" | "second_pair_of_eyes";

export type TierReason =
  /** No confirmed edition of this book exists yet, so nothing can be compared. */
  | "first_book"
  /** The catalogue grew or shrank past `CATALOGUE_SHIFT_LIMIT`. */
  | "catalogue_size_moved"
  /** More of the book moved than `MOVED_SHARE_LIMIT`. */
  | "most_of_the_book_moved"
  /** The typical item moved more than `MEDIAN_MOVE_LIMIT`. */
  | "the_middle_of_the_book_moved"
  /** One item moved more than `SINGLE_MOVE_LIMIT`. */
  | "one_price_moved_a_lot"
  /** The comparison could not be made. Never read as "nothing changed". */
  | "diff_untestable";

/**
 * A price move smaller than this is noise, not a change: rounding in the
 * issuer's own sheet, a cent moved by a container-deposit revision. Reasoned:
 * one percent of a spirits case price is a few cents, below any decision.
 */
export const MOVE_NOISE = 0.01;

/**
 * How far the catalogue may grow or shrink between editions before the book is
 * a different book rather than a new edition of the same one.
 *
 * Reasoned at 20 percent. The measured MLCC book carries 12,530 product rows;
 * a fifth of that is 2,506 products appearing or vanishing in one quarter,
 * which no state repricing does. UNMEASURED against a second real edition.
 */
export const CATALOGUE_SHIFT_LIMIT = 0.2;

/**
 * What share of the items present in BOTH editions may move at all.
 *
 * Reasoned at 25 percent: a posted wholesale list is a schedule, and a schedule
 * that repriced a quarter of its catalogue in one quarter is either a policy
 * change worth a person looking, or the wrong file. UNMEASURED.
 */
export const MOVED_SHARE_LIMIT = 0.25;

/**
 * How far the MIDDLE item may move. The median rather than the mean, because a
 * mean is moved by one outlier and this band exists to detect a shift of the
 * whole book, which `SINGLE_MOVE_LIMIT` deliberately does not. Reasoned at
 * 5 percent. UNMEASURED.
 */
export const MEDIAN_MOVE_LIMIT = 0.05;

/**
 * The tripwire on the extreme: any single item moving more than half again, or
 * losing more than a third, of what it cost last edition.
 *
 * This is the only band here that a targeted forgery has to clear, so it is
 * deliberately the tightest, and the diff NAMES the item that moved most
 * whether or not it trips — a manager who sees "the biggest move in this book:
 * X, +42%" has the fact even when the tier is routine. Reasoned at 50 percent.
 * UNMEASURED.
 */
export const SINGLE_MOVE_LIMIT = 0.5;

/**
 * The most items a fingerprint will carry. Michigan's book is 12,530; four
 * times that is headroom for a bigger state without letting one upload write an
 * unbounded JSONB. Past the cap the fingerprint is refused rather than
 * truncated — a truncated baseline would make the NEXT edition's diff quietly
 * wrong, which is worse than having no baseline and saying so.
 */
export const FINGERPRINT_CAP = 50_000;

/** Price by stable item key, for one edition. The baseline for the next one. */
export type PriceFingerprint = Record<string, number>;

/**
 * The key an item keeps ACROSS editions.
 *
 * Not `sourceRef`: the Michigan parser builds that as
 * `mlcc:price-book:<issuedAt>#liquor_code=<code>`, so it is unique per edition
 * by construction and every item would read as new every quarter. The issuer's
 * own product id is the identity that survives a reprint; where a source states
 * none, the name and the package are the fallback and the fallback is stated
 * rather than silently assumed to be as good.
 */
export function fingerprintKey(s: PostingSighting): string {
  const ids = Object.entries(s.externalIds ?? {})
    .filter(([, v]) => typeof v === "string" && v.trim() !== "")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (ids.length > 0) return `${ids[0][0]}=${ids[0][1].trim()}`;
  return [
    s.productName.trim().toLowerCase(),
    s.sizeValue ?? "",
    (s.sizeUnit ?? "").toLowerCase(),
    s.pack ?? "",
    s.priceBasis.trim().toLowerCase(),
  ].join("|");
}

/**
 * The fingerprint of one edition, or a refusal.
 *
 * A duplicate key keeps the FIRST price seen and counts the collision, rather
 * than letting the last row silently win: Iowa's book carries 2,308 duplicate
 * item codes (ADR 0117), so a source that duplicates is a real case and the
 * count is what tells a reader the fingerprint is thinner than the row count.
 */
export function fingerprintOf(sightings: PostingSighting[]): {
  fingerprint: PriceFingerprint | null;
  items: number;
  duplicateKeys: number;
  refusedBecause: string | null;
} {
  if (sightings.length > FINGERPRINT_CAP) {
    return {
      fingerprint: null,
      items: 0,
      duplicateKeys: 0,
      refusedBecause: `this book has ${sightings.length} rows, past the ${FINGERPRINT_CAP}-item ceiling for a comparison baseline. No baseline is kept rather than a truncated one, which would make the next edition's comparison quietly wrong.`,
    };
  }
  const fingerprint: PriceFingerprint = {};
  let duplicateKeys = 0;
  for (const s of sightings) {
    const key = fingerprintKey(s);
    if (Object.prototype.hasOwnProperty.call(fingerprint, key)) {
      duplicateKeys += 1;
      continue;
    }
    fingerprint[key] = s.price;
  }
  return {
    fingerprint,
    items: Object.keys(fingerprint).length,
    duplicateKeys,
    refusedBecause: null,
  };
}

/** What one edition looks like beside the last confirmed one. */
export interface EditionDiff {
  /** False when there is no baseline, or one side could not be fingerprinted. */
  comparable: boolean;
  /** Why not, in a sentence. Null when it is comparable. */
  incomparableBecause: string | null;
  priorEditionDate: string | null;
  priorItems: number | null;
  items: number;
  /** Items present in both editions. */
  matched: number;
  /** In this edition and not the last. */
  added: number;
  /** In the last edition and not this one. */
  dropped: number;
  /** Of `matched`, those that moved beyond `MOVE_NOISE`. */
  moved: number;
  /** `moved / matched`, or null when nothing could be matched. */
  movedShare: number | null;
  /** The median |move| across matched items, or null. */
  medianAbsMove: number | null;
  /** The largest |move|, and the item it belongs to. */
  maxAbsMove: number | null;
  maxAbsMoveKey: string | null;
  /** `(items - priorItems) / priorItems`, or null with no baseline. */
  catalogueShift: number | null;
}

const EMPTY_DIFF: EditionDiff = {
  comparable: false,
  incomparableBecause: null,
  priorEditionDate: null,
  priorItems: null,
  items: 0,
  matched: 0,
  added: 0,
  dropped: 0,
  moved: 0,
  movedShare: null,
  medianAbsMove: null,
  maxAbsMove: null,
  maxAbsMoveKey: null,
  catalogueShift: null,
};

/** The median of a sorted-in-place copy. Empty is null, never 0. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Compare this edition with the last CONFIRMED one.
 *
 * A prior price of zero or less is skipped rather than divided by: a relative
 * move against nothing is infinity, and an infinity in a band check would trip
 * every book that ever contained a free case.
 */
export function diffEditions(
  prior: { fingerprint: PriceFingerprint; editionDate: string } | null,
  next: PriceFingerprint | null,
): EditionDiff {
  if (!next) {
    return {
      ...EMPTY_DIFF,
      incomparableBecause:
        "this book could not be fingerprinted, so it cannot be compared with the last one.",
    };
  }
  const items = Object.keys(next).length;
  if (!prior) {
    return {
      ...EMPTY_DIFF,
      items,
      incomparableBecause:
        "no confirmed edition of this book is on record, so there is nothing to compare it with.",
    };
  }

  const priorKeys = Object.keys(prior.fingerprint);
  const moves: number[] = [];
  let matched = 0;
  let moved = 0;
  let maxAbsMove: number | null = null;
  let maxAbsMoveKey: string | null = null;

  for (const key of Object.keys(next)) {
    const before = prior.fingerprint[key];
    if (typeof before !== "number" || before <= 0) continue;
    matched += 1;
    const move = (next[key] - before) / before;
    const abs = Math.abs(move);
    moves.push(abs);
    if (abs > MOVE_NOISE) moved += 1;
    if (maxAbsMove === null || abs > maxAbsMove) {
      maxAbsMove = abs;
      maxAbsMoveKey = key;
    }
  }

  const added = items - matched;
  const dropped = priorKeys.filter(
    (k) => !Object.prototype.hasOwnProperty.call(next, k),
  ).length;

  return {
    comparable: true,
    incomparableBecause: null,
    priorEditionDate: prior.editionDate,
    priorItems: priorKeys.length,
    items,
    matched,
    added,
    dropped,
    moved,
    movedShare: matched > 0 ? moved / matched : null,
    medianAbsMove: median(moves),
    maxAbsMove,
    maxAbsMoveKey,
    catalogueShift:
      priorKeys.length > 0 ? (items - priorKeys.length) / priorKeys.length : null,
  };
}

export interface TierVerdict {
  tier: UploadTier;
  reasons: TierReason[];
  /** One sentence per reason, for the person who is now waiting. */
  sentences: string[];
}

/**
 * Which tier this book is, and why in those words.
 *
 * EVERY band is tested and every one that trips is recorded — not the first
 * match. "This book is held because it is the first one" and "…because a
 * quarter of it moved" are two different facts and a reader who is told only
 * the first will fix the wrong thing.
 *
 * An UNCOMPARABLE diff is `second_pair_of_eyes`, never routine. A comparison
 * that could not be made is not a comparison that passed; reading it as one is
 * the absence-reported-as-health inversion arriving through the door that puts
 * numbers on three houses' screens.
 */
export function chooseTier(diff: EditionDiff): TierVerdict {
  const reasons: TierReason[] = [];
  const sentences: string[] = [];
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

  if (!diff.comparable) {
    const firstBook =
      diff.incomparableBecause?.startsWith("no confirmed edition") ?? false;
    reasons.push(firstBook ? "first_book" : "diff_untestable");
    sentences.push(
      firstBook
        ? "This is the first edition of this book the register has ever held, so there is no previous one to weigh it against. Every check below compares editions, and none of them can say anything about this one."
        : `The comparison with the last edition could not be made: ${diff.incomparableBecause ?? "no reason was recorded."} A comparison that could not be made is not a comparison that passed.`,
    );
    return { tier: "second_pair_of_eyes", reasons, sentences };
  }

  if (
    diff.catalogueShift !== null &&
    Math.abs(diff.catalogueShift) > CATALOGUE_SHIFT_LIMIT
  ) {
    reasons.push("catalogue_size_moved");
    sentences.push(
      `The catalogue moved from ${diff.priorItems} items to ${diff.items} (${pct(diff.catalogueShift)}), past the ${pct(CATALOGUE_SHIFT_LIMIT)} a new edition of the same book is expected to stay within.`,
    );
  }
  if (diff.movedShare !== null && diff.movedShare > MOVED_SHARE_LIMIT) {
    reasons.push("most_of_the_book_moved");
    sentences.push(
      `${diff.moved} of the ${diff.matched} items in both editions changed price (${pct(diff.movedShare)}), past the ${pct(MOVED_SHARE_LIMIT)} band.`,
    );
  }
  if (diff.medianAbsMove !== null && diff.medianAbsMove > MEDIAN_MOVE_LIMIT) {
    reasons.push("the_middle_of_the_book_moved");
    sentences.push(
      `The middle item moved ${pct(diff.medianAbsMove)}, past the ${pct(MEDIAN_MOVE_LIMIT)} band. That is the whole book shifting, not one price.`,
    );
  }
  if (diff.maxAbsMove !== null && diff.maxAbsMove > SINGLE_MOVE_LIMIT) {
    reasons.push("one_price_moved_a_lot");
    sentences.push(
      `One item moved ${pct(diff.maxAbsMove)} (${diff.maxAbsMoveKey}), past the ${pct(SINGLE_MOVE_LIMIT)} band. A single large move is the one shape a targeted edit cannot hide behind an average.`,
    );
  }

  return {
    tier: reasons.length > 0 ? "second_pair_of_eyes" : "routine",
    reasons,
    sentences,
  };
}

/**
 * The one line that says what this book looked like, tier or no tier.
 *
 * Deliberately produced for a ROUTINE book too. The biggest move in a book is a
 * fact a manager should have whether or not a band tripped, and a summary that
 * only appears when something is wrong teaches people that its absence means
 * everything was checked.
 */
export function diffSentence(diff: EditionDiff): string {
  if (!diff.comparable) {
    return (
      diff.incomparableBecause ??
      "This book could not be compared with a previous edition."
    );
  }
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const parts = [
    `Against the ${diff.priorEditionDate} edition: ${diff.matched} items in both, ${diff.added} new, ${diff.dropped} gone.`,
    diff.movedShare === null
      ? "No item could be matched between the two editions, so no price move was measured."
      : `${diff.moved} changed price (${pct(diff.movedShare)}), the middle one by ${diff.medianAbsMove === null ? "an unmeasured amount" : pct(diff.medianAbsMove)}.`,
  ];
  if (diff.maxAbsMove !== null && diff.maxAbsMoveKey) {
    parts.push(
      `The biggest move in this book: ${diff.maxAbsMoveKey}, ${pct(diff.maxAbsMove)}.`,
    );
  }
  return parts.join(" ");
}
