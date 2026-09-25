/**
 * A FAILED MINT IS A FAILURE IN WORDS, NEVER A SILENT UNSEALED CALL.
 *
 * Founder, 2026-09-06 (batch 64): *"Decide as a module: seal all three"* —
 * verify, line edit and currency restatement each take a redeemed seal. The
 * gateway's own refusals are proven in `documents.seal.spec.ts`; this file
 * proves the two things only the browser can get wrong:
 *
 *   1. THE TIMING. The seal is minted when the gesture BEGINS. A token fetched
 *      at the moment of the write is one more thing the same request asked for
 *      itself, which is the assertion model with extra steps — so the mint is
 *      asserted to have happened BEFORE the write, not merely alongside it.
 *   2. THE FALLBACK THAT MUST NOT EXIST. When a mint fails or resolves null,
 *      NOTHING is sent. A page that quietly called the unsealed route on a
 *      failed mint would defeat the whole mechanism through the UI while every
 *      gateway test still passed.
 *
 * The last block is a SOURCE contract on the legacy `/receipts` page, which
 * `PageGate` still renders whenever the Mudavym flag is off. Rendering that page
 * means standing up six contexts to assert one call shape; reading it is the
 * honest way to say "no control in this file can verify without a seal".
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createContext, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
        Promise.resolve(opts.status === 'verified' ? [] : api.queue),
      detail: () => Promise.resolve(api.detail),
      match: vi.fn(),
      linkLine: vi.fn(() => Promise.resolve()),
      editLine: api.editLine,
      verify: api.verify,
      restateCurrency: api.restateCurrency,
      mintVerifySeal: api.mintVerifySeal,
      mintLineEditSeal: api.mintLineEditSeal,
      mintCurrencySeal: api.mintCurrencySeal,
    },
  };
});
vi.mock('../../../services/api/receiving', () => ({
  receivingApi: { listUnverified: () => Promise.resolve({ items: [] }) },
}));
vi.mock('../../documents/next/CanonicalDocumentPage', () => ({
  CanonicalDocumentPage: () => <div data-testid="formatted-document" />,
}));
vi.mock('../../../services/api/orders', () => ({
  getOrder: () => Promise.resolve({ id: 'o1', orderNumber: 'PO-14' }),
}));

import ReceiptsNext from './ReceiptsNext';
import { SwipeToConfirm } from './SwipeToConfirm';

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

function holdToApprove(name: RegExp) {
  const control = screen.getByRole('button', { name });
  fireEvent.keyDown(control, { key: 'Enter' });
  fireEvent.keyDown(control, { key: 'Enter' });
}

async function stageCorrection() {
  const qty = screen.getByLabelText('Quantity, line 1');
  fireEvent.change(qty, { target: { value: '11' } });
  fireEvent.blur(qty);
  await screen.findByText(/Nothing has been written yet/);
}

/* ─── 0. The fixture's premise, asserted ───────────────────────────────── */

describe('the sealed page still prints the document\'s own money', () => {
  it("prints the DOCUMENT's stated currency, never a dollar sign", async () => {
    // The seal changed how these acts are AUTHORISED, not what the page says
    // money is in. A fixture that stated a currency and never checked it would
    // be a premise nobody reads.
    const { container } = render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    expect(container.textContent).toContain('Filed in EUR - Euro');
    expect(container.textContent).not.toContain('$412.50');
  });
});

/* ─── 1. The timing ────────────────────────────────────────────────────── */

describe('the seal is minted when the gesture begins, not by the write', () => {
  it('mints the line-edit seal BEFORE the correction is sent', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await stageCorrection();
    holdToApprove(/Hold to seal this correction/);
    await waitFor(() => expect(api.editLine).toHaveBeenCalled());
    expect(api.calls).toEqual(['mintLineEditSeal', 'editLine']);
  });

  it('mints the currency seal BEFORE the restatement is sent', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.change(screen.getByLabelText('Currency this invoice is denominated in'), {
      target: { value: 'TRY' },
    });
    holdToApprove(/Hold to file this invoice in TRY/);
    await waitFor(() => expect(api.restateCurrency).toHaveBeenCalled());
    expect(api.calls).toEqual(['mintCurrencySeal', 'restateCurrency']);
  });

  it('mints the verify seal BEFORE the confirmation is sent', async () => {
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), {
      key: ' ',
    });
    await waitFor(() => expect(api.verify).toHaveBeenCalled(), { timeout: 3000 });
    expect(api.calls).toEqual(['mintVerifySeal', 'verify']);
  });
});

/* ─── 2. The fallback that must not exist ──────────────────────────────── */

