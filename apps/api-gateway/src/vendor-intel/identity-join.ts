import {
  IdentityInput,
  IdentityParts,
  buildIdentityKey,
  readIdentity,
} from "./beverage-identity";
import { TRADE_WORDS, normalizeIdentityText } from "./wine-identity";

/**
 * Joining a row to a bottle's identity — the pure half.
 *
 * TWO INSTRUMENTS, AND THE ONE RULE THEY SHARE
 * --------------------------------------------
 *  1. `joinByExactKey` — a GTIN, an LWIN or a source's own item code says
 *     which identity this is. Cheap, and the only thing that ever links a row
 *     without a person.
 *  2. `proposeCandidates` — a normalised producer/name/vintage/size/pack
 *     comparison that produces a SUGGESTION with a confidence and the evidence
 *     behind it.
 *
 * Neither ever merges. `proposeCandidates` has no threshold above which it
 * links: every candidate it returns is `pending` and waits for a person. That
 * is the founder's "no seeded defaults" rule applied to identity, and it is
 * also what the two largest wine databases do — CellarTracker asks the user to
 * attach a scanned barcode to the wine they picked, and Vivino's own page says
 * *"you can submit the label for manual identification. Our team reviews these
 * submissions"* (both read 2026-09-05).
 *
 * WHY AN EXACT KEY IS EVIDENCE AND NOT PROOF
 * ------------------------------------------
 * Measured on the real Iowa Liquor Products file, fetched live 2026-09-05
 * (https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json, 5,425,785 bytes,
 * 13,762 rows, `report_as_of` 2026-09-01 on every one):
 *
 *   upc present on 13,762 / 13,762 rows (100%), every one 12 digits
 *   distinct upc values                              9,118
 *   upcs naming MORE THAN ONE distinct item_no       1,736  (4,069 items)
 *     ... of which the items differ in bottle volume   343
 *     ... of which the items differ in name          1,344
 *   worst single upc                                12 rows
 *
 * One measured example: UPC `081128001032` is published against a 50 ml Van
 * Gogh Fruit Sampler, a 50 ml Van Gogh Dessert Sampler and a 1,000 ml Woodford
 * Reserve Holiday 2026 from a different supplier. A joiner that trusted the
 * code would have priced a bourbon against a liqueur sampler.
 *
 * CellarTracker, with 4.1 million wines, publishes the same finding in words
 * (https://support.cellartracker.com/article/10-about-upc-and-ean-barcodes,
 * read 2026-09-05): *"Many wines do not have UPC/EAN codes"*, *"The same wine
 * can have many barcodes"*, *"In some cases, the same UPC/EAN can be used for
 * many wines ... vintage variations are often glossed over"*, and the verdict
 * *"UPC/EAN is not living up to its full potential when it comes to wine."*
 *
 * So: an unambiguous key joins; an ambiguous key REFUSES and queues one
 * candidate per identity it names, at 1/n confidence. Picking the first would
 * be a coin toss recorded as a fact.
 */

// ---------------------------------------------------------------------------
// Exact keys
// ---------------------------------------------------------------------------

export interface IdentityKeyRow {
  identityId: string;
  keyNamespace: string;
  keyClass: "global_standard" | "source_local";
  keyValue: string;
}

export type ExactJoinOutcome =
  | { outcome: "joined"; identityId: string; namespace: string; reason: string }
  | { outcome: "unknown_key"; namespace: string; reason: string }
  | {
      outcome: "ambiguous";
      namespace: string;
      identityIds: string[];
      /** 1/n — what one of n equally-named identities is worth. */
      confidence: number;
      reason: string;
    };

/**
 * Which identity does this key name?
 *
 * The key rows are passed in rather than read here so this stays testable
 * without a database and so the caller decides the scope of the lookup.
 */
