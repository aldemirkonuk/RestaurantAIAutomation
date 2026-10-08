/**
 * F-180 — the page's "who changed it" counts are derived, so they add up.
 *
 * The preamble once said "Fourteen registers … Six of these … The other four":
 * a literal keyed only on the connections flag, so the parts summed to ten.
 */

import { describe, expect, it } from 'vitest';
import { listed, recordSplit, sectionsFor } from './st-format';

describe('recordSplit', () => {
  it.each([false, true])('recorded + not yet + "What changed here" is every register (connections %s)', (on) => {
    const { recorded, notYet } = recordSplit(on);
    expect(recorded.length + notYet.length + 1).toBe(sectionsFor(on).length);
    expect([...recorded, ...notYet].some((s) => s.id === 'ledger')).toBe(false);
  });

  it('names the registers that record who changed them', () => {
    expect(recordSplit(true).recorded.map((s) => s.id)).toEqual([
      'team', 'features', 'vendor-terms', 'thresholds', 'currency', 'carrying-cost', 'time-zone', 'mail-reading',
    ]);
  });

  it('leaves the collapsed connection registers out when /connections carries them', () => {
    expect(recordSplit(true).notYet.map((s) => s.id)).toEqual(['notifications', 'locations', 'measurement', 'map', 'cellar']);
  });
});

describe('listed', () => {
  it('joins with commas and a final "and"', () => {
    expect(listed(['A'])).toBe('A');
    expect(listed(['A', 'B'])).toBe('A and B');
    expect(listed(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
