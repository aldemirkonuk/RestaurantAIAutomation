import { NfVerdict } from "../common/model-client/nf-verdict.service";

export { GROUNDING_BASIS } from "../common/model-client/verdict-bases";

/** The requested claim count, straight from the system prompt. */
export const MIN_CLAIMS = 3;
export const MAX_CLAIMS = 8;

/**
 * A claim whose `evidence_refs` all point at evidence categories that were
 * never supplied is machine-detectably wrong (OD-59, P3.0).
 *
 * The prompt's HARD RULE 2 requires every claim to carry `evidence_refs` as
 * JSON paths into the evidence pack — `"risk.vendorConcentration.hhi"`,
 * `"templateInsights[2].sentence"`. Nothing checked them. A consultant could
 * cite `pos.tables.turnover` on a restaurant with no POS data and the claim
 * reached the owner looking exactly as authoritative as a grounded one.
 *
 * ## What is checked, and what deliberately is not
 *
 * Only the ROOT segment of each path, against the categories actually put in
 * the pack. Resolving the whole path would be stricter and wrong: a path into a
 * nested field that happens to be absent is how HARD RULE 6 tells the model to
 * report thin evidence, so full resolution would punish the honest answer.
 *
 * ## The thin-evidence carve-out
 *
 * HARD RULE 6: *"If evidence is too thin for your discipline, return exactly
 * one claim stating that, confidence ≤ 0.3, evidence_refs listing what was
 * missing."* Refs naming what was MISSING cannot resolve by construction. A
 * single low-confidence claim is therefore exempt — otherwise the check would
 * delete the one answer the prompt explicitly asks for when data is thin, and
 * the deletion would look like a working guardrail.
 */
export function rootOf(ref: unknown): string | null {
  if (typeof ref !== "string") return null;
  const root = ref.trim().split(/[.[]/)[0];
  return root.length > 0 ? root : null;
}

export interface GroundingResult {
  /** Claims that survive the check, in their original order. */
  claims: any[];
  /** Claims dropped because no ref named a supplied evidence category. */
  dropped: Array<{ claim: unknown; refs: unknown }>;
  /** True when the thin-evidence carve-out applied. */
  thinEvidenceExempt: boolean;
  /** Roots the model cited that were never supplied, de-duplicated. */
  unknownRoots: string[];
}

export function checkGrounding(
  claims: any[],
  evidenceCategories: string[],
): GroundingResult {
  const supplied = new Set(evidenceCategories);
  const unknown = new Set<string>();

  const thinEvidenceExempt =
    claims.length === 1 &&
    typeof claims[0]?.confidence === "number" &&
    claims[0].confidence <= 0.3;

  const kept: any[] = [];
  const dropped: Array<{ claim: unknown; refs: unknown }> = [];

  for (const c of claims) {
    const refs = Array.isArray(c?.evidence_refs) ? c.evidence_refs : [];
    const roots = refs.map(rootOf).filter((r): r is string => r !== null);
    for (const r of roots) if (!supplied.has(r)) unknown.add(r);

    const grounded = roots.some((r) => supplied.has(r));
    if (grounded || thinEvidenceExempt) kept.push(c);
    else dropped.push({ claim: c?.claim, refs: c?.evidence_refs });
  }

  return {
    claims: kept,
    dropped,
    thinEvidenceExempt,
    unknownRoots: [...unknown],
  };
}

/**
 * Grade one consultant call.
 *
 * `grounding_v1` is stronger than `schema_v1` and still nowhere near
 * correctness: it proves the model cited evidence it was actually given, not
 * that the interpretation is right. Anything past that genuinely needs a human
 * rubric, and the service's own disclaimer says so.
 */
export function consultantVerdict(input: {
  refused: boolean;
  parsed: boolean;
  grounding: GroundingResult | null;
}): NfVerdict {
  if (input.refused) {
    return { outcome: "failure", evidence: { refused: true } };
  }
  if (!input.parsed || !input.grounding) {
    return { outcome: "failure", evidence: { parsed: false } };
  }

  const g = input.grounding;
  const evidence: Record<string, unknown> = {
    claims_kept: g.claims.length,
    claims_dropped: g.dropped.length,
    unknown_evidence_roots: g.unknownRoots,
    thin_evidence_exempt: g.thinEvidenceExempt,
  };

  // Every claim ungrounded is not a shape problem — the model answered, and
  // answered about evidence nobody gave it.
  if (g.claims.length === 0) return { outcome: "failure", evidence };

  if (g.dropped.length > 0) return { outcome: "partial", evidence };

  // Count is the prompt's own contract, so a violation is the model ignoring an
  // instruction rather than an ambiguity — but it produced usable claims, so
  // `partial` rather than `failure`.
  if (g.claims.length < MIN_CLAIMS || g.claims.length > MAX_CLAIMS) {
    return {
      outcome: "partial",
      evidence: { ...evidence, count_outside_requested_range: true },
    };
  }

  return { outcome: "success", evidence };
}
