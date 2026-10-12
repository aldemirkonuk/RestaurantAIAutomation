import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      basisConsequence({ basis: 'prices_include_tax', taxWord: 'KDV', confirmedAt: '2026-10-12T09:00:00Z' }),
    ).toMatch(/from 2026-10-12.*Checks recorded before then stay as your till sent them/);
  });

  it('offers nothing to confirm until a choice is made, and not the answer already recorded', () => {
    expect(readAnswer(null, { basis: 'unset', taxWord: 'KDV' }).canConfirm).toBe(false);
    expect(readAnswer('prices_include_tax', { basis: 'prices_include_tax', taxWord: 'KDV' }).canConfirm).toBe(false);
    expect(readAnswer('prices_include_tax', { basis: 'unset', taxWord: 'KDV' }).canConfirm).toBe(true);
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
    expect(screen.getByText(/No rate is recorded/)).toBeTruthy();
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
