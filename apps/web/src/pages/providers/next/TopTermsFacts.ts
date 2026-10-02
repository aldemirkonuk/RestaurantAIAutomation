/**
 * The three terms at the top of the vendor sheet — Lead time, Payment terms,
 * Minimum order — read from the SAME cells the Terms section renders.
 *
 * VEN-W24 (founder, 2026-10-01, option A "One source"). Before this the top
 * printed the vendor RECORD (`provider.leadTimeDays` / `paymentTerms` /
 * `minimumOrder`) while Terms below printed what the house had said, so after
 * "Net 30" was recorded the top still read "Payment terms —". Now:
 *
 *  - a STATED cell is shown as it is — the house's word;
 *  - a `vendor_record` cell (the gateway's fallback when the house has said
 *    nothing: the per-house override, then the vendor row) is shown with
 *    "· from the vendor's record";
 *  - an INFERRED cell is shown the way Terms shows it — the minimum with "≤",
 *    because it is an upper bound — and says it was inferred;
 *  - an unknown cell is an em dash, exactly as in Terms.
 *
 * A read that is still running says so, and a read that FAILED says it could
 * not be read. It does not fall back to the record value: the record is only
 * the answer when the house has stated nothing, and a failed read cannot tell
 * us that. The Terms section below carries the reason and "Try again".
 */

import type { Provider } from '../../../services/api/providers';
import type { TermCell } from '../../settings/next/useSettingsNextData';
import { fmtMoney } from '@/lib/mudavym/format';
import { EM, fmtDays } from './pv-format';
import type { ProviderTermsState } from './useProviderTerms';

/* ── Formatters both the Terms rows and the sheet's top facts speak ───────
 * VEN-W24 (founder, 2026-10-01, "One source"): the top of the vendor sheet
 * shows these same cells, so the words are written once, here. */

/** "same day" / "1 day" / "3 days". */
export function fmtLeadTime(d: number): string {
  return d === 0 ? 'same day' : `${d} day${d === 1 ? '' : 's'}`;
}

/** The minimum in the HOUSE's reporting currency (`register.currency.code`),
 *  never the vendor's usual one; an inferred minimum is an upper bound, so it
 *  carries "≤" — the number looks like a minimum and is not one. */
export function fmtMinimumCell(cell: TermCell<number>, currency: string | null): string {
  if (cell.value === null || cell.value === undefined) return EM;
  return cell.source === 'inferred'
    ? `≤ ${fmtMoney(cell.value, currency)}`
    : fmtMoney(cell.value, currency);
}

export interface TopTerms {
  leadTime: string;
  paymentTerms: string;
  minimumOrder: string;
}

export const FROM_RECORD = ' · from the vendor’s record';
export const INFERRED = ' · inferred from this house’s orders';
export const READING = 'Reading…';
export const NOT_READ = 'Could not be read — see Terms below';
export const DENIED = 'Not readable for this account';
/** Appended when the register was read but its book of stated terms was not:
 *  a non-stated value then cannot claim the house said nothing. */
const STATED_UNREAD = ' (the house’s own terms could not be read)';

function fromCell<T>(
  cell: TermCell<T>,
  show: (v: T) => string,
  statedReadable: boolean,
): string {
  const known = cell.value !== null && cell.value !== undefined;
  if (cell.source === 'stated' && known) return show(cell.value as T);
  const caveat = statedReadable ? '' : STATED_UNREAD;
  if (!known) return statedReadable ? EM : NOT_READ;
  if (cell.source === 'vendor_record') return `${show(cell.value as T)}${FROM_RECORD}${caveat}`;
  if (cell.source === 'inferred') return `${show(cell.value as T)}${INFERRED}${caveat}`;
  return `${show(cell.value as T)}${caveat}`;
}

export function topTerms(
  terms: Pick<ProviderTermsState, 'register' | 'row' | 'loading' | 'error' | 'denied'>,
  provider: Pick<Provider, 'leadTimeDays' | 'paymentTerms' | 'minimumOrder'>,
): TopTerms {
  if (terms.denied) return { leadTime: DENIED, paymentTerms: DENIED, minimumOrder: DENIED };
  if (terms.error) return { leadTime: NOT_READ, paymentTerms: NOT_READ, minimumOrder: NOT_READ };
  const reg = terms.register;
  if (!reg) return { leadTime: READING, paymentTerms: READING, minimumOrder: READING };

  const currency = reg.currency.code ?? null;
  const row = terms.row;
  if (!row) {
    // The register was read and holds no row for this vendor, so the house
    // has stated nothing about them: the record is all there is.
    const rec = (s: string) => (s === EM ? EM : `${s}${FROM_RECORD}`);
    return {
      leadTime: rec(fmtDays(provider.leadTimeDays)),
      paymentTerms: rec(provider.paymentTerms || EM),
      minimumOrder: rec(
        typeof provider.minimumOrder === 'number' ? fmtMoney(provider.minimumOrder, currency) : EM,
      ),
    };
  }

  const statedReadable = reg.sources.statedTerms.readable;
  return {
    leadTime: fromCell(row.leadTimeDays, fmtLeadTime, statedReadable),
    paymentTerms: fromCell(row.paymentTerms, (t) => t, statedReadable),
    minimumOrder: fromCell(row.minimumOrder, () => fmtMinimumCell(row.minimumOrder, currency), statedReadable),
  };
}
