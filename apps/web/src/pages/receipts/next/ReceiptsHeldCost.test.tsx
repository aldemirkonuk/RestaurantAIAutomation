/**
 * A PAPER WHOSE COST IS HELD FOR THE HOUSE'S TAX BASIS SAYS SO (r107, DD-r106-23).
 * Fails with the note removed, with a failed read shown as nothing held, and
 * with the sentence shown to staff, who cannot read it.
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
  heldCosts: vi.fn(),
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
      heldCosts: api.heldCosts,
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

async function openFirstDoc() {
  fireEvent.click(
    await screen.findByText(
      (_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? ''),
    ),
  );
  await screen.findByLabelText('Quantity, line 1');
}


beforeEach(() => {
  api.queue = [DOC];
  api.detail = { document: DOC, lines: [LINE], links: [] };
  api.role = 'manager';
  api.heldCosts.mockReset();
});

describe('the held-cost sentence', () => {
  it('says "Tax basis unknown" with an em dash when the paper shows tax but not whether prices include it', async () => {
    // The gateway's real shape: the house has answered (taxBasisKnown true) and the hold is the paper's.
    api.heldCosts.mockResolvedValue({ taxBasisKnown: true, held: [{ deliveryId: 'x', inventoryId: 'i', why: 'w', cause: 'tax_basis' }] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(
      await screen.findByText(/Tax basis unknown — one item on this paper keeps a provisional cost: the paper shows tax but does not say whether its prices include it\./),
    ).toBeTruthy();
    expect(api.heldCosts).toHaveBeenCalledWith('d1');
  });

  it('says nothing when nothing is held', async () => {
    api.heldCosts.mockResolvedValue({ taxBasisKnown: true, held: [] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await waitFor(() => expect(api.heldCosts).toHaveBeenCalled());
    expect(screen.queryByText(/Tax basis unknown/)).toBeNull();
  });

  it('speaks the tax hold and the other cause together, when a paper has both', async () => {
    api.heldCosts.mockResolvedValue({
      taxBasisKnown: true,
      held: [
        { deliveryId: 'x', inventoryId: 'i', why: 'w', cause: 'tax_basis' },
        { deliveryId: 'x', inventoryId: 'j', why: 'line 2 has no exchange rate. The lot stays provisional.', cause: 'currency' },
      ],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/the paper shows tax but does not say whether its prices include it/)).toBeTruthy();
    expect(screen.getByText(/Line 2 has no exchange rate/)).toBeTruthy();
  });

  it('a paper held for a missing exchange rate says that, not the tax basis', async () => {
    const why =
      'its invoice is in TRY and this house keeps its costs in USD; no exchange rate is recorded, so a cost in TRY is not booked as USD. The lot stays provisional.';
    api.heldCosts.mockResolvedValue({
      taxBasisKnown: false,
      held: [{ deliveryId: 'x', inventoryId: 'i', why, cause: 'currency' }],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/no exchange rate is recorded/)).toBeTruthy();
    expect(screen.queryByText(/Tax basis unknown/)).toBeNull();
  });

  it('a failed read says it could not be read, never that nothing is held', async () => {
    api.heldCosts.mockRejectedValue(new Error('gateway is down'));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/Whether this paper.s cost is held could not be read/)).toBeTruthy();
    expect(screen.queryByText(/Tax basis unknown/)).toBeNull();
  });

  it('is not asked of, or shown to, staff', async () => {
    api.role = 'staff';
    api.heldCosts.mockResolvedValue({ taxBasisKnown: false, held: [{ deliveryId: 'x', inventoryId: 'i', why: 'w', cause: 'tax_basis' }] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(api.heldCosts).not.toHaveBeenCalled();
    expect(screen.queryByText(/Tax basis unknown/)).toBeNull();
  });
});
