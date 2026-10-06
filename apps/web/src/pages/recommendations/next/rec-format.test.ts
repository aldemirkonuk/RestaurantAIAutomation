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
import { handOf, heldBy, receiptFor, stakeFilingOf, stakeOf } from './rec-format';
import { actOf } from './rec-docket';

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

/**
 * ADR 0288 (AW28). The register promises "what acting on an entry would
 * change". The engine's category is a different fact, and for its two
 * `efficiency` rules it filed a price change and a bottle moved under The
 * floor — so with Money pressed, "Price it" left out a price change. The
 * founder, 2026-10-04: "Money / Stock (Recommended)"; and for the two rules
 * the lane asked about next, revenue_concentration "Stock (Recommended)" and
 * weekday_gap "The floor (Recommended)".
 */
describe('the register — filed by what acting on it changes (ADR 0288)', () => {
  /**
   * Every rule the engine names, with the category it emits, read from
   * `apps/api-gateway/src/analytics/recommendations.service.ts` (`rule(…)`
   * and its `category:`), plus one of the goal-behind family. The claim row
   * ADR-0288-PRICE-AND-STOCK-FILED-BY-WHAT-THEY-CHANGE re-reads the engine
   * itself, so a new rule with an unmapped category fails CI, not only here.
   */
  const ENGINE_RULES: Array<[string, string]> = [
    ['sales_below_weekday_baseline', 'sales'],
    ['weekly_demand_slide', 'sales'],
    ['stockout_imminent', 'inventory'],
    ['dead_stock_capital', 'inventory'],
    ['plowhorse_repricing', 'efficiency'],
    ['puzzle_activation', 'efficiency'],
    ['margin_target_unset', 'pricing'],
    ['margin_to_target', 'pricing'],
    ['pour_size_unconfirmed', 'pricing'],
    ['price_locks_to_review', 'pricing'],
    ['margin_advice_blind', 'pricing'],
    ['vendor_concentration', 'risk'],
    ['revenue_concentration', 'risk'],
    ['weekday_gap', 'sales'],
    ['spend_acceleration', 'purchasing'],
    ['staff_spread', 'staff'],
    ['pairing_promotion', 'basket'],
    ['goal_behind_x', 'goals'],
  ];

  it('files the price change under Money and the bottle moved under Stock, not The floor', () => {
    expect(stakeOf('plowhorse_repricing', 'efficiency')).toBe('money');
    expect(stakeOf('puzzle_activation', 'efficiency')).toBe('stock');
  });

  it('files the top sellers’ buffer under Stock and the weekday move under The floor, by name', () => {
    // The founder, 2026-10-04: "Stock (Recommended)" and "The floor (Recommended)".
    expect(stakeOf('revenue_concentration', 'risk')).toBe('stock');
    expect(stakeOf('weekday_gap', 'sales')).toBe('floor');
    expect(stakeOf('weekday_gap#*#fire:week:2026-W40', null)).toBe('floor');
    const buffer = stakeFilingOf('revenue_concentration', 'risk');
    expect(buffer.by).toBe('rule');
    expect(buffer.why).toMatch(/Protect the top sellers’ stock first/);
    const gap = stakeFilingOf('weekday_gap', 'sales');
    expect(gap.by).toBe('rule');
    expect(gap.why).toMatch(/leads with “Move staff training, deliveries, and inventory counts/);
    // their categories still file every other rule as before
    expect(stakeOf('vendor_concentration', 'risk')).toBe('vendors');
    expect(stakeOf('sales_below_weekday_baseline', 'sales')).toBe('money');
    expect(stakeOf('weekly_demand_slide', 'sales')).toBe('money');
  });

  it('reads the rule out of a composite stored key, so the leaves file as the book does', () => {
    // A row on Snoozed / Dismissed / History carries the stored key (ADR 0191).
    expect(stakeOf('plowhorse_repricing#*#fire:week:2026-W40', 'efficiency')).toBe('money');
    expect(stakeOf('plowhorse_repricing#*#fire:week:2026-W40', '')).toBe('money');
    expect(stakeOf('puzzle_activation#*#fire:week:2026-W40', null)).toBe('stock');
  });

  it('a new efficiency rule lands in Unfiled, never in a register nobody sorted it into', () => {
    expect(stakeOf('a_new_efficiency_rule', 'efficiency')).toBe('unfiled');
    expect(stakeFilingOf('a_new_efficiency_rule', 'efficiency').by).toBe('unfiled');
    expect(stakeFilingOf('a_new_efficiency_rule', 'efficiency').why).toMatch(/no register for the rule a_new_efficiency_rule/);
  });

  it('no engine rule is unfiled; every Price it rule is Money and every Move stock rule is Stock', () => {
    const priced = ENGINE_RULES.filter(([k]) => actOf(k).act === 'price');
    const moved = ENGINE_RULES.filter(([k]) => actOf(k).act === 'stock');
    // not vacuous: the two rules the founder ruled on are in the two sets
    expect(priced.map(([k]) => k)).toContain('plowhorse_repricing');
    expect(moved.map(([k]) => k)).toContain('puzzle_activation');
    for (const [k, c] of ENGINE_RULES) expect([k, stakeOf(k, c)]).not.toEqual([k, 'unfiled']);
    for (const [k, c] of priced) expect([k, stakeOf(k, c)]).toEqual([k, 'money']);
    for (const [k, c] of moved) expect([k, stakeOf(k, c)]).toEqual([k, 'stock']);
  });

  it('says why: the rule’s own sentence when filed by name, the category when it fell back', () => {
    const plow = stakeFilingOf('plowhorse_repricing', 'efficiency');
    expect(plow.by).toBe('rule');
    expect(plow.why).toMatch(/Raise those prices/);
    const puzzle = stakeFilingOf('puzzle_activation', 'efficiency');
    expect(puzzle.by).toBe('rule');
    expect(puzzle.why).toMatch(/by-the-glass/);
    const stockout = stakeFilingOf('stockout_imminent', 'inventory');
    expect(stockout).toMatchObject({ stake: 'stock', by: 'category' });
    expect(stockout.why).toMatch(/category, inventory/);
  });
});

