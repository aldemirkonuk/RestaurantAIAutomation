/**
 * The Currency register — the field an EXISTING house did not have.
 *
 * PRE-FIX PROOF, MEASURED (2026-09-05, in `/Users/aldemirkonuk/Projects/wt-p4`)
 * ---------------------------------------------------------------------------
 *   git show HEAD:apps/web/src/pages/settings/next/st-format.ts \
 *     | grep -c "'currency'"                            ->  0
 *   git show HEAD:apps/web/src/pages/settings/next/useSettingsNextData.ts \
 *     | grep -c "settings/currency"                     ->  0
 *   git show HEAD:apps/web/src/pages/Settings.tsx | grep -ci currency
 *                                                       ->  0
 *
 * There was no register, no endpoint call, and no line on the legacy page. A
 * house holding NULL — eleven of the fourteen in production, after the founder's
 * Q30 correction — printed "currency not recorded" against every money figure
 * (`fmtMoney`, `apps/web/src/lib/mudavym/format.ts:85`) with nothing anywhere
 * that could change it. These tests pin the way out, and the honesty states
 * around it.
 *
 * The component is rendered directly rather than through `SettingsNext`: what
 * is under test is the register's own contract, and the page's mounting of it
 * is asserted in `SettingsNext.test.tsx`.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CurrencySection } from './CurrencySection';
import type { SettingsNextData } from './useSettingsNextData';

function remote(data: unknown, status = 'ok') {
  return {
    status,
    data,
    error: status === 'error' ? 'gateway unreachable' : null,
    reload: vi.fn(),
    set: vi.fn(),
  };
}

function reg(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    code: null,
    country: 'Türkiye',
    readable: true,
    reason: null,
    statedAt: null,
    statedBy: null,
    ...over,
  };
}

function mount(over: Record<string, unknown> = {}) {
  const saveCurrency = vi.fn(() => Promise.resolve(true));
  const data = {
    canManage: true,
    saveCurrency,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseCurrency: remote(reg()),
    ...over,
  } as unknown as SettingsNextData;
  const view = render(<CurrencySection data={data} />);
  return { view, saveCurrency };
}

describe('the Currency register — what it says', () => {
  it('a house with NO code says so in the words every money figure uses', () => {
    mount();
    expect(screen.getByText('currency not recorded')).toBeInTheDocument();
    expect(screen.getByText(/prints the number and says the currency is not recorded/i)).toBeInTheDocument();
    // Not a dollar sign anywhere. A currency mark is a claim about the amount.
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('a recorded code is named, with the date it was STATED — not the row’s updated_at', () => {
    const stated = new Date(Date.now() - 3 * 86_400_000).toISOString();
    mount({
      houseCurrency: remote(
        reg({ code: 'TRY', statedAt: stated, statedBy: { userId: 'u1', name: 'Aldemir' } }),
      ),
    });
    // Scoped to the sentence, not the <select>: the option list names every
    // code, and matching it would pass on a page that printed nothing at all.
    expect(
      screen.getByText(/Every total on this house/).textContent,
    ).toContain('TRY - Turkish lira');
    expect(screen.getByText(/stated · 3 days ago/i)).toBeInTheDocument();
    expect(screen.getByText(/stated by · Aldemir/i)).toBeInTheDocument();
  });

  it('no trail is an em dash naming why, never a substituted date', () => {
    mount({ houseCurrency: remote(reg({ code: 'GBP' })) });
    expect(
      screen.getByText(/no change to it has been recorded here/i),
    ).toBeInTheDocument();
  });

  it('a FAILED read says so, and is not the same sentence as an unanswered question', () => {
    mount({
      houseCurrency: remote(reg({ readable: false, reason: 'connection reset', country: null })),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read — connection reset/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/not the same as a house that has not been asked/i);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('a refused register says it was refused rather than showing an empty one', () => {
    mount({ houseCurrency: remote(null, 'denied') });
    expect(screen.getByText(/may not read the currency register/i)).toBeInTheDocument();
  });
});

describe('the Currency register — what it writes', () => {
  it('OFFERS the country’s default and states it, but writes NOTHING until Record', () => {
    const { saveCurrency } = mount();
    expect(screen.getByRole('combobox')).toHaveValue('TRY');
    expect(
      screen.getByText(/Defaulted from Türkiye\. Record will write TRY\./),
    ).toBeInTheDocument();
    // The whole defect this register exists to remove: a default that saves
    // itself. Rendering the page must write nothing at all.
    expect(saveCurrency).not.toHaveBeenCalled();
  });

  it('Record sends exactly the code shown, once a person has accepted it', () => {
    const { saveCurrency } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(saveCurrency).toHaveBeenCalledWith('TRY');
  });

  it('a person may choose any code in the list, not only the default', () => {
    const { saveCurrency } = mount();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'GBP' } });
    expect(screen.getByText(/Record will write GBP\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(saveCurrency).toHaveBeenCalledWith('GBP');
  });

  it('Record is inert while nothing has changed — re-recording the same code is not a change', () => {
    const { saveCurrency } = mount({ houseCurrency: remote(reg({ code: 'TRY' })) });
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
    expect(saveCurrency).not.toHaveBeenCalled();
  });

  it('a country with no default in the table offers nothing and says nothing is recorded', () => {
    // `lib/countries.ts` deliberately does not cover every country. A country
    // it has no currency for gets NO default, which is the honest outcome.
    mount({ houseCurrency: remote(reg({ country: 'Bahamas' })) });
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByText(/Nothing is recorded yet\./)).toBeInTheDocument();
  });

  it('a non-manager sees the rule, legible and disabled, and cannot Record', () => {
    const { saveCurrency } = mount({ canManage: false });
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
    expect(
      screen.getByText(/Only managers and owners can state the currency this restaurant reports in/),
    ).toBeInTheDocument();
    expect(saveCurrency).not.toHaveBeenCalled();
  });

  it('a failed write is rendered, not swallowed, and claims nothing was recorded', () => {
    mount({
      writer: { busy: null, failed: { key: 'currency', message: 'Only managers and owners can state the currency this restaurant reports in' }, run: vi.fn(), clear: vi.fn() },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/That did not go through/);
    expect(screen.getByRole('alert')).toHaveTextContent(/the code on the row is unchanged/);
  });

  it('a write whose AUDIT row failed says so — the change landed, the paper did not', () => {
    mount({
      houseCurrency: remote(
        reg({ code: 'TRY', audited: false, auditReason: 'system_audit_log is unreachable' }),
      ),
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      /recorded, but the change was not written to the trail — system_audit_log is unreachable/,
    );
  });
});
