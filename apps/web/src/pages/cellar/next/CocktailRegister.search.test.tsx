/**
 * r41 recipes audit, gap 13: the /cocktails search lowered case the English
 * way, so "RAKI" never found "Rakı" and "İSTANBUL" never found "Istanbul
 * sour". It now folds as the gateway's shelf search does (name-fold.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const RID = '11111111-1111-4111-8111-111111111111';
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: vi.fn().mockRejectedValue(new Error('not read here')), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorStatus: () => null,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: RID, activeRole: 'staff', user: { role: 'staff' } }),
}));
vi.mock('./recipe/RecipeSheet', () => ({ default: () => null }));
const row = (id: string, name: string, menu_section: string | null = null) => ({ id, name, display_name: null, menu_section, method: null, glass: null, garnish: null, price: 10 });
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    data: {
      rows: [row('c1', 'Rakı sour'), row('c2', 'Istanbul mule'), row('c3', 'Şeftali fizz', 'Yaz içkileri'), row('c4', 'Gin  and   tonic')],
      count: 4, truncated: false, referenceRows: 0, recipesAvailable: true, scopeNote: '',
    },
    loading: false,
    error: null,
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import CocktailRegister from './CocktailRegister';
import { foldName } from './recipe/name-fold';

function shownFor(typed: string): string[] {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <CocktailRegister register={null} registerLoading={false} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText('Search cocktail, section, method…'), { target: { value: typed } });
  const names = screen.queryAllByRole('row').slice(1).map((r) => r.querySelector('.cl-serif')?.textContent ?? '');
  view.unmount();
  return names;
}

describe('the cocktail search reads Turkish letters', () => {
  it('"RAKI" and "raki" find Rakı', () => {
    expect(shownFor('RAKI')).toEqual(['Rakı sour']);
    expect(shownFor('raki')).toEqual(['Rakı sour']);
  });

  it('"İSTANBUL" finds Istanbul, and "seftali" finds Şeftali', () => {
    expect(shownFor('İSTANBUL')).toEqual(['Istanbul mule']);
    expect(shownFor('seftali')).toEqual(['Şeftali fizz']);
  });

  it('searches the section too, and spaces typed or stored are one space', () => {
    expect(shownFor('YAZ ICKILERI')).toEqual(['Şeftali fizz']);
    expect(shownFor('gin and tonic')).toEqual(['Gin  and   tonic']);
  });

  it('a blank search shows every drink', () => {
    expect(shownFor('   ')).toHaveLength(4);
  });
});

describe('foldName', () => {
  it('folds as the gateway does', () => {
    expect(foldName('  İSOT  Biber ')).toBe('isot biber');
    expect(foldName('RAKI')).toBe(foldName('Rakı'));
    expect(foldName('Crème brûlée')).toBe('creme brulee');
  });
});
