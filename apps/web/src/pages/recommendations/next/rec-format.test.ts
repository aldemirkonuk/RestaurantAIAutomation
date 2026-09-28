/**
 * `receiptFor` — the permanent, client-derived line under an entry (sketch
 * 120 item 3). Covers only the review-flagged regression: `receiptFor` must
 * stay silent on `status === 'dismissed'`. That leaf's own fuller sentence
 * (`dismissalSentence`, read from the row's real stored key) is rendered
 * directly in `Entry.tsx`; a prior version of `receiptFor` called
 * `dismissalSentence(e.ruleKey)` too, using the entry's plain rule key rather
 * than the composite stored key `dismissalSentence` actually needs — which
 * would have misreported a narrowly-scoped dismissal ("this one finding
 * about tuesday") as an unscoped, whole-rule silencing ("the rule X,
 * entirely — every subject, every day") the moment it rendered anywhere.
 */

import { describe, expect, it } from 'vitest';
import { receiptFor } from './rec-format';

function entry(over: Partial<Parameters<typeof receiptFor>[0]> = {}) {
  return {
    ruleKey: 'sales_below_weekday_baseline',
    status: 'active' as const,
    acted: false,
    pinned: false,
    snoozeUntil: null,
    ...over,
  };
}

describe('receiptFor', () => {
  it('stays silent on a dismissed entry — that leaf renders its own fuller sentence directly, from the real stored key', () => {
    const lines = receiptFor(entry({ status: 'dismissed' }), false);
    expect(lines).toEqual([]);
    // Specifically: never the unscoped "entirely" sentence a plain ruleKey
    // (not the composite stored key) would produce if this branch existed.
    expect(lines.join(' ')).not.toMatch(/entirely/);
  });

  it('still reports watched/pinned on an otherwise-silent dismissed entry, independent of the disposition', () => {
    const lines = receiptFor(entry({ status: 'dismissed', pinned: true }), true);
    expect(lines).toEqual([
      'Watched by a goal.',
      'Pinned. It leads the post too — the digest carries pinned entries first.',
    ]);
  });

  it('still reports the other dispositions unaffected by the dismissed fix', () => {
    expect(receiptFor(entry({ status: 'snoozed', snoozeUntil: '2026-09-20T07:00:00Z' }), false)[0]).toMatch(
      /^Snoozed/,
    );
    expect(receiptFor(entry({ status: 'done' }), false)[0]).toMatch(/^Sealed as ruled off/);
    expect(receiptFor(entry({ status: 'active', acted: true }), false)[0]).toMatch(/^Recorded as acted/);
  });
});
