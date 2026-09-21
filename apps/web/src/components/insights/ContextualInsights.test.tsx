/**
 * The contextual rail (Inventory / Orders / Providers) under ADR 0191's one
 * shared per-item state (founder, 2026-09-21).
 *
 * Before: the rail built its own key, `insight:<candidate>:<entity>`, filtered
 * client-side on it, and dismissed with a stamped `not_relevant` — so a rail
 * dismissal held on that rail alone, carried a reason nobody chose, and a
 * failed write was swallowed. Pinned here: acts go to the gateway's key, a
 * dismissal asks its reason, a whole-type item offers no one-item Dismiss,
 * and a write that did not land is said.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' } }),
}));
vi.mock('@/services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: any) => e?.response?.data?.message ?? e?.message ?? 'failed',
}));

import { ContextualInsights } from './ContextualInsights';

const ONE = {
  candidate_key: 'wine.stockout_risk.peer_rank',
  category: 'inventory',
  sentence: 'Caymus is the likeliest wine to run out this week.',
  score: 3,
  entity_key: 'Caymus',
  suppression: {
    key: 'insight:wine.stockout_risk.peer_rank#caymus#*',
    keys: { rule: 'insight:wine.stockout_risk.peer_rank' },
  },
};
const WHOLE = {
  candidate_key: 'overall.revenue.goal_pace',
  category: 'inventory',
  sentence: 'The goal is behind pace.',
  score: 2,
  suppression: {
    key: 'insight:overall.revenue.goal_pace',
    keys: { rule: 'insight:overall.revenue.goal_pace' },
  },
};

function serve(rows: unknown[], dispositions: unknown[] = []) {
  api.get.mockImplementation((url: string) =>
    url.includes('/actions?status=all')
      ? Promise.resolve({ data: { items: dispositions } })
      : Promise.resolve({ data: { source: 'stored', insights: rows } }),
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('ContextualInsights — one shared per-item state', () => {
  it('shows what the gateway served; it does not re-filter on a key of its own', async () => {
    // A row the rail's OLD filter would have hidden: its colon key.
    serve([ONE], [{ ruleKey: 'insight:wine.stockout_risk.peer_rank:Caymus', status: 'dismissed' }]);
    render(<ContextualInsights host="inventory" />);
    expect(await screen.findByText(ONE.sentence)).toBeInTheDocument();
  });

  it('asks the reason, then dismisses at the gateway key with it', async () => {
    serve([ONE]);
    api.post.mockResolvedValue({ data: {} });
    render(<ContextualInsights host="inventory" />);
    await screen.findByText(ONE.sentence);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss it' })).getByText('I disagree'),
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
        ruleKey: 'insight:wine.stockout_risk.peer_rank#caymus#*',
        status: 'dismissed',
        reason: 'disagree',
        snapshot: expect.objectContaining({ category: 'inventory' }),
      }),
    );
  });

  it('offers no one-item Dismiss on an item whose key is the whole type', async () => {
    serve([WHOLE]);
    render(<ContextualInsights host="inventory" />);
    await screen.findByText(WHOLE.sentence);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });

  it('says so when a dismissal did not land, and reads the list again', async () => {
    serve([ONE]);
    api.post.mockRejectedValue({ response: { data: { message: 'Only an owner or manager' } } });
    render(<ContextualInsights host="inventory" />);
    await screen.findByText(ONE.sentence);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss it' })).getByText('Not relevant'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not saved (Only an owner or manager)',
    );
    expect(await screen.findByText(ONE.sentence)).toBeInTheDocument();
  });
});

describe('ContextualInsights — a state it could not read is said', () => {
  it('says so when the gateway could not read what was put away', async () => {
    api.get.mockImplementation((url: string) =>
      url.includes('/actions?status=all')
        ? Promise.resolve({ data: { items: [] } })
        : Promise.resolve({
            data: { source: 'stored', insights: [ONE], suppressionsReadable: false },
          }),
    );
    render(<ContextualInsights host="inventory" />);
    await screen.findByText(ONE.sentence);
    expect(screen.getByRole('status')).toHaveTextContent(
      'could not be read just now, so some of these may be ones you already put away',
    );
  });

  it('says nothing of the kind when the state was read', async () => {
    serve([ONE]);
    render(<ContextualInsights host="inventory" />);
    await screen.findByText(ONE.sentence);
    expect(screen.queryByText(/could not be read just now/)).not.toBeInTheDocument();
  });
});
