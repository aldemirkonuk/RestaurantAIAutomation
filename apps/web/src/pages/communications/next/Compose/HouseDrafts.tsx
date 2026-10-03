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

import { useRef, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useAuth } from '../../../../contexts/AuthContext';
import { apiClient } from '../../../../services/api/client';
import { MONO, fmtDay } from './compose-format';
import { failedReadWords, managesHouse, readAgainFailed } from '../cm-format';

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
  const { user, activeRestaurantId, activeRole } = useAuth();
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? '';
  const qc = useQueryClient();
  // COMMS-W31: the gateway lists these for an owner or manager only. A staff
  // member's page used to ask anyway, and every visit drew "Forbidden
  // resource." in red and left "Waiting on you" unknowable. Now staff are not
  // asked about letters that are not theirs to open: nothing here waits on
  // them. A refusal that still comes back (a role changed mid-visit) is the
  // same fact, said the same way, never a failure.
  const manages = managesHouse(activeRole, user?.role);
  const q = useQuery<HouseDraft[]>({
    queryKey: houseDraftsKey(restaurantId),
    queryFn: async () => {
      const { data } = await apiClient.get<{ drafts: HouseDraft[] }>('/communications/letters/drafts');
      return data.drafts ?? [];
    },
    enabled: !!restaurantId && manages,
    staleTime: 15_000,
  });
  const refused = (q.error as { response?: { status?: number } } | null)?.response?.status === 403;
  const withheld = !manages || refused;
  return {
    drafts: withheld ? [] : q.data ?? null,
    /** True when these letters are an owner's or manager's to open, not this person's. */
    withheld,
    failed: q.isError && !refused,
    error: q.isError && !refused ? failedReadWords(q.error) : null,
    /** When the drafts last answered (0 = never); said when a later read fails (COMMS-W33). */
    at: q.dataUpdatedAt,
    refetch: () => void qc.invalidateQueries({ queryKey: houseDraftsKey(restaurantId) }),
  };
}

export function HouseDrafts({
  drafts,
  failed,
  error,
  at = 0,
  onOpen,
  below,
}: {
  drafts: HouseDraft[] | null;
  failed: boolean;
  error: string | null;
  /** When `drafts` was read (`dataUpdatedAt`); said when a later read failed. */
  at?: number;
  onOpen: (d: HouseDraft) => void;
  /** Drawn under a letter's row — the stub holding a person's changes to it (COMMS-W34).
   *  `focusRow` moves focus to the letter's own button, so a sheet opened from
   *  the stub returns focus there rather than to a stub that has gone. */
  below?: (d: HouseDraft, focusRow: () => void) => ReactNode;
}) {
  const rows = useRef(new Map<string, HTMLButtonElement>());
  // COMMS-W33 (founder: "A: keep, say when"): a read that failed after
  // answering keeps its letters and says when they are from; one that never
  // answered says so in the page's words, not "Internal server error. … unknown, not none".
  const stale = failed && drafts !== null;
  return (
    <section aria-label="Drafted letters, not sent" style={{ marginTop: 12 }}>
      <h3
        style={{
          fontFamily: MONO,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--ink-4, #665D50)',
          margin: '0 0 6px',
        }}
      >
        Drafted, not sent
      </h3>
      {failed && !stale ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)', margin: 0 }}>
          The drafted letters could not be read ({error}). That does not mean none are waiting.
        </p>
      ) : stale && drafts?.length === 0 ? (
        <p role="status" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
          {readAgainFailed(error ?? '', at, true)}
        </p>
      ) : drafts === null ? (
        <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>The drafts haven’t answered yet.</p>
      ) : drafts.length === 0 ? (
        <p style={{ fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: 0 }}>No drafted letters are waiting.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {drafts.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                ref={(el) => {
                  if (el) rows.current.set(d.id, el);
                  else rows.current.delete(d.id);
                }}
                onClick={() => onOpen(d)}
                className="cm-row cm-card flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left"
                style={{ border: '1px dashed var(--paper-2, #EAE4D8)', cursor: 'pointer' }}
              >
                <FileText size={13} strokeWidth={1.75} aria-hidden style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
                    {d.subject ?? 'A drafted letter'}
                  </span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                    {d.providerName ?? 'Vendor'} · {d.to ?? 'no address in the book yet'}
                    {d.createdAt ? ` · drafted ${fmtDay(d.createdAt)}` : ''}
                    {d.creditId ? ' · asks for a credit' : ''}
                  </span>
                </span>
              </button>
              {below?.(d, () => rows.current.get(d.id)?.focus())}
            </li>
          ))}
        </ul>
      )}
      {stale && (drafts?.length ?? 0) > 0 && (
        <p role="status" style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', margin: '6px 0 0' }}>
          {readAgainFailed(error ?? '', at, false)}
        </p>
      )}
    </section>
  );
}
