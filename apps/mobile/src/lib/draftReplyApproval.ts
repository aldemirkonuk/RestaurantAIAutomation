import { heldApproval } from './heldApproval';

interface Scope { userId: string; restaurantId: string }

/**
 * Duck-typed rather than `error instanceof ApiError`: this module is pure,
 * native-import-free logic (no `react-native`, no `expo-*`), tested with a
 * plain ts-jest transform that cannot parse `../api/client`'s own imports.
 * `ApiError`'s shape (`status: number` on an `Error`) is all that is needed.
 */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}
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
        // A seal refusal (403) is not a timeout or a dropped response — the
        // gateway definitely refused, so the letter definitely did not go
        // (lane E audit D9: this used to fold both into the same "could not
        // be confirmed" sentence, which reads as "maybe sent" for a refusal
        // that never reached the vendor).
        if (statusOf(error) === 403) {
          const detail = error instanceof Error ? error.message : 'no reason given';
          throw new Error(`The hold was refused, so nothing was sent: ${detail}`);
        }
        throw new Error(`The send could not be confirmed. Check the conversation before trying again: ${error instanceof Error ? error.message : 'no receipt returned'}`);
      }
      await input.onApproved();
    },
    state: input.state,
  });
}
