/**
 * A form that does not open must say so (design critic round 3, need 5). The
 * Collapse is replaced here by one that never reports the form as opened, which
 * is what a stalled open looks like to the register.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../../components/mudavym/Collapse', () => ({
  Collapse: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./useCellarNextData', () => ({
  useCocktailRegister: () => ({
    loading: false, error: null,
    data: { rows: [], count: 0, truncated: false, referenceRows: null, recipesAvailable: false, scopeNote: '' },
  }),
  useCocktailWrites: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    amend: { mutateAsync: vi.fn(), isPending: false },
    retire: { mutateAsync: vi.fn(), isPending: false },
    setRecipe: { mutateAsync: vi.fn(), isPending: false },
  }),
  useCocktailRecipe: () => ({ data: null, loading: false, error: null }),
}));

import CocktailRegister, { OPEN_WATCH_MS } from './CocktailRegister';

afterEach(() => vi.useRealTimers());

describe('CocktailRegister: a form that does not open says why', () => {
  it('says the form did not open, and that nothing was saved, when it is not shown in time', async () => {
    vi.useFakeTimers();
    render(<MemoryRouter><CocktailRegister register={null} registerLoading={false} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Add a cocktail/ }));
    expect(screen.queryByTestId('cocktail-said')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(OPEN_WATCH_MS + 10); });
    expect(screen.getByTestId('cocktail-said').textContent).toMatch(/did not open.*Nothing was saved/);
  });

  it('says nothing when the form is closed again before the wait is over', async () => {
    vi.useFakeTimers();
    render(<MemoryRouter><CocktailRegister register={null} registerLoading={false} /></MemoryRouter>);
    const add = screen.getByRole('button', { name: /Add a cocktail/ });
    fireEvent.click(add);
    fireEvent.click(add);
    await act(async () => { vi.advanceTimersByTime(OPEN_WATCH_MS + 10); });
    expect(screen.queryByTestId('cocktail-said')).toBeNull();
  });
});
