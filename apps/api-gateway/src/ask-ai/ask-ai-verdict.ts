import { NfVerdict } from "../common/model-client/nf-verdict.service";

export {
  PROPOSAL_BASIS,
  CONFIRMATION_BASIS,
} from "../common/model-client/verdict-bases";

/**
 * Grade one Ask AI proposal at the moment it is made (`proposal_v1`).
 *
 * The distinctions are not cosmetic — they separate three failures that a
 * `call_level_v0` reading would have recorded identically as `success`:
 *
 *  - the model returned prose instead of an action,
 *  - it returned a well-formed action that is not on the allowlist,
 *  - it returned an allowlisted action referring to ids nobody gave it.
 *
 * The third is the dangerous one, and it is the reason `grounded` is a separate
 * input rather than folded into validation.
 *
 * A model that correctly DECLINES — "I can't do that yet" for an ask outside
 * the two MVP families — is `null`, not `failure`. Same rule P3.0 applied to
 * the photo counter: grading a correct refusal as failure creates pressure to
 * act anyway, which is the last thing wanted from the component that creates
 * purchase orders.
 */
export function proposalVerdict(input: {
  parsed: boolean;
  declined: boolean;
  validated: boolean;
  grounded: boolean;
  rejectionReason?: string;
}): NfVerdict {
  const evidence: Record<string, unknown> = {
    parsed: input.parsed,
    declined: input.declined,
    validated: input.validated,
    grounded: input.grounded,
    ...(input.rejectionReason ? { rejection: input.rejectionReason } : {}),
  };

  if (!input.parsed) {
    return { outcome: "failure", evidence };
  }

  if (input.declined) {
    return {
      outcome: null,
      evidence: { ...evidence, untestable: "model_declined_out_of_scope_ask" },
    };
  }

  if (!input.validated || !input.grounded) {
    return { outcome: "failure", evidence };
  }

  return { outcome: "success", evidence };
}

/**
 * Grade the proposal again once a human has ruled on it (`confirmation_v1`).
 *
 * This is the honest verdict on Ask AI and it can only be deferred: a proposal
 * stream nobody confirms is a feature that is running, not working, and no
 * amount of shape-checking at propose time can tell the difference.
 *
 * `discarded` is `failure` — the operator looked at what was offered and said
 * no. That is the signal worth having, uncomfortable as it is to record.
 */
export function confirmationVerdict(input: {
  outcome: "executed" | "discarded" | "failed";
  executionRef?: string | null;
  failureReason?: string | null;
}): NfVerdict {
  const evidence: Record<string, unknown> = {
    resolution: input.outcome,
    ...(input.executionRef ? { execution_ref: input.executionRef } : {}),
    ...(input.failureReason ? { failure_reason: input.failureReason } : {}),
  };

  if (input.outcome === "executed") return { outcome: "success", evidence };

  // A confirmed action whose EXECUTOR failed is not the model's miss. It is
  // still not a completed task, so it is not `success` — `partial` says the
  // proposal was good enough to accept and the run did not finish.
  if (input.outcome === "failed") return { outcome: "partial", evidence };

  return { outcome: "failure", evidence };
}
