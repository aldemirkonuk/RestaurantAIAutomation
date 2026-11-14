/** r36 audit N2: a read menu's line is corrected, or left out, before it is current. */
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

const ml = (over: Partial<MenuLine> = {}): MenuLine =>
  ({ id: 'li-1', name: 'Chiantti', producer: null, category: 'red', vintage: null, by_glass_price: null, bottle_price: 48, kitchen_line: false, ...over }) as MenuLine;
const TIRAMISU = ml({ id: 'li-2', name: 'Tiramisu', category: 'food', bottle_price: 9, kitchen_line: true });

function mount(lines: MenuLine[] | null = [ml(), TIRAMISU]) {
  if (lines) mockVersion.mockResolvedValue({ version: {} as never, items: lines });
  const onChanged = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuLineFix menuId="menu-new" onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onChanged };
}
async function correct(name: string, typed: Record<string, string>) {
  fireEvent.click(await screen.findByRole('button', { name: `Correct ${name}` }));
  const form = screen.getByTestId('menu-line-fix-form');
  for (const [label, value] of Object.entries(typed)) fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
  return form;
}

beforeEach(() => {
  mockVersion.mockReset();
  mockReview.mockReset();
  mockDiscard.mockReset();
  useAuthStore.setState({ activeRestaurantId: 'house-1' });
});

describe('what a save sends', () => {
  it('only the changed fields, trimmed, in order; an emptied field refuses the save', () => {
    const l = ml();
    expect(changesOf(l, { ...draftOf(l), name: ' Chianti ', bottle_price: '52' })).toEqual({
      changes: [
        { field: 'name', value: 'Chianti', words: 'name' },
        { field: 'bottle_price', value: '52', words: 'bottle price' },
      ],
      refused: null,
    });
    expect(changesOf(l, draftOf(l))).toEqual({ changes: [], refused: null });
    expect(changesOf(l, { ...draftOf(l), name: 'Chianti', bottle_price: ' ' })).toEqual({
      changes: [],
      refused: 'The bottle price cannot be emptied here. Leave the line out instead, or type what the menu says. Nothing was changed.',
    });
  });

  it('names a section in words', () => {
    expect([ml(), TIRAMISU, ml({ category: 'Reds' }), ml({ category: null })].map(sectionWords)).toEqual([
      'Red wine',
      'Dish',
      '"Reds"',
      'No section',
    ]);
  });
});

describe('the panel', () => {
  it('lists every line, dishes too, with what it holds and why a price is held', async () => {
    mount([ml(), TIRAMISU, ml({ id: 'li-4', name: 'Rioja', bottle_price: null, price_flag_note: 'Printed at 12.00 EUR.' })]);
    const items = await screen.findAllByTestId('menu-line-fix-line');
    expect(items.map((i) => i.textContent)).toEqual([
      `Chiantti · Red wine · bottle ${formatMoney(48, 'TRY')}CorrectLeave out`,
      `Tiramisu · Dish · bottle ${formatMoney(9, 'TRY')}CorrectLeave out`,
      'Rioja · Red wine · no pricePrinted at 12.00 EUR.CorrectLeave out',
    ]);
    expect(screen.getByText('Correct a line before this menu is made current (3)')).toBeTruthy();
  });

  it('corrects a misread name and price one field at a time, says so, and reads the lines again', async () => {
    mockReview.mockResolvedValue({} as never);
    const { onChanged } = mount();
    await correct('Chiantti', { Name: 'Chianti', 'Bottle price': '52' });
    await waitFor(() =>
      expect(onChanged).toHaveBeenCalledWith('Chianti: name and bottle price corrected. What choosing this menu would do is read again.'),
    );
    expect(mockReview.mock.calls).toEqual([
      ['li-1', 'name', 'Chianti'],
      ['li-1', 'bottle_price', '52'],
    ]);
    expect(mockVersion).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('menu-line-fix-form')).toBeNull();
  });

  it('moves a line between a dish and a drink section, keeping the section as read until changed', async () => {
    mockReview.mockResolvedValue({} as never);
    mount([ml({ id: 'li-3', name: 'Sauternes', category: 'Desserts', kitchen_line: true }), ml({ name: 'Mezze' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct Sauternes' }));
    expect((screen.getByLabelText('Section') as HTMLSelectElement).value).toBe('Desserts');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await correct('Sauternes', { Section: 'dessert' });
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('li-3', 'category', 'dessert'));
    await correct('Mezze', { Section: 'food' });
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('li-1', 'category', 'food'));
    expect(mockReview).toHaveBeenCalledTimes(2);
  });

  it('says what was saved when a later field is refused, and keeps the form', async () => {
    mockReview.mockResolvedValueOnce({} as never).mockRejectedValueOnce({ response: { status: 400, data: { message: '"12x" is not a price.' } } });
    const { onChanged } = mount();
    await correct('Chiantti', { Name: 'Chianti', 'Bottle price': '12x' });
    expect((await screen.findByTestId('menu-line-fix-refused')).textContent).toBe(
      'The bottle price was not corrected: "12x" is not a price. The name was corrected.',
    );
    expect(onChanged).toHaveBeenCalledWith('');
    expect(screen.getByTestId('menu-line-fix-form')).toBeTruthy();
  });

  it('sends nothing when nothing changed, or a field was emptied', async () => {
    mount();
    const form = await correct('Chiantti', {});
    expect(screen.getByTestId('menu-line-fix-refused').textContent).toBe('Nothing differs from the line as read, so nothing was changed.');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(screen.getByTestId('menu-line-fix-refused').textContent).toMatch(/^The name cannot be emptied here/);
    expect(mockReview).not.toHaveBeenCalled();
  });

  it('leaves a line out only after a second tap; Keep it sends nothing', async () => {
    mockDiscard.mockResolvedValue({ menuItemId: 'li-2', status: 'discarded' });
    const { onChanged } = mount();
    const leave = 'Leave Tiramisu out of this menu';
    fireEvent.click(await screen.findByRole('button', { name: leave }));
    expect(screen.getByText('Leave Tiramisu out? It is not carried, and it cannot be brought back on this menu.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(mockDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: leave }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave it out' }));
    await waitFor(() => expect(mockDiscard).toHaveBeenCalledWith('house-1', 'li-2'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Tiramisu is left out of this menu. It will not be carried.'));
  });

  it('says a refused leave-out in words', async () => {
    mockDiscard.mockRejectedValue({ response: { status: 403 } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Leave Tiramisu out of this menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave it out' }));
    expect((await screen.findByTestId('menu-line-fix-leave-refused')).textContent).toBe(
      'It was not left out: only an owner or a manager can do that. Nothing was changed.',
    );
  });

  it('a failed read of the lines is said, never an empty list', async () => {
    mockVersion.mockRejectedValue(new Error('network down'));
    mount(null);
    expect((await screen.findByTestId('menu-line-fix-error')).textContent).toBe(
      "This menu's lines could not be read (network down), so none can be corrected here yet.",
    );
  });
});
