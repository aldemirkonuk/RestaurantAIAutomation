/**
 * ReceiptsNext contracts — the four-requirement brief under test: edits PATCH
 * with the recomputed tie-out shown, a verified document locks its lines, the
 * ceremony asserts transcription only, deliveries without paperwork share the
 * surface, and E49 tri-state honesty holds.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({
  queue: [] as ProcurementDocument[],
  verified: [] as ProcurementDocument[],
  /** Papers that read cleanly, `status = received` (W44). */
  clean: [] as ProcurementDocument[],
  unverified: { items: [] as unknown[] },
  detail: { document: {}, lines: [] as unknown[], links: [] },
  detailFails: null as unknown,
  unverifiedFails: null as unknown,
  /** Rejects both list reads (queue and verified book) when set. */
  listFails: null as unknown,
  /** Holds the clean-papers read (`status = received`) open forever when set (W48). */
  cleanPending: false,
  /** Holds the door-count read open forever when set (W50b). */
  doorPending: false,
  /** Rejects only the clean-papers read when set (W49). */
  cleanFails: null as unknown,
  /** Rejects only the verified-book read when set (W49). */
  verifiedFails: null as unknown,
  editLine: vi.fn(),
  linkLine: vi.fn(() => Promise.resolve()),
  /** W37: rejects the order read when set; `orderOver` overrides its fields. */
  orderFails: null as unknown,
  orderOver: {} as Record<string, unknown>,
  verify: vi.fn(() => Promise.resolve()),
  restaurantId: 'rest-A' as string | null,
  /** The sheet's recomputed verdict; `null` leaves the canonical read pending. */
  sheetLayer3: null as null | { tiesOut: boolean | null; tieOutDeltaCents: number | null },
  /** The caller's role at this house, for rule 3's control. */
  role: 'manager' as 'owner' | 'manager' | 'staff' | null,
  restateCurrency: vi.fn(),
  /**
   * The three mints (founder, 2026-09-06, batch 64: "Decide as a module: seal
   * all three"). Each returns a token the write then has to carry back; the
   * gateway's own refusals are proven in `documents.seal.spec.ts`.
   */
  mintVerifySeal: vi.fn(() => Promise.resolve('seal-verify' as string | null)),
  mintLineEditSeal: vi.fn(() => Promise.resolve('seal-edit' as string | null)),
  mintCurrencySeal: vi.fn(() => Promise.resolve('seal-currency' as string | null)),
  /**
   * `GET /procurement/receiving/paper-owed` (RECEIPTS-W53): the checked
   * deliveries with no invoice filed. `paperOwedGets` counts the asks, so a
   * staff session can be shown never to spend one.
   */
  paperOwed: null as unknown,
  paperOwedFails: null as unknown,
  paperOwedPending: false,
  paperOwedGets: 0,
}));

/** A count of zero, read whole: the only answer that may say "caught up". */
const NONE_OWED = {
  count: 0,
  complete: true,
  checkedRead: 0,
  oldestAt: null,
  items: [],
  listMax: 20,
  vendorNamesUnavailable: false,
};

// The paper-owed read goes through the shared client (the page's hook asks it
// directly). Every other read keeps the real client, as before this mock.
vi.mock('../../../services/api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/client')>();
  const get = ((url: string, ...rest: unknown[]) => {
    if (url !== '/procurement/receiving/paper-owed')
      return (mod.apiClient.get as (...a: unknown[]) => unknown)(url, ...rest);
    api.paperOwedGets += 1;
    if (api.paperOwedPending) return new Promise(() => {});
    if (api.paperOwedFails) return Promise.reject(api.paperOwedFails);
    return Promise.resolve({ data: api.paperOwed });
  }) as typeof mod.apiClient.get;
  const apiClient = Object.assign(Object.create(mod.apiClient), mod.apiClient, { get });
  return { ...mod, apiClient, default: apiClient };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: api.restaurantId, activeRole: api.role, user: null }),
  // `useMudavymDesign` reads the CONTEXT OBJECT directly (not the hook), so a
  // mock that exports only `useAuth` makes any gated affordance on this page
  // throw at render. DocView gained one with ADR 0104 slice 2's
  // "Open this document on its own page" link (named "Open as the canonical
  // document" until walk-through W23).
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: (opts: { status?: string }) =>
        api.listFails
          ? Promise.reject(api.listFails)
          : opts.status === 'received' && api.cleanFails
            ? Promise.reject(api.cleanFails)
          : opts.status === 'verified' && api.verifiedFails
            ? Promise.reject(api.verifiedFails)
          : opts.status === 'received' && api.cleanPending
            ? new Promise<never>(() => {})
            : Promise.resolve(
              opts.status === 'verified'
                ? api.verified
                : opts.status === 'received'
                  ? api.clean
                  : api.queue,
            ),
      detail: () => (api.detailFails ? Promise.reject(api.detailFails) : Promise.resolve(api.detail)),
      editLine: api.editLine,
      verify: api.verify,
      match: vi.fn(),
      linkLine: api.linkLine,
      restateCurrency: api.restateCurrency,
      mintVerifySeal: api.mintVerifySeal,
      mintLineEditSeal: api.mintLineEditSeal,
      mintCurrencySeal: api.mintCurrencySeal,
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: {
    listUnverified: () =>
      api.doorPending
        ? new Promise(() => {})
        : api.unverifiedFails
          ? Promise.reject(api.unverifiedFails)
          : Promise.resolve(api.unverified),
  },
}));
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: {
    document: () =>
      api.sheetLayer3
        ? Promise.resolve({ canonical: { layer3: api.sheetLayer3 } })
        : new Promise(() => {}),
  },
}));
vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: ({ documentId, embedded }: { documentId?: string; embedded?: boolean }) => (
    <div data-testid="formatted-document" data-id={documentId} data-embedded={embedded ? 'yes' : 'no'} />
  ),
}));

vi.mock('../../../services/api/orders', () => ({
  getOrder: () =>
    api.orderFails
      ? Promise.reject(api.orderFails)
      : Promise.resolve({
          id: 'o1',
          orderNumber: 'PO-14',
          providerName: 'Bodega Álvaro',
          wineName: 'Albariño',
          quantity: 12,
          ...api.orderOver,
        }),
}));

