import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { documentsApi, type SaleCostCoverage } from '../../../services/api/documents';
import { fmtDate, fmtMoney, serverMessage } from './rc2-format';

/**
 * HOW MUCH OF THE TILL'S COST IS EXACT (r109 g2), one row above the lanes:
 * "Last 7 days the till's drinks cost 1,240.50: 1,010.20 from checked papers,
 * 230.30 on an estimate from 3 deliveries." The estimate's deliveries open
 * behind a button, as 44px rows that open their paper or say there is none
 * yet, so nothing appears below the strip unasked once it has read (CLS 0).
 *
 * Owners and managers only: the page mounts it behind the same gate as the
 * credit ledger, so staff send no request. Motion (MOTIONS.md: arithmetic
 * never animates): the figures snap, there is no tween, and the row holds its
 * 44px while it reads so nothing below it moves (CLS 0).
 */
export const COVERAGE_ROW = 44;

const ROW = { minHeight: COVERAGE_ROW, display: 'flex', alignItems: 'center', fontSize: 12.5, color: 'var(--ink-1, #211C16)' } as const;
const MUTED = { fontSize: 11.5, color: 'var(--ink-4, #665D50)', margin: 0 } as const;
const TEXT_BUTTON = { ...ROW, background: 'none', border: 0, padding: 0, cursor: 'pointer', textDecoration: 'underline' } as const;
const LINK = { ...ROW, background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', textDecoration: 'underline', width: '100%' } as const;

const n = (s: string) => Number(s);
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

/** The strip's one sentence, from the figures as the gateway sent them. */
export function coverageSentence(c: SaleCostCoverage): string {
  const m = (s: string) => fmtMoney(n(s), c.currency);
  if (c.sales === 0 && c.notKept === 0) return `Last ${c.days} days the till sold no drinks with a cost.`;
  const parts = [`${m(c.checked)} from checked papers`];
  if (n(c.partial) !== 0) parts.push(`${m(c.partial)} on papers partly checked`);
  if (n(c.estimate) !== 0)
    parts.push(`${m(c.estimate)} on an estimate from ${plural(c.estimateDeliveries.length, 'delivery', 'deliveries')}`);
  if (n(c.other) !== 0) parts.push(`${m(c.other)} on a basis this page does not name`);
  const tail = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, ${parts[parts.length - 1]}` : parts[0];
  const lost = c.notKept > 0 ? ` ${plural(c.notKept, 'sale kept no cost and is', 'sales kept no cost and are')} not in it.` : '';
  return `Last ${c.days} days the till's drinks cost ${m(c.total)}: ${tail}.${lost}`;
}

export function ReceiptsCoverage({ onOpen }: { onOpen: (docId: string) => void }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [open, setOpen] = useState(false);
  const q = useQuery<SaleCostCoverage>({
    queryKey: ['receipts-next', 'sale-cost-coverage', days],
    queryFn: () => documentsApi.saleCostCoverage(days),
    staleTime: 60_000,
    retry: false,
  });
  const c = q.data;
  return (
    <section aria-label="How exact the till's cost is" data-testid="sale-cost-coverage" aria-busy={q.isPending || undefined} style={{ marginBottom: 16 }}>
      <p style={{ ...ROW, margin: 0 }}>
        {q.isError ? serverMessage(q.error, "How exact the till's cost is could not be read") : c ? coverageSentence(c) : ''}
      </p>
      {/* The controls row is always there, so the deliveries button arriving moves nothing. */}
      <div style={{ ...ROW, gap: 16 }}>
        {c && c.estimateDeliveries.length > 0 && (
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={TEXT_BUTTON}>
            {open ? 'Hide the deliveries on an estimate' : `See the ${plural(c.estimateDeliveries.length, 'delivery', 'deliveries')} on an estimate`}
          </button>
        )}
        <button type="button" onClick={() => setDays(days === 7 ? 30 : 7)} style={TEXT_BUTTON}>
          {days === 7 ? 'Last 30 days' : 'Last 7 days'}
        </button>
      </div>
      {c && open && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Deliveries on an estimate">
          {c.estimateDeliveries.map((d) => {
            const what = `${d.vendor ?? (d.orderId ? 'A vendor not named' : 'No delivery named')}${d.deliveredAt ? ` · ${fmtDate(d.deliveredAt)}` : ''} · ${fmtMoney(n(d.cost), c.currency)}`;
            const id = d.paper.documentId;
            return (
              <li key={d.orderId ?? 'none'}>
                {id ? (
                  <button type="button" style={LINK} onClick={() => onOpen(id)}>
                    {what} · {d.paper.state === 'checked' ? 'paper checked, open it' : 'paper in review, open it'}
                  </button>
                ) : (
                  <span style={ROW}>{what} · no paper yet</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p style={MUTED}>Food costs are not drawn yet.</p>
    </section>
  );
}
