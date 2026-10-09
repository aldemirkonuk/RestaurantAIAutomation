/**
 * Two things a vendor letter carries that the book did not say (sim wave 9).
 *
 * F-424 — `AutoSendStop`: with the house's auto-send switch on, an AI reply is
 * staged to leave by itself after a short undo window. The book printed the raw
 * status and offered no way to stop it; the only Cancel lived on /orders. This
 * calls the same gateway route that Cancel uses (`cancel-scheduled-send`, keyed
 * by the order), which turns the reply back into a draft waiting for approval.
 * The route answers `{cancelled:false}` when nothing was stopped, and that is
 * said as such — never as a stop.
 *
 * F-425 — `CameWithIt`: files a vendor attached to a reply are already kept and
 * listed by the gateway (`GET procurement/orders/:id/attachments`, with
 * short-lived links). Nothing on this page read them. The list is per order, so
 * only the files that came with THIS letter are shown beside it.
 */

import { useState, type CSSProperties } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Paperclip } from 'lucide-react';
import { procurementHistoryKeys } from '../../../hooks/queries/useConversationQueries';
import { useCancelScheduledSend, useOrderAttachments } from '../../../hooks/queries/useDraftEmailQueries';
import { errText } from './Compose/useComposeData';
import { SANS } from './cm-format';

const NOTE: CSSProperties = { margin: 0, fontSize: 11, lineHeight: 1.45, color: 'var(--ink-4, #665D50)' };

export function AutoSendStop({ orderId }: { orderId: string | null }) {
  const stop = useCancelScheduledSend();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<{ ok: boolean; says: string } | null>(null);

  const press = () => {
    if (!orderId) return;
    stop.mutate(orderId, {
      onSuccess: (r) =>
        setOutcome(
          r.cancelled
            ? { ok: true, says: 'Stopped. It now waits for you to approve it.' }
            : { ok: false, says: 'It could not be stopped: it has already gone out, or someone else changed it. The book will say which.' },
        ),
      onError: (e) => setOutcome({ ok: false, says: `It was NOT stopped — ${errText(e)} It may still go out.` }),
      onSettled: () => void queryClient.invalidateQueries({ queryKey: procurementHistoryKeys.all }),
    });
  };

  return (
    <div data-testid="book-auto-send" className="flex flex-col gap-1 pb-2.5 pl-14 pr-2" style={{ fontFamily: SANS }}>
      {outcome ? (
        <p role={outcome.ok ? 'status' : 'alert'} style={{ ...NOTE, color: outcome.ok ? 'var(--ink-2, #4F473C)' : 'var(--alarm-deep, #8C3322)' }}>
          {outcome.says}
        </p>
      ) : !orderId ? (
        <p style={NOTE}>Mudavym will send this reply by itself shortly. It is not tied to an order, so it cannot be stopped from here.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ ...NOTE, color: 'var(--ink-2, #4F473C)' }}>Mudavym will send this reply by itself shortly.</span>
          <button
            type="button"
            onClick={press}
            disabled={stop.isPending}
            style={{
              fontFamily: SANS,
              fontSize: 11.5,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--alarm-deep, #8C3322)',
              background: 'var(--paper-0, #FAF7F1)',
              color: 'var(--alarm-deep, #8C3322)',
              cursor: stop.isPending ? 'progress' : 'pointer',
            }}
          >
            {stop.isPending ? 'Stopping…' : 'Cancel the send'}
          </button>
        </div>
      )}
    </div>
  );
}

function size(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return ` · ${bytes} B`;
  if (bytes < 1024 * 1024) return ` · ${Math.round(bytes / 1024)} KB`;
  return ` · ${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CameWithIt({ orderId, conversationId }: { orderId: string | null; conversationId: string }) {
  const files = useOrderAttachments(orderId);
  if (!orderId) return null;
  if (files.isError) return <p style={{ ...NOTE, marginTop: 6 }}>Whether any files came with this letter could not be read.</p>;
  const mine = (files.data ?? []).filter((f) => f.conversationId === conversationId);
  if (mine.length === 0) return null;
  return (
    <div data-testid="book-attachments" style={{ margin: '6px 0 0' }}>
      <p style={NOTE}>Came with this letter:</p>
      <ul style={{ listStyle: 'none', margin: '2px 0 0', padding: 0 }}>
        {mine.map((f) => (
          <li key={f.id} className="flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
            <Paperclip size={12} strokeWidth={1.8} aria-hidden="true" />
            {f.url ? (
              <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--seal-deep, #14515C)', overflowWrap: 'anywhere' }}>
                {f.filename}
              </a>
            ) : (
              <span style={{ overflowWrap: 'anywhere' }}>{f.filename}</span>
            )}
            <span style={NOTE}>
              {size(f.sizeBytes)}
              {f.url ? '' : ' · cannot be opened right now'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
