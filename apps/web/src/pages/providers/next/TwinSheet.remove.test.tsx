/**
 * The vendor sheet carries "Remove vendor" and closes once the vendor is gone
 * (r27). Every other section is stubbed: this pins the wiring only.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ deleteProvider: vi.fn() }));
const toast = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock('../../../services/api/providers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  deleteProvider: (...a: unknown[]) => api.deleteProvider(...a),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRole: 'owner', user: { role: 'owner' }, activeRestaurantId: 'house-1' }),
}));
vi.mock('../../../stores', () => ({ useNotificationStore: () => toast }));
vi.mock('../../../components/providers/ProviderIntelligencePanel', () => ({
  ProviderIntelligencePanel: () => <div />,
}));
vi.mock('./VendorRecordEdit', () => ({ VendorRecordEdit: () => <div />, businessTypeLabel: () => 'Vendor' }));
vi.mock('./UsualCurrencySection', () => ({ UsualCurrencySection: () => <div /> }));
vi.mock('./TermsSection', () => ({ TermsSection: () => <div /> }));
vi.mock('./ContactsSection', () => ({ ContactsSection: () => <div /> }));
vi.mock('./BranchesSection', () => ({ BranchesSection: () => <div /> }));
vi.mock('./scorecard/LedgerCard', () => ({ LedgerCard: () => <div /> }));
vi.mock('./scorecard/MailTone', () => ({ MailTone: () => <div /> }));

import { TwinSheet } from './TwinSheet';

describe('TwinSheet — remove', () => {
  it('removing the vendor from its sheet closes the sheet', async () => {
    api.deleteProvider.mockResolvedValue({
      success: true,
      standingOrdersPaused: 0,
      schedulesPaused: 0,
      openOrders: 0,
      message: 'The vendor was removed. No new order can be placed with them.',
    });
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TwinSheet provider={{ id: 'prov-9', name: 'Kavaklıdere' } as never} onClose={onClose} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByTestId('vendor-remove'));
    fireEvent.click(screen.getByTestId('vendor-remove-confirm'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.deleteProvider).toHaveBeenCalledWith('prov-9');
  });
});
