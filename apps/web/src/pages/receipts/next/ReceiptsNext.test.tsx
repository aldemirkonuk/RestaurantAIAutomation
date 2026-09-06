/**
 * ReceiptsNext contracts — the four-requirement brief under test: edits PATCH
 * with the recomputed tie-out shown, a verified document locks its lines, the
 * ceremony asserts transcription only, deliveries without paperwork share the
 * surface, and E49 tri-state honesty holds.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({
  queue: [] as ProcurementDocument[],
  verified: [] as ProcurementDocument[],
  unverified: { items: [] as unknown[] },
  detail: { document: {}, lines: [] as unknown[], links: [] },
  detailFails: null as unknown,
  unverifiedFails: null as unknown,
  editLine: vi.fn(),
  linkLine: vi.fn(() => Promise.resolve()),
  verify: vi.fn(() => Promise.resolve()),
  restaurantId: 'rest-A' as string | null,
  /** The caller's role at this house, for rule 3's control. */
  role: 'manager' as 'owner' | 'manager' | 'staff' | null,
  restateCurrency: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: api.restaurantId, activeRole: api.role, user: null }),
  // `useMudavymDesign` reads the CONTEXT OBJECT directly (not the hook), so a
  // mock that exports only `useAuth` makes any gated affordance on this page
  // throw at render. DocView gained one with ADR 0104 slice 2's
  // "Open as the canonical document" link.
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: (opts: { status?: string }) =>
        Promise.resolve(opts.status === 'verified' ? api.verified : api.queue),
      detail: () => (api.detailFails ? Promise.reject(api.detailFails) : Promise.resolve(api.detail)),
      editLine: api.editLine,
      verify: api.verify,
      match: vi.fn(),
      linkLine: api.linkLine,
      restateCurrency: api.restateCurrency,
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: {
    listUnverified: () =>
      api.unverifiedFails ? Promise.reject(api.unverifiedFails) : Promise.resolve(api.unverified),
  },
}));
vi.mock('../../../services/api/orders', () => ({
  getOrder: () =>
    Promise.resolve({
      id: 'o1',
      orderNumber: 'PO-14',
      providerName: 'Bodega Álvaro',
      wineName: 'Albariño',
      quantity: 12,
    }),
}));

import ReceiptsNext, { PaperPane } from './ReceiptsNext';
import { isSignedUrlExpired } from './rc2-format';

