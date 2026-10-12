/**
 * Sold out (86) on the cellar's bottle leaf and the /inventory row. F-145, coordinator decision D1
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
import { queryKeys } from '../../../lib/query-keys';

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

/**
 * The 86 on a list row (F-1434): one chip, so a sold-out drink -- a spirit or
 * a beer as much as a wine -- reads as sold out without opening the row. The
 * list carries the open stock-out; `readable: false` says the read failed
 * rather than showing the row as available.
 */
export function SoldOutChip({
  soldOut,
  readable = true,
}: {
  soldOut?: { cause: string; startedAt: string } | null;
  readable?: boolean;
}) {
  const zone = useHouseZone();
  if (soldOut) {
    const why = CAUSE_WORDS[soldOut.cause as StockOutCause] ?? soldOut.cause;
    return (
      <span
        className="shrink-0 rounded bg-rose-100 px-1.5 py-px text-[9px] font-bold text-rose-700"
        title={`Sold out since ${when(soldOut.startedAt, zone)}, ${why}.`}
        data-testid="sold-out-chip"
      >
        Sold out (86)
      </span>
    );
  }
  if (!readable) {
    return (
      <span
        className="shrink-0 rounded bg-gray-100 px-1.5 py-px text-[9px] text-gray-500"
        title="Whether this is sold out could not be read. That is not the same as not sold out."
        data-testid="sold-out-chip-unread"
      >
        Sold out? Not read
      </span>
    );
  }
  return null;
}

/**
 * How an 86 ends, by its cause (F-1496): a delivery booked in brings a drink
 * back, except one that was pulled on purpose (20270106300000), which only a
 * person brings back. Without a cause (the menu reads none) both are said.
 */
export function comesBackWords(cause?: StockOutCause | null): string {
  if (cause === 'pulled') return 'It comes back only when someone brings it back.';
  if (cause) return 'It comes back when someone brings it back or a delivery is booked in.';
  return 'It comes back when someone brings it back, or when a delivery is booked in unless it was pulled.';
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
      // F-1434: the lists show the 86 too, so they read it again.
      void qc.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
    },
  });
  // F-1521: names the 86 on screen, so a newer one (an owner's pull since
  // this was read) is refused rather than ended unseen; the refusal says who
  // and why, and the row reads again.
  const back = useMutation({
    mutationFn: async (stockOutId: string) =>
      (await apiClient.post<StockOutState>(`${base}/end`, { stockOutId })).data,
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: queryKeys.inventory.lists() });
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  if (!house || q.isLoading) return null;
  // A reply without its `recent` list is not a state we can draw: say it was
  // not read rather than throw and blank the row (F-1107).
  if (q.isError || !q.data || !Array.isArray(q.data.recent)) {
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
            onClick={() => back.mutate(open.id)}
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
      {!open && cause === 'broken' ? (
        <p className="cl-note" data-testid="sold-out-broken-stock">
          This does not take the broken bottle off stock. Record it as breakage
          in the count too, or the books still hold it.
        </p>
      ) : null}
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