import ReceiptsNext, { PaperPane } from './ReceiptsNext';
import { fmtDate, isSignedUrlExpired } from './rc2-format';

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
  api.clean = [];
  api.unverified = { items: [] };
  api.detail = { document: doc({}), lines: [line], links: [] };
  api.detailFails = null;
  api.orderFails = null;
  api.orderOver = {};
  api.unverifiedFails = null;
  api.listFails = null;
  api.cleanPending = false;
  api.doorPending = false;
  api.cleanFails = null;
  api.verifiedFails = null;
  api.paperOwed = NONE_OWED;
  api.paperOwedFails = null;
  api.paperOwedPending = false;
  api.paperOwedGets = 0;
  api.restaurantId = 'rest-A';
  api.sheetLayer3 = null;
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

/**
 * Complete a `HoldToApprove` gesture by its keyboard path: Enter arms it (and
 * begins the mint, which is the whole point of the timing), Enter again
 * approves. The pointer path is a timed rAF hold and is not what these contracts
 * are about.
 */
function holdToApprove(name: RegExp) {
  const control = screen.getByRole('button', { name });
  fireEvent.keyDown(control, { key: 'Enter' });
  fireEvent.keyDown(control, { key: 'Enter' });
}

describe('ReceiptsNext', () => {
  it('edits a line in place and shows the recomputed tie-out immediately', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);
    // A moved cell is a PENDING correction, not a write (founder, 2026-09-06).
    expect(await screen.findByText(/Nothing has been written yet/)).toBeTruthy();
    expect(api.editLine).not.toHaveBeenCalled();
    holdToApprove(/Hold to seal this correction/);
    await waitFor(() =>
      expect(api.mintLineEditSeal).toHaveBeenCalledWith('d1', 'l1', { qty: 11 }),
    );
    await waitFor(() =>
      expect(api.editLine).toHaveBeenCalledWith('d1', 'l1', { qty: 11 }, 'seal-edit'),
    );
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
    // The seal is minted when the gesture BEGINS, and the write carries it back.
    await waitFor(() => expect(api.mintVerifySeal).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith('d1', 'seal-verify'), {
      timeout: 3000,
    });
  });

  it('deliveries counted by the case share the surface, labelled as what they are (RECEIPTS-W53)', async () => {
    api.unverified = {
      items: [{ orderId: 'o9', orderNumber: 'PO-9', countedQtyBottles: 24, countedAt: '', ageHours: 5, severity: 'fresh' }],
    };
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('Counted by the case, not yet by bottle')).toBeInTheDocument();
    // Counted by the case is not "no paperwork": they may well have paper.
    expect(container.textContent).not.toMatch(/no paperwork yet/);
    expect(screen.getByText(/PO-9 · 24 counted · 5h ago/)).toBeInTheDocument();
  });

  it('the door strip says neither "btl" nor a slice of the order id (W38)', async () => {
    api.unverified = {
      items: [{ orderId: 'o9abcdef-1234', orderNumber: null, countedQtyBottles: 6, countedAt: '', ageHours: 2, severity: 'fresh' }],
    };
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/an order with no number · 6 counted · 2h ago/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('btl');
    expect(container.textContent).not.toContain('o9abcdef');
  });

  it('a null tie-out is untestable, never a pass or a fail', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await screen.findByLabelText('Awaiting review');
    await waitFor(() => expect(container.textContent).toContain('no stated total'));
    await openFirstDoc();
    expect(container.textContent).toContain('No stated total to test the lines against.');
  });

  /* ─── R1 — the page must show the paper it asks a human to certify ─────── */

  it('renders the stored scan from the DETAIL response, not the list row', async () => {
    // The gateway signs `imageUrl` only inside the detail handler
    // (documents.controller.ts:189-203). The list row never carries one, which
    // is why the old `doc.imageUrl` gate never fired. Since the 2026-10-01
    // walk-through (W2) the pane is brought on demand from the formatted sheet
    // (`OriginalPane` reuses `PaperPane`), so the pane is asserted directly.
    render(
      <PaperPane
        doc={doc({ storage_path: 'r/1/inv.jpg', imageUrl: 'https://signed.example/inv.jpg?token=x' })}
        detailKnown
        fetchedAt={Date.now()}
        onRefresh={() => {}}
        refreshing={false}
      />,
      { wrapper },
    );
    const img = await screen.findByAltText('Stored document');
    expect(img).toHaveAttribute('src', 'https://signed.example/inv.jpg?token=x');
    expect(screen.getByText('Open the paper ↗')).toHaveAttribute(
      'href',
      'https://signed.example/inv.jpg?token=x',
    );
  });

  it('the review card does not restate the paper or the money the sheet above shows', async () => {
    // Founder, 2026-10-01 (W2): "Sheet first, card trimmed". The paper and the
    // stated total belong to the formatted sheet; a second copy in the card
    // squeezed the lines into half the width.
    api.detail = {
      document: doc({ storage_path: 'r/1/inv.jpg', imageUrl: 'https://signed.example/inv.jpg?token=x' }),
      lines: [line],
      links: [],
    };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.getByRole('heading', { name: 'Check and correct' })).toBeInTheDocument();
    expect(screen.queryByAltText('Stored document')).not.toBeInTheDocument();
    expect(screen.queryByText('Open the paper ↗')).not.toBeInTheDocument();
  });

  it('names each part of the card, and the pairing check sits with the order', async () => {
    // Founder, 2026-10-01 (W9/W10): "every component and detail can be read
    // easily … clear divisions".
    api.detail = { document: doc({}), lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const parts =screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(parts).toEqual(['The reading', 'The order', 'The money', 'The lines', 'Confirm']);
    const order = screen.getByRole('heading', { name: 'The order' }).parentElement!;
    expect(order).toHaveTextContent('Check line pairing');
    const lines = screen.getByRole('heading', { name: 'The lines' }).parentElement!;
    expect(lines).not.toHaveTextContent('Check line pairing');
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
    const pane = (d: ReturnType<typeof doc>) => (
      <PaperPane doc={d} detailKnown fetchedAt={Date.now()} onRefresh={() => {}} refreshing={false} />
    );
    const view = render(pane(doc({ storage_path: null, source_channel: 'edi' })), { wrapper });
    expect(await screen.findByText(/No file was stored for this document/)).toBeInTheDocument();
    view.unmount();

    render(pane(doc({ storage_path: 'r/1/inv.jpg', imageUrl: null })), { wrapper });
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

  it('no confirm over unread lines: a failed detail disables the swipe and says why (W18)', async () => {
    api.detailFails = Object.assign(new Error('Request failed with status code 503'), {
      response: { status: 503, data: { message: 'documents backend is down' } },
    });
    const { container } = render(<ReceiptsNext />, { wrapper });
    fireEvent.click(
      await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? '')),
    );
    await waitFor(() => expect(container.textContent).toContain('documents backend is down'));
    expect(screen.getByRole('button', { name: /Swipe up to confirm/ })).toBeDisabled();
    expect(screen.getByTestId('confirm-waits')).toHaveTextContent('They could not be read');
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

  it('says how sure the reader was, and says so when nothing was recorded (W23)', async () => {
    api.detail = { document: doc({ extraction_confidence: 0.82 }), lines: [line], links: [] };
    const view = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText('The reader was 82% sure of what it read.')).toBeInTheDocument();
    view.unmount();

    api.detail = { document: doc({ extraction_confidence: null }), lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText('The reader recorded no confidence for this document.')).toBeInTheDocument();
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
    await waitFor(() => expect(container.textContent).toContain('Albariño'));
    // W37 (2026-10-01): no database id, no wine word, certainty as a sentence.
    const cell = container.querySelector('td[data-cell="order"]')!;
    expect(cell.textContent).toContain("Albariño · 12 ordered · matched by the supplier's code · 97% sure of the match");
    expect(cell.textContent).not.toContain('ol-abcde');
    expect(cell.textContent).not.toContain('confidence');
    // W6 (2026-10-01): the method in words, the column named for what it holds.
    expect(container.textContent).toContain("matched by the supplier's code");
    expect(container.textContent).not.toContain('vendor_sku');
    expect(screen.getByRole('columnheader', { name: 'Order line' })).toBeInTheDocument();
    // W37: each Unlink names its line, and sits on its own line under the sentence.
    const unlink = screen.getByRole('button', { name: 'Unlink line 1 from the order' });
    expect(unlink.textContent).toBe('Unlink');
    expect(unlink.style.display).toBe('block');
    fireEvent.click(unlink);
    await waitFor(() => expect(api.linkLine).toHaveBeenCalledWith('d1', 'l1', null));
  });

  it('a paired line whose order cannot be read says so, naming no wine and no id (W37)', async () => {
    api.orderFails = new Error('500');
    api.detail = {
      document: doc({}),
      lines: [{ ...line, order_line_id: 'ol-abcdef12-9', match_method: 'description', match_confidence: 0.94 }],
      links: [],
    };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const cell = () => container.querySelector('td[data-cell="order"]')!;
    await waitFor(() =>
      expect(cell().textContent).toContain(
        'paired with the order, which could not be read to name the item · matched by the description · 94% sure of the match',
      ),
    );
    expect(cell().textContent).not.toMatch(/wine|ol-abcde/);
  });

  it('a paired line with no recorded method, certainty or item name says each in words (W37)', async () => {
    api.orderOver = { wineName: undefined, quantity: undefined };
    api.detail = {
      document: doc({}),
      lines: [{ ...line, order_line_id: 'ol-abcdef12-9', match_method: null, match_confidence: null }],
      links: [],
    };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const cell = () => container.querySelector('td[data-cell="order"]')!;
    await waitFor(() =>
      expect(cell().textContent).toContain(
        'the order does not name the item · — ordered · how it was matched is not recorded · certainty not recorded',
      ),
    );
  });

  it('an unpaired line says it has no order line yet, not a bare dash', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(container.textContent).toContain('no order line yet');
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
    await screen.findByText(/Nothing has been written yet/);
    holdToApprove(/Hold to seal this correction/);
    expect(await screen.findByText(/Only a document awaiting review can be edited/)).toBeInTheDocument();
  });

  it('keeps the extracted figure beside a corrected cell, with an undo', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);
    await screen.findByText(/Nothing has been written yet/);
    holdToApprove(/Hold to seal this correction/);
    await waitFor(() => expect(api.editLine).toHaveBeenCalled());
    expect(await screen.findByText(/extracted 12/)).toBeInTheDocument();
    const undo = screen.getByRole('button', { name: /Undo quantity on line 1/ });
    api.editLine.mockClear();
    fireEvent.click(undo);
    // The undo is a correction like any other: it stages, and the hold sends it.
    await screen.findByText(/Nothing has been written yet/);
    holdToApprove(/Hold to seal this correction/);
    await waitFor(() =>
      expect(api.editLine).toHaveBeenCalledWith('d1', 'l1', { qty: 12 }, 'seal-edit'),
    );
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
    expect(container.textContent).toContain('filed in Turkish lira (TRY)');
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
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
    fireEvent.change(screen.getByLabelText("Currency this invoice is denominated in"), {
      target: { value: 'TRY' },
    });
    holdToApprove(/Hold to file this invoice in TRY/);
    await waitFor(() => expect(api.mintCurrencySeal).toHaveBeenCalledWith('d1', 'TRY'));
    await waitFor(() =>
      expect(api.restateCurrency).toHaveBeenCalledWith('d1', 'TRY', undefined, 'seal-currency'),
    );
    expect(await screen.findByText(/Currency restated from NOT RECORDED/)).toBeTruthy();
  });

  it('disables the control for staff WITH the sentence, and never hides it', async () => {
    api.role = 'staff';
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    // The fold never hides the act: staff see the opener too (W9).
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
    fireEvent.change(screen.getByLabelText("Currency this invoice is denominated in"), {
      target: { value: 'EUR' },
    });
    holdToApprove(/Hold to file this invoice in EUR/);
    expect(await screen.findByText(/the change could not be recorded/)).toBeTruthy();
  });

  it('folds a filed, unheld currency to one line, and "Keep" folds it back (W9)', async () => {
    api.queue = [doc({ currency: 'TRY', total: 412.5 })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.getByLabelText('What money this invoice is in')).toHaveTextContent(
      "This invoice’s money is filed in Turkish lira (TRY).",
    );
    expect(screen.queryByLabelText('Currency this invoice is denominated in')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
    expect(screen.getByLabelText('Currency this invoice is denominated in')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep TRY' }));
    expect(screen.queryByLabelText('Currency this invoice is denominated in')).toBeNull();
  });

  it('moves focus with the fold: into the picker on open, back to "Change" on keep (W12)', async () => {
    api.queue = [doc({ currency: 'TRY', total: 412.5 })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
    expect(screen.getByLabelText('Currency this invoice is denominated in')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Keep TRY' }));
    expect(screen.getByRole('button', { name: 'Change the currency' })).toHaveFocus();
  });

  it('never folds a held document: the hold and the changer show at once (W9)', async () => {
    const held = 'MONEY HELD, NOT FILED. This document would be filed under USD.';
    api.queue = [doc({ currency: 'USD', total: 412.5, notes: held })];
    api.detail = { document: api.queue[0], lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.getByLabelText('Currency this invoice is denominated in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change the currency' })).toBeNull();
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
describe('ReceiptsNext — formatted sheet on the right', () => {
  it('places the canonical document beside the selected receipt', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const sheet = await screen.findByTestId('formatted-document');
    expect(sheet).toHaveAttribute('data-id', 'd1');
    expect(sheet).toHaveAttribute('data-embedded', 'yes');
    expect(screen.getByLabelText('Formatted document')).toBeInTheDocument();
  });
});

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

/* ─── walk-through RECEIPTS-W44 — papers that read cleanly ─────────────── */

describe('ReceiptsNext — papers that read cleanly reach a swipe (W44)', () => {
  const row = (re: RegExp) => (_: string, el: Element | null) =>
    el?.tagName === 'SPAN' && re.test(el.textContent ?? '');

  it('lists them after the papers that need a look, under their own heading, and counts them apart', async () => {
    api.clean = [doc({ id: 'c1', doc_number: 'INV-CLEAN', status: 'received' })];
    const { container } = render(<ReceiptsNext />, { wrapper });
    const heading = await screen.findByRole('heading', { name: /Read cleanly · not yet confirmed · 1/ });
    const needsLook = await screen.findByText(row(/Invoice · INV-88/));
    const clean = screen.getByText(row(/Invoice · INV-CLEAN/));
    // Order on the page: the paper that needs a look, then the heading, then the clean one.
    expect(needsLook.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(clean) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toMatch(/1 awaiting review · 1 read cleanly · /);
  });

  it("leaves out the house's own papers: a door count is not a vendor's paper", async () => {
    api.clean = [
      { ...doc({ id: 'c1', doc_number: 'INV-CLEAN', status: 'received' }), direction: 'issued_by_vendor' } as ProcurementDocument,
      { ...doc({ id: 'c2', doc_number: 'DOOR-COUNT', status: 'received' }), direction: 'issued_by_us' } as ProcurementDocument,
    ];
    const { container } = render(<ReceiptsNext />, { wrapper });
    await screen.findByRole('heading', { name: /Read cleanly · not yet confirmed · 1$/ });
    expect(container.textContent).not.toContain('DOOR-COUNT');
  });

  it('does not say "caught up" while clean papers still wait for a swipe', async () => {
    api.queue = [];
    api.clean = [doc({ id: 'c1', doc_number: 'INV-CLEAN', status: 'received' })];
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('Nothing needs a look.')).toBeTruthy();
    expect(container.textContent).not.toMatch(/caught up/);
  });

  it('says "Reading…", not "caught up", while the clean papers are still being read (W48)', async () => {
    api.queue = [];
    api.cleanPending = true;
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('Reading…')).toBeTruthy();
    expect(container.textContent).toMatch(/0 awaiting review/);
    expect(container.textContent).not.toMatch(/caught up/);
    expect(screen.queryByText('Nothing needs a look.')).toBeNull();
  });

  it('says "Reading…", not "caught up", while the door count is still being read (W50b)', async () => {
    api.queue = [];
    api.clean = [];
    api.doorPending = true;
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/Deliveries counted at the door: unknown/)).toBeTruthy();
    expect(await screen.findByText('Reading…')).toBeTruthy();
    // The door's own line says "not claiming the door is caught up"; the
    // queue's sentence must not claim the paper trail is.
    expect(container.textContent).not.toMatch(/paper trail is caught up/);
  });

  it('says "caught up" once the clean read lands empty (W48)', async () => {
    api.queue = [];
    api.clean = [];
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('Nothing awaits review — the paper trail is caught up.')).toBeTruthy();
  });

  it('opens a clean paper like any other, by click and by link', async () => {
    api.queue = [];
    api.clean = [doc({ id: 'c1', doc_number: 'INV-CLEAN', status: 'received' })];
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=c1') });
    // The line editor renders only for an OPEN document (status received is editable).
    expect(await screen.findByLabelText('Quantity, line 1')).toBeTruthy();
    expect(screen.queryByText(/not in this house/)).toBeNull();
  });

  it('draws no heading when nothing read cleanly', async () => {
    render(<ReceiptsNext />, { wrapper });
    await screen.findByText(row(/Invoice · INV-88/));
    expect(screen.queryByRole('heading', { name: /Read cleanly/ })).toBeNull();
  });
});

