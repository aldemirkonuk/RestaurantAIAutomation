/**
 * The subject's account sheet — sketch 120 item 4.
 *
 * What must hold:
 *  1. Siblings sharing the subject are split into "standing" (active, not
 *     this entry) and "done" — an entry never counts itself.
 *  2. The stored feed is filtered to THIS subject client-side (the endpoint
 *     returns the whole house's feed) and a failed read says so, rather than
 *     rendering an empty "nothing else stored" line that looks like an
 *     answer instead of an absence.
 *  3. "Silenced for it" is never answered from what this sheet has loaded —
 *     it says outright that it does not know, per ADR 0020.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountSheet from './AccountSheet';
import type { EntryVM } from './useRecommendationsNextData';

// The catalogue link is a react-router `Link` (in-app navigation, not a full
// reload) — it needs a Router in scope, same as `CatalogView.test.tsx`.
function renderSheet(ui: JSX.Element) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

function entry(over: Partial<EntryVM> = {}): EntryVM {
  return {
    ruleKey: 'sales_below_weekday_baseline',
    observation: 'Tuesday sales came in 38% lower than your average Tuesday.',
    recommendation: 'Brief the floor before the next Tuesday shift.',
    rationale: null,
    category: 'sales',
    urgency: 'now',
    stake: 'revenue',
    hand: 'manager',
    score: 3,
    pinned: false,
    acted: false,
    status: 'active',
    reason: null,
    snoozeUntil: null,
    feedback: null,
    assignedTo: null,
    assignedName: null,
    updatedAt: null,
    firstSeenAt: '2026-09-15T18:12:00Z',
    subject: 'tuesday',
    periodKey: 'd:2026-09-15',
    suppression: null,
    ...over,
  } as unknown as EntryVM;
}

beforeEach(() => {
  auth.rid = 'r1';
  api.get.mockReset();
});

describe('AccountSheet', () => {
  it('titles itself from the subject and separates standing siblings from done ones, never counting itself', async () => {
    api.get.mockResolvedValue({ data: { insights: [] } });
    const e = entry();
    const sibling = entry({ ruleKey: 'weekly_demand_slide', observation: 'Tuesday demand is sliding.' });
    const doneSibling = entry({ ruleKey: 'old_rule', status: 'done', observation: 'An old Tuesday call.' });
    const otherSubject = entry({ ruleKey: 'other', subject: 'wednesday', observation: 'Wednesday thing.' });

    renderSheet(
      <AccountSheet entry={e} siblings={[e, sibling, doneSibling, otherSubject]} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Tuesday' })).toBeInTheDocument();
    expect(screen.getByText('Tuesday demand is sliding.')).toBeInTheDocument();
    expect(screen.getByText('An old Tuesday call.')).toBeInTheDocument();
    expect(screen.queryByText('Wednesday thing.')).not.toBeInTheDocument();
    // The entry itself never appears as its own sibling.
    expect(screen.queryByText(e.observation)).not.toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/analytics/insights/r1'));
  });

  it('says "only this entry" and admits Done was not loaded when no sibling shares the subject', () => {
    api.get.mockResolvedValue({ data: { insights: [] } });
    const e = entry();
    renderSheet(<AccountSheet entry={e} siblings={[e]} onClose={vi.fn()} />);
    expect(screen.getByText('Only this entry, today.')).toBeInTheDocument();
    expect(screen.getByText(/Not read here when this sheet opens from the Standing leaf/i)).toBeInTheDocument();
  });

  it('filters the stored feed to this subject and renders its sentences once read', async () => {
    api.get.mockResolvedValue({
      data: {
        insights: [
          { candidateKey: 'a', category: 'sales', sentence: 'A Tuesday sentence.', subject: 'tuesday', periodKey: null },
          { candidateKey: 'b', category: 'sales', sentence: 'A Wednesday sentence.', subject: 'wednesday', periodKey: null },
        ],
      },
    });
    const e = entry();
    renderSheet(<AccountSheet entry={e} siblings={[e]} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('A Tuesday sentence.')).toBeInTheDocument());
    expect(screen.queryByText('A Wednesday sentence.')).not.toBeInTheDocument();
  });

  it('says the feed could not be read, rather than claiming nothing else exists', async () => {
    api.get.mockRejectedValue({ response: { status: 500, data: { message: 'db unreachable' } } });
    const e = entry();
    renderSheet(<AccountSheet entry={e} siblings={[e]} onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/could not be read/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Nothing else stored/)).not.toBeInTheDocument();
  });

  it('never claims to know whether this subject has been silenced', () => {
    api.get.mockResolvedValue({ data: { insights: [] } });
    const e = entry();
    renderSheet(<AccountSheet entry={e} siblings={[e]} onClose={vi.fn()} />);
    // Done and Silenced both admit unread leaf scope with "Not read here".
    expect(screen.getAllByText(/Not read here/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Dismissed and History leaves/i)).toBeInTheDocument();
  });

  it('links the catalogue pre-searched for the subject’s own words', () => {
    api.get.mockResolvedValue({ data: { insights: [] } });
    const e = entry();
    renderSheet(<AccountSheet entry={e} siblings={[e]} onClose={vi.fn()} />);
    const link = screen.getByRole('link', { name: /Browse the catalogue/ });
    expect(link).toHaveAttribute('href', '/recommendations/catalog?q=tuesday');
  });

  it('fails cleanly with no restaurant selected, instead of firing a request with no tenant', () => {
    auth.rid = null;
    const e = entry();
    renderSheet(<AccountSheet entry={e} siblings={[e]} onClose={vi.fn()} />);
    expect(screen.getByText(/no restaurant is selected/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
