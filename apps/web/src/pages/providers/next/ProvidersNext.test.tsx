/**
 * ProvidersNext render contract — the MERGE verdict's structural promises:
 * small closed cards (three real facts), the twin held back for the sheet,
 * and the honesty rules (EM for an unanswered orders book, plain words for
 * an unreachable gateway).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

// The sheet also carries the vendor's usual currency (B1, founder 2026-09-06
// batch 65), which reads the session's role. This file is about the GRID and the
// sheet's shape; that section is asserted in UsualCurrencySection.test.tsx
// against a mocked apiClient and a mocked role.
// The double prints the ONE prop this file is about — whether the sheet was
// opened from the currency prompt and must therefore put the person at the
// field. The section's own scroll-and-focus behaviour is asserted in
// UsualCurrencySection.test.tsx, where the control actually renders.
vi.mock('./UsualCurrencySection', () => ({
  UsualCurrencySection: ({ takeFocus }: { takeFocus?: boolean }) => (
    <div data-testid="usual-currency-takefocus">{String(Boolean(takeFocus))}</div>
  ),
}));

// The grid also carries the batch-66 prompt panel, which reads its own count
// from the gateway. This file is about the GRID; the panel's three states are
// asserted in UsualCurrencyCoveragePanel.test.tsx against a mocked apiClient.
// The double keeps its two props visible so a rename cannot pass silently, and
// exposes the open-a-vendor callback the panel's links use.
vi.mock('./UsualCurrencyCoveragePanel', () => ({
  UsualCurrencyCoveragePanel: ({
    knownIds,
    onOpenVendor,
  }: {
    knownIds: Set<string>;
    onOpenVendor: (id: string) => void;
  }) => (
    <button type="button" data-testid="coverage-stub" onClick={() => onOpenVendor('p1')}>
      {`coverage over ${knownIds.size}`}
    </button>
  ),
}));

// Same reason as the terms double above, one section down: the sheet also
// carries the contacts register (ADR 0121 P0 item 2). Its own behaviour is
// asserted in ContactsSection.test.tsx against a mocked apiClient.
vi.mock('./useProviderContacts', async () => {
  const actual = await vi.importActual<typeof import('./useProviderContacts')>(
    './useProviderContacts',
  );
  return {
    ...actual,
    useProviderContacts: () => ({
      contacts: null,
      loading: true,
      error: null,
      saving: null,
      saveError: null,
      setPhoneType: vi.fn(),
      reload: vi.fn(),
    }),
  };
});

// The scorecard (ADR 0207): the grid reads each card's one fact from the Roll
// Call answer, the second view is the Roll Call, and the sheet carries the
// ledger card. Their own behaviour is asserted in scorecard/*.test.tsx against
// a mocked apiClient; here the doubles keep the props this file is about —
// the fact on the card, the view switch, the section in the sheet — visible.
const roll = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('./scorecard/useVendorScorecard', () => ({
  useRollCall: () => roll.current,
}));
vi.mock('./scorecard/RollCall', () => ({
  RollCall: () => <div data-testid="roll-call-stub">roll call</div>,
}));
vi.mock('./scorecard/LedgerCard', () => ({
  LedgerCard: ({ providerName }: { providerName: string }) => (
    <div data-testid="ledger-stub">ledger of {providerName}</div>
  ),
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
  roll.current = { data: undefined, isError: false };
  // Each test states its own URL; without the reset a `?vendor=` from one test
  // would open a sheet in the next and the failure would look like a leak in
  // the component rather than in this file.
  window.history.replaceState({}, '', '/providers');
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

  it('opens a vendor’s sheet from the currency prompt panel’s link', async () => {
    // The panel names vendors that have stated no usual currency; its links must
    // land on the profile section where somebody can state one, or the prompt is
    // a nag with nowhere to go.
    mockData.current = {
      ...base,
      cards: [{ provider: provider({}), openOrders: 0, leadTimeDays: null, lastContact: null }],
    };
    render(<ProvidersNext />);
    expect(screen.getByTestId('coverage-stub')).toHaveTextContent('coverage over 1');
    fireEvent.click(screen.getByTestId('coverage-stub'));
    expect(await screen.findByTestId('twin-panel')).toHaveTextContent('twin of Bodega Álvaro');
    expect(screen.getByTestId('usual-currency-takefocus')).toHaveTextContent('true');
  });

  /*
   * `?vendor=<id>` — the link the ORDER SHEET's empty currency field carries.
   * Until these two tests, the URL-reading half of that path had no coverage:
   * the panel's callback was exercised, `vendorFromUrl` never was, so a rename
   * or a bad param name would have shipped green (Sonnet audit of 795d9c27,
   * finding 8).
   */
  it('opens the asked-for vendor’s sheet when the page is reached by ?vendor=', async () => {
    window.history.replaceState({}, '', '/providers?vendor=p1');
    mockData.current = {
      ...base,
      cards: [{ provider: provider({}), openOrders: 0, leadTimeDays: null, lastContact: null }],
    };
    render(<ProvidersNext />);
    expect(await screen.findByTestId('twin-panel')).toHaveTextContent('twin of Bodega Álvaro');
    // and it arrives AT the field, not at the top of the sheet
    expect(screen.getByTestId('usual-currency-takefocus')).toHaveTextContent('true');
  });

  it('honours ?vendor= once — a later render does not reopen the closed sheet', async () => {
    window.history.replaceState({}, '', '/providers?vendor=p1');
    mockData.current = {
      ...base,
      cards: [{ provider: provider({}), openOrders: 0, leadTimeDays: null, lastContact: null }],
    };
    const { rerender } = render(<ProvidersNext />);
    await screen.findByTestId('twin-panel');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // The param is still in the URL. Without the latch this render reopens the
    // sheet and the reader cannot close it at all.
    rerender(<ProvidersNext />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves a card-opened sheet where it always opened', async () => {
    // The focus jump belongs to the currency prompt, not to browsing.
    mockData.current = {
      ...base,
      cards: [{ provider: provider({}), openOrders: 0, leadTimeDays: null, lastContact: null }],
    };
    render(<ProvidersNext />);
    fireEvent.click(screen.getByText('Bodega Álvaro'));
    await screen.findByTestId('twin-panel');
    expect(screen.getByTestId('usual-currency-takefocus')).toHaveTextContent('false');
  });

  it('admits an empty roster plainly', () => {
    render(<ProvidersNext />);
    expect(screen.getByText(/open and empty/)).toBeInTheDocument();
  });

  describe('the scorecard (ADR 0207)', () => {
    const oneCard = () => ({
      ...base,
      cards: [{ provider: provider({}), openOrders: 0, leadTimeDays: null, lastContact: null }],
    });
    const rollOf = (fact: { text: string; outcome: string }) => ({
      isError: false,
      data: { vendors: [{ providerId: 'p1', fact }] },
    });

    it('puts one behavioural fact on the card, read from the Roll Call', () => {
      mockData.current = oneCard();
      roll.current = rollOf({ text: '86% on time · 12 of 14', outcome: 'answered' });
      render(<ProvidersNext />);
      const did = screen.getByTestId('pv-card-did');
      expect(did).toHaveTextContent('Did · 90 d86% on time · 12 of 14');
      expect(within(did).getByText('86% on time · 12 of 14')).toHaveStyle({ fontStyle: 'normal' });
    });

    it('prints a refusal on the card in italic words, never a zero', () => {
      mockData.current = oneCard();
      roll.current = rollOf({ text: '2 orders — too few to score', outcome: 'too_few' });
      render(<ProvidersNext />);
      const fact = within(screen.getByTestId('pv-card-did')).getByText('2 orders — too few to score');
      expect(fact).toHaveStyle({ fontStyle: 'italic' });
    });

    it('draws an em dash while the fact is read, and words when the read failed', () => {
      mockData.current = oneCard();
      const { rerender } = render(<ProvidersNext />);
      expect(screen.getByTestId('pv-card-did')).toHaveTextContent('Did · 90 d—');
      roll.current = { data: undefined, isError: true };
      rerender(<ProvidersNext />);
      expect(screen.getByTestId('pv-card-did')).toHaveTextContent('could not be read');
    });

    it('draws the dash, not a failure, for a vendor the Roll Call answer does not hold yet', () => {
      mockData.current = oneCard();
      roll.current = { isError: false, data: { vendors: [] } };
      render(<ProvidersNext />);
      const did = screen.getByTestId('pv-card-did');
      expect(did).toHaveTextContent('Did · 90 d—');
      expect(did).not.toHaveTextContent('could not be read');
    });

    it('switches to the Roll Call and writes ?view=scorecard, keeping the Book one press away', () => {
      mockData.current = oneCard();
      render(<ProvidersNext />);
      expect(screen.queryByTestId('roll-call-stub')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Scorecard' }));
      expect(screen.getByTestId('roll-call-stub')).toBeInTheDocument();
      expect(screen.queryByText('Bodega Álvaro')).not.toBeInTheDocument();
      expect(window.location.search).toBe('?view=scorecard');
      fireEvent.click(screen.getByRole('button', { name: 'Book' }));
      expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
      expect(window.location.search).toBe('');
    });

    it('opens on the Roll Call when reached by ?view=scorecard', () => {
      window.history.replaceState({}, '', '/providers?view=scorecard');
      mockData.current = oneCard();
      render(<ProvidersNext />);
      expect(screen.getByTestId('roll-call-stub')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Scorecard' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('carries the ledger card inside the vendor sheet', async () => {
      mockData.current = oneCard();
      render(<ProvidersNext />);
      fireEvent.click(screen.getByText('Bodega Álvaro'));
      expect(await screen.findByTestId('ledger-stub')).toHaveTextContent('ledger of Bodega Álvaro');
    });
  });
});