/* ─── 2026-10-01 walk-through — the order and the sheet ─────────────────── */

describe('ReceiptsNext — the linked order comes from the links, not the row', () => {
  // `procurement_documents` has no `order_id` column, so the gateway never
  // sends one. Every fixture above sets `order_id: 'o1'`, which is the premise
  // that hid a pairing check disabled for every real document.
  const unpaired = () => doc({ order_id: undefined });

  it('names the order a link pairs it with, and enables the pairing check', async () => {
    api.queue = [unpaired()];
    api.detail = {
      document: unpaired(),
      lines: [line],
      links: [{ id: 'k1', document_id: 'd1', order_id: 'o1' }] as never[],
    };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/Against order PO-14/)).toBeInTheDocument();
    expect(screen.queryByText(/No order is linked/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Check line pairing' })).toBeEnabled();
  });

  it('an order with no number says so, never a slice of its id (W37)', async () => {
    api.orderOver = { orderNumber: null };
    api.queue = [unpaired()];
    api.detail = {
      document: unpaired(),
      lines: [line],
      links: [{ id: 'k1', document_id: 'd1', order_id: 'o1abcdef-77' }] as never[],
    };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(await screen.findByText(/Against an order with no number/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('o1abcdef');
  });

  it('says no order is linked only once the links are read and empty', async () => {
    api.queue = [unpaired()];
    api.detail = { document: unpaired(), lines: [line], links: [] };
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(
      await screen.findByText('No order is linked to this document, so its lines have nothing to be checked against.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check line pairing' })).toBeDisabled();
    expect(screen.getByText('needs a linked order first')).toBeInTheDocument();
  });

  it('says why the pairing check is off while the link could not be read (W18)', async () => {
    api.queue = [unpaired()];
    api.detailFails = Object.assign(new Error('Request failed with status code 503'), {
      response: { status: 503, data: { message: 'documents backend is down' } },
    });
    render(<ReceiptsNext />, { wrapper });
    fireEvent.click(
      await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? '')),
    );
    expect(await screen.findByText('needs the order link, which could not be read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check line pairing' })).toBeDisabled();
  });
});

