/**
 * F-678: an approval is sealed with a one-time challenge the server issues at
 * the hold, so it cannot wait in the outbox and send later. Offline, the hold
 * used to show the raw "Network request failed". It now says, in plain
 * words, that nothing was approved — or, when the connection dropped after
 * the approval was sent, that the answer is unknown.
 */
export const OFFLINE_REFUSAL =
  "No connection, so this order was not approved. Approving needs a connection and is never saved for later. Hold again once you're back online.";
export const UNCERTAIN_APPROVAL =
  "The connection dropped before we heard back. Reload the order to see whether it was approved before you hold again.";

/** fetch rejects with a TypeError offline, and the client aborts on timeout. */
function isConnectionFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/**
 * F-830 (the phone's half of F-775): the gateway answers 409 with reason
 * `order_already_approved` when a second manager or a stale screen holds an
 * order someone already approved. The order IS approved — the outcome the
 * person wanted — so this is settled, not an error. Read structurally: a
 * proxy can answer 409 with a page, and only the named reason is believed.
 */
export function isAlreadyApproved(error: unknown): boolean {
  const e = error as { status?: unknown; body?: unknown } | null;
  if (!e || e.status !== 409) return false;
  const body = e.body as { reason?: unknown } | null | undefined;
  return !!body && typeof body === "object" && body.reason === "order_already_approved";
}

/** Send the approval; an "already approved" refusal settles the same way. */
export async function approveOrSettle(
  send: () => Promise<unknown>,
  settle: () => Promise<void> | void,
): Promise<void> {
  try {
    await send();
  } catch (error) {
    if (!isAlreadyApproved(error)) throw error;
  }
  await settle();
}

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
          isConnectionFailure(error)
            ? sending
              ? UNCERTAIN_APPROVAL
              : OFFLINE_REFUSAL
            : error instanceof Error
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
