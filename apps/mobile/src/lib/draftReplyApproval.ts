import { heldApproval } from './heldApproval';

interface Scope { userId: string; restaurantId: string }
type Request = (path: string, options: { method: 'POST'; scope: Scope; body: unknown; sealChallenge?: string }) => Promise<any>;

/** The held letter and its scope stay in memory; no outbox receives a proof. */
export function draftReplyApproval(input: {
  orderId: string; body: string; recipient: string; scope: Scope;
  request: Request; onApproved: () => Promise<void>;
  state: (phase: 'idle' | 'holding' | 'sending' | 'approved', message?: string) => void;
}) {
  const scope = { ...input.scope };
  const { orderId, body, recipient } = input;
  return heldApproval({
    issue: async () => {
      if (!scope.userId || !scope.restaurantId || !body.trim() || !recipient.trim())
        throw new Error('Review a letter and recipient in an unlocked branch before sending.');
      const result = await input.request(`/procurement/orders/${orderId}/draft-seal-challenge`, {
        method: 'POST', scope, body: { content: body, to: recipient, ccEmails: [] },
      });
      return result.challenge;
    },
    approve: async (challenge) => {
      try {
        await input.request(`/procurement/orders/${orderId}/approve-draft`, {
          method: 'POST', scope, body: { modifiedContent: body, ccEmails: [] }, sealChallenge: challenge,
        });
      } catch (error) {
        throw new Error(`The send could not be confirmed. Check the conversation before trying again: ${error instanceof Error ? error.message : 'no receipt returned'}`);
      }
      await input.onApproved();
    },
    state: input.state,
  });
}
