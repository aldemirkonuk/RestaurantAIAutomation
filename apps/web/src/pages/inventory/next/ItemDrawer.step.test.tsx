/**
 * Step to the next or the previous good without closing the drawer (r108 g12): J/K and the arrows while focus is in
 * the sheet, two 44 px buttons that disable at the ends, one Sheet that stays up so focus stays on the pressed button,
 * and a stylesheet that enters the new body 160 ms from +12 px (next) or -12 px (previous), with none under reduced motion.
 * That ?open= is replaced, not pushed, is pinned in InventoryNext.test.tsx.
 */
import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InvRow } from './useInventoryNextData';
import type { HouseFields } from '../../../services/api/inventory';

const api = vi.hoisted(() => ({ figures: vi.fn(), usedIn: vi.fn(), nutrition: vi.fn(), dishes: vi.fn(), drinks: vi.fn(), taste: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: api.taste }));
vi.mock('../../../services/api/itemDishes', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemDishes: api.dishes,
  getItemDrinks: api.drinks,
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemFigures: api.figures,
  getItemUsedIn: api.usedIn,
  getItemNutrition: api.nutrition,
}));
vi.mock('./RowDropdown', () => ({ default: () => <div data-testid="row-dropdown" /> }));

import ItemDrawer from './ItemDrawer';

const mk = (id: string, name: string) =>
  ({
    id, wineId: null, name, libraryName: null, producer: null, type: 'red', kind: 'wine', vintage: null, grape: null, bottleSizeMl: 750,
    stock: 3, shadow: 0, par: 1, reorderPoint: null, analyticsReadable: true, velocity: 1, runway: 3, daysSinceSale: 1, deadStock: false,
    usageSource: null, usageSince: null, usageUntil: null, usageQty: null, bottle: 50, glass: 10, pourMl: 150, wac: 20, costProvenance: 'invoice',
    value: 60, lastCountedAt: null, openMl: null, zones: [], providerId: null, providerName: null, standing: 'above', active: true,
  }) as InvRow;
const ROWS = [mk('a', 'Ankara Red'), mk('b', 'Bodrum White'), mk('c', 'Cappadocia Rose')];
const NO_HOUSE: HouseFields = { kind: null, uom: null, displayName: null };

