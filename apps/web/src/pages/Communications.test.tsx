/**
 * Legacy `/communications` — the page most tenants are actually on.
 *
 * `/communications` is one route behind a `PageGate` (`App.tsx:325`), and
 * `mudavym_design_communications` is `defaultValue: false`
 * (`apps/api-gateway/src/settings/feature-flag-registry.ts:104-107`). So this
 * component ships until a restaurant is individually flipped, and its labels —
 * not `CommunicationsNext`'s — are what a manager sees today.
 *
 * ADR 0084 widened `getConversationHistory` to admit inbound vendor replies.
 * Every one of them carries `status: 'DRAFT'` — the column DEFAULT the inbound
 * writer never sets — and `OUTCOME_LABELS` has no `DRAFT` key, so the chip fell
 * through to the raw enum token and told the manager a message the vendor sent
 * them was a draft. Same defect class as the one killed on `CommunicationsNext`;
 * `tsc` cannot see a wrong string literal, and there was no test here at all.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProcurementSendHistory } from './Communications';
import type { ProcurementHistoryItem } from '../hooks/queries/useConversationQueries';

function item(over: Partial<ProcurementHistoryItem> = {}): ProcurementHistoryItem {
  return {
    id: 'c1',
    orderId: 'o1',
    providerId: 'p1',
    direction: 'OUTBOUND',
    emailType: 'PRICE_INQUIRY',
    status: 'SENT',
    roundCount: 1,
    createdAt: '2026-08-29T10:00:00Z',
    sentAt: '2026-08-29T10:00:00Z',
    draftContent: 'Dear Bodega, could you hold 6 at $18.40?',
    constraintFlags: null,
    rollingSummary: null,
    orderNumber: 'PO-014',
    quantity: 6,
    wineName: 'Albariño 2022',
    providerName: 'Bodega Álvaro',
    ...over,
  };
}

/**
 * Exactly the shape `apps/api-gateway/src/procurement/conversation-ledger.spec.ts:34-45`
 * asserts the gateway returns for production's ten inbound rows: uppercased
 * `direction`, NULL `outbound_email_type`, and the column DEFAULT `'DRAFT'`.
 */
const inbound = () =>
  item({
    id: 'in-0',
    direction: 'INBOUND',
    emailType: null,
    status: 'DRAFT',
    orderId: null,
    orderNumber: null,
    quantity: null,
    wineName: null,
    draftContent: 'Vendor reply number 0',
  });

function renderHistory(items: ProcurementHistoryItem[]) {
  return render(
    <ProcurementSendHistory
      items={items}
      isLoading={false}
      expandedRowId={null}
      onExpandRow={vi.fn()}
      // The list filters on `sentAt >= dateFrom`; pin it so the fixture's date
      // cannot age out of the default 30-day window and make this vacuous.
      dateFrom="2020-01-01"
      onDateFromChange={vi.fn()}
      providerFilter=""
      onProviderFilterChange={vi.fn()}
      typeFilter=""
      onTypeFilterChange={vi.fn()}
      wineFilter=""
      onWineFilterChange={vi.fn()}
    />,
  );
}

describe('legacy /communications — the procurement send history', () => {
  it('never labels a received vendor reply with the outbound lifecycle', () => {
    renderHistory([inbound()]);
    // The row is on screen at all.
    expect(screen.getByText('Bodega Álvaro')).toBeInTheDocument();
    // 'DRAFT' is the column DEFAULT on an inbound row, not a claim about it.
    expect(screen.queryByText('DRAFT')).toBeNull();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByText('Vendor reply')).toBeInTheDocument();
  });

  it('still says the outbound lifecycle for an outbound row', () => {
    renderHistory([item({ status: 'SEND_UNCONFIRMED' })]);
    expect(screen.getByText('Sent · unconfirmed')).toBeInTheDocument();
    expect(screen.queryByText('Received')).toBeNull();
    expect(screen.queryByText('Vendor reply')).toBeNull();
    // 'Price Inquiry' is also one of the type-filter <option>s, so assert on
    // the row's own chip rather than page-wide text.
    expect(
      screen.getAllByText('Price Inquiry').some((el) => el.tagName === 'SPAN'),
    ).toBe(true);
  });

  it('says an absent status rather than inventing one', () => {
    renderHistory([item({ status: null })]);
    expect(screen.getByText('No status recorded')).toBeInTheDocument();
  });
});
