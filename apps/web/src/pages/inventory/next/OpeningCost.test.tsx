/**
 * "What did these cost?" (r36 invoices R1, web half): an owner or a manager
 * states what stock from no delivery cost, through a sealed sheet. The two
 * routes are stubbed at the client. SYNTHETIC data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { get: api.get, post: api.post },
}));

import { OpeningCost, perOwnUnit, readTypedCost, waitingWords } from './OpeningCost';

const EUR = { state: 'recorded', code: 'EUR' } as const;

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

function holdByKeyboard(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: 'Enter' });
}

function refused(status: number, message: string): AxiosError {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: { message } } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_REQUEST', undefined, {}, response);
}

const waitingAnswer = (over: Record<string, number> = {}) => ({
  data: { inventoryId: 'i1', lots: 2, units: 9, emptyLots: 0, ...over },
});

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('readTypedCost', () => {
  it.each([
    ['18', 18],
    ['18.50', 18.5],
    ['18,50', 18.5],
    [' 0,125 ', 0.125],
    ['1.234,50', 1234.5],
    ['1,234.50', 1234.5],
    ['1.234.567', 1234567],
  ])('%j reads as %d', (raw, want) => {
    expect(readTypedCost(raw)).toBe(want);
  });

  it.each(['', 'abc', '-4', '0', '0,00', '1,234', '12.500', '1.2,3.4', '12e3'])('%j is not read', (raw) => {
    expect(readTypedCost(raw)).toBeNull();
  });
});

describe('perOwnUnit — typed as shown, sent per the good’s own unit', () => {
  it('a kg for a good kept in grams, a litre for one kept in millilitres', () => {
    expect(perOwnUnit(18.5, 'g')).toBe(0.0185);
    expect(perOwnUnit(12, 'ml')).toBe(0.012);
  });
  it('a bottle, a piece or a litre item is per itself', () => {
    expect(perOwnUnit(18.5, null)).toBe(18.5);
    expect(perOwnUnit(0.35, 'each')).toBe(0.35);
    expect(perOwnUnit(4, 'l')).toBe(4);
  });
  it('keeps six places, the precision a lot cost is kept at', () => {
    expect(perOwnUnit(12.3456, 'g')).toBe(0.012346);
  });
});

describe('waitingWords', () => {
  it('names what is on the shelf and what already sold', () => {
    expect(waitingWords({ inventoryId: 'i1', lots: 3, units: 6, emptyLots: 1 }, null)).toMatch(
      /^6 bottles on the shelf and 1 lot already sold or used came in without a delivery/,
    );
  });
  it('a sold-out good still says what waits', () => {
    expect(waitingWords({ inventoryId: 'i1', lots: 2, units: 0, emptyLots: 2 }, 'g')).toMatch(/^2 lots already sold or used came in/);
  });
});

describe('OpeningCost', () => {
  it('staff see nothing, and the read is never asked', () => {
    const { container } = mount(
      <OpeningCost restaurantId="r1" inventoryId="i1" title="Ribolla" uom={null} currency={EUR} canManage={false} />,
    );
    expect(container.textContent).toBe('');
    expect(api.get).not.toHaveBeenCalled();
  });

  it('nothing waiting draws nothing', async () => {
    api.get.mockResolvedValue(waitingAnswer({ lots: 0, units: 0 }));
    const { container } = mount(
      <OpeningCost restaurantId="r1" inventoryId="i1" title="Ribolla" uom={null} currency={EUR} canManage />,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/inventory/r1/item/i1/opening-cost'));
    expect(container.textContent).toBe('');
  });

  it('a failed read draws nothing', async () => {
    api.get.mockRejectedValue(refused(404, 'Cannot GET'));
    const { container } = mount(
      <OpeningCost restaurantId="r1" inventoryId="i1" title="Ribolla" uom={null} currency={EUR} canManage />,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('asks, opens a sheet, sends the typed cost per gram, and shows the server’s sentence verbatim', async () => {
    api.get.mockResolvedValue(waitingAnswer({ units: 4500 }));
    api.post.mockResolvedValue({ data: { lotsStated: 2, drawsSettled: 3, said: 'Stated on 2 lots (4500 units on the shelf); what already left them is costed at it too (3 draws).' } });
    mount(<OpeningCost restaurantId="r1" inventoryId="i1" title="Flour" uom="g" currency={EUR} canManage />);
    expect(await screen.findByText('What did these cost?')).toBeTruthy();
    expect(screen.getByTestId('opening-cost-waiting').textContent).toContain('4.5 kg on the shelf');
    // the dropdown itself holds no field (ADR 0112 F8)
    expect(screen.queryByTestId('opening-cost-input')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'State what it cost' }));
    fireEvent.change(screen.getByLabelText('Cost a kg'), { target: { value: '18,50' } });
    expect(screen.getByTestId('opening-cost-echo').textContent).toContain('a kg');
    holdByKeyboard(screen.getByRole('button', { name: /^Hold to state/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/inventory/r1/item/i1/opening-cost', { unitCost: 0.0185 });
    expect((await screen.findByTestId('opening-cost-sheet-said')).textContent).toBe(
      'Stated on 2 lots (4500 units on the shelf); what already left them is costed at it too (3 draws).',
    );
  });

  it('a bottle is costed a bottle, as typed', async () => {
    api.get.mockResolvedValue(waitingAnswer());
    api.post.mockResolvedValue({ data: { lotsStated: 2, drawsSettled: 0, said: 'Stated on 2 lots (9 units on the shelf).' } });
    mount(<OpeningCost restaurantId="r1" inventoryId="i1" title="Ribolla" uom={null} currency={EUR} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'State what it cost' }));
    fireEvent.change(screen.getByLabelText('Cost a bottle'), { target: { value: '18' } });
    holdByKeyboard(screen.getByRole('button', { name: /^Hold to state/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/inventory/r1/item/i1/opening-cost', { unitCost: 18 }));
  });

  it('an unreadable amount cannot be sealed, and nothing is sent', async () => {
    api.get.mockResolvedValue(waitingAnswer());
    mount(<OpeningCost restaurantId="r1" inventoryId="i1" title="Ribolla" uom={null} currency={EUR} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'State what it cost' }));
    fireEvent.change(screen.getByLabelText('Cost a bottle'), { target: { value: '1,234' } });
    expect(screen.getByTestId('opening-cost-blocked').textContent).toContain('without guessing');
    holdByKeyboard(screen.getByRole('button', { name: 'Not ready to state a cost' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('a refusal says nothing was stated, in the server’s words', async () => {
    api.get.mockResolvedValue(waitingAnswer());
    api.post.mockRejectedValue(refused(403, 'Only an owner or a manager may state what stock cost'));
    mount(<OpeningCost restaurantId="r1" inventoryId="i1" title="Ribolla" uom={null} currency={EUR} canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'State what it cost' }));
    fireEvent.change(screen.getByLabelText('Cost a bottle'), { target: { value: '18' } });
    holdByKeyboard(screen.getByRole('button', { name: /^Hold to state/ }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/^Nothing was stated/);
  });
});
