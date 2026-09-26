/**
 * Letters a staff member asked a manager to send — the founder's answer (3) of
 * 2026-09-21: *"staff may ASK a manager to confirm a deal or to send a
 * composer letter, with the same request flow as drafted replies (request
 * state, exact text/terms saved, manager releases with one hold)"*.
 *
 * - An owner or a manager sees every waiting letter and releases one with ONE
 *   HOLD: the hold mints the composer's seal over the exact letter that was
 *   asked for, and the release queues it with the request's id, so it keeps
 *   the composer's undo window (answer 7) and can be released only once.
 * - Anyone else sees only their own waiting letters, and nothing to release.
 * - A failed read is "could not be read", never "nothing waiting".
 * - Decline, withdraw, and an undone release (founder, 2026-09-21, verbatim:
 *   "Decline/withdraw; undo re-waits"): an owner or a manager declines a
 *   waiting letter with a reason the person who asked reads; that person may
 *   withdraw their own. A manager who just released one can pull it back from
 *   here while its undo window is open; a letter pulled back comes back here as
 *   waiting, and says so.
 * - A released letter the dispatcher could not send (founder, 2026-09-22,
 *   verbatim pick: "Back to waiting (Recommended)") comes back here as
 *   waiting, with the reason it was not sent, for the manager and for the
 *   person who asked.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type CSSProperties } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { errText, letterRequestKeys } from './Compose/useComposeData';

export interface LetterRequest {
  id: string;
  kind: 'house_letter';
  providerId: string | null;
  requestedBy: { userId: string | null; name: string | null };
  requestedAt: string;
  payload: {
    providerId?: string;
    to?: string;
    subject?: string;
    body?: string;
    orderId?: string | null;
    templateId?: string | null;
  };
  state: 'waiting' | 'released' | 'closed';
  /** Times a manager released it and pulled it back inside the undo window. */
  undoneCount?: number;
  /** The latest released letter that could not be sent, which put it back to waiting. */
  lastSendFailure?: {
    reason: string;
    at: string;
    releasedBy: { userId: string | null; name: string | null };
    count: number;
  } | null;
}

/** Who is reading the list (from the gateway): an owner or a manager may decline. */
export interface LetterRequestsViewer {
  userId: string | null;
  mayDecline: boolean;
}

/** The letter a release sends: exactly what was asked for, named by its request. */
export function releaseBody(r: LetterRequest) {
  return {
    providerId: r.payload.providerId ?? r.providerId ?? '',
    to: r.payload.to ?? '',
    subject: r.payload.subject ?? '',
    body: r.payload.body ?? '',
    ...(r.payload.orderId ? { orderId: r.payload.orderId } : {}),
    ...(r.payload.templateId ? { templateId: r.payload.templateId } : {}),
    requestId: r.id,
  };
}

