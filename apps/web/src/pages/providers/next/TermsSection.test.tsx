/**
 * TermsSection render + write contract.
 *
 * The four things the founder's 2026-09-04 decision has to be true about:
 * terms READ on the vendor's own row through the existing route; a register
 * that cannot be read said in WORDS; a value indistinguishable from a column
 * default rendered as UNKNOWN rather than as a term; and a write that goes
 * through `PUT /vendor-terms/:providerId` — including its refusal for a
 * provider of another tenant, which the gateway answers with a 404
 * (vendor-terms.service.ts:784-805).
 *
 * `apiClient` is mocked, so these assert what this component does with the
 * gateway's answers, never that the gateway gives them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fmtMoney } from '@/lib/mudavym/format';
import type {
  TermCell,
  VendorTermsRegister,
  VendorTermsRow,
} from '../../settings/next/useSettingsNextData';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown error'),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));

import { TermsSection } from './TermsSection';

function cell<T>(over: Partial<TermCell<T>> & { source: TermCell<T>['source'] }): TermCell<T> {
  return { value: null, ...over } as TermCell<T>;
}

function row(over: Partial<VendorTermsRow> = {}): VendorTermsRow {
  return {
    providerId: 'p1',
    providerName: 'Bodega Álvaro',
    ordersInWindow: 12,
    lastOrderedAt: null,
    deliveryWeekdays: cell<number[]>({ value: [1, 4], source: 'stated' }),
    orderCutoff: cell({ value: { time: '14:00', offsetDays: 1 }, source: 'stated' }),
    minimumOrder: cell<number>({ value: 250, source: 'stated' }),
    leadTimeDays: cell<number>({ value: 3, source: 'stated' }),
    paymentTerms: cell<string>({ value: 'Net 30', source: 'stated' }),
    notes: null,
    statedBy: { userId: 'u1', name: 'Aslı' },
    statedAt: new Date(Date.now() - 3600_000).toISOString(),
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
      orders: { readable: true, reason: null, rows: 12 },
    },
    ...over,
  };
}

function mount() {
  return render(<TermsSection providerId="p1" providerName="Bodega Álvaro" />);
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
});

describe('TermsSection', () => {
  it('shows one vendor’s terms with the source under every one of them', async () => {
    api.get.mockResolvedValue({ data: register() });
    mount();
    expect(await screen.findByText('14:00, the day before')).toBeInTheDocument();
    expect(screen.getByText('Monday and Thursday')).toBeInTheDocument();
    // exactly the settings register's formatter, not a fork of it
expect(screen.getByText(fmtMoney(250, 'USD'))).toBeInTheDocument();
    expect(screen.getByText('3 days')).toBeInTheDocument();
    expect(screen.getByText('Net 30')).toBeInTheDocument();
    // provenance, not a bare number: five cells, five source lines
    expect(screen.getAllByText('stated by the house')).toHaveLength(5);
    expect(screen.getByText(/Last written down by Aslı/)).toBeInTheDocument();
    // it read the whole house register, so the link to it is offered
    expect(screen.getByText('Every vendor’s terms').closest('a')).toHaveAttribute(
      'href',
      '/settings?tab=vendor-terms',
    );
    expect(api.get).toHaveBeenCalledWith('/vendor-terms');
  });

  it('says an unreadable register in words, never as empty terms', async () => {
    api.get.mockRejectedValue(new Error('gateway timed out'));
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('could not be read');
    expect(alert).toHaveTextContent('gateway timed out');
    expect(alert).toHaveTextContent('not the same as this vendor having no terms');
    expect(screen.queryByText('Record what they said')).not.toBeInTheDocument();
  });

  it('names the unreadable book when the register itself came back partial', async () => {
    api.get.mockResolvedValue({
      data: register({
        sources: {
          providers: { readable: true, reason: null, rows: 1 },
          statedTerms: { readable: false, reason: 'relation does not exist', rows: null },
          orders: { readable: true, reason: null, rows: 12 },
        },
      }),
    });
    mount();
    expect(await screen.findByText(/book of stated terms could not be read/)).toHaveTextContent(
      'relation does not exist',
    );
  });

  it('renders a value indistinguishable from its column default as unknown, with the reason', async () => {
    api.get.mockResolvedValue({
      data: register({
        vendors: [
          row({
            leadTimeDays: cell<number>({
              source: 'unknown',
              reason: 'the vendor record carries 7, which is that column’s default — nobody may ever have been asked',
            }),
            paymentTerms: cell<string>({
              source: 'unknown',
              reason: 'the vendor record carries Net 30, which is that column’s default',
            }),
          }),
        ],
      }),
    });
    mount();
    await screen.findByText('14:00, the day before');
    expect(screen.getAllByText('unknown')).toHaveLength(2);
    expect(screen.getByText(/nobody may ever have been asked/)).toBeInTheDocument();
    // the default value itself is never printed as a term
    expect(screen.queryByText('7 days')).not.toBeInTheDocument();
    expect(screen.queryByText('Net 30')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('writes only what was touched, through PUT /vendor-terms/:providerId', async () => {
    api.get.mockResolvedValue({ data: register() });
    api.put.mockResolvedValue({
      data: {
        readout: register({ vendors: [row({ paymentTerms: cell<string>({ value: 'Net 14', source: 'stated' }) })] }),
        audited: true,
        auditReason: null,
      },
    });
    mount();
    fireEvent.click(await screen.findByText('Record what they said'));
    fireEvent.change(screen.getByPlaceholderText(/Net 30, prepaid/), {
      target: { value: 'Net 14' },
    });
    fireEvent.click(screen.getByText('Record what they said'));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put).toHaveBeenCalledWith('/vendor-terms/p1', { paymentTerms: 'Net 14' });
    // the server's readout replaces the register; nothing optimistic
    expect(await screen.findByText('Net 14')).toBeInTheDocument();
  });

  it('reports the gateway’s refusal for a vendor of another house', async () => {
    api.get.mockResolvedValue({ data: register() });
    api.put.mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } }),
    );
    mount();
    fireEvent.click(await screen.findByText('Record what they said'));
    fireEvent.change(screen.getByPlaceholderText(/Net 30, prepaid/), {
      target: { value: 'prepaid' },
    });
    fireEvent.click(screen.getByText('Record what they said'));
    expect(
      await screen.findByText(/not on this restaurant’s books, so nothing was recorded/),
    ).toBeInTheDocument();
    // the editor stays open with the typed value — nothing was silently dropped
    expect(screen.getByPlaceholderText(/Net 30, prepaid/)).toHaveValue('prepaid');
  });

  it('says a change whose audit row failed, rather than assuming the trail', async () => {
    api.get.mockResolvedValue({ data: register() });
    api.put.mockResolvedValue({
      data: { readout: register(), audited: false, auditReason: 'audit insert rejected' },
    });
    mount();
    fireEvent.click(await screen.findByText('Record what they said'));
    fireEvent.change(screen.getByPlaceholderText(/Net 30, prepaid/), { target: { value: 'prepaid' } });
    fireEvent.click(screen.getByText('Record what they said'));
    expect(await screen.findByText(/audit trail did not take the entry/)).toHaveTextContent(
      'audit insert rejected',
    );
  });

  it('admits a register that holds no row for this vendor', async () => {
    api.get.mockResolvedValue({ data: register({ vendors: [] }) });
    mount();
    expect(await screen.findByText(/holds no row for Bodega Álvaro/)).toBeInTheDocument();
  });
});
