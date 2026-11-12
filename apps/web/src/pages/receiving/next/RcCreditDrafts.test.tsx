/**
 * The drafted-claim card says the claim in the house's words: the reason and
 * the state as /receipts says them, never the raw codes `short_shipped` or
 * `state open` (seen on the local stack, 2026-11-12), and the money in the
 * claim's own currency.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProcurementCredit } from '@/services/api/credits';
import type { CreditDraftsData } from './useReceivingNextData';

vi.mock('./useReceivingNextData', () => ({
  useApproveCreditDraft: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { RcCreditDrafts } from './RcCreditDrafts';

const claim = (over: Partial<ProcurementCredit>): ProcurementCredit =>
  ({
    id: 'c1',
    restaurant_id: 'r',
    provider_id: 'p',
    order_id: '16a1e086-41b3-4fc2-80e1-78144a3ec4e2',
    document_id: null,
    state: 'open',
    claimed_amount: 900,
    credited_amount: null,
    credit_document_id: null,
    currency: 'TRY',
    reason: 'short_shipped',
    summary: null,
    notes: null,
    self_evidenced: false,
    opened_at: '2026-11-09T10:00:00Z',
    requested_at: null,
    promised_at: null,
    ...over,
  }) as ProcurementCredit;

const data = (drafts: ProcurementCredit[]): CreditDraftsData => ({
  drafts,
  hasData: true,
  isLoading: false,
  isError: false,
  failure: null,
  refetch: vi.fn(),
});

describe('RcCreditDrafts words', () => {
  it('says the reason and the state in words, never the codes', () => {
    render(<RcCreditDrafts data={data([claim({})])} />);
    expect(screen.getAllByText('Lost between their warehouse and the door').length).toBeGreaterThan(0);
    expect(screen.getByText(/Opened — the vendor has not been asked/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/short_shipped/);
    expect(document.body.textContent).not.toMatch(/state open/);
  });

  it('prefers the matcher sentence, and names an unknown code rather than printing it bare', () => {
    render(<RcCreditDrafts data={data([claim({ reason: 'mystery_code', summary: 'Two bottles short on the slip.' })])} />);
    expect(screen.getByText('Two bottles short on the slip.')).toBeInTheDocument();
    expect(screen.getByText('Recorded as “mystery_code”')).toBeInTheDocument();
  });
});
