/**
 * The gate's real promise: with no Mudavym page on screen, a shell overlay
 * renders EXACTLY the markup it always did.
 *
 * "Looks the same" is not a test — a class string that drifted by one utility
 * would pass it. These assertions pin the literal class strings, so the day
 * someone edits the legacy branch the test says so, out loud.
 */

import { execFileSync } from 'node:child_process';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ShortcutsSheet } from '../command/ShortcutsSheet';
import { RecentlyViewed } from '../command/RecentlyViewed';
import { CommandPalette } from '../command/CommandPalette';
import { AskAiBar } from '../askai/AskAiBar';
import { Header } from '../layout/Header';
import { RestaurantBranchSwitcher } from '../layout/RestaurantBranchSwitcher';
import { DashboardLayout } from '../layout/DashboardLayout';
import { ThemeMenu } from '../layout/ThemeMenu';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ToastProvider } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';

/* `test-utils` mocks AuthContext without the context OBJECT itself, which
   SetupNudgeBanner (inside DashboardLayout) reads directly. This local mock is
   the same shape plus that export, and `useAuth` here is the vi.fn every test
   below steers. */
vi.mock('../../contexts/AuthContext', async () => {
  const { createContext } = await import('react');
  return {
    AuthContext: createContext<unknown>(null),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuth: vi.fn(),
  };
});

/* Header's data, Ask AI's endpoints and the sidebar's store are not what this
   file is about; they are mocked to the smallest shape that renders. */
vi.mock('../../hooks/queries', () => ({
  useNotifications: vi.fn(() => ({ data: [], refetch: vi.fn(), isLoading: false })),
  useMarkNotificationAsRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMarkAllNotificationsAsRead: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('../../stores', async (orig) => ({
  ...(await orig<typeof import('../../stores')>()),
  useNotificationStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ unreadCount: 0, setUnreadCount: vi.fn() }),
  ),
}));
vi.mock('../../services/api/askAi', async (orig) => ({
  ...(await orig<typeof import('../../services/api/askAi')>()),
  listOpenProposals: vi.fn(async () => []),
  listCandidates: vi.fn(async () => []),
  proposeAction: vi.fn(),
}));
vi.mock('../../stores/uiStore', () => ({
  useUIStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ sidebarOpen: true, sidebarCollapsed: false, setSidebarOpen: vi.fn() }),
  ),
}));

const PANEL_POSITIONER = 'fixed inset-0 z-[100] flex items-center justify-center px-4';
const PANEL_SCRIM = 'absolute inset-0 bg-gray-900/40';
const PANEL_CARD =
  'relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden';
const RECENTS_POSITIONER = 'fixed inset-0 z-[100] flex items-start justify-center pt-[16vh] px-4';
const RECENTS_CARD =
  'relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden';
const PALETTE_POSITIONER = 'fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4';
const PALETTE_SCRIM = 'absolute inset-0 bg-gray-900/40 motion-safe:animate-[fadeIn_120ms_ease-out]';
const PALETTE_CARD =
  'relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden motion-safe:animate-[popIn_120ms_ease-out]';
const BELL_MENU =
  'absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50';
const USER_MENU =
  'absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50';
const SWITCHER_MENU =
  'absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.18),0_4px_16px_-4px_rgba(0,0,0,0.08)] border border-gray-100 overflow-hidden z-50';
const MOBILE_SCRIM = 'fixed inset-0 z-[45] bg-black/40 md:hidden';
const THEME_MENU =
  'absolute right-0 mt-2 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-xl z-50 dark:border-gray-700 dark:bg-gray-800';

beforeEach(() => {
  resetMudavymShell();
});

const BRANCHES = [
  { id: 'r1', name: 'Meyhouse Palo Alto', city: 'Palo Alto', chain_id: null, chain_name: null },
  { id: 'r2', name: 'Meyhouse Menlo', city: 'Menlo Park', chain_id: null, chain_name: null },
];

/** Router + toasts + theme, and nothing else: `test-utils` would pull in its
 *  own AuthContext mock, which has no `AuthContext` export for the design-flag
 *  hook to read. */
function renderShell(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ToastProvider>{ui}</ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function asManager(over: Record<string, unknown> = {}) {
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: 'u1', email: 'demo@gmail.com', name: 'Demo', restaurantId: 'r1', role: 'manager' },
    loading: false,
    logout: vi.fn(),
    availableRestaurants: [],
    activeRestaurantId: 'r1',
    activeRole: 'manager',
    setActiveRestaurantId: vi.fn(),
    refreshBranches: vi.fn(),
    ...over,
  } as never);
}

