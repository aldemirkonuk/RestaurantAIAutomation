/**
 * The review of a read menu sits between the read and the choice (r57 w1 F1,
 * decided): MenuReviewScreen was mounted nowhere, so a person could not look
 * over or correct the lines a read found before choosing the current menu.
 * Now a read that found lines is reviewed first; skipping the review leaves
 * the plain choice, and a read with nothing to review goes straight to it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuVersions } from './MenuVersions';
import {
  getMenuPlan,
  importMenu,
  listMenuVersions,
  makeMenuCurrent,
  reviewMenuItem,
  type MenuImportResult,
  type MenuImportReviewItem,
} from '../../../services/api/menus';

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' } }),
}));
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
    reviewMenuItem: vi.fn(),
  };
});

const mockList = vi.mocked(listMenuVersions);
const mockMake = vi.mocked(makeMenuCurrent);
const mockImport = vi.mocked(importMenu);
const mockPlan = vi.mocked(getMenuPlan);
const mockReview = vi.mocked(reviewMenuItem);

function line(id: string, name: string, needsReview = false): MenuImportReviewItem {
  return {
    menuItemId: id,
    submissionId: null,
    name,
    producer: null,
    category: null,
    vintage: null,
    region: null,
    grapeVariety: null,
    byGlassPrice: null,
    bottlePrice: null,
    rawText: null,
    matched: true,
    needsReview,
  };
}

function read(over: Partial<MenuImportResult> = {}): MenuImportResult {
  return {
    menuId: 'm9',
    current: false,
    itemsExtracted: 2,
    submissionsCreated: 0,
    items: [line('i1', 'Barolo', true), line('i2', 'Chianti')],
    source: { kept: true, failure: null },
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

async function readTheFile() {
  const file = new File(['name,bottle_price\nBarolo,60\n'], 'menu.csv', { type: 'text/csv' });
  fireEvent.change(await screen.findByLabelText('Menu to read'), { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Read this menu' }));
}

beforeEach(() => {
  mockList.mockReset();
  mockMake.mockReset();
  mockImport.mockReset();
  mockPlan.mockReset();
  mockReview.mockReset();
  mockList.mockResolvedValue({ current: null, lastUsed: null, versions: [] });
  mockPlan.mockImplementation(async (id: string) => ({
    menuId: id,
    current: false,
    generatedAt: '2026-11-18T12:00:00Z',
    fingerprint: `fp-${id}`,
    lines: [],
    counts: { change: 0, unchanged: 0, held_by_lock: 0, blank_kept: 0, blank_never_priced: 0, not_linked: 0, new_wine: 0 },
    dormantLocks: [],
    namesReadable: true,
    namesReason: null,
  }));
});

describe('the review between the read and the choice', () => {
  it('a read that found lines is shown for review before it can be chosen', async () => {
    mockImport.mockResolvedValue(read());
    mount(true);
    await readTheFile();
    const review = await screen.findByTestId('menu-read-review');
    expect(review).toHaveTextContent('Review & confirm');
    expect(review).toHaveTextContent('Barolo');
    // The page's own choice buttons wait: the review carries the choice.
    expect(screen.getAllByRole('button', { name: /Make this the current menu/ })).toHaveLength(1);
    expect(mockMake).not.toHaveBeenCalled();
  });

  it('a corrected line is saved through the review', async () => {
    mockImport.mockResolvedValue(read());
    mockReview.mockResolvedValue({ menuItemId: 'i1', fieldName: 'name', newValue: 'Barolo Riserva' });
    mount(true);
    await readTheFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Barolo' }));
    const box = screen.getByDisplayValue('Barolo');
    fireEvent.change(box, { target: { value: 'Barolo Riserva' } });
    fireEvent.blur(box);
    await waitFor(() => expect(mockReview).toHaveBeenCalledWith('i1', 'name', 'Barolo Riserva'));
    expect(await screen.findByRole('button', { name: 'Barolo Riserva' })).toBeInTheDocument();
  });

  it('the menu is published through the review: the plan, then current, then the page says so', async () => {
    mockImport.mockResolvedValue(read());
    mockMake.mockResolvedValue({ outcome: 'made_current', menuId: 'm9', previousMenuIds: [], lines: 2, priceSync: { changed: 2 }, flagged: 0, failed: [] });
    mount(true);
    await readTheFile();
    fireEvent.click(await screen.findByRole('button', { name: /Make this the current menu/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Make it current' }));
    await waitFor(() => expect(mockMake).toHaveBeenCalledWith('m9', 'fp-m9'));
    expect(await screen.findByTestId('menu-choice-said')).toHaveTextContent('This is now the current menu');
    expect(screen.queryByTestId('menu-read-review')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-read-result')).toHaveTextContent('It is the current menu.');
  });

  it('keeping it, not current, closes the review and changes no price', async () => {
    mockImport.mockResolvedValue(read());
    mount(true);
    await readTheFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Keep it, not current' }));
    expect(await screen.findByTestId('menu-choice-said')).toHaveTextContent('Kept, not current.');
    expect(screen.queryByTestId('menu-read-review')).not.toBeInTheDocument();
    expect(mockMake).not.toHaveBeenCalled();
  });

  it('skipping the review leaves the plain choice, which still goes through the plan', async () => {
    mockImport.mockResolvedValue(read());
    mount(true);
    await readTheFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Skip review' }));
    expect(screen.queryByTestId('menu-read-review')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Make this the current menu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it, not current' })).toBeInTheDocument();
  });

  it('staff review the lines but are offered no choice of the current menu', async () => {
    mockImport.mockResolvedValue(read());
    mount(false);
    await readTheFile();
    const review = await screen.findByTestId('menu-read-review');
    expect(review).toHaveTextContent('Barolo');
    expect(screen.queryByRole('button', { name: /Make this the current menu/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Looks good, continue' }));
    expect(screen.queryByTestId('menu-read-review')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-read-result')).toHaveTextContent('An owner or a manager chooses');
  });

  it('a read with no lines to review, and a file read before, go straight to the choice', async () => {
    mockImport.mockResolvedValueOnce(read({ itemsExtracted: 0, items: [] }));
    mount(true);
    await readTheFile();
    expect(await screen.findByRole('button', { name: 'Make this the current menu' })).toBeInTheDocument();
    expect(screen.queryByTestId('menu-read-review')).not.toBeInTheDocument();
  });

  it('a file read before is shown as that read, not reviewed again', async () => {
    mockImport.mockResolvedValueOnce(read({ reopened: { readAt: '2026-11-10T10:00:00Z' } } as Partial<MenuImportResult>));
    mount(true);
    await readTheFile();
    expect(await screen.findByTestId('menu-read-result')).toHaveTextContent('already read');
    expect(screen.queryByTestId('menu-read-review')).not.toBeInTheDocument();
  });
});
