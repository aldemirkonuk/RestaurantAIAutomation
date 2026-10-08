/**
 * VEN-W24 (founder, 2026-10-01, "One source"): the vendor sheet's top facts —
 * Lead time, Payment terms, Minimum order — show what the HOUSE recorded, and
 * the vendor's record only when the house has stated nothing, labelled.
 *
 * The sheet is rendered whole, with its unrelated sections stubbed, so these
 * assert the real wiring: one `/vendor-terms` read shared by the top and the
 * Terms section, and a save in Terms moving the top.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { fmtMoney } from '@/lib/mudavym/format';
import type { Provider } from '../../../services/api/providers';
import type {
  TermCell,
  VendorTermsRegister,
  VendorTermsRow,
} from '../../settings/next/useSettingsNextData';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', user: { role: 'staff' }, activeRole: 'staff' }),
}));
// Staff above keeps the mail-tone read out of this file; the Terms write is
// offered as for a manager, because this file proves the top/Terms join, not
// VEN-W30's role split (TermsSection.test.tsx covers that).
vi.mock('./useCanChangeVendors', () => ({ useCanChangeVendors: () => true }));
vi.mock('../../../components/mudavym/Sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./VendorRecordEdit', () => ({
  VendorRecordEdit: () => null,
  businessTypeLabel: (t: string) => t,
}));
vi.mock('./UsualCurrencySection', () => ({ UsualCurrencySection: () => null }));
vi.mock('./ContactsSection', () => ({ ContactsSection: () => null }));
vi.mock('./BranchesSection', () => ({ BranchesSection: () => null }));
vi.mock('./scorecard/LedgerCard', () => ({ LedgerCard: () => null }));
vi.mock('./scorecard/MailTone', () => ({ MailTone: () => null }));
vi.mock('./LearnedSection', () => ({ LearnedSection: () => null }));

import { TwinSheet } from './TwinSheet';

function cell<T>(over: Partial<TermCell<T>> & { source: TermCell<T>['source'] }): TermCell<T> {
  return { value: null, ...over } as TermCell<T>;
}

function row(over: Partial<VendorTermsRow> = {}): VendorTermsRow {
  return {
    providerId: 'p1',
    providerName: 'Bodega Álvaro',
    ordersInWindow: 0,
    lastOrderedAt: null,
    deliveryWeekdays: cell<number[]>({ source: 'unknown', reason: 'no orders' }),
    orderCutoff: cell({ source: 'unknown', reason: 'no orders' }),
    minimumOrder: cell<number>({ value: 1000, source: 'vendor_record', column: 'providers.minimum_order' }),
    leadTimeDays: cell<number>({ source: 'unknown', reason: 'no orders' }),
    paymentTerms: cell<string>({ source: 'unknown', reason: 'not inferable' }),
    notes: null,
    statedBy: null,
    statedAt: null,
    ...over,
  };
}

function register(over: Partial<VendorTermsRegister> = {}): VendorTermsRegister {
  return {
    restaurantId: 'r1',
    vendors: [row()],
    currency: { code: 'USD', isColumnDefault: false },
    zone: { zone: 'Europe/Istanbul', isColumnDefault: false },
    windowDays: 180,
    sources: {
      providers: { readable: true, reason: null, rows: 1 },
      statedTerms: { readable: true, reason: null, rows: 1 },
      orders: { readable: true, reason: null, rows: 0 },
    },
    ...over,
  } as VendorTermsRegister;
}

const provider = {
  id: 'p1',
  name: 'Bodega Álvaro',
  minimumOrder: 1000,
  leadTimeDays: 4,
  paymentTerms: 'Net 15',
} as unknown as Provider;

function fact(label: string): HTMLElement {
  // FactRow: label span, then value span, inside one row div.
  const lab = screen.getAllByText(label).find((el) => el.tagName === 'SPAN' && el.nextElementSibling)!;
  return lab.nextElementSibling as HTMLElement;
}

function mount() {
  return render(<TwinSheet provider={provider} onClose={() => {}} />);
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
});

describe('TwinSheet top facts — one source with Terms (VEN-W24)', () => {
  it('a stated term wins over the vendor record', async () => {
    api.get.mockResolvedValue({
      data: register({
        vendors: [
          row({
            paymentTerms: cell<string>({ value: 'Net 30', source: 'stated' }),
            leadTimeDays: cell<number>({ value: 2, source: 'stated' }),
            minimumOrder: cell<number>({ value: 250, source: 'stated' }),
          }),
        ],
      }),
    });
    mount();
    await waitFor(() => expect(fact('Payment terms')).toHaveTextContent(/^Net 30$/));
    expect(fact('Lead time')).toHaveTextContent(/^2 days$/);
    expect(fact('Minimum order')).toHaveTextContent(fmtMoney(250, 'USD'));
    expect(fact('Minimum order').textContent).not.toContain('record');
    // one read for the whole sheet — the top and Terms share it
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('shows the record value, marked as the vendor’s record, when the house stated nothing', async () => {
    api.get.mockResolvedValue({ data: register() });
    mount();
    await waitFor(() =>
      expect(fact('Minimum order')).toHaveTextContent(`${fmtMoney(1000, 'USD')} · from the vendor’s record`),
    );
    // the house's currency, never "(currency not recorded)" when it has one
    expect(fact('Minimum order').textContent).not.toContain('currency not recorded');
    expect(fact('Payment terms')).toHaveTextContent(/^—$/);
  });

  it('shows an inferred minimum the way Terms does — an upper bound, said to be inferred', async () => {
    api.get.mockResolvedValue({
      data: register({
        vendors: [row({ minimumOrder: cell<number>({ value: 300, source: 'inferred', n: 4, confidence: 'low' }) })],
      }),
    });
    mount();
    await waitFor(() =>
      expect(fact('Minimum order')).toHaveTextContent(`≤ ${fmtMoney(300, 'USD')} · inferred from this house’s orders`),
    );
  });

  it('says a failed terms read, never an em dash and never the record value', async () => {
    api.get.mockRejectedValue(new Error('gateway timed out'));
    mount();
    await waitFor(() => expect(fact('Payment terms')).toHaveTextContent('Could not be read'));
    expect(fact('Lead time')).toHaveTextContent('Could not be read');
    expect(fact('Minimum order')).toHaveTextContent('Could not be read');
    expect(fact('Payment terms').textContent).not.toContain('Net 15');
    expect(fact('Minimum order').textContent).not.toContain('1,000');
  });

  it('moves the top when Terms records what they said', async () => {
    api.get.mockResolvedValue({ data: register() });
    api.put.mockResolvedValue({
      data: {
        readout: register({
          vendors: [row({ paymentTerms: cell<string>({ value: 'Net 30', source: 'stated' }) })],
        }),
        audited: true,
      },
    });
    mount();
    await waitFor(() => expect(fact('Payment terms')).toHaveTextContent(/^—$/));
    fireEvent.click(screen.getByText('Record what they said'));
    fireEvent.change(screen.getByPlaceholderText(/Net 30, prepaid/), { target: { value: 'Net 30' } });
    const buttons = screen.getAllByText('Record what they said');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(fact('Payment terms')).toHaveTextContent(/^Net 30$/));
    expect(api.put).toHaveBeenCalledWith('/vendor-terms/p1', { paymentTerms: 'Net 30' });
    expect(api.get).toHaveBeenCalledTimes(1);
    // and Terms below says the same thing
    expect(within(screen.getByText('Terms').closest('section')!).getByText('Net 30')).toBeInTheDocument();
  });
});
