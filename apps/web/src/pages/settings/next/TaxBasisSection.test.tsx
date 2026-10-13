import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  TaxBasisSection,
  TaxBasisSetupLine,
  answerLabel,
  basisConsequence,
  readAnswer,
  readRateInputs,
  type TaxBasisReadout,
} from './TaxBasisSection';

/**
 * F-1537 / F-620, lane 2 (founder 2026-10-12, S218: F1 build it, F2 only from
 * now). The house says once whether its till prices include tax; the country
 * only suggests; the dashboard's setup line shows only while it is unanswered.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('@/services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => api.get(...a),
    put: (...a: unknown[]) => api.put(...a),
    post: (...a: unknown[]) => api.post(...a),
  },
}));

function readout(over: Partial<TaxBasisReadout> = {}): TaxBasisReadout {
  return {
    restaurantId: 'r1',
    readable: true,
    reason: null,
    basis: 'unset',
    answered: false,
    confirmedAt: null,
    confirmedBy: null,
    country: 'TR',
    taxWord: 'KDV',
    proposal: {
      basis: 'prices_include_tax',
      rates: [
        { label: 'Food and soft drinks', ratePct: 10 },
        { label: 'Alcohol', ratePct: 20 },
      ],
      why: 'Menus in Türkiye must show prices with KDV included.',
    },
    rates: [],
    ratesReason: null,
    today: '2026-10-12',
    todayOnHouseClock: true,
    ...over,
  };
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: readout() });
  api.put.mockReset();
  api.post.mockReset();
});

describe('the words', () => {
  it('says the answers in the house’s own word for the tax, TR and US', () => {
    expect(answerLabel('prices_include_tax', 'KDV')).toBe('Prices on your till include KDV');
    expect(answerLabel('prices_exclude_tax', 'sales tax')).toBe('Sales tax is added on top of your till’s prices');
    expect(answerLabel('not_vat_charging', 'KDV')).toBe('This house charges no KDV');
  });

  it('says an unset house reads as the till sends, and an answered one marks its switch date', () => {
    expect(basisConsequence({ basis: 'unset', taxWord: 'KDV', confirmedAt: null })).toMatch(/Not stated yet/);
    expect(
      basisConsequence({ basis: 'prices_include_tax', taxWord: 'KDV', confirmedAt: '2026-10-12T09:00:00Z', switchDay: '2026-10-12' }),
    ).toMatch(/from 2026-10-12.*Checks recorded before then stay as your till sent them/);
  });

  it('dates the switch on the house day ingest uses, never the UTC date of the moment (F-1585)', () => {
    // 01:30 on 13 Oct in Istanbul is 22:30Z on the 12th; checks of the 12th keep KDV.
    const said = basisConsequence({
      basis: 'prices_include_tax',
      taxWord: 'KDV',
      confirmedAt: '2026-10-12T22:30:00Z',
      switchDay: '2026-10-13',
    });
    expect(said).toMatch(/from 2026-10-13/);
    expect(said).not.toMatch(/2026-10-12/);
  });

  it('offers nothing to confirm until a choice is made, and not the answer already recorded', () => {
    expect(readAnswer(null, { basis: 'unset', taxWord: 'KDV' }).canConfirm).toBe(false);
    expect(readAnswer('prices_include_tax', { basis: 'prices_include_tax', taxWord: 'KDV' }).canConfirm).toBe(false);
    expect(readAnswer('prices_include_tax', { basis: 'unset', taxWord: 'KDV' }).canConfirm).toBe(true);
  });

  it("reads '%20', '20%' and '20,5' as percents, the ways a Turkish till writes them (F-1589)", () => {
    const pct = (raw: string) => readRateInputs('house', '', raw, '2026-10-12', 'KDV').body?.ratePct ?? null;
    expect(pct('%20')).toBe(20);
    expect(pct('% 20')).toBe(20);
    expect(pct('20%')).toBe(20);
    expect(pct('20,5')).toBe(20.5);
    expect(pct('%%20')).toBeNull();
  });

  it('reads a rate as a percent and refuses the fraction spelling', () => {
    expect(readRateInputs('house', '', '0,20', '2026-10-12', 'KDV').canAdd).toBe(false);
    expect(readRateInputs('pos_category', ' ', '20', '2026-10-12', 'KDV').canAdd).toBe(false);
    expect(readRateInputs('house', '', '8,25', '2026-10-12', 'tax').body).toEqual({
      keyKind: 'house',
      ratePct: 8.25,
      effectiveFrom: '2026-10-12',
    });
    expect(readRateInputs('pos_category', ' Alkol ', '20%', '2026-10-12', 'KDV').body).toEqual({
      keyKind: 'pos_category',
      key: 'Alkol',
      ratePct: 20,
      effectiveFrom: '2026-10-12',
    });
  });
});

describe('TaxBasisSection', () => {
  it('opens with nothing chosen, shows the country’s suggestion, and writes nothing until Confirm', async () => {
    render(<TaxBasisSection canManage />);
    expect(await screen.findByTestId('tax-basis-proposal')).toBeTruthy();
    const include = screen.getByRole('button', { name: 'Prices on your till include KDV' });
    expect(include.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose it' }));
    expect(include.getAttribute('aria-pressed')).toBe('true');
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('confirms the chosen answer and shows who gave it', async () => {
    api.put.mockResolvedValue({
      data: readout({
        basis: 'prices_include_tax',
        answered: true,
        confirmedAt: '2026-10-12T09:00:00Z',
        confirmedBy: { userId: 'u1', name: 'Ayşe Kaya' },
        changed: true,
        audited: true,
      }),
    });
    render(<TaxBasisSection canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Prices on your till include KDV' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/settings/tax-basis', { basis: 'prices_include_tax' }));
    expect(await screen.findByText(/answered by · Ayşe Kaya/)).toBeTruthy();
    expect(screen.getByText(/No rate is in force today/)).toBeTruthy();
  });

  it('adds a till-category rate from the suggested 20 percent', async () => {
    api.get.mockResolvedValue({ data: readout({ basis: 'prices_include_tax', answered: true, confirmedAt: '2026-10-12T09:00:00Z' }) });
    api.post.mockResolvedValue({ data: readout({ basis: 'prices_include_tax', answered: true }) });
    render(<TaxBasisSection canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'One till category' }));
    fireEvent.change(screen.getByLabelText('Till category'), { target: { value: 'Alkol' } });
    fireEvent.click(screen.getByRole('button', { name: '20% alcohol' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/tax-rates', {
        keyKind: 'pos_category',
        key: 'Alkol',
        ratePct: 20,
        effectiveFrom: '2026-10-12',
      }),
    );
  });

  it('a “20% alcohol” quick-fill covers one till category, never everything (F-1593)', async () => {
    api.get.mockResolvedValue({ data: readout({ basis: 'prices_include_tax', answered: true }) });
    api.post.mockResolvedValue({ data: readout({ basis: 'prices_include_tax', answered: true }) });
    render(<TaxBasisSection canManage />);
    fireEvent.click(await screen.findByRole('button', { name: '20% alcohol' }));
    expect(screen.getByRole('button', { name: 'One till category' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Till category') as HTMLInputElement).value).toBe('Alcohol');
    expect(screen.queryByText(/everything the house sells/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add rate' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/tax-rates', {
        keyKind: 'pos_category',
        key: 'Alcohol',
        ratePct: 20,
        effectiveFrom: '2026-10-12',
      }),
    );
  });

  it('keeps a rate dated ahead on the page with its first day, and withdraws it (F-1586)', async () => {
    const row = (version: number, ratePct: number, effectiveFrom: string, now: boolean) => ({
      version,
      keyKind: 'house' as const,
      key: '',
      itemName: null,
      ratePct,
      effectiveFrom,
      effectiveTo: null,
      inForceToday: now,
      upcoming: !now,
      createdAt: '2026-10-12T09:00:00Z',
    });
    api.get.mockResolvedValue({
      data: readout({
        basis: 'prices_include_tax',
        answered: true,
        rates: [row(2, 20, '2027-01-01', false), row(1, 18, '2020-01-01', true)],
      }),
    });
    api.post.mockResolvedValue({ data: readout({ basis: 'prices_include_tax', answered: true }) });
    render(<TaxBasisSection canManage />);
    const coming = await screen.findByTestId('tax-rates-upcoming');
    expect(coming.textContent).toMatch(/from 2027-01-01, 20% on everything/);
    fireEvent.click(within(coming).getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByTestId('tax-rate-withdraw').textContent).toMatch(/stop 20% on everything from 2027-01-01/);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw it' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/settings/tax-rates/withdraw', { version: 2 }));
  });

  it('says a failed read as a failed read, not as unanswered', async () => {
    api.get.mockRejectedValue(new Error('Network Error'));
    render(<TaxBasisSection canManage />);
    expect(await screen.findByText(/could not be read — Network Error/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  });

  it('keeps the choice legible but disabled for someone who cannot change it', async () => {
    render(<TaxBasisSection canManage={false} />);
    const include = (await screen.findByRole('button', { name: 'Prices on your till include KDV' })) as HTMLButtonElement;
    expect(include.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Choose it' })).toBeNull();
  });
});

describe('TaxBasisSetupLine', () => {
  const mount = () =>
    render(
      <MemoryRouter>
        <TaxBasisSetupLine />
      </MemoryRouter>,
    );

  it('asks an unanswered house, in every country, and links to the setting', async () => {
    api.get.mockResolvedValue({ data: readout({ country: 'US', taxWord: 'sales tax' }) });
    mount();
    const line = await screen.findByTestId('tax-basis-setup-line');
    expect(line.textContent).toMatch(/include sales tax/);
    // F-1590: said before the first check, so the house knows from which day net is pre-tax.
    expect(line.textContent).toMatch(/only from the day you answer; checks recorded before then stay as the\s+till sent them/);
    expect(screen.getByRole('link', { name: 'Say which in Settings' }).getAttribute('href')).toBe('/settings?tab=tax-basis');
  });

  it('says nothing once the house has answered, when the read fails, or when the body is not a readout', async () => {
    for (const reply of [
      () => Promise.resolve({ data: readout({ basis: 'prices_exclude_tax', answered: true }) }),
      () => Promise.reject(new Error('Network Error')),
      () => Promise.resolve({ data: {} }),
    ]) {
      api.get.mockReset().mockImplementation(reply);
      const { unmount } = mount();
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId('tax-basis-setup-line')).toBeNull();
      unmount();
    }
  });
});
