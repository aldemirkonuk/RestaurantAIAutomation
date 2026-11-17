/**
 * r41 R1: a menu can be typed on /menu, through the same read box as a file.
 * It is kept as a menu, not current; prices go as typed for the gateway's
 * parseMenuPrice to read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuVersions } from './MenuVersions';
import { emptyRow, typedLines, type TypedRow } from './MenuTypedLines';
import { importMenu, listMenuVersions, makeMenuCurrent } from '../../../services/api/menus';

vi.mock('../../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, listMenuVersions: vi.fn(), importMenu: vi.fn(), makeMenuCurrent: vi.fn(), getMenuPlan: vi.fn() };
});

const mockList = vi.mocked(listMenuVersions);
const mockImport = vi.mocked(importMenu);
const mockMake = vi.mocked(makeMenuCurrent);

function mount(canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MenuVersions canManage={canManage} />
    </QueryClientProvider>,
  );
}

const row = (over: Partial<TypedRow>): TypedRow => ({ ...emptyRow(), ...over });

beforeEach(() => {
  mockList.mockReset();
  mockImport.mockReset();
  mockMake.mockReset();
  mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
  mockImport.mockResolvedValue({ menuId: 'm7', current: false, itemsExtracted: 2, submissionsCreated: 0, items: [] });
});

describe('typedLines: what a typed menu sends', () => {
  it('sends names trimmed and prices as typed, and leaves an empty row out', () => {
    expect(
      typedLines([
        row({ name: ' Raki ', category: 'spirit', glass: ' 120 ', bottle: '1.250,00' }),
        row({}),
        row({ name: 'Mercimek', bottle: '45,50' }),
      ]),
    ).toEqual({
      lines: [
        { name: 'Raki', category: 'spirit', by_glass_typed: '120', bottle_typed: '1.250,00' },
        { name: 'Mercimek', bottle_typed: '45,50' },
      ],
      refusal: null,
    });
  });

  it('a row with a price and no name is refused with the line the person sees', () => {
    expect(typedLines([row({ name: 'Raki' }), row({}), row({ bottle: '40' })])).toEqual({
      lines: [],
      refusal: 'Line 3 has no name. Give it one, or leave it out.',
    });
  });

  it('nothing typed is not a menu', () => {
    expect(typedLines([row({}), row({ name: '   ' })])).toEqual({ lines: [], refusal: 'Type at least one line with a name first.' });
  });
});

describe('Type the menu on /menu', () => {
  it('a manager types two lines: they are read as a kept menu, not current, and the choice is offered', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Type the menu' }));
    const read = screen.getByRole('button', { name: 'Read this menu' });
    expect(read).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Line 1 name'), { target: { value: 'Raki' } });
    fireEvent.change(screen.getByLabelText('Line 1 section'), { target: { value: 'spirit' } });
    fireEvent.change(screen.getByLabelText('Line 1 bottle price'), { target: { value: '1.250,00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Another line' }));
    fireEvent.change(screen.getByLabelText('Line 2 name'), { target: { value: 'Mercimek' } });
    fireEvent.change(screen.getByLabelText('Line 2 bottle price'), { target: { value: '45,50' } });
    fireEvent.change(screen.getByLabelText('How often it changes'), { target: { value: 'monthly' } });
    fireEvent.click(read);
    await waitFor(() =>
      expect(mockImport).toHaveBeenCalledWith(
        'manual',
        { items: [{ name: 'Raki', category: 'spirit', bottle_typed: '1.250,00' }, { name: 'Mercimek', bottle_typed: '45,50' }] },
        { cadence: 'monthly' },
      ),
    );
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent(
      'Read 2 lines and kept this menu. It is not the current menu, and no price has changed.',
    );
    expect(screen.getByRole('button', { name: 'Make this the current menu' })).toBeInTheDocument();
    expect(mockMake).not.toHaveBeenCalled();
    // The box starts clean for the next menu.
    expect(screen.getAllByTestId('menu-typed-line')).toHaveLength(1);
    expect(screen.getByLabelText('Line 1 name')).toHaveValue('');
  });

  it('a line with a price but no name is said, and nothing is sent', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Type the menu' }));
    expect(screen.queryByTestId('menu-typed-refused')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Line 1 bottle price'), { target: { value: '40' } });
    expect(screen.getByTestId('menu-typed-refused')).toHaveTextContent('Line 1 has no name. Give it one, or leave it out.');
    expect(screen.getByRole('button', { name: 'Read this menu' })).toBeDisabled();
    // Enter in a box submits the form however the button stands: still nothing is sent.
    fireEvent.submit(screen.getByTestId('menu-read-form').querySelector('form')!);
    expect(await screen.findByTestId('menu-read-error')).toHaveTextContent('The menu was not read: Line 1 has no name. Give it one, or leave it out.');
    expect(mockImport).not.toHaveBeenCalled();
  });

  it("the gateway's refusal of a price is said in its words", async () => {
    mockImport.mockRejectedValue({
      response: { status: 400, data: { message: 'Line 1 (Raki): The bottle price "-45" is not a price: a price is written in digits, with no minus, no letters and at most one decimal mark. Nothing was kept.' } },
    });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Type the menu' }));
    fireEvent.change(screen.getByLabelText('Line 1 name'), { target: { value: 'Raki' } });
    fireEvent.change(screen.getByLabelText('Line 1 bottle price'), { target: { value: '-45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-error')).toHaveTextContent('Line 1 (Raki): The bottle price "-45" is not a price');
    // What was typed stays, to be put right.
    expect(screen.getByLabelText('Line 1 bottle price')).toHaveValue('-45');
  });

  it('a line can be left out, and the last one cannot', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Type the menu' }));
    expect(screen.getByRole('button', { name: 'Leave line 1 out' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Another line' }));
    fireEvent.click(screen.getByRole('button', { name: 'Another line' }));
    fireEvent.change(screen.getByLabelText('Line 1 name'), { target: { value: 'Raki' } });
    fireEvent.change(screen.getByLabelText('Line 2 name'), { target: { value: 'Efes' } });
    fireEvent.change(screen.getByLabelText('Line 3 name'), { target: { value: 'Su' } });
    fireEvent.click(screen.getByRole('button', { name: 'Leave line 2 out' }));
    const rows = screen.getAllByTestId('menu-typed-line');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByLabelText('Line 1 name')).toHaveValue('Raki');
    expect(within(rows[1]).getByLabelText('Line 2 name')).toHaveValue('Su');
  });

  it('staff see the same box: reading is not choosing', async () => {
    mount(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Type the menu' }));
    fireEvent.change(screen.getByLabelText('Line 1 name'), { target: { value: 'Raki' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    await waitFor(() => expect(mockImport).toHaveBeenCalledWith('manual', { items: [{ name: 'Raki' }] }, {}));
    expect(await screen.findByText(/An owner or a manager chooses whether it becomes the current menu/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument();
  });

  it('a file picked before typing is not read later: back on A file, the box is empty', async () => {
    mount(true);
    const file = new File(['name,bottle_price\nOpus,60\n'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    expect(screen.getByRole('button', { name: 'Read this menu' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Type the menu' }));
    fireEvent.click(screen.getByRole('button', { name: 'A file' }));
    expect(screen.getByRole('button', { name: 'Read this menu' })).toBeDisabled();
  });

  it('the typed rows scroll inside their own box, so a phone page does not widen (r43 walk, 375 px)', async () => {
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Type the menu' }));
    const box = screen.getByTestId('menu-typed-scroll');
    expect(box.style.overflowX).toBe('auto');
    expect(box.querySelector('table')).not.toBeNull();
  });
});
