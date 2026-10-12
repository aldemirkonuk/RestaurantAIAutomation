/**
 * Menus kept (ADR 0193, menu versions; the founder, 2026-09-21, answer 7):
 * every read is kept, the current menu and the last one used are named, a new
 * read carries an optional cadence tag and date, and only an owner or manager
 * is offered the choice of the current menu.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MenuVersions,
  isLegacyVersion,
  makeCurrentSentence,
  readMenuDate,
  sourceWords,
  versionLabel,
  versionTimelines,
} from './MenuVersions';
import {
  getMenuPlan,
  importMenu,
  listMenuVersions,
  makeMenuCurrent,
  type MenuPlan,
  type MenuVersion,
} from '../../../services/api/menus';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>(
    '../../../services/api/menus',
  );
  return {
    ...actual,
    listMenuVersions: vi.fn(),
    makeMenuCurrent: vi.fn(),
    importMenu: vi.fn(),
    getMenuSourceUrl: vi.fn(),
    getMenuPlan: vi.fn(),
  };
});

/** A plan with nothing to hold: the choice goes straight through (ADR 0193 round 3, L13). */
function plan(menuId: string, over: Partial<MenuPlan> = {}): MenuPlan {
  return {
    menuId,
    current: false,
    generatedAt: '2026-09-21T12:00:00Z',
    fingerprint: `fp-${menuId}`,
    // One unchanged line: a plan of no lines offers no choice (F-681).
    lines: [
      {
        menuItemId: 'n1',
        name: 'Chianti',
        producer: null,
        vintage: null,
        wineLibraryId: 'mw-2',
        inventoryId: 'inv-2',
        house: { wineName: 'Chianti', vintage: 2021, active: true },
        bottle: { kind: 'bottle', menuPrice: 50, housePrice: 50, result: 'unchanged', lastSet: null, lock: null },
        glass: { kind: 'glass', menuPrice: null, housePrice: null, result: 'blank_never_priced', lastSet: null, lock: null },
        flag: null,
        returned: false,
        vintageMismatch: false,
      },
    ],
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
    ...over,
  };
}
const mockPlan = vi.mocked(getMenuPlan);

const mockList = vi.mocked(listMenuVersions);
const mockMake = vi.mocked(makeMenuCurrent);
const mockImport = vi.mocked(importMenu);

function version(over: Partial<MenuVersion> = {}): MenuVersion {
  return {
    menuId: 'm1',
    name: 'Wine List',
    status: 'draft',
    current: false,
    cadence: null,
    menuDate: null,
    menuDatePrecision: null,
    sourceMethod: 'scan',
    source: { kept: true, mime: 'application/pdf', bytes: 1000, failure: null },
    linesExtracted: 42,
    extractedAt: '2026-09-20T10:00:00Z',
    extractedBy: { userId: 'u1', name: 'Ada' },
    madeCurrentAt: null,
    madeCurrentBy: null,
    retiredAt: null,
    retiredBy: null,
    createdAt: '2026-09-20T10:00:00Z',
    ...over,
  };
}

function mount(canManage: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuVersions canManage={canManage} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockList.mockReset();
  mockMake.mockReset();
  mockImport.mockReset();
  mockPlan.mockReset();
  mockPlan.mockImplementation(async (id: string) => plan(id));
});