/**
 * ADR 0288, audit of PR #611. The tables are object literals, so a plain
 * `table[key]` answers a stored key that names something on
 * `Object.prototype` (`constructor`, `__proto__`, `toString`, `valueOf`) with
 * an inherited value instead of nothing. The register then filed such an
 * entry as `{ stake: undefined, why: undefined }`: the working read "Why it
 * would change undefined" and the entry fell out of every register count,
 * Unfiled included. `setAction` rejects only an empty `ruleKey`, so such a
 * key can reach the Snoozed, Dismissed and History leaves. Each table is now
 * read by its own rows only, and such a key is an unknown rule.
 */
describe('a key named on Object.prototype is an unknown rule, never an inherited row (ADR 0288)', () => {
  const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'valueOf'];

  it.each(PROTO_KEYS)('the register files the rule %s under Unfiled, with a why', (key) => {
    const filing = stakeFilingOf(key, null);
    expect(filing).toEqual({ stake: 'unfiled', by: 'unfiled', why: expect.any(String) });
    expect(filing.why).toContain(`no register for the rule ${key}`);
    // a category no register knows changes nothing
    expect(stakeFilingOf(key, 'efficiency')).toMatchObject({ stake: 'unfiled', by: 'unfiled' });
    // nor does a composite stored key on the leaves (ADR 0191)
    expect(stakeOf(`${key}#*#fire:week:2026-W40`, null)).toBe('unfiled');
  });

  it('a rule key named on Object.prototype still files by a category the page knows', () => {
    expect(stakeFilingOf('valueOf', 'inventory')).toMatchObject({ stake: 'stock', by: 'category' });
    expect(stakeFilingOf('constructor', 'pricing')).toMatchObject({ stake: 'money', by: 'category' });
  });

  it.each(['constructor', '__proto__', 'toString'])('a category named %s files under Unfiled, with a why', (cat) => {
    const filing = stakeFilingOf('a_rule_not_filed_by_name', cat);
    expect(filing).toEqual({ stake: 'unfiled', by: 'unfiled', why: expect.any(String) });
    expect(filing.why).toContain(`or for its category, ${cat}`);
  });

  it.each(PROTO_KEYS)('the docket files the rule %s under its unfiled act, with a why', (key) => {
    const filing = actOf(key);
    expect(filing.act).toBe('unfiled');
    expect(filing.why).toContain(`no act filed for the rule ${key}`);
  });

  it.each(PROTO_KEYS)('the hand of the rule %s falls back to its category, then Reports', (key) => {
    expect(handOf(key, 'inventory')).toMatchObject({ label: 'Open Inventory', where: 'Inventory' });
    expect(handOf(key, 'inventory').href).toMatch(/^\/inventory\?rec=/);
    expect(handOf(key, key)).toMatchObject({ label: 'Open Reports', where: 'Reports' });
    expect(handOf(key, key).href).toMatch(/^\/reports\?rec=/);
  });
});