describe('a failed mint sends nothing, and says so', () => {
  it('does not correct a line when the mint refuses', async () => {
    api.mintLineEditSeal.mockRejectedValue(
      Object.assign(new Error('This document changed after the seal was issued'), {
        response: { status: 403 },
      }),
    );
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    await stageCorrection();
    holdToApprove(/Hold to seal this correction/);
    expect(await screen.findByText(/The seal could not be issued/)).toBeTruthy();
    expect(api.editLine).not.toHaveBeenCalled();
  });

  it('does not restate the currency when the mint resolves null', async () => {
    api.mintCurrencySeal.mockResolvedValue(null);
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.change(screen.getByLabelText('Currency this invoice is denominated in'), {
      target: { value: 'TRY' },
    });
    holdToApprove(/Hold to file this invoice in TRY/);
    expect(await screen.findByText(/The seal could not be issued/)).toBeTruthy();
    expect(api.restateCurrency).not.toHaveBeenCalled();
  });

  it('does not verify when the mint refuses', async () => {
    api.mintVerifySeal.mockRejectedValue(new Error('nope'));
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), {
      key: ' ',
    });
    expect(
      await screen.findByText(/The seal could not be issued — nothing was confirmed/, {}, {
        timeout: 3000,
      }),
    ).toBeTruthy();
    expect(api.verify).not.toHaveBeenCalled();
  });

  it('leaves the currency hold disabled for staff, with the sentence and no seal', async () => {
    api.role = 'staff';
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    // DISABLED WITH THE SENTENCE, NEVER HIDDEN. The picker is disabled, so a
    // staff member cannot choose a code, and the hold stays on its "choose a
    // currency first" face — visible, refused in words.
    expect(
      (screen.getByLabelText('Currency this invoice is denominated in') as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    const hold = screen.getByRole('button', { name: /Choose a currency first/ });
    expect((hold as HTMLButtonElement).disabled).toBe(true);
    holdToApprove(/Choose a currency first/);
    await waitFor(() => expect(api.mintCurrencySeal).not.toHaveBeenCalled());
    expect(api.restateCurrency).not.toHaveBeenCalled();
    expect(screen.getByText(/Ask a manager or an owner/)).toBeTruthy();
  });

  it('refuses the hold for staff even if a code somehow reaches the picker', async () => {
    // jsdom will dispatch a change on a DISABLED select where a browser would
    // not, so this is the belt: the seal and the write are gated on the ROLE as
    // well as on the choice, and the gateway asserts the role a third time at
    // both the mint and the write.
    api.role = 'staff';
    render(<ReceiptsNext />, { wrapper });
    await openFirstDoc();
    fireEvent.change(screen.getByLabelText('Currency this invoice is denominated in'), {
      target: { value: 'TRY' },
    });
    const hold = screen.getByRole('button', { name: /Hold to file this invoice in TRY/ });
    expect((hold as HTMLButtonElement).disabled).toBe(true);
    holdToApprove(/Hold to file this invoice in TRY/);
    await waitFor(() => expect(api.mintCurrencySeal).not.toHaveBeenCalled());
    expect(api.restateCurrency).not.toHaveBeenCalled();
  });
});

/* ─── 3. SwipeToConfirm's own contract ─────────────────────────────────── */

describe('SwipeToConfirm carries the same onChallenge contract as HoldToApprove', () => {
  it('hands the token to onConfirm when the mint succeeds', async () => {
    const onConfirm = vi.fn();
    render(
      <SwipeToConfirm
        label="Swipe up to confirm"
        assertion="Confirms the transcription."
        onChallenge={() => Promise.resolve('tok-1')}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), {
      key: ' ',
    });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('tok-1'), { timeout: 3000 });
  });

  it('keeps the unsealed shape for a caller that passes no onChallenge', async () => {
    const onConfirm = vi.fn();
    render(
      <SwipeToConfirm
        label="Swipe up to confirm"
        assertion="Confirms the transcription."
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: /Swipe up to confirm/ }), {
      key: ' ',
    });
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(null), { timeout: 3000 });
  });
});

/* ─── 4. The legacy page, as a source contract ─────────────────────────── */

describe('the legacy /receipts page cannot verify without a seal', () => {
  const SOURCE =
    process.env.RECEIPTS_LEGACY_SOURCE ??
    resolve(__dirname, '../../ReceiptsPage.tsx');
  const src = readFileSync(SOURCE, 'utf8');
  /** Comment lines stripped, so prose about the seal is not a call. */
  const code = src
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ''))
    .join('\n');

  it('mints a verify seal', () => {
    expect(code).toMatch(/documentsApi\.mintVerifySeal\(/);
  });

  it('passes a challenge to every verify it makes', () => {
    const calls = [...code.matchAll(/documentsApi\.verify\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).toMatch(/challenge/);
  });

  it('reaches the verify route through no other path', () => {
    // An `apiClient.post(.../verify...)` in this file would be a verification
    // that carries no `X-Seal-Challenge` header at all.
    expect(code).not.toMatch(/apiClient\.post\([^)]*\/verify/);
  });

  it('drives it from the house hold-to-approve control, not a bare button', () => {
    expect(code).toMatch(/<HoldToApprove/);
    expect(code).toMatch(/onChallenge=\{onMintSeal\}/);
  });
});