function doc(over: Partial<ProcurementDocument>): ProcurementDocument {
  return {
    id: 'd1',
    doc_type: 'invoice',
    source_channel: 'email',
    doc_number: 'INV-88',
    doc_date: '2026-08-28',
    status: 'needs_review',
    // The document's OWN money, stated. `procurement_documents.currency` has
    // always been in the payload and this fixture simply never carried it,
    // which is why every figure this page printed wore a hardcoded dollar sign
    // (fixed 2026-09-06; `rc2-format.ts`'s `fmtMoney`). A fixture with no
    // currency now renders "(currency not recorded)", which is the honest
    // output and is asserted directly below.
    currency: 'USD',
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

let lastQc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQc = qc;
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

/**
 * The same wrapper, entered at a URL. `?doc=<id>` is the link the receiving
 * workspace hands a manager when it refuses a unit price, so the query string
 * is a real entry point and not decoration.
 */
function wrapperAt(entry: string) {
  return function Wrapped({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    lastQc = qc;
    return (
      <MemoryRouter initialEntries={[entry]}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  };
}

beforeEach(() => {
  api.queue = [doc({})];
  api.verified = [];
  api.unverified = { items: [] };
  api.detail = { document: doc({}), lines: [line], links: [] };
  api.detailFails = null;
  api.unverifiedFails = null;
  api.restaurantId = 'rest-A';
  api.linkLine.mockClear();
  api.editLine.mockReset();
  api.editLine.mockResolvedValue({
    line: { ...line, qty: 11 },
    tieOut: { computedLinesTotal: 202.4, tieOutDelta: -210.1, tiesOut: false },
  });
  api.verify.mockClear();
  api.role = 'manager';
  api.restateCurrency.mockReset();
  api.restateCurrency.mockResolvedValue({
    currency: 'TRY',
    previousCurrency: null,
    sentence:
      'Currency restated from NOT RECORDED (its money was withheld) to TRY. Its stated total of 412.50 is now TRY.',
    moneyRefiled: true,
    linesRefiled: 1,
    lineFailures: [],
  });
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
    await waitFor(() => expect(api.editLine).toHaveBeenCalledWith('d1', 'l1', { qty: 11 }));
    await waitFor(() => expect(container.textContent).toContain('off by $210.10'));
  });

  it('locks the lines of a verified document, with the reason in words', async () => {
    api.queue = [doc({ status: 'verified' as ProcurementDocument['status'] })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    // readOnly, not disabled — the figures stay reachable to assistive tech
    expect(screen.getByLabelText('Quantity, line 1')).toHaveAttribute('readonly');
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
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith('d1'), { timeout: 3000 });
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
    await waitFor(() => expect(container.textContent).toContain('tie-out —'));
    await openFirstDoc();
    expect(container.textContent).toContain('no stated total to test against');
  });

  /* ─── R1 — the page must show the paper it asks a human to certify ─────── */

  it('renders the stored scan from the DETAIL response, not the list row', async () => {
    // The gateway signs `imageUrl` only inside the detail handler
    // (documents.controller.ts:189-203). The list row never carries one, which
    // is why the old `doc.imageUrl` gate never fired.
    api.detail = {
      document: doc({ storage_path: 'r/1/inv.jpg', imageUrl: 'https://signed.example/inv.jpg?token=x' }),
      lines: [line],
      links: [],
    };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const img = await screen.findByAltText('Stored document');
    expect(img).toHaveAttribute('src', 'https://signed.example/inv.jpg?token=x');
    expect(screen.getByText('Open the paper ↗')).toHaveAttribute(
      'href',
      'https://signed.example/inv.jpg?token=x',
    );
  });

  it('an aged-out signed link says it aged out instead of rendering a dead image', async () => {
    // The gateway signs for 3600s (documents.controller.ts:195). Past that the
    // link is spent, and a spent link must not render as a broken image — on
    // this screen that reads as "there is no paper".
    expect(isSignedUrlExpired(Date.now(), Date.now())).toBe(false);
    expect(isSignedUrlExpired(Date.now() - 3_600_000, Date.now())).toBe(true);
    // fetchedAt of 0 means "never fetched", which is not "expired".
    expect(isSignedUrlExpired(0, Date.now())).toBe(false);

    render(
      <PaperPane
        doc={doc({ storage_path: 'r/1/inv.jpg', imageUrl: 'https://signed.example/inv.jpg' })}
        detailKnown
        fetchedAt={Date.now() - 3_600_000}
        onRefresh={() => {}}
        refreshing={false}
      />,
      { wrapper },
    );
    expect(screen.queryByAltText('Stored document')).not.toBeInTheDocument();
    expect(screen.getByText(/aged out/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fetch a fresh link/ })).toBeInTheDocument();
  });

  it('distinguishes "no file was stored" from "the link could not be made"', async () => {
    api.detail = { document: doc({ storage_path: null, source_channel: 'edi' }), lines: [line], links: [] };
    const view = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/No file was stored for this document/)).toBeInTheDocument();
    view.unmount();

    api.detail = { document: doc({ storage_path: 'r/1/inv.jpg', imageUrl: null }), lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/a viewing link could not be created/)).toBeInTheDocument();
  });

  /* ─── R2 — tenant keying ──────────────────────────────────────────────── */

  it('every list query key carries the active restaurant id', async () => {
    render(<ReceiptsNext />, { wrapper });
    await screen.findByLabelText('Awaiting review');
    await waitFor(() => expect(lastQc.getQueryCache().getAll().length).toBeGreaterThan(2));
    const keys = lastQc.getQueryCache().getAll().map((q) => q.queryKey as unknown[]);
    for (const name of ['queue', 'verified', 'unverified-deliveries']) {
      const k = keys.find((key) => key[0] === 'receipts-next' && key[1] === name);
      expect(k, `no ${name} query key`).toBeTruthy();
      expect(k, `${name} key does not carry the tenant`).toContain('rest-A');
    }
  });

  it('no restaurant means the queue is unknown, not caught up', async () => {
    api.restaurantId = null;
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/No restaurant is selected/)).toBeInTheDocument();
    expect(screen.queryByText(/the paper trail is caught up/)).not.toBeInTheDocument();
    // and no unkeyed bucket was created for the tenant-scoped lists
    const keys = lastQc.getQueryCache().getAll().map((q) => q.queryKey as unknown[]);
    expect(keys.some((k) => k[0] === 'receipts-next' && k.includes(''))).toBe(false);
  });

  /* ─── R3 — three honesty defects ──────────────────────────────────────── */

  it('a full queue window renders as a floor, not a total', async () => {
    api.queue = Array.from({ length: 100 }, (_, i) => doc({ id: `d${i}`, doc_number: `INV-${i}` }));
    const { container } = render(<ReceiptsNext />, { wrapper });
    await waitFor(() => expect(container.textContent).toContain('≥100 awaiting review'));
  });

  it('a failed detail fetch says the failure, and never claims an empty invoice', async () => {
    api.detailFails = Object.assign(new Error('Request failed with status code 503'), {
      response: { status: 503, data: { message: 'documents backend is down' } },
    });
    const { container } = render(<ReceiptsNext />, { wrapper });
    fireEvent.click(
      await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? '')),
    );
    await waitFor(() => expect(container.textContent).toContain('documents backend is down'));
    expect(container.textContent).toContain('unknown, not empty');
    expect(container.textContent).not.toContain('No lines were extracted');
  });

  it('a failed uncounted-deliveries query is surfaced, not read as a caught-up door', async () => {
    api.unverifiedFails = new Error('receiving endpoint 500');
    const { container } = render(<ReceiptsNext />, { wrapper });
    await screen.findByLabelText('Awaiting review');
    await waitFor(() =>
      expect(container.textContent).toContain('the deliveries counted at the door'),
    );
  });

  /* ─── R4 — the confidence the screen asks trust in ────────────────────── */

  it('shows document extraction confidence, and an em dash when none was recorded', async () => {
    api.detail = { document: doc({ extraction_confidence: 0.82 }), lines: [line], links: [] };
    const view = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/extraction confidence 82%/)).toBeInTheDocument();
    view.unmount();

    api.detail = { document: doc({ extraction_confidence: null }), lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/extraction confidence —/)).toBeInTheDocument();
  });

  /* ─── R5 — an auto-applied pairing is inspectable and undoable ─────────── */

  it('a paired line names its target and can be unlinked', async () => {
    api.detail = {
      document: doc({}),
      lines: [{ ...line, order_line_id: 'ol-abcdef12-9', match_method: 'vendor_sku', match_confidence: 0.97 }],
      links: [],
    };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await waitFor(() => expect(container.textContent).toContain('paired → Albariño'));
    expect(container.textContent).toContain('order line #ol-abcde');
    expect(container.textContent).toContain('confidence 97%');
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }));
    await waitFor(() => expect(api.linkLine).toHaveBeenCalledWith('d1', 'l1', null));
  });

  it('an unpaired line says "not paired", not a bare dash', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(container.textContent).toContain('not paired');
  });

  /* ─── R6 — the server's own words, and the pre-edit figure ────────────── */

  it("a rejected edit shows the server's sentence, not a hardcoded one", async () => {
    api.editLine.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: { message: 'Only a document awaiting review can be edited — this one is verified.' } },
      }),
    );
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);
    expect(await screen.findByText(/Only a document awaiting review can be edited/)).toBeInTheDocument();
  });

  it('keeps the extracted figure beside a corrected cell, with an undo', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);
    await waitFor(() => expect(api.editLine).toHaveBeenCalled());
    expect(await screen.findByText(/extracted 12/)).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: /Undo quantity on line 1/ });
    api.editLine.mockClear();
    fireEvent.click(undo);
    await waitFor(() => expect(api.editLine).toHaveBeenCalledWith('d1', 'l1', { qty: 12 }));
  });
});

