/**
 * Count many (inventory r36 gap 6): one sitting, one seal, each good in its own
 * unit, blind until the seal, a blank box never read as 0, and each result
 * said per good and for the whole.
 *
 * The outbox is stubbed; HoldToApprove is the real control, driven by its
 * keyboard path (Enter arms it, Enter again completes it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import type { InvRow } from './useInventoryNextData';

const api = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock('../../../lib/spotCountOutbox', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  submitSpotCount: api.submit,
}));

import CountMany, { COUNT_MANY_MAX, countManySummary, gapWords } from './CountMany';

function row(id: string, name: string, stock: number | null): InvRow {
  return { id, name, stock, kind: 'wine' } as unknown as InvRow;
}

const BAROLO = row('i1', 'Barolo', 7);
const CHABLIS = row('i2', 'Chablis', 3);
const RIOJA = row('i3', 'Rioja', 4);
const FLOUR = row('f1', 'Flour', 12000);

const UOM: Record<string, string> = { f1: 'g' };
const uomOf = (r: InvRow) => UOM[r.id] ?? null;

function mount(rows: InvRow[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CountMany rows={rows} uomOf={uomOf} what="the listed titles" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function holdByKeyboard(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: 'Enter' });
}

const box = (name: string) => screen.getByRole('textbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
const type = (name: string, value: string) => fireEvent.change(box(name), { target: { value } });

function answered(status: number): AxiosError {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: {} } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, {}, response);
}

const sentFor = (id: string) => api.submit.mock.calls.filter(([e]) => e.itemId === id).map(([e]) => e);

beforeEach(() => {
  api.submit.mockReset();
});

describe('CountMany: before the seal', () => {
  it('starts blank, hides every book figure, and cannot be sealed empty', () => {
    mount([BAROLO, CHABLIS]);
    expect(box('Barolo').value).toBe('');
    expect(box('Chablis').value).toBe('');
    expect(document.body.textContent).not.toMatch(/\b7\b|\b3\b/);
    expect(screen.getByRole('button', { name: 'Type a count first' })).toBeDisabled();
  });

  it('counts a weighed good in kg and refuses a bare whole number it cannot place', () => {
    mount([FLOUR]);
    type('Flour', '5');
    expect(document.body.textContent).toContain('Say which: 5 g or 5 kg.');
    expect(screen.getByRole('button', { name: 'Put right 1 amount first' })).toBeDisabled();
    type('Flour', '2.5');
    expect(document.body.textContent).toContain('Reads as 2.5 kg.');
    expect(screen.getByRole('button', { name: 'Hold to record 1 count' })).not.toBeDisabled();
  });

  it('says how many boxes carry an amount and how many are blank', () => {
    mount([BAROLO, CHABLIS, RIOJA]);
    type('Barolo', '5');
    expect(screen.getByTestId('count-many-tally').textContent).toBe(
      '1 of 3 titles still to count has an amount; 2 are blank and will not be counted.',
    );
  });

  it('will not open a walk of more than the cap', () => {
    const many = Array.from({ length: COUNT_MANY_MAX + 1 }, (_, i) => row(`x${i}`, `Wine ${i}`, 1));
    mount(many);
    expect(screen.getByTestId('count-many-too-many').textContent).toContain(`That is ${COUNT_MANY_MAX + 1} titles.`);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('CountMany: the seal', () => {
  it('records only the typed boxes, each with its own key, and says the gap per good and for the whole', async () => {
    api.submit.mockResolvedValue({ synced: true });
    mount([BAROLO, CHABLIS, RIOJA]);
    type('Barolo', '5');
    type('Chablis', '3');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 2 counts' }));
    await waitFor(() => expect(screen.getByTestId('count-many-summary').textContent).toContain('Recorded 2 counts'));
    expect(api.submit).toHaveBeenCalledTimes(2);
    expect(sentFor('i3')).toHaveLength(0);
    const [b] = sentFor('i1');
    const [c] = sentFor('i2');
    expect(b.body.countedQty).toBe(5);
    expect(c.body.countedQty).toBe(3);
    expect(b.body.clientCountId).not.toBe(c.body.clientCountId);
    expect(screen.getByTestId('count-many-summary').textContent).toBe(
      'Recorded 2 counts: 1 short of the book, 1 the same as the book. 1 left blank was not counted; a blank box is never read as 0.',
    );
    expect(document.body.textContent).toContain('Counted 5; the book said 7, so the shelf is 2 short.');
    expect(document.body.textContent).toContain('Counted 3, the same as the book.');
    expect(screen.getByTestId('count-many-summary').getAttribute('role')).toBe('status');
    // Every count went in: the seal stays stamped, and nothing is left to send.
    expect(screen.getAllByText('Counts recorded').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Hold to record/ })).toBeNull();
  });

  it('sends a typed 0 as a count of an empty shelf', async () => {
    api.submit.mockResolvedValue({ synced: true });
    mount([BAROLO]);
    type('Barolo', '0');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1 count' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(sentFor('i1')[0].body.countedQty).toBe(0);
  });

  it('books a weighed good in grams', async () => {
    api.submit.mockResolvedValue({ synced: true });
    mount([FLOUR]);
    type('Flour', '9.5');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1 count' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(1));
    expect(sentFor('f1')[0].body.countedQty).toBe(9500);
    await waitFor(() => expect(document.body.textContent).toContain('Counted 9.5 kg; the book said 12 kg, so the shelf is 2.5 kg short.'));
  });

  it('says a count held on the device as held, not recorded', async () => {
    api.submit.mockResolvedValue({ synced: false });
    mount([BAROLO]);
    type('Barolo', '5');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1 count' }));
    await waitFor(() => expect(document.body.textContent).toContain('Held on this device: 5, not yet confirmed.'));
    expect(screen.getByTestId('count-many-summary').textContent).toContain('1 is held on this device, not yet confirmed, and goes out when the connection returns');
    expect(screen.getByTestId('count-many-summary').textContent).not.toContain('Recorded');
  });

  it('a refused good says why and is sent again alone, with the same key; a recorded one is never sent twice', async () => {
    api.submit.mockImplementation(async (e: { itemId: string }) => {
      if (e.itemId === 'i2') throw answered(403);
      return { synced: true };
    });
    mount([BAROLO, CHABLIS]);
    type('Barolo', '5');
    type('Chablis', '2');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 2 counts' }));
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('Recorded 1 count: 1 short of the book.');
    expect(summary.textContent).toContain('Nothing was recorded for Chablis; each says why below.');
    expect(document.body.textContent).toContain('Nothing was recorded — this account is not allowed to do that in this house.');
    expect(box('Barolo')).toBeDisabled();
    expect(box('Chablis')).not.toBeDisabled();

    api.submit.mockResolvedValue({ synced: true });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1 count' }));
    await waitFor(() => expect(sentFor('i2')).toHaveLength(2));
    expect(sentFor('i1')).toHaveLength(1);
    expect(sentFor('i2')[1].body.clientCountId).toBe(sentFor('i2')[0].body.clientCountId);
    await waitFor(() => expect(document.body.textContent).toContain('Counted 2; the book said 3, so the shelf is 1 short.'));
  });

  it('a count the device could not hold is not known, never "nothing recorded"', async () => {
    api.submit.mockRejectedValue(new Error('QuotaExceededError'));
    mount([BAROLO]);
    type('Barolo', '5');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1 count' }));
    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('For Barolo it is not known whether the count was recorded. Trying again is safe: it is recorded once.');
    expect(summary.textContent).not.toContain('Nothing was recorded');
  });

  it('keeps at most four counts in flight', async () => {
    let live = 0;
    let most = 0;
    api.submit.mockImplementation(async () => {
      live += 1;
      most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, 5));
      live -= 1;
      return { synced: true };
    });
    const rows = Array.from({ length: 10 }, (_, i) => row(`w${i}`, `Wine ${i}`, 1));
    mount(rows);
    for (let i = 0; i < 10; i += 1) type(`Wine ${i}`, '1');
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 10 counts' }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(10));
    await waitFor(() => expect(screen.getByTestId('count-many-summary').textContent).toContain('Recorded 10 counts'));
    expect(most).toBeLessThanOrEqual(4);
    expect(most).toBeGreaterThan(1);
  });
});

describe('countManySummary and gapWords', () => {
  it('names up to three goods, then how many more', () => {
    const refused = ['A', 'B', 'C', 'D', 'E'].map((title) => ({ title, outcome: { kind: 'refused' as const, text: 'x' } }));
    expect(countManySummary(refused, 0)).toBe('Nothing was recorded for A, B, C and 2 more; each says why below.');
    expect(countManySummary(refused.slice(0, 2), 0)).toBe('Nothing was recorded for A and B; each says why below.');
  });

  it('counts over and an unread book apart', () => {
    const s = countManySummary(
      [
        { title: 'A', outcome: { kind: 'recorded', counted: 9, book: 4 } },
        { title: 'B', outcome: { kind: 'recorded', counted: 2, book: null } },
      ],
      2,
    );
    expect(s).toBe('Recorded 2 counts: 1 over, 1 against a book that could not be read. 2 left blank were not counted; a blank box is never read as 0.');
  });

  it('says over and an unread book per good', () => {
    const w = (n: number) => String(n);
    expect(gapWords(4, 9, w)).toBe('Counted 9; the book said 4, so the shelf is 5 over.');
    expect(gapWords(null, 9, w)).toBe('Counted 9. The book could not be read before, so there is no gap to show.');
  });
});
