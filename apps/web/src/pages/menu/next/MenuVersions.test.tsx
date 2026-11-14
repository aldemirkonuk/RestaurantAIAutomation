/**
 * Menus kept (ADR 0193, menu versions; the founder, 2026-09-21, answer 7):
 * every read is kept, the current menu and the last one used are named, a new
 * read carries an optional cadence tag and date, and only an owner or manager
 * is offered the choice of the current menu.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MENU_FILE_ACCEPT,
  MenuVersions,
  menuFileRefusal,
  makeCurrentSentence,
  readMenuDate,
  sourceWords,
  versionLabel,
} from './MenuVersions';
import { formatMoney } from '../../../lib/currency';

vi.mock('../../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'TRY' }));
/** A price as a lira house writes it: the page routes every price through formatMoney. */
const m = (n: number) => formatMoney(n, 'TRY');

import {
  getMenuPlan,
  importMenu,
  listMenuVersions,
  makeMenuCurrent,
  readWarningSentence,
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
    lines: [],
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
  return render(
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
      'This is now the current menu: 3 lines, 1 priced from this menu, 1 kept a price someone set after this menu was chosen, 1 not matched to a wine, so no price, 1 flagged for a blank price. 1 could not be priced: Barolo (timeout).',
    );
  });

  it('r28 G1: the current menu chosen again says its prices were carried again; with no line it changed nothing', () => {
    const base = { outcome: 'already_current' as const, menuId: 'm1', previousMenuIds: [], flagged: 0 };
    expect(makeCurrentSentence({ ...base, lines: 0, priceSync: {}, failed: [] })).toBe('That menu was already the current one. Nothing changed.');
    expect(
      makeCurrentSentence({ ...base, lines: 3, priceSync: { changed: 1, unchanged: 1, stale: 1 }, failed: [] }),
    ).toBe(
      "That menu was already the current one; its prices were carried again: 3 lines, 1 priced from this menu, 1 already at the menu's price, 1 kept a price someone set after this menu was chosen.",
    );
  });

  it('r33 w1 F2: the result counts LINES, so a line with a bottle and a glass price is one, not "1 price"', () => {
    // Walked: the plan said "set 2 prices…, find 2 prices already the same"
    // (one line, both its prices) and the result said "1 price set".
    const s = makeCurrentSentence({
      outcome: 'made_current',
      menuId: 'm1',
      previousMenuIds: ['m0'],
      lines: 2,
      priceSync: { changed: 1, unchanged: 1 },
      flagged: 0,
      failed: [],
    });
    expect(s).toBe("This is now the current menu: 2 lines, 1 priced from this menu, 1 already at the menu's price.");
    expect(s).not.toMatch(/\bprices? set\b/);
    // Nothing priced is said as none, not as "0 prices".
    expect(
      makeCurrentSentence({
        outcome: 'made_current',
        menuId: 'm1',
        previousMenuIds: [],
        lines: 2,
        priceSync: { unchanged: 2 },
        flagged: 0,
        failed: [],
      }),
    ).toBe("This is now the current menu: 2 lines, none priced from this menu, 2 already at the menu's price.");
  });

  it('says how many kitchen lines stay on the menu and are carried nowhere', () => {
    expect(
      makeCurrentSentence({
        outcome: 'made_current',
        menuId: 'm1',
        previousMenuIds: [],
        lines: 4,
        priceSync: { changed: 3, kitchen_line: 1 },
        flagged: 0,
        failed: [],
      }),
    ).toBe('This is now the current menu: 4 lines, 3 priced from this menu, 1 kitchen line, on the menu and carried nowhere.');
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
    }, 'TRY');
    expect(s).toBe(
      `This is now the current menu: 4 lines, 2 priced from this menu, 1 held by a lock, 1 something new. Held by a lock, not changed: Barolo (bottle, locked at ${m(95)}); Soave (glass, locked at ${m(9)}). Back on the menu with its lock still holding: Barolo.`,
    );
  });
});

describe('the sentence for each part of a file that was not read (ADR 0213 #17)', () => {
  it('names the pages when they are known, one sentence per warning', () => {
    expect(readWarningSentence({ kind: 'chunk_failed', pages: { first: 13, last: 14 } })).toBe(
      'Pages 13–14 could not be read; send them again.',
    );
    expect(readWarningSentence({ kind: 'chunk_failed', pages: { first: 7, last: 7 } })).toBe(
      'Page 7 could not be read; send it again.',
    );
    expect(readWarningSentence({ kind: 'truncated', pages: { first: 19, last: 20 } })).toBe(
      'Pages 19–20 were cut off partway, so some lines may be missing; send them again as a smaller file.',
    );
    expect(readWarningSentence({ kind: 'page_cap', pages: { first: 121, last: 150 } })).toBe(
      'Pages 121–150 were not read, because only the first 120 pages of a file are read; send them as a file of their own.',
    );
    expect(readWarningSentence({ kind: 'unreadable_reply', pages: { first: 1, last: 10 } })).toBe(
      'Pages 1–10 came back in a form that could not be read; send them again.',
    );
  });

  it('says so plainly when no page range is known, and for a kind it does not know', () => {
    expect(readWarningSentence({ kind: 'truncated', pages: null })).toBe(
      'The reading was cut off partway, so some lines may be missing; send the menu again in smaller files.',
    );
    expect(readWarningSentence({ kind: 'unreadable_reply', pages: null })).toBe(
      'The reading came back in a form that could not be read; send the file again.',
    );
    expect(readWarningSentence({ kind: 'something_new', pages: null })).toBe(
      'Part of this file may not have been read; send it again.',
    );
  });
});

