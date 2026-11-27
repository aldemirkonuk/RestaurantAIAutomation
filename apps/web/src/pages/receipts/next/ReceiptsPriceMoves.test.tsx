/**
 * A COST THAT JUMPED WITH NO PURCHASE ORDER TO CATCH IT (r104 g4).
 * The check card says it in words, and says nothing when there is no earlier
 * cost to compare. Information only: nothing here blocks or edits.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ moves: vi.fn() }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', activeRole: 'manager', user: null }),
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));
vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: (opts: { status?: string }) => Promise.resolve(opts.status === 'needs_review' ? [DOC_REF.current] : []),
      detail: () => Promise.resolve({ document: DOC_REF.current, lines: [LINE_REF.current], links: [] }),
      priceMoves: api.moves,
      houseCurrency: () => Promise.resolve(null),
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
  CanonicalDocumentPage: () => <div />,
}));
vi.mock('../../../services/api/orders', () => ({ getOrder: () => Promise.resolve(null) }));

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


const DOC_REF = vi.hoisted(() => ({ current: null as unknown as ProcurementDocument }));
const LINE_REF = vi.hoisted(() => ({ current: null as unknown as Record<string, unknown> }));
DOC_REF.current = DOC;
LINE_REF.current = LINE;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

async function openFirstDoc() {
  fireEvent.click(
    await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? '')),
  );
  await screen.findByLabelText('Quantity, line 1');
}

const moved = {
  lineId: 'l1', lineNo: 1, description: 'Albariño 2022', compared: true as const, moved: true, pct: 18,
  sentence: 'was 10.00, now 11.80, up 18 percent',
};

beforeEach(() => {
  api.moves.mockReset();
});

describe('the check card on a cost that moved', () => {
  it('a paper in another money is said once, in the verdict, not again on the money card (r108)', async () => {
    api.moves.mockResolvedValue({
      thresholdPct: 10,
      paperCurrency: 'TRY',
      houseCurrency: 'USD',
      lines: [{ lineId: 'l1', lineNo: 1, description: 'x', compared: false as const, reason: 'currency_differs' }],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await waitFor(() => expect(api.moves).toHaveBeenCalled());
    // The verdict is stubbed here (CanonicalDocumentPage), so the card alone must be silent.
    expect(screen.queryAllByText(/Prices are in TRY and the house costs in USD/)).toHaveLength(0);
  });

  it('an unrelated not-compared reason stays silent (r106)', async () => {
    api.moves.mockResolvedValue({
      thresholdPct: 10,
      paperCurrency: 'TRY',
      houseCurrency: 'USD',
      lines: [{ lineId: 'l1', lineNo: 1, description: 'x', compared: false as const, reason: 'no_previous' }],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.queryByText(/none were compared against earlier costs/)).toBeNull();
  });

  it('says what moved, in words, against the last invoiced cost', async () => {
    api.moves.mockResolvedValue({ thresholdPct: 10, lines: [moved] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/was 10\.00, now 11\.80, up 18 percent, against its last invoiced cost/)).toBeTruthy();
  });

  it('says nothing when there is no earlier cost to compare', async () => {
    api.moves.mockResolvedValue({
      thresholdPct: 10,
      lines: [{ lineId: 'l1', lineNo: 1, description: null, compared: false, reason: 'no_previous' }],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await vi.waitFor(() => expect(api.moves).toHaveBeenCalled());
    expect(screen.queryByText(/against its last invoiced cost/)).toBeNull();
    expect(screen.queryByLabelText('Costs that moved')).toBeNull();
  });

  it('says the comparison could not be made when the read fails', async () => {
    api.moves.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('down'), { response: { status: 503, data: { message: 'gateway is down' } } })),
    );
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/earlier costs could not be read, so no price was compared/)).toBeTruthy();
  });
});
