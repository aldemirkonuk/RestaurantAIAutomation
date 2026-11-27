import { useQuery } from '@tanstack/react-query';
import { documentsApi, type SealedChanges } from '../../../services/api/documents';
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
  if (!d.orders.length)
    return <p style={P}>This paper is linked to no order, so sealing moved no cost.</p>;
  return (
    <>
      <p style={P}>{changeSentence(d, d.currency)}</p>
      {d.notKnown > 0 && (
        <p style={MUTED}>
          {plural(d.notKnown, 'cost', 'costs')} had no earlier figure, so {d.notKnown === 1 ? 'it is' : 'they are'} not in these
          numbers.
        </p>
      )}
      {d.otherPapers > 0 && (
        <p style={MUTED}>
          These are the order&rsquo;s figures; {plural(d.otherPapers, 'other paper', 'other papers')} also priced it.
        </p>
      )}
    </>
  );
}
