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

import CarryThis, { parInBook } from './CarryThis';

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
  it('(f) posts a food, picked in kg, in grams with exactly the name given', async () => {
    api.carry.mockResolvedValue({ id: 'n1', kind: 'food', uom: 'g', displayName: 'Un', thresholdMin: 0 });
    const onCarried = open();
    // A food starts in kilograms: the kitchen weighs in kg, the book keeps grams.
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('kg');
    expect(screen.getByTestId('ivc-unit-hint').textContent).toContain('1.25 kg is kept as 1,250 g');
    fireEvent.change(nameField(), { target: { value: ' Un ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(api.carry.mock.calls[0][0]).toEqual({ kind: 'food', uom: 'g', displayName: 'Un' });
    expect(api.carry.mock.calls[0][1]).toBe('r1');
    await waitFor(() => expect(onCarried).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' })));
  });

  it('offers kilograms and litres beside grams, millilitres and each', () => {
    open();
    const opts = Array.from((screen.getByLabelText('Unit') as HTMLSelectElement).options).map((o) => o.value);
    expect(opts).toEqual(['kg', 'g', 'l', 'ml', 'each']);
  });

  it('a par of 2.5 kg is sent as 2,500 g, and is said back first', async () => {
    api.carry.mockResolvedValue({ id: 'n1', kind: 'food', uom: 'g', displayName: 'Flour', thresholdMin: 2500 });
    open();
    fireEvent.change(nameField(), { target: { value: 'Flour' } });
    fireEvent.change(screen.getByLabelText(/Par/), { target: { value: '2,5' } });
    expect(screen.getByTestId('ivc-par-said').textContent).toBe('Par 2.5 kg, kept as 2,500 g.');
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(api.carry.mock.calls[0][0]).toEqual({ kind: 'food', uom: 'g', displayName: 'Flour', thresholdMin: 2500 });
  });

  it('a drink picked in litres is kept in ml: 0.75 l is 750 ml, 70 cl is 700 ml', async () => {
    api.carry.mockResolvedValue({ id: 'n2', kind: 'other', uom: 'ml', displayName: 'Lemonade', thresholdMin: 750 });
    open();
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'other' } });
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('l');
    fireEvent.change(nameField(), { target: { value: 'Lemonade' } });
    const par = screen.getByLabelText(/Par/);
    fireEvent.change(par, { target: { value: '70 cl' } });
    expect(screen.getByTestId('ivc-par-said').textContent).toBe('Par 0.7 l, kept as 700 ml.');
    fireEvent.change(par, { target: { value: '0.75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(api.carry.mock.calls[0][0]).toEqual({ kind: 'other', uom: 'ml', displayName: 'Lemonade', thresholdMin: 750 });
  });

  it('a par picked in grams stays in grams', async () => {
    api.carry.mockResolvedValue({ id: 'n3', kind: 'food', uom: 'g', displayName: 'Saffron', thresholdMin: 5 });
    open();
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'g' } });
    fireEvent.change(nameField(), { target: { value: 'Saffron' } });
    fireEvent.change(screen.getByLabelText(/Par/), { target: { value: '5' } });
    expect(screen.getByTestId('ivc-par-said').textContent).toBe('Par 5 g.');
    fireEvent.click(screen.getByRole('button', { name: 'Carry this' }));
    await waitFor(() => expect(api.carry).toHaveBeenCalledTimes(1));
    expect(api.carry.mock.calls[0][0]).toMatchObject({ uom: 'g', thresholdMin: 5 });
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

  it('asks about "1,500" or "1.500" in kg, a thousandfold slip either way it is read: nothing is added', () => {
    open();
    fireEvent.change(nameField(), { target: { value: 'Flour' } });
    const par = screen.getByLabelText(/Par/);
    const button = () => screen.getByRole('button', { name: 'Carry this' }) as HTMLButtonElement;
    fireEvent.change(par, { target: { value: '1,500' } });
    expect(button().disabled).toBe(true);
    expect(screen.getByText('“1,500” could be either: type 1.5 for 1.5 kg, or 1500 for 1,500 kg.')).toBeTruthy();
    expect(screen.queryByTestId('ivc-par-said')).toBeNull();
    fireEvent.change(par, { target: { value: '1.500' } });
    expect(button().disabled).toBe(true);
    fireEvent.change(par, { target: { value: '1500' } });
    expect(button().disabled).toBe(false);
    expect(screen.getByTestId('ivc-par-said').textContent).toBe('Par 1,500 kg, kept as 1,500,000 g.');
    fireEvent.change(par, { target: { value: '1.5' } });
    expect(screen.getByTestId('ivc-par-said').textContent).toBe('Par 1.5 kg, kept as 1,500 g.');
    expect(api.carry).not.toHaveBeenCalled();
  });
  it('adds nothing without a name', () => {
    open();
    expect((screen.getByRole('button', { name: 'Carry this' }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.carry).not.toHaveBeenCalled();
  });
  it('refuses a par that is not a whole small unit, a negative or a word: nothing is added', () => {
    open();
    fireEvent.change(nameField(), { target: { value: 'Un' } });
    const par = screen.getByLabelText(/Par/);
    const button = () => screen.getByRole('button', { name: 'Carry this' }) as HTMLButtonElement;
    // kg picked: 0.0005 kg is half a gram, which the book cannot hold.
    for (const bad of ['0.0005', '-2', 'lots', '2 lb']) {
      fireEvent.change(par, { target: { value: bad } });
      expect(button().disabled).toBe(true);
      expect(screen.getByText(/A par is an amount in kg/)).toBeTruthy();
    }
    fireEvent.change(par, { target: { value: '500 g' } });
    expect(button().disabled).toBe(false);
    // each: whole numbers only.
    fireEvent.change(screen.getByLabelText('Unit'), { target: { value: 'each' } });
    fireEvent.change(par, { target: { value: '1.5' } });
    expect(button().disabled).toBe(true);
    expect(screen.getByText('A par is a whole number, or leave it empty.')).toBeTruthy();
    fireEvent.change(par, { target: { value: '12' } });
    expect(button().disabled).toBe(false);
    expect(api.carry).not.toHaveBeenCalled();
  });
});

describe('parInBook', () => {
  it('reads the par in the picked unit as whole g, ml or a count', () => {
    expect(parInBook('2.25', 'kg')).toBe(2250);
    expect(parInBook('2 kg', 'g')).toBe(2000);
    expect(parInBook('250 g', 'kg')).toBe(250);
    expect(parInBook('1.5', 'l')).toBe(1500);
    expect(parInBook('33 cl', 'ml')).toBe(330);
    expect(parInBook('0', 'kg')).toBe(0);
    expect(parInBook('0.5', 'g')).toBeNull();
    // A separator before exactly three digits is asked about, never read.
    expect(parInBook('1,500', 'kg')).toBeNull();
    expect(parInBook('1.500', 'l')).toBeNull();
    expect(parInBook('2.250 kg', 'g')).toBeNull();
    // Not ambiguous: a leading 0, or two places.
    expect(parInBook('0.035', 'kg')).toBe(35);
    expect(parInBook('2,25', 'kg')).toBe(2250);
    expect(parInBook('3', 'each')).toBe(3);
    expect(parInBook('3 kg', 'each')).toBeNull();
  });
});
