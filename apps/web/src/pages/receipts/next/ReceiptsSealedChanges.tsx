import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { documentsApi, type SealedChanges, type SettledSale } from '../../../services/api/documents';
import { prefersReducedMotion } from '../../../lib/mudavym/motion';
import { fmtMoney, serverMessage } from './rc2-format';

/**
 * WHAT VERIFYING ITS DELIVERY CHANGED (r108 g17), on a verified paper: the
 * stock value its lots moved by and what the sales already made from them now
 * cost, read from the receipts the cost writes left. ONE TOTAL: the receipts
 * carry no act id, so a split by timestamp would call the first good "the seal"
 * and the rest "corrections" (see the gateway's sealed-changes.ts).
 *
 * Motion (MOTIONS.md, ADR 0112): none of its own. It sits inside the card's
 * rc-settle panel; figures arrive as text with no counter tween (the
 * tie-out's deliberate non-motion), and its height is held while it reads so
 * nothing below it moves (CLS 0). Reduced motion has nothing to turn off.
 *
 * r109 g3: "Sales it settled (n)" opens the sales by table. No height
 * animation: the rows are there at once; with motion on the list fades
 * opacity 0 -> 1 over 180ms on the house curve, and under reduced motion it
 * runs no animation at all (ADR 0112). Closing is instant.
 */
export const SEALED_CHANGES_RESERVE = 36;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const signed = (s: string, cur: string | null) => {
  const n = Number(s);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmtMoney(Math.abs(n), cur)}`;
};

/** One act in words: "Stock value +412.30 across 24 bottles; 6 sales already made now cost 8.40 less." */
export function changeSentence(e: Pick<SealedChanges, 'stockValueDelta' | 'bottles' | 'salesCostDelta' | 'sales'>, cur: string | null): string {
  const parts: string[] = [];
  if (e.bottles > 0) parts.push(`Stock value ${signed(e.stockValueDelta, cur)} across ${plural(e.bottles, 'bottle', 'bottles')}`);
  if (e.sales > 0) {
    const n = Number(e.salesCostDelta);
    const how = n === 0 ? 'the same' : `${fmtMoney(Math.abs(n), cur)} ${n > 0 ? 'more' : 'less'}`;
    parts.push(`${plural(e.sales, 'sale', 'sales')} already made now cost ${how}`);
  }
  return parts.length ? `${parts.join('; ')}.` : 'No lot was revalued and no sale was restated.';
}

const P = { fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: 0 } as const;
const MUTED = { ...P, color: 'var(--ink-4, #665D50)', marginTop: 4 } as const;

export function SealedChangesPart({ docId }: { docId: string }) {
  const q = useQuery<SealedChanges>({
    queryKey: ['receipts-next', 'sealed-changes', docId],
    queryFn: () => documentsApi.sealedChanges(docId),
    staleTime: 60_000,
    retry: false,
  });
  return (
    <div data-testid="sealed-changes" style={{ minHeight: SEALED_CHANGES_RESERVE }} aria-busy={q.isPending || undefined}>
      {q.isError ? (
        <p role="status" style={MUTED}>
          {serverMessage(q.error, 'What sealing changed could not be read')}
        </p>
      ) : q.data ? (
        <Figures d={q.data} />
      ) : null}
    </div>
  );
}

function Figures({ d }: { d: SealedChanges }) {
  // Said only when there is no delivery either: a door delivery with no order still books lots.
  if (!d.orders.length && !d.deliveries)
    return <p style={P}>This paper is linked to no order and no delivery, so verifying it moved no cost.</p>;
  return (
    <>
      <p style={P}>{changeSentence(d, d.currency)}</p>
      {d.notKnown > 0 && (
        <p style={MUTED}>
          {plural(d.notKnown, 'cost', 'costs')} had no earlier figure, so {d.notKnown === 1 ? 'it is' : 'they are'} not in these
          numbers.
        </p>
      )}
      {(d.salesList?.length ?? 0) > 0 && <SalesSettled sales={d.salesList ?? []} unnamed={d.salesUnnamed ?? 0} />}
      {d.otherPapers > 0 && (
        <p style={MUTED}>
          These are the order&rsquo;s figures; {plural(d.otherPapers, 'other paper', 'other papers')} also priced it.
        </p>
      )}
    </>
  );
}

export const SALES_SHOWN = 50;
export const SALES_FADE = { duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' } as const;

const UNIT_WORDS: Record<string, [string, string]> = { glass: ['glass', 'glasses'], bottle: ['bottle', 'bottles'] };

/** "Fri 21 Nov 20:14" in this device's clock. */
export function saleWhen(at: string | null): string {
  if (!at) return 'time not kept';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return 'time not kept';
  const p = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('weekday')} ${v('day')} ${v('month')} ${v('hour')}:${v('minute')}`;
}

/** "Table 4 · Fri 21 Nov 20:14 · 2 glasses House Red · 3.10 → 2.90" */
export function saleLine(s: SettledSale): string {
  const w = s.unit ? UNIT_WORDS[s.unit] : undefined;
  const what = `${s.quantity} ${w ? w[s.quantity === 1 ? 0 : 1] : s.unit ?? ''}`.replace(/\s+$/, '');
  const cost = `${s.before ?? 'not known'} → ${s.after}`;
  return [s.table, saleWhen(s.at), `${what} ${s.wine ?? 'a wine not named'}`, s.voided ? `voided · ${cost}` : cost].join(' · ');
}

function SalesSettled({ sales, unnamed }: { sales: SettledSale[]; unnamed: number }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (!open || !el || prefersReducedMotion() || typeof el.animate !== 'function') return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], SALES_FADE);
  }, [open]);
  const shown = all ? sales : sales.slice(0, SALES_SHOWN);
  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...P, minHeight: 44, background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
      >
        Sales it settled ({sales.length})
      </button>
      {open && (
        <>
          <ul ref={list} data-testid="sales-settled" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((s) => (
              <li key={s.id} style={{ ...P, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                {saleLine(s)}
              </li>
            ))}
          </ul>
          {!all && sales.length > SALES_SHOWN && (
            <button type="button" onClick={() => setAll(true)} style={{ ...P, minHeight: 44, background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>
              Show all {sales.length}
            </button>
          )}
          {unnamed > 0 && (
            <p style={MUTED}>
              {plural(unnamed, 'more sale is', 'more sales are')} in the total but not named here: no till check is on record for {unnamed === 1 ? 'it' : 'them'}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
