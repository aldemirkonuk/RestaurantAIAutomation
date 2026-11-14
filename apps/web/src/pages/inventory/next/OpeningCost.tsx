/**
 * "What did these cost?" on an opened good (r36 invoices audit R1, web half).
 *
 * Stock that came in with no delivery and no order (the shelf a house already
 * had on day 1, a menu-scan import, a good added with no price, a count that
 * found more) is booked with no cost. Sales draw the oldest lot first, so a new
 * house's first sales take exactly that stock, and cost of goods stays
 * withheld until it is costed. The gateway reads what is still waiting
 * (GET …/item/:id/opening-cost) and states one cost for it (POST, #1574),
 * settling what already sold from it too.
 *
 * Shown only to an owner or a manager (the routes refuse anyone else), and
 * only when the read says something waits. The dropdown stays formless (ADR
 * 0112 F8): it says what waits and offers one button, and the field and the
 * seal live in their own Sheet (F10), because a stated cost settles sales
 * already made and is not corrected by this act afterwards. A sold-out lot counts: its sales
 * are what keep cost of goods withheld. A read that fails, or a route not yet
 * deployed, draws nothing: the cost-of-goods figure itself already says it is
 * withheld, so silence here does not read as "all costed".
 *
 * The cost is typed the way the good's cost is shown (ItemCards perUnit): a
 * good kept in grams is costed a kg, one kept in millilitres a litre, a bottle
 * a bottle. It is sent per one of the good's own unit (ADR 0070), at most six
 * decimal places, in the house's money.
 */
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HoldToApprove, Sheet } from '@/components/mudavym';
import { apiClient } from '../../../services/api/client';
import { queryKeys } from '../../../lib/query-keys';
import { fmtQty, perUnit } from './ItemCards';
import { writeFailure } from './iv-failure';
import { cellMoney, type HouseCurrency } from './useInventoryNextData';

export interface UncostedOpeningStock {
  inventoryId: string;
  lots: number;
  units: number;
  emptyLots: number;
}

export interface StatedOpeningCost {
  lotsStated: number;
  drawsSettled: number;
  said: string;
}

const path = (restaurantId: string, inventoryId: string) =>
  `/inventory/${encodeURIComponent(restaurantId)}/item/${encodeURIComponent(inventoryId)}/opening-cost`;

export async function readUncostedOpeningStock(restaurantId: string, inventoryId: string): Promise<UncostedOpeningStock> {
  const r = await apiClient.get<UncostedOpeningStock>(path(restaurantId, inventoryId));
  return r.data;
}

export async function stateOpeningCost(
  restaurantId: string,
  inventoryId: string,
  unitCost: number,
): Promise<StatedOpeningCost> {
  const r = await apiClient.post<StatedOpeningCost>(path(restaurantId, inventoryId), { unitCost });
  return r.data;
}

export const openingCostKey = (restaurantId: string | null, inventoryId: string) =>
  ['inventory-next', 'opening-cost', restaurantId, inventoryId] as const;

/**
 * A typed cost, in either decimal form a house writes ("12.50" or "12,50";
 * "1.234,50" or "1,234.50"). Null for anything that is not a plain positive
 * amount: a guess is never made about which mark is the decimal one beyond
 * "the last mark is the decimal mark".
 */
