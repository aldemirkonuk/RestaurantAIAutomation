import { NfVerdict } from "../common/model-client/nf-verdict.service";

export { GROUNDING_BASIS } from "../common/model-client/verdict-bases";

/**
 * The five kinds the system prompt allows — *"You may only propose changes of
 * kind: copy | default | surface | affordance | layout"* (OD-59, P3.0).
 *
 * The prompt constrained this from the start; the parser accepted any string
 * and wrote it straight into `ux_proposals.kind`. A model answering
 * `"kind": "workflow"` produced a row no consumer knows how to render, and
 * nothing anywhere said so.
 */
export const PROPOSAL_KINDS = [
  "copy",
  "default",
  "surface",
  "affordance",
  "layout",
] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

const KINDS = new Set<string>(PROPOSAL_KINDS);

export function isProposalKind(k: unknown): k is ProposalKind {
  return typeof k === "string" && KINDS.has(k);
}

export interface ProposalFilterResult {
  kept: any[];
  /** Rows dropped for a `kind` outside the prompt's own enum. */
  droppedKinds: string[];
  /** Rows dropped for missing targetKey/title/kind — the pre-existing filter. */
  droppedIncomplete: number;
}

/**
 * Apply the prompt's own contract to the model's output.
 *
 * The incomplete-row filter already existed. What is new is the `kind` check:
 * the prompt names five values and the parser took any string, so an invented
 * kind was persisted as though it were real.
 */
export function filterProposals(raw: unknown[]): ProposalFilterResult {
  const kept: any[] = [];
  const droppedKinds: string[] = [];
  let droppedIncomplete = 0;

  for (const p of raw) {
    const row = p as any;
    if (!row?.targetKey || !row?.title || !row?.kind) {
      droppedIncomplete++;
      continue;
    }
    if (!isProposalKind(row.kind)) {
      droppedKinds.push(String(row.kind));
      continue;
    }
    kept.push(row);
  }

  return { kept, droppedKinds, droppedIncomplete };
}

/**
 * Grade one UX-proposal call.
 *
 * Correctness here — "did this proposal actually reduce friction" — is an A/B
 * outcome deferred by weeks, and the module never auto-applies anything, so it
 * is human-gated as well. Grounding is the honest machine claim: the output
 * parsed, and it obeyed the constraint the prompt actually stated.
 */
export function uxProposalVerdict(input: {
  parsed: boolean;
  filter: ProposalFilterResult | null;
  rawCount: number;
}): NfVerdict {
  if (!input.parsed || !input.filter) {
    return { outcome: "failure", evidence: { parsed: false } };
  }

  const f = input.filter;
  const evidence: Record<string, unknown> = {
    raw_proposals: input.rawCount,
    kept: f.kept.length,
    dropped_invalid_kind: f.droppedKinds,
    dropped_incomplete: f.droppedIncomplete,
  };

  // Parsed, and nothing usable survived: the call produced no artifact, which
  // `call_level_v0` has always recorded as a success.
  if (f.kept.length === 0) return { outcome: "failure", evidence };

  if (f.droppedKinds.length > 0 || f.droppedIncomplete > 0) {
    return { outcome: "partial", evidence };
  }

  return { outcome: "success", evidence };
}