/**
 * RULE 3, AND THE MONEY THAT NAMES ITS CURRENCY — founder, 2026-09-06.
 *
 * The page printed a hardcoded `$` on every figure until this pass, including
 * on the two TRY invoices production already holds. These pin the three things
 * that had to become true: money states its currency, a HELD document says so
 * in the server's own words, and the deliberate change is a manager's act that
 * staff can see and cannot take.
 */
describe('ReceiptsNext — what money this invoice is in', () => {
  it('prints the DOCUMENT\'s own currency, not a dollar sign', async () => {
    api.queue = [doc({ currency: 'TRY', total: 412.5 })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(container.textContent).toContain('Filed in TRY - Turkish lira');
    expect(container.textContent).not.toContain('$412.50');
  });

  it('says "currency not recorded" rather than assuming one', async () => {
    api.queue = [doc({ currency: null, total: 412.5 })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(container.textContent).toContain('412.50 (currency not recorded)');
    expect(container.textContent).toContain('nothing on this document is priced');
  });

  it('renders the HOLD in the server\'s own words, verbatim', async () => {
    const held =
      'MONEY HELD, NOT FILED. This document would be filed under USD, and the model read "\u20BA" at beside the grand total, which is TRY and not USD.';
    api.queue = [doc({ currency: null, total: null, notes: held })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    // Both currencies AND the location, because the client cannot reconstruct
    // any of the three.
    expect(container.textContent).toContain('MONEY HELD, NOT FILED');
    expect(container.textContent).toContain('beside the grand total');
  });

  it('restates the currency and shows what the server said moved', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.change(screen.getByLabelText("Currency this invoice is denominated in"), {
      target: { value: 'TRY' },
    });
    fireEvent.click(screen.getByText('Restate the currency'));
    await waitFor(() =>
      expect(api.restateCurrency).toHaveBeenCalledWith('d1', 'TRY', undefined),
    );
    expect(await screen.findByText(/Currency restated from NOT RECORDED/)).toBeTruthy();
  });

  it('disables the control for staff WITH the sentence, and never hides it', async () => {
    api.role = 'staff';
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    // Visible, and refused in words that name who can do it.
    const picker = screen.getByLabelText("Currency this invoice is denominated in");
    expect((picker as HTMLSelectElement).disabled).toBe(true);
    expect(container.textContent).toContain('You are signed in as staff at this house');
    expect(container.textContent).toContain('Ask a manager or an owner');
    expect(api.restateCurrency).not.toHaveBeenCalled();
  });

  it('says a failed restatement failed, in the gateway\'s words', async () => {
    api.restateCurrency.mockRejectedValue({
      response: { status: 500, data: { message: 'the change could not be recorded' } },
    });
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.change(screen.getByLabelText("Currency this invoice is denominated in"), {
      target: { value: 'EUR' },
    });
    fireEvent.click(screen.getByText('Restate the currency'));
    expect(await screen.findByText(/the change could not be recorded/)).toBeTruthy();
  });
});


/**
 * THE DEEP LINK — `?doc=<id>`.
 *
 * [[receiving]] refuses a keyed-in unit price for an invoice whose money is
 * held and links here so the manager can restate or confirm the currency
 * (founder, 2026-09-06 batch 64; batch 66's *"Two screens, for now"* is what
 * keeps the act on this page rather than inside the receiving workspace). The
 * audit of `6c0933d3` found the behaviour correct by inspection and untested:
 * a link that lands on the queue without opening the document names an act the
 * reader then has to go and find.
 */
describe('ReceiptsNext — ?doc=<id> opens that document', () => {
  it('opens the document named in the query string, without a click', async () => {
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=d1') });
    // The line editor is only rendered for an OPEN document, so finding it is
    // the assertion that the deep link selected one.
    expect(await screen.findByLabelText('Quantity, line 1')).toBeTruthy();
  });

  it('lands on the queue, opening nothing, when the id names no document here', async () => {
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=not-a-document') });
    // The queue still renders; nothing is opened, and nothing throws.
    await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? ''));
    expect(screen.queryByLabelText('Quantity, line 1')).toBeNull();
  });

  it('does not fight a person who then opens a different row', async () => {
    // Seeded ONCE from the URL: re-selecting from the query string on every
    // render would take the choice back off the reader.
    api.queue = [doc({}), doc({ id: 'd2', doc_number: 'INV-99' })];
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=d1') });
    await screen.findByLabelText('Quantity, line 1');
    fireEvent.click(
      await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-99/.test(el.textContent ?? '')),
    );
    await waitFor(() => expect(screen.getAllByText(/INV-99/).length).toBeGreaterThan(0));
  });
});
