import { confirmationVerdict, proposalVerdict } from "./ask-ai-verdict";

describe("proposalVerdict", () => {
  const base = {
    parsed: true,
    declined: false,
    validated: true,
    grounded: true,
  };

  it("calls non-JSON a failure", () => {
    expect(proposalVerdict({ ...base, parsed: false }).outcome).toBe("failure");
  });

  it("does NOT call a correct decline a failure", () => {
    // Grading a correct refusal as failure creates pressure to act anyway,
    // which is the last thing wanted from the component that creates POs.
    const v = proposalVerdict({ ...base, declined: true });
    expect(v.outcome).toBeNull();
    expect(v.evidence?.untestable).toBe("model_declined_out_of_scope_ask");
  });

  it("calls an action outside the allowlist a failure", () => {
    expect(proposalVerdict({ ...base, validated: false }).outcome).toBe(
      "failure",
    );
  });

  it("calls an ungrounded id a failure even though it validated", () => {
    expect(proposalVerdict({ ...base, grounded: false }).outcome).toBe(
      "failure",
    );
  });

  it("separates a decline from a bad parse", () => {
    expect(proposalVerdict({ ...base, declined: true }).outcome).not.toEqual(
      proposalVerdict({ ...base, parsed: false }).outcome,
    );
  });

  it("calls a valid grounded proposal a success", () => {
    expect(proposalVerdict(base).outcome).toBe("success");
  });
});

describe("confirmationVerdict — the honest, deferred verdict", () => {
  it("calls an executed action a success", () => {
    expect(
      confirmationVerdict({ outcome: "executed", executionRef: "order-1" })
        .outcome,
    ).toBe("success");
  });

  it("calls a discard a failure — the operator looked and said no", () => {
    expect(confirmationVerdict({ outcome: "discarded" }).outcome).toBe(
      "failure",
    );
  });

  it("calls an executor failure partial, not failure", () => {
    // The proposal was good enough to accept; the run did not finish. That is
    // not the model's miss and it is not a completed task either.
    const v = confirmationVerdict({
      outcome: "failed",
      failureReason: "no active vendors",
    });
    expect(v.outcome).toBe("partial");
    expect(v.evidence?.failure_reason).toBe("no active vendors");
  });
});
