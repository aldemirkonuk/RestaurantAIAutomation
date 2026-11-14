/**
 * Where "Usage a day" comes from, in words (inventory r36 audit, gaps 10 and
 * 11): a one-day sales window is said as one, and a counted good's use says a
 * write-off is inside it rather than taken out.
 */
import { describe, expect, it } from 'vitest';
import type { InvRow } from './useInventoryNextData';
import { lastDays, usageSaid } from './ItemCards';

function row(over: Partial<InvRow>): InvRow {
  return { analyticsReadable: true, usageSource: null, usageSince: null, usageUntil: null, usageQty: null, ...over } as InvRow;
}

describe('lastDays', () => {
  it('says one day as one', () => {
    expect(lastDays(1)).toBe('the last day');
    expect(lastDays(2)).toBe('the last 2 days');
    expect(lastDays(30)).toBe('the last 30 days');
  });
});

describe('usageSaid', () => {
  it('a good sold on its first day says the last day', () => {
    const r = row({ usageSource: 'sales', usageSince: '2026-11-11T09:00:00Z', usageUntil: '2026-11-12T09:00:00Z', usageQty: 2 });
    expect(usageSaid(r, 'bottle')).toBe('2 bottles sold in the last day, from the stock ledger, less voids.');
  });

  it('a good with no quantity says the window alone', () => {
    const r = row({ usageSource: 'sales', usageSince: '2026-11-10T09:00:00Z', usageUntil: '2026-11-12T09:00:00Z' });
    expect(usageSaid(r, 'bottle')).toBe('Sold over the last 2 days, from the stock ledger, less voids.');
  });

  it('a counted good says what the count identity is, and that a write-off is part of it', () => {
    const r = row({ usageSource: 'counts', usageSince: '2026-11-01T09:00:00Z', usageUntil: '2026-11-11T09:00:00Z', usageQty: 3000 });
    const t = usageSaid(r, 'g') ?? '';
    expect(t).toContain('(10 days): the first count, plus what was received, less the last count.');
    expect(t).toContain('What was written off or found short between them is part of it.');
    expect(t).not.toContain('with what was received, written off and found short');
  });

  it('counts a day apart say one day', () => {
    const r = row({ usageSource: 'counts', usageSince: '2026-11-10T09:00:00Z', usageUntil: '2026-11-11T09:00:00Z', usageQty: 300 });
    expect(usageSaid(r, 'g')).toContain('(1 day):');
  });
});
