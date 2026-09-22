/**
 * `/recommendations/catalog` as a VIEW, sharing this page's own endpoint
 * with the legacy `InsightCatalog`. What must hold:
 *
 *  1. It reads `GET /analytics/insight-catalog/types`, scoped to the tenant.
 *  2. "computable" is relabelled "Data present" everywhere, with the
 *     presence caveat printed once the read lands (the honesty fix this
 *     view exists for — see `rec-catalog.ts`).
 *  3. A type the server sent with `implemented` omitted reads "Unknown", not
 *     "Built, missing data" — collapsing the two would claim a certainty
 *     the payload does not carry.
 *  4. A failed read says so, with a retry, rather than an empty catalogue.
 *
 * ADR 0191 (founder, 2026-09-21) made the page actionable — what must hold
 * there:
 *  5. Owner/manager only sees a clickable On/Off; anyone else sees a
 *     read-only badge, and neither ever renders for a type still `null`
 *     (unknown) rather than defaulting to "On".
 *  6. Toggling writes `PUT insight-catalog/types/:rid/:candidateKey/toggle`
 *     and rolls back on a failed write rather than keeping the optimistic
 *     flip.
 *  7. "Open live items" only exists on a computable, currently-on type; an
 *     off type says why instead of fetching.
 *  8. Absence is never health: an unreadable on/off read says so (not
 *     "Reading…" for ever, not "On"); a Pin/Dismiss that did not land puts
 *     the item back and says so; unreadable dismissals are named on the
 *     live list; a toggle whose audit row did not write says so.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CatalogView from './CatalogView';
import type { CatalogPayload } from './rec-catalog';

const auth = vi.hoisted(() => ({
  rid: 'r1' as string | null,
  role: 'owner' as 'owner' | 'manager' | 'staff' | null,
}));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: auth.rid,
    user: { role: auth.role },
    activeRole: auth.role,
  }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

/** The dispositions call every draw fires alongside the catalogue read. */
function mockDispositionsEmpty() {
  api.get.mockImplementation((url: string) =>
    url.includes('/actions?status=dismissed')
      ? Promise.resolve({ data: { items: [] } })
      : Promise.resolve({ data: PAYLOAD }),
  );
}

const PAYLOAD: CatalogPayload = {
  total: 3,
  byCategory: { sales: 2, wine: 1 },
  dimensions: [
    { key: 'overall', label: 'Overall', entityScoped: false, requires: [] },
    { key: 'wine', label: 'Wine', entityScoped: true, requires: [] },
  ],
  measures: [
    { key: 'revenue', label: 'Revenue', unit: 'currency', requires: ['checks'] },
    { key: 'revenue_per_seat', label: 'Revenue per seat', unit: 'currency', requires: ['checks', 'tables'] },
  ],
  comparators: [
    { key: 'vs_same_weekday', label: 'vs the same weekday', template: '' },
    { key: 'trend_direction', label: 'trend direction', template: '' },
  ],
  candidates: [
    {
      key: 'overall.revenue.vs_same_weekday',
      dimension: 'overall',
      measure: 'revenue',
      comparator: 'vs_same_weekday',
      category: 'sales',
      template: '',
      requires: ['checks'],
      implemented: true,
    },
    {
      key: 'wine.revenue_per_seat.trend_direction',
      dimension: 'wine',
      measure: 'revenue_per_seat',
      comparator: 'trend_direction',
      category: 'wine',
      template: '',
      requires: ['checks', 'tables'],
      implemented: true,
    },
    {
      key: 'overall.mystery.unknown_state',
      dimension: 'overall',
      measure: 'revenue',
      comparator: 'trend_direction',
      category: 'sales',
      template: '',
      requires: [],
      implemented: undefined as unknown as boolean,
    },
  ],
  available: ['checks'],
  coverage: { catalogued: 3, implemented: 2, computable: 1, blockedOnData: 1, notBuilt: 0 },
};

