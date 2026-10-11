/**
 * Sold out (86) on the cellar's bottle leaf. F-145, coordinator decision D1
 * (sim-run/bulletproof/reconcile/schema-decisions-decisions.md).
 *
 * A drink is sold out exactly while it has an open stock-out. Anyone of the
 * house may mark one, with why (ran out, broken, pulled, other), and bring it
 * back with one tap; the gateway records who and when. Marking moves no
 * stock: a broken or pulled bottle may leave others on the shelf.
 *
 * READS: GET /inventory/:house/item/:item/stock-out. A failed read is said as
 * such -- never shown as "not sold out" (the same rule as PriceLockNote).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, getErrorMessage } from '../../../services/api/client';
import { getHouseLocale } from '../../../lib/houseCurrency';
import { useHouseZone } from '../../../lib/houseZone';

export type StockOutCause = 'ran_out' | 'broken' | 'pulled' | 'other';

export interface StockOut {
  id: string;
  cause: StockOutCause;
  note: string | null;
  startedAt: string;
  startedBy: string | null;
  endedAt: string | null;
  endedBy: string | null;
}

export interface StockOutState {
  open: StockOut | null;
  recent: StockOut[];
}

export const CAUSE_WORDS: Record<StockOutCause, string> = {
  ran_out: 'ran out',
  broken: 'broken',
  pulled: 'pulled',
  other: 'other reason',
};

/**
 * When a stock-out started, on the house's clock and in the house's way of
 * writing it -- not the reader's device (F-1104). With no zone known yet, the
 * device's clock stands in. Digits, so the words stay English (F-1344).
 */
function when(iso: string, zone?: string | null): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const tz = zone ? { timeZone: zone } : {};
  const day = d.toLocaleDateString(getHouseLocale(), { day: 'numeric', month: 'numeric', ...tz });
  const time = d.toLocaleTimeString(getHouseLocale(), { hour: '2-digit', minute: '2-digit', ...tz });
  return `${day} ${time}`;
}

/** One past stock-out, in words. */
export function pastWords(s: StockOut, zone?: string | null): string {
  return `${when(s.startedAt, zone)} (${CAUSE_WORDS[s.cause] ?? s.cause})`;
}

export default function SoldOutControl({
  restaurantId: house,
  inventoryId,
}: {
  restaurantId: string | null;
  inventoryId: string;
}) {
  const qc = useQueryClient();
  const zone = useHouseZone();
  const key = ['inventory', 'stock-out', house, inventoryId];
  const base = `/inventory/${house}/item/${inventoryId}/stock-out`;
  const [cause, setCause] = useState<StockOutCause | ''>('');

  const q = useQuery({
    queryKey: key,
    enabled: !!house,
    queryFn: async () => (await apiClient.get<StockOutState>(base)).data,
  });

  const mark = useMutation({
    mutationFn: async (c: StockOutCause) => (await apiClient.post<StockOutState>(base, { cause: c })).data,
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      setCause('');
    },
  });
  const back = useMutation({
    mutationFn: async () => (await apiClient.post<StockOutState>(`${base}/end`)).data,
    onSuccess: (data) => qc.setQueryData(key, data),
  });

  if (!house || q.isLoading) return null;
  if (q.isError || !q.data) {
    return (
      <p className="cl-note" role="alert" data-testid="sold-out-unread" style={{ marginTop: 4 }}>
        Whether this is sold out could not be read. That is not the same as not sold out.
      </p>
    );
  }

  const { open, recent } = q.data;
  const past = recent.filter((s) => s.endedAt !== null).slice(0, 3);
  const failed = mark.error ?? back.error;

  return (
    <div data-testid="sold-out" style={{ marginTop: 8 }}>
      {open ? (
        <p className="cl-note" data-testid="sold-out-open">
          <strong>Sold out</strong> since {when(open.startedAt, zone)}, {CAUSE_WORDS[open.cause] ?? open.cause}
          {open.note ? ` (${open.note})` : ''}.{' '}
          <button
            type="button"
            className="cl-btn"
            onClick={() => back.mutate()}
            disabled={back.isPending}
            data-testid="sold-out-back"
          >
            Back on
          </button>
        </p>
      ) : (
        <p className="cl-note" data-testid="sold-out-mark">
          <label>
            Sold out because{' '}
            <select
              value={cause}
              onChange={(e) => setCause(e.target.value as StockOutCause | '')}
              data-testid="sold-out-cause"
            >
              <option value="">choose why</option>
              <option value="ran_out">it ran out</option>
              <option value="broken">it broke</option>
              <option value="pulled">we pulled it</option>
              <option value="other">another reason</option>
            </select>
          </label>{' '}
          <button
            type="button"
            className="cl-btn"
            onClick={() => cause && mark.mutate(cause)}
            disabled={!cause || mark.isPending}
            data-testid="sold-out-confirm"
          >
            Mark sold out (86)
          </button>
        </p>
      )}
      {failed ? (
        <p className="cl-note" role="alert" data-testid="sold-out-failed">
          That did not save: {getErrorMessage(failed)}
        </p>
      ) : null}
      {past.length > 0 ? (
        <p className="cl-note" data-testid="sold-out-past">
          Sold out before: {past.map((s) => pastWords(s, zone)).join(', ')}.
        </p>
      ) : null}
    </div>
  );
}
