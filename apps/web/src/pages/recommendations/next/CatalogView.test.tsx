/**
 * `/recommendations/catalog` as a VIEW — read-only, sharing this page's own
 * endpoint with the legacy `InsightCatalog`. What must hold:
 *
 *  1. It reads `GET /analytics/insight-catalog/types` and nothing else — no
 *     write exists anywhere in this component.
 *  2. "computable" is relabelled "Data present" everywhere, with the
 *     presence caveat printed once the read lands (the honesty fix this
 *     view exists for — see `rec-catalog.ts`).
 *  3. A type the server sent with `implemented` omitted reads "Unknown", not
 *     "Built, missing data" — collapsing the two would claim a certainty
 *     the payload does not carry.
 *  4. A failed read says so, with a retry, rather than an empty catalogue.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CatalogView from './CatalogView';
import type { CatalogPayload } from './rec-catalog';

const auth = vi.hoisted(() => ({ rid: 'r1' as string | null }));
const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: auth.rid }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));

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
  api.get.mockReset();
});

describe('CatalogView', () => {
  it('reads the same endpoint the legacy page uses, scoped to the active tenant, and nothing else', async () => {
    api.get.mockResolvedValue({ data: PAYLOAD });
    draw();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    expect(api.get).toHaveBeenCalledWith('/analytics/insight-catalog/types?restaurantId=r1');
  });

  it('relabels "computable" as "Data present" and prints the presence caveat', async () => {
    api.get.mockResolvedValue({ data: PAYLOAD });
    draw();
    await waitFor(() => expect(screen.getByTestId('rc-presence-caveat')).toBeInTheDocument());
    expect(
      screen.getByText('3 catalogued · 2 built · 1 with data present · 1 built but missing data · 0 not built yet.'),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('rc-readiness')[0]).toHaveTextContent('Data present');
    expect(screen.getByText(/not that today’s reading is deep enough/)).toBeInTheDocument();
  });

  it('reads a type with `implemented` omitted as Unknown, never Blocked', async () => {
    api.get.mockResolvedValue({ data: PAYLOAD });
    draw();
    await waitFor(() => expect(screen.getAllByTestId('rc-catalog-row')).toHaveLength(3));
    const rows = screen.getAllByTestId('rc-readiness').map((n) => n.textContent);
    expect(rows).toContain('Unknown');
    expect(rows).not.toContain('Blocked');
  });

  it('filters by dimension and by search text, and the two are mutually exclusive', async () => {
    api.get.mockResolvedValue({ data: PAYLOAD });
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
    api.get.mockResolvedValue({ data: PAYLOAD });
    draw();
    const rows = await waitFor(() => screen.getAllByTestId('rc-catalog-row'));
    for (const row of rows) {
      expect(row.className.split(' ')).not.toContain('rc-entry');
    }
  });
});
