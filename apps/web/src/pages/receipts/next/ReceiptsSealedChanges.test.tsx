/** WHAT SEALING CHANGED on a verified paper (r108 g17): words, reserved height, no motion of its own. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SealedChanges } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ changes: vi.fn() }));
vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return { ...mod, documentsApi: { ...mod.documentsApi, sealedChanges: api.changes } };
});
import { SEALED_CHANGES_RESERVE, SealedChangesPart, changeSentence } from './ReceiptsSealedChanges';

const ev = { stockValueDelta: '412.3', bottles: 24, salesCostDelta: '-8.4', sales: 6, notKnown: 0 };
const data = (over: Partial<SealedChanges> = {}): SealedChanges => ({
  status: 'verified',
  currency: 'USD',
  orders: ['o1'],
  otherPapers: 0,
  ...ev,
  events: [{ at: '2026-11-20T10:00:00Z', ...ev }],
  ...over,
});
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SealedChangesPart docId="d1" />
    </QueryClientProvider>,
  );

describe('SealedChangesPart', () => {
  it('says what the seal did in one sentence', async () => {
    api.changes.mockResolvedValueOnce(data());
    show();
    expect(
      await screen.findByText(/^Stock value \+\$412\.30 across 24 bottles; 6 sales already made now cost \$8\.40 less\.$/),
    ).toBeTruthy();
  });

  it('holds its height while it reads, and has no animation of its own', () => {
    api.changes.mockReturnValueOnce(new Promise(() => {}));
    show();
    const box = screen.getByTestId('sealed-changes');
    expect(box.style.minHeight).toBe(`${SEALED_CHANGES_RESERVE}px`);
    expect(box.getAttribute('aria-busy')).toBe('true');
    expect(box.style.animation).toBe('');
    expect(box.style.transition).toBe('');
  });

  it('lists a correction as a dated row under the seal', async () => {
    const later = { at: '2026-11-22T09:00:00Z', stockValueDelta: '-2', bottles: 4, salesCostDelta: '-0.5', sales: 1, notKnown: 0 };
    api.changes.mockResolvedValueOnce(data({ events: [{ at: '2026-11-20T10:00:00Z', ...ev }, later] }));
    show();
    const list = await screen.findByRole('list', { name: 'Corrections after the seal' });
    expect(list.textContent).toMatch(/^Corrected .+: Stock value −\$2\.00 across 4 bottles; 1 sale already made now cost \$0\.50 less\.$/);
  });

  it('says what it left out, and when the figures are the order’s', async () => {
    api.changes.mockResolvedValueOnce(data({ notKnown: 2, otherPapers: 1 }));
    show();
    expect(await screen.findByText(/2 costs had no earlier figure, so they are not in these numbers\./)).toBeTruthy();
    expect(screen.getByText(/1 other paper also priced it\./)).toBeTruthy();
  });

  it('a paper linked to no order says sealing moved no cost', async () => {
    api.changes.mockResolvedValueOnce(data({ orders: [], events: [] }));
    show();
    expect(await screen.findByText('This paper is linked to no order, so sealing moved no cost.')).toBeTruthy();
  });

  it("says the server's refusal in its words", async () => {
    api.changes.mockRejectedValueOnce(
      Object.assign(new Error('x'), { response: { status: 403, data: { message: 'What sealing a paper changed is the house’s money.' } } }),
    );
    show();
    expect((await screen.findByRole('status')).textContent).toBe('What sealing a paper changed is the house’s money.');
  });

  it('never reads an unchanged sale as moved', () => {
    expect(changeSentence({ ...ev, bottles: 0, salesCostDelta: '0', sales: 2 }, 'USD')).toBe('2 sales already made now cost the same.');
    expect(changeSentence({ ...ev, bottles: 0, sales: 0 }, 'USD')).toBe('No lot was revalued and no sale was restated.');
    expect(changeSentence({ ...ev, bottles: 0, salesCostDelta: '1.5', sales: 1 }, 'USD')).toBe('1 sale already made now cost $1.50 more.');
  });
});
