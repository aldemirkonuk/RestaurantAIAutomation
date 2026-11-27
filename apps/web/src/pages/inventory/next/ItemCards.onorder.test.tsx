/**
 * r109 g1: the drawer's On order card, its evidence, and the cover line with
 * what is on its way. An unread read says so and never 0; nothing is guessed
 * across units.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ItemCards from './ItemCards';
import { OnOrderEvidence, openOrderCount } from './OnOrder';
import type { InvRow } from './useInventoryNextData';
import type { ItemOnOrder, ItemOpenOrder } from '../../../services/api/inventory';

const row = (over: Partial<InvRow> = {}) =>
  ({ id: 'i1', kind: 'wine', stock: 12, wac: 40, value: 480, analyticsReadable: true, velocity: 2, runway: 6, usageSource: null, openMl: null, costProvenance: 'invoice', ...over }) as InvRow;
const currency = { code: 'USD' } as never;
const inside = { status: 'reading' } as const;
const base = {
  waste: { readable: true, qty30d: 0, given30d: 0, value30d: null, source: 'x' },
  countGap: { readable: true, last: [], source: 'x' },
  costTrend: { readable: true, points: null, changePct: null, source: 'x' },
};
const order = (over: Partial<ItemOpenOrder>): ItemOpenOrder => ({
  id: 'o1', orderNumber: 'PO-1', status: 'IN_TRANSIT', openQty: 6, unit: 'bottle', expected: '2026-12-03', inBookUnit: 6, ...over,
});
const ready = (onOrder: ItemOnOrder | undefined) => ({ status: 'ready', data: { ...base, onOrder } }) as never;
const open = (sent: ItemOpenOrder[], unsent: ItemOpenOrder[], arrivingInBookUnit: number | null): ItemOnOrder => ({
  readable: true, source: 'x', sent, unsent, arrivingInBookUnit,
});

function draw(figures: never, over: Partial<InvRow> = {}, uom: string | null = 'bottle') {
  cleanup();
  render(<ItemCards row={row(over)} uom={uom} kind="wine" canManage={false} currency={currency} figures={figures} inside={inside} open={null} onOpen={() => {}} />);
}
const card = (id: string) => screen.getByTestId(`ivd-card-${id}`).textContent ?? '';
afterEach(cleanup);

describe('On order card (r109 g1)', () => {
  it('shows what is on its way and says how many orders are sent and not yet sent', () => {
    draw(ready(open([order({})], [order({ id: 'o2', status: 'APPROVED', expected: null })], 6)));
    expect(card('onorder')).toContain('On order');
    expect(card('onorder')).toContain('6 bottles');
    expect(card('onorder')).toContain('2 orders: 1 on its way (due 3 Dec), 1 not yet sent.');
  });

  it('says Nothing open when no order is open', () => {
    draw(ready(open([], [], 0)));
    expect(card('onorder')).toContain('Nothing open');
  });

  it('only unsent orders: none on its way, never a sent figure', () => {
    draw(ready(open([], [order({ status: 'PENDING' })], 0)));
    expect(card('onorder')).toContain('None on its way');
    expect(card('onorder')).toContain('1 order: 1 not yet sent.');
  });

  it('an unread read says could not be read, never 0, and so does an older gateway', () => {
    draw(ready({ readable: false, source: 'x', sent: null, unsent: null, arrivingInBookUnit: null }));
    expect(card('onorder')).toContain('could not be read');
    expect(card('onorder')).not.toMatch(/\b0\b|Nothing open/);
    draw(ready(undefined));
    expect(card('onorder')).toContain('could not be read');
    draw({ status: 'failed', reason: 'down' } as never);
    expect(card('onorder')).toContain('could not be read');
  });

  it('a sent order in another unit is said in its own unit, and the cover gains no line', () => {
    draw(ready(open([order({ unit: 'case', openQty: 2, inBookUnit: null })], [], null)));
    expect(card('onorder')).toContain('2 cases');
    expect(card('cover')).not.toContain('With what is on its way');
  });

  it('days of cover adds what is on its way: (12 + 6) / 2 = 9 days', () => {
    draw(ready(open([order({})], [], 6)));
    expect(card('cover')).toContain('With what is on its way: 9 days.');
  });

  it('no cover line when the pace was not read', () => {
    draw(ready(open([order({})], [], 6)), { analyticsReadable: false });
    expect(card('cover')).not.toContain('With what is on its way');
  });

  it('holds its room while reading', () => {
    draw({ status: 'reading' } as never);
    expect(screen.getByTestId('ivd-card-onorder').getAttribute('data-hold')).toBe('tall');
  });
});

describe('On order evidence', () => {
  it('lists each order with its state in words, what is to come in its unit, the due day, and links to Orders', () => {
    render(
      <MemoryRouter>
        <OnOrderEvidence load={open([order({ status: 'PARTIALLY_RECEIVED', openQty: 3, inBookUnit: 3 })], [order({ id: 'o2', orderNumber: 'PO-2', status: 'APPROVAL_NEEDED', unit: 'case', openQty: 1, expected: null })], 3)} />
      </MemoryRouter>,
    );
    const text = screen.getByTestId('ivd-orders').textContent ?? '';
    expect(text).toContain('PO-1 · part received, the rest to come · 3 bottles to come · due 3 Dec');
    expect(text).toContain('PO-2 · waiting for approval · 1 case to come');
    expect(screen.getByRole('link', { name: 'Open Orders' }).getAttribute('href')).toBe('/orders');
  });

  it('a failed read is unread, not nothing on order', () => {
    render(
      <MemoryRouter>
        <OnOrderEvidence load="failed" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('ivd-on-order').textContent).toContain('could not be read');
  });

  it('counts open orders for the sheet, null while unread', () => {
    expect(openOrderCount(open([order({}), order({ unit: 'case' })], [order({ id: 'o2' })], null))).toBe(2);
    expect(openOrderCount('reading')).toBeNull();
    expect(openOrderCount(undefined)).toBeNull();
  });
});
