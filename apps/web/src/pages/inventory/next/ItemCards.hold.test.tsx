/**
 * r100 (r99 walk check 3): the drawer's Cost and Waste cards hold the height of their tallest settled
 * state, so the answered sentence does not push the grid down (375 in-sheet CLS 0.0244 / 0.0436 reduced).
 * jsdom has no layout: the hold's presence per state and the stylesheet's per-breakpoint heights are pinned.
 * The gateway's cost trend is always the long sentence (COST_TREND_NOT_KEPT), so a costed owner good holds Cost tall too (r103).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemCards from './ItemCards';
import ItemUsedIn from './ItemUsedIn';
import type { InvRow } from './useInventoryNextData';

const row = (over: Partial<InvRow> = {}) =>
  ({ id: 'i1', kind: 'wine', stock: 12, wac: 40, value: 480, analyticsReadable: true, velocity: 1, runway: 12, usageSource: null, openMl: null, costProvenance: 'invoice', ...over }) as InvRow;
const currency = { code: 'USD' } as never;
const inside = { status: 'reading' } as const;
const ready = { status: 'ready', data: { waste: { readable: true, qty30d: 0, given30d: 0, value30d: null, source: 'Nothing written off.' }, countGap: { readable: true, last: [], source: 'x' }, costTrend: { readable: true, points: null, changePct: null, source: 'No received lot has a cost yet.' } } } as never;
const reading = { status: 'reading' } as const;
// The gateway's real cost trend (item-figures.service.ts COST_TREND_NOT_KEPT), for a costed good.
const NOT_KEPT = { readable: true, points: null, changePct: null, source: "What each delivery cost is not shown yet: no record here keeps a delivery's final price once its stock is used up or moved." };
const readyCosted = { status: 'ready', data: { waste: { readable: true, qty30d: 0, given30d: 0, value30d: null, source: 'Nothing written off.' }, countGap: { readable: true, last: [], source: 'x' }, costTrend: NOT_KEPT } } as never;

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

  it('a costed owner good holds Cost tall too: the gateway answers it with the same long sentence and no sparkline', () => {
    draw({ wac: 40 }, reading as never);
    expect(hold('cost')).toBe('tall');
    draw({ wac: 40 }, readyCosted);
    expect(hold('cost')).toBe('tall');
    expect(screen.getByTestId('ivd-card-cost').textContent).toContain('What each delivery cost is not shown yet');
    expect(hold('usage')).toBeNull();
  });

  it('staff see no cost sentence, so no hold on Cost, costed or not (the attribute must not reveal a cost)', () => {
    draw({ wac: null }, reading as never, false);
    expect(hold('cost')).toBeNull();
    draw({ wac: 40 }, readyCosted, false);
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

describe('a hold ends when the reading settles (r107 g3)', () => {
  const css = readFileSync(resolve(__dirname, 'item-drawer.css'), 'utf8');
  const eur = { state: 'recorded', code: 'EUR' } as never;
  const usedIn = { status: 'ready', data: { item: { id: 'i1', kind: 'spirit', displayName: null }, soldAs: { readable: true, lines: [], source: 's' }, inCocktails: { readable: true, lines: [], source: 's' }, namedNotLinked: { readable: true, lines: [], source: 's' } } } as never;
  const dish = { dishId: 'd1', name: 'Plate', section: null, href: '/dishes?open=d1', yieldServes: 1, uses: [{ qtyEntered: 30, unitCode: 'g' }], cost: null, price: 12 };
  const mount = (dishes: never) => {
    cleanup();
    return render(
      <MemoryRouter>
        <ItemUsedIn load={usedIn} dishes={dishes} canManage currency={eur} onRetry={() => {}} onRetryDishes={() => {}} />
      </MemoryRouter>,
    );
  };

  it('a pending read still holds 52 / 52 / 156 px; the stylesheet says so', () => {
    expect(css).toMatch(/\.ivd-hold\[data-hold='used'\],\s*\.ivd-hold\[data-hold='dishes'\] \{\s*min-height: 52px;/);
    expect(css).toMatch(/\.ivd-hold\[data-hold='nutrition'\] \{\s*min-height: 156px;/);
    mount({ status: 'reading' } as never);
    expect(document.querySelector('.ivd-hold[data-hold="dishes"]')).not.toBeNull();
  });

  it('once the read has landed no hold element is left', () => {
    mount({ status: 'ready', data: { dishes: [] } } as never);
    expect(document.querySelector('.ivd-hold')).toBeNull();
  });

  it('a card drawn from a landed read carries no floor: it is marked settled and the stylesheet gives it min-height 0 after the 94 px rule', () => {
    mount({ status: 'ready', data: { dishes: [dish] } } as never);
    const card = screen.getByTestId('ivd-dish-d1-price');
    expect(card.getAttribute('data-settled')).toBe('true');
    expect(css).toMatch(/\.ivd-card\[data-settled='true'\] \{\s*min-height: 0;/);
    expect(css.indexOf("[data-settled='true']")).toBeGreaterThan(css.indexOf('min-height: 94px'));
  });
});
