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
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
      const { data } = await apiClient.get<{ requests: LetterRequest[] }>('/communications/letters/requests');
      return data.requests;
    },
    enabled: Boolean(restaurantId),
    staleTime: 15_000,
  });
  const [says, setSays] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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
      const { data } = await apiClient.post<{ says: string }>('/communications/letters', releaseBody(r), {
        headers: { 'X-Seal-Challenge': challenge ?? '' },
      });
      setSays(data?.says ?? 'Queued.');
      await qc.invalidateQueries({ queryKey: letterRequestKeys.forHouse(restaurantId) });
      await qc.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
    } catch (e) {
      setProblem(`Nothing was sent: ${errText(e)}`);
      setAttempt((a) => a + 1);
      throw e;
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
  const waiting = requests.data ?? [];
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
          </li>
        ))}
      </ul>
      {says && (
        <p role="status" data-testid="letter-requests-says" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {says}
        </p>
      )}
      {problem && (
        <p role="alert" data-testid="letter-requests-problem" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {problem}
        </p>
      )}
    </section>
  );
}

export default LetterRequestsPanel;
