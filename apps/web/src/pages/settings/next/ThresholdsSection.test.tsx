/**
 * F-419 (sim wave 9, 2026-10-09): a manager could switch off, raise or re-role
 * the rule that names an owner as the signer. The gateway now refuses that
 * write; the page disables the controls for a manager on such a rule and says
 * who can change it, rather than offering a press the server will refuse.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThresholdsSection } from './ThresholdsSection';
import type { SettingsNextData } from './useSettingsNextData';

function register(requiredRole: 'owner' | 'manager') {
  return {
    readable: true,
    reason: null,
    policyEmpty: false,
    enforcement: { enforcedBy: ['procurement.service.ts approveOrder'], note: '', wouldBeEnforcedAt: '' },
    thresholds: [
      {
        rule: 'manager_ceiling',
        enabled: true,
        amountLimit: 2500,
        percentLimit: null,
        requiredRole,
        setBy: null,
        updatedAt: '2026-10-01T10:00:00Z',
      },
    ],
    retrospective: { readable: true, reason: null, counts: [], ordersRead: 0, windowDays: 90, caveat: '' },
  };
}

function mount(opts: { isOwner: boolean; requiredRole: 'owner' | 'manager' }) {
  const data = {
    canManage: true,
    isOwner: opts.isOwner,
    saveThreshold: vi.fn(),
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    thresholds: { status: 'ok', data: register(opts.requiredRole), error: null, reload: vi.fn(), set: vi.fn() },
    // F-057 reads the house currency for the ceiling's mark; not answered here.
    houseCurrency: { status: 'loading', data: null, error: null, reload: vi.fn() },
  } as unknown as SettingsNextData;
  render(<ThresholdsSection data={data} />);
}

const OWNER_ONLY = /only an owner can change this rule or switch it off/i;
const toggle = () => screen.getByRole('switch', { name: /a manager may seal an order up to/i });

describe('the owner-signature ceiling on the page', () => {
  it('a MANAGER cannot switch off a rule an owner signs, and is told who can', () => {
    mount({ isOwner: false, requiredRole: 'owner' });
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(OWNER_ONLY)).toBeTruthy();
  });

  it('an OWNER can', () => {
    mount({ isOwner: true, requiredRole: 'owner' });
    expect((toggle() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(OWNER_ONLY)).toBeNull();
  });

  it('a MANAGER can still change a rule a manager signs', () => {
    mount({ isOwner: false, requiredRole: 'manager' });
    expect((toggle() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(OWNER_ONLY)).toBeNull();
  });
});