describe('ReceiptsNext — a correction refreshes the sheet above it', () => {
  it('invalidates the formatted sheet once the sealed correction lands', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const spy = vi.spyOn(lastQc, 'invalidateQueries');
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);
    await screen.findByText(/Nothing has been written yet/);
    holdToApprove(/Hold to seal this correction/);
    await waitFor(() => expect(api.editLine).toHaveBeenCalled());
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['canonical-document', 'rest-A', 'd1'] }),
    );
    // The sheet's keys name the house (W47), so the refresh must name it too:
    // a house-less prefix would no longer reach the sheet's buckets.
    expect(spy).toHaveBeenCalledWith({ queryKey: ['canonical-document-items', 'rest-A', 'd1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['canonical-document-mappings', 'rest-A', 'd1'] });
  });
});

describe('ReceiptsNext — the open document lives in the URL (ADR 0160)', () => {
  function Where() {
    return <output data-testid="where">{useLocation().search}</output>;
  }

  it('writes ?doc= on a click and clears it from the back link', async () => {
    render(
      <>
        <ReceiptsNext />
        <Where />
      </>,
      { wrapper },
    );
    await openFirstDoc();
    expect(screen.getByTestId('where').textContent).toBe('?doc=d1');
    fireEvent.click(screen.getByRole('button', { name: /All receipts · 1 awaiting review/ }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(''));
    expect(screen.queryByLabelText('Quantity, line 1')).toBeNull();
  });

  it('a link to a document this house does not hold says so, and clears (W19)', async () => {
    render(
      <>
        <ReceiptsNext />
        <Where />
      </>,
      { wrapper: wrapperAt('/receipts?doc=elsewhere') },
    );
    expect(await screen.findByTestId('doc-not-here')).toHaveTextContent(
      "not in this house's review queue or its verified book",
    );
    expect(screen.queryByText(/Choose a document from the queue/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show the queue' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(''));
    expect(screen.getByText(/Choose a document from the queue/)).toBeInTheDocument();
  });
});

describe("ReceiptsNext — the card shows the sheet's verdict, not the saved one", () => {
  it('prints the recomputed tie-out when the saved verdict is stale', async () => {
    // Saved at intake: off by 43.47 (the VAT the old rule ignored). The sheet
    // recomputes from the rows and says it adds up; the card must not argue.
    api.queue = [doc({ ties_out: false, tie_out_delta: 43.47 })];
    api.detail = { document: doc({ ties_out: false, tie_out_delta: 43.47 }), lines: [line], links: [] };
    api.sheetLayer3 = { tiesOut: true, tieOutDeltaCents: 0 };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await waitFor(() => expect(container.textContent).toContain('The lines add up to the stated total.'));
    expect(container.textContent).not.toContain('off by $43.47');
  });
});

describe('ReceiptsNext — a list row names who sent it (walk-through W8)', () => {
  it('leads with the vendor the list names, and keeps the number as the title without one', async () => {
    api.queue = [
      doc({ id: 'd1', doc_number: 'INV-1', vendorName: 'SYNTHETIC VENDOR CO.' } as Partial<ProcurementDocument>),
      doc({ id: 'd2', doc_number: 'INV-2' }),
    ];
    render(<ReceiptsNext />, { wrapper });
    const named = await screen.findByRole('button', { name: /SYNTHETIC VENDOR CO\.\s*Invoice · INV-1/ });
    expect(named.querySelector('span')).toHaveTextContent('SYNTHETIC VENDOR CO.');
    const unnamed = screen.getByRole('button', { name: /^Invoice · INV-2/ });
    expect(unnamed.querySelector('span')).toHaveTextContent('Invoice · INV-2');
  });
});

/* A year said once (walk-through W22, 2026-10-01): "Albariño 2022 · 2022". */
describe('ReceiptsNext — THE LINES say a year once (W22)', () => {
  it('adds the vintage only when the name does not print it', async () => {
    api.detail = { document: doc({}), lines: [line, { ...line, id: 'l2', line_no: 2, description: 'Godello' }], links: [] };
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(container.textContent).toContain('Albariño 2022');
    expect(container.textContent).not.toContain('Albariño 2022 · 2022');
    expect(container.textContent).toContain('Godello · 2022');
  });
});

/* The queue in words (walk-through W26, 2026-10-01). */
describe('ReceiptsNext — a failed read in words (W26)', () => {
  it('names what was not read and why, never "(Network Error)" or "gateway"', async () => {
    api.listFails = Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' });
    render(<ReceiptsNext />, { wrapper });
    const alert = await screen.findByText(/^Could not read the review queue/);
    expect(alert.textContent).toBe(
      // W44: the clean papers are a third read, and their failure is named too.
      'Could not read the review queue (no answer came back); the verified book (no answer came back); the papers that read cleanly (no answer came back). The paper trail is unknown — nothing below is claimed.',
    );
    expect(document.body.textContent).not.toMatch(/Network Error|gateway/);
  });

  /* RECEIPTS-W49: a read that never answered has no "last answer". */
  const noAnswer = () => Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' });

  it('says a read that never answered was not read, not that below is its last answer (W49)', async () => {
    api.queue = [];
    api.cleanFails = noAnswer();
    render(<ReceiptsNext />, { wrapper });
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(alert.textContent).toContain(
        'Could not read the papers that read cleanly (no answer came back) — nothing is claimed about them.',
      ),
    );
    expect(alert.textContent).not.toMatch(/last answer|Could not refresh/);
  });

  it('says "it" for one singular read that never answered (W49)', async () => {
    api.verifiedFails = noAnswer();
    render(<ReceiptsNext />, { wrapper });
    const alert = await screen.findByRole('alert');
    await waitFor(() =>
      expect(alert.textContent).toContain('Could not read the verified book (no answer came back) — nothing is claimed about it.'),
    );
  });

  it('says a linked document cannot be opened when a list it searches never answered (W50c)', async () => {
    api.verifiedFails = noAnswer();
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=elsewhere') });
    expect(await screen.findByText('Could not open the linked document: see the note above.')).toBeTruthy();
    expect(screen.queryByText('Opening the linked document…')).toBeNull();
    expect(screen.queryByTestId('doc-not-here')).toBeNull();
  });

  it('says a linked document cannot be opened when no house is selected, so no list was asked (W51)', async () => {
    api.restaurantId = null;
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=elsewhere') });
    expect(await screen.findByText(/No restaurant is selected/)).toBeTruthy();
    expect(screen.getByText('Could not open the linked document: see the note above.')).toBeTruthy();
    expect(screen.queryByText('Opening the linked document…')).toBeNull();
  });

  // A list that answered before and then failed still holds its last answer,
  // so it is not "never answered": while another list is still being read,
  // the link is still opening (round-4 audit of #586, W50c's data clause).
  it('keeps "Opening…" when a list that answered before fails while another is still being read (W50c)', async () => {
    api.unverifiedFails = new Error('receiving endpoint 500');
    api.cleanPending = true;
    render(<ReceiptsNext />, { wrapper: wrapperAt('/receipts?doc=elsewhere') });
    const first = await screen.findByRole('alert');
    await waitFor(() => expect(first.textContent).toContain('the deliveries counted at the door'));
    expect(screen.getByText('Opening the linked document…')).toBeTruthy();
    api.verifiedFails = noAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Could not refresh the verified book'),
    );
    expect(screen.getByText('Opening the linked document…')).toBeTruthy();
    expect(screen.queryByText('Could not open the linked document: see the note above.')).toBeNull();
  });

  it('keeps "the last answer" for a read that answered before and then failed (W49)', async () => {
    api.unverifiedFails = new Error('receiving endpoint 500');
    render(<ReceiptsNext />, { wrapper });
    // The door fails first; the clean papers answer (empty) on this first load.
    const first = await screen.findByRole('alert');
    await waitFor(() => expect(first.textContent).toContain('the deliveries counted at the door'));
    api.unverifiedFails = null;
    api.cleanFails = noAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      // The alert's sentence, without its "Try again" button.
      expect(screen.getByRole('alert').querySelector('span')?.textContent).toBe(
        'Could not refresh the papers that read cleanly (no answer came back). What is below is the last answer, not the present.',
      ),
    );
  });

  it('stops saying "Reading the queue…" once the read has failed', async () => {
    api.listFails = Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' });
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('queue not read · verified not read')).toBeTruthy();
    expect(screen.queryByText(/Reading the queue/)).toBeNull();
  });

  it('says "not read" in the header when no house is selected, so no read was asked (W52)', async () => {
    api.restaurantId = null;
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/No restaurant is selected/)).toBeTruthy();
    expect(screen.getByText('queue not read · verified not read')).toBeTruthy();
    expect(screen.queryByText(/Reading the queue/)).toBeNull();
  });

  it('says a row adds up, does not add up, or states no total', async () => {
    api.queue = [
      doc({ id: 'a', doc_number: 'INV-A', ties_out: true }),
      doc({ id: 'b', doc_number: 'INV-B', ties_out: false }),
    ];
    const { container } = render(<ReceiptsNext />, { wrapper });
    await waitFor(() => expect(container.textContent).toContain('does not add up'));
    expect(container.textContent).toMatch(/· adds up/);
    expect(container.textContent).not.toMatch(/tie out|tie-out/);
  });
});

