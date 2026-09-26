/**
 * The credit ledger lane on the rebuilt /receipts (ADR 0149 row 22).
 *
 * What is pinned here: the tab is offered by the role IN THIS HOUSE (ADR 0167),
 * the legacy page is never loaded, figures are never added across currencies,
 * a window is a floor, an unknown is not an empty, "requested" says Mudavym
 * sent nothing, and a settlement names a real credit memo and an amount.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
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

// The legacy page must never be loaded by the rebuilt route. If anything on
// this page imports it again, this factory throws and the test fails.
vi.mock('../../ReceiptsPage', () => {
  throw new Error('the legacy ReceiptsPage was imported by the rebuilt /receipts');
});

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

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ReceiptsNext />
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
    expect(canSeeCreditLedger('ADMIN', null)).toBe(true);
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
    expect(await screen.findByText(/the gateway refused it to this session/i)).toBeTruthy();
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

  it('says an empty ledger is empty only once the gateway has answered', async () => {
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/No credit claim has been opened at this house/)).toBeTruthy();
    expect(await screen.findByText(/No claim is being chased right now/)).toBeTruthy();
  });

  it('names a failed list instead of rendering it as no claims', async () => {
    api.claimsFail = new Error('boom');
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/Could not read the claims \(boom\)/)).toBeTruthy();
    expect(screen.queryByText(/No claim is being chased/)).toBeNull();
  });

  it('marks the list a floor when it filled the server window', async () => {
    api.claims = Array.from({ length: 200 }, (_, i) => claim({ id: `c${i}` }));
    renderAt('/receipts?tab=credits');
    expect(await screen.findByText(/newer claims exist that are not shown here/)).toBeTruthy();
    expect(screen.getByText(/≥200 · oldest first/)).toBeTruthy();
  });
});

describe('moves', () => {
  it('"I asked the vendor" says Mudavym sends nothing, then records requested', async () => {
    api.claims = [claim()];
    api.transition.mockResolvedValue(claim({ state: 'requested' }));
    renderAt('/receipts?tab=credits');
    fireEvent.click(await screen.findByText('Billed for more than arrived'));
    fireEvent.click(await screen.findByRole('button', { name: 'I asked the vendor' }));
    expect(screen.getByText(/Mudavym sends nothing to the vendor/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Record: i asked the vendor/i }));
    await waitFor(() =>
      expect(api.transition).toHaveBeenCalledWith('c1', {
        to: 'requested',
        creditedAmount: undefined,
        creditDocumentId: undefined,
      }),
    );
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
      await screen.findByText(/Cannot move a claim from open to promised\. \(HTTP 422\) — the claim is unchanged\./),
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
    expect(await screen.findByRole('button', { name: 'I asked the vendor again' })).toBeTruthy();
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
