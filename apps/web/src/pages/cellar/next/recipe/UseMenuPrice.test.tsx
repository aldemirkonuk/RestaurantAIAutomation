/**
 * "Use the menu's price" (r28 recipes audit, gap 2, slice 2): an opened dish
 * or drink whose price differs from the current menu's, or has none, can take
 * the menu's price after a confirm. Nothing is written before the confirm.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MenuPrice } from '../../../../services/api/recipes';
import UseMenuPrice, { menuPriceOffer } from './UseMenuPrice';

const say = (n: number | null | undefined) => (n == null ? '—' : `₺${n.toFixed(2).replace('.', ',')}`);
const one = (prices: number[], agrees: boolean | null): MenuPrice => ({ found: 'one', prices, agrees });

describe('menuPriceOffer: which menu prices a row can take', () => {
  it('offers the menu price when the row differs from it', () => {
    expect(menuPriceOffer(one([11], false), 12)).toEqual([11]);
  });

  it('offers the menu price when the row has no price of its own', () => {
    expect(menuPriceOffer(one([6], null), null)).toEqual([6]);
    expect(menuPriceOffer(one([6], null), undefined)).toEqual([6]);
  });

  it('offers a bottle and a glass price each, but never the row\'s own', () => {
    expect(menuPriceOffer(one([9, 48], false), 12)).toEqual([9, 48]);
    expect(menuPriceOffer(one([9, 12], false), 12)).toEqual([9]);
  });

  it.each([
    ['the row agrees', one([12], true), 12],
    ['agreement is unknown and the row has a price', one([12], null), 10],
    ['the menu line has no price', one([], null), null],
    ['the menu does not name it', { found: 'none' } as MenuPrice, 12],
    ['several menu lines disagree', { found: 'several', lines: 2 } as MenuPrice, 12],
    ['the menu was not read', undefined, 12],
  ])('offers nothing when %s', (_n, menu, own) => {
    expect(menuPriceOffer(menu, own)).toEqual([]);
  });
});

const use = vi.fn();
function mount(menu: MenuPrice | undefined, own: number | null, share: 'food cost' | 'pour cost' = 'food cost') {
  return render(<UseMenuPrice name="Mezze" own={own} menu={menu} say={say} share={share} onUse={use} />);
}

beforeEach(() => {
  use.mockReset();
});

describe('UseMenuPrice', () => {
  it('says both prices and offers the menu\'s, writing nothing yet', () => {
    mount(one([5.5], false), 5);
    expect(screen.getByTestId('use-menu-price').textContent).toContain('Your current menu prices Mezze at ₺5,50; this list says ₺5,00.');
    expect(screen.getByRole('button', { name: 'Use ₺5,50' })).toBeTruthy();
    expect(use).not.toHaveBeenCalled();
  });

  it('says when the row has no price here', () => {
    mount(one([6], null), null);
    expect(screen.getByTestId('use-menu-price').textContent).toContain('Your current menu prices Mezze at ₺6,00; it has no price here.');
  });

  it('asks first, naming the price and the share it changes', () => {
    mount(one([5.5], false), 5, 'pour cost');
    fireEvent.click(screen.getByRole('button', { name: 'Use ₺5,50' }));
    expect(screen.getByText('Set Mezze’s price to ₺5,50? Its pour cost is then taken over ₺5,50.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep ₺5,00' })).toBeTruthy();
    expect(use).not.toHaveBeenCalled();
  });

  it('writes the price on Yes, says it, and offers nothing more', async () => {
    use.mockResolvedValue(undefined);
    mount(one([5.5], false), 5);
    fireEvent.click(screen.getByRole('button', { name: 'Use ₺5,50' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use ₺5,50' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Mezze is now ₺5,50, as on your menu.'));
    expect(use).toHaveBeenCalledWith(5.5);
    expect(screen.queryByRole('button', { name: /Use ₺/ })).toBeNull();
  });

  it('writes the price chosen when the menu gives two', async () => {
    use.mockResolvedValue(undefined);
    mount(one([9, 48], false), 12);
    expect(screen.getByTestId('use-menu-price').textContent).toContain('at ₺9,00 or ₺48,00');
    fireEvent.click(screen.getByRole('button', { name: 'Use ₺48,00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use ₺48,00' }));
    await waitFor(() => expect(use).toHaveBeenCalledWith(48));
  });

  it('goes back on Keep without writing', () => {
    mount(one([5.5], false), 5);
    fireEvent.click(screen.getByRole('button', { name: 'Use ₺5,50' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep ₺5,00' }));
    expect(screen.getByRole('button', { name: 'Use ₺5,50' })).toBeTruthy();
    expect(use).not.toHaveBeenCalled();
  });

  it('offers to leave an unpriced row unpriced', () => {
    mount(one([6], null), null);
    fireEvent.click(screen.getByRole('button', { name: 'Use ₺6,00' }));
    expect(screen.getByRole('button', { name: 'Leave it unpriced' })).toBeTruthy();
  });

  it('says the refusal and keeps the question open', async () => {
    use.mockRejectedValue(Object.assign(new Error('x'), { response: { data: { message: 'Only an owner or manager can change a price.' } } }));
    mount(one([5.5], false), 5);
    fireEvent.click(screen.getByRole('button', { name: 'Use ₺5,50' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use ₺5,50' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Nothing was changed: Only an owner or manager can change a price.'));
    expect(screen.getByRole('button', { name: 'Yes, use ₺5,50' })).toBeTruthy();
  });

  it('shows nothing when there is nothing to offer', () => {
    const { container } = mount(one([5], true), 5);
    expect(container.textContent).toBe('');
  });
});
