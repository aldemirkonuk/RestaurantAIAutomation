/**
 * ReceiptsNext contracts — the four-requirement brief under test: edits PATCH
 * with the recomputed tie-out shown, a verified document locks its lines, the
 * ceremony asserts transcription only, deliveries without paperwork share the
 * surface, and E49 tri-state honesty holds.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({
  queue: [] as ProcurementDocument[],
  verified: [] as ProcurementDocument[],
  unverified: { items: [] as unknown[] },
  detail: { document: {}, lines: [] as unknown[], links: [] },
  editLine: vi.fn(),
  verify: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: (opts: { status?: string }) =>
        Promise.resolve(opts.status === 'verified' ? api.verified : api.queue),
      detail: () => Promise.resolve(api.detail),
      editLine: api.editLine,
      verify: api.verify,
      match: vi.fn(),
      linkLine: vi.fn(),
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve(api.unverified) },
}));
vi.mock('../../../services/api/orders', () => ({
  getOrder: () => Promise.resolve({ id: 'o1', orderNumber: 'PO-14', providerName: 'Bodega Álvaro' }),
}));

import ReceiptsNext from './ReceiptsNext';

function doc(over: Partial<ProcurementDocument>): ProcurementDocument {
  return {
    id: 'd1',
    doc_type: 'invoice',
    source_channel: 'email',
    doc_number: 'INV-88',
    doc_date: '2026-08-28',
    status: 'needs_review',
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
    ...over,
  };
}

const line = {
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
  allowance: null,
  order_line_id: null,
};

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  api.queue = [doc({})];
  api.verified = [];
  api.unverified = { items: [] };
  api.detail = { document: doc({}), lines: [line], links: [] };
  api.editLine.mockReset();
  api.editLine.mockResolvedValue({
    line: { ...line, qty: 11 },
    tieOut: { computedLinesTotal: 202.4, tieOutDelta: -210.1, tiesOut: false },
  });
  api.verify.mockClear();
});

async function openFirstDoc() {
  fireEvent.click(await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? '')));
  await screen.findByLabelText('Quantity, line 1');
}

describe('ReceiptsNext', () => {
  it('edits a line in place and shows the recomputed tie-out immediately', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);
    await vi.waitFor(() => expect(api.editLine).toHaveBeenCalledWith('d1', 'l1', { qty: 11 }));
    await vi.waitFor(() => expect(container.textContent).toContain('off by $210.10'));
  });

  it('locks the lines of a verified document, with the reason in words', async () => {
    api.queue = [doc({ status: 'verified' as ProcurementDocument['status'] })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.getByLabelText('Quantity, line 1')).toBeDisabled();
    expect(screen.getByText(/record a dispute leans on/)).toBeInTheDocument();
    // no ceremony on a verified document
    expect(screen.queryByText('Swipe up to confirm')).not.toBeInTheDocument();
  });

  it('the ceremony fires verify via the keyboard hold and says what it asserts', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.getByText(/does not accept charges or touch stock/)).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: /Swipe up to confirm/ });
    fireEvent.keyDown(handle, { key: ' ' });
    await vi.waitFor(() => expect(api.verify).toHaveBeenCalledWith('d1'), { timeout: 3000 });
  });

  it('deliveries without paperwork share the surface', async () => {
    api.unverified = {
      items: [{ orderId: 'o9', orderNumber: 'PO-9', countedQtyBottles: 24, countedAt: '', ageHours: 5, severity: 'fresh' }],
    };
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/Counted at the door, no paperwork yet/)).toBeInTheDocument();
    expect(screen.getByText(/PO-9 · 24 btl · 5h ago/)).toBeInTheDocument();
  });

  it('a null tie-out is untestable, never a pass or a fail', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await screen.findByLabelText('Awaiting review');
    await vi.waitFor(() => expect(container.textContent).toContain('tie-out —'));
    await openFirstDoc();
    expect(container.textContent).toContain('no stated total to test against');
  });
});