beforeEach(() => {
  asManager();
  // jsdom has no layout, so the palette's roving-scroll call has no method.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});


describe('with no Mudavym page on screen', () => {
  it('ShortcutsSheet renders its legacy chrome, class string for class string', () => {
    const { container } = render(<ShortcutsSheet open onClose={() => {}} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toBe(PANEL_POSITIONER);
    expect(root.children[0].getAttribute('class')).toBe(PANEL_SCRIM);
    expect(root.children[1].getAttribute('class')).toBe(PANEL_CARD);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('RecentlyViewed renders its legacy chrome, class string for class string', () => {
    const { container } = render(
      <MemoryRouter>
        <RecentlyViewed open onClose={() => {}} />
      </MemoryRouter>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toBe(RECENTS_POSITIONER);
    expect(root.children[1].getAttribute('class')).toBe(RECENTS_CARD);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('CommandPalette renders its legacy chrome, class string for class string', () => {
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <CommandPalette open onClose={() => {}} />
        </ToastProvider>
      </MemoryRouter>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toBe(PALETTE_POSITIONER);
    expect(root.children[0].getAttribute('class')).toBe(PALETTE_SCRIM);
    expect(root.children[1].getAttribute('class')).toBe(PALETTE_CARD);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('AskAiBar renders its legacy chrome, class string for class string', () => {
    const { container } = render(
      <MemoryRouter>
        <AskAiBar open onClose={() => {}} />
      </MemoryRouter>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('class')).toBe(PALETTE_POSITIONER);
    expect(root.children[0].getAttribute('class')).toBe(PALETTE_SCRIM);
    expect(root.children[1].getAttribute('class')).toBe(PALETTE_CARD);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it("the Header's bell and user menu render their legacy dropdowns", () => {
    renderShell(<Header title="Dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(screen.getByText('Notifications').closest('div[class]')?.parentElement?.getAttribute('class')).toBe(
      BELL_MENU,
    );
    fireEvent.click(screen.getByLabelText(/user menu/i));
    expect(screen.getByLabelText(/view profile/i).closest(`.${CSS.escape('w-56')}`)?.getAttribute('class')).toBe(
      USER_MENU,
    );
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it('RestaurantBranchSwitcher renders its legacy dropdown', () => {
    asManager({ availableRestaurants: BRANCHES });
    render(
      <MemoryRouter>
        <RestaurantBranchSwitcher />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText('Meyhouse Palo Alto'));
    expect(screen.getByText('Switch Location').closest(`.${CSS.escape('w-80')}`)?.getAttribute('class')).toBe(
      SWITCHER_MENU,
    );
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });

  it("DashboardLayout's mobile scrim keeps its legacy class string", () => {
    renderShell(<DashboardLayout>{null}</DashboardLayout>);
    expect(screen.getByLabelText('Close navigation').getAttribute('class')).toBe(MOBILE_SCRIM);
  });

  it('ThemeMenu renders its legacy menu, class string for class string', () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('menu').getAttribute('class')).toBe(THEME_MENU);
    expect(document.querySelector('.mdv-ovl')).toBeNull();
  });
});

describe('with a Mudavym page on screen', () => {
  beforeEach(() => {
    claimMudavymShell(Symbol('test-page'), 'paper');
  });

  it('ShortcutsSheet becomes the house Panel', () => {
    render(<ShortcutsSheet open onClose={() => {}} />);
    const root = document.querySelector('.mdv-ovl') as HTMLElement;
    expect(root).not.toBeNull();
    expect(root).toHaveClass('mdv-ovl--panel', 'mudavym');
    expect(document.querySelector('.bg-gray-900\\/40')).toBeNull();
  });

  it('RecentlyViewed becomes the house Panel and keeps its listbox contract', () => {
    render(
      <MemoryRouter>
        <RecentlyViewed open onClose={() => {}} />
      </MemoryRouter>,
    );
    expect(document.querySelector('.mdv-ovl--panel')).not.toBeNull();
  });

  it('ThemeMenu becomes the house Popover — non-modal, still a dialog', () => {
    render(
      <ThemeProvider>
        <ThemeMenu />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));
    expect(document.querySelector('.mdv-ovl--popover')).not.toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
  });

  it('CommandPalette and AskAiBar become the house Panel', () => {
    const { unmount } = renderShell(<CommandPalette open onClose={() => {}} />);
    expect(document.querySelector('.mdv-ovl--panel')).not.toBeNull();
    expect(document.querySelector('.bg-gray-900\\/40')).toBeNull();
    unmount();

    renderShell(<AskAiBar open onClose={() => {}} />);
    expect(document.querySelector('.mdv-ovl--panel')).not.toBeNull();
    expect(document.querySelector('.bg-gray-900\\/40')).toBeNull();
  });

  it("the Header's bell and user menu become house Popovers", () => {
    renderShell(<Header title="Dashboard" />);
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(document.querySelector('.mdv-ovl--popover')).not.toBeNull();
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal');
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(screen.getByLabelText(/user menu/i));
    expect(document.querySelector('.mdv-ovl--popover')).not.toBeNull();
    expect(document.querySelector(`.${CSS.escape('w-56')}`)).toBeNull();
  });

  it('RestaurantBranchSwitcher becomes a house Popover', () => {
    asManager({ availableRestaurants: BRANCHES });
    renderShell(<RestaurantBranchSwitcher />);
    fireEvent.click(screen.getByText('Meyhouse Palo Alto'));
    expect(document.querySelector('.mdv-ovl--popover')).not.toBeNull();
    expect(screen.queryByText('Switch Location')).toBeNull(); // the house says "Switch location"
    expect(screen.getByText('Switch location')).toBeInTheDocument();
  });

  it("DashboardLayout's mobile scrim takes the house scrim, same element and same z", () => {
    renderShell(<DashboardLayout>{null}</DashboardLayout>);
    const scrim = screen.getByLabelText('Close navigation');
    expect(scrim.getAttribute('class')).toBe('fixed inset-0 z-[45] md:hidden mdv-scrim');
    expect(scrim.hasAttribute('data-ground')).toBe(false); // paper page
  });

  it('carries the page ground onto the portalled root', () => {
    resetMudavymShell();
    claimMudavymShell(Symbol('charcoal-page'), 'charcoal');
    render(<ShortcutsSheet open onClose={() => {}} />);
    expect(document.querySelector('.mdv-ovl')).toHaveAttribute('data-ground', 'charcoal');
  });
});

/**
 * The literals above are only as good as their provenance. This reads the
 * PRE-GATE source out of git and asserts each pinned string is still a
 * substring of the file it came from, so "the legacy markup is unchanged" is a
 * measurement rather than a recollection. Skipped, not failed, where git or the
 * ref is unavailable (a shallow CI checkout, a tarball) — a check that cannot
 * run must say so instead of passing quietly.
 */
function gitShow(path: string): string | null {
  try {
    return execFileSync('git', ['show', `origin/main:apps/web/src/${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

const SOURCES: Array<[string, string[]]> = [
  ['components/command/ShortcutsSheet.tsx', [PANEL_POSITIONER, PANEL_SCRIM, PANEL_CARD]],
  ['components/command/RecentlyViewed.tsx', [RECENTS_POSITIONER, RECENTS_CARD]],
  ['components/layout/ThemeMenu.tsx', [THEME_MENU]],
  ['components/command/CommandPalette.tsx', [PALETTE_POSITIONER, PALETTE_SCRIM, PALETTE_CARD]],
  ['components/askai/AskAiBar.tsx', [PALETTE_POSITIONER, PALETTE_SCRIM, PALETTE_CARD]],
  ['components/layout/Header.tsx', [BELL_MENU, USER_MENU]],
  ['components/layout/RestaurantBranchSwitcher.tsx', [SWITCHER_MENU]],
  ['components/layout/DashboardLayout.tsx', [MOBILE_SCRIM]],
];

describe('the pinned strings are origin/main\'s own', () => {
  const available = gitShow('components/layout/ThemeMenu.tsx') !== null;
  it.skipIf(!available).each(SOURCES)('%s', (path, strings) => {
    const src = gitShow(path);
    expect(src, `origin/main:apps/web/src/${path} could not be read`).not.toBeNull();
    for (const wanted of strings) {
      expect(src, `${path} no longer contains: ${wanted}`).toContain(wanted);
    }
  });
  it('says so when it could not read origin/main at all', () => {
    // Not a no-op: if the ref is missing the eight cases above are SKIPPED, and
    // a skipped provenance check must be visible rather than read as a pass.
    expect(typeof available).toBe('boolean');
    if (!available) {
      // eslint-disable-next-line no-console
      console.warn('provenance check skipped: origin/main is not readable in this checkout');
    }
  });
});