export function LetterRequestsPanel({
  restaurantId,
  canRelease,
}: {
  restaurantId: string;
  /** From the composer's own standing: this person's hold sends. */
  canRelease: boolean;
}) {
  const qc = useQueryClient();
  const requests = useQuery({
    queryKey: letterRequestKeys.forHouse(restaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ requests: LetterRequest[]; viewer?: LetterRequestsViewer }>(
        '/communications/letters/requests',
      );
      return {
        requests: data.requests,
        viewer: data.viewer ?? { userId: null, mayDecline: false },
      };
    },
    enabled: Boolean(restaurantId),
    staleTime: 15_000,
  });
  const [says, setSays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [declining, setDeclining] = useState<string | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  // The letter a release just queued, while it can still be pulled back
  // (founder, 2026-09-21: "undo re-waits"): pulling it back puts the request
  // back to waiting, on the server, and the person who asked is told.
  const [pullable, setPullable] = useState<{ letterId: string; until: number } | null>(null);
  useEffect(() => {
    if (!pullable) return;
    const left = pullable.until - Date.now();
    if (left <= 0) {
      setPullable(null);
      return;
    }
    const t = setTimeout(() => setPullable(null), left);
    return () => clearTimeout(t);
  }, [pullable]);

  const mint = (r: LetterRequest) => async (): Promise<string | null> => {
    setProblem(null);
    try {
      const { data } = await apiClient.post<{ challenge?: string }>(
        '/communications/letters/seal-challenge',
        releaseBody(r),
      );
      return data?.challenge ?? null;
    } catch (e) {
      setProblem(`Nothing was sent: the seal could not be issued (${errText(e)}).`);
      setAttempt((a) => a + 1);
      return null;
    }
  };

  const release = (r: LetterRequest) => async (challenge?: string | null) => {
    setProblem(null);
    setSays(null);
    try {
      const { data } = await apiClient.post<{ says: string; id?: string; dispatchAt?: string; undoMs?: number | null }>(
        '/communications/letters',
        releaseBody(r),
        { headers: { 'X-Seal-Challenge': challenge ?? '' } },
      );
      setSays(data?.says ?? 'Queued.');
      const until = data?.dispatchAt ? Date.parse(data.dispatchAt) : NaN;
      setPullable(data?.id && data?.undoMs && Number.isFinite(until) ? { letterId: data.id, until } : null);
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
      await qc.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
    } catch (e) {
      setProblem(`Nothing was sent: ${errText(e)}`);
      setAttempt((a) => a + 1);
      throw e;
    }
  };

  const close = async (r: LetterRequest, act: 'decline' | 'withdraw') => {
    setProblem(null);
    setSays(null);
    if (act === 'decline' && !why.trim()) {
      setProblem('Say why, so the person who asked can act on it. Nothing was declined.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await apiClient.post<{ says: string }>(
        `/communications/letters/requests/${r.id}/${act}`,
        act === 'decline' ? { reason: why.trim() } : {},
      );
      setSays(data?.says ?? (act === 'decline' ? 'Declined.' : 'Withdrawn.'));
      setDeclining(null);
      setWhy('');
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
    } catch (e) {
      setProblem(`Nothing was changed: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const pullBack = async () => {
    if (!pullable) return;
    setProblem(null);
    setBusy(true);
    try {
      const { data } = await apiClient.post<{ says: string }>(`/communications/letters/${pullable.letterId}/cancel`);
      setSays(data?.says ?? 'Pulled back.');
      setPullable(null);
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
      await qc.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
    } catch (e) {
      // A failed pull-back never reads as a pulled-back letter: it may still leave.
      setProblem(`It was NOT pulled back: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (requests.isPending) return null;
  if (requests.isError) {
    return (
      <p role="status" data-testid="letter-requests-unread" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
        The letters waiting for a manager could not be read ({errText(requests.error)}). That is a failed read, not
        an empty list.
      </p>
    );
  }
  const waiting = requests.data?.requests ?? [];
  const viewer = requests.data?.viewer ?? { userId: null, mayDecline: false };
  if (waiting.length === 0 && !says) return null;

  return (
    <section
      aria-label="Letters waiting for a manager"
      data-testid="letter-requests"
      className="mb-6 rounded-xl p-4"
      style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
    >
      <h2 style={{ fontSize: 12, fontWeight: 600, margin: '0 0 8px', color: 'var(--ink-2, #4F473C)' }}>
        Letters waiting for a manager · {waiting.length}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {waiting.map((r) => (
          <li key={r.id} style={{ padding: '6px 0', borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-1, #211C16)' }}>
              {r.requestedBy.name ?? 'A member whose name could not be read'} asked for this letter to{' '}
              {r.payload.to ?? 'a vendor'} to be sent: <strong>{r.payload.subject ?? '(no subject)'}</strong>
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, whiteSpace: 'pre-wrap', color: 'var(--ink-2, #4F473C)' }}>
              {r.payload.body ?? ''}
            </p>
            {(r.undoneCount ?? 0) > 0 && (
              <p data-testid="letter-request-undone" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                It was released and then pulled back before it left, so it is waiting again. Nothing was sent.
              </p>
            )}
            {r.lastSendFailure && (
              <p data-testid="letter-request-send-failed" style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--alarm-deep, #8C3322)' }}>
                {r.lastSendFailure.releasedBy.name ?? 'A manager'} released it, but it could not be sent:{' '}
                {r.lastSendFailure.reason} It is waiting again. Nothing was sent.
              </p>
            )}
            {canRelease ? (
              <div style={{ maxWidth: 260, marginTop: 6 }}>
                <HoldToApprove
                  key={`${r.id}-${attempt}`}
                  label="Hold to send it as written"
                  approvedLabel="Queued"
                  onChallenge={mint(r)}
                  onApprove={release(r)}
                />
              </div>
            ) : (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                Waiting for an owner or a manager. Nothing has been sent.
              </p>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
              {viewer.mayDecline && declining !== r.id && (
                <button
                  type="button"
                  onClick={() => {
                    setDeclining(r.id);
                    setWhy('');
                  }}
                  style={quietButton}
                >
                  Decline
                </button>
              )}
              {viewer.userId !== null && r.requestedBy.userId === viewer.userId && (
                <button type="button" disabled={busy} onClick={() => void close(r, 'withdraw')} style={quietButton}>
                  Withdraw my request
                </button>
              )}
            </div>
            {declining === r.id && (
              <form
                style={{ marginTop: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void close(r, 'decline');
                }}
              >
                <label htmlFor={`decline-why-${r.id}`} style={{ display: 'block', fontSize: 11, color: 'var(--ink-2, #4F473C)' }}>
                  Why? {r.requestedBy.name ?? 'The person who asked'} reads this.
                </label>
                <textarea
                  id={`decline-why-${r.id}`}
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  maxLength={500}
                  rows={2}
                  style={{
                    width: '100%',
                    marginTop: 4,
                    fontSize: 12,
                    padding: 6,
                    borderRadius: 6,
                    border: '1px solid var(--paper-2, #EAE4D8)',
                    background: 'var(--paper-0, #FBF9F4)',
                    color: 'var(--ink-1, #211C16)',
                  }}
                />
                <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                  <button type="submit" disabled={busy} style={quietButton}>
                    Decline it
                  </button>
                  <button type="button" onClick={() => setDeclining(null)} style={quietButton}>
                    Keep it waiting
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
      {says && (
        <p role="status" data-testid="letter-requests-says" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {says}
        </p>
      )}
      {pullable && (
        <button type="button" disabled={busy} onClick={() => void pullBack()} style={{ ...quietButton, marginTop: 6 }}>
          Pull it back
        </button>
      )}
      {problem && (
        <p role="alert" data-testid="letter-requests-problem" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {problem}
        </p>
      )}
    </section>
  );
}

const quietButton: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
};

export default LetterRequestsPanel;
