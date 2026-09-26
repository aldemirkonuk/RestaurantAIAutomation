/**
 * The Reports insight panel under ADR 0191's one shared per-item state.
 *
 * The gateway withholds what was dismissed, snoozed or done before the list
 * reaches this panel, and the panel no longer filters by itself. So when the
 * gateway could not READ that state (`suppressionsReadable: false`), the
 * list it served may hold items already put away — and the panel must say
 * so, never present that list as clean (absence reported as health).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' } }),
}));
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: any) => e?.response?.data?.message ?? e?.message ?? 'failed',
}));

import { EngineInsightsPanel } from './EngineInsightsPanel';

const ONE = {
  candidate_key: 'overall.revenue.vs_same_weekday',
  category: 'sales',
  sentence: 'Wednesday sales came in 40% lower than your average Wednesday.',
  score: 3,
  suppression: {
    key: 'insight:overall.revenue.vs_same_weekday#wednesday#d:2026-09-16',
    keys: { rule: 'insight:overall.revenue.vs_same_weekday' },
  },
};

function serve(body: Record<string, unknown>) {
  api.get.mockImplementation((url: string) => {
    if (url.includes('/actions?status=all')) return Promise.resolve({ data: { items: [] } });
    if (url.includes('/goals/')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: body });
  });
}

function mount() {
  return render(
    <MemoryRouter>
      <EngineInsightsPanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('EngineInsightsPanel — a state it could not read is said', () => {
  it('says so when the gateway could not read what was put away', async () => {
    serve({ source: 'stored', insights: [ONE], suppressionsReadable: false });
    mount();
    expect(await screen.findByText(ONE.sentence)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'could not be read just now, so some of these may be ones you already put away',
    );
  });

  it('says nothing of the kind when the state was read', async () => {
    serve({ source: 'stored', insights: [ONE], suppressionsReadable: true });
    mount();
    expect(await screen.findByText(ONE.sentence)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read just now/)).not.toBeInTheDocument();
  });
});

/**
 * ADR 0191 round 3 (founder, 2026-09-21): "Already handled" records done,
 * "Not right now" hides it from this person alone, and Undo reverses the act
 * it actually was.
 */
describe('EngineInsightsPanel — round 3, what each choice records', () => {
  it("'Already handled' posts done; 'Not right now' posts a snooze for me and Undo wakes it", async () => {
    serve({ source: 'stored', insights: [ONE], suppressionsReadable: true });
    api.post.mockResolvedValue({ data: {} });
    mount();
    await screen.findByText(ONE.sentence);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss it' })).getByText('Not right now'),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/analytics/recommendations/r1/action',
        expect.objectContaining({ ruleKey: ONE.suppression.key, status: 'snoozed', snoozeFor: 'me' }),
      ),
    );
    expect(await screen.findByText('Hidden from you until tomorrow')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Undo'));
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith(
        '/analytics/recommendations/r1/snoozed-for-me/wake',
        { ruleKey: ONE.suppression.key },
      ),
    );
  });

  it("'Already handled' posts done, with no label", async () => {
    serve({ source: 'stored', insights: [ONE], suppressionsReadable: true });
    api.post.mockResolvedValue({ data: {} });
    mount();
    await screen.findByText(ONE.sentence);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss it' })).getByText('Already handled'),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/analytics/recommendations/r1/action',
        expect.objectContaining({ ruleKey: ONE.suppression.key, status: 'done' }),
      ),
    );
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('reason');
  });

  it("says so when this person's own snoozes could not be read", async () => {
    serve({
      source: 'stored',
      insights: [ONE],
      suppressionsReadable: true,
      personalSnoozesReadable: false,
    });
    mount();
    expect(await screen.findByText(ONE.sentence)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('could not be read just now');
  });
});
