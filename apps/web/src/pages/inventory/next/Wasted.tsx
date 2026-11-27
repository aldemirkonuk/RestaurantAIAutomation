/**
 * What was written off (r110 g3): the Waste card's own evidence. Totals by
 * reason first, then the newest write-offs, then how many the 30 days hold.
 * Given-away stock is kept apart and never added to waste (K10).
 *
 * An unread read says it could not be read and never 0 (ADR 0020). The value
 * of a line is an owner's or manager's only; the gateway sends none to staff.
 */
import type { ItemFigures, WasteEntry } from '../../../services/api/inventory';
import { cellMoney, fmtCount, type HouseCurrency } from './useInventoryNextData';
import { fmtQty } from './ItemCards';

/** The figures read as it reaches the panel: reading, failed as a whole, or answered. */
export type WastedLoad = 'reading' | 'failed' | ItemFigures['waste'] | undefined;

const NO_REASON = 'No reason given';

/** "3 Nov": the day a line was written off, on this device's clock. */
export function writtenOffDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

type Totals = NonNullable<ItemFigures['waste']['byReason']>;

/** "Spoiled 1.2 kg · Broken 2 bottles": one type's totals, largest first as the gateway sends them. */
export function reasonTotals(byReason: Totals, type: 'waste' | 'comp', uom: string | null): string | null {
  const rs = byReason.filter((r) => r.type === type);
  if (rs.length === 0) return null;
  return rs.map((r) => `${r.reason ?? NO_REASON} ${fmtQty(r.qty, uom)}`).join(' · ');
}

function entryLine(e: WasteEntry, uom: string | null, money: ((v: number) => string) | null): string {
  const parts = [writtenOffDay(e.at) ?? 'Day not recorded', fmtQty(e.qty, uom)];
  if (e.type === 'comp') parts.push('given away');
  parts.push(e.reason ?? NO_REASON);
  if (e.by) parts.push(e.by);
  if (money && e.value !== undefined && e.value !== null) parts.push(money(e.value));
  return parts.join(' · ');
}

export function WastedEvidence({
  load,
  uom,
  canManage,
  currency,
}: {
  load: WastedLoad;
  uom: string | null;
  canManage: boolean;
  currency: HouseCurrency;
}) {
  let body;
  if (load === 'reading') body = <p className="iv-note">Reading what was written off…</p>;
  else if (load === 'failed' || load === undefined || !load.readable || !load.entries || !load.byReason || load.total == null) {
    body = <p className="iv-note">What was written off could not be read. This is unread, not nothing written off.</p>;
  } else if (load.total === 0) {
    body = <p className="iv-said">Nothing written off or given away in the last 30 days.</p>;
  } else {
    const wasted = reasonTotals(load.byReason, 'waste', uom);
    const given = reasonTotals(load.byReason, 'comp', uom);
    const money = canManage ? (v: number) => cellMoney(v, currency) : null;
    const shown = load.entries.length;
    body = (
      <>
        {wasted ? (
          <p className="iv-said ivd-wasted-by" data-testid="ivd-wasted-by">
            {wasted}
          </p>
        ) : null}
        {given ? (
          <p className="iv-note ivd-wasted-by" data-testid="ivd-given-by">
            Given away, not counted as waste: {given}
          </p>
        ) : null}
        <ol className="ivd-orders" data-testid="ivd-wasted-list">
          {load.entries.map((e, i) => (
            <li key={`${e.at ?? ''}-${i}`} data-type={e.type}>
              {entryLine(e, uom, money)}
            </li>
          ))}
        </ol>
        <p className="iv-note" data-testid="ivd-wasted-count">
          {load.total > shown
            ? `${fmtCount(shown)} newest of ${fmtCount(load.total)}`
            : `All ${fmtCount(load.total)} in the last 30 days`}
          {load.byUnread ? '. Who wrote them off could not be read.' : ''}
        </p>
      </>
    );
  }
  return (
    <section className="iv-col" data-testid="ivd-wasted">
      <h4 className="iv-sec">What was written off</h4>
      {body}
    </section>
  );
}
