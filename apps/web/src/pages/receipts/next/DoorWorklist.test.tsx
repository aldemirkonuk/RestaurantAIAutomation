import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DoorWorklist, ageWords, doorRowText } from './DoorWorklist';
import type { UnverifiedDelivery } from '../../../services/api/receiving';

const row = (o: Partial<UnverifiedDelivery> = {}): UnverifiedDelivery => ({
  orderId: 'o1',
  orderNumber: 'PO-1',
  providerId: 'p1',
  providerName: 'Acme Wines',
  countedQtyBottles: 12,
  countedAt: '',
  ageHours: 3,
  severity: 'fresh',
  ...o,
});
const draw = (items: UnverifiedDelivery[] | null, failed = false) =>
  render(<DoorWorklist items={items} failed={failed} noRestaurant={false} sans="x" mono="y" />);

describe('door worklist rows (r110 invoices-g2)', () => {
  beforeEach(() => {
    try {
      window.localStorage.clear();
    } catch {
      /* none */
    }
  });

  it('says the age in words: today, N days late, overdue', () => {
    expect(ageWords({ severity: 'fresh', ageHours: 11 })).toBe('today');
    expect(ageWords({ severity: 'stale', ageHours: 13 })).toBe('1 day late');
    expect(ageWords({ severity: 'stale', ageHours: 47 })).toBe('1 day late');
    expect(ageWords({ severity: 'stale', ageHours: 50 })).toBe('2 days late');
    expect(ageWords({ severity: 'overdue', ageHours: 300 })).toBe('overdue');
  });

  it('names the vendor, or says why it cannot', () => {
    expect(doorRowText(row())).toBe('Acme Wines · PO-1 · 12 counted · today');
    expect(doorRowText(row({ providerName: null }))).toBe(
      'a vendor that could not be read · PO-1 · 12 counted · today',
    );
    expect(doorRowText(row({ providerId: null, providerName: null, orderNumber: null }))).toBe(
      'no vendor on the order · an order with no number · 12 counted · today',
    );
  });

  it('shows three rows, then "and N more"', () => {
    draw([1, 2, 3, 4, 5].map((i) => row({ orderId: `o${i}`, orderNumber: `PO-${i}` })));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('and 2 more')).toBeTruthy();
    expect(screen.queryByText(/PO-4/)).toBeNull();
  });

  it('three rows have no "more" line', () => {
    draw([1, 2, 3].map((i) => row({ orderId: `o${i}` })));
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it('a pending read draws no words and reserves the last measured height', () => {
    window.localStorage.setItem('receipts.doorWorklist.height', '132');
    const { container } = draw(null);
    expect(container.textContent).toBe('');
    expect(screen.getByTestId('door-reserve').style.height).toBe('132px');
  });

  it('a pending read with nothing measured draws nothing at all', () => {
    const { container } = draw(null);
    expect(container.innerHTML).toBe('');
  });

  it('only a failed read says unknown', () => {
    draw(null, true);
    expect(screen.getByText(/Deliveries counted at the door: unknown/)).toBeTruthy();
  });

  it('an answered empty list writes 0, so the next visit reserves nothing', () => {
    window.localStorage.setItem('receipts.doorWorklist.height', '132');
    draw([]);
    expect(window.localStorage.getItem('receipts.doorWorklist.height')).toBe('0');
  });
});
