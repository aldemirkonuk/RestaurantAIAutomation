/**
 * r36 audit N2: a read menu's line is corrected, or left out, before the menu
 * is made current. The API module is replaced (the gateway is not the unit
 * here); the panel itself runs for real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuLineFix, changesOf, draftOf, sectionWords } from './MenuLineFix';
import { discardMenuItem, getMenuVersion, reviewMenuItem, type MenuLine } from '../../../services/api/menus';
import { useAuthStore } from '../../../stores';
import { formatMoney } from '../../../lib/currency';

vi.mock('../../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, getMenuVersion: vi.fn(), reviewMenuItem: vi.fn(), discardMenuItem: vi.fn() };
});

const mockVersion = vi.mocked(getMenuVersion);
const mockReview = vi.mocked(reviewMenuItem);
const mockDiscard = vi.mocked(discardMenuItem);

function menuLine(over: Partial<MenuLine> = {}): MenuLine {
  return {
    id: 'li-1',
    name: 'Chiantti',
    producer: null,
    category: 'red',
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: null,
    bottle_price: 48,
    wine_library_id: 'mw-x',
    inventory_item_id: null,
    source: 'scan',
    status: 'approved',
    created_at: '2026-11-13T10:00:00Z',
    kitchen_line: false,
    ...over,
  };
}

const TIRAMISU = menuLine({ id: 'li-2', name: 'Tiramisu', category: 'food', bottle_price: 9, kitchen_line: true });
const SAUTERNES = menuLine({ id: 'li-3', name: 'Sauternes', category: 'Desserts', bottle_price: null, kitchen_line: true });

function mount(lines: MenuLine[] = [menuLine(), TIRAMISU]) {
  mockVersion.mockResolvedValue({
    version: { menuId: 'menu-new' } as never,
    items: lines,
  });
  const onChanged = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuLineFix menuId="menu-new" onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onChanged };
}

beforeEach(() => {
  mockVersion.mockReset();
  mockReview.mockReset();
  mockDiscard.mockReset();
  useAuthStore.setState({ activeRestaurantId: 'house-1' });
});

describe('what a save sends', () => {
  it('sends only the fields that changed, trimmed, in order', () => {
    const l = menuLine();
    const d = { ...draftOf(l), name: ' Chianti ', bottle_price: '52' };
    expect(changesOf(l, d)).toEqual({
      changes: [
        { field: 'name', value: 'Chianti', words: 'name' },
        { field: 'bottle_price', value: '52', words: 'bottle price' },
      ],
      refused: null,
    });
    expect(changesOf(l, draftOf(l))).toEqual({ changes: [], refused: null });
  });

  it('refuses an emptied field before anything is sent', () => {
    const l = menuLine();
    const r = changesOf(l, { ...draftOf(l), name: 'Chianti', bottle_price: '  ' });
    expect(r.changes).toEqual([]);
    expect(r.refused).toBe(
      'The bottle price cannot be emptied here. Leave the line out instead, or type what the menu says. Nothing was changed.',
    );
    // A field that was empty and stays empty is no change.
    expect(changesOf(l, { ...draftOf(l), producer: '' }).refused).toBeNull();
  });

  it('names a line by its section in words', () => {
    expect(sectionWords(menuLine())).toBe('Red wine');
    expect(sectionWords(TIRAMISU)).toBe('Dish');
    expect(sectionWords(menuLine({ category: 'Reds' }))).toBe('"Reds"');
    expect(sectionWords(menuLine({ category: null }))).toBe('No section');
  });
});

describe('the panel', () => {
  it('lists every line of the read menu, dishes too, with what it holds', async () => {
    mount([menuLine(), TIRAMISU]);
    const items = await screen.findAllByTestId('menu-line-fix-line');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Chiantti');
    expect(items[0].textContent).toContain('Red wine');
    expect(items[0].textContent).toContain(`bottle ${formatMoney(48, 'TRY')}`);
    expect(items[1].textContent).toContain('Dish');
    expect(screen.getByText('Correct a line before this menu is made current (2)')).toBeTruthy();
  });

  it('shows why a line holds no price', async () => {
    mount([menuLine({ bottle_price: null, price_flag_note: 'The menu prints this line at 12.00 EUR.' as never })]);
    expect((await screen.findByTestId('menu-line-fix-note')).textContent).toBe('The menu prints this line at 12.00 EUR.');
  });

  it('corrects a misread name and price, one field at a time, and says so', async () => {
    mockReview.mockResolvedValue({ menuItemId: 'li-1', fieldName: 'name', newValue: 'x' });
    const { onChanged } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Chiantti' }));
    const form = screen.getByTestId('menu-line-fix-form');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Chianti' } });
    fireEvent.change(within(form).getByLabelText('Bottle price'), { target: { value: '52' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Chianti: name and bottle price corrected. What choosing this menu would do is read again.'));
    expect(mockReview.mock.calls).toEqual([
      ['li-1', 'name', 'Chianti'],
      ['li-1', 'bottle_price', '52'],
    ]);
    // The lines are read again.
    expect(mockVersion).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('menu-line-fix-form')).toBeNull();
  });

  it('moves a drink read as a dish to its drink section', async () => {
    mockReview.mockResolvedValue({ menuItemId: 'li-3', fieldName: 'category', newValue: 'dessert' });
    mount([SAUTERNES]);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Sauternes' }));
    const form = screen.getByTestId('menu-line-fix-form');
    const section = within(form).getByLabelText('Section') as HTMLSelectElement;
    // The section the reader wrote is kept as it was until it is changed.
    expect(section.value).toBe('Desserts');
    fireEvent.change(section, { target: { value: 'dessert' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('li-3', 'category', 'dessert'));
    expect(mockReview).toHaveBeenCalledTimes(1);
  });

  it('a dish is set with the kitchen section the gateway reads as a dish', async () => {
    mockReview.mockResolvedValue({ menuItemId: 'li-1', fieldName: 'category', newValue: 'food' });
    mount([menuLine({ name: 'Mezze' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Mezze' }));
    const form = screen.getByTestId('menu-line-fix-form');
    fireEvent.change(within(form).getByLabelText('Section'), { target: { value: 'food' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('li-1', 'category', 'food'));
  });

  it('says what was saved when a later field is refused, and reads the plan again', async () => {
    mockReview
      .mockResolvedValueOnce({ menuItemId: 'li-1', fieldName: 'name', newValue: 'Chianti' })
      .mockRejectedValueOnce({ response: { status: 400, data: { message: '"12x" is not a price.' } } });
    const { onChanged } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Chiantti' }));
    const form = screen.getByTestId('menu-line-fix-form');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Chianti' } });
    fireEvent.change(within(form).getByLabelText('Bottle price'), { target: { value: '12x' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect((await screen.findByTestId('menu-line-fix-refused')).textContent).toBe(
      'The bottle price was not corrected: "12x" is not a price. The name was corrected.',
    );
    expect(onChanged).toHaveBeenCalledWith('');
    // The form stays open with what was typed.
    expect(screen.getByTestId('menu-line-fix-form')).toBeTruthy();
  });

  it('sends nothing when nothing changed, or a field was emptied', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Chiantti' }));
    const form = screen.getByTestId('menu-line-fix-form');
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByTestId('menu-line-fix-refused').textContent).toBe('Nothing differs from the line as read, so nothing was changed.');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByTestId('menu-line-fix-refused').textContent).toMatch(/^The name cannot be emptied here/);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('leaves a line out after a second tap, and says it is not carried', async () => {
    mockDiscard.mockResolvedValue({ menuItemId: 'li-2', status: 'discarded' });
    const { onChanged } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Tiramisu out of this menu' }));
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(screen.getByText('Leave Tiramisu out? It is not carried, and it cannot be brought back on this menu.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave it out' }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('house-1', 'li-2'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Tiramisu is left out of this menu. It will not be carried.'));
  });

  it('Keep it sends nothing', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Tiramisu out of this menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Leave Tiramisu out of this menu' })).toBeTruthy();
  });

  it('says a refused leave-out in the gateway words', async () => {
    mockDiscard.mockRejectedValue({ response: { status: 403, data: { message: 'x' } } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Tiramisu out of this menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave it out' }));
    expect((await screen.findByTestId('menu-line-fix-leave-refused')).textContent).toBe(
      'It was not left out: only an owner or a manager can do that. Nothing was changed.',
    );
  });

  it('a failed read of the lines is said, never an empty list', async () => {
    mockVersion.mockRejectedValue(new Error('network down'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MenuLineFix menuId="menu-new" onChanged={vi.fn()} />
      </QueryClientProvider>,
    );
    expect((await screen.findByTestId('menu-line-fix-error')).textContent).toBe(
      "This menu's lines could not be read (network down), so none can be corrected here yet.",
    );
  });
});
