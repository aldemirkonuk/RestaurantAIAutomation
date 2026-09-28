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
import { handOf, heldBy, receiptFor } from './rec-format';

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

/**
 * Founder item 87, 2026-09-28 (OD-176, ADR 0191): "Show card, hand to manager
 * (Recommended)". A staff member keeps a Promotions-bound card, but its hand
 * is a manager's and it carries no Act control, because `GET /promotions` is
 * owner/manager only and the shell's rooms table hides the room from staff.
 * `heldBy` reads the gate from that table (`rooms.ts` `minRole`), so the card
 * and the rail cannot disagree about who may open Promotions.
 */
describe('heldBy — whose hand, for the person looking (founder item 87, OD-176)', () => {
  const PROMOTIONS = [
    handOf('dead_stock_capital', 'inventory'),
    handOf('puzzle_activation', 'efficiency'),
    handOf('pairing_promotion', 'basket'),
    // the category fallback: a basket rule this page has no hand filed for
    handOf('a_basket_rule_not_filed_by_name', 'basket'),
  ];

  it('every Promotions-bound hand is a manager’s for staff, and not theirs to open', () => {
    for (const h of PROMOTIONS) {
      expect(h.where).toBe('Promotions');
      expect(heldBy(h, 'staff')).toEqual({
        yours: false,
        words: 'A manager’s, in Promotions',
        opens: 'an owner or manager',
      });
    }
  });

  it('owners and managers are unchanged: yours, in Promotions', () => {
    for (const h of PROMOTIONS) {
      for (const role of ['owner', 'manager'] as const) {
        expect(heldBy(h, role)).toEqual({ yours: true, words: 'Yours, in Promotions', opens: null });
      }
    }
  });

  it('a role not yet known, or not one the shell knows, is read as staff — it fails closed', () => {
    for (const h of PROMOTIONS) expect(heldBy(h, null).yours).toBe(false);
  });

  it('Promotions is the only hand-off the rooms table keeps from staff today', () => {
    // Every rule the page files a hand for by name, and every category
    // fallback. If a room one of these lands in gains a minRole, this fails,
    // and the new "a manager’s" card is a change someone has to look at.
    const rules = [
      'stockout_imminent', 'dead_stock_capital', 'plowhorse_repricing', 'puzzle_activation',
      'vendor_concentration', 'revenue_concentration', 'spend_acceleration', 'pairing_promotion',
      'staff_spread', 'margin_to_target', 'margin_advice_blind', 'margin_target_unset',
      'price_locks_to_review', 'goal_behind_x',
    ];
    const categories = [
      'inventory', 'purchasing', 'risk', 'sales', 'efficiency', 'staff', 'basket', 'goals', 'unfiled',
    ];
    const hands = [
      ...rules.map((r) => handOf(r, '')),
      ...categories.map((c) => handOf('a_rule_not_filed_by_name', c)),
    ];
    const keptFromStaff = new Set(hands.filter((h) => !heldBy(h, 'staff').yours).map((h) => h.where));
    expect([...keptFromStaff]).toEqual(['Promotions']);
    for (const h of hands.filter((x) => x.where !== 'Promotions')) {
      expect(heldBy(h, 'staff')).toEqual({ yours: true, words: `Yours, in ${h.where}`, opens: null });
    }
  });
});