describe('the words the panel uses', () => {
  it('names a menu by its own date, its month, or when it was read, with its cadence', () => {
    expect(versionLabel(version({ menuDate: '2026-10', menuDatePrecision: 'month', cadence: 'monthly' }))).toBe(
      'the 2026-10 menu (monthly)',
    );
    expect(versionLabel(version({ menuDate: '2026-10-15', menuDatePrecision: 'day' }))).toBe('the menu for 2026-10-15');
    expect(versionLabel(version())).toBe('the menu read 2026-09-20');
    expect(versionLabel(version({ extractedAt: null }))).toBe('a menu read before menus were kept');
  });

  it("F-699: a moment is the house's day, never UTC's", () => {
    // 18:30 in Los Angeles on 2026-09-20 is 01:30 UTC on the 21st.
    expect(versionLabel(version({ extractedAt: '2026-09-21T01:30:00Z' }), 'America/Los_Angeles')).toBe('the menu read 2026-09-20');
    // A menu's own date is a calendar day already; no zone moves it.
    expect(versionLabel(version({ menuDate: '2026-10-15', menuDatePrecision: 'day' }), 'Pacific/Auckland')).toBe('the menu for 2026-10-15');
  });

  it("F-699: 'current since' and 'used until' print the house's day", async () => {
    mockList.mockResolvedValue({
      current: null,
      lastUsed: null,
      timezone: 'America/Los_Angeles',
      versions: [
        version({ menuId: 'm2', status: 'active', current: true, madeCurrentAt: '2026-09-02T01:00:00Z' }),
        version({ menuId: 'm3', status: 'archived', retiredAt: '2026-09-02T01:00:00Z' }),
      ],
    });
    mount(true);
    const rows = await screen.findAllByTestId('menu-version-row');
    expect(rows[0]).toHaveTextContent('current since 2026-09-01');
    expect(rows[1]).toHaveTextContent('used until 2026-09-01');
  });

  it('says what happened to the source, including why it was not kept', () => {
    expect(sourceWords(version())).toBe('PDF kept');
    expect(sourceWords(version({ source: { kept: false, mime: null, bytes: null, failure: 'bucket unavailable' } }))).toBe(
      'source not kept: bucket unavailable',
    );
    expect(sourceWords(version({ sourceMethod: 'manual', source: { kept: false, mime: null, bytes: null, failure: null } }))).toBe(
      'typed in, no file',
    );
  });

  it('a date is a day or a month, and nothing else', () => {
    expect(readMenuDate('')).toEqual({ ok: true, value: undefined, error: null });
    expect(readMenuDate('2026-10').value).toBe('2026-10');
    expect(readMenuDate('2026-10-15').value).toBe('2026-10-15');
    expect(readMenuDate('October').ok).toBe(false);
    expect(readMenuDate('2026-13').ok).toBe(false);
  });

  it('says what making a menu current did, including the flagged and failed lines', () => {
    expect(
      makeCurrentSentence({
        outcome: 'made_current',
        menuId: 'm1',
        previousMenuIds: ['m0'],
        lines: 3,
        priceSync: { changed: 1, stale: 1, not_linked: 1 },
        flagged: 1,
        failed: [{ menuItemId: 'l9', name: 'Barolo', error: 'timeout' }],
      }),
    ).toBe(
      'This is now the current menu: 3 lines, 1 price set from this menu, 1 kept a price someone set after this menu was chosen, 1 not matched to a wine, so no price, 1 flagged for a blank price. 1 could not be priced: Barolo (timeout).',
    );
  });

  it('ADR 0193 round 3 (L15): a held kind is counted AND named, a returned lock is named, and an outcome the page does not know is still printed', () => {
    const s = makeCurrentSentence({
      outcome: 'made_current',
      menuId: 'm1',
      previousMenuIds: ['m0'],
      lines: 4,
      priceSync: { changed: 2, locked: 1, something_new: 1 },
      flagged: 0,
      failed: [],
      held: [
        { menuItemId: 'l1', name: 'Barolo', kind: 'bottle', lockId: 'k1', lockedPrice: 95, lockedBy: 'u1', lockedAt: '2026-09-01T00:00:00Z' },
        { menuItemId: 'l2', name: 'Soave', kind: 'glass', lockId: 'k2', lockedPrice: 9, lockedBy: 'u1', lockedAt: '2026-09-01T00:00:00Z' },
      ],
      returned: [{ menuItemId: 'l1', name: 'Barolo' }],
    });
    expect(s).toBe(
      'This is now the current menu: 4 lines, 2 prices set from this menu, 1 held by a lock, 1 something new. Held by a lock, not changed: Barolo (bottle, locked at 95.00); Soave (glass, locked at 9.00). Back on the menu with its lock still holding: Barolo.',
    );
  });
});