function draw(path = '/recommendations/catalog') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <CatalogView />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.rid = 'r1';
  auth.role = 'owner';
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.put.mockResolvedValue({ data: {} });
});

async function drawAndExpand(candidateKey: string) {
  mockDispositionsEmpty();
  draw();
  await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
  fireEvent.click(screen.getByText(candidateKey));
}

describe('CatalogView', () => {
  it('reads the catalogue and this house\'s type dispositions, both scoped to the tenant', async () => {
    mockDispositionsEmpty();
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    const urls = api.get.mock.calls.map((c) => c[0]);
    expect(urls).toContain('/analytics/insight-catalog/types?restaurantId=r1');
    expect(urls).toContain('/analytics/recommendations/r1/actions?status=dismissed');
  });

  it('relabels "computable" as "Data present" and prints the presence caveat', async () => {
    mockDispositionsEmpty();
    draw();
    await waitFor(() => expect(screen.getByTestId('rc-presence-caveat')).toBeInTheDocument());
    expect(
      screen.getByText('3 catalogued · 2 built · 1 with data present · 1 built but missing data · 0 not built yet.'),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('rc-readiness')[0]).toHaveTextContent('Data present');
    expect(screen.getByText(/not that today’s reading is deep enough/)).toBeInTheDocument();
  });

  it('reads a type with `implemented` omitted as Unknown, never Blocked', async () => {
    mockDispositionsEmpty();
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    const rows = screen.getAllByTestId('rc-readiness').map((n) => n.textContent);
    expect(rows).toContain('Unknown');
    expect(rows).not.toContain('Blocked');
  });

  it('filters by dimension and by search text, and the two are mutually exclusive', async () => {
    mockDispositionsEmpty();
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: /Wine/ }));
    expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Search the catalogue'), {
      target: { value: 'overall' },
    });
    // Searching overrides the rail filter — both overall candidates return.
    expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(2);
  });

  it('says the read failed, with a retry, rather than rendering an empty catalogue', async () => {
    api.get.mockRejectedValue({ response: { status: 500, data: { message: 'db down' } } });
    draw();
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Read it again' })).toBeInTheDocument();
    expect(screen.queryByTestId('rc-catalog-row')).not.toBeInTheDocument();
  });

  it('does not reuse rc-entry, whose 34px/1fr grid (rec-next.css:131, Entry.tsx\'s rc-gutter + rc-body) squeezes the row-head button and overlaps rc-plain', async () => {
    mockDispositionsEmpty();
    draw();
    const rows = await waitFor(() => screen.getAllByTestId('rc-catalog-row'));
    for (const row of rows) {
      expect(row.className.split(' ')).not.toContain('rc-entry');
    }
  });
});

// ADR 0191 — actionable: on/off + live items.

