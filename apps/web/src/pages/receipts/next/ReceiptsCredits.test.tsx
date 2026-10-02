/**
 * The credit ledger lane on the rebuilt /receipts (ADR 0149 row 22).
 *
 * What is pinned here: the tab is offered by the role IN THIS HOUSE (ADR 0167),
 * the legacy page is never loaded, figures are never added across currencies,
 * a window is a floor, an unknown is not an empty, "requested" drafts a letter
 * and says nothing was sent (ADR 0230), and a settlement names a real credit
 * memo and an amount.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createContext } from 'react';
import type { ProcurementCredit, CreditStats } from '../../../services/api/credits';
import type { ProcurementDocument } from '../../../services/api/documents';

const api = vi.hoisted(() => ({
  role: 'manager' as string | null,
  globalRole: null as string | null,
  restaurantId: 'rest-A' as string | null,
  claims: [] as ProcurementCredit[],
  claimsFail: null as unknown,
  stats: null as CreditStats | null,
  statsFail: null as unknown,
  memos: [] as ProcurementDocument[],
  list: vi.fn(),
  transition: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: api.restaurantId,
    activeRole: api.role,
    user: api.globalRole ? { role: api.globalRole } : null,
    isAuthenticated: true,
  }),
  AuthContext: createContext<{ activeRestaurantId: string | null } | null>(null),
}));

// The legacy `ReceiptsPage` this file once refused to load (a throwing
// vi.mock) was deleted at the ADR 0149 cutover — there is nothing left to
// import by mistake, so the guard went with it.

vi.mock('../../../services/api/credits', () => ({
  creditsApi: {
    list: (...a: unknown[]) => {
      api.list(...a);
      return api.claimsFail ? Promise.reject(api.claimsFail) : Promise.resolve(api.claims);
    },
    stats: () => (api.statsFail ? Promise.reject(api.statsFail) : Promise.resolve(api.stats)),
    transition: (...a: unknown[]) => api.transition(...a),
  },
}));

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>();
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      list: (opts: { docType?: string }) =>
        Promise.resolve(opts.docType === 'credit_memo' ? api.memos : []),
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve({ items: [] }) },
}));
vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: () => null,
}));
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useProviders: () => ({ data: [{ id: 'prov-1', name: 'Bodega Álvaro' }] }),
}));

import ReceiptsNext, { canSeeCreditLedger } from './ReceiptsNext';
import { CREDIT_MOVES } from './useReceiptsNextData';

function claim(over: Partial<ProcurementCredit> = {}): ProcurementCredit {
  return {
    id: 'c1',
    restaurant_id: 'rest-A',
    provider_id: 'prov-1',
    order_id: 'o1',
    document_id: 'inv-1',
    state: 'open',
    claimed_amount: 120,
    credited_amount: null,
    credit_document_id: null,
    currency: 'TRY',
    reason: 'qty_short',
    summary: 'Billed for 24 but only 22 arrived — 2 short.',
    notes: null,
    self_evidenced: false,
    opened_at: '2026-09-01T10:00:00.000Z',
    requested_at: null,
    promised_at: null,
    settled_at: null,
    ...over,
  };
}

const figures = (o: Partial<CreditStats> = {}) => ({
  recovered: 0,
  outstanding: 0,
  promised: 0,
  rejected: 0,
  openClaims: 0,
  oldestOpenDays: null,
  settlementRate: null,
  ...o,
});

function stats(o: Partial<CreditStats> = {}): CreditStats {
  return { ...figures(), selfEvidencedOpen: 0, byCurrency: {}, rowsCounted: 0, capped: false, ...o };
}

function memo(over: Partial<ProcurementDocument> = {}): ProcurementDocument {
  return {
    id: 'memo-1',
    doc_type: 'credit_memo',
    source_channel: 'email',
    doc_number: 'CM-7',
    doc_date: '2026-09-10',
    status: 'verified',
    currency: 'TRY',
    total: 100,
    provider_id: 'prov-1',
    ...over,
  } as ProcurementDocument;
}

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ReceiptsNext />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.role = 'manager';
  api.globalRole = null;
  api.restaurantId = 'rest-A';
  api.claims = [];
  api.claimsFail = null;
  api.stats = stats();
  api.statsFail = null;
  api.memos = [];
  api.list.mockReset();
  api.transition.mockReset();
});

describe('who is offered the ledger (ADR 0167)', () => {
  it('decides by the role in this house, falling back to the global role only when none', () => {
    expect(canSeeCreditLedger('manager', 'staff')).toBe(true);
    expect(canSeeCreditLedger('staff', 'owner')).toBe(false);
    expect(canSeeCreditLedger(null, 'owner')).toBe(true);
    expect(canSeeCreditLedger('ADMIN', null)).toBe(false);
    expect(canSeeCreditLedger(null, null)).toBe(false);
    expect(canSeeCreditLedger('sommelier', null)).toBe(false);
  });

  it('lands staff who follow /credits on Receipts, says why, and asks the gateway nothing', async () => {
    api.role = 'staff';
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/kept for the owner and managers of this house/i)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Credits' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Receipts');
    expect(api.list).not.toHaveBeenCalled();
  });

  // Regression, PR #476 audit round 1: this had reintroduced 'admin' into
  // canSeeCreditLedger — the exact bug PR #395's audit already fixed on the
  // legacy ReceiptsPage. Restoring 'admin' to canSeeCreditLedger turns this red.
  it('lands admin who follow /credits on Receipts too, the same as staff (ADR 0167)', async () => {
    api.role = 'admin';
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/kept for the owner and managers of this house/i)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Credits' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Receipts');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('offers a manager both tabs and renders the ledger on Mudavym, not the legacy page', async () => {
    api.claims = [claim()];
    renderAt('/receipts?tab=credits');
    expect(await screen.findByRole('tab', { name: 'Credits', selected: true })).toBeTruthy();
    expect(await screen.findByText('Billed for more than arrived')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Credits');
  });

  it('says the gateway refused rather than showing an empty ledger on a 403', async () => {
    api.claimsFail = Object.assign(new Error('Forbidden'), { response: { status: 403 } });
    api.statsFail = api.claimsFail;
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/Mudavym refused it to this session/i)).toBeTruthy();
    expect(screen.queryByText(/No claim is being chased/i)).toBeNull();
  });
});

describe('figures', () => {
  it('prints each currency on its own and never their sum', async () => {
    api.stats = stats({
      outstanding: 290,
      byCurrency: {
        EUR: figures({ outstanding: 40, openClaims: 1 }),
        TRY: figures({ outstanding: 250, openClaims: 1 }),
      },
    });
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/Claims in EUR — kept apart/)).toBeTruthy();
    expect(screen.getByText(/Claims in TRY — kept apart/)).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Recovery figures' });
    expect(within(region).queryByText(/290/)).toBeNull();
  });

  it('marks every figure a floor when the server does not say it read every claim', async () => {
    api.stats = stats({ byCurrency: { TRY: figures({ outstanding: 10, openClaims: 1 }) }, capped: undefined });
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/did not say whether it read every claim/)).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Recovery figures' });
    expect(within(region).getAllByText(/≥/).length).toBeGreaterThan(0);
  });

  it('shows no floor when the server says it read every claim', async () => {
    api.stats = stats({ byCurrency: { TRY: figures({ outstanding: 10, openClaims: 1 }) }, capped: false });
    renderAt('/receipts?tab=credits');
    await screen.findByText('Outstanding');
    const region = screen.getByRole('region', { name: 'Recovery figures' });
    expect(within(region).queryByText(/≥/)).toBeNull();
  });

  it('says an empty ledger is empty only once the gateway has answered, and only once (W24)', async () => {
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/No credit claim has been opened at this house/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Being chased' })).toBeNull());
    expect(screen.queryByText(/No claim is being chased right now/)).toBeNull();
  });

  it('keeps "Being chased" when the house has claims but none is open (W24)', async () => {
    api.claims = [claim({ state: 'written_off' })];
    api.stats = stats({ byCurrency: { TRY: figures({ openClaims: 0 }) } });
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/No claim is being chased right now/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Being chased' })).toBeTruthy();
  });

  it('names a failed list instead of rendering it as no claims', async () => {
    api.claimsFail = new Error('boom');
    renderAt('/receipts?tab=credits');
    // A plain Error carries the client's words, not a reason (walk-through W26).
    expect(await screen.findByText(/Could not read the claims \(the reason is not known\)/)).toBeTruthy();
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.queryByText(/No claim is being chased/)).toBeNull();
    // Never an empty heading: the section says it was not read.
    expect(screen.getByText('Not read: see the note above.')).toBeTruthy();
  });

  it('does not say "none" from an empty last answer while the claims refresh fails (W50b)', async () => {
    api.claims = [claim({ state: 'written_off' })];
    api.statsFail = new Error('first');
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText('No claim is being chased right now.')).toBeTruthy();
    api.statsFail = null;
    api.claimsFail = new Error('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Could not read the claims/)).toBeTruthy();
    expect(screen.queryByText('No claim is being chased right now.')).toBeNull();
    expect(screen.getByText('Not read: see the note above.')).toBeTruthy();
  });

  it('marks the list a floor when it filled the server window', async () => {
    api.claims = Array.from({ length: 200 }, (_, i) => claim({ id: `c${i}` }));
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/newer claims exist that are not shown here/)).toBeTruthy();
    expect(screen.getByText(/≥200 · oldest first/)).toBeTruthy();
  });
});

describe('moves', () => {
  it('a claimed quantity is a quantity, not "btl" — a claim can be for anything the house buys (W38)', async () => {
    api.claims = [claim({ claimed_qty: 2 })];
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    const sheet = await screen.findByRole('dialog');
    expect(sheet.textContent).toContain('· quantity 2');
    expect(sheet.textContent).not.toContain('btl');
  });

  it('"Ask the vendor" says it drafts and sends nothing, then links the drafted letter', async () => {
    api.claims = [claim()];
    api.transition.mockResolvedValue({
      ...claim({ state: 'requested' }),
      letter: {
        state: 'drafted',
        id: 'letter-9',
        to: 'orders@bodega.example',
        says: 'Drafted to orders@bodega.example, not sent. It waits in Communications until someone here sends it.',
      },
    });
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    expect(screen.getByText(/Asking drafts a letter to the vendor in Communications/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the vendor' }));
    expect(screen.getByText(/Nothing is sent until someone opens the draft there and sends it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Record: ask the vendor/i }));
    await waitFor(() =>
      expect(api.transition).toHaveBeenCalledWith('c1', {
        to: 'requested',
        creditedAmount: undefined,
        creditDocumentId: undefined,
      }),
    );
    expect(await screen.findByText(/Drafted to orders@bodega.example, not sent/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open the draft' });
    expect(link.getAttribute('href')).toBe('/communications?draft=letter-9');
  });

  it('a claim with no vendor says there is nobody to write to', async () => {
    api.claims = [claim({ provider_id: null })];
    api.transition.mockResolvedValue({
      ...claim({ state: 'requested', provider_id: null }),
      letter: {
        state: 'no_vendor',
        id: null,
        to: null,
        says: 'This claim names no vendor, so there is nobody to write to and no letter was drafted.',
      },
    });
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    fireEvent.click(await screen.findByRole('button', { name: 'Ask the vendor' }));
    fireEvent.click(screen.getByRole('button', { name: /Record: ask the vendor/i }));
    expect(await screen.findByText(/names no vendor, so there is nobody to write to/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open the draft' })).toBeNull();
  });

  it("an asked claim names its letter in the letter book's words", async () => {
    api.claims = [
      claim({
        state: 'requested',
        letters: [
          { id: 'letter-9', status: 'HOUSE_DRAFT', to: null, sentAt: null, createdAt: '2026-09-25T09:00:00Z' },
        ],
      }),
    ];
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    expect(await screen.findByText(/Drafted — not sent; the vendor has no address in the book yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the draft' }).getAttribute('href')).toBe(
      '/communications?draft=letter-9',
    );
  });

  it('a sent letter is said as sent, with no draft link', async () => {
    api.claims = [
      claim({
        state: 'requested',
        letters: [
          {
            id: 'letter-9',
            status: 'SENT',
            to: 'orders@bodega.example',
            sentAt: '2026-09-25T09:05:00Z',
            createdAt: '2026-09-25T09:00:00Z',
          },
        ],
      }),
    ];
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    expect(await screen.findByText(/Sent to orders@bodega.example on/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open the draft' })).toBeNull();
  });

  it('letters that could not be read (or fell outside a capped read) are unknown, never none', async () => {
    api.claims = [claim({ state: 'requested', letters: null })];
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    expect(await screen.findByText(/letters could not be confirmed/)).toBeTruthy();
    expect(screen.queryByText(/No letter was drafted/)).toBeNull();
  });

  it('states the gateway refusal in its words and leaves the claim as it was', async () => {
    api.claims = [claim()];
    api.transition.mockRejectedValue({
      response: { status: 422, data: { message: 'Cannot move a claim from open to promised.' } },
    });
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    fireEvent.click(await screen.findByRole('button', { name: 'Write it off' }));
    fireEvent.click(screen.getByRole('button', { name: /Record: write it off/i }));
    expect(
      await screen.findByText(/^Cannot move a claim from open to promised\. The claim is unchanged\.$/),
    ).toBeTruthy();
  });

  it('settles only against a chosen credit memo and the amount the vendor allowed', async () => {
    api.claims = [claim({ state: 'promised' })];
    api.memos = [memo()];
    api.transition.mockResolvedValue(claim({ state: 'credited' }));
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    fireEvent.click(await screen.findByRole('button', { name: 'Settle against a credit memo' }));

    fireEvent.click(screen.getByRole('button', { name: 'Record the settlement' }));
    expect(screen.getByText('Choose the credit memo that settles this claim.')).toBeTruthy();

    fireEvent.click(await screen.findByRole('radio', { name: /Credit memo CM-7/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Record the settlement' }));
    expect(screen.getByText(/Enter the amount the vendor allowed/)).toBeTruthy();
    expect(api.transition).not.toHaveBeenCalled();

    // W39: the amount box has an edge at 3:1, not paper-2.
    expect(screen.getByPlaceholderText(/claimed/).getAttribute('style')).toContain('var(--line-control, #8F8674)');
    fireEvent.change(screen.getByPlaceholderText(/claimed/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the settlement' }));
    await waitFor(() =>
      expect(api.transition).toHaveBeenCalledWith('c1', {
        to: 'credited',
        creditedAmount: 100,
        creditDocumentId: 'memo-1',
      }),
    );
  });

  it('says when a memo already settles another claim, since the server allows reuse', async () => {
    api.claims = [
      claim({ state: 'promised' }),
      claim({ id: 'c9', state: 'credited', credited_amount: 50, credit_document_id: 'memo-1' }),
    ];
    api.memos = [memo()];
    renderAt('/receipts?tab=credits');
    fireEvent.click((await screen.findAllByText('Billed for more than arrived'))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Settle against a credit memo' }));
    expect(await screen.findByText(/already settles 1 other claim/)).toBeTruthy();
  });

  it('with no credit memo on file, says so and cannot settle', async () => {
    api.claims = [claim({ state: 'requested' })];
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    fireEvent.click(await screen.findByRole('button', { name: 'Settle against a credit memo' }));
    expect(await screen.findByText(/No credit memo is on file at this house/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Record the settlement' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers "ask again" on a refused claim, as the gateway allows', async () => {
    api.claims = [claim({ state: 'rejected' })];
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText(/Closed ·/));
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    expect(await screen.findByRole('button', { name: 'Ask the vendor again' })).toBeTruthy();
  });
});

describe('a link opens one claim (walk-through W20)', () => {
  it('opens the claim the link names, and closing it drops the id', async () => {
    api.claims = [claim({ state: 'requested' })];
    renderAt('/receipts?tab=credits&credit=c1');
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Billed for more than arrived')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?tab=credits'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('unfolds the closed list when the linked claim is closed', async () => {
    api.claims = [claim({ state: 'written_off' })];
    renderAt('/receipts?tab=credits&credit=c1');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Closed/ }).getAttribute('aria-expanded')).toBe('true');
  });

  // An effect unfolded it after the sheet's first paint: folded for a frame,
  // then a jump, and CI could check inside that frame (RECEIPTS-W50). Any
  // aria-expanded flip from "false" on the Closed button is that frame.
  it('never shows the closed list folded under a linked closed claim, not even for a frame (W50)', async () => {
    api.claims = [claim({ state: 'written_off' })];
    const flips: (string | null)[] = [];
    const seen = (records: MutationRecord[]) =>
      records.forEach((r) => {
        if ((r.target as HTMLElement).textContent?.startsWith('Closed')) flips.push(r.oldValue);
      });
    const watch = new MutationObserver(seen);
    watch.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
      attributeOldValue: true,
    });
    renderAt('/receipts?tab=credits&credit=c1');
    expect(await screen.findByRole('dialog')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Closed/ }).getAttribute('aria-expanded')).toBe('true'),
    );
    seen(watch.takeRecords());
    watch.disconnect();
    expect(flips).toEqual([]);
  });

  it('says so when the linked claim is not in this ledger, and clears the link', async () => {
    api.claims = [claim()];
    renderAt('/receipts?tab=credits&credit=elsewhere');
    expect(await screen.findByTestId('credit-not-here')).toHaveTextContent(
      "not in this house's ledger. It may belong to another house.",
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the link' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?tab=credits'));
    expect(screen.queryByTestId('credit-not-here')).toBeNull();
  });
});

describe('the move table matches the gateway', () => {
  it('CREDIT_MOVES equals TRANSITIONS in credit-ledger.ts', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../api-gateway/src/procurement/documents/credit-ledger.ts'),
      'utf8',
    );
    const block = /const TRANSITIONS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(src);
    expect(block).not.toBeNull();
    const server: Record<string, string[]> = {};
    for (const m of block![1].matchAll(/(\w+):\s*\[([^\]]*)\]/g))
      server[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
    expect(Object.keys(server).sort()).toEqual(Object.keys(CREDIT_MOVES).sort());
    for (const [from, tos] of Object.entries(CREDIT_MOVES))
      expect([...tos].sort()).toEqual([...server[from]].sort());
  });
});
