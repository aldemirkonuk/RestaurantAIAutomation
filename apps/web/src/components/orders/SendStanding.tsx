/**
 * "Send or ask" — what this person's hold on a vendor letter will do, said
 * BEFORE the hold (founder, 2026-09-21: "Staff ask, manager sends").
 *
 * *"An owner, a manager, or a person an owner has granted sends with one hold.
 * When a staff member holds, the letter becomes a REQUEST ... a manager
 * releases it with one hold over that exact text ... the staffer sees who sent
 * it."* Every panel that holds a letter — `/orders` (DraftRail and the legacy
 * DraftEmailApprovalPanel), `/communications` (DraftedReplyPanel) and the
 * thread's own reply box — reads the same gateway field (`sendOrAsk`, beside
 * the draft on `GET orders/:id/draft`) and says it in these same words, so the
 * three surfaces cannot disagree about who may send.
 *
 * Nobody learns their standing from a refusal after the hold any more; the
 * refusal still exists on the gateway, and says the same thing, for the
 * request that gets past a stale page.
 */

import type { CSSProperties } from 'react';
import type {
  DraftSendRequestView,
  SendOrAskDto,
} from '@/hooks/queries/useDraftEmailQueries';

const note: CSSProperties = {
  margin: '6px 0 0',
  fontSize: 11.5,
  lineHeight: 1.5,
  color: 'var(--ink-2, #4F473C)',
};

/** What a hold on this letter does for this viewer, or null while it cannot be said. */
export function holdAct(standing: SendOrAskDto | null | undefined): 'send' | 'ask' | null {
  if (!standing || !standing.readable) return null;
  return standing.maySend ? 'send' : 'ask';
}

function when(iso: string | null | undefined): string {
  if (!iso) return 'at an unrecorded time';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : 'at an unrecorded time';
}

/** "Asked by …" in words, for either reader. */
export function requestWords(
  request: DraftSendRequestView,
  act: 'send' | 'ask' | null,
): string {
  const who = request.requestedByName ?? 'A colleague (their name could not be read)';
  if (!request.current) {
    return `${who} asked for this to be sent ${when(request.requestedAt)}, but the words have changed since, so this is no longer the version they asked for.`;
  }
  if (act === 'send') {
    return `${who} asked for this to be sent ${when(request.requestedAt)}. This is their version, word for word; one hold sends it, and they will see that you did.`;
  }
  return `${who} asked for this to be sent ${when(request.requestedAt)}. It is waiting for a manager. Holding again replaces it with your version.`;
}

/** "Granted by …" wherever a grant is used (ADR 0112 F12; founder, 2026-09-21). */
export function grantWords(grant: NonNullable<SendOrAskDto['grant']>): string {
  const by = grant.grantedBy.name ?? 'an owner (their name could not be read)';
  const until = grant.expiresAt
    ? `until ${new Date(grant.expiresAt).toLocaleDateString()}`
    : 'until an owner revokes it';
  const limit =
    grant.limitAmount === null
      ? 'letters only'
      : `up to ${grant.limitAmount} ${grant.limitCurrency ?? ''} a deal`.trim();
  return `You send under a grant from ${by}, ${until} (${limit}).`;
}

export function SendStandingNote({
  standing,
  request,
  loading,
  error,
  testId = 'send-standing',
}: {
  standing: SendOrAskDto | null | undefined;
  request?: DraftSendRequestView | null;
  loading?: boolean;
  error?: string | null;
  testId?: string;
}) {
  const act = holdAct(standing);
  const lines: string[] = [];
  if (loading) {
    lines.push('Reading whether your hold sends this or asks a manager to…');
  } else if (error) {
    lines.push(
      `Whether your hold sends or asks could not be read (${error}). Nothing can be held until it can.`,
    );
  } else if (standing && !standing.readable) {
    lines.push(standing.sentence ?? 'Whether your hold sends could not be read. Nothing can be held until it can.');
  } else if (standing?.mode === 'ask' && standing.sentence) {
    lines.push(standing.sentence);
  } else if (standing?.basis === 'grant' && standing.grant) {
    lines.push(grantWords(standing.grant));
  }
  if (request) lines.push(requestWords(request, act));
  if (lines.length === 0) return null;
  return (
    <div data-testid={testId} data-act={act ?? 'unknown'} role="status">
      {lines.map((line) => (
        <p key={line} style={note}>
          {line}
        </p>
      ))}
    </div>
  );
}
