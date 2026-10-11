/**
 * F-1136 (sim 39, 2026-10-10): with no currency recorded, Vendor terms told the
 * owner to set it "on the sign-up form or ask us", while the Currency row on
 * the same page records it. The line now points at that row.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VendorTermsSection } from './VendorTermsSection';
import type { SettingsNextData } from './useSettingsNextData';

vi.mock('@/hooks/useHouseGroupMark', () => ({ useHouseGroupMark: () => null }));

function mount(code: string | null) {
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
        vendors: [],
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
