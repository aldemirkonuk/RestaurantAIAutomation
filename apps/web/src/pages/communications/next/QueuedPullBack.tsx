/**
 * A queued house letter, pulled back from the conversation book (COMMS-W23).
 *
 * The composer offered "Pull it back" only while its sheet stayed open; closed,
 * the book said "Queued · not yet sent" and nothing could stop the letter. This
 * reads the same queued letters the composer reads (one cache entry) and calls
 * the same cancel route, so the book offers exactly what the sheet offered.
 *
 * The clock is the server's `dispatchAt`, never a local guess: a stalled tab
 * shows 0 rather than a window the server never agreed to. The queued read does
 * not say who wrote the letter, and cancel is the author's alone (founder,
 * 2026-09-18), so the button says so and a refusal is shown in the server's
 * own words. A failed cancel never reads as a successful one.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { apiClient } from '../../../services/api/client';
import { procurementHistoryKeys } from '../../../hooks/queries/useConversationQueries';
import { secondsLeft } from './Compose/compose-format';
import { errText, useQueuedLetters } from './Compose/useComposeData';
import { SANS } from './cm-format';

const NOTE: CSSProperties = { margin: 0, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-4, #665D50)' };

export function QueuedPullBack({ id }: { id: string }) {
  const { restaurantId, queued, failed } = useQueuedLetters();
  const queryClient = useQueryClient();
  const [tick, setTick] = useState(0);
  const [outcome, setOutcome] = useState<{ ok: boolean; says: string } | null>(null);
  const [pulling, setPulling] = useState(false);

  const letter = queued?.find((q) => q.id === id) ?? null;
  const remaining = letter ? secondsLeft(letter.dispatchAt) : null;
  void tick;

  useEffect(() => {
    if (!letter || outcome?.ok) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [letter, outcome?.ok]);

  const pull = async () => {
    setPulling(true);
    try {
      const { data } = await apiClient.post<{ says: string }>(`/communications/letters/${id}/cancel`);
      setOutcome({ ok: true, says: data.says });
      void queryClient.invalidateQueries({ queryKey: ['house-letter-queued', restaurantId] });
      void queryClient.invalidateQueries({ queryKey: procurementHistoryKeys.all });
    } catch (e) {
      setOutcome({ ok: false, says: `It was NOT pulled back — ${errText(e)}` });
    } finally {
      setPulling(false);
    }
  };

  let body: ReactNode;
  if (outcome?.ok) {
    body = <p role="status" style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>{outcome.says}</p>;
  } else if (failed) {
    body = <p style={NOTE}>Whether it can still be pulled back could not be read, so it may still leave.</p>;
  } else if (queued === null) {
    body = null;
  } else if (!letter) {
    body = <p style={NOTE}>It can no longer be pulled back from here. The book will say whether it left.</p>;
  } else if (remaining === null) {
    body = <p style={NOTE}>Its sending time was not recorded, so it cannot be pulled back from here.</p>;
  } else if (remaining === 0) {
    body = <p style={NOTE}>The window has closed. The book will say whether it left.</p>;
  } else {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pull}
          disabled={pulling}
          data-testid="book-pull-back"
          className="inline-flex items-center gap-1.5"
          style={{
            fontFamily: SANS,
            fontSize: 11.5,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: 'var(--paper-0, #FAF7F1)',
            color: 'var(--seal-deep, #14515C)',
            cursor: pulling ? 'progress' : 'pointer',
          }}
        >
          <Undo2 size={13} strokeWidth={1.8} aria-hidden="true" />
          Pull it back ({remaining}s)
        </button>
        <span style={NOTE}>Only the person who wrote it can pull it back.</span>
      </div>
    );
  }

  if (!body && !(outcome && !outcome.ok)) return null;
  return (
    <div data-testid="book-queued" className="flex flex-col gap-1 pb-2.5 pl-14 pr-2" style={{ fontFamily: SANS }}>
      {body}
      {outcome && !outcome.ok && (
        <p role="alert" style={{ ...NOTE, color: 'var(--alarm-deep, #8C3322)' }}>{outcome.says}</p>
      )}
    </div>
  );
}