describe('MenuVersions', () => {
  it('a kept menu says which of its pages were not read; one read before warnings were kept says nothing', async () => {
    mockList.mockResolvedValue({
      current: null,
      lastUsed: null,
      versions: [
        version({ menuId: 'm2', readWarnings: [{ kind: 'chunk_failed', pages: { first: 13, last: 14 } }, { kind: 'page_cap', pages: { first: 121, last: 130 } }] }),
        version({ menuId: 'm1', readWarnings: null }),
      ],
    });
    mount(false);
    const rows = await screen.findAllByTestId('menu-version-row');
    const items = rows[0].querySelectorAll('[data-testid="menu-version-warnings"] li');
    expect(Array.from(items).map((li) => li.textContent)).toEqual([
      'Pages 13–14 could not be read; send them again.',
      'Pages 121–130 were not read, because only the first 120 pages of a file are read; send them as a file of their own.',
    ]);
    expect(rows[1].querySelector('[data-testid="menu-version-warnings"]')).toBeNull();
  });

  it('ADR 0358 D2: the kept file opens for an owner or a manager; staff are told it was kept, with no link', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [version({ menuId: 'm2' })] });
    const { unmount } = mount(false);
    const row = (await screen.findAllByTestId('menu-version-row'))[0];
    expect(row).toHaveTextContent('PDF kept');
    expect(screen.queryByRole('button', { name: 'Open PDF' })).not.toBeInTheDocument();
    unmount();
    mount(true);
    expect(await screen.findByRole('button', { name: 'Open PDF' })).toBeInTheDocument();
  });

  it('a read that kept a menu with missing pages says which, under its result', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({
      menuId: 'm9',
      itemsExtracted: 30,
      submissionsCreated: 0,
      items: [],
      warnings: [{ kind: 'truncated', pages: { first: 19, last: 20 } }],
    });
    mount(false);
    const file = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-warnings')).toHaveTextContent(
      'Pages 19–20 were cut off partway, so some lines may be missing; send them again as a smaller file.',
    );
  });

  it('a read refused for finding no line says the gateway\'s sentence and the pages that failed', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: 'No line could be read from this file, so no menu was kept. Try a clearer photo or the PDF itself.',
          warnings: [{ kind: 'chunk_failed', pages: { first: 1, last: 10 } }],
        },
      },
    });
    mount(true);
    const file = new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-error')).toHaveTextContent(
      'The menu was not read: No line could be read from this file, so no menu was kept. Try a clearer photo or the PDF itself.',
    );
    expect(screen.getByTestId('menu-read-error').textContent).not.toMatch(/\.\.$/);
    expect(screen.getByTestId('menu-read-error-warnings')).toHaveTextContent('Pages 1–10 could not be read; send them again.');
    expect(screen.queryByTestId('menu-read-result')).not.toBeInTheDocument();
  });

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
    // The current menu offers no "Make current"; the others do. It offers to
    // check -- and finish -- its own carry instead (r28 G1).
    expect(screen.getAllByRole('button', { name: /^Make .* current$/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /^Carry the prices of .* again$/ })).toHaveLength(1);
    expect(rows[1]).toHaveTextContent('Check its prices');
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
    expect(await screen.findByText(/This is now the current menu: 42 lines, 40 priced from this menu, 2 flagged/)).toBeInTheDocument();
  });

  it('staff see every kept menu but are offered no choice of the current one', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [version()] });
    mount(false);
    expect(await screen.findAllByTestId('menu-version-row')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /current$/ })).not.toBeInTheDocument();
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
});

// r28 G18: the box offered .xls, which cannot be read, and the house was then
// told to check that each row names a wine.
describe('the upload box reads what it offers (r28 G18)', () => {
  const XLS = 'This is an older Excel file (.xls), which cannot be read here. Save it as .xlsx or CSV and choose that.';

  it('offers photos, PDFs, CSV and .xlsx, and not .xls', () => {
    expect(MENU_FILE_ACCEPT.split(',')).toEqual(['image/*', 'application/pdf', '.csv', '.xlsx']);
    expect(menuFileRefusal({ name: 'Menu.XLS' })).toBe(XLS);
    expect(menuFileRefusal({ name: 'menu.bin', type: 'application/vnd.ms-excel' })).toBe(XLS);
    expect(menuFileRefusal({ name: 'menu.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })).toBeNull();
    expect(menuFileRefusal(null)).toBeNull();
  });

  it('an .xls chosen anyway is said at once, never sent, and a readable file clears it', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [] });
    mount(false);
    const box = await screen.findByLabelText('Menu to read');
    expect(box).toHaveAttribute('accept', MENU_FILE_ACCEPT);
    fireEvent.change(box, { target: { files: [new File(['x'], 'menu.xls', { type: 'application/vnd.ms-excel' })] } });
    expect(screen.getByTestId('menu-file-refused')).toHaveTextContent(XLS);
    expect(screen.getByRole('button', { name: 'Read this menu' })).toBeDisabled();
    fireEvent.change(box, { target: { files: [new File(['name,bottle_price\nOpus,60\n'], 'menu.csv', { type: 'text/csv' })] } });
    expect(screen.queryByTestId('menu-file-refused')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1));
    expect(mockImport.mock.calls[0][0]).toBe('csv');
  });

  it('an .xlsx is still sent as a workbook', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({ menuId: 'm9', itemsExtracted: 1, submissionsCreated: 0, items: [] });
    mount(false);
    fireEvent.change(await screen.findByLabelText('Menu to read'), {
      target: { files: [new File(['PK'], 'menu.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1));
    expect(mockImport.mock.calls[0][0]).toBe('csv');
    expect(mockImport.mock.calls[0][1]).toHaveProperty('fileBase64');
  });
});
