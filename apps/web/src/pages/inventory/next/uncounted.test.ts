/**
 * Inventory r36, gap 1: a good nobody has counted or received is "Not counted
 * yet", never "Out". The books start every good at 0 (`stock_live DEFAULT 0`),
 * so a menu scan used to file every title it read in under Out on day 1.
 */
import { describe, expect, it } from 'vitest';
import { chipMatch, countDue, mapTone, readSentence, severity, standingOf, toRow, type InvRow } from './useInventoryNextData';
import { statusWord } from './InventoryTable';
import type { InventoryItem as ApiItem } from '../../../services/api/types';

const EUR = { state: 'recorded', code: 'EUR' } as const;

function item(over: Record<string, unknown> = {}): ApiItem {
  return { id: 'i1', stockLive: 0, thresholdMin: 6, lastCountedAt: null, ...over } as unknown as ApiItem;
}

function rows(spec: Array<[string, Record<string, unknown>]>): InvRow[] {
  return spec.map(([id, over]) => toRow(item({ id, ...over })));
}

describe('a 0 nothing ever moved is not out', () => {
  it('reads "uncounted" only when the gateway says it never moved and nothing counted it', () => {
    expect(toRow(item({ neverMoved: true })).standing).toBe('uncounted');
    expect(toRow(item({ neverMoved: false })).standing).toBe('out');
    // a failed read (null) and an older gateway (absent) say nothing: a 0 stays out
    expect(toRow(item({ neverMoved: null })).standing).toBe('out');
    expect(toRow(item()).standing).toBe('out');
    // a count is a count, whatever the flag says
    expect(toRow(item({ neverMoved: true, lastCountedAt: '2026-11-10T09:00:00Z' })).standing).toBe('out');
    // stock on the shelf reads against its par as before
    expect(toRow(item({ neverMoved: true, stockLive: 3 })).standing).toBe('below');
  });

  it('standingOf keeps every other reading as it was', () => {
    expect(standingOf(0, 6)).toBe('out');
    expect(standingOf(0, 6, false)).toBe('out');
    expect(standingOf(-1, 6, true)).toBe('uncounted');
    expect(standingOf(null, 6, true)).toBe('unknown');
    expect(standingOf(6, 6, true)).toBe('at');
    expect(standingOf(2, 0, true)).toBe('nopar');
  });

  it('is not filed under Out, is not the Out chip, and is due a count', () => {
    const r = toRow(item({ neverMoved: true }));
    expect(severity(r)).toBe(2);
    expect(chipMatch(r, 'out')).toBe(false);
    expect(countDue(r)).toBe(true);
    expect(statusWord(r)).toBe('Not counted yet');
    expect(statusWord(toRow(item({ neverMoved: false })))).toBe('Out');
  });

  it('the map tints it as unread, not as out', () => {
    expect(mapTone({ liveStock: 0, threshold: 6, neverMoved: true } as never)).toBe('neutral');
    expect(mapTone({ liveStock: 0, threshold: 6 } as never)).toBe('rose');
    expect(mapTone({ liveStock: 0, threshold: 6, neverMoved: false } as never)).toBe('rose');
  });
});

describe('the read sentence after a menu scan', () => {
  it('a book of goods nobody has counted says so, and never "out"', () => {
    const s = readSentence(rows([['a', { neverMoved: true }], ['b', { neverMoved: true }], ['c', { neverMoved: true }]]), EUR, true);
    expect(s).toContain('None of the 3 has been counted or received yet, so their stock is not known; count them to start.');
    expect(s).not.toMatch(/\bout\b/);
    expect(s).not.toContain('Nothing is');
  });

  it('one good alone is "it"', () => {
    const s = readSentence(rows([['a', { neverMoved: true }]]), EUR, true);
    expect(s).toContain('It has not been counted or received yet, so its stock is not known; count it to start.');
  });

  it('a mixed book counts the real outs apart from the uncounted ones', () => {
    const s = readSentence(
      rows([
        ['a', { neverMoved: true }],
        ['b', { neverMoved: true }],
        ['c', { neverMoved: false }],
        ['d', { stockLive: 12, neverMoved: false }],
      ]),
      EUR,
      true,
    );
    expect(s).toContain('1 is out.');
    expect(s).toContain('2 have not been counted or received yet, so their stock is not known.');
  });

  it('one uncounted among counted goods is "One"', () => {
    const s = readSentence(rows([['a', { neverMoved: true }], ['d', { stockLive: 12, neverMoved: false }]]), EUR, true);
    expect(s).toContain('Nothing is out or below par.');
    expect(s).toContain('One has not been counted or received yet, so its stock is not known.');
  });

  it('says nothing about counting when every good was counted or moved', () => {
    const s = readSentence(rows([['c', { neverMoved: false }], ['d', { stockLive: 12, neverMoved: false }]]), EUR, true);
    expect(s).not.toContain('counted or received');
    expect(s).toContain('1 is out.');
  });
});
