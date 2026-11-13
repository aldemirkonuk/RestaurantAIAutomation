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
  MenuVersions,
  makeCurrentSentence,
  readMenuDate,
  sourceWords,
  versionLabel,
  versionLabels,
} from './MenuVersions';
import {
  getMenuPlan,
  importMenu,
  listMenuVersions,
  makeMenuCurrent,
  readWarningSentence,
  type MenuPlan,
  type MenuVersion,
} from '../../../services/api/menus';

vi.mock('../../../lib/menuPhotos', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/menuPhotos')>('../../../lib/menuPhotos');
  return {
    ...actual,
    // jsdom draws no canvas: the redraw itself is the browser's.
    photoToJpegBase64: vi.fn(async (f: File) => `jpeg:${f.name}`),
    photosToPages: vi.fn(async (fs: File[]) => fs.map((f) => `jpeg:${f.name}`)),
  };
});

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

/** A moment on this device's clock, as an ISO string: the page shows local days, so fixtures are local too. */
function local(y: number, m: number, d: number, h: number, mi: number, sec = 0, ms = 0): string {
  return new Date(y, m - 1, d, h, mi, sec, ms).toISOString();
}

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
    extractedAt: local(2026, 9, 20, 10, 0),
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
    expect(versionLabel(version())).toBe('the menu read 2026-09-20 10:00');
    expect(versionLabel(version({ extractedAt: null }))).toBe('a menu read before menus were kept');
  });

  it('names a menu by the day it was read on this clock, not the UTC day, and tells two reads that day apart', () => {
    expect(versionLabel(version({ extractedAt: local(2026, 11, 11, 22, 5) }))).toBe('the menu read 2026-11-11 22:05');
    expect(versionLabel(version({ extractedAt: local(2026, 11, 11, 23, 40) }))).toBe('the menu read 2026-11-11 23:40');
  });

  it('no two kept menus share a name: the minute, then the second, then "(1 of 2)" in the order they were read (menu walk 2026-11-11)', () => {
    const a = version({ menuId: 'a', extractedAt: local(2026, 11, 11, 22, 5, 12) });
    const b = version({ menuId: 'b', extractedAt: local(2026, 11, 11, 22, 5, 41) });
    const c = version({ menuId: 'c', extractedAt: local(2026, 11, 11, 23, 40) });
    const d1 = version({ menuId: 'd1', extractedAt: local(2026, 11, 11, 22, 5, 41, 900) });
    const legacy1 = version({ menuId: 'l1', extractedAt: null, createdAt: '2026-09-01T08:00:00Z' });
    const legacy2 = version({ menuId: 'l2', extractedAt: null, createdAt: '2026-09-02T08:00:00Z' });
    const dated1 = version({ menuId: 'x1', menuDate: '2026-10-15', menuDatePrecision: 'day', extractedAt: local(2026, 10, 14, 9, 0) });
    const dated2 = version({ menuId: 'x2', menuDate: '2026-10-15', menuDatePrecision: 'day', extractedAt: local(2026, 10, 15, 9, 0) });

    // One alone keeps its plain name.
    expect(versionLabels([a, c]).get('c')).toBe('the menu read 2026-11-11 23:40');
    expect(versionLabels([a, c]).get('a')).toBe('the menu read 2026-11-11 22:05');
    // The same minute: the second tells them apart.
    const sameMinute = versionLabels([a, b, c]);
    expect([sameMinute.get('a'), sameMinute.get('b'), sameMinute.get('c')]).toEqual([
      'the menu read 2026-11-11 22:05:12',
      'the menu read 2026-11-11 22:05:41',
      'the menu read 2026-11-11 23:40',
    ]);
    // The same second: counted in the order read, whatever the list order.
    const sameSecond = versionLabels([d1, a, b]);
    expect([sameSecond.get('b'), sameSecond.get('d1'), sameSecond.get('a')]).toEqual([
      'the menu read 2026-11-11 22:05:41 (1 of 2)',
      'the menu read 2026-11-11 22:05:41 (2 of 2)',
      'the menu read 2026-11-11 22:05:12',
    ]);
    // A dated menu read twice says when each was read; menus from before reads were dated say when they were kept.
    const more = versionLabels([dated1, dated2, legacy1, legacy2]);
    expect(more.get('x1')).toBe('the menu for 2026-10-15, read 2026-10-14 09:00:00');
    expect(more.get('x2')).toBe('the menu for 2026-10-15, read 2026-10-15 09:00:00');
    expect(more.get('l1')).toMatch(/^a menu read before menus were kept \(kept 2026-09-0\d \d\d:00:00\)$/);
    expect(more.get('l1')).not.toBe(more.get('l2'));
    // Every name in a list is its own.
    const all = versionLabels([a, b, c, d1, legacy1, legacy2, dated1, dated2]);
    expect(new Set(all.values()).size).toBe(8);
  });

  it('the panel and its Make current buttons use those names', async () => {
    const a = version({ menuId: 'a', extractedAt: local(2026, 11, 11, 22, 5, 12) });
    const b = version({ menuId: 'b', extractedAt: local(2026, 11, 11, 22, 5, 41) });
    mockList.mockResolvedValue({ versions: [a, b], current: null, lastUsed: null, namesReadable: true, namesReason: null } as never);
    mount(true);
    expect(await screen.findByRole('button', { name: 'Make the menu read 2026-11-11 22:05:12 current' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make the menu read 2026-11-11 22:05:41 current' })).toBeInTheDocument();
  });

  it('says why a file was not kept once, even on a row stored with the older lead-in', () => {
    expect(
      sourceWords(version({ source: { kept: false, mime: null, bytes: null, failure: 'the source file was not kept: the file store did not take it' } })),
    ).toBe('file not kept: the file store did not take it');
  });

  it('says what happened to the source, including why it was not kept', () => {
    expect(sourceWords(version())).toBe('PDF kept');
    expect(sourceWords(version({ source: { kept: false, mime: null, bytes: null, failure: 'bucket unavailable' } }))).toBe(
      'file not kept: bucket unavailable',
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
      'This is now the current menu: 3 lines, 1 wine priced from this menu, 1 wine kept a price someone set after this menu was chosen, 1 line not matched to a wine, so no price, 1 flagged for a blank price. 1 could not be priced: Barolo (timeout).',
    );
  });

  it('names the menu when it is given one, so a sentence under the list says which menu it is about', () => {
    expect(
      makeCurrentSentence(
        { outcome: 'made_current', menuId: 'm1', previousMenuIds: [], lines: 2, priceSync: { changed: 2 }, flagged: 0, failed: [] },
        'the menu read 2026-11-12 01:25:06',
      ),
    ).toBe('The menu read 2026-11-12 01:25:06 is now the current menu: 2 lines, 2 wines priced from this menu.');
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
        { menuItemId: 'l1', name: 'Barolo', kind: 'bottle', lockId: 'k1', lockedPrice: 95, lockedBy: 'u1', lockedAt: local(2026, 9, 1, 12, 0) },
        { menuItemId: 'l2', name: 'Soave', kind: 'glass', lockId: 'k2', lockedPrice: 9, lockedBy: 'u1', lockedAt: local(2026, 9, 1, 12, 0) },
      ],
      returned: [{ menuItemId: 'l1', name: 'Barolo' }],
    });
    expect(s).toBe(
      'This is now the current menu: 4 lines, 2 wines priced from this menu, 1 wine at its locked price, 1 something new. Held by a lock, not changed: Barolo (bottle, locked at 95.00); Soave (glass, locked at 9.00). Back on the menu with its lock still holding: Barolo.',
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
      current: version({ menuId: 'm2', status: 'active', current: true, madeCurrentAt: local(2026, 9, 1, 12, 0), madeCurrentBy: { userId: 'u2', name: 'Bo' } }),
      lastUsed: version({ menuId: 'm1', status: 'archived', retiredAt: local(2026, 9, 1, 12, 0) }),
      versions: [
        version({ menuId: 'm3' }),
        version({ menuId: 'm2', status: 'active', current: true, madeCurrentAt: local(2026, 9, 1, 12, 0), madeCurrentBy: { userId: 'u2', name: 'Bo' } }),
        version({ menuId: 'm1', status: 'archived', retiredAt: local(2026, 9, 1, 12, 0) }),
      ],
    });
    mount(true);
    expect(await screen.findByTestId('menu-versions-standing')).toHaveTextContent(
      // Three menus read at the same moment are told apart, here as in the list.
      'Current: the menu read 2026-09-20 10:00:00 (2 of 3). Last one used: the menu read 2026-09-20 10:00:00 (1 of 3).',
    );
    const rows = screen.getAllByTestId('menu-version-row');
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent('current since 2026-09-01, chosen by Bo');
    expect(rows[2]).toHaveTextContent('last one used, used until 2026-09-01');
    // The current menu offers no "Make current"; the others do.
    expect(screen.getAllByRole('button', { name: /^Make .* current$/ })).toHaveLength(2);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Make the menu read 2026-09-20 10:00 current' }));
    // The plan comes first (L13); nothing is chosen until the person confirms it.
    expect(await screen.findByTestId('menu-plan')).toBeInTheDocument();
    expect(mockMake).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m1', 'fp-m1'));
    // Named, and said under the list it is about (menu walk 2026-11-12).
    expect(await screen.findByTestId('menu-list-choice-said')).toHaveTextContent(
      /^The menu read 2026-09-20 10:00 is now the current menu: 42 lines, 40 wines priced from this menu, 2 flagged/,
    );
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
      expect(mockImport).toHaveBeenCalledWith(
        'csv',
        { csvContent: 'name,bottle_price\nOpus,60\n' },
        expect.objectContaining({ cadence: 'monthly', menuDate: '2026-10' }),
      ),
    );
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent(
      'Read 12 lines and kept this menu. It is not the current menu, and no price has changed.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Make this the current menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9', 'fp-m9'));
    expect(await screen.findByTestId('menu-choice-said')).toHaveTextContent('This is now the current menu: 12 lines');
    // Browser walk 2026-11-12: the read no longer says it is not current, nor offers the choice again.
    expect(screen.getByTestId('menu-read-result')).toHaveTextContent('Read 12 lines and kept this menu. It is the current menu.');
    expect(screen.getByTestId('menu-read-result')).not.toHaveTextContent('no price has changed');
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep it, not current' })).not.toBeInTheDocument();
  });

  it('a read chosen here, then replaced from the list, stops saying it is current (browser walk 2026-11-12)', async () => {
    const other = version({ menuId: 'm2', extractedAt: local(2026, 9, 19, 9, 0) });
    let current: MenuVersion | null = null;
    mockList.mockImplementation(async () => ({ current, lastUsed: null, versions: [other] }));
    mockImport.mockResolvedValue({ menuId: 'm9', current: false, itemsExtracted: 12, submissionsCreated: 0, items: [] });
    mockMake.mockImplementation(async (id: string) => {
      current = version({ menuId: id, current: true });
      return { outcome: 'made_current', menuId: id, previousMenuIds: [], lines: 1, priceSync: { changed: 1 }, flagged: 0, failed: [] };
    });
    mount(true);
    const file = new File(['name,bottle_price\nOpus,60\n'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make this the current menu' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(screen.getByTestId('menu-read-result')).toHaveTextContent('It is the current menu.'));
    // Now the other kept menu is chosen from the list.
    fireEvent.click(await screen.findByRole('button', { name: /^Make the menu read .* current$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenLastCalledWith('m2', 'fp-m2'));
    await waitFor(() =>
      expect(screen.getByTestId('menu-read-result')).toHaveTextContent('It is no longer the current menu: another was chosen.'),
    );
    expect(screen.queryByTestId('menu-choice-said')).not.toBeInTheDocument();
    // The list's sentence names its menu and stands with the list, not under the
    // read form's line about the other read (menu walk 2026-11-12).
    const listSaid = screen.getByTestId('menu-list-choice-said');
    expect(listSaid).toHaveTextContent(/^The menu read .* is now the current menu: 1 line/);
    expect(screen.queryByText(/^This is now the current menu/)).not.toBeInTheDocument();
    expect(
      screen.getByTestId('menu-read-result').compareDocumentPosition(listSaid) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByTestId('menu-versions-standing').compareDocumentPosition(listSaid) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId('menu-read-result')).not.toContainElement(listSaid);
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
    const { onReading, ...sent } = mockImport.mock.calls[0][2] ?? {};
    expect(typeof onReading).toBe('function');
    expect(sent).toEqual({});
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

describe('a read in the background, several photos, the same file again (founder 2026-11-07)', () => {
  const photo = (n: string) => new File(['x'], n, { type: 'image/jpeg' });

  it('several photos go up as ONE menu, each redrawn as a JPEG page, in the order chosen', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockResolvedValue({ menuId: 'm7', current: false, pages: 3, itemsExtracted: 30, submissionsCreated: 0, items: [] });
    mount(true);
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [photo('p1.jpg'), photo('p2.jpg'), photo('p3.jpg')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read these 3 pages as one menu' }));
    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(1));
    expect(mockImport.mock.calls[0][0]).toBe('scan');
    expect(mockImport.mock.calls[0][1]).toEqual({ images: ['jpeg:p1.jpg', 'jpeg:p2.jpg', 'jpeg:p3.jpg'] });
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent('Read 30 lines from 3 pages and kept this menu.');
  });

  it('a PDF among photos is refused before anything is sent', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mount(true);
    fireEvent.change(await screen.findByLabelText('Menu to read'), {
      target: { files: [photo('p1.jpg'), new File(['%PDF'], 'wine.pdf', { type: 'application/pdf' })] },
    });
    expect(screen.getByTestId('menu-read-shape')).toHaveTextContent('wine.pdf is not a photo');
    expect(screen.getByRole('button', { name: /Read these 2 pages/ })).toBeDisabled();
    expect(mockImport).not.toHaveBeenCalled();
  });

  it('while the server reads, the page says the file is kept and it may be left', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockImplementation(async (_m, _d, labels) => {
      labels?.onReading?.('m8');
      return new Promise(() => {});
    });
    mount(true);
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [photo('p1.jpg')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-reading')).toHaveTextContent('you can leave this page');
  });

  it('a read the page stopped waiting for is said as going on, not as failed', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport.mockRejectedValue({ response: { status: 202, data: { message: 'Still reading after 20 minutes. The read goes on.' } } });
    mount(true);
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [photo('p1.jpg')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    expect(await screen.findByTestId('menu-read-still')).toHaveTextContent('The read goes on');
    expect(screen.queryByTestId('menu-read-error')).not.toBeInTheDocument();
  });

  it('the same file again reopens its read; "Read it again" asks for a fresh read; a current one offers no choice', async () => {
    mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    mockImport
      .mockResolvedValueOnce({ menuId: 'm1', current: true, reopened: { readAt: '2026-11-01T09:00:00Z' }, itemsExtracted: 42, submissionsCreated: 0, items: [] })
      .mockResolvedValueOnce({ menuId: 'm2', current: false, itemsExtracted: 43, submissionsCreated: 0, items: [] });
    mount(true);
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    const said = await screen.findByTestId('menu-read-result');
    expect(said).toHaveTextContent('This exact file was already read on');
    expect(said).toHaveTextContent('nothing was read again. It found 42 lines. It is the current menu.');
    expect(screen.queryByRole('button', { name: 'Make this the current menu' })).not.toBeInTheDocument();
    const again = screen.getByRole('button', { name: 'Read it again' });
    await waitFor(() => expect(again).not.toBeDisabled());
    fireEvent.click(again);
    await waitFor(() => expect(mockImport).toHaveBeenCalledTimes(2));
    expect(mockImport.mock.calls[1][2]).toMatchObject({ readAgain: true });
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent('Read 43 lines and kept this menu.');
  });

  it('a version being read or failed says so, and offers no "Make current"', async () => {
    mockList.mockResolvedValue({
      current: null,
      lastUsed: null,
      versions: [
        version({ menuId: 'r1', readState: 'reading', linesExtracted: 0 }),
        version({ menuId: 'f1', readState: 'failed', readFailure: 'No menu line could be read from this file.', linesExtracted: 0 }),
      ],
    });
    mount(true);
    expect(await screen.findByText('being read now')).toBeInTheDocument();
    expect(screen.getByText('the read failed: No menu line could be read from this file.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Make .* current$/ })).not.toBeInTheDocument();
  });
});
