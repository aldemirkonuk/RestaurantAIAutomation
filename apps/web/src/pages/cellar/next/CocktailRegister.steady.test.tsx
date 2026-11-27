/**
 * perf-p9-4: a cold /cocktails does not shift when its reads land. jsdom has no
 * layout, so these pin the rules in the markup and the order of the states; the
 * shift itself is a browser measurement. What they hold:
 *  - the books below the list (and the signature, by data-settling) stay unseen
 *    while the list or the menu-and-till read is in flight, then show;
 *  - a failed read is not "loading": it still says it failed, in view;
 *  - the cocktail rows hold one row height and nothing here moves by motion
 *    (ADR 0112: reduced motion stays free of animation, fades included).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const h = vi.hoisted(() => ({
  list: { data: null, loading: true, error: null } as {
    data: unknown;
    loading: boolean;
    error: string | null;
  },
}));
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => h.list,
  useCocktailRecipe: () => ({ data: null, loading: false, error: null }),
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';

const row = (id: string, name: string) => ({
  id, name, display_name: null, description: null, menu_section: null, method: null, glass: null, garnish: null, price: null,
});
const loaded = {
  rows: [row('c1', 'Negroni'), row('c2', 'Gimlet')],
  count: 2, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: 'scope',
};

function mount(registerLoading: boolean, register: unknown = null) {
  return render(
    <MemoryRouter initialEntries={['/cocktails']}>
      <CocktailRegister register={register as never} registerLoading={registerLoading} />
    </MemoryRouter>,
  );
}
const ledger = () => screen.getByTestId('cocktail-ledger') as HTMLElement;
const root = () => screen.getByTestId('cocktail-register');

beforeEach(() => {
  h.list = { data: loaded, loading: false, error: null };
});

describe('the ledger and the signature wait for the reads that fill them', () => {
  it('are unseen while the menu-and-till read is pending, with the list drawn', () => {
    mount(true);
    expect(root()).toHaveAttribute('data-settling', 'true');
    expect(ledger().style.visibility).toBe('hidden');
  });

  it('are unseen while the list itself is being read', () => {
    h.list = { data: null, loading: true, error: null };
    mount(false);
    expect(root()).toHaveAttribute('data-settling', 'true');
    expect(ledger().style.visibility).toBe('hidden');
  });

  it('are shown once both reads have landed', () => {
    mount(false);
    expect(root()).not.toHaveAttribute('data-settling');
    expect(ledger().style.visibility).toBe('');
  });

  it('a failed menu-and-till read is not hidden: it says it failed', () => {
    mount(false, null);
    expect(ledger().style.visibility).toBe('');
    expect(screen.getByText(/could not be read/i)).toBeVisible();
  });

  it('a failed list read does not hide the ledger either', () => {
    h.list = { data: null, loading: false, error: 'boom' };
    mount(false);
    expect(root()).not.toHaveAttribute('data-settling');
    expect(ledger().style.visibility).toBe('');
  });
});

describe('the cocktail rows hold their height, and nothing here is animated', () => {
  const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');

  it('the cocktail table is the held-row class with one row height and no motion', () => {
    mount(false);
    expect(document.querySelector('table.cl-table--drinks')).not.toBeNull();
    const rule = css.match(/\.cl-table--drinks tbody tr \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/height: 53px;/);
    expect(rule).not.toMatch(/transition|animation|opacity/);
  });

  it('the signature rule is visibility only, and the footer sets no inline visibility to beat it', () => {
    const rule = css.match(/\.mudavym:has\(\[data-settling='true'\]\) \.cl-signature \{[^}]*\}/)?.[0] ?? '';
    expect(rule).toMatch(/visibility: hidden;/);
    expect(rule).not.toMatch(/transition|animation|opacity/);
    const tsx = readFileSync(resolve(__dirname, 'CellarNext.tsx'), 'utf8');
    expect(tsx).toMatch(/className="cl-signature"/);
    expect(tsx).not.toMatch(/visibility:/);
  });
});
