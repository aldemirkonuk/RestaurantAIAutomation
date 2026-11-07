/**
 * "Used in" (ItemUsedIn.tsx): three groups by how sure the link is, a failed
 * group said as failed, and the unlinked group never counted in usage.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ItemUsedIn from './ItemUsedIn';
import type { ItemUsedIn as UsedIn } from '../../../services/api/inventory';

const EUR = { state: 'recorded', code: 'EUR' } as const;
const ok = <T,>(lines: T[]) => ({ readable: true, lines, source: 's' });
const line = (id: string, name: string) => ({ menuItemId: id, menuId: 'menu', name, byGlassPrice: 18, bottlePrice: 92 });

function load(over: Partial<UsedIn> = {}) {
  return {
    status: 'ready' as const,
    data: {
      item: { id: 'i1', kind: 'spirit', displayName: null },
      soldAs: ok([line('m1', 'Rakı, single')]),
      inCocktails: ok([{ cocktailId: 'c1', name: 'Rakı sour', quantity: 40, unit: 'ml' }]),
      namedNotLinked: ok([line('m2', 'Rakı table set')]),
      recipes: { recorded: false as const, note: 'n' },
      ...over,
    },
  };
}

describe('Used in', () => {
  it('(d) draws the three groups, and says the unlinked one is not counted in usage', () => {
    render(<ItemUsedIn load={load()} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(within(screen.getByTestId('ivd-used-sold')).getByText('Rakı, single')).toBeTruthy();
    expect(within(screen.getByTestId('ivd-used-cocktails')).getByText('Rakı sour')).toBeTruthy();
    const named = screen.getByTestId('ivd-used-named');
    expect(within(named).getByText('Rakı table set')).toBeTruthy();
    expect(named.textContent).toContain('not counted in usage');
    expect(screen.getByTestId('ivd-used').textContent).toContain('Recipes are not recorded yet');
    expect(screen.queryByText(/Link this/)).toBeNull();
  });

  it('says a group that failed could not be read, and draws no lines for it', () => {
    render(
      <ItemUsedIn
        load={load({ inCocktails: { readable: false, lines: null, source: 'permission denied for table cocktails' } })}
        canManage
        currency={EUR}
        onRetry={vi.fn()}
      />,
    );
    const g = screen.getByTestId('ivd-used-cocktails');
    expect(g.textContent).toContain('could not be read');
    expect(g.textContent).not.toContain('permission denied');
  });

  it('says an item used nowhere is not on the menu or in a recipe yet', () => {
    render(
      <ItemUsedIn load={load({ soldAs: ok([]), inCocktails: ok([]), namedNotLinked: ok([]) })} canManage currency={EUR} onRetry={vi.fn()} />,
    );
    expect(screen.getByTestId('ivd-used-none').textContent).toContain('Not on the menu or in a recipe yet');
  });

  it('shows menu prices to owners and managers only', () => {
    const { unmount } = render(<ItemUsedIn load={load()} canManage currency={EUR} onRetry={vi.fn()} />);
    expect(screen.getByTestId('ivd-used-sold').textContent).toMatch(/€/);
    unmount();
    render(<ItemUsedIn load={load()} canManage={false} currency={EUR} onRetry={vi.fn()} />);
    expect(screen.getByTestId('ivd-used-sold').textContent).not.toMatch(/€/);
  });
});
