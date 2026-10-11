/**
 * The ⌘K palette as a search box (sim 44, integ15-search-palette):
 *
 *  - F-1350 the fuzzy match folds Turkish letters and accents;
 *  - F-1352 "Add vendor" is offered only to someone the save would not refuse;
 *  - F-1353 the top recommendation never outlives its fetch or its house;
 *  - F-1354 a typed search is handed on to the cellar and vendors, never a dead end;
 *  - F-1355 the Ask row and the shortcut sheet print Ctrl off a Mac.
 *
 * The palette is mounted for real; only its network seam and the contexts it
 * reads are stubbed (same shape as CommandPalette.shortcuts.test).
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const get = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'manager' | 'staff' | null,
  house: 'house-a' as string | null,
}));

vi.mock('../../services/api/client', () => ({ apiClient: { get } }));
vi.mock('../../contexts/AuthContext', async (orig) => ({
  ...(await orig<typeof import('../../contexts/AuthContext')>()),
  useAuth: () => ({
    user: { restaurantId: auth.house, role: auth.role },
    activeRole: auth.role,
    activeRestaurantId: auth.house,
  }),
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { CommandPalette } from './CommandPalette';
import { ShortcutsSheet } from './ShortcutsSheet';
import { fuzzyScore, rankCommands, type Command } from './commands';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  auth.role = 'owner';
  auth.house = 'house-a';
  get.mockReset();
  get.mockResolvedValue({ data: { recommendations: [] } });
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function Palette({ open }: { open: boolean }) {
  return (
    <>
      <CommandPalette open={open} onClose={vi.fn()} />
      <Where />
    </>
  );
}

function paint(open = true) {
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<Palette open={open} />} />
      </Routes>
    </MemoryRouter>,
  );
  const rerenderOpen = (next: boolean) =>
    view.rerender(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<Palette open={next} />} />
        </Routes>
      </MemoryRouter>,
    );
  return { ...view, rerenderOpen };
}

const input = () => screen.getByPlaceholderText(/search pages/i);

describe('F-1350 — the fuzzy match folds Turkish letters and accents', () => {
  it.each([
    ['kavaklidere', 'Kavaklıdere — Öküzgözü'],
    ['cankaya', 'Çankaya Şarapları'],
    ['okuzgozu', 'Kavaklıdere — Öküzgözü'],
    ['İnv', 'Inventory'],
  ])('%s finds %s', (q, text) => {
    expect(fuzzyScore(q, text)).not.toBeNull();
  });

  it('ranks a counter row by its folded vendor name', () => {
    const rows: Command[] = [
      { id: 'a', title: 'Order from Çankaya Şarapları', section: 'On the counter', icon: (() => null) as never },
      { id: 'b', title: 'Order from Kermit Lynch', section: 'On the counter', icon: (() => null) as never },
    ];
    expect(rankCommands(rows, 'cankaya').map((r) => r.cmd.id)).toEqual(['a']);
  });
});

describe('F-1352 — "Add vendor" only for owner and manager', () => {
  it.each(['owner', 'manager'] as const)('a %s is offered it', (role) => {
    auth.role = role;
    paint();
    fireEvent.change(input(), { target: { value: 'add vendor' } });
    expect(screen.getByText('Add vendor')).toBeInTheDocument();
  });

  it.each(['staff', null] as const)('%s is not', (role) => {
    auth.role = role;
    paint();
    fireEvent.change(input(), { target: { value: 'add vendor' } });
    expect(screen.queryByText('Add vendor')).toBeNull();
  });
});

describe('F-1353 — the top recommendation never goes stale', () => {
  const feed = (text: string) => ({
    data: { recommendations: [{ ruleKey: 'r1', recommendation: text, category: 'stock' }] },
  });

  it('is gone on the next open when the feed comes back empty', async () => {
    get.mockResolvedValueOnce(feed('Reorder the Barolo'));
    const { rerenderOpen } = paint();
    expect(await screen.findByText('Reorder the Barolo')).toBeInTheDocument();

    rerenderOpen(false);
    get.mockResolvedValueOnce({ data: { recommendations: [] } });
    await act(async () => rerenderOpen(true));
    expect(screen.queryByText('Reorder the Barolo')).toBeNull();
  });

  it('is gone on the next open when the read fails', async () => {
    get.mockResolvedValueOnce(feed('Reorder the Barolo'));
    const { rerenderOpen } = paint();
    expect(await screen.findByText('Reorder the Barolo')).toBeInTheDocument();

    rerenderOpen(false);
    get.mockRejectedValueOnce(new Error('offline'));
    await act(async () => rerenderOpen(true));
    expect(screen.queryByText('Reorder the Barolo')).toBeNull();
  });

  it('asks the house on screen, and drops the last house\'s card on a switch', async () => {
    get.mockResolvedValueOnce(feed('Reorder the Barolo'));
    const { rerenderOpen } = paint();
    expect(await screen.findByText('Reorder the Barolo')).toBeInTheDocument();
    expect(get.mock.calls[0][0]).toBe('/analytics/recommendations/house-a');

    rerenderOpen(false);
    auth.house = 'house-b';
    get.mockReturnValueOnce(new Promise(() => {})); // house B has not answered yet
    await act(async () => rerenderOpen(true));
    expect(get.mock.calls[1][0]).toBe('/analytics/recommendations/house-b');
    expect(screen.queryByText('Reorder the Barolo')).toBeNull();
  });
});

describe('F-1354 — the palette hands a typed search on', () => {
  it('offers the cellar and the vendors for the words typed', () => {
    paint();
    fireEvent.change(input(), { target: { value: 'Kavaklıdere' } });
    expect(screen.getByText('Search the cellar for “Kavaklıdere”')).toBeInTheDocument();
    expect(screen.getByText('Search vendors for “Kavaklıdere”')).toBeInTheDocument();
  });

  it('the cellar row lands on /inventory?wine=', () => {
    paint();
    fireEvent.change(input(), { target: { value: 'Kavaklıdere' } });
    fireEvent.click(screen.getByText('Search the cellar for “Kavaklıdere”'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/inventory?wine=${encodeURIComponent('Kavaklıdere')}`,
    );
  });

  it('the vendors row lands on "All my vendors" with ?q=', () => {
    paint();
    fireEvent.change(input(), { target: { value: 'Kavaklıdere' } });
    fireEvent.click(screen.getByText('Search vendors for “Kavaklıdere”'));
    expect(screen.getByTestId('where').textContent).toBe(
      `/vendors?scope=all&q=${encodeURIComponent('Kavaklıdere')}`,
    );
  });

  it('comes after the commands that match, never before them', () => {
    paint();
    fireEvent.change(input(), { target: { value: 'inventory' } });
    const options = screen.getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options[0]).toMatch(/^Inventory/);
    expect(options.slice(-2)).toEqual([
      'Search the cellar for “inventory”',
      'Search vendors for “inventory”',
    ]);
  });
});

describe('F-1355 — Ctrl off a Mac, ⌘ on one', () => {
  function onPlatform(platform: string, ua: string) {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  }
  const keysOfAsk = () =>
    Array.from(document.getElementById('cmd-askai-open')?.querySelectorAll('kbd') ?? []).map(
      (k) => k.textContent,
    );

  it('on Windows the palette and the sheet say Ctrl', () => {
    onPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    paint();
    expect(keysOfAsk()).toEqual(['Ctrl', 'Shift', 'K']);
    render(<ShortcutsSheet open onClose={vi.fn()} />);
    expect(screen.getByText('Ctrl K')).toBeInTheDocument();
    expect(screen.getByText('Ctrl Shift K')).toBeInTheDocument();
    expect(screen.queryByText(/⌘/)).toBeNull();
  });

  it('on a Mac they say ⌘', () => {
    onPlatform('MacIntel', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)');
    paint();
    expect(keysOfAsk()).toEqual(['⌘', '⇧', 'K']);
    render(<ShortcutsSheet open onClose={vi.fn()} />);
    expect(screen.getByText('⌘ K')).toBeInTheDocument();
    expect(screen.getByText('⌘ ⇧ O')).toBeInTheDocument();
  });
});
