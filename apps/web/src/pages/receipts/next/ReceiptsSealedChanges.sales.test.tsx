/** r109 g3: the sales a sealed paper re-costed, by table, behind a disclosure. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SealedChanges, SettledSale } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ changes: vi.fn() }));
vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return { ...mod, documentsApi: { ...mod.documentsApi, sealedChanges: api.changes } };
});
import { SALES_FADE, SALES_SHOWN, SealedChangesPart, saleLine } from './ReceiptsSealedChanges';

const sale = (i: number, over: Partial<SettledSale> = {}): SettledSale => ({
  id: `s${i}`, at: '2026-11-21T20:14:00', wine: 'House Red', quantity: 2, unit: 'glass', volumeMl: 300,
  voided: false, table: 'Table 4', before: '3.10', after: '2.90', ...over,
});
const data = (salesList: SettledSale[], over: Partial<SealedChanges> = {}): SealedChanges => ({
  status: 'verified', currency: 'USD', orders: ['o1'], deliveries: 0, otherPapers: 0,
  stockValueDelta: '0', bottles: 0, salesCostDelta: '-0.2', sales: salesList.length, notKnown: 0,
  salesList, salesUnnamed: 0, ...over,
});
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SealedChangesPart docId="d1" />
    </QueryClientProvider>,
  );

// jsdom has no Web Animations: record what the component asks for.
const anims = new WeakMap<Element, KeyframeAnimationOptions[]>();
let reduced = false;
beforeEach(() => {
  (Element.prototype as any).animate = function (_k: Keyframe[], o: KeyframeAnimationOptions) {
    anims.set(this, [...(anims.get(this) ?? []), o]);
    return {} as Animation;
  };
  (Element.prototype as any).getAnimations = function () {
    return anims.get(this) ?? [];
  };
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {},
  })) as any;
});
afterEach(() => {
  reduced = false;
});

describe('Sales it settled (r109 g3)', () => {
  it('a row reads table, time, what sold and the cost before and after', () => {
    expect(saleLine(sale(1))).toBe('Table 4 · Sat 21 Nov 20:14 · 2 glasses House Red · 3.10 → 2.90');
    expect(saleLine(sale(2, { quantity: 1, unit: 'bottle', table: 'no table', before: null }))).toBe(
      'no table · Sat 21 Nov 20:14 · 1 bottle House Red · not known → 2.90',
    );
    expect(saleLine(sale(3, { voided: true }))).toMatch(/· voided · 3\.10 → 2\.90$/);
  });

  it('is closed until asked, then lists the sales newest first as given', async () => {
    api.changes.mockResolvedValueOnce(data([sale(1, { at: '2026-11-22T10:00:00' }), sale(2)]));
    show();
    const b = await screen.findByRole('button', { name: 'Sales it settled (2)' });
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('sales-settled')).toBeNull();
    fireEvent.click(b);
    expect(b.getAttribute('aria-expanded')).toBe('true');
    const rows = screen.getByTestId('sales-settled').querySelectorAll('li');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/^Table 4 · Sun 22 Nov 10:00/);
  });

  it(`shows ${SALES_SHOWN}, then Show all`, async () => {
    api.changes.mockResolvedValueOnce(data(Array.from({ length: 73 }, (_, i) => sale(i))));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Sales it settled (73)' }));
    expect(screen.getByTestId('sales-settled').querySelectorAll('li')).toHaveLength(SALES_SHOWN);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 73' }));
    expect(screen.getByTestId('sales-settled').querySelectorAll('li')).toHaveLength(73);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('fades the list in over 180ms with motion on, and never animates height', async () => {
    api.changes.mockResolvedValueOnce(data([sale(1)]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Sales it settled (1)' }));
    const list = screen.getByTestId('sales-settled');
    expect(list.getAnimations()).toEqual([SALES_FADE]);
    expect(list.style.height).toBe('');
    expect(list.style.transition).toBe('');
  });

  it('runs no animation at all under reduced motion', async () => {
    reduced = true;
    api.changes.mockResolvedValueOnce(data([sale(1)]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Sales it settled (1)' }));
    expect(screen.getByTestId('sales-settled').getAnimations()).toHaveLength(0);
  });

  it('names what it cannot name, and shows nothing when no sale was re-costed', async () => {
    api.changes.mockResolvedValueOnce(data([sale(1)], { salesUnnamed: 2 }));
    const { unmount } = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Sales it settled (1)' }));
    expect(screen.getByText('2 more sales are in the total but not named here: no till check is on record for them.')).toBeTruthy();
    unmount();
    api.changes.mockResolvedValueOnce(data([]));
    show();
    await screen.findByText(/sales already made|No lot was revalued/);
    expect(screen.queryByRole('button', { name: /Sales it settled/ })).toBeNull();
  });

  it('staff are refused in words and see no list', async () => {
    api.changes.mockRejectedValueOnce(
      Object.assign(new Error('x'), { response: { status: 403, data: { message: 'What sealing a paper changed is the house’s money.' } } }),
    );
    show();
    expect((await screen.findByRole('status')).textContent).toBe('What sealing a paper changed is the house’s money.');
    expect(screen.queryByRole('button', { name: /Sales it settled/ })).toBeNull();
  });
});
