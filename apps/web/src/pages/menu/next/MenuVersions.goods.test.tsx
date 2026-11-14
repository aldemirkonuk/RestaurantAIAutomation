/**
 * r28 G21: a read line that fits two or more of the house's own goods was linked
 * to neither and went to the library, so choosing the menu made a second good
 * beside the house's own. The read now names the goods, and an owner or a
 * manager links the line to the one it is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuVersions, SeveralGoods } from './MenuVersions';
import { getMenuPlan, importMenu, linkMenuLineToHouseGood, listMenuVersions, makeMenuCurrent, type MenuImportReviewItem } from '../../../services/api/menus';

vi.mock('../../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, listMenuVersions: vi.fn(), importMenu: vi.fn(), linkMenuLineToHouseGood: vi.fn(), getMenuPlan: vi.fn(), makeMenuCurrent: vi.fn() };
});

const mockList = vi.mocked(listMenuVersions);
const mockImport = vi.mocked(importMenu);
const mockLink = vi.mocked(linkMenuLineToHouseGood);

const item = (over: Partial<MenuImportReviewItem> = {}): MenuImportReviewItem => ({
  menuItemId: 'mi-red',
  submissionId: null,
  name: 'House Red',
  producer: null,
  category: 'Red',
  vintage: null,
  region: null,
  grapeVariety: null,
  byGlassPrice: null,
  bottlePrice: 40,
  rawText: null,
  matched: false,
  needsReview: true,
  ...over,
});
const two = [
  { inventoryItemId: 'inv-a', name: 'House Red', kind: 'wine' },
  { inventoryItemId: 'inv-b', name: 'House red.', kind: null },
];

/** Reads a file through the panel, with the gateway answering `items`. */
async function readIt(canManage: boolean, items: MenuImportReviewItem[]) {
  mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [], namesReadable: true, namesReason: null });
  mockImport.mockResolvedValue({ menuId: 'm9', itemsExtracted: items.length, submissionsCreated: 0, items });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MenuVersions canManage={canManage} />
    </QueryClientProvider>,
  );
  const file = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
  fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
  await screen.findByTestId('menu-read-result');
}

function planShown() {
  vi.mocked(getMenuPlan).mockResolvedValue({
    menuId: 'm9', current: false, generatedAt: '2026-11-13T12:00:00Z', fingerprint: 'fp-m9', lines: [],
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [], namesReadable: true, namesReason: null,
  } as never);
}

beforeEach(() => {
  mockList.mockReset();
  mockImport.mockReset();
  mockLink.mockReset();
});

describe('a read line that fits more than one of the house goods (r28 G21)', () => {
  it('says which lines fit more than one good, and a manager links one to the good it is', async () => {
    mockLink.mockResolvedValue({ menuItemId: 'mi-red', inventoryItemId: 'inv-a', goodName: 'House Red' });
    await readIt(true, [item({ houseCandidates: two }), item({ menuItemId: 'mi-one', name: 'Barolo', houseCandidates: [two[0]] }), item({ menuItemId: 'mi-x', name: 'Rosé' })]);
    expect(screen.getByTestId('menu-read-several-goods')).toHaveTextContent(
      "1 line fits more than one of the house's goods, so none was linked. Choose the good each one is, before this menu is made current; otherwise it is carried as a good of its own.",
    );
    expect(screen.getAllByTestId('menu-read-several-line')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Link House Red to House red.' })).toHaveTextContent('It is House red.');
    expect(screen.getByRole('button', { name: 'Link House Red to House Red (wine)' })).toHaveTextContent('It is House Red (wine)');
    // A plan open before the link is a plan of the old line: it is closed, to be read again.
    planShown();
    fireEvent.click(screen.getByRole('button', { name: 'Make this the current menu' }));
    await screen.findByRole('button', { name: 'Make it current' });
    fireEvent.click(screen.getByRole('button', { name: 'Link House Red to House Red (wine)' }));
    expect(await screen.findByTestId('menu-read-linked')).toHaveTextContent('Linked to House Red: choosing this menu carries its price there.');
    expect(mockLink).toHaveBeenCalledWith('m9', 'mi-red', 'inv-a');
    expect(screen.queryByRole('button', { name: /^Link House Red to/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make it current' })).not.toBeInTheDocument();
  });

  it("says the gateway's refusal on the line, keeps the choice open, and says nothing was linked", async () => {
    mockLink.mockRejectedValue({ response: { status: 409, data: { message: 'That good is removed on Inventory. Bring it back there first. Nothing was changed.' } } });
    const onLinked = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeveralGoods menuId="m9" canManage onLinked={onLinked} items={[item({ houseCandidates: two })]} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Link House Red to House Red (wine)' }));
    expect(await screen.findByTestId('menu-read-link-refused')).toHaveTextContent(
      'It was not linked: That good is removed on Inventory. Bring it back there first. Nothing was changed.',
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link House Red to House red.' })).toBeEnabled());
    expect(screen.queryByTestId('menu-read-linked')).not.toBeInTheDocument();
    expect(onLinked).not.toHaveBeenCalled();
  });

  // r37 walk w1 M-F1: two goods of one name gave two identical buttons.
  it('two goods of one name get two buttons that say what tells them apart', async () => {
    const twins = [
      { inventoryItemId: 'inv-w1', name: 'House White', kind: 'wine', bottleSizeMl: 750, source: 'house_declared' },
      { inventoryItemId: 'inv-w2', name: 'House White', kind: 'wine', bottleSizeMl: 1000, source: 'house_declared' },
    ];
    mockLink.mockResolvedValue({ menuItemId: 'mi-red', inventoryItemId: 'inv-w2', goodName: 'House White' });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SeveralGoods menuId="m9" canManage onLinked={vi.fn()} items={[item({ name: 'House White', houseCandidates: twins })]} />
      </QueryClientProvider>,
    );
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Link House White to House White (wine, 750 ml)', 'Link House White to House White (wine, 1000 ml)']);
    fireEvent.click(screen.getByRole('button', { name: 'Link House White to House White (wine, 1000 ml)' }));
    await waitFor(() => expect(mockLink).toHaveBeenCalledWith('m9', 'mi-red', 'inv-w2'));
  });

  it('names the goods to staff without a button', async () => {
    await readIt(false, [item({ houseCandidates: two })]);
    expect(screen.getByTestId('menu-read-several-goods')).toHaveTextContent('An owner or a manager chooses which good each one is');
    expect(screen.queryByRole('button', { name: /^Link / })).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-read-several-line')).toHaveTextContent('House red.');
  });

  it('takes the choice away once the menu is made current: its lines were carried', async () => {
    planShown();
    vi.mocked(makeMenuCurrent).mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 1, priceSync: { changed: 1 }, flagged: 0, failed: [] } as never);
    await readIt(true, [item({ houseCandidates: two })]);
    expect(screen.getByTestId('menu-read-several-goods')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make this the current menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await screen.findByTestId('menu-choice-said');
    expect(screen.queryByTestId('menu-read-several-goods')).not.toBeInTheDocument();
  });

  it('says nothing for a read where no line fits two goods', async () => {
    await readIt(true, [item({ houseCandidates: [two[0]] }), item({ menuItemId: 'mi-2' })]);
    expect(screen.queryByTestId('menu-read-several-goods')).not.toBeInTheDocument();
  });
});
