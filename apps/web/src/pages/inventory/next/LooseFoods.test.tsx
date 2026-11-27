/**
 * r109 g4: dish recipe lines that name no good. The chip never says 0 for an
 * unread read; a group is added as a food good and linked in each dish only
 * after the hold; each dish is re-saved from the version it was read at, and a
 * dish that failed is named. HoldToApprove is the real control.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { LooseDishAnswer } from '../../../services/api/recipes';

const api = vi.hoisted(() => ({ read: vi.fn(), add: vi.fn(), save: vi.fn() }));

vi.mock('../../../services/api/recipes', async (orig) => {
  const real = await orig<Record<string, any>>();
  return {
    ...real,
    getLooseDishLines: api.read,
    recipesApi: { ...real.recipesApi, addToShelf: api.add, save: api.save },
  };
});
vi.mock('../../cellar/next/useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarSettings: () => ({ data: { holdCeremony: 'auto' }, loading: false }),
}));

import { LooseFoodsChip, LooseFoodsSheet, useLooseFoods } from './LooseFoods';

const R = 'house-1';
const line = (label: string, inventoryId: string | null = null, unit = 'g') => ({
  role: 'stocked' as const,
  inventoryId,
  componentId: null,
  label,
  qty: 20,
  unit,
  usablePct: null,
});

function answer(over: Partial<LooseDishAnswer> = {}): LooseDishAnswer {
  return {
    lineCount: 3,
    dishCount: 2,
    groups: [
      { key: 'parmesan', label: 'Parmesan', lines: [{ dishId: 'd-pasta', index: 0 }, { dishId: 'd-salad', index: 1 }], dishCount: 2, proposed: 'g', shelf: null, sameName: 0 },
      { key: 'olive oil', label: 'Olive oil', lines: [{ dishId: 'd-pasta', index: 2 }], dishCount: 1, proposed: null, shelf: null, sameName: 0 },
    ],
    dishes: [
      { dishId: 'd-pasta', name: 'Pasta', versionId: 'v-p2', yieldServes: 4, method: 'Boil', glass: null, garnish: null, lines: [line('Parmesan'), line('Spaghetti', 'i-spag'), line('Olive oil', null, 'ml')] },
      { dishId: 'd-salad', name: 'Salad', versionId: 'v-s1', yieldServes: 1, method: null, glass: null, garnish: null, lines: [line('Leaves', 'i-leaf'), line('PARMESAN')] },
    ],
    ...over,
  };
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

/** Each fireEvent is its own act, so the second Enter sees the armed phase. */
function hold(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: 'Enter' });
}

beforeEach(() => {
  api.read.mockReset();
  api.add.mockReset().mockResolvedValue({ id: 'i-new', kind: 'food', uom: 'g', displayName: 'Parmesan' });
  api.save.mockReset().mockResolvedValue({ versionId: 'v-next', version: 3, lines: [] });
});

