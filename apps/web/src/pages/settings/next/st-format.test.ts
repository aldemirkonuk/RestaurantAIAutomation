/**
 * F-180 — the page's "who changed it" counts are derived, so they add up.
 *
 * The preamble once said "Fourteen registers … Six of these … The other four":
 * a literal keyed only on the connections flag, so the parts summed to ten.
 */

import { describe, expect, it } from 'vitest';
import { listed, recordSplit, sectionsFor } from './st-format';

describe('recordSplit', () => {
  it.each([false, true])('recorded + in part + not yet + "What changed here" is every register (connections %s)', (on) => {
    const { recorded, partly, notYet } = recordSplit(on);
    expect(recorded.length + partly.length + notYet.length + 1).toBe(sectionsFor(on).length);
    expect([...recorded, ...partly.map((p) => p.spec), ...notYet].some((s) => s.id === 'ledger')).toBe(false);
  });

  it('names the registers that record who changed them', () => {
    expect(recordSplit(true).recorded.map((s) => s.id)).toEqual([
      'team', 'features', 'vendor-terms', 'thresholds', 'currency', 'carrying-cost', 'time-zone', 'mail-reading',
    ]);
  });

  // F-785: organizations.service.ts files a house's state or country change
  // with the person who made it (register "state-and-country", ADR 0289), so
  // Locations is recorded in part — not "no record", and not the whole register.
  it('qualifies Locations as recorded for state and country only', () => {
    expect(recordSplit(true).partly.map((p) => [p.spec.id, p.only])).toEqual([['locations', 'a house’s state and country']]);
  });

  it('leaves the collapsed connection registers out when /connections carries them', () => {
    expect(recordSplit(true).notYet.map((s) => s.id)).toEqual(['notifications', 'measurement', 'map', 'cellar']);
  });
});

describe('listed', () => {
  it('joins with commas and a final "and"', () => {
    expect(listed(['A'])).toBe('A');
    expect(listed(['A', 'B'])).toBe('A and B');
    expect(listed(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
