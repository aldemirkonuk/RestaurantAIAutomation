/**
 * Correct a current line's name or section in place (r108 menu-g15).
 * Owner and manager only; the same PATCH as the price; Enter saves, Escape
 * restores; a rename that also renames an inventory good says so before it
 * is saved; a move between drinks and the kitchen is refused in words.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MenuNext from './MenuNext';
import { KIND_MOVE_REFUSED } from './MenuLineCorrect';
import { getMenu, listMenuVersions, reviewMenuItem, type ActiveMenu, type MenuLine } from '../../../services/api/menus';
import { settingsApi } from '../../../services/api/settings';

let role: string | null = 'manager';
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, activeRole: role }),
}));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return {
    ...actual,
    getMenu: vi.fn(),
    reviewMenuItem: vi.fn(),
    listMenuVersions: vi.fn().mockResolvedValue({ current: null, lastUsed: null, versions: [] }),
  };
});
vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>('../../../services/api/pricing');
  return {
    ...actual,
    listPriceLocks: vi.fn().mockResolvedValue({
      restaurantId: 'r1', generatedAt: '2026-09-21T12:00:00Z', readable: true, reason: null, scope: 'this house',
      currentMenus: [], locks: [], counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 },
      namesReadable: true, namesReason: null, markersReadable: true, markersReason: null,
    }),
  };
});
vi.mock('../../../services/api/settings', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/settings')>('../../../services/api/settings');
  return { ...actual, settingsApi: { ...actual.settingsApi, houseCurrency: vi.fn() } };
});

const mockGetMenu = vi.mocked(getMenu);
const mockReview = vi.mocked(reviewMenuItem);

const chiant = (over: Partial<MenuLine> = {}): MenuLine => ({
  id: 'w1', name: 'Chiant', producer: null, category: 'red', vintage: null, region: null, country: null,
  grape_variety: null, by_glass_price: 12, bottle_price: 48, wine_library_id: null, inventory_item_id: 'inv-1',
  source: 'manual', status: 'approved', created_at: '2026-09-17T00:00:00Z', kitchen_line: false, ...over,
});
const menu = (items: MenuLine[]): ActiveMenu => ({ menuId: 'm1', name: 'Main', status: 'active', items });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MenuNext />
    </QueryClientProvider>,
  );
}
const openCorrect = async (name = 'Chiant') => fireEvent.click(await screen.findByRole('button', { name: `Correct the name or section of ${name}` }));

beforeEach(() => {
  mockGetMenu.mockReset();
  mockReview.mockReset();
  role = 'manager';
  vi.mocked(settingsApi.houseCurrency).mockResolvedValue({
    restaurantId: 'r1', code: 'TRY', country: 'Türkiye', readable: true, reason: null, statedAt: '2026-09-05T00:00:00Z',
  });
  vi.mocked(listMenuVersions).mockResolvedValue({ current: null, lastUsed: null, versions: [] });
});

describe('Correct, beside Change price', () => {
  it('a manager renames Chiant to Chianti; a linked good is named before saving; one PATCH; the menu is read again', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mockReview.mockResolvedValue({ menuItemId: 'w1', fieldName: 'name', newValue: 'Chianti' });
    mount();
    await openCorrect();
    const box = screen.getByLabelText('Name of Chiant');
    expect(box).toHaveFocus();
    expect(screen.queryByTestId('menu-correct-inventory')).not.toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'Chianti' } });
    // Said before anything is saved.
    expect(screen.getByTestId('menu-correct-inventory')).toHaveTextContent('This also renames Chiant on Inventory.');
    expect(mockReview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('menu-correct-save'));
    await waitFor(() => expect(mockReview).toHaveBeenCalledTimes(1));
    expect(mockReview).toHaveBeenCalledWith('w1', 'name', 'Chianti');
    expect(await screen.findByTestId('menu-correct-note')).toHaveTextContent('was corrected');
    await waitFor(() => expect(mockGetMenu).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('menu-correct-name')).not.toBeInTheDocument();
  });

  it('a line with no linked good says nothing about Inventory', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant({ inventory_item_id: null })]));
    mount();
    await openCorrect();
    fireEvent.change(screen.getByLabelText('Name of Chiant'), { target: { value: 'Chianti' } });
    expect(screen.queryByTestId('menu-correct-inventory')).not.toBeInTheDocument();
  });

  it('staff see no Correct', async () => {
    role = 'staff';
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mount();
    await screen.findAllByTestId('menu-row');
    expect(screen.queryByTestId('menu-correct-open')).not.toBeInTheDocument();
  });

  it('a section moved within the drinks is sent as category', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mockReview.mockResolvedValue({ menuItemId: 'w1', fieldName: 'category', newValue: 'white' });
    mount();
    await openCorrect();
    fireEvent.change(screen.getByLabelText('Section of Chiant'), { target: { value: 'white' } });
    fireEvent.keyDown(screen.getByLabelText('Section of Chiant'), { key: 'Enter' });
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('w1', 'category', 'white'));
    expect(mockReview).toHaveBeenCalledTimes(1);
  });

  it('a move between drinks and the kitchen is refused in words, before anything is sent', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mount();
    await openCorrect();
    fireEvent.change(screen.getByLabelText('Section of Chiant'), { target: { value: 'dessert' } });
    expect(screen.getByTestId('menu-correct-refused')).toHaveTextContent(KIND_MOVE_REFUSED);
    fireEvent.click(screen.getByTestId('menu-correct-save'));
    expect(await screen.findByTestId('menu-correct-note')).toHaveTextContent(KIND_MOVE_REFUSED);
    expect(mockReview).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Section of Chiant')).toBeInTheDocument();
  });

  it('a refused save restores the old name and says the gateway\'s own words', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mockReview.mockRejectedValue({ response: { status: 400, data: { message: 'A name may not be longer than 200 letters.' } } });
    mount();
    await openCorrect();
    fireEvent.change(screen.getByLabelText('Name of Chiant'), { target: { value: 'Chianti' } });
    fireEvent.click(screen.getByTestId('menu-correct-save'));
    expect(await screen.findByTestId('menu-correct-note')).toHaveTextContent('A name may not be longer than 200 letters.');
    expect(screen.getByTestId('menu-correct-note')).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId('menu-correct-name')).not.toBeInTheDocument();
    expect(screen.getByText('Chiant')).toBeInTheDocument();
    expect(screen.queryByText('Chianti')).not.toBeInTheDocument();
  });

  it('Escape restores and closes, sends nothing, and hands the cursor back to Correct', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mount();
    await openCorrect();
    const box = screen.getByLabelText('Name of Chiant');
    fireEvent.change(box, { target: { value: 'Something else' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(mockReview).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Correct the name or section of Chiant' })).toHaveFocus();
    await openCorrect();
    expect(screen.getByLabelText('Name of Chiant')).toHaveValue('Chiant');
  });

  it('a blank name is not sent', async () => {
    mockGetMenu.mockResolvedValue(menu([chiant()]));
    mount();
    await openCorrect();
    fireEvent.change(screen.getByLabelText('Name of Chiant'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('menu-correct-save'));
    expect(await screen.findByTestId('menu-correct-note')).toHaveTextContent('A line needs a name.');
    expect(mockReview).not.toHaveBeenCalled();
  });
});