describe('MenuVersions', () => {
  it('names the current menu and the last one used, and lists every kept menu', async () => {
    mockList.mockResolvedValue({
      current: version({ menuId: 'm2', status: 'active', current: true, madeCurrentAt: '2026-09-01T00:00:00Z', madeCurrentBy: { userId: 'u2', name: 'Bo' } }),
      lastUsed: version({ menuId: 'm1', status: 'archived', retiredAt: '2026-09-01T00:00:00Z' }),
      versions: [
        version({ menuId: 'm3' }),
        version({ menuId: 'm2', status: 'active', current: true, madeCurrentAt: '2026-09-01T00:00:00Z', madeCurrentBy: { userId: 'u2', name: 'Bo' } }),
        version({ menuId: 'm1', status: 'archived', retiredAt: '2026-09-01T00:00:00Z' }),
      ],
    });
    mount(true);
    expect(await screen.findByTestId('menu-versions-standing')).toHaveTextContent(
      'Current: the menu read 2026-09-20. Last one used: the menu read 2026-09-20.',
    );
    const rows = screen.getAllByTestId('menu-version-row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('current since 2026-09-01, chosen by Bo');
    expect(rows[2]).toHaveTextContent('last one used, used until 2026-09-01');
    // The current menu offers nothing; a draft is made current, a used menu restored (ADR 0340 rule 20).
    expect(screen.getAllByRole('button', { name: /^Make .* current$/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^Restore / })).toHaveLength(1);
  });

  it('ADR 0340 rule 20: each kind has its own timeline, and a legacy row sits read only on Drinks', async () => {
    const drinks = version({ menuId: 'd1', kind: 'beverage', status: 'active', current: true, madeCurrentAt: '2026-09-01T00:00:00Z' });
    const food = version({ menuId: 'f1', kind: 'food', status: 'archived', retiredAt: '2026-09-02T00:00:00Z' });
    const bar = version({ menuId: 'b1', kind: 'bar', status: 'archived', retiredAt: '2026-08-01T00:00:00Z' });
    mockList.mockResolvedValue({
      current: drinks,
      lastUsed: null,
      currentByKind: { beverage: drinks, food: null, desserts: null },
      versions: [drinks, food, bar],
    });
    mount(true);
    const drinksLine = await screen.findByTestId('menu-versions-timeline-beverage');
    const foodLine = screen.getByTestId('menu-versions-timeline-food');
    // A kind with no kept menu has no timeline.
    expect(screen.queryByTestId('menu-versions-timeline-desserts')).not.toBeInTheDocument();
    expect(drinksLine).toHaveTextContent('Live: the menu read 2026-09-20.');
    expect(foodLine).toHaveTextContent('No Food menu is live.');
    // The legacy bar menu is on Drinks, named by its old kind, with no button.
    const legacy = within(drinksLine).getByTestId('menu-version-legacy');
    expect(legacy).toHaveTextContent('Old kind: bar.');
    const legacyRow = legacy.closest('tr') as HTMLElement;
    expect(within(legacyRow).queryByRole('button', { name: /^Restore |^Make / })).not.toBeInTheDocument();
    // Its file still opens: it stays readable (0193 "every extraction stays accessible").
    expect(within(legacyRow).getByRole('button', { name: 'Open PDF' })).toBeInTheDocument();
    expect(within(foodLine).getAllByTestId('menu-version-row')).toHaveLength(1);
    expect(within(foodLine).getByRole('button', { name: 'Restore the menu read 2026-09-20' })).toBeInTheDocument();
  });

  it('restore opens the same review, and nothing is made live until it is confirmed', async () => {
    const food = version({ menuId: 'f1', kind: 'food', status: 'archived', retiredAt: '2026-09-02T00:00:00Z' });
    mockList.mockResolvedValue({ current: null, lastUsed: food, currentByKind: { beverage: null, food: null, desserts: null }, versions: [food] });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore the menu read 2026-09-20' }));
    await waitFor(() => expect(mockPlan.mock.calls[0]?.[0]).toBe('f1'));
    expect(await screen.findByRole('button', { name: 'Make it current' })).toBeInTheDocument();
    expect(mockMake).not.toHaveBeenCalled();
  });

  it('a row with no kind (an older gateway) is not legacy: it is restored as before', () => {
    expect(isLegacyVersion(version())).toBe(false);
    expect(isLegacyVersion(version({ kind: null }))).toBe(false);
    expect(isLegacyVersion(version({ kind: 'events' }))).toBe(true);
    expect(isLegacyVersion(version({ kind: 'desserts' }))).toBe(false);
    expect(versionTimelines([version({ kind: 'full' }), version({ kind: null })]).map((t) => [t.kind, t.versions.length])).toEqual([['beverage', 2]]);
  });

  it('a failed read of the kept menus says so -- not "none kept"', async () => {
    mockList.mockRejectedValue(new Error('timeout'));
    mount(true);
    expect(await screen.findByTestId('menu-versions-error')).toHaveTextContent(/could not be read \(timeout\)/);
    expect(screen.queryByText('No menu has been read yet.')).not.toBeInTheDocument();
  });

  it('a manager makes a kept menu current, and is told what it did', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [version()] });
    mockMake.mockResolvedValue({
      outcome: 'made_current',
      menuId: 'm1',
      previousMenuIds: [],
      lines: 42,
      priceSync: { changed: 40 },
      flagged: 2,
      failed: [],
    });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Make the menu read 2026-09-20 current' }));
    // The plan comes first (L13); nothing is chosen until the person confirms it.
    expect(await screen.findByTestId('menu-plan')).toBeInTheDocument();
    expect(mockMake).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m1', 'fp-m1'));
    expect(await screen.findByText(/This is now the current menu: 42 lines, 40 prices set from this menu, 2 flagged/)).toBeInTheDocument();
  });

  it('staff see every kept menu but are offered no choice of the current one', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [version()] });
    mount(false);
    expect(await screen.findAllByTestId('menu-version-row')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /current$/ })).not.toBeInTheDocument();
  });

  it('staff are not offered the kept file, and are told who can open it (F-1386)', async () => {
    mockList.mockResolvedValue({
      current: null,
      lastUsed: null,
      versions: [
        version(),
        version({ menuId: 'm2', source: { kept: true, mime: 'text/csv', bytes: 10, failure: null } }),
      ],
    });
    mount(false);
    expect(await screen.findAllByTestId('menu-version-row')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
    expect(screen.getAllByTestId('menu-version-source-held').map((n) => n.textContent)).toEqual([
      'PDF kept, for an owner or a manager to open',
      'file kept, for an owner or a manager to open',
    ]);
  });

  it('an owner or manager is offered the kept file', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [version()] });
    mount(true);
    expect(await screen.findByRole('button', { name: 'Open PDF' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-version-source-held')).not.toBeInTheDocument();
  });

  it('reading a menu sends only the labels given, keeps it, and then offers the choice', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({
      menuId: 'm9',
      current: false,
      itemsExtracted: 12,
      submissionsCreated: 0,
      items: [],
      source: { kept: true, failure: null },
    });
    mockMake.mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 12, priceSync: { changed: 12 }, flagged: 0, failed: [] });
    mount(true);
    const file = new File(['name,bottle_price\nOpus,60\n'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('How often it changes'), { target: { value: 'monthly' } });
    fireEvent.change(screen.getByLabelText('Menu date'), { target: { value: '2026-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    await waitFor(() =>
      expect(mockImport).toHaveBeenCalledWith('csv', { csvContent: 'name,bottle_price\nOpus,60\n' }, { cadence: 'monthly', menuDate: '2026-10' }),
    );
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent(
      'Read 12 lines and kept this menu. It is not the current menu, and no price has changed.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make this the current menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9', 'fp-m9'));
    expect(await screen.findByTestId('menu-choice-said')).toHaveTextContent('This is now the current menu: 12 lines');
  });

  it('a photo read only in part says so after the read and on its kept row (F-1292)', async () => {
    mockList.mockResolvedValue({
      current: null,
      lastUsed: null,
      versions: [version({ partRead: '1 of the 2 parts of the file could not be read' })],
    });
    mockImport.mockResolvedValue({
      menuId: 'm9',
      current: false,
      itemsExtracted: 12,
      submissionsCreated: 0,
      items: [],
      source: { kept: true, failure: null },
      partRead: 'the reading stopped before the end of the menu',
    });
    mount(true);
    expect(await screen.findByTestId('menu-version-part-read')).toHaveTextContent(
      'Only part of the menu was read: 1 of the 2 parts of the file could not be read.',
    );
    const file = new File(['x'], 'menu.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent(
      'Read 12 lines and kept this menu. Only part of the menu was read: the reading stopped before the end of the menu, so drinks may be missing.',
    );
  });

  it('names the columns of the file that were not read, and how to have one read (F-070)', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({
      menuId: 'm9',
      itemsExtracted: 1,
      submissionsCreated: 0,
      items: [],
      unreadColumns: ['glass', 'Notes'],
    });
    mount(true);
    const file = new File(['name,glass,Notes\nOpus,14,x\n'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    const said = await screen.findByTestId('menu-read-unread-columns');
    expect(said).toHaveTextContent('These columns were not read: glass, Notes.');
    expect(said).toHaveTextContent('rename its heading in the file');
  });

  it('a file whose every column was read says nothing about columns', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [], unreadColumns: [] });
    mount(true);
    const file = new File(['name,bottle\nOpus,60\n'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    await screen.findByTestId('menu-read-result');
    expect(screen.queryByTestId('menu-read-unread-columns')).toBeNull();
  });

  it('a spreadsheet read names the rows it skipped (F-684)', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({
      menuId: 'm9',
      itemsExtracted: 3,
      submissionsCreated: 0,
      items: [],
      read: {
        ignoredColumns: ['Notes', 'Cost'],
        dropped: [{ row: 2, reason: '"RED WINES" looks like a heading (no price)' }],
        unreadable: [],
      },
    });
    mount(true);
    const file = new File(['x'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-dropped')).toHaveTextContent(
      '1 row skipped: row 2 ("RED WINES" looks like a heading (no price)).',
    );
  });

  it('a read of no lines offers no choice of current menu (F-681)', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({ menuId: 'm9', itemsExtracted: 0, submissionsCreated: 0, items: [] });
    mount(true);
    const file = new File(['x'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent('Read 0 lines');
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument();
  });

  it('an untagged read sends no cadence and no date -- never a default', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [] });
    mount(false);
    const file = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    await waitFor(() => expect(mockImport).toHaveBeenCalled());
    expect(mockImport.mock.calls[0][0]).toBe('scan');
    expect(mockImport.mock.calls[0][2]).toEqual({});
    expect(await screen.findByText(/An owner or a manager chooses whether it becomes the current menu/)).toBeInTheDocument();
  });

  it('a read that WAITS on the spend record says the gateway\'s reason', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockRejectedValue({
      response: {
        status: 503,
        data: { message: "This restaurant's AI spend record could not be read, so the menu read is waiting: nothing was sent to the model and nothing was charged." },
      },
    });
    mount(true);
    const file = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-error')).toHaveTextContent(/the menu read is waiting: nothing was sent/);
  });

  it('a read with no answer says it may still be kept and fetches the kept menus again (F-567)', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockRejectedValue(
      Object.assign(new Error('timeout of 300000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED', request: {} }),
    );
    mount(true);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    const file = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    const said = await screen.findByTestId('menu-read-error');
    expect(said).toHaveTextContent(/It may still be reading and keeping this menu/);
    expect(said).not.toHaveTextContent(/was not read/);
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('waits longer for a menu read than the gateway\'s 180 s model read (F-567)', async () => {
    const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
    const { apiClient } = await import('../../../services/api/client');
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await actual.importMenu('scan', { imageBase64: 'x' });
    const config = post.mock.calls[0][2] as { timeout?: number } | undefined;
    expect(config?.timeout).toBeGreaterThan(180_000);
    post.mockRestore();
  });
});
