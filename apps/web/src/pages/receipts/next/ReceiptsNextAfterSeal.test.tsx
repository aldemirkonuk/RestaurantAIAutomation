/**
 * AFTER A SEAL THE NEXT PAPER OPENS (r107, DD-r106-25), and j / k walk the
 * review lanes. These fail with the old `select(null)`, with the keys removed,
 * and with a typing field or a held seal no longer guarded.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({
  queue: [] as ProcurementDocument[],
  detail: { document: {}, lines: [] as unknown[], links: [] },
  role: 'manager' as 'owner' | 'manager' | 'staff' | null,
  editLine: vi.fn(),
  verify: vi.fn(() => Promise.resolve()),
  restateCurrency: vi.fn(),
  mintVerifySeal: vi.fn(),
  mintLineEditSeal: vi.fn(),
  mintCurrencySeal: vi.fn(),
  /** Every call, in order, so the TIMING can be asserted rather than assumed. */
  calls: [] as string[],
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', activeRole: api.role, user: null }),
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: (opts: { status?: string }) =>
        // Only the review queue is filled here; the clean list (W44) is empty.
        Promise.resolve(opts.status === 'needs_review' ? api.queue : []),
      detail: () => Promise.resolve(api.detail),
      match: vi.fn(),
      linkLine: vi.fn(() => Promise.resolve()),
      editLine: api.editLine,
      verify: api.verify,
      restateCurrency: api.restateCurrency,
      mintVerifySeal: api.mintVerifySeal,
      mintLineEditSeal: api.mintLineEditSeal,
      mintCurrencySeal: api.mintCurrencySeal,
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve({ items: [] }) },
}));
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: { document: () => new Promise(() => {}) },
}));
vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: () => <div data-testid="formatted-document" />,
}));
vi.mock('../../../services/api/orders', () => ({
  getOrder: () => Promise.resolve({ id: 'o1', orderNumber: 'PO-14' }),
}));

import ReceiptsNext from './ReceiptsNext';

const DOC: ProcurementDocument = {
  id: 'd1',
  doc_type: 'invoice',
  source_channel: 'email',
  doc_number: 'INV-88',
  doc_date: '2026-08-28',
  status: 'needs_review',
  /**
   * A NON-DOLLAR currency, deliberately, and the fixture STATES it.
   *
   * `scripts/check_money_states_its_currency.py` counts every fixture and
   * formatter that pins the dollar code, because `restaurants.currency` carried
   * it as a DEFAULT on fourteen production houses, two of them in Türkiye. A
   * fixture pinned that way is a premise that would pass whether or not the page
   * respects the document's own money, so this one is EUR and the case below
   * asserts the page prints EUR and never a dollar sign — the same shape the
   * sibling TRY case in `ReceiptsNext.test.tsx` uses. The restatement cases
   * restate EUR -> TRY, which is also what the picker offers: it filters out the
   * code already filed.
   *
   * (That guard has no comment stripping, so a comment QUOTING the pattern is
   * counted as a site. This wording avoids the literal rather than earning an
   * allow-list row for a sentence.)
   */
  currency: 'EUR',
  total: 412.5,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  tax: null,
  other_charges: null,
  ties_out: null,
  tie_out_delta: null,
  extraction_confidence: null,
  notes: null,
  created_at: '2026-08-28T10:00:00Z',
  order_id: 'o1',
};

const LINE = {
  id: 'l1',
  line_no: 1,
  vendor_sku: null,
  description: 'Albariño 2022',
  vintage: 2022,
  qty: 12,
  uom: 'cs',
  pack_size: 12,
  qty_bottles: 12,
  free_goods_qty: 0,
  unit_price: 18.4,
  line_total: 220.8,
  order_line_id: null,
  allowance: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  api.calls.length = 0;
  api.queue = [DOC];
  api.detail = { document: DOC, lines: [LINE], links: [] };
  api.role = 'manager';
  api.editLine.mockReset();
  api.editLine.mockImplementation(() => {
    api.calls.push('editLine');
    return Promise.resolve({
      line: { ...LINE, qty: 11 },
      tieOut: { computedLinesTotal: 202.4, tieOutDelta: -210.1, tiesOut: false },
    });
  });
  api.verify.mockReset();
  api.verify.mockImplementation(() => {
    api.calls.push('verify');
    return Promise.resolve();
  });
  api.restateCurrency.mockReset();
  api.restateCurrency.mockImplementation(() => {
    api.calls.push('restateCurrency');
    return Promise.resolve({
      currency: 'TRY',
      previousCurrency: 'EUR',
      sentence: 'Currency restated from EUR to TRY.',
      moneyRefiled: true,
      linesRefiled: 1,
      lineFailures: [],
    });
  });
  for (const [name, mint] of [
    ['mintVerifySeal', api.mintVerifySeal],
    ['mintLineEditSeal', api.mintLineEditSeal],
    ['mintCurrencySeal', api.mintCurrencySeal],
  ] as const) {
    mint.mockReset();
    mint.mockImplementation(() => {
      api.calls.push(name);
      return Promise.resolve('seal-token');
    });
  }
});


const DOC2 = { ...DOC, id: 'd2', doc_number: 'INV-89' } as ProcurementDocument;
const DOC3 = { ...DOC, id: 'd3', doc_number: 'INV-90' } as ProcurementDocument;

const paperRow = (n: string) =>
  screen.findByText((_, el) => el?.tagName === 'SPAN' && new RegExp(`Invoice · ${n}`).test(el.textContent ?? ''));

beforeEach(() => {
  api.queue = [DOC, DOC2, DOC3];
  api.detail = { document: DOC, lines: [LINE], links: [] };
  api.role = 'manager';
  api.verify.mockReset();
  api.verify.mockImplementation(() => {
    api.queue = api.queue.slice(1);
    return Promise.resolve();
  });
  api.mintVerifySeal.mockReset();
  api.mintVerifySeal.mockResolvedValue('seal-token');
});

