/**
 * Letters Mudavym drafted that nobody has sent (ADR 0230).
 *
 * A credit claim moved to `requested` on /receipts leaves one here
 * (founder, 2026-09-25, round 5: "'requested' creates a DRAFTED letter to the
 * vendor in /communications; nothing sends without approval"). Opening one
 * puts it in the composer; sending it there is the approval, and every refusal
 * the composer has (book, guardrails, sender, undo window) applies to it.
 *
 * THREE STATES, NEVER TWO (ADR 0051 clause 3): unanswered, failed with the
 * server's own sentence, or answered — zero included.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useAuth } from '../../../../contexts/AuthContext';
import { apiClient } from '../../../../services/api/client';
import { MONO, fmtDay } from './compose-format';
import { errText } from './useComposeData';

export interface HouseDraft {
  id: string;
  providerId: string;
  providerName: string | null;
  orderId: string | null;
  subject: string | null;
  to: string | null;
  category: string | null;
  creditId: string | null;
  body: string;
  createdAt: string | null;
}

export function houseDraftsKey(restaurantId: string) {
  return ['house-letter-drafts', restaurantId] as const;
}

export function useHouseDrafts() {
  const { user, activeRestaurantId } = useAuth();
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? '';
  const qc = useQueryClient();
  const q = useQuery<HouseDraft[]>({
    queryKey: houseDraftsKey(restaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ drafts: HouseDraft[] }>('/communications/letters/drafts');
      return data.drafts ?? [];
    },
    enabled: !!restaurantId,
    staleTime: 15_000,
  });
  return {
    drafts: q.data ?? null,
    failed: q.isError,
    error: q.isError ? errText(q.error) : null,
    refetch: () => void qc.invalidateQueries({ queryKey: houseDraftsKey(restaurantId) }),
  };
}

export function HouseDrafts({
  drafts,
  failed,
  error,
  onOpen,
}: {
  drafts: HouseDraft[] | null;
  failed: boolean;
  error: string | null;
  onOpen: (d: HouseDraft) => void;
}) {
  return (
    <section aria-label="Drafted letters, not sent" style={{ marginTop: 12 }}>
      <h3
        style={{
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-3, #7C7365)',
          margin: '0 0 6px',
        }}
      >
        Drafted, not sent
      </h3>
      {failed ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)', margin: 0 }}>
          {error} Whether any letter is waiting is unknown, not none.
        </p>
      ) : drafts === null ? (
        <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>The drafts haven’t answered yet.</p>
      ) : drafts.length === 0 ? (
        <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>No drafted letters are waiting.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {drafts.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onOpen(d)}
                className="cm-row cm-card flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left"
                style={{ border: '1px dashed var(--paper-2, #EAE4D8)', cursor: 'pointer' }}
              >
                <FileText size={13} strokeWidth={1.75} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
                    {d.subject ?? 'A drafted letter'}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                    {d.providerName ?? 'Vendor'} · {d.to ?? 'no address in the book yet'}
                    {d.createdAt ? ` · drafted ${fmtDay(d.createdAt)}` : ''}
                    {d.creditId ? ' · asks for a credit' : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