export function readTypedCost(raw: string): number | null {
  const t = raw.trim().replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  const decimalAt = Math.max(lastDot, lastComma);
  let whole = t;
  let frac = '';
  if (decimalAt >= 0) {
    const mark = t[decimalAt];
    const other = mark === '.' ? ',' : '.';
    // A mark that appears more than once is a thousands mark, not a decimal one.
    if (t.indexOf(mark) !== decimalAt) {
      if (t.includes(other)) return null;
      whole = t;
    } else {
      whole = t.slice(0, decimalAt);
      frac = t.slice(decimalAt + 1);
      // "1,234" or "12.500" alone is a thousand in one house and a decimal in
      // another; the page does not guess which ("0,125" for one egg is fine).
      if (!t.includes(other) && frac.length === 3 && whole.replace(/^0+/, '') !== '') return null;
    }
  }
  const digits = whole.replace(/[.,]/g, '');
  if (digits === '') return null;
  const n = Number(frac === '' ? digits : `${digits}.${frac}`);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The typed figure (a kg, a litre, a bottle) as a cost per one of the good's
 * own unit, at six places: the precision a lot's cost is kept at.
 */
export function perOwnUnit(typed: number, uom: string | null): number {
  const factor = perUnit(1, uom).amount;
  return Math.round((typed / factor) * 1e6) / 1e6;
}

export function waitingWords(w: UncostedOpeningStock, uom: string | null): string {
  const onShelf = w.units > 0 ? `${fmtQty(w.units, uom)} on the shelf` : null;
  const sold =
    w.emptyLots > 0 ? `${w.emptyLots} lot${w.emptyLots === 1 ? '' : 's'} already sold or used` : null;
  const what = [onShelf, sold].filter(Boolean).join(' and ');
  return (
    `${what || 'Some stock'} came in without a delivery, so ${what ? 'they have' : 'it has'} no cost. ` +
    'Cost of goods leaves this stock out until you say what it cost; what already sold from it is costed at the same figure.'
  );
}

export function OpeningCost({
  restaurantId,
  inventoryId,
  title,
  uom,
  currency,
  canManage,
}: {
  restaurantId: string | null;
  inventoryId: string;
  title: string;
  uom: string | null;
  currency: HouseCurrency;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const enabled = canManage && restaurantId !== null;
  const q = useQuery({
    queryKey: openingCostKey(restaurantId, inventoryId),
    queryFn: () => readUncostedOpeningStock(restaurantId as string, inventoryId),
    enabled,
    retry: false,
  });

  if (!enabled) return null;
  const waiting = q.data && q.data.lots > 0 ? q.data : null;
  if (waiting === null && said === null) return null;

  return (
    <div className="iv-opening-cost" data-testid="opening-cost">
      {waiting ? (
        <>
          <h5 className="iv-sec">What did these cost?</h5>
          <p className="iv-note" data-testid="opening-cost-waiting">
            {waitingWords(waiting, uom)}
          </p>
          <button type="button" className="iv-btn iv-focus" data-seal="true" onClick={() => setOpen(true)}>
            State what it cost
          </button>
        </>
      ) : null}
      {said !== null && !open ? (
        <p className="iv-note" role="status" data-testid="opening-cost-said">
          {said}
        </p>
      ) : null}
      {open && waiting ? (
        <OpeningCostSheet
          restaurantId={restaurantId as string}
          inventoryId={inventoryId}
          title={title}
          uom={uom}
          currency={currency}
          waiting={waiting}
          onSaid={setSaid}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

export function OpeningCostSheet({
  restaurantId,
  inventoryId,
  title,
  uom,
  currency,
  waiting,
  onSaid,
  onClose,
}: {
  restaurantId: string;
  inventoryId: string;
  title: string;
  uom: string | null;
  currency: HouseCurrency;
  waiting: UncostedOpeningStock;
  onSaid: (said: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const id = useId();
  const [value, setValue] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [said, setSaid] = useState<{ text: string; alarm?: boolean } | null>(null);
  const per = perUnit(1, uom).per;
  const typed = readTypedCost(value);
  const own = typed === null ? null : perOwnUnit(typed, uom);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: openingCostKey(restaurantId, inventoryId) });
    void qc.invalidateQueries({ queryKey: queryKeys.inventory.all });
    void qc.invalidateQueries({ queryKey: ['inventory-next'] });
  };
  const state = useMutation({
    mutationFn: async () => {
      if (own === null || !(own > 0)) throw new Error('the cost is not complete');
      return stateOpeningCost(restaurantId, inventoryId, own);
    },
    onSuccess: (r) => {
      invalidate();
      setSaid({ text: r.said });
      onSaid(r.said);
    },
    onError: (e) => {
      setAttempt((a) => a + 1);
      const f = writeFailure(e, {
        refused: 'Nothing was stated',
        act: 'the cost was stated',
        check: 'Trying again is safe: a cost already stated is never stated twice.',
      });
      if (f.unknown) invalidate();
      setSaid({ text: f.text, alarm: true });
    },
  });

  const blocked =
    value.trim() === ''
      ? `Type what one cost ${per === 'each' ? 'each' : per}.`
      : typed === null
        ? 'Not an amount this page reads without guessing: type a cost like 12.50 or 12,50, with no thousands mark on its own.'
        : own === null || !(own > 0)
          ? 'That cost is too small to keep.'
          : null;
  const shown = typed === null ? '' : `${cellMoney(typed, currency)} ${per}`;

  return (
    <Sheet
      open
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`State what the stock of ${title} from no delivery cost. Sealing sets that cost on it and on what already sold from it. Leaving writes nothing.`}
      eyebrow="What did these cost?"
      title={title}
      footer={<span>Owners and managers only. A delivery’s stock is costed by its invoice, never here.</span>}
    >
      <p className="iv-note">{waitingWords(waiting, uom)}</p>
      <div className="iv-sheet-fields">
        <label htmlFor={id}>Cost {per}</label>{' '}
        <input
          id={id}
          className="iv-field"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          data-testid="opening-cost-input"
        />
      </div>
      {blocked ? (
        <p className="iv-note" data-testid="opening-cost-blocked">
          {blocked}
        </p>
      ) : (
        <p className="iv-note" data-testid="opening-cost-echo">
          Reads as {shown}.
        </p>
      )}
      <div style={{ marginTop: 14 }}>
        <HoldToApprove
          key={`oc-${attempt}`}
          label={blocked ? 'Not ready to state a cost' : `Hold to state ${shown}`}
          approvedLabel="Stated"
          boundSummary={blocked ? undefined : `${title}: ${shown}`}
          disabled={blocked !== null || state.isPending || state.isSuccess}
          onApprove={() => state.mutateAsync()}
        />
      </div>
      {said ? (
        <p role={said.alarm ? 'alert' : 'status'} className={said.alarm ? 'iv-said iv-said-alarm' : 'iv-said'} style={{ marginTop: 12 }} data-testid="opening-cost-sheet-said">
          {said.text}
        </p>
      ) : null}
    </Sheet>
  );
}
