/**
 * r110 drinks-g7: Plan prep's lists move when a typed serve inserts a row mid-list (FLIP, 180 ms, the house curve; a new
 * row fades in over 150 ms), and stay still when only a figure changes. Reduced motion: no animation at all (ADR 0112).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DrinkCard } from '../../../../services/api/recipes';
import { rowIds, planPrep } from './prepPlan';

const RID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({ apiClient: { get: h.get }, getErrorStatus: () => null }));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: RID, activeRole: 'staff', user: { userId: 'u', role: 'staff' } }) }));

import PlanPrep from './PlanPrep';

const drink = (id: string, name: string, good: string, inv: string): DrinkCard => ({
  cocktailId: id, name, section: null, glass: null, method: null, garnish: null, yieldServes: 1, version: 1, versionDate: null,
  lines: [{ label: good, qty: 30, unit: 'ml', name: good, role: 'stocked', inventoryId: inv, componentId: null, qtyBase: 300, baseUnit: 'ml10', usablePct: null }],
  allergens: { readable: false },
});
// Goods sort by name: Appleton rum, Maker's, Plymouth gin.
const cards = { drinks: [drink('a', 'Daiquiri', 'Appleton rum', 'r1'), drink('b', 'Old Fashioned', "Maker's", 'w1'), drink('c', 'Negroni', 'Plymouth gin', 'g1')], components: [] };

let reduced = false;
const animate = vi.fn();
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  reduced = false;
  animate.mockReset();
  window.localStorage.clear();
  (Element.prototype as unknown as { animate: unknown }).animate = animate;
  window.matchMedia = ((q: string) => ({ matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const row = this.closest('li[data-row]');
    const at = row ? Array.from(row.parentElement!.children).indexOf(row) * 40 : 0;
    return { top: at, bottom: at + 40, left: 0, right: 0, width: 0, height: 40, x: 0, y: at, toJSON() {} } as DOMRect;
  };
  h.get.mockReset().mockImplementation(async (url: string) => {
    if (url === '/settings/currency') return { data: { restaurantId: RID, code: 'GBP', country: null, readable: true, reason: null, statedAt: null } };
    if (url === '/settings/time-zone') return { data: { restaurantId: RID, zone: null, readable: true } };
    return { data: cards };
  });
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
});

async function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><PlanPrep /></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByTestId('prep-open'));
  const serve = async (name: string, n: string) => fireEvent.change(await screen.findByLabelText(name), { target: { value: n } });
  await serve('Daiquiri', '4');
  await serve('Negroni', '4'); // rum and gin: two rows
  animate.mockClear(); // the first rows arriving do not animate
  return serve;
}

describe('the lists\' order key (r110 drinks-g7)', () => {
  it('changes when a serve inserts a row, not when only a figure changes', () => {
    const at = (a: number, b: number, c: number) => rowIds(planPrep(cards.drinks, cards.components, { a, b, c })).pull.join('\n');
    expect(at(4, 0, 4)).toBe(at(40, 0, 7));
    expect(at(4, 5, 4)).not.toBe(at(4, 0, 4));
  });
});

describe('Plan prep lists move when a row is inserted (r110 drinks-g7)', () => {
  it('slides the row below the insert over 180 ms on the house curve and fades the new row over 150 ms, ease-out', async () => {
    const serve = await open();
    await serve('Old Fashioned', '2'); // Maker's lands between rum and gin
    const calls = animate.mock.calls as [Keyframe[], KeyframeAnimationOptions][];
    const slide = calls.filter(([k]) => 'transform' in k[0]);
    const fade = calls.filter(([k]) => 'opacity' in k[0]);
    expect(slide).toHaveLength(1); // the gin row, pushed down 40 px
    expect(slide[0][0][0]).toEqual({ transform: 'translateY(-40px)' });
    expect(slide[0][1]).toMatchObject({ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    expect(fade).toHaveLength(1);
    expect(fade[0][0]).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(fade[0][1]).toMatchObject({ duration: 150, easing: 'ease-out' });
  });

  it('does not animate when only a figure changes', async () => {
    const serve = await open();
    await serve('Daiquiri', '40');
    await serve('Negroni', '7');
    expect(animate).not.toHaveBeenCalled();
  });

  it('a row that leaves is gone at once: nothing animates for it but the rows that moved up', async () => {
    const serve = await open();
    await serve('Old Fashioned', '2');
    animate.mockClear();
    await serve('Old Fashioned', '0');
    const calls = animate.mock.calls as [Keyframe[], KeyframeAnimationOptions][];
    expect(calls.filter(([k]) => 'opacity' in k[0])).toHaveLength(0);
    expect(calls.filter(([k]) => 'transform' in k[0])).toHaveLength(1);
  });

  it('under reduced motion nothing animates, no slide and no fade', async () => {
    const serve = await open();
    reduced = true;
    await serve('Old Fashioned', '2');
    expect(animate).not.toHaveBeenCalled();
  });
});
