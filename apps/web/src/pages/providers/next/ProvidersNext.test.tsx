/**
 * ProvidersNext render contract — the MERGE verdict's structural promises:
 * small closed cards (three real facts), the twin held back for the sheet,
 * and the honesty rules (EM for an unanswered orders book, plain words for
 * an unreachable gateway).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Provider } from '../../../services/api/providers';

const mockData = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('./useProvidersNextData', () => ({
  useProvidersNextData: () => mockData.current,
}));

vi.mock('../../../components/providers/ProviderIntelligencePanel', () => ({
  ProviderIntelligencePanel: ({ providerName }: { providerName: string }) => (
    <div data-testid="twin-panel">twin of {providerName}</div>
  ),
}));

// The sheet now carries the terms register; this file is about the GRID and the
// sheet's shape, so the terms hook is stubbed here and asserted in
// TermsSection.test.tsx against a mocked apiClient.
vi.mock('./useProviderTerms', () => ({
  useProviderTerms: () => ({
    register: null,
    row: null,
    loading: true,
    error: null,
    denied: false,
    saving: false,
    saveError: null,
    audited: null,
    auditReason: null,
    save: vi.fn(),
    reload: vi.fn(),
  }),
}));

import ProvidersNext from './ProvidersNext';

function provider(over: Partial<Provider>): Provider {
  return {
    id: 'p1',
    name: 'Bodega Álvaro',
    primaryBusinessType: 'Distributor',
    winePortfolio: '',
    phone: '',
    email: 'orders@alvaro.example',
    physicalAddress: '',
    website: '',
    restaurantId: 'r1',
    ...over,
  };
}

const base = {
  hasData: true,
  isError: false,
  errorMessage: '',
  ordersKnown: true,
  refetch: vi.fn(),
};

beforeEach(() => {
  mockData.current = { ...base, cards: [] };
});

describe('ProvidersNext', () => {
  it('renders a bucket card with its three facts and keeps the twin off the grid', () => {
    mockData.current = {
      ...base,
      cards: [
        {
          provider: provider({}),
          openOrders: 3,
          leadTimeDays: 2,
          lastContact: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        },
      ],
    };
    render(<ProvidersNext />);
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2 days')).toBeInTheDocument();
    expect(screen.getByText('contacted 2 days ago')).toBeInTheDocument();
    // the twin is not fetched or rendered until the sheet opens
    expect(screen.queryByTestId('twin-panel')).not.toBeInTheDocument();
  });

  it('opens the TwinSheet on card click and closes on Escape', async () => {
    mockData.current = {
      ...base,
      cards: [{ provider: provider({}), openOrders: 0, leadTimeDays: null, lastContact: null }],
    };
    render(<ProvidersNext />);
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    expect(await screen.findByTestId('twin-panel')).toHaveTextContent('twin of Bodega Álvaro');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows em dashes, not zeros, while the orders book is unanswered', () => {
    mockData.current = {
      ...base,
      ordersKnown: false,
      cards: [{ provider: provider({}), openOrders: null, leadTimeDays: null, lastContact: null }],
    };
    render(<ProvidersNext />);
    expect(screen.getByText(/orders book hasn’t answered/)).toBeInTheDocument();
    // the open-orders fact renders EM, and absent lead time is EM too
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('never contacted')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('says a gateway failure in words with a retry', () => {
    mockData.current = { ...base, hasData: false, isError: true, errorMessage: 'boom', cards: [] };
    render(<ProvidersNext />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not be reached');
    fireEvent.click(screen.getByText('Try again'));
    expect(base.refetch).toHaveBeenCalled();
  });

  it('admits an empty roster plainly', () => {
    render(<ProvidersNext />);
    expect(screen.getByText(/open and empty/)).toBeInTheDocument();
  });
});
