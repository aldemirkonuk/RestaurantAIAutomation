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
} from './MenuVersions';
import {
  importMenu,
  listMenuVersions,
  makeMenuCurrent,
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
  };
});

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
      'This is now the current menu: 3 lines, 1 price set from this menu, 1 kept a price someone set after this menu was read, 1 flagged: a blank price kept the last known one, 1 not matched to a wine, so no price. 1 could not be priced: Barolo (timeout).',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Make the menu read 2026-09-20 current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText(/This is now the current menu: 42 lines, 40 prices set from this menu, 2 flagged/)).toBeInTheDocument();
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
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9'));
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
