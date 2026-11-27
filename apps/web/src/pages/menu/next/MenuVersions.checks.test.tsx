/**
 * "Worth a second look" on /menu (r108 menu-g12): in words, above the plan,
 * never changing a value; each item jumps to its line at once and focuses it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuVersions } from './MenuVersions';
import { getMenuPlan, importMenu, listMenuVersions, type MenuPlan, type MenuVersion, type PlanLine } from '../../../services/api/menus';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }),
}));
vi.mock('../../../hooks/queries/useHouseCurrencyCode', () => ({ useHouseCurrencyCode: () => 'USD' }));
vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, listMenuVersions: vi.fn(), getMenuPlan: vi.fn(), importMenu: vi.fn() };
});

const kind = (k: 'bottle' | 'glass', price: number | null) => ({
  kind: k,
  menuPrice: price,
  housePrice: null,
  result: 'unchanged' as const,
  lastSet: null,
  lock: null,
});
const planLine = (id: string, name: string, bottle: number | null, glass: number | null = null): PlanLine => ({
  menuItemId: id,
  name,
  category: 'red',
  producer: null,
  vintage: null,
  wineLibraryId: null,
  inventoryId: null,
  house: null,
  bottle: kind('bottle', bottle),
  glass: kind('glass', glass),
  flag: null,
  returned: false,
  vintageMismatch: false,
});
const planOf = (lines: PlanLine[]): MenuPlan =>
  ({
    menuId: 'm1',
    current: false,
    generatedAt: '2026-11-18T12:00:00Z',
    fingerprint: 'fp',
    lines,
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
  }) as unknown as MenuPlan;

const version = { menuId: 'm1', name: 'Wine List', status: 'draft', current: false, cadence: null, menuDate: null, menuDatePrecision: null, sourceMethod: 'scan', source: { kept: true, mime: 'application/pdf', bytes: 1, failure: null }, linesExtracted: 4, extractedAt: '2026-11-11T22:05:12.000Z', extractedBy: { userId: 'u', name: 'Ada' }, madeCurrentAt: null, madeCurrentBy: null, retiredAt: null, retiredBy: null, createdAt: '2026-11-11T22:05:12Z' } as unknown as MenuVersion;

async function openPlan(lines: PlanLine[]) {
  vi.mocked(listMenuVersions).mockResolvedValue({ versions: [version], current: null, lastUsed: null, namesReadable: true, namesReason: null } as never);
  vi.mocked(getMenuPlan).mockResolvedValue(planOf(lines));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MenuVersions canManage />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /current$/ }));
}

beforeEach(() => {
  vi.mocked(listMenuVersions).mockReset();
  vi.mocked(getMenuPlan).mockReset();
});

describe('the second-look list above the plan', () => {
  it('says 4500 may be 45.00 and changes no price', async () => {
    const lines = [planLine('a', 'Chianti', 40), planLine('b', 'Barbera', 45), planLine('c', 'Nebbiolo', 50), planLine('d', 'Barolo', 4500)];
    await openPlan(lines);
    const box = await screen.findByTestId('menu-read-checks');
    expect(box).toHaveTextContent('Barolo');
    expect(box).toHaveTextContent('may be $45.00');
    expect(box).toHaveTextContent('Nothing here has been changed');
    expect(lines[3].bottle.menuPrice).toBe(4500);
    // It stands above the plan.
    expect(box.compareDocumentPosition(await screen.findByTestId('menu-plan')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says nothing on a clean menu, and nothing for three priced lines', async () => {
    await openPlan([planLine('a', 'Chianti', 40), planLine('b', 'Barbera', 45), planLine('d', 'Barolo', 4500)]);
    await screen.findByTestId('menu-plan');
    expect(screen.queryByTestId('menu-read-checks')).not.toBeInTheDocument();
  });

  it('Show the line opens the fold, scrolls at once and focuses the row', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await openPlan([planLine('a', 'Chianti', 90, 120)]);
    const box = await screen.findByTestId('menu-read-checks');
    expect(box).toHaveTextContent('Chianti');
    fireEvent.click(screen.getByRole('button', { name: 'Show the line' }));
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'instant' });
    const row = document.getElementById('plan-line-a')!;
    expect(row.closest('details')!.open).toBe(true);
    expect(document.activeElement).toBe(row);
  });
});

describe('the same checks on the review of a fresh read', () => {
  it('flags a glass over its bottle and jumps to a line folded under "look good"', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(listMenuVersions).mockResolvedValue({ current: null, lastUsed: null, versions: [] });
    const item = (id: string, name: string, bottle: number, glass: number) => ({
      menuItemId: id, submissionId: null, name, producer: null, category: 'red', vintage: null, region: null,
      grapeVariety: null, byGlassPrice: glass, bottlePrice: bottle, rawText: null, matched: true, needsReview: false,
    });
    vi.mocked(importMenu).mockResolvedValue({
      menuId: 'm9', current: false, itemsExtracted: 1, submissionsCreated: 0,
      items: [item('i1', 'Barolo', 90, 120)], source: { kept: true, failure: null },
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MenuVersions canManage />
      </QueryClientProvider>,
    );
    const file = new File(['name,bottle_price\nBarolo,90\n'], 'menu.csv', { type: 'text/csv' });
    fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
    const box = await screen.findByTestId('review-read-checks');
    expect(box).toHaveTextContent('Barolo');
    expect(document.getElementById('review-line-i1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the line' }));
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('review-line-i1')));
  });
});
