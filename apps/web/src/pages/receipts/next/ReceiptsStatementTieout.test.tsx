// r109 g5: a vendor's statement against the house's papers, owners and managers only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ tie: vi.fn(), role: { current: 'manager' } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', activeRole: api.role.current, user: null }),
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
      priceMoves: () => Promise.resolve({ thresholdPct: 10, lines: [] }),
      vendorPrices: () => Promise.resolve({ paperCurrency: 'USD', providerId: 'v', notCompared: null, lines: [] }),
      statementTieout: api.tie,
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
  id: 'st1', doc_type: 'statement', source_channel: 'email', doc_number: 'ST-9', doc_date: '2026-11-10',
  status: 'needs_review', currency: 'USD', total: 624.8, freight: null, fuel_surcharge: null, split_case_fee: null,
  delivery_fee: null, tax: null, other_charges: null, ties_out: null, tie_out_delta: null,
  extraction_confidence: null, notes: null, created_at: '2026-11-10T10:00:00Z', order_id: null,
};
const LINE = {
  id: 'l1', line_no: 1, vendor_sku: null, description: 'Balance', vintage: null, qty: 1, uom: 'each', pack_size: null,
  qty_bottles: null, free_goods_qty: 0, unit_price: 624.8, line_total: 624.8, order_line_id: null, allowance: null,
};
const DOC_REF = vi.hoisted(() => ({ current: null as unknown as ProcurementDocument }));
const LINE_REF = vi.hoisted(() => ({ current: null as unknown as Record<string, unknown> }));

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
    await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Statement · ST-9/.test(el.textContent ?? '')),
  );
  await screen.findByLabelText('Quantity, line 1');
}

const row = (o: Record<string, unknown>) => ({
  docNumber: '101', docDate: '2026-11-02', kind: 'invoice', amount: '312.40', verdict: 'checked_same',
  differsBy: null, reason: null, paperId: 'd101', ...o,
});
const TIE = {
  currency: 'USD', providerId: 'p1', notCompared: null, entriesRead: 5, paymentsIgnored: 1,
  rows: [
    row({}),
    row({ docNumber: '102', verdict: 'amount_differs', differsBy: '12.40', paperId: 'd102' }),
    row({ docNumber: '0103', verdict: 'never_received', paperId: null }),
    row({ docNumber: '77', kind: 'credit', amount: '40.00', verdict: 'on_file_not_checked', paperId: 'cm77' }),
    row({ docNumber: '9', verdict: 'not_compared', reason: 'the paper is in TRY and the statement in USD' }),
  ],
  notOnStatement: [{ id: 'd103', docNumber: '103', docDate: '2026-11-07', total: '312.40', kind: 'invoice' }],
};

beforeEach(() => {
  DOC_REF.current = DOC;
  LINE_REF.current = LINE;
  api.tie.mockReset();
  api.role.current = 'manager';
});

describe('the check card, a statement against your papers', () => {
  it('says each row in words, the never-received one with its estimate cost', async () => {
    api.tie.mockResolvedValue(TIE);
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const list = await screen.findByLabelText('Against your papers');
    const items = Array.from(list.querySelectorAll('li'));
    expect(items.map((li) => li.getAttribute('data-verdict'))).toEqual([
      'checked_same', 'amount_differs', 'never_received', 'on_file_not_checked', 'not_compared',
    ]);
    expect(items[0].textContent).toMatch(/Checked, same amount/);
    expect(items[1].textContent).toMatch(/Amount differs by .*12\.40; the statement says more/);
    expect(items[2].textContent).toMatch(/Never received\. Its goods may sit on an estimate cost/);
    expect(items[3].textContent).toMatch(/^Credit 77/);
    expect(items[4].textContent).toMatch(/Not compared: the paper is in TRY and the statement in USD/);
    expect(screen.getByLabelText('On file, not on this statement').textContent).toMatch(/Invoice 103/);
    expect(screen.getByText(/One payment on the statement is not\s+read here, and nothing is marked paid/)).toBeTruthy();
  });

  it('while it reads it holds one 44px row', async () => {
    api.tie.mockReturnValue(new Promise(() => {}));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect((await screen.findByText('Reading this statement against your papers.')).style.minHeight).toBe('44px');
  });

  it('every row is a fixed 44px row, and nothing animates', async () => {
    api.tie.mockResolvedValue(TIE);
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const list = await screen.findByLabelText('Against your papers');
    for (const li of Array.from(list.querySelectorAll('li'))) {
      expect(li.style.minHeight).toBe('44px');
      expect(li.style.transition).toBe('');
      expect(li.style.animation).toBe('');
    }
  });

  it('staff never ask, and see no heading', async () => {
    api.role.current = 'staff';
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(api.tie).not.toHaveBeenCalled();
    expect(screen.queryByText('Against your papers')).toBeNull();
  });

  it('an invoice never asks', async () => {
    DOC_REF.current = { ...DOC, doc_type: 'invoice', doc_number: 'ST-9' };
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · ST-9/.test(el.textContent ?? '')));
    await screen.findByLabelText('Quantity, line 1');
    expect(api.tie).not.toHaveBeenCalled();
  });

  it('says the read failed in the gateway\'s words, not nothing', async () => {
    api.tie.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 409, data: { message: 'This paper was read as invoice, not a vendor\'s statement, so there is nothing to tie out.' } } }));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/nothing to tie out/)).toBeTruthy();
  });
});
