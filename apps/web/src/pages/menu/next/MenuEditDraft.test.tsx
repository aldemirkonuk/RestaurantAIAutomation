/**
 * r109 menu-g5: "Edit as a new draft" copies the current menu into a draft and
 * opens that draft in the review a read menu opens in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuEditDraft, copiedSentence, reviewResultOf } from './MenuEditDraft';
import { copyMenuIntoDraft, getKeptMenu, type MenuLine } from '../../../services/api/menus';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>('../../../services/api/menus');
  return { ...actual, copyMenuIntoDraft: vi.fn(), getKeptMenu: vi.fn() };
});
vi.mock('../../../components/onboarding/MenuReviewScreen', () => ({
  MenuReviewScreen: ({ result, onSkip }: { result: { menuId: string; items: Array<{ name: string }> }; onSkip: () => void }) => (
    <div data-testid="review-for">
      {result.menuId}: {result.items.map((i) => i.name).join(', ')}
      <button type="button" onClick={onSkip}>skip</button>
    </div>
  ),
}));

const line = (over: Partial<MenuLine> = {}): MenuLine =>
  ({
    id: 'd-1',
    name: 'Chianti',
    producer: null,
    category: 'Red',
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: 12,
    bottle_price: 50,
    wine_library_id: 'mw-2',
    inventory_item_id: 'inv-2',
    source: 'scan',
    status: 'approved',
    created_at: '2026-11-27T09:00:00Z',
    ...over,
  }) as MenuLine;

const made = { menuId: 'draft-1', name: 'Wine List, draft of 27 Nov 2026', lines: 1, copiedAt: '2026-11-27T09:00:00Z', timezone: 'Europe/Istanbul' };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MenuEditDraft menuId="cur-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.mocked(copyMenuIntoDraft).mockReset() && vi.mocked(getKeptMenu).mockReset());

describe('MenuEditDraft', () => {
  it('the button copies the current menu and opens the review on the DRAFT, saying what it does not hold', async () => {
    vi.mocked(copyMenuIntoDraft).mockResolvedValue(made);
    vi.mocked(getKeptMenu).mockResolvedValue({ items: [line()] });
    mount();
    fireEvent.click(screen.getByTestId('menu-edit-draft-start'));
    expect(await screen.findByTestId('review-for')).toHaveTextContent('draft-1: Chianti');
    expect(copyMenuIntoDraft).toHaveBeenCalledWith('cur-1');
    expect(getKeptMenu).toHaveBeenCalledWith('draft-1');
    expect(screen.getByTestId('menu-edit-draft-copied')).toHaveTextContent(
      'Copied from the current menu at 2026-11-27 12:00; changes made to the current menu after that are not in this draft.',
    );
    expect(document.activeElement).toHaveTextContent('Wine List, draft of 27 Nov 2026');
    fireEvent.click(screen.getByText('skip'));
    expect(screen.getByTestId('menu-edit-draft-said')).toHaveTextContent('It stays in Menus kept for later.');
  });

  it("a refusal is said in the gateway's words, and no review opens", async () => {
    vi.mocked(copyMenuIntoDraft).mockRejectedValue({ response: { data: { message: 'Only the current menu can be copied into a new draft. Nothing was made.' } } });
    mount();
    fireEvent.click(screen.getByTestId('menu-edit-draft-start'));
    await waitFor(() => expect(screen.getByTestId('menu-edit-draft-refused')).toHaveTextContent('Only the current menu can be copied'));
    expect(screen.queryByTestId('review-for')).toBeNull();
    expect(getKeptMenu).not.toHaveBeenCalled();
  });
});

describe('reviewResultOf', () => {
  it("names the draft's own line ids, prices and link, never a current-menu line", () => {
    const r = reviewResultOf('draft-1', [line(), line({ id: 'd-2', name: 'House', wine_library_id: null, inventory_item_id: null, status: 'flagged' })]);
    expect(r).toMatchObject({ menuId: 'draft-1', current: false, itemsExtracted: 2 });
    expect(r.items[0]).toMatchObject({ menuItemId: 'd-1', bottlePrice: 50, byGlassPrice: 12, matched: true, needsReview: false });
    expect(r.items[1]).toMatchObject({ menuItemId: 'd-2', matched: false, needsReview: true });
  });
  it('a zone not recorded is said on the device clock, never left out', () =>
    expect(copiedSentence({ ...made, timezone: null })).toMatch(/^Copied from the current menu at /));
});
