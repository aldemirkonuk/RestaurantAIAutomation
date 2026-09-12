/**
 * The legacy /settings Currency line.
 *
 * PRE-FIX PROOF, MEASURED (2026-09-05, in `/Users/aldemirkonuk/Projects/wt-p4`)
 * ---------------------------------------------------------------------------
 *   git show HEAD:apps/web/src/pages/Settings.tsx | grep -ci currency   ->  0
 *
 * The legacy page had no currency field of any kind, and neither did the
 * rebuilt one. A house holding NULL — eleven of the fourteen in production
 * after the founder's Q30 correction — printed "currency not recorded" against
 * every money figure (`formatCurrency`, `apps/web/src/lib/utils.ts`) with
 * nothing anywhere that could change it.
 *
 * `mudavym_design_settings` is a flag, so the legacy page is what a house
 * without it still opens. The field has to exist on both, and both have to obey
 * the same three rules: the default is OFFERED and stated before it is written,
 * only Record writes, and a failed read is never rendered as an unanswered
 * question.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

const auth = vi.hoisted(() => ({
  current: { activeRestaurantId: 'r1', activeRole: 'owner', user: { role: 'owner' } } as Record<string, unknown>,
}));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ReportingCurrencySection } from '../Settings';

function readout(over: Record<string, unknown> = {}) {
  return {
    data: {
      restaurantId: 'r1',
      code: null,
      country: 'Türkiye',
      readable: true,
      reason: null,
      statedAt: null,
      statedBy: null,
      ...over,
    },
  };
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  auth.current = { activeRestaurantId: 'r1', activeRole: 'owner', user: { role: 'owner' } };
});

describe('legacy /settings — the Currency line', () => {
  it('a house with NO code says so, in the words every money figure uses', async () => {
    api.get.mockResolvedValue(readout());
    render(<ReportingCurrencySection />);
    expect(await screen.findByText('currency not recorded')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/settings/currency');
  });

  it('offers the country default, states it, and writes NOTHING until Record', async () => {
    api.get.mockResolvedValue(readout());
    render(<ReportingCurrencySection />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('TRY'));
    expect(
      screen.getByText(/Defaulted from Türkiye\. Record will write TRY\./),
    ).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('Record sends exactly the code shown', async () => {
    api.get.mockResolvedValue(readout());
    api.put.mockResolvedValue(readout({ code: 'TRY' }));
    render(<ReportingCurrencySection />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('TRY'));
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/currency', { code: 'TRY' }),
    );
  });

  it('a person may choose any ISO code, not only the offered default', async () => {
    api.get.mockResolvedValue(readout());
    api.put.mockResolvedValue(readout({ code: 'GBP' }));
    render(<ReportingCurrencySection />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('TRY'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GBP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/currency', { code: 'GBP' }),
    );
  });

  it('a recorded code is named, and Record is inert until it changes', async () => {
    api.get.mockResolvedValue(readout({ code: 'GBP', country: 'United Kingdom' }));
    render(<ReportingCurrencySection />);
    // Scoped to the sentence, not the <select>: the option list names every
    // code, so matching it would pass on a page that printed nothing at all.
    expect((await screen.findByText(/Recorded:/)).textContent).toContain('GBP - Pound sterling');
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });

  it('a FAILED read says so rather than showing an unanswered question', async () => {
    api.get.mockRejectedValue({ message: 'gateway unreachable' });
    render(<ReportingCurrencySection />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be read — gateway unreachable/);
    expect(alert).toHaveTextContent(/not the same as a restaurant that has not been asked/);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('`readable: false` on a 200 is the same refusal to guess', async () => {
    api.get.mockResolvedValue(readout({ readable: false, reason: 'connection reset' }));
    render(<ReportingCurrencySection />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/connection reset/);
  });

  it('staff sees the rule, disabled, and cannot Record', async () => {
    auth.current = { activeRestaurantId: 'r1', activeRole: 'staff', user: { role: 'staff' } };
    api.get.mockResolvedValue(readout());
    render(<ReportingCurrencySection />);
    await waitFor(() => expect(screen.getByRole('combobox')).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
    expect(
      screen.getByText(/Only managers and owners can state the currency this restaurant reports in/),
    ).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});
