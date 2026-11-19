/**
 * The phone's controls and the dark-ground contract (critic c3 round 3, items 2, 3, 13).
 * jsdom reads no layout, so the numbers a person would measure are held as the
 * stylesheet's own declarations, and the behaviour is held by rendering.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PhoneRows from './PhoneRows';
import { activeFilterCount, nextToCount } from './PhoneBook';
import type { InvRow } from './useInventoryNextData';

const seen = vi.hoisted(() => ({ hide: [] as unknown[] }));
vi.mock('../command/HousePriceCell', () => ({
  HousePriceCell: (p: { hideNoTarget?: boolean }) => {
    seen.hide.push(p.hideNoTarget);
    return <span data-testid="price-cell" />;
  },
}));
vi.mock('./NameThisWine', () => ({ NameHint: () => null }));

const root = process.cwd();
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const css = read('src/pages/inventory/next/inventory-next.css');
const block = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, `${sel} is in the stylesheet`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf('}', i));
};

function row(over: Partial<InvRow> = {}): InvRow {
  return { id: 'i1', name: 'Gravner Ribolla', stock: 12, par: 4, standing: 'above', bottle: 92, glass: null, lastCountedAt: null, ...over } as InvRow;
}
const props = {
  thing: 'bottle',
  grouped: false,
  openId: null,
  onToggle: vi.fn(),
  currency: { state: 'recorded', code: 'EUR' } as never,
  onPriceChanged: vi.fn(),
};

afterEach(() => {
  seen.hide.length = 0;
});

describe('a phone card: the name owns line one', () => {
  it('puts only the name on line one, and the stock, the standing and the price on line two', () => {
    render(<PhoneRows {...props} rows={[row({ standing: 'below' })]} canManage advice={{ status: 'loading' }} />);
    const card = screen.getByTestId('inv-row-i1');
    const main = card.querySelector('.ivc-main')!;
    expect(main.children[0].className).toBe('ivc-name');
    expect(main.children[0].textContent).toBe('Gravner Ribolla');
    const sub = main.querySelector('.ivc-sub')!;
    expect(sub.textContent).toContain('12 live · par 4');
    expect(sub.querySelector('.ivc-status')).toBeTruthy();
    expect(main.children[0].querySelector('.ivc-status')).toBeNull();
    // The price is a sibling of the tap target, never a column beside the name.
    expect(card.querySelector('.ivc-price')!.parentElement).toBe(card);
  });

  it('the stylesheet gives the name the full row, two lines, 16 px', () => {
    const card = block('.ivc-card');
    expect(card).toContain('display: grid');
    const name = block('.ivc-name');
    expect(name).toContain('-webkit-line-clamp: 2');
    expect(name).toContain('font-size: 16px');
    expect(name).not.toContain('white-space: nowrap');
    expect(block('.ivc-price')).toContain('max-width: 46%');
  });

  it('says "no target" once above the cards, and not on each one', () => {
    render(
      <PhoneRows
        {...props}
        rows={[row({ id: 'a' }), row({ id: 'b', name: 'Second' })]}
        canManage
        advice={{ status: 'ready', byId: new Map(), targetSet: false }}
      />,
    );
    expect(screen.getAllByTestId('inventory-no-target')).toHaveLength(1);
    expect(seen.hide).toEqual([true, true]);
  });

  it('says nothing about a target when one is set, or when the reader cannot set prices', () => {
    const { unmount } = render(
      <PhoneRows {...props} rows={[row()]} canManage advice={{ status: 'ready', byId: new Map(), targetSet: true }} />,
    );
    expect(screen.queryByTestId('inventory-no-target')).toBeNull();
    unmount();
    render(<PhoneRows {...props} rows={[row()]} canManage={false} advice={{ status: 'ready', byId: new Map(), targetSet: false }} />);
    expect(screen.queryByTestId('inventory-no-target')).toBeNull();
  });
});

describe('what the Filter button counts and what the Count bar reaches for', () => {
  const none = { chip: 'all', kind: '', zone: '', type: '', sort: 'needs', view: 'table' };
  it('counts only the controls that are set', () => {
    expect(activeFilterCount(none)).toBe(0);
    expect(activeFilterCount({ ...none, chip: 'below', zone: 'z1', sort: 'name', view: 'map' })).toBe(4);
  });
  it('reaches for a good nobody has counted, in the list order, else the oldest count', () => {
    const a = row({ id: 'a', lastCountedAt: '2026-11-10T00:00:00Z' });
    const b = row({ id: 'b', lastCountedAt: null });
    const c = row({ id: 'c', lastCountedAt: null });
    expect(nextToCount([a, b, c])?.id).toBe('b');
    expect(nextToCount([a, row({ id: 'd', lastCountedAt: '2026-11-01T00:00:00Z' })])?.id).toBe('d');
    expect(nextToCount([row({ id: 'e', lastCountedAt: 'not a date' }), a])?.id).toBe('e');
    expect(nextToCount([])).toBeNull();
  });
});

describe('the stylesheet: sizes, motion and the dark ground', () => {
  it('the Filter button is 48 px and the Count bar is 56 px', () => {
    expect(block('.iv-page .iv-filterbtn')).toContain('min-height: 48px');
    expect(block('.iv-countbar__btn')).toContain('min-height: 56px');
    expect(block('.iv-countbar')).toContain('position: sticky');
    // Rests above the fixed doors (57 px), not under them.
    expect(block('.iv-countbar')).toMatch(/bottom: calc\(57px \+ env\(safe-area-inset-bottom, 0px\)\)/);
  });

  it('the Filter sheet selects read 16 px: the rule outranks the overlay sheet rule (html .mdv-ovl .iv-sheet-body)', () => {
    expect(block('html .mdv-ovl .iv-filtersheet__body .mdv-select__control')).toContain('font-size: 16px');
  });

  it('the check box and the search field outrank the legacy white !important input rule, so charcoal stays charcoal and a checked box keeps its seal', () => {
    expect(css).toMatch(/html \.iv-page input\[type='checkbox'\],\s*html \.iv-filtersheet input\[type='checkbox'\] \{\s*background-color: var\(--paper-0\) !important/);
    expect(css).toMatch(/html \.iv-page input\[type='checkbox'\]:checked,[\s\S]*?background-color: var\(--seal\) !important/);
    expect(block('html .iv-page .iv-field')).toMatch(/background-color: var\(--paper-1\) !important/);
  });

  it('a check box takes the accent, is 24 px on a phone, and draws its tick by clip-path in 120 ms', () => {
    expect(css).toMatch(/input\[type='checkbox'\],[\s\S]*?\{[^}]*accent-color: var\(--seal\)/);
    expect(css).toMatch(/@media \(max-width: 767px\), \(pointer: coarse\) \{\s*\.iv-page input\[type='checkbox'\],[\s\S]*?width: 24px;\s*height: 24px;/);
    expect(css).toMatch(/input\[type='checkbox'\]::after,[\s\S]*?transition: clip-path 120ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  });

  it('moves only transform, opacity or clip-path, and never says transition: all', () => {
    expect(css).not.toMatch(/transition:\s*all/);
    const own = css.slice(css.indexOf('phone: one Filter button'));
    for (const m of own.matchAll(/transition:\s*([^;]+);/g)) expect(m[1]).toMatch(/^(transform|clip-path)\b/);
  });

  it('reduced motion stills the tick, the Count bar and the filter sheet', () => {
    const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(rm).toContain('.iv-page *::after');
    expect(rm).toContain('.iv-filtersheet *');
    expect(rm).toContain('.iv-countbar *');
  });

  it('the insights rail has no fixed white or pastel utility left, and draws from the page tokens', () => {
    const tsx = read('src/components/insights/ContextualInsights.tsx');
    expect(tsx).not.toMatch(/\bbg-white\b|\bbg-amber-(50|100)\b|\bbg-(emerald|blue|indigo|purple|pink|rose|red|cyan|gray)-(50|100)\b|\btext-gray-\d+/);
    expect(tsx).toContain('ci-card');
    const ci = read('src/components/insights/contextual-insights.css');
    expect(ci).toContain('background: var(--paper-0');
    expect(ci).toContain('color-mix(in oklch');
    expect(ci).not.toMatch(/#fff\b(?!\s*\))/);
  });
});

describe('the Tools shortcut in the filter sheet', () => {
  it('is a button that closes the sheet before it scrolls (no stray handler)', () => {
    const tsx = read('src/pages/inventory/next/PhoneBook.tsx');
    expect(tsx).toContain('children(() => setOpen(false))');
  });
});