export function joinByExactKey(
  probe: { namespace: string; value: string },
  keys: readonly IdentityKeyRow[],
): ExactJoinOutcome {
  const ns = probe.namespace.trim().toLowerCase();
  const value = probe.value.trim();
  const hits = keys.filter(
    (k) => k.keyNamespace.trim().toLowerCase() === ns && k.keyValue.trim() === value,
  );
  const identityIds = Array.from(new Set(hits.map((h) => h.identityId)));

  if (identityIds.length === 0) {
    return {
      outcome: "unknown_key",
      namespace: ns,
      reason: `No identity in the register carries ${ns} ${value}. That is "not yet recorded", not "no such bottle".`,
    };
  }
  if (identityIds.length === 1) {
    return {
      outcome: "joined",
      identityId: identityIds[0],
      namespace: ns,
      reason: `${ns} ${value} names exactly one identity in the register.`,
    };
  }
  return {
    outcome: "ambiguous",
    namespace: ns,
    identityIds,
    confidence: Number((1 / identityIds.length).toFixed(3)),
    reason: `${ns} ${value} names ${identityIds.length} different identities in the register, so it does not identify this row. Measured on Iowa's own file, 1,736 of 9,118 UPCs do this. A person decides which, or none.`,
  };
}

// ---------------------------------------------------------------------------
// Normalised-key candidates
// ---------------------------------------------------------------------------

export interface RegisteredIdentity extends IdentityParts {
  id: string;
  displayLabel: string;
  /**
   * `library` once Mudavym has promoted it, `provisional` while it is one
   * house's own assertion, `source` when it was transcribed from a published
   * file. Generated in the database, so it cannot drift from the two columns it
   * describes.
   *
   * Optional here because the pure module never needs it to SCORE anything —
   * a provisional identity is exactly as matchable as an official one. It rides
   * along so that whatever renders a candidate can obey the founder's rule of
   * 2026-09-05: a provisional identity is printed as provisional everywhere it
   * appears, never as official.
   */
  standing?: "library" | "provisional" | "source";
  /** The house that asserted it, when it is a house's own. Provenance, kept. */
  assertedForRestaurantId?: string | null;
}

export type PartVerdict = "agreed" | "disagreed" | "unstated";

export interface CandidateEvidence {
  producer: PartVerdict;
  name: PartVerdict;
  vintage: PartVerdict;
  size: PartVerdict;
  pack: PartVerdict;
  /** Jaccard overlap of the name's distinctive tokens, 0..1. */
  nameOverlap: number;
  /** Which parts neither side could state. Why the confidence is capped. */
  unstated: string[];
  subjectKey: string;
  identityKey: string;
}

export interface IdentityCandidate {
  identityId: string;
  /** 0..1. NEVER a licence to merge — see `proposeCandidates`. */
  confidence: number;
  method: "normalised_key";
  evidence: CandidateEvidence;
}

export interface CandidateRefusal {
  /** Why the subject produced no candidates at all. */
  reason:
    | "subject_unreadable"
    | "no_block"
    | "all_disqualified"
    | "below_floor";
  note: string;
}

export interface CandidateRun {
  candidates: IdentityCandidate[];
  /** Populated only when `candidates` is empty, so a silent run can be read. */
  refusal: CandidateRefusal | null;
  scanned: { identities: number; blocked: number; scored: number };
}

/**
 * The floor below which a suggestion is noise rather than a suggestion.
 *
 * Not a merge threshold — there is no merge threshold. This is the point below
 * which putting a row in front of a person costs them more than it saves.
 */
export const CANDIDATE_FLOOR = 0.5;

/**
 * The ceiling for a comparison where one side never stated a part.
 *
 * A producer and a name can agree perfectly and still be two different trade
 * items when one side is silent about size or pack — GS1's rules 2.3 and 2.8
 * make both of those identity, not decoration. Capping is how the score says
 * "this is as good as it can get without the missing fact", instead of
 * reporting a full match on partial evidence.
 */
export const UNSTATED_CEILING = 0.6;

