/**
 * The Roll Call — the scorecard as the second view of /providers (ADR 0207).
 *
 * `apiClient` is mocked: these pin what the view does with the gateway's
 * answer — refusals in words, a failed register in every cell of its column,
 * refusals kept out of a sort, no table for an empty book.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { card, measure } from './scorecard-fixtures';
import type { VendorScorecard } from './scorecard-types';

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1' }),
}));

import { RollCall } from './RollCall';

function renderIt() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RollCall />
    </QueryClientProvider>,
  );
}

function vendor(
  id: string,
  name: string,
  onTimeHits: number | null,
  over: Partial<VendorScorecard> = {},
): VendorScorecard {
  const base = card({ providerId: id, providerName: name });
  base.measures[0] =
    onTimeHits === null
      ? measure({
          key: 'onTime',
          label: 'On time',
          outcome: 'too_few',
          sample: 2,
          hits: 2,
          value: null,
          rows: 2,
          sentence: '2 deliveries with an expected date in 90 days — too few to score; 5 are needed.',
        })
      : measure({
          key: 'onTime',
          label: 'On time',
          hits: onTimeHits,
          sample: 10,
          value: onTimeHits / 10,
          rows: 10,
        });
  return { ...base, ...over };
}

const alerting = {
  built: false as const,
  sentence:
    'No alert is sent from these figures. A labelled set and a shadow run come first, and neither is built yet.',
};

beforeEach(() => {
  api.get.mockReset();
});

describe('the Roll Call', () => {
  it('lists every vendor with each cell a count over a count and its prior window', async () => {
    api.get.mockResolvedValue({
      data: {
        window: card().window,
        vendors: [vendor('a', 'Skurnik', 7), vendor('b', 'Winebow', 9)],
        alerting,
      },
    });
    renderIt();
    const cell = await screen.findByTestId('rc-cell-a-onTime');
    expect(cell).toHaveTextContent('7of 10');
    expect(cell).toHaveTextContent('prior 90 d · 9 of 13');
    expect(screen.getByTestId('rc-cell-a-linesAsOrdered')).toHaveTextContent('too few2 of 5');
    expect(screen.getByTestId('rc-alerting')).toHaveTextContent('neither is built yet');
    expect(api.get).toHaveBeenCalledWith('/vendor-scorecard', {
      params: { window: 90 },
    });
  });

  it('writes a register that failed into every cell of its column, with the reason', async () => {
    api.get.mockResolvedValue({
      data: {
        window: card().window,
        vendors: [vendor('a', 'Skurnik', 7), vendor('b', 'Winebow', 9)],
        alerting,
      },
    });
    renderIt();
    for (const id of ['a', 'b']) {
      const cell = await screen.findByTestId(`rc-cell-${id}-priceAsAgreed`);
      expect(cell).toHaveTextContent('did not answer');
      expect(cell).toHaveTextContent('502 upstream');
    }
  });

  it('sorts by a measure with the vendors that cannot score kept apart, never ranked among the scored', async () => {
    api.get.mockResolvedValue({
      data: {
        window: card().window,
        vendors: [vendor('c', 'Cellar Nine', null), vendor('a', 'Skurnik', 7), vendor('b', 'Winebow', 9)],
        alerting,
      },
    });
    renderIt();
    await screen.findByTestId('rc-row-a');
    fireEvent.click(screen.getByRole('button', { name: /^On time/ }));
    const rows = screen.getAllByRole('row').map((r) => r.getAttribute('data-testid') ?? 'rule-or-head');
    expect(rows.filter((r) => r.startsWith('rc-row'))).toEqual(['rc-row-b', 'rc-row-a', 'rc-row-c']);
    expect(screen.getByTestId('rc-refused-rule')).toHaveTextContent(
      'One vendor has no “On time” figure in this window — listed apart, never ranked among the scored.',
    );
  });

  it('opens a cell’s rows in the Docket', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.endsWith('/docket')
          ? { card: card({ providerId: 'a' }), measure: null, entries: [] }
          : {
              window: card().window,
              vendors: [vendor('a', 'Skurnik', 7)],
              alerting,
            },
      }),
    );
    renderIt();
    fireEvent.click(await screen.findByTestId('rc-cell-a-credits'));
    const sheet = await screen.findByTestId('docket');
    expect(api.get).toHaveBeenCalledWith('/vendor-scorecard/a/docket', {
      params: { window: 90 },
    });
    expect(await within(sheet).findByTestId('docket-tally-credits')).toHaveAttribute('aria-pressed', 'true');
  });

  it('draws no table for an empty book', async () => {
    api.get.mockResolvedValue({
      data: { window: card().window, vendors: [], alerting },
    });
    renderIt();
    expect(await screen.findByTestId('rc-empty')).toHaveTextContent('no table is drawn');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says a failed read in words and claims no vendor', async () => {
    api.get.mockRejectedValue({
      response: {
        data: { message: 'The vendor book could not be read (57014).' },
      },
    });
    renderIt();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The vendor book could not be read (57014). That is a failed read, not a table of clean vendors',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