describe('LooseFoodsChip', () => {
  it('holds its place with no count while reading and when unread, never 0', () => {
    const { rerender } = render(<LooseFoodsChip load={{ isPending: true, isError: false }} onOpen={() => {}} />);
    const chip = screen.getByTestId('iv-loose-foods-chip');
    expect(chip.textContent).toBe('Named in recipes, not in the book —');
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    rerender(<LooseFoodsChip load={{ isPending: false, isError: true }} onOpen={() => {}} />);
    expect(chip.textContent).not.toMatch(/0/);
    expect(chip.getAttribute('title')).toMatch(/could not be read/);
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    // A read again that failed is unread too, even with an older answer still held.
    rerender(<LooseFoodsChip load={{ isPending: false, isError: true, data: answer() }} onOpen={() => {}} />);
    expect(chip.textContent).toBe('Named in recipes, not in the book —');
  });

  it('counts the names and opens the sheet', () => {
    const onOpen = vi.fn();
    render(<LooseFoodsChip load={{ isPending: false, isError: false, data: answer() }} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Named in recipes, not in the book (2)' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('useLooseFoods', () => {
  it('is not read for staff', () => {
    const qc = new QueryClient();
    renderHook(() => useLooseFoods(R, false), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    expect(api.read).not.toHaveBeenCalled();
  });
});

describe('LooseFoodsSheet', () => {
  it('links nothing until the hold; then adds the food good and re-saves each dish from the version it was read at', async () => {
    wrap(<LooseFoodsSheet rid={R} answer={answer()} onClose={() => {}} />);
    const [parm] = screen.getAllByTestId('iv-loose-group');
    fireEvent.click(parm.querySelector('button') as HTMLButtonElement);
    expect(api.add).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
    hold(screen.getByRole('button', { name: /Hold to add Parmesan in 2 dishes/ }));
    await waitFor(() => expect(screen.getByTestId('iv-loose-said').textContent).toBe('Parmesan is in the book and is linked in 2 dishes.'));
    // No par is sent: the gateway's add path decides it.
    expect(api.add).toHaveBeenCalledWith(R, { kind: 'food', uom: 'g', displayName: 'Parmesan' });
    expect(api.save).toHaveBeenCalledTimes(2);
    const [, pastaOwner, pasta] = api.save.mock.calls[0];
    expect(pastaOwner).toEqual({ kind: 'dish', id: 'd-pasta' });
    expect(pasta).toMatchObject({ expectedVersionId: 'v-p2', yieldServes: 4, method: 'Boil', glass: undefined });
    // Only the named line is linked; the others go back as they were read.
    expect(pasta.lines.map((l: { inventoryId: string | null }) => l.inventoryId)).toEqual(['i-new', 'i-spag', null]);
    const [, , salad] = api.save.mock.calls[1];
    expect(salad.expectedVersionId).toBe('v-s1');
    expect(salad.lines.map((l: { inventoryId: string | null }) => l.inventoryId)).toEqual(['i-leaf', 'i-new']);
  });

  it('a second name linked in the same dish starts from the version the first saved, keeping its link', async () => {
    api.save.mockResolvedValueOnce({ versionId: 'v-p3', version: 3, lines: [] });
    wrap(<LooseFoodsSheet rid={R} answer={answer()} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add as a good' })[0]);
    hold(screen.getByRole('button', { name: /Hold to add Parmesan/ }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    api.add.mockResolvedValue({ id: 'i-oil', kind: 'food', uom: 'ml', displayName: 'Olive oil' });
    const oil = screen.getAllByTestId('iv-loose-group')[1];
    fireEvent.click(screen.getByRole('button', { name: 'Add as a good' }));
    fireEvent.change(oil.querySelector('select') as HTMLSelectElement, { target: { value: 'ml' } });
    hold(screen.getByRole('button', { name: /Hold to add Olive oil/ }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(3));
    const [, , pasta] = api.save.mock.calls[2];
    expect(pasta.expectedVersionId).toBe('v-p3');
    expect(pasta.lines.map((l: { inventoryId: string | null }) => l.inventoryId)).toEqual(['i-new', 'i-spag', 'i-oil']);
  });

  it('a group whose lines disagree on a unit asks for one before the hold can run', async () => {
    wrap(<LooseFoodsSheet rid={R} answer={answer()} onClose={() => {}} />);
    const oil = screen.getAllByTestId('iv-loose-group')[1];
    fireEvent.click(screen.getAllByRole('button', { name: 'Add as a good' })[1]);
    const btn = screen.getByRole('button', { name: /Pick a unit first/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(oil.querySelector('select') as HTMLSelectElement, { target: { value: 'ml' } });
    hold(screen.getByRole('button', { name: /Hold to add Olive oil in 1 dish/ }));
    await waitFor(() => expect(api.add).toHaveBeenCalledWith(R, { kind: 'food', uom: 'ml', displayName: 'Olive oil' }));
  });

  it('names the dish that kept its loose line when its version changed (409), and keeps the others linked', async () => {
    api.save.mockImplementation(async (_r: string, owner: { id: string }) => {
      if (owner.id === 'd-salad') throw Object.assign(new Error('stale'), { response: { status: 409 } });
      return { versionId: 'v', version: 1, lines: [] };
    });
    wrap(<LooseFoodsSheet rid={R} answer={answer()} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add as a good' })[0]);
    hold(screen.getByRole('button', { name: /Hold to add Parmesan/ }));
    await waitFor(() =>
      expect(screen.getByTestId('iv-loose-said').textContent).toBe(
        'Parmesan is in the book and is linked in 1 dish. These kept their loose line: Salad (its recipe changed since it was read). Open each recipe to link it.',
      ),
    );
  });

  it('an add that fails changes no dish', async () => {
    api.add.mockRejectedValue(new Error('down'));
    wrap(<LooseFoodsSheet rid={R} answer={answer()} onClose={() => {}} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add as a good' })[0]);
    hold(screen.getByRole('button', { name: /Hold to add Parmesan/ }));
    await waitFor(() => expect(screen.getByTestId('iv-loose-said').textContent).toBe('Parmesan could not be added, so no dish was changed.'));
    expect(api.save).not.toHaveBeenCalled();
  });

  it('a name the book already carries once is linked to that good, never added twice; two same-named goods add nothing', async () => {
    const a = answer();
    a.groups[0] = { ...a.groups[0], shelf: { id: 'i-parm', name: 'Parmesan', kind: 'food', uom: 'g', bottleSizeMl: null }, sameName: 1 };
    a.groups[1] = { ...a.groups[1], sameName: 2 };
    wrap(<LooseFoodsSheet rid={R} answer={a} onClose={() => {}} />);
    expect(screen.getAllByTestId('iv-loose-group')[1].querySelector('button')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Link to Parmesan' }));
    hold(screen.getByRole('button', { name: /Hold to link Parmesan/ }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(api.add).not.toHaveBeenCalled();
    expect(api.save.mock.calls[0][2].lines[0].inventoryId).toBe('i-parm');
    expect(screen.getByTestId('iv-loose-said').textContent).toMatch(/^Parmesan was already in the book and is linked in 2 dishes\.$/);
  });
});
