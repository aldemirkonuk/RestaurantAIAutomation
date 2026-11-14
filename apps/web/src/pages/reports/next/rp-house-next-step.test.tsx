/**
 * r36 reports audit, gap 5, the house slice (r40): the house registers' empty
 * sentences end with where their figures come from, and "What to buy back"
 * no longer calls a house with no consumption "a real answer".
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { quadrants, restock, type QuadrantRegister, type RestockRegister } from './rp-registers-house';
import { NextStep } from './rp-next-step';

const ctx = { days: 30, currency: 'TRY' } as never;

function shown(say: ReactNode) {
  const { container } = render(<MemoryRouter>{say}</MemoryRouter>);
  return container.textContent ?? '';
}
const href = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href');
const links = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'));

const restockView = (raw: object) =>
  restock.view(restock.select(raw) as RestockRegister, ctx);
const BASE = {
  params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 },
  skuCount: 3,
  reorderCount: 0,
  reorderList: [],
};
const row = {
  id: 'x',
  name: 'Efes Pilsen 50 cl',
  onHand: 0,
  daysOfCover: null,
  reorderPoint: 0,
  safetyStock: 0,
  stockoutProbability: 0,
};

describe('what to buy back says where its figures come from', () => {
  it('[REVERT-FAILS] no good on the register sends the reader to Inventory', () => {
    const text = shown(restockView({ ...BASE, skuCount: 0 }).say);
    expect(text).toContain('No good came back from the inventory register');
    expect(href(/Add the house's goods on Inventory/)).toBe('/inventory');
  });

  it('[REVERT-FAILS] goods but no consumption line: not "a real answer", and the consumption step', () => {
    const text = shown(restockView({ ...BASE, unitsCoverage: { lines: 0 } }).say);
    expect(text).toContain(
      'No consumption line was recorded in the last 90 days, so no good has a demand to set a reorder point from, and nothing here can say what will run out.',
    );
    expect(text).not.toContain('real answer');
    expect(links()).toEqual(['/settings?tab=pos', '/inventory']);
  });

  it('the window in the sentence is the register\'s own', () => {
    const text = shown(
      restockView({ ...BASE, params: { ...BASE.params, demandWindowDays: 60 }, unitsCoverage: { lines: 0 } }).say,
    );
    expect(text).toContain('in the last 60 days');
  });

  it('[REVERT-FAILS] no consumption wins over a list of zero-stock goods at a reorder point of 0', () => {
    const v = restockView({ ...BASE, reorderCount: 1, reorderList: [row], unitsCoverage: { lines: 0 } });
    expect(v.table).toBeUndefined();
    expect(shown(v.say)).toContain('No consumption line was recorded');
  });

  it('a house with consumption and nothing below its point keeps the real answer, with no link', () => {
    const v = restockView({ ...BASE, unitsCoverage: { lines: 12 } });
    expect(v.say).toBe(
      'Nothing is below its reorder point. That is a real answer about 3 goods, not an empty register.',
    );
  });

  it('a payload that does not say how many lines it read claims nothing from it', () => {
    expect(restockView({ ...BASE }).say).toBe(
      'Nothing is below its reorder point. That is a real answer about 3 goods, not an empty register.',
    );
  });
});

describe('margin against movement says a margin needs a price and a cost', () => {
  const quad = (raw: object) => quadrants.view(quadrants.select(raw) as QuadrantRegister, ctx);

  it('[REVERT-FAILS] no good with both sends the reader to Menu for prices and Orders for costs', () => {
    const text = shown(
      quad({ medians: {}, counts: { unclassified: 2 }, items: [{ id: 'a', name: 'A', velocityPerDay: 1, marginPerBottle: null }] }).say,
    );
    expect(text).toContain('No wine on the list carries both a recorded cost and a menu price');
    expect(text).toContain('2 wines are unclassified for that reason');
    expect(href(/Put the menu's prices on Menu/)).toBe('/menu');
    expect(href(/record a delivery on Orders/)).toBe('/orders');
  });

  it('a list with a margin carries no step', () => {
    const v = quad({
      medians: { velocityPerDay: 1, marginPerBottle: 10 },
      counts: { star: 1 },
      items: [{ id: 'a', name: 'A', velocityPerDay: 1, marginPerBottle: 10, quadrant: 'star' }],
    });
    expect(v.say).toBeUndefined();
  });
});

describe('the two new steps', () => {
  it('goods', () => {
    expect(shown(<NextStep source="goods" />)).toBe(
      "Goods are what the house buys and sells. Add the house's goods on Inventory",
    );
  });

  it('margin', () => {
    expect(shown(<NextStep source="margin" />)).toBe(
      "A margin is a menu price less a recorded cost. Put the menu's prices on Menu, and record a delivery on Orders for the costs.",
    );
  });
});
