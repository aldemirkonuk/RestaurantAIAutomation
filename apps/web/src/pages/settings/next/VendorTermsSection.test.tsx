/**
 * F-1136 (sim 39, 2026-10-10): with no currency recorded, Vendor terms told the
 * owner to set it "on the sign-up form or ask us", while the Currency row on
 * the same page records it. The line now points at that row.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VendorTermsSection } from './VendorTermsSection';
import type { SettingsNextData } from './useSettingsNextData';

vi.mock('@/hooks/useHouseGroupMark', () => ({ useHouseGroupMark: () => null }));

function mount(code: string | null, vendors: unknown[] = []) {
  const ok = { readable: true, reason: null };
  const data = {
    canManage: true,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    vendorTerms: {
      status: 'ok',
      error: null,
      reload: vi.fn(),
      set: vi.fn(),
      data: {
        restaurantId: 'r1',
        vendors,
        currency: { code, isColumnDefault: false },
        zone: { zone: 'Europe/Istanbul', isColumnDefault: false },
        windowDays: 90,
        sources: { providers: ok, statedTerms: ok, orders: ok },
      },
    },
  } as unknown as SettingsNextData;
  render(<VendorTermsSection data={data} />);
}

describe('Vendor terms with no currency recorded (F-1136)', () => {
  it('points to the Currency row on this page, not to sign-up or to us', () => {
    mount(null);
    expect(screen.queryByText(/sign-up form/i)).toBeNull();
    expect(screen.queryByText(/ask us/i)).toBeNull();
    const link = screen.getByRole('link', { name: 'Currency' });
    expect(link.getAttribute('href')).toBe('#st-section-currency');
  });

  it('says nothing about it once a currency is recorded', () => {
    mount('TRY');
    expect(screen.queryByRole('link', { name: 'Currency' })).toBeNull();
  });
});

/**
 * F-1342 (sibling of the vendor sheet's fix): a French importer billing in EUR
 * read "≤ ₺380" here, the house's money. The minimum is in the vendor's
 * currency, the one this house's orders to them were placed in.
 */
describe('a vendor minimum is in the vendor\'s currency (F-1342)', () => {
  const unknown = { value: null, source: 'unknown' };
  const vendor = (minimumCurrency: string | null) => ({
    providerId: 'p1',
    providerName: 'Maison Lyon',
    ordersInWindow: 3,
    lastOrderedAt: null,
    deliveryWeekdays: unknown,
    orderCutoff: unknown,
    minimumOrder: { value: 380, source: 'inferred', n: 3, basis: 'smallest order' },
    minimumCurrency,
    leadTimeDays: unknown,
    paymentTerms: unknown,
    notes: null,
    statedBy: null,
    statedAt: null,
  });

  it('[REVERT-FAILS] prints the minimum and the editor label in EUR in a TRY house', () => {
    mount('TRY', [vendor('EUR')]);
    const cell = screen.getByText(/^≤ /);
    expect(cell.textContent).toMatch(/€|EUR/);
    expect(cell.textContent).not.toMatch(/₺|TRY/);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByText('Minimum order (EUR)')).toBeInTheDocument();
  });

  it('[REVERT-FAILS] says the currency is not stated when the orders name none', () => {
    mount('TRY', [vendor(null)]);
    expect(screen.getByText(/^≤ /).textContent).toMatch(/currency not stated/);
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByText('Minimum order (currency not stated)')).toBeInTheDocument();
  });
});