/*
 * PHONE WIDTH (walk-through P7, 2026-10-01). jsdom applies no media query and
 * lays nothing out, so these pin the parts that made the phone measurements
 * pass: the grid's one column is a track that cannot grow past the screen
 * (W34), and the card's line table names each figure, keeps its roles, and
 * carries the phone rules that stack it (W35).
 */
describe('ReceiptsNext — at phone width', () => {
  it('the page grid names its one column in both states, so the open document cannot widen it (W34)', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    const grid = () => container.querySelector('[class*="320px_minmax(0,1fr)"]') as HTMLElement;
    await screen.findByText((_, el) => el?.tagName === 'SPAN' && /Invoice · INV-88/.test(el.textContent ?? ''));
    expect(grid().className.split(' ')).toContain('grid-cols-1');
    await openFirstDoc();
    expect(grid().className.split(' ')).toContain('grid-cols-1');
    expect(grid().className).toContain('2xl:grid-cols-[320px_minmax(0,1fr)]');
  });

  it("the card's lines name each figure, keep the table's roles, and stack below 640px (W35)", async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const table = container.querySelector('table.rc-lines') as HTMLTableElement;
    expect(table.getAttribute('role')).toBe('table');
    const row = table.querySelector('tbody tr') as HTMLTableRowElement;
    expect(row.getAttribute('role')).toBe('row');
    const cells = [...row.querySelectorAll('td')];
    expect(cells.every((td) => td.getAttribute('role') === 'cell')).toBe(true);
    expect(cells.map((td) => td.dataset.cell)).toEqual(['line', 'qty', 'unit_price', 'line_total', 'order']);
    expect(cells.filter((td) => td.dataset.label).map((td) => td.dataset.label)).toEqual([
      'Qty',
      'Unit',
      'Total',
      'Order line',
    ]);
    const css = [...container.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const phone = css.slice(css.indexOf('@media screen and (max-width: 639px)'));
    expect(phone).toMatch(/\.rc-lines thead \{ display: none \}/);
    expect(phone).toMatch(/\.rc-lines tr \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(phone).toMatch(/\.rc-lines td\[data-label\]::before \{ content: attr\(data-label\)/);
  });
});

describe('ReceiptsNext — edges you can see and a way past the sheet (P8)', () => {
  const EDGE = 'var(--line-control, #8F8674)';

  it('every box and picker on the card has an edge at 3:1, not paper-2 (W39)', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(screen.getByLabelText('Quantity, line 1').getAttribute('style')).toContain(EDGE);
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
    expect(screen.getByLabelText('Currency this invoice is denominated in').getAttribute('style')).toContain(EDGE);
    expect(screen.getByLabelText("Why this invoice's currency is being changed").getAttribute('style')).toContain(EDGE);
  });

  it('a skip link before the sheet moves focus to the card and writes nothing to the address (W40)', async () => {
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const skip = screen.getByRole('link', { name: 'Skip to the review card' });
    const sheet = container.querySelector('[aria-label="Formatted document"]')!;
    expect(skip.compareDocumentPosition(sheet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // `false` means the click's default (a `#` in the address) was prevented.
    expect(fireEvent.click(skip)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Check and correct' }));
    const css = [...container.querySelectorAll('style')].map((x) => x.textContent).join('');
    expect(css).toContain('.rc-skip:not(:focus) { position: absolute');
  });
});

describe('ReceiptsNext — every paper type in words (W44)', () => {
  it('names an irsaliye "Delivery note", never its stored code', async () => {
    api.clean = [
      { ...doc({ id: 'c1', doc_number: 'SYN-IRS-0001', status: 'received' }), doc_type: 'delivery_note' } as unknown as ProcurementDocument,
    ];
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(
      await screen.findByText((_, el) => el?.tagName === 'SPAN' && /^Delivery note · SYN-IRS-0001$/.test(el.textContent ?? '')),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('delivery_note');
  });

  it('says "Document" for a type it has no word for', async () => {
    api.clean = [
      { ...doc({ id: 'c1', doc_number: 'SYN-X-1', status: 'received' }), doc_type: 'a_new_kind' } as unknown as ProcurementDocument,
    ];
    const { container } = render(<ReceiptsNext />, { wrapper });
    await screen.findByText((_, el) => el?.tagName === 'SPAN' && /^Document · SYN-X-1$/.test(el.textContent ?? ''));
    expect(container.textContent).not.toContain('a_new_kind');
  });
});

/* ─── F-160 / RECEIPTS-W53 — the paper owed, where "caught up" stood ──────── */

describe('ReceiptsNext — checked deliveries with no invoice filed (RECEIPTS-W53)', () => {
  const owed = (over: Record<string, unknown> = {}) => ({
    ...NONE_OWED,
    count: 543,
    checkedRead: 600,
    oldestAt: '2026-07-06T09:00:00.000Z',
    items: [
      { orderId: 'o1', orderNumber: 'PO-1', vendorName: 'Bodega Álvaro', deliveredAt: '2026-07-06T09:00:00.000Z', checkedAt: '2026-07-07T09:00:00.000Z' },
      { orderId: 'o2', orderNumber: null, vendorName: null, deliveredAt: null, checkedAt: '2026-07-09T09:00:00.000Z' },
    ],
    ...over,
  });
  const empty = () => {
    api.queue = [];
    api.clean = [];
  };

  it('says the count in place of "caught up" when checked deliveries have no invoice filed', async () => {
    empty();
    api.paperOwed = owed();
    const { container } = render(<ReceiptsNext />, { wrapper });
    const line = await screen.findByTestId('paper-owed');
    expect(line.textContent).toBe(
      `543 checked deliveries have no invoice filed · oldest ${fmtDate('2026-07-06T09:00:00.000Z')}`,
    );
    expect(
      screen.getByText(
        'Checked against a typed price, but no paper is linked to the order. A vendor who bills weekly still owes it.',
      ),
    ).toBeTruthy();
    expect(container.textContent).not.toMatch(/caught up/);
  });

  it('keeps "caught up" when the count, read whole, is zero', async () => {
    empty();
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('Nothing awaits review — the paper trail is caught up.')).toBeTruthy();
    expect(api.paperOwedGets).toBeGreaterThan(0);
  });

  it('never says "caught up" from a failed read: it says the count was not read', async () => {
    empty();
    api.paperOwedFails = Object.assign(new Error('Network Error'), { request: {}, code: 'ERR_NETWORK' });
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(
      await screen.findByText(
        /^Nothing awaits review\. The checked deliveries’ invoices were not read, so this page is\s+not claiming the paper trail is caught up\.$/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not read the checked deliveries with no invoice filed (no answer came back) — nothing is claimed about them.',
    );
    // Its own sentence names "caught up" only to disclaim it.
    expect(screen.queryByText('Nothing awaits review — the paper trail is caught up.')).toBeNull();
    expect(container.textContent).not.toMatch(/review — the paper trail is caught up/);
  });

  it('says "Reading…", not "caught up", while the count is still being read', async () => {
    empty();
    api.paperOwedPending = true;
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('Reading…')).toBeTruthy();
    expect(container.textContent).not.toMatch(/caught up/);
  });

  it('opens the list in place, says "first N of M" when it is cut, and folds it again', async () => {
    empty();
    api.paperOwed = owed();
    render(<ReceiptsNext />, { wrapper });
    const toggle = await screen.findByRole('button', { name: 'See them' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Checked deliveries with no invoice filed' })).toBeNull();
    fireEvent.click(toggle);
    const list = screen.getByRole('list', { name: 'Checked deliveries with no invoice filed' });
    const rows = [...list.querySelectorAll('li')].map((li) => li.textContent);
    expect(rows).toEqual([
      `Bodega Álvaro · PO-1 · ${fmtDate('2026-07-06T09:00:00.000Z')}`,
      // No delivery date: dated by the check. No name: said, never guessed.
      `a vendor not named · an order with no number · ${fmtDate('2026-07-09T09:00:00.000Z')}`,
    ]);
    expect(screen.getByText('First 2 of 543, oldest first.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide them' }));
    expect(screen.getByRole('button', { name: 'See them' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Checked deliveries with no invoice filed' })).toBeNull();
  });

  it('marks a count the gateway stopped at its ceiling as a floor, in the line and in the list', async () => {
    empty();
    api.paperOwed = owed({ count: 3000, complete: false, checkedRead: 3000 });
    render(<ReceiptsNext />, { wrapper });
    expect((await screen.findByTestId('paper-owed')).textContent).toMatch(
      /^≥3000 checked deliveries have no invoice filed/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'See them' }));
    expect(screen.getByText('First 2 of ≥3000, oldest first.')).toBeTruthy();
  });

  it('says no "first N of M" when the list holds every one', async () => {
    empty();
    api.paperOwed = owed({ count: 1, items: [owed().items[0]] });
    render(<ReceiptsNext />, { wrapper });
    expect((await screen.findByTestId('paper-owed')).textContent).toMatch(/^1 checked delivery has no invoice filed/);
    fireEvent.click(screen.getByRole('button', { name: 'See them' }));
    expect(screen.queryByText(/^First /)).toBeNull();
  });

  it('never asks for a staff session, and tells staff why instead of "caught up"', async () => {
    empty();
    api.role = 'staff';
    const { container } = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/kept for the\s+owner and managers of this house/)).toBeTruthy();
    expect(api.paperOwedGets).toBe(0);
    expect(container.textContent).not.toMatch(/caught up/);
  });

  it('heads the counts with "papers verified": it counts papers, not deliveries', async () => {
    empty();
    const view = render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('0 awaiting review · 0 papers verified')).toBeTruthy();
    view.unmount();

    api.verified = [doc({ id: 'v1', status: 'verified' as ProcurementDocument['status'] })];
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText('0 awaiting review · 1 paper verified')).toBeTruthy();
  });
});

/* ─── follow-ups owed from #586 (founder: "A later branch (Recommended)") ─── */

describe('ReceiptsNext — a failed confirm can be tried again (#586 follow-up 1)', () => {
  it('keeps "Confirming…" while a second swipe is in flight, then offers a third after it fails', async () => {
    const refused = (m: string) => ({ response: { status: 500, data: { message: m } } });
    let rejectSecond: (e: unknown) => void = () => {};
    api.verify
      .mockImplementationOnce(() => Promise.reject(refused('the first confirmation failed')))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }));
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const swipe = () => fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), { key: ' ' });

    swipe();
    await waitFor(() => expect(container.textContent).toContain('The document is still unverified.'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByRole('button', { name: /Swipe up to confirm/ })).toBeEnabled());

    // The second swipe. While its confirmation is in flight the control stays
    // where the gesture left it: a key read from `failureCount` went back to 0
    // here and remounted it mid-swipe, under a confirmation still on its way.
    swipe();
    await waitFor(() => expect(api.verify).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(screen.getByText('Confirming…')).toBeTruthy();

    rejectSecond(refused('the second confirmation failed'));
    await waitFor(() => expect(container.textContent).toContain('the second confirmation failed'));
    // Not left at "Confirming…": the control is fresh and a third swipe goes out.
    await waitFor(() => expect(screen.getByRole('button', { name: /Swipe up to confirm/ })).toBeEnabled());
    expect(screen.queryByText('Confirming…')).toBeNull();
    swipe();
    await waitFor(() => expect(api.verify).toHaveBeenCalledTimes(3), { timeout: 3000 });
  });
});

