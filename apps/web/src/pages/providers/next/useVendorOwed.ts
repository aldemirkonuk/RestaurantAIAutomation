/**
 * What the house owes one vendor, for the vendor's sheet on /vendors (F-1635,
 * S230: "shown on /vendors as well as /reports").
 *
 * One reading, not a second sum: it is the Spend by vendor answer
 * (`reports/vendor-spend`), whose Owed and Not marked paid are not cut to the
 * period, so the period asked for is just today. The words are the reports
 * shelf's own (`owedWords`), so the two pages never say it two ways.
 *
 * Owners and managers only: the gateway refuses anyone else, and the sheet
 * does not ask for anyone else (`enabled`).
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getVendorSpend, owedWords, type VendorOwedRow, type VendorSpend } from '../../reports/next/VendorSpendShelf';
import { failureOf } from '../../reports/next/rp-format';

export interface OwedLine {
  label: string;
  value: string;
}

/** Today as YYYY-MM-DD; any day serves, since owed is not period-bound. */
function anyDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useVendorOwed(providerId: string, enabled: boolean): OwedLine[] {
  const { activeRestaurantId, user } = useAuth();
  const house = activeRestaurantId || user?.restaurantId || '';
  // Read on open, as the sheet's other sections are; keyed to the house so a
  // house switch never shows the previous house's answer.
  const [read, setRead] = useState<{ house: string; data?: VendorSpend; error?: unknown } | null>(null);
  useEffect(() => {
    if (!enabled || !house) return;
    let live = true;
    const day = anyDay();
    getVendorSpend({ from: day, to: day }).then(
      (data) => live && setRead({ house, data }),
      (error: unknown) => live && setRead({ house, error: error ?? new Error('no answer') }),
    );
    return () => {
      live = false;
    };
  }, [enabled, house]);
  if (!enabled) return [];
  const mine = read && read.house === house ? read : null;
  if (mine?.error) {
    const f = failureOf(mine.error);
    return [{ label: 'Owed', value: `Not known just now${f ? ` (${f.message})` : ''}` }];
  }
  const s = mine?.data;
  if (!s) return [{ label: 'Owed', value: 'Reading…' }];
  // Every vendor owed anything is in `owing`, whatever the period (F-1643);
  // `vendors` holds only the period's, which for "today" is almost nobody.
  const pool: VendorOwedRow[] = s.owing ?? s.vendors;
  const row = pool.find((v) => v.providerId === providerId);
  if (s.owedSince === null && !row?.unpaidInvoices)
    return [{ label: 'Owed', value: 'Not worked out yet: no invoice has been marked paid here' }];
  if (!row) return [{ label: 'Owed', value: 'Nothing' }];
  const w = owedWords(row, s.owedSince, s.currency);
  const lines: OwedLine[] = [
    {
      label: 'Owed',
      value: w.owed
        ? w.owed.replace(/^Owed: /, '').replace(/^nothing$/, 'Nothing')
        : 'Not worked out yet: no invoice has been marked paid here',
    },
  ];
  if (w.notMarked) {
    // Older invoices nobody could mark paid: said apart, never as owed.
    const said = w.notMarked.slice(w.notMarked.indexOf(': ') + 2);
    lines.push({
      label: 'Not marked paid',
      value: s.owedSince ? `${said}, dated before ${s.owedSince}` : said,
    });
  }
  // Older credit is said, never silently netted (wave 109).
  if (w.earlyCredit) lines.push({ label: 'Older credit', value: w.earlyCredit.replace(/^Not taken off Owed: /, '') });
  return lines;
}
