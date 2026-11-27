/**
 * "Carry this" (CarryThis.tsx): what it posts, and what it says when the
 * house already carries the name or the server refuses the unit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ carry: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  carryHouseItem: api.carry,
}));

import CarryThis from './CarryThis';

function refused(status: number, message: string) {
  return Object.assign(new Error('refused'), { response: { status, data: { statusCode: status, message } } });
}

function open(onCarried = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CarryThis restaurantId="r1" onClose={vi.fn()} onCarried={onCarried} />
    </QueryClientProvider>,
  );
  return onCarried;
}

const nameField = () => screen.getByPlaceholderText('Flour, napkins, house lemonade…');

beforeEach(() => {
  api.carry.mockReset();
});

describe('Carry this', () => {
  it('(f) posts a food in grams with exactly the name given', async () => {
    api.carry.mockResolvedValue({ id: 'n1', kind: 'food', uom: 'g', displayName: 'Un', thresholdMin: 0 });
    const onCarried = open();
    expect(screen.getByTestId('ivc-unit-hint').textContent).toContain('We keep it in grams; the list shows kg');
    fireEvent.change(nameField(), { target: { value: ' Un ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(api.carry.mock.calls[0][0]).toEqual({ kind: 'food', uom: 'g', displayName: 'Un' });
    expect(api.carry.mock.calls[0][1]).toBe('r1');
    await waitFor(() => expect(onCarried).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' })));
  });

  it('(f) says the house already carries it on a 409, and that nothing was added', async () => {
    api.carry.mockRejectedValue(refused(409, 'This house already carries Un'));
    const onCarried = open();
    fireEvent.change(nameField(), { target: { value: 'Un' } });
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('already carries Un');
    expect(alert.textContent).toContain('Nothing was added');
    expect(onCarried).not.toHaveBeenCalled();
  });

  it('says a refused unit in words on a 400', async () => {
    api.carry.mockRejectedValue(refused(400, 'Stock is kept in whole small units: store it in g'));
    open();
    fireEvent.change(nameField(), { target: { value: 'Un' } });
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    expect((await screen.findByRole('alert')).textContent).toContain('whole small units');
  });

  it('adds nothing without a name', () => {
    open();
    expect((screen.getByRole('button', { name: 'Carry this' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.carry).not.toHaveBeenCalled();
  });
  it('takes a par only as a whole number of the unit: a decimal or a negative adds nothing', () => {
    open();
    fireEvent.change(nameField(), { target: { value: 'Un' } });
    const par = screen.getByLabelText(/Par/);
    const button = () => screen.getByRole('button', { name: 'Carry this' }) as HTMLButtonElement;
    for (const bad of ['1.5', '-2']) {
      fireEvent.change(par, { target: { value: bad } });
      expect(button().disabled).toBe(true);
      expect(screen.getByText('A par is a whole number, or leave it empty.')).toBeTruthy();
    }
    fireEvent.change(par, { target: { value: '500' } });
    expect(button().disabled).toBe(false);
    expect(api.carry).not.toHaveBeenCalled();
  });
});