function distinctiveTokens(normalised: string): Set<string> {
  return new Set(
    normalised.split(" ").filter((w) => w.length > 1 && !TRADE_WORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Suggest identities for one subject row. Never links one.
 *
 * THE SHAPE IS THE STANDARD ONE, AND IT IS DELIBERATELY THE STANDARD ONE.
 * Entity resolution research converged on block-then-match a decade ago and
 * still runs on it: SC-Block (arXiv 2303.03132, read 2026-09-05) describes a
 * pipeline as *"a blocker that applies a computationally cheap method to
 * select candidate record pairs"* followed by an expensive matcher, and
 * reports 1.5-2x faster pipelines *"without sacrificing F1 score"* at 99.5%
 * pair completeness. Ditto (arXiv 2004.00584) is the transformer matcher that
 * beats symbolic matching by *"up to 29% of F1"* on the standard benchmarks.
 * WDC Products (arXiv 2301.09521) is the benchmark that added the dimension
 * that matters here — generalisation to entities never seen in training — and
 * its finding is that *"all matching systems struggle with unseen entities to
 * varying degrees"*.
 *
 * WHICH IS WHY THERE IS NO MODEL HERE. Every bottle this register meets is an
 * unseen entity: the estate holds 4,226 library rows and 608 beverages, there
 * is no labelled training pair anywhere in it, and the benchmark says that is
 * precisely the regime where a learned matcher is least trustworthy. A
 * transparent score a person can audit, with the evidence beside it, is worth
 * more here than an opaque one that is right slightly more often — because a
 * person has to confirm every link either way. When there is a confirmed
 * corpus to train on, this function is the thing that produced it.
 *
 * DISQUALIFIERS BEAT SCORES. If both sides state a size and the sizes differ,
 * they are two trade items and no amount of name agreement changes that. Same
 * for pack, and for two different stated vintages. A disqualified pair is not
 * scored low; it is not a candidate.
 */
export function proposeCandidates(
  subject: IdentityInput,
  identities: readonly RegisteredIdentity[],
  opts: { floor?: number; limit?: number } = {},
): CandidateRun {
  const floor = opts.floor ?? CANDIDATE_FLOOR;
  const limit = opts.limit ?? 5;

  const reading = readIdentity(subject);
  if (!reading.ok) {
    return {
      candidates: [],
      refusal: {
        reason: "subject_unreadable",
        note: `The row cannot be read as an identity (${reading.reason}): ${reading.note}`,
      },
      scanned: { identities: identities.length, blocked: 0, scored: 0 },
    };
  }
  const subjectParts: IdentityParts = {
    producerNormalised: reading.producerNormalised,
    nameNormalised: reading.nameNormalised,
    vintageText: reading.vintageText,
    sizeMl: reading.sizeMl,
    pack: reading.pack,
  };
  const subjectKey = buildIdentityKey(subjectParts);
  const subjectProducerTokens = distinctiveTokens(subjectParts.producerNormalised);
  const subjectNameTokens = distinctiveTokens(subjectParts.nameNormalised);

  // BLOCKING. Share at least one distinctive producer word. A producer made
  // entirely of trade words ("The Wine Company") leaves nothing distinctive,
  // and rather than compare it against the whole register it is reported as
  // unblockable — a silent full scan is how a register becomes slow and wrong
  // at the same time.
  const blocked =
    subjectProducerTokens.size === 0
      ? []
      : identities.filter((i) => {
          const t = distinctiveTokens(i.producerNormalised);
          for (const w of subjectProducerTokens) if (t.has(w)) return true;
          return false;
        });

  if (subjectProducerTokens.size === 0) {
    return {
      candidates: [],
      refusal: {
        reason: "no_block",
        note: `"${subject.producer ?? ""}" has no distinctive word once trade words are removed, so it cannot be blocked on. Comparing it against every identity in the register would be a full scan whose best match means nothing.`,
      },
      scanned: { identities: identities.length, blocked: 0, scored: 0 },
    };
  }

  const scored: IdentityCandidate[] = [];
  let disqualified = 0;

  for (const cand of blocked) {
    const unstated: string[] = [];

    // --- disqualifiers -----------------------------------------------------
    const bothVintagesStated =
      subjectParts.vintageText !== "unstated" && cand.vintageText !== "unstated";
    if (bothVintagesStated && subjectParts.vintageText !== cand.vintageText) {
      disqualified += 1;
      continue;
    }
    const bothSizesStated = subjectParts.sizeMl !== null && cand.sizeMl !== null;
    if (bothSizesStated && subjectParts.sizeMl !== cand.sizeMl) {
      disqualified += 1;
      continue;
    }
    const bothPacksStated = subjectParts.pack !== null && cand.pack !== null;
    if (bothPacksStated && subjectParts.pack !== cand.pack) {
      disqualified += 1;
      continue;
    }

    // --- score -------------------------------------------------------------
    const producerExact =
      subjectParts.producerNormalised === cand.producerNormalised;
    const producerOverlap = producerExact
      ? 1
      : jaccard(subjectProducerTokens, distinctiveTokens(cand.producerNormalised));
    const nameOverlap =
      subjectParts.nameNormalised === cand.nameNormalised
        ? 1
        : jaccard(subjectNameTokens, distinctiveTokens(cand.nameNormalised));

    let score = producerOverlap * 0.35 + nameOverlap * 0.4;
    if (bothVintagesStated) score += 0.15;
    else unstated.push("vintage");
    if (bothSizesStated) score += 0.05;
    else unstated.push("size");
    if (bothPacksStated) score += 0.05;
    else unstated.push("pack");

    if (unstated.length > 0) score = Math.min(score, UNSTATED_CEILING);
    const confidence = Number(Math.min(1, Math.max(0, score)).toFixed(3));
    if (confidence < floor) continue;

    scored.push({
      identityId: cand.id,
      confidence,
      method: "normalised_key",
      evidence: {
        producer: producerExact
          ? "agreed"
          : producerOverlap > 0
            ? "agreed"
            : "disagreed",
        name: nameOverlap >= 0.5 ? "agreed" : "disagreed",
        vintage: bothVintagesStated ? "agreed" : "unstated",
        size: bothSizesStated ? "agreed" : "unstated",
        pack: bothPacksStated ? "agreed" : "unstated",
        nameOverlap: Number(nameOverlap.toFixed(3)),
        unstated,
        subjectKey,
        identityKey: buildIdentityKey(cand),
      },
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  const candidates = scored.slice(0, limit);

  let refusal: CandidateRefusal | null = null;
  if (candidates.length === 0) {
    refusal =
      blocked.length === 0
        ? {
            reason: "no_block",
            note: `No identity in the register shares a distinctive producer word with "${subject.producer ?? ""}". The bottle is not in the register; nothing was guessed.`,
          }
        : disqualified === blocked.length
          ? {
              reason: "all_disqualified",
              note: `All ${blocked.length} identities from the same producer state a different vintage, size or pack. Those are different trade items (GS1 GTIN Management Standard 1.1, sections 2.3 and 2.8), not weaker matches.`,
            }
          : {
              reason: "below_floor",
              note: `${blocked.length} identities from the same producer were compared and none reached ${floor}. Showing the best of them would be showing a guess.`,
            };
  }

  return {
    candidates,
    refusal,
    scanned: {
      identities: identities.length,
      blocked: blocked.length,
      scored: scored.length,
    },
  };
}

/**
 * The sentence a reader prints about which key it grouped on.
 *
 * A box that groups by identity for some products and by name for others must
 * SAY which, per group. Otherwise the same page silently answers two different
 * questions and looks like it answered one.
 */
export function describeGroupingKey(
  counts: { identity: number; wine: number; signature: number },
): string {
  const total = counts.identity + counts.wine + counts.signature;
  if (total === 0) return "No sightings were grouped.";
  if (counts.identity === total) {
    return "Every comparison is grouped by confirmed bottle identity, so a size or pack difference cannot be averaged away.";
  }
  if (counts.identity === 0) {
    return "No sighting carries a confirmed identity yet, so every comparison is grouped the old way — by wine and name — and a 375ml and a 750ml of the same wine still land in one group.";
  }
  return `${counts.identity} of ${total} comparisons are grouped by confirmed bottle identity; the remaining ${total - counts.identity} fall back to wine and name, where a size or pack difference is not visible.`;
}

/** Normalise once, here, so callers do not each pick a spelling. */
export function normaliseNamespace(source: string): string {
  return normalizeIdentityText(source).replace(/\s+/g, "-");
}