const onStep = vi.fn();
function Harness({ ids = ['a', 'b', 'c'], start = 'a' }: { ids?: string[]; start?: string }) {
  const [open, setOpen] = useState(start);
  return (
    <ItemDrawer
      row={ROWS.find((r) => r.id === open) ?? null}
      house={NO_HOUSE}
      canManage
      currency={{ state: 'recorded', code: 'EUR' }}
      zoneName={() => 'Cave'}
      locations={[]}
      locationsUnavailable={false}
      providers={[]}
      providersError={null}
      restaurantId="r1"
      onClose={vi.fn()}
      steps={{ ids, onStep: (id) => { onStep(id); setOpen(id); } }}
    />
  );
}
const mount = (props: { ids?: string[]; start?: string } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
const title = () => document.querySelector('.iv-drawer h2, .iv-drawer [class*="title"]')?.textContent ?? '';
const key = (k: string, target: Element = screen.getByTestId('ivd-next')) => fireEvent.keyDown(target, { key: k });

beforeEach(() => {
  cleanup();
  onStep.mockReset();
  for (const f of [api.figures, api.usedIn, api.nutrition, api.dishes, api.drinks]) {
    f.mockReset();
    f.mockImplementation(() => new Promise(() => undefined));
  }
  api.taste.mockReset();
  api.taste.mockResolvedValue({ state: 'absent' });
});

describe('stepping through the list from the drawer', () => {
  it('J opens the row below in the list order it was handed, K the row above; the arrows do the same', () => {
    mount({ ids: ['c', 'a', 'b'], start: 'a' });
    key('J');
    expect(onStep).toHaveBeenLastCalledWith('b');
    expect(title()).toContain('Bodrum White');
    key('K');
    expect(onStep).toHaveBeenLastCalledWith('a');
    key('ArrowUp');
    expect(onStep).toHaveBeenLastCalledWith('c');
    key('ArrowDown');
    expect(onStep).toHaveBeenLastCalledWith('a');
  });

  it('the buttons are 44 px, say what they do, name their key, and disable at the ends with no wrap', () => {
    mount();
    const prev = screen.getByRole('button', { name: 'Previous good' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next good' }) as HTMLButtonElement;
    expect(prev.getAttribute('aria-keyshortcuts')).toBe('K');
    expect(next.getAttribute('aria-keyshortcuts')).toBe('J');
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    fireEvent.click(screen.getByRole('button', { name: 'Next good' }));
    expect((screen.getByRole('button', { name: 'Next good' }) as HTMLButtonElement).disabled).toBe(true);
    key('J', screen.getByRole('button', { name: 'Previous good' }));
    expect(onStep).toHaveBeenCalledTimes(2);
    expect(title()).toContain('Cappadocia Rose');
    key('ArrowUp', screen.getByRole('button', { name: 'Previous good' }));
    key('K', screen.getByRole('button', { name: 'Previous good' }));
    key('K', screen.getByRole('button', { name: 'Previous good' }));
    expect(onStep).toHaveBeenLastCalledWith('a');
    expect((screen.getByRole('button', { name: 'Previous good' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the same Sheet and the same button stay up across a step, so focus stays on the pressed button', () => {
    mount();
    const next = screen.getByRole('button', { name: 'Next good' });
    next.focus();
    const panel = document.querySelector('.iv-drawer');
    fireEvent.click(next);
    expect(document.querySelector('.iv-drawer')).toBe(panel);
    expect(screen.getByRole('button', { name: 'Next good' })).toBe(next);
    expect(document.activeElement).toBe(next);
  });

  it('the old body is replaced, not animated out: one body in the sheet, keyed by the good, marked with the direction', () => {
    mount();
    expect(screen.getByTestId('ivd-stepbody').getAttribute('data-step')).toBeNull();
    const first = screen.getByTestId('ivd-stepbody');
    key('J');
    expect(document.querySelectorAll('[data-testid="ivd-stepbody"]')).toHaveLength(1);
    expect(screen.getByTestId('ivd-stepbody')).not.toBe(first);
    expect(screen.getByTestId('ivd-stepbody').getAttribute('data-step')).toBe('next');
    key('K');
    expect(screen.getByTestId('ivd-stepbody').getAttribute('data-step')).toBe('prev');
  });

  it('a field or a menu keeps its own keys', () => {
    mount();
    const box = document.createElement('input');
    document.querySelector('.iv-drawer')!.appendChild(box);
    key('J', box);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.querySelector('.iv-drawer')!.appendChild(menu);
    key('ArrowDown', item);
    key('J', document.body);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('warms the neighbours\' reads once a row is open', () => {
    mount();
    expect(api.figures).toHaveBeenCalledWith('b', 'r1');
    key('J');
    expect(api.figures).toHaveBeenCalledWith('c', 'r1');
    expect(api.figures).toHaveBeenCalledWith('a', 'r1');
  });
});

describe('the step enters by stylesheet and not at all under reduced motion', () => {
  const css = readFileSync('src/pages/inventory/next/item-drawer.css', 'utf8');
  const rule = (sel: string): string => {
    const i = css.indexOf(`${sel} {`);
    if (i < 0) throw new Error(`no rule ${sel}`);
    return css.slice(i, css.indexOf('}', i));
  };
  it('160 ms cubic-bezier(0.16, 1, 0.3, 1); +12 px for the next good, -12 px for the previous', () => {
    expect(rule(".ivd-stepbody[data-step='next']")).toContain('ivd-step-next 160ms cubic-bezier(0.16, 1, 0.3, 1)');
    expect(rule(".ivd-stepbody[data-step='prev']")).toContain('ivd-step-prev 160ms cubic-bezier(0.16, 1, 0.3, 1)');
    const frames = (n: string) => css.slice(css.indexOf(`@keyframes ${n}`), css.indexOf('}\n}', css.indexOf(`@keyframes ${n}`)));
    expect(frames('ivd-step-next')).toMatch(/opacity: 0;\s*transform: translateY\(12px\)/);
    expect(frames('ivd-step-prev')).toMatch(/opacity: 0;\s*transform: translateY\(-12px\)/);
    expect(css).not.toMatch(/ivd-stepbody[^{]*\{[^}]*(exit|forwards)/);
  });
  it('reduced motion is an instant swap: no animation, so no opacity either', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ivd-stepbody\[data-step\] \{\s*animation: none;/);
  });
  it('the buttons are 44 px tall', () => {
    expect(rule('.ivd-step')).toContain('height: 44px');
    expect(rule('.ivd-step')).toContain('min-width: 44px');
  });
});