describe('ReceiptsNext — a failed correction can be sealed again (#586 follow-up 1, the sibling hold)', () => {
  it('keeps the hold sealed while a second correction is in flight, then offers it fresh after it fails', async () => {
    const refused = (m: string) => ({ response: { status: 500, data: { message: m } } });
    let rejectSecond: (e: unknown) => void = () => {};
    api.editLine
      .mockImplementationOnce(() => Promise.reject(refused('the first correction failed')))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }));
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    const qty = screen.getByLabelText('Quantity, line 1');
    fireEvent.change(qty, { target: { value: '11' } });
    fireEvent.blur(qty);

    holdToApprove(/Hold to seal this correction/);
    await waitFor(() => expect(container.textContent).toContain('the first correction failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Hold to seal this correction/ })).toBeEnabled());

    holdToApprove(/Hold to seal this correction/);
    await waitFor(() => expect(api.editLine).toHaveBeenCalledTimes(2));
    // Still sealed while the write is on its way, not remounted to its resting label.
    expect(screen.getByText('Correction sealed')).toBeTruthy();

    rejectSecond(refused('the second correction failed'));
    await waitFor(() => expect(container.textContent).toContain('the second correction failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Hold to seal this correction/ })).toBeEnabled());
    expect(screen.queryByText('Correction sealed')).toBeNull();
  });
});

describe('ReceiptsNext — no house, no document to choose (#586 follow-up 2)', () => {
  it('says there is no document to show, and does not invite a choice from a queue never asked for', async () => {
    api.restaurantId = null;
    render(<ReceiptsNext />, { wrapper });
    expect(await screen.findByText(/No restaurant is selected/)).toBeTruthy();
    expect(screen.getByText('No house is selected, so there is no document to show.')).toBeTruthy();
    expect(screen.queryByText(/Choose a document from the queue/)).toBeNull();
  });
});

describe('ReceiptsNext — a failed restatement can be sealed again (#586 follow-up 1, the other sibling)', () => {
  it('keeps the hold sealed while a second restatement is in flight, then offers it fresh after it fails', async () => {
    const refused = (m: string) => ({ response: { status: 500, data: { message: m } } });
    let rejectSecond: (e: unknown) => void = () => {};
    api.restateCurrency
      .mockImplementationOnce(() => Promise.reject(refused('the first restatement failed')))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSecond = reject; }));
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.click(screen.getByRole('button', { name: 'Change the currency' }));
    fireEvent.change(screen.getByLabelText('Currency this invoice is denominated in'), {
      target: { value: 'EUR' },
    });

    holdToApprove(/Hold to file this invoice in EUR/);
    await waitFor(() => expect(container.textContent).toContain('the first restatement failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Hold to file this invoice in EUR/ })).toBeEnabled());

    holdToApprove(/Hold to file this invoice in EUR/);
    await waitFor(() => expect(api.restateCurrency).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Sealed')).toBeTruthy();

    rejectSecond(refused('the second restatement failed'));
    await waitFor(() => expect(container.textContent).toContain('the second restatement failed'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Hold to file this invoice in EUR/ })).toBeEnabled());
    expect(screen.queryByText('Sealed')).toBeNull();
  });
});
