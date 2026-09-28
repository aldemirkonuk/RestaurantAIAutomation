/** A seal is issued when review begins; cancelling never submits it. */
export function heldApproval(
  deps: {
    issue: () => Promise<string>;
    approve: (challenge: string) => Promise<void>;
    state: (
      state: "idle" | "holding" | "sending" | "approved",
      error?: string,
    ) => void;
  },
  holdMs = 620,
) {
  let revision = 0;
  let sending = false;
  let approved = false;
  let proof: Promise<string> | null = null;
  const cancel = () => {
    if (sending || approved) return;
    revision += 1;
    proof = null;
    deps.state("idle");
  };
  const confirm = async () => {
    if (!proof || sending) return;
    const current = revision;
    try {
      const challenge = await proof;
      if (current !== revision || sending) return;
      if (!challenge) throw new Error("The approval seal could not be issued.");
      sending = true;
      deps.state("sending");
      await deps.approve(challenge);
      proof = null;
      approved = true;
      deps.state("approved");
    } catch (error) {
      if (current === revision) {
        proof = null;
        deps.state(
          "idle",
          error instanceof Error
            ? error.message
            : "Approval could not be confirmed. Reload the order before trying again.",
        );
      }
    } finally {
      sending = false;
    }
  };
  return {
    begin(timed = true) {
      if (sending || approved) return;
      cancel();
      const current = revision;
      deps.state("holding");
      proof = deps.issue();
      // Handle an early issue refusal even when the person releases first.
      void proof.catch(() => {});
      if (timed)
        setTimeout(() => {
          if (current === revision) void confirm();
        }, holdMs);
    },
    confirm,
    cancel,
  };
}