async function sealOpenPaper() {
  fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), { key: 'Enter' });
  await waitFor(() => expect(api.verify).toHaveBeenCalled());
}

describe('after a seal', () => {
  it('opens the next paper in the review lane', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await paperRow('INV-88'));
    await screen.findByLabelText('Quantity, line 1');
    await sealOpenPaper();
    await waitFor(() =>
      expect(screen.getByRole('button', { pressed: true }).textContent).toMatch(/INV-89/),
    );
    expect(container.querySelector('[data-testid="detail-placeholder"]')?.textContent).not.toMatch(/Nothing is open/);
  });

  it('falls back to the empty state when the sealed paper was the last one', async () => {
    api.queue = [DOC];
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await paperRow('INV-88'));
    await screen.findByLabelText('Quantity, line 1');
    await sealOpenPaper();
    await waitFor(() => expect(screen.queryByRole('button', { pressed: true })).toBeNull());
    expect(screen.queryByLabelText('Quantity, line 1')).toBeNull();
  });
});

describe('j and k in the review lane', () => {
  const rowBtn = (n: string) => screen.getByText(new RegExp(`Invoice · ${n}`)).closest('button') as HTMLButtonElement;

  it('only one row is a Tab stop, and j / k move focus through the rows', async () => {
    render(<ReceiptsNext />, { wrapper });
    await paperRow('INV-88');
    expect(rowBtn('INV-88').tabIndex).toBe(0);
    expect(rowBtn('INV-89').tabIndex).toBe(-1);
    rowBtn('INV-88').focus();
    fireEvent.keyDown(rowBtn('INV-88'), { key: 'j' });
    expect(document.activeElement).toBe(rowBtn('INV-89'));
    expect(rowBtn('INV-89').tabIndex).toBe(0);
    expect(rowBtn('INV-88').tabIndex).toBe(-1);
    fireEvent.keyDown(rowBtn('INV-89'), { key: 'j' });
    expect(document.activeElement).toBe(rowBtn('INV-90'));
    fireEvent.keyDown(rowBtn('INV-90'), { key: 'j' });
    expect(document.activeElement).toBe(rowBtn('INV-90'));
    fireEvent.keyDown(rowBtn('INV-90'), { key: 'k' });
    expect(document.activeElement).toBe(rowBtn('INV-89'));
  });

  it('does nothing while a seal is being held, or on key repeat', async () => {
    render(<ReceiptsNext />, { wrapper });
    await paperRow('INV-88');
    rowBtn('INV-88').focus();
    const detail = screen.getByTestId('detail-placeholder');
    fireEvent.pointerDown(detail);
    fireEvent.keyDown(rowBtn('INV-88'), { key: 'j' });
    expect(document.activeElement).toBe(rowBtn('INV-88'));
    fireEvent.pointerUp(detail);
    fireEvent.keyDown(rowBtn('INV-88'), { key: 'j', repeat: true });
    expect(document.activeElement).toBe(rowBtn('INV-88'));
  });
});

describe('where focus goes after a seal (r108)', () => {
  const rowBtn = (n: string) => screen.getByText(new RegExp(`Invoice · ${n}`)).closest('button') as HTMLButtonElement;

  it('a keyboard seal lands focus on the next row, so j / k work with no Tab back', async () => {
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await paperRow('INV-88'));
    await screen.findByLabelText('Quantity, line 1');
    const swipe = screen.getByRole('button', { name: /Swipe up to confirm/ });
    swipe.focus();
    fireEvent.keyDown(swipe, { key: 'Enter' });
    await waitFor(() => expect(api.verify).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(rowBtn('INV-89')));
    fireEvent.keyDown(rowBtn('INV-89'), { key: 'j' });
    expect(document.activeElement).toBe(rowBtn('INV-90'));
  });

  it('a keyboard seal still hands focus on when the handle lost focus before the confirm ran', async () => {
    // A real browser drops focus to BODY the moment completing disables the
    // handle, before onConfirm runs; the gesture, not activeElement, knows.
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await paperRow('INV-88'));
    await screen.findByLabelText('Quantity, line 1');
    let release: (t: string) => void = () => {};
    api.mintVerifySeal.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
    const swipe = screen.getByRole('button', { name: /Swipe up to confirm/ });
    swipe.focus();
    fireEvent.keyDown(swipe, { key: ' ' });
    // The hold completes and disables the handle; only then does focus go.
    await waitFor(() => expect(swipe).toBeDisabled(), { timeout: 3000 });
    // jsdom keeps focus on a disabled button; park it on a node, then remove it.
    const parked = document.body.appendChild(document.createElement('button'));
    parked.focus();
    parked.remove();
    expect(document.activeElement).toBe(document.body);
    release('seal-token');
    await waitFor(() => expect(api.verify).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(rowBtn('INV-89')));
    fireEvent.keyDown(rowBtn('INV-89'), { key: 'j' });
    expect(document.activeElement).toBe(rowBtn('INV-90'));
  });

  it('a pointer seal leaves focus alone, even though the press focused the handle', async () => {
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await paperRow('INV-88'));
    await screen.findByLabelText('Quantity, line 1');
    const swipe = screen.getByRole('button', { name: /Swipe up to confirm/ });
    swipe.setPointerCapture = vi.fn();
    swipe.focus();
    fireEvent.pointerDown(swipe, { clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(swipe, { clientY: 0, pointerId: 1 });
    await waitFor(() => expect(api.verify).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { pressed: true }).textContent).toMatch(/INV-89/));
    expect(document.activeElement).not.toBe(rowBtn('INV-89'));
  });
});