describe('CatalogView — type on/off (ADR 0191)', () => {
  it('owner/manager sees a clickable On, and turning it off writes the toggle endpoint', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    const toggle = await screen.findByRole('button', { name: 'On' });
    fireEvent.click(toggle);
    // Off is a whole-type dismissal: it asks the reason before it writes —
    // the founder's labelled signal (2026-09-21), never a stamped one.
    expect(api.put).not.toHaveBeenCalled();
    const why = await screen.findByRole('group', { name: 'Why turn it off' });
    fireEvent.click(within(why).getByText('I disagree'));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/analytics/insight-catalog/types/r1/overall.revenue.vs_same_weekday/toggle',
        { enabled: false, reason: 'disagree' },
      ),
    );
    expect(await screen.findByRole('button', { name: 'Off' })).toBeInTheDocument();
  });

  it('turning a type back on asks nothing — a restore carries no reason', async () => {
    api.get.mockImplementation((url: string) =>
      url.includes('/actions?status=dismissed')
        ? Promise.resolve({
            data: { items: [{ ruleKey: 'insight:overall.revenue.vs_same_weekday', status: 'dismissed' }] },
          })
        : Promise.resolve({ data: PAYLOAD }),
    );
    api.put.mockResolvedValue({ data: { audit: { recorded: true, reason: null } } });
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    fireEvent.click(screen.getByText('overall.revenue.vs_same_weekday'));
    fireEvent.click(await screen.findByRole('button', { name: 'Off' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/analytics/insight-catalog/types/r1/overall.revenue.vs_same_weekday/toggle',
        { enabled: true },
      ),
    );
  });

  it('rolls the optimistic flip back when the write fails', async () => {
    api.put.mockRejectedValue({ response: { status: 500, data: { message: 'db down' } } });
    await drawAndExpand('overall.revenue.vs_same_weekday');
    fireEvent.click(await screen.findByRole('button', { name: 'On' }));
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Why turn it off' })).getByText('I disagree'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved');
    expect(await screen.findByRole('button', { name: 'On' })).toBeInTheDocument();
  });

  it('a non-owner/manager sees a read-only badge, never a button', async () => {
    auth.role = 'staff';
    await drawAndExpand('overall.revenue.vs_same_weekday');
    expect(await screen.findByTestId('rc-type-onoff-badge')).toHaveTextContent('On');
    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Off' })).not.toBeInTheDocument();
  });

  it('a type already dismissed at rule scope reads Off, never defaulting to On', async () => {
    api.get.mockImplementation((url: string) =>
      url.includes('/actions?status=dismissed')
        ? Promise.resolve({
            data: { items: [{ ruleKey: 'insight:overall.revenue.vs_same_weekday', status: 'dismissed' }] },
          })
        : Promise.resolve({ data: PAYLOAD }),
    );
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    fireEvent.click(screen.getByText('overall.revenue.vs_same_weekday'));
    expect(await screen.findByRole('button', { name: 'Off' })).toBeInTheDocument();
  });
});

describe('CatalogView — open live items (ADR 0191)', () => {
  it('only offers "Open live items" on a computable type', async () => {
    mockDispositionsEmpty();
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    // The rail is an accordion — one row's detail is open at a time.
    fireEvent.click(screen.getByText('overall.revenue.vs_same_weekday')); // computable
    expect(await screen.findByRole('button', { name: 'Open live items' })).toBeInTheDocument();

    fireEvent.click(screen.getByText('wine.revenue_per_seat.trend_direction')); // blocked
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Open live items' })).not.toBeInTheDocument(),
    );
  });

  it('fetches live-generated items for that type only, and offers Pin/Dismiss on each', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          insights: [
            {
              candidateKey: 'overall.revenue.vs_same_weekday',
              category: 'sales',
              sentence: 'Tuesday sales were 12% below average Tuesdays.',
              score: 1.2,
              suppression: { key: 'insight:overall.revenue.vs_same_weekday#tuesday#d:2026-09-16' },
            },
            {
              // a different type in the same category — must be filtered out
              candidateKey: 'overall.revenue.trend_direction',
              category: 'sales',
              sentence: 'Not this one.',
              score: 9,
              suppression: { key: 'insight:overall.revenue.trend_direction' },
            },
          ],
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/analytics/insights/r1?categories=sales&candidateKey=overall.revenue.vs_same_weekday&refresh=true',
      ),
    );
    expect(await screen.findByText('Tuesday sales were 12% below average Tuesdays.')).toBeInTheDocument();
    expect(screen.queryByText('Not this one.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
      ruleKey: 'insight:overall.revenue.vs_same_weekday#tuesday#d:2026-09-16',
      pinned: true,
      snapshot: expect.objectContaining({ category: 'sales' }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    // The reason is asked, not stamped.
    expect(api.post).not.toHaveBeenCalledWith(
      '/analytics/recommendations/r1/action',
      expect.objectContaining({ status: 'dismissed' }),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss this item' })).getByText('I disagree'),
    );
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
      ruleKey: 'insight:overall.revenue.vs_same_weekday#tuesday#d:2026-09-16',
      status: 'dismissed',
      reason: 'disagree',
      snapshot: expect.objectContaining({ category: 'sales' }),
    });
    expect(screen.queryByText('Tuesday sales were 12% below average Tuesdays.')).not.toBeInTheDocument();
  });

  it('an off type says so and never fetches live items', async () => {
    api.get.mockImplementation((url: string) =>
      url.includes('/actions?status=dismissed')
        ? Promise.resolve({
            data: { items: [{ ruleKey: 'insight:overall.revenue.vs_same_weekday', status: 'dismissed' }] },
          })
        : Promise.resolve({ data: PAYLOAD }),
    );
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    fireEvent.click(screen.getByText('overall.revenue.vs_same_weekday'));
    expect(
      await screen.findByText('This type is off for this house — turn it on to see its live items.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open live items' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/analytics/insights/'));
  });
});

