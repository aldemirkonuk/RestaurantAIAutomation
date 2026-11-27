/**
 * r100 (r99 walk check 3): the drawer's Cost and Waste cards hold the height of their tallest settled
 * state, so the answered sentence does not push the grid down (375 in-sheet CLS 0.0244 / 0.0436 reduced).
 * jsdom has no layout: the hold's presence per state and the stylesheet's per-breakpoint heights are pinned.
 * A costed good (a trend line beside its sparkline) is not over-held: only the sentence states hold tall.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ItemCards from './ItemCards';
import type { InvRow } from './useInventoryNextData';

const row = (over: Partial<InvRow> = {}) =>
  ({ id: 'i1', kind: 'wine', stock: 12, wac: 40, value: 480, analyticsReadable: true, velocity: 1, runway: 12, usageSource: null, openMl: null, costProvenance: 'invoice', ...over }) as InvRow;
const currency = { code: 'USD' } as never;
const inside = { status: 'reading' } as const;
const ready = { status: 'ready', data: { waste: { readable: true, qty30d: 0, given30d: 0, value30d: null, source: 'Nothing written off.' }, countGap: { readable: true, last: [], source: 'x' }, costTrend: { readable: true, points: null, changePct: null, source: 'No received lot has a cost yet.' } } } as never;
const reading = { status: 'reading' } as const;

function draw(over: Partial<InvRow>, figures: never, canManage = true) {
  cleanup();
  render(<ItemCards row={row(over)} uom="bottle" kind="wine" canManage={canManage} currency={currency} figures={figures} inside={inside} open={null} onOpen={() => {}} />);
}
const hold = (id: string) => screen.getByTestId(`ivd-card-${id}`).getAttribute('data-hold');
afterEach(cleanup);

describe('Cost and Waste hold their settled height', () => {
  it('a good with no cost yet holds Cost tall while reading and once answered (the sentence lands in the same room)', () => {
    draw({ wac: null }, reading as never);
    expect(hold('cost')).toBe('tall');
    draw({ wac: null }, ready);
    expect(hold('cost')).toBe('tall');
  });

  it('a costed good is not over-held: its trend is one line beside the sparkline', () => {
    draw({ wac: 40 }, reading as never);
    expect(hold('cost')).toBeNull();
    expect(hold('usage')).toBeNull();
  });

  it('staff see no cost sentence, so no hold on Cost', () => {
    draw({ wac: null }, reading as never, false);
    expect(hold('cost')).toBeNull();
  });

  it('Waste holds tall reading and answered', () => {
    draw({}, reading as never);
    expect(hold('waste')).toBe('tall');
    draw({}, ready);
    expect(hold('waste')).toBe('tall');
  });
});

describe('the stylesheet holds the tallest settled height per breakpoint', () => {
  const css = readFileSync(resolve(__dirname, 'item-drawer.css'), 'utf8');
  it('139 px on the one-column phone sheet, 153 px in the two-column sheet', () => {
    expect(css).toMatch(/\.ivd-card\[data-hold='tall'\] \{\s*min-height: 139px;/);
    expect(css).toMatch(/@media \(min-width: 768px\) \{\s*\.ivd-card\[data-hold='tall'\] \{\s*min-height: 153px;/);
  });
});

describe('a failed lot-rollup read leaves the cost and value cards unread (r103)', () => {
  const unreadRow = { rollupReadable: false, wac: null, value: null, costProvenance: null } as Partial<InvRow>;

  it('Cost and Value say they could not be read, never "No cost yet"', () => {
    draw(unreadRow, reading as never);
    expect(screen.getByTestId('ivd-card-cost').textContent).toContain('could not be read');
    expect(screen.getByTestId('ivd-card-cost').textContent).not.toContain('No cost yet');
    expect(screen.getByTestId('ivd-card-value').textContent).toContain('could not be read');
    expect(screen.getByTestId('ivd-card-value').textContent).not.toContain('No cost yet');
  });

  it('an unread cost does not take the tall room a sentence needs', () => {
    draw(unreadRow, reading as never);
    expect(hold('cost')).toBeNull();
  });

  it('a read house with no cost still says "No cost yet"', () => {
    draw({ rollupReadable: true, wac: null, value: null }, reading as never);
    expect(screen.getByTestId('ivd-card-cost').textContent).toContain('No cost yet');
    expect(screen.getByTestId('ivd-card-value').textContent).toContain('No cost yet');
  });
});
