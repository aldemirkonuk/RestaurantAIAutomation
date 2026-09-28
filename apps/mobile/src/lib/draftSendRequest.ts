import { heldApproval } from "./heldApproval";

interface Scope { userId: string; restaurantId: string }
type Request = (path: string, options: { method: "POST"; scope: Scope; body: unknown }) => Promise<any>;

/**
 * A staff member's hold on the phone: the letter becomes a REQUEST (founder,
 * 2026-09-21). The same hold gesture as a send, but nothing is minted — a
 * request spends no seal, because nothing leaves the house — and the approve
 * step records the request: the exact words shown become the version, and the
 * owners and managers are told. The gateway's own sentence comes back to the
 * screen.
 *
 * Built on `heldApproval` so a released or cancelled hold asks nothing, the
 * same as a cancelled send sends nothing.
 */
export function draftSendRequest(input: {
  orderId: string;
  body: string;
  ccEmails?: string[];
  scope: Scope;
  request: Request;
  onAsked: (says: string) => Promise<void> | void;
  state: (phase: "idle" | "holding" | "sending" | "approved", message?: string) => void;
}) {
  const scope = { ...input.scope };
  const { orderId, body } = input;
  const ccEmails = [...(input.ccEmails ?? [])];
  return heldApproval({
    // No seal: the hold's token here is only the gesture completing.
    issue: async () => {
      if (!scope.userId || !scope.restaurantId || !body.trim())
        throw new Error("Review a letter in an unlocked branch before asking.");
      return "ask";
    },
    approve: async () => {
      let out: any;
      try {
        out = await input.request(`/procurement/orders/${orderId}/draft-send-request`, {
          method: "POST",
          scope,
          body: { content: body, ccEmails },
        });
      } catch (error) {
        throw new Error(
          `Nobody was asked, and nothing was sent: ${error instanceof Error ? error.message : "no reason given"}`,
        );
      }
      await input.onAsked(typeof out?.says === "string" ? out.says : "Asked. Nothing has been sent.");
    },
    state: input.state,
  });
}
