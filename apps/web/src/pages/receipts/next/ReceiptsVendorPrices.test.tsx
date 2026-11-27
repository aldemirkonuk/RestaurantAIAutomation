// r108 g14: another vendor's lower price, owners and managers only.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({ moves: vi.fn(), vendor: vi.fn(), role: { current: 'manager' } }));

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
      priceMoves: api.moves,
      vendorPrices: api.vendor,
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
  // EUR on purpose: a document's own money, never the dollar default.
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

beforeEach(() => {
  api.moves.mockReset();
});

const cheaper = {
  lineId: 'l1', lineNo: 1, description: 'Albariño 2022', compared: true as const, cheaper: true, thisPaper: 10.2,
  sentence: 'Bought for 9.40 a bottle from Bravo Wines on 3 Nov (this paper 10.20)',
};

beforeEach(() => {
  api.moves.mockReset();
  api.moves.mockResolvedValue({ thresholdPct: 10, lines: [] });
  api.vendor.mockReset();
  api.role.current = 'manager';
});

describe('the check card, another vendor\'s price', () => {
  it('says it once, under the price-move note, when the other price is lower', async () => {
    api.vendor.mockResolvedValue({ paperCurrency: 'EUR', providerId: 'vA', notCompared: null, lines: [cheaper] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(
      await screen.findByText(/Bought for 9\.40 a bottle from Bravo Wines on 3 Nov \(this paper 10\.20\)/),
    ).toBeTruthy();
  });

  it('holds its space while it loads, and keeps it when nothing is lower', async () => {
    api.vendor.mockResolvedValue({
      paperCurrency: 'EUR', providerId: 'vA', notCompared: null,
      lines: [{ ...cheaper, cheaper: false }],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const box = await screen.findByTestId('vendor-prices');
    expect(box.style.minHeight).toBe('16px');
    await vi.waitFor(() => expect(api.vendor).toHaveBeenCalled());
    expect(screen.queryByLabelText('Cheaper from another vendor')).toBeNull();
    expect(screen.queryByText(/Bought for/)).toBeNull();
    expect(screen.getByTestId('vendor-prices').style.minHeight).toBe('16px');
  });

  it('staff never ask, and see nothing', async () => {
    api.role.current = 'staff';
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await vi.waitFor(() => expect(api.moves).toHaveBeenCalled());
    expect(api.vendor).not.toHaveBeenCalled();
    expect(screen.queryByTestId('vendor-prices')).toBeNull();
  });

  it('says the read failed, not nothing', async () => {
    api.vendor.mockRejectedValue(Object.assign(new Error('down'), { response: { status: 503, data: { message: 'down' } } }));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/Other vendors.{1,3}prices could not be read, so none were compared/)).toBeTruthy();
  });
});
