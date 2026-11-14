/**
 * A line's status in the house's words (onboarding walk 2026-11-12, r12
 * finding 10): "flagged" printed raw, with nothing to say what it meant.
 * The page-level case is in MenuNext.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { lineStatusWords } from './menu-line-status';

describe('lineStatusWords', () => {
  it('a dish set by hand says its price, never a bottle (r33 walk)', () => {
    const set = (flag_field: string) =>
      lineStatusWords({ status: 'flagged', source: 'csv', flag_reason: 'corrected', flag_field }, { dish: true });
    expect(set('bottle_price')).toMatchObject({ words: 'set by hand: its price', why: 'A manager set its price after the menu was read. Nothing more is needed.' });
    expect(set('by_glass_price').words).toBe('set by hand: its glass-column price');
    expect(set('name').words).toBe('set by hand: its name');
  });

  it('says why a line is flagged, from the reason the gateway sends', () => {
    expect(lineStatusWords({ status: 'flagged', source: 'manual', flag_reason: 'corrected', flag_field: 'category' })).toMatchObject({
      words: 'set by hand: its section',
      sealed: true,
    });
    expect(lineStatusWords({ status: 'flagged', source: 'scan', flag_reason: 'corrected', flag_field: 'bottle_price' }).words).toBe(
      'set by hand: its bottle price',
    );
    expect(lineStatusWords({ status: 'flagged', source: 'scan', flag_reason: 'added_by_hand' })).toMatchObject({ words: 'added by hand', sealed: true });
    expect(lineStatusWords({ status: 'flagged', source: 'manual', flag_reason: 'past_free_limit' })).toMatchObject({
      words: "past the free plan's typed lines",
      sealed: false,
      noteShown: true,
    });
    // An older gateway sends no reason: still no bare "flagged".
    expect(lineStatusWords({ status: 'flagged', source: 'scan' }).words).toBe('marked for a second look');
  });

  it('says how a line arrived when nothing is wrong with it, and never prints a raw status', () => {
    expect(lineStatusWords({ status: 'approved', source: 'manual' }).words).toBe('as typed');
    expect(lineStatusWords({ status: 'approved', source: 'csv' }).words).toBe('as imported');
    expect(lineStatusWords({ status: 'approved', source: 'scan' }).words).toBe('as read');
    expect(lineStatusWords({ status: 'in_review', source: 'scan' }).words).toBe('waiting for a second look');
    for (const s of ['approved', 'in_review', 'flagged'] as const)
      for (const r of ['corrected', 'added_by_hand', 'past_free_limit', 'unknown', null] as const)
        expect(lineStatusWords({ status: s, source: 'scan', flag_reason: r }).words).not.toMatch(/flagged|in_review|approved/);
  });
});
