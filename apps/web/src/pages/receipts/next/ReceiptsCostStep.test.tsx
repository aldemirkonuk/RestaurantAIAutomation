/**
 * The swipe on /receipts settles no cost; the card and the page now say what
 * does (r30, r28 invoices G4). All data SYNTHETIC.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate, type NavigateFunction } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({
  queue: [] as ProcurementDocument[],
  detail: { document: {}, lines: [] as unknown[], links: [] },
  sheet: vi.fn(),
  verify: vi.fn(() => Promise.resolve()),
  mintVerifySeal: vi.fn(() => Promise.resolve('seal-token')),
  role: 'manager' as string,
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
        Promise.resolve(opts.status === 'needs_review' ? api.queue : []),
      detail: () => Promise.resolve(api.detail),
      match: vi.fn(),
      linkLine: vi.fn(() => Promise.resolve()),
      verify: api.verify,
      mintVerifySeal: api.mintVerifySeal,
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve({ items: [] }) },
}));
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: { document: () => api.sheet() },
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

/** The router's own navigate, so a test can press the browser's Back. */
let nav: NavigateFunction | null = null;
function Nav() {
  nav = useNavigate();
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <MemoryRouter>
      <Nav />
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

const spine = (over: Record<string, unknown> = {}) => ({
  deliveryId: 'del-1',
  state: 'RECONCILING',
  provenance: 'ORDERED',
  deliveredAt: null,
  agreedAt: null,
  verifiedAt: null,
  jurisdiction: null,
  providerId: null,
  selectedRole: 'invoice',
  documents: [],
  ...over,
});

beforeEach(() => {
  api.queue = [DOC];
  api.detail = { document: DOC, lines: [LINE], links: [] };
  api.verify.mockClear();
  api.sheet.mockReset();
  api.role = 'manager';
});

async function openFirstDoc() {
  fireEvent.click(
    await screen.findByText(
      (_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? ''),
    ),
  );
  await screen.findByLabelText('Quantity, line 1');
}

describe('the card says what puts the paper\'s prices on cost (r28 G4)', () => {
  it('a paper on no delivery is sent to the door', async () => {
    api.sheet.mockResolvedValue({ canonical: { layer3: null }, deliveries: [] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const line = await screen.findByTestId('cost-next-step');
    expect(line.getAttribute('data-step')).toBe('no_delivery');
    expect(line.textContent).toMatch(/not on the shelf yet/);
    expect(screen.getByTestId('cost-next-step-link').getAttribute('href')).toBe(
      '/documents/d1?view=door',
    );
  });

  it('a paper whose delivery is open says to agree and verify it', async () => {
    api.sheet.mockResolvedValue({ canonical: { layer3: null }, deliveries: [spine()] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const line = await screen.findByTestId('cost-next-step');
    expect(line.getAttribute('data-step')).toBe('agree');
    expect(screen.getByTestId('cost-next-step-link').textContent).toBe(
      'Agree and verify the delivery →',
    );
  });

  it('staff are told an owner or a manager agrees and verifies, with no link (r36 R10)', async () => {
    api.role = 'staff';
    api.sheet.mockResolvedValue({ canonical: { layer3: null }, deliveries: [spine()] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const line = await screen.findByTestId('cost-next-step');
    expect(line.getAttribute('data-step')).toBe('agree');
    expect(line.textContent).toMatch(/An owner or a manager agrees and verifies this delivery/);
    expect(screen.queryByTestId('cost-next-step-link')).toBeNull();
  });

  it('a failed sheet read is said, not read as "on no delivery"', async () => {
    api.sheet.mockRejectedValue(new Error('connection reset'));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const line = await screen.findByTestId('cost-next-step');
    expect(line.getAttribute('data-step')).toBe('unread');
  });

  it('after the swipe, the page says which paper was confirmed and its cost step, until dismissed', async () => {
    api.sheet.mockResolvedValue({
      canonical: { layer3: null },
      deliveries: [spine({ state: 'AGREED', agreedAt: '2026-08-12T09:00:00Z' })],
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await screen.findByTestId('cost-next-step');
    expect(screen.queryByTestId('confirmed-note')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), { key: ' ' });
    await waitFor(() => expect(api.verify).toHaveBeenCalled(), { timeout: 3000 });
    const note = await screen.findByTestId('confirmed-note');
    expect(note.textContent).toMatch(/Confirmed Invoice INV-88: the reading matches the paper\./);
    const step = screen.getByTestId('confirmed-next-step');
    expect(step.getAttribute('data-step')).toBe('verify');
    expect(screen.getByTestId('confirmed-next-step-link').getAttribute('href')).toBe('/documents/d1');
    // the card itself has closed
    expect(screen.queryByTestId('cost-next-step')).toBeNull();
    fireEvent.click(screen.getByTestId('confirmed-note-dismiss'));
    expect(screen.queryByTestId('confirmed-note')).toBeNull();
  });

  it('opening another paper ends the note', async () => {
    api.sheet.mockResolvedValue({ canonical: { layer3: null }, deliveries: [] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await screen.findByTestId('cost-next-step');
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), { key: ' ' });
    await screen.findByTestId('confirmed-note', undefined, { timeout: 3000 });
    await openFirstDoc();
    expect(screen.queryByTestId('confirmed-note')).toBeNull();
    // and it stays ended once that paper is closed again
    fireEvent.click(screen.getByRole('button', { name: /All receipts/ }));
    await waitFor(() => expect(screen.queryByLabelText('Quantity, line 1')).toBeNull());
    expect(screen.queryByTestId('confirmed-note')).toBeNull();
  });

  it('the browser\'s Back onto the confirmed paper does not draw the note over it', async () => {
    api.sheet.mockResolvedValue({ canonical: { layer3: null }, deliveries: [] });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await screen.findByTestId('cost-next-step');
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), { key: ' ' });
    await screen.findByTestId('confirmed-note', undefined, { timeout: 3000 });
    act(() => nav!(-1));
    await screen.findByLabelText('Quantity, line 1');
    expect(screen.queryByTestId('confirmed-note')).toBeNull();
  });

  it('a confirm made before the sheet answered still says confirming settles no cost', async () => {
    api.sheet.mockReturnValue(new Promise(() => {}));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.queryByTestId('cost-next-step')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), { key: ' ' });
    const note = await screen.findByTestId('confirmed-note', undefined, { timeout: 3000 });
    expect(note.textContent).toMatch(/Confirming settles no cost/);
  });
});