describe('CatalogView — absence is not health (ADR 0191, last-call fixes)', () => {
  it('an unreadable on/off read says so — no On, no endless "Reading…"', async () => {
    api.get.mockImplementation((url: string) =>
      url.includes('/actions?status=dismissed')
        ? Promise.reject({ response: { status: 500, data: { message: 'db down' } } })
        : Promise.resolve({ data: PAYLOAD }),
    );
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    fireEvent.click(screen.getByText('overall.revenue.vs_same_weekday'));
    expect(
      await screen.findByText(/Couldn't read whether this type is on for the house \(db down\)/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
  });

  it('a dispositions reply with no list is not "nothing is off"', async () => {
    api.get.mockImplementation((url: string) =>
      url.includes('/actions?status=dismissed')
        ? Promise.resolve({ data: {} })
        : Promise.resolve({ data: PAYLOAD }),
    );
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    fireEvent.click(screen.getByText('overall.revenue.vs_same_weekday'));
    expect(await screen.findByText(/the reply carried no list/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'On' })).not.toBeInTheDocument();
  });

  it('a toggle whose audit row did not write says so', async () => {
    api.put.mockResolvedValue({ data: { audit: { recorded: false, reason: 'permission denied' } } });
    await drawAndExpand('overall.revenue.vs_same_weekday');
    fireEvent.click(await screen.findByRole('button', { name: 'On' }));
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Why turn it off' })).getByText('Not relevant'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved, but not written to the house log (permission denied).',
    );
  });

  const LIVE = {
    candidateKey: 'overall.revenue.vs_same_weekday',
    category: 'sales',
    sentence: 'Tuesday sales were 12% below average Tuesdays.',
    score: 1.2,
    suppression: { key: 'insight:overall.revenue.vs_same_weekday#tuesday#d:2026-09-16' },
  };

  it('a Dismiss that did not land puts the item back and says so', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockRejectedValue({ response: { status: 500, data: { message: 'db down' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    expect(await screen.findByText(LIVE.sentence)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss this item' })).getByText('Not relevant'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved (db down)');
    expect(screen.getByText(LIVE.sentence)).toBeInTheDocument();
  });

  it('a Pin that did not land is un-pinned again and says so', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockRejectedValue({ response: { status: 500, data: { message: 'db down' } } });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved (db down)');
    expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('snoozes one item at its own key, until an instant, and it leaves the list', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockResolvedValue({ data: {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze' }));
    // An owner (this fixture) is offered both audiences (ADR 0191 round 3).
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Snooze this item' })).getByRole('button', {
        name: 'Until next week, for everyone',
      }),
    );
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
      ruleKey: LIVE.suppression.key,
      status: 'snoozed',
      snoozeFor: 'house',
      snoozeUntil: expect.any(String),
      snapshot: expect.objectContaining({ category: 'sales' }),
    });
    const until = Date.parse(
      (api.post.mock.calls.at(-1)?.[1] as { snoozeUntil: string }).snoozeUntil,
    );
    expect(until).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(screen.queryByText(LIVE.sentence)).not.toBeInTheDocument();
  });

  it('round 3: staff snooze an item for themselves alone — never for everyone', async () => {
    auth.role = 'staff';
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockResolvedValue({ data: {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Snooze' }));
    const group = screen.getByRole('group', { name: 'Snooze this item' });
    expect(within(group).queryByRole('button', { name: /for everyone/ })).not.toBeInTheDocument();
    expect(within(group).getByTestId('rc-live-snooze-for-you')).toHaveTextContent(
      'only an owner or manager can snooze it for everyone',
    );
    fireEvent.click(within(group).getByRole('button', { name: 'Until tomorrow, just for you' }));
    expect(api.post).toHaveBeenCalledWith(
      '/analytics/recommendations/r1/action',
      expect.objectContaining({ ruleKey: LIVE.suppression.key, status: 'snoozed', snoozeFor: 'me' }),
    );
  });

  it("round 3: 'Already handled' records done and 'Not right now' is your own snooze", async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockResolvedValue({ data: {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss this item' })).getByText('Already handled'),
    );
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
      ruleKey: LIVE.suppression.key,
      status: 'done',
      snapshot: expect.objectContaining({ category: 'sales' }),
    });
    expect(api.post).not.toHaveBeenCalledWith(
      '/analytics/recommendations/r1/action',
      expect.objectContaining({ reason: 'already_handled' }),
    );
  });

  it("round 3: 'Not right now' posts a snooze for me, until tomorrow", async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockResolvedValue({ data: {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Why dismiss this item' })).getByText('Not right now'),
    );
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
      ruleKey: LIVE.suppression.key,
      status: 'snoozed',
      snoozeFor: 'me',
      snoozeUntil: expect.any(String),
      snapshot: expect.objectContaining({ category: 'sales' }),
    });
  });

  it('round 3: says what this person hid for themselves, and when that could not be read', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          insights: [LIVE],
          suppressionsReadable: true,
          hiddenForYou: 2,
          personalSnoozesReadable: false,
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    expect(await screen.findByTestId('rc-live-hidden-for-you')).toHaveTextContent(
      '2 hidden just for you',
    );
    expect(screen.getByTestId('rc-live-personal-unread')).toHaveTextContent(
      'What you snoozed for yourself could not be read',
    );
  });

  it('marks one item done at its own key, with no reason — completion is no negative signal', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: true } }),
    );
    api.post.mockResolvedValue({ data: {} });
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(api.post).toHaveBeenCalledWith('/analytics/recommendations/r1/action', {
      ruleKey: LIVE.suppression.key,
      status: 'done',
      snapshot: expect.objectContaining({ category: 'sales' }),
    });
    expect(screen.queryByText(LIVE.sentence)).not.toBeInTheDocument();
  });

  it('says how many of this type the shared state is holding back, and that it holds everywhere', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          insights: [LIVE],
          suppressionsReadable: true,
          withheld: { dismissed: 1, snoozed: 2, done: 0 },
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    expect(await screen.findByTestId('rc-live-withheld')).toHaveTextContent(
      /1 dismissed · 2 snoozed · 0 done/,
    );
  });

  it('never offers a one-item Dismiss that would silence the whole type', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({
        data: {
          insights: [{ ...LIVE, suppression: { key: 'insight:overall.revenue.vs_same_weekday' } }],
          suppressionsReadable: true,
        },
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    expect(await screen.findByTestId('rc-live-whole-type')).toHaveTextContent(
      'Acting on this one acts on the whole type',
    );
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snooze' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('names unreadable dismissals on the live list instead of presenting it as clean', async () => {
    await drawAndExpand('overall.revenue.vs_same_weekday');
    api.get.mockImplementationOnce(() =>
      Promise.resolve({ data: { insights: [LIVE], suppressionsReadable: false } }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open live items' }));
    expect(
      await screen.findByText(/Dismissals could not be read — some of these may already be dismissed/),
    ).toBeInTheDocument();
  });
});
