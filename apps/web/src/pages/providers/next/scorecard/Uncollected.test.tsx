/**
 * Lines the house has not started collecting read once, not five times (N-19).
 * A line that was scored, was too few or failed to read keeps its own place.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { card, measure } from './scorecard-fixtures';
import type { MeasureKey } from './scorecard-types';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../../contexts/AuthContext', () => ({ useAuth: () => ({ activeRestaurantId: 'house-1' }) }));

import { LedgerCard } from './LedgerCard';
import { RollCall } from './RollCall';

const KEYS: Array<[MeasureKey, string]> = [
  ['onTime', 'On time'], ['linesAsOrdered', 'Lines as ordered'], ['priceAsAgreed', 'Price as agreed'],
  ['replyTime', 'Reply time'], ['credits', 'Credits'],
];
const nc = (key: MeasureKey, label: string) =>
  measure({ key, label, outcome: 'not_collected', sample: 0, hits: null, value: null, percent: null, rows: 0, sentence: `${label}: not collected.` });

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => api.get.mockReset());

describe('the ledger card', () => {
  it('says "Not collected yet" once and names the lines, keeping the scored line', async () => {
    const c = card();
    c.measures = [measure({ key: 'onTime', label: 'On time' }), ...KEYS.slice(1).map(([k, l]) => nc(k, l))];
    api.get.mockResolvedValue({ data: c });
    wrap(<LedgerCard providerId="p1" providerName="Skurnik" />);
    const one = await screen.findByTestId('ledger-uncollected');
    expect(one).toHaveTextContent('Not collected yet');
    expect(one).toHaveTextContent('Lines as ordered · Price as agreed · Reply time · Credits');
    expect(screen.getByTestId('ledger-line-onTime')).toBeInTheDocument();
    expect(screen.queryByTestId('ledger-line-credits')).toBeNull();
    expect(screen.getByTestId('share-bar')).toBeInTheDocument();
  });
  it('leaves a lone not-collected line in place, with its own sentence', async () => {
    const c = card();
    c.measures = [measure({ key: 'onTime', label: 'On time' }), nc('credits', 'Credits')];
    api.get.mockResolvedValue({ data: c });
    wrap(<LedgerCard providerId="p1" providerName="Skurnik" />);
    expect(await screen.findByTestId('ledger-line-credits')).toHaveTextContent('Credits: not collected.');
    expect(screen.queryByTestId('ledger-uncollected')).toBeNull();
  });
});

describe('the Roll Call', () => {
  const alerting = { built: false as const, sentence: 'No alert is sent.' };
  it('a vendor with nothing collected is one cell, not five', async () => {
    const empty = card({ providerId: 'a', providerName: 'Skurnik' });
    empty.measures = KEYS.map(([k, l]) => nc(k, l));
    api.get.mockResolvedValue({ data: { window: card().window, house: card().house, vendors: [empty], alerting } });
    wrap(<RollCall />);
    expect(await screen.findByTestId('rc-uncollected-a')).toHaveTextContent('Not collected yet');
    expect(screen.queryByTestId('rc-cell-a-onTime')).toBeNull();
  });
  it('a vendor with any figure keeps every cell', async () => {
    const mixed = card({ providerId: 'b', providerName: 'Winebow' });
    mixed.measures = [measure({ key: 'onTime', label: 'On time' }), ...KEYS.slice(1).map(([k, l]) => nc(k, l))];
    api.get.mockResolvedValue({ data: { window: card().window, house: card().house, vendors: [mixed], alerting } });
    wrap(<RollCall />);
    expect(await screen.findByTestId('rc-cell-b-onTime')).toBeInTheDocument();
    expect(screen.getByTestId('rc-cell-b-credits')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-uncollected-b')).toBeNull();
  });
});
