/**
 * The responses sheet — the three acts the legacy `OrderApprovalModal` had.
 *
 * Each case below is a way this sheet could lie about a vendor's answer, and
 * every one of them is a lie the deleted modal actually told or made possible:
 *
 *  1. the summary is the ENGINE'S OWN SENTENCE, printed unchanged, with the
 *     engine and the time it read beside it. The modal printed the same string
 *     with no attribution at all, so a model's claim about a vendor read as the
 *     house's own record.
 *  2. NO summary is a SENTENCE, not blank space. The modal hid the whole
 *     section when `conversationSummary` was empty — an absence rendered as
 *     health, on the field that carries what the vendor said.
 *  3. a FAILED read says so, and is never rendered as "no answers". supabase-js
 *     resolves `{ data, error }` rather than throwing, so these two states are
 *     indistinguishable unless one is forced to prove itself.
 *  4. an EMPTY read says something different again — a fact about the vendor,
 *     not about the network.
 *  5. stepping is real: arrow keys and the two controls move between answers,
 *     oldest first. `allProviderResponses` in the modal was never populated
 *     from anything, so its Next/Previous stepped through a permanently empty
 *     array.
 *  6. a rejection without words does NOT send. The route takes `reason` as an
 *     optional query parameter, so nothing but this refusal stops an order
 *     being cancelled with no record of why.
 *  7. a rejection WITH words sends them.
 *  8. confirm is the same sealed approve as the ledger row — the mint runs when
 *     the hold begins, and the token is carried onto the write.
 *  9. the agreed price is printed WITH its unit and pack (ADR 0119). The modal
 *     printed `${finalPrice}/bottle` on every order, including case-priced ones.
 * 10. an order past the pending stage offers neither act, and says why.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const approveMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));
const cancelMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));
const mintMock = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'seal-token'));
// ADR 0125: rejecting mints its own token, for the act `cancel`.
const cancelMintMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => 'cancel-seal-token'),
);
const convosMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const proposalMock = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: mintMock,
  mintOrderCancelSeal: cancelMintMock,
}));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => approveMock,
  useCancelOrder: () => cancelMock,
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/queries/useDraftEmailQueries', () => ({
  useOrderConversations: () => convosMock.current,
  useDealProposal: () => proposalMock.current,
}));

import { LedgerRow } from './LedgerRow';
import { RECURRENCE_UNREAD } from './recurrence';
import { ResponsesSheet, REJECT_SEAL_NOTE } from './ResponsesSheet';
import {
  NO_ANSWER_YET,
  NO_SUMMARY_WRITTEN,
  REJECT_NEEDS_A_REASON,
  VENDOR_DECLINED_NOTE,
  describeOrderedQuantity,
  isDecline,
  readVendorResponses,
  reasonIsGiven,
  summaryProvenance,
} from './responses';
import { fmtDate } from './format';
import type { OrderRowVM } from './useOrdersNextData';

/* ── fixtures ────────────────────────────────────────────────────────────── */

/**
 * One row of `GET /procurement/orders/:id/conversations` as the ROUTE
 * serialises it — direction uppercased, body under `draftContent`, the summary
 * under `rollingSummary`. Built from the wire shape rather than from the DTO
 * type for the same reason `LedgerUnit.test.tsx` does: the failure that hides
 * here is a key name, and a fixture built from the interface cannot see one.
 */
function convo(over: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    orderId: 'o-1',
    status: 'SENT',
    direction: 'INBOUND',
    emailType: null,
    roundCount: 1,
    createdAt: '2026-09-03T09:00:00Z',
    sentAt: '2026-09-03T09:00:00Z',
    draftContent: 'We can hold twelve cases at 420 the case through Friday.',
    rollingSummary: 'Vendor holds $420 per case of 12 through Friday.',
    summaryModel: 'claude-haiku-4-5',
    summaryAnalyzedAt: '2026-09-03T09:02:00Z',
    detectedIntent: 'counter_offer',
    detectedSentiment: 'positive',
    specialConditions: [],
    senderVerified: true,
    providerName: 'Anadolu',
    ...over,
  };
}

function row(over: Partial<OrderRowVM> = {}): OrderRowVM {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    wineName: 'Barolo Riserva',
    producer: 'Giacomo Conterno',
    providerName: 'Anadolu',
    quantity: 5,
    unitPrice: 420,
    bottlesTotal: 60,
    unitType: 'case',
    priceUnit: { read: true, stated: { priceUom: 'case', pricePackSize: 12 } },
    // ADR 0119 Q3: the list route reads the line's fee columns, and this
    // agreement names none. `read: true` with three nulls is "looked, found
    // nothing"; `read: false` would be "never looked".
    fees: { read: true, fees: { allowance: null, deposit: null, freight: null } },
    agreement: {
      ok: true,
      goods: 2100,
      total: 2100,
      working: '5 cases at $420.00 per case.',
    },
    computedTotal: 2100,
    listedTotal: 2100,
    total: 2100,
    stage: 'pending',
    status: 'pending',
    recurring: false,
    // Not read: this fixture is a hand-built row, not a wire payload.
    recurrence: RECURRENCE_UNREAD,
    recurrenceLabel: null,
    requestedAt: '2026-09-01T10:00:00Z',
    approvedAt: null,
    deliveredAt: null,
    notes: null,
    ...over,
  };
}

function mount(over: Partial<OrderRowVM> = {}, props: Record<string, unknown> = {}) {
  return render(
    <ResponsesSheet open onClose={() => {}} row={row(over)} {...props} />,
  );
}

const confirmDie = () => screen.getByRole('button', { name: /hold to confirm/i });
const rejectDie = () => screen.getByRole('button', { name: /hold to reject/i });

/** Enter arms, Enter commits — a click on a hold fires nothing at all. */
function hold(el: HTMLElement) {
  fireEvent.keyDown(el, { key: 'Enter' });
  fireEvent.keyDown(el, { key: 'Enter' });
}

beforeEach(() => {
  approveMock.mutate.mockReset();
  approveMock.isPending = false;
  cancelMock.mutate.mockReset();
  cancelMock.isPending = false;
  mintMock.mockReset();
  mintMock.mockResolvedValue('seal-token');
  cancelMintMock.mockReset();
  cancelMintMock.mockResolvedValue('cancel-seal-token');
  convosMock.current = { data: [convo()], isError: false, error: null };
  proposalMock.current = { data: null };
});

/* ── the pure half ───────────────────────────────────────────────────────── */

describe('readVendorResponses', () => {
  it('keeps only the vendor’s side of the exchange', () => {
    const out = readVendorResponses([
      convo({ id: 'a', direction: 'OUTBOUND' }),
      convo({ id: 'b', direction: 'INBOUND' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['b']);
  });

  it('normalises the direction the COLUMN stores, not just the one the route sends', () => {
    // `procurement_conversations.direction` holds lowercase; the route
    // uppercases it. A strict comparison here would report a full mailbox as
    // "no answer from the vendor" the day that stopped.
    const out = readVendorResponses([convo({ id: 'b', direction: 'inbound' })]);
    expect(out).toHaveLength(1);
  });

  it('reads oldest first, so a negotiation is read in the order it happened', () => {
    const out = readVendorResponses([
      convo({ id: 'late', sentAt: '2026-09-04T09:00:00Z' }),
      convo({ id: 'early', sentAt: '2026-09-02T09:00:00Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['early', 'late']);
  });

  it('treats an empty summary string as no summary, not as a summary', () => {
    const [r] = readVendorResponses([convo({ rollingSummary: '   ' })]);
    expect(r.summary).toBeNull();
  });

  it('reads an unknown sender verdict as null rather than as unverified', () => {
    const [r] = readVendorResponses([convo({ senderVerified: null })]);
    expect(r.senderVerified).toBeNull();
  });
});

describe('summaryProvenance', () => {
  it('names the engine and when it read', () => {
    const [r] = readVendorResponses([convo()]);
    expect(summaryProvenance(r, fmtDate)).toMatch(/claude-haiku-4-5/);
  });

  it('says the row does not record an engine rather than naming one', () => {
    const [r] = readVendorResponses([
      convo({ summaryModel: null, summaryAnalyzedAt: null }),
    ]);
    const line = summaryProvenance(r, fmtDate);
    expect(line).toMatch(/does not record which engine wrote it/);
    expect(line).not.toMatch(/claude/);
  });

  it('says nothing at all when there is no summary to attribute', () => {
    const [r] = readVendorResponses([convo({ rollingSummary: null })]);
    expect(summaryProvenance(r, fmtDate)).toBeNull();
  });
});

describe('describeOrderedQuantity', () => {
  it('divides the pack out rather than assuming one', () => {
    expect(
      describeOrderedQuantity({ quantity: 5, unitType: 'case', bottlesTotal: 60 }),
    ).toBe('5 cases of 12 — 60 bottles');
  });

  it('states no pack when the division does not come out whole', () => {
    expect(
      describeOrderedQuantity({ quantity: 4, unitType: 'case', bottlesTotal: 50 }),
    ).toBe('4 cases — 50 bottles');
  });

  it('is null when the quantity is unknown — never a zero', () => {
    expect(
      describeOrderedQuantity({ quantity: null, unitType: 'case', bottlesTotal: 60 }),
    ).toBeNull();
  });
});

describe('reasonIsGiven', () => {
  it('refuses whitespace', () => {
    expect(reasonIsGiven('   ')).toBe(false);
    expect(reasonIsGiven('')).toBe(false);
  });

  it('accepts words', () => {
    expect(reasonIsGiven('price too high')).toBe(true);
  });
});

/* ── the summary, on screen ──────────────────────────────────────────────── */

describe('the negotiation summary', () => {
  it('prints the engine’s own sentence, unchanged, with its provenance', () => {
    mount();
    expect(screen.getByTestId('response-summary')).toHaveTextContent(
      'Vendor holds $420 per case of 12 through Friday.',
    );
    expect(screen.getByTestId('response-summary-provenance')).toHaveTextContent(
      /claude-haiku-4-5/,
    );
  });

  it('says one was not written rather than leaving the section blank', () => {
    convosMock.current = {
      data: [convo({ rollingSummary: null })],
      isError: false,
      error: null,
    };
    mount();
    expect(screen.queryByTestId('response-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('response-no-summary')).toHaveTextContent(
      NO_SUMMARY_WRITTEN.slice(0, 40),
    );
  });
});

/* ── the three states of a read ──────────────────────────────────────────── */

describe('a read that fails', () => {
  it('says unknown, and never "no answers"', () => {
    convosMock.current = {
      data: undefined,
      isError: true,
      error: { message: 'Network Error' },
    };
    mount();
    expect(screen.getByTestId('responses-unreadable')).toHaveTextContent(
      /could not be read \(Network Error\)/,
    );
    expect(screen.getByTestId('responses-unreadable')).toHaveTextContent(
      /unknown, not empty/,
    );
    expect(screen.queryByTestId('responses-none')).not.toBeInTheDocument();
  });
});

describe('a read that finds nothing', () => {
  it('says the vendor has not answered — a different fact from the one above', () => {
    convosMock.current = { data: [], isError: false, error: null };
    mount();
    expect(screen.getByTestId('responses-none')).toHaveTextContent(
      NO_ANSWER_YET.slice(0, 40),
    );
    expect(screen.queryByTestId('responses-unreadable')).not.toBeInTheDocument();
  });
});

/* ── stepping ────────────────────────────────────────────────────────────── */

describe('stepping between answers', () => {
  beforeEach(() => {
    convosMock.current = {
      data: [
        convo({ id: 'c-1', sentAt: '2026-09-02T09:00:00Z', rollingSummary: 'First answer.' }),
        convo({ id: 'c-2', sentAt: '2026-09-03T09:00:00Z', rollingSummary: 'Second answer.' }),
        convo({ id: 'c-3', sentAt: '2026-09-04T09:00:00Z', rollingSummary: 'Third answer.' }),
      ],
      isError: false,
      error: null,
    };
  });

  it('opens on the first and counts them', () => {
    mount();
    expect(screen.getByTestId('responses-step')).toHaveTextContent('Answer 1 of 3');
    expect(screen.getByTestId('response-summary')).toHaveTextContent('First answer.');
  });

  it('steps forward on the right arrow', () => {
    mount();
    fireEvent.keyDown(screen.getByTestId('response-section'), { key: 'ArrowRight' });
    expect(screen.getByTestId('responses-step')).toHaveTextContent('Answer 2 of 3');
    expect(screen.getByTestId('response-summary')).toHaveTextContent('Second answer.');
  });

  it('steps back on the left arrow, and stops at the first', () => {
    mount();
    fireEvent.keyDown(screen.getByTestId('response-section'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('response-section'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByTestId('response-section'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('responses-step')).toHaveTextContent('Answer 1 of 3');
  });

  it('steps on the controls too, and disables them at the ends', () => {
    mount();
    expect(screen.getByTestId('responses-prev')).toBeDisabled();
    fireEvent.click(screen.getByTestId('responses-next'));
    fireEvent.click(screen.getByTestId('responses-next'));
    expect(screen.getByTestId('responses-step')).toHaveTextContent('Answer 3 of 3');
    expect(screen.getByTestId('responses-next')).toBeDisabled();
  });

  it('leaves the arrows alone while a reason is being typed', () => {
    mount();
    const box = screen.getByTestId('reject-reason');
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(screen.getByTestId('responses-step')).toHaveTextContent('Answer 1 of 3');
  });
});

/* ── the two acts ────────────────────────────────────────────────────────── */

describe('reject', () => {
  it('will not send without a reason, and says why', async () => {
    mount();
    hold(rejectDie());
    await waitFor(() =>
      expect(screen.getByTestId('reject-needs-reason')).toHaveTextContent(
        REJECT_NEEDS_A_REASON.slice(0, 40),
      ),
    );
    expect(cancelMock.mutate).not.toHaveBeenCalled();
    // ADR 0125: a missing reason stops the gesture at the MINT, so no seal is
    // spent and none is even asked for.
    expect(cancelMintMock).not.toHaveBeenCalled();
  });

  it('mints a cancel seal when the hold begins and carries it onto the write', async () => {
    mount();
    fireEvent.change(screen.getByTestId('reject-reason'), {
      target: { value: 'Price is 18% over what we last paid.' },
    });
    hold(rejectDie());
    await waitFor(() => expect(cancelMock.mutate).toHaveBeenCalled());
    expect(cancelMintMock).toHaveBeenCalledWith('o-1');
    expect(cancelMock.mutate).toHaveBeenCalledWith(
      {
        orderId: 'o-1',
        reason: 'Price is 18% over what we last paid.',
        challenge: 'cancel-seal-token',
      },
      expect.anything(),
    );
  });

  it('cancels nothing at all when the cancel seal cannot be minted', async () => {
    cancelMintMock.mockResolvedValue(null);
    mount();
    fireEvent.change(screen.getByTestId('reject-reason'), {
      target: { value: 'No longer needed.' },
    });
    hold(rejectDie());
    await waitFor(() => expect(cancelMintMock).toHaveBeenCalled());
    expect(cancelMock.mutate).not.toHaveBeenCalled();
  });

  it('states what the hold on a rejection proves', () => {
    mount();
    expect(screen.getByTestId('reject-seal-note')).toHaveTextContent(
      REJECT_SEAL_NOTE.slice(0, 40),
    );
  });
});

describe('confirm', () => {
  it('mints when the hold begins and carries the token onto the write', async () => {
    mount();
    hold(confirmDie());
    await waitFor(() => expect(approveMock.mutate).toHaveBeenCalled());
    expect(mintMock).toHaveBeenCalledWith('o-1');
    expect(approveMock.mutate).toHaveBeenCalledWith(
      { orderId: 'o-1', challenge: 'seal-token' },
      expect.anything(),
    );
  });

  it('approves nothing at all when the seal cannot be minted', async () => {
    mintMock.mockResolvedValue(null);
    mount();
    hold(confirmDie());
    await waitFor(() => expect(mintMock).toHaveBeenCalled());
    expect(approveMock.mutate).not.toHaveBeenCalled();
  });

  it('is disabled, never hidden, when this house’s rules hold the order', () => {
    mount(
      {},
      {
        approval: {
          orderId: 'o-1',
          requiredRole: 'owner',
          firedBy: ['manager_ceiling'],
          reasons: ['over the 1000 ceiling'],
          untestable: [],
          mayApprove: false,
          sentence: 'This order waits for an owner to seal it.',
        },
      },
    );
    expect(confirmDie()).toBeDisabled();
    expect(screen.getByText(/waits for an owner to seal it/i)).toBeInTheDocument();
  });
});

/* ── the price, and the stages with no act ───────────────────────────────── */

describe('the agreed price', () => {
  it('is printed with its unit and its pack, not as a bare number', () => {
    mount();
    expect(screen.getByTestId('sheet-agreed-price')).toHaveTextContent(
      '$420.00 per case (12 bottles)',
    );
  });

  it('prints the register’s refusal when no unit is stated', () => {
    mount({ priceUnit: { read: true, stated: null } });
    expect(screen.getByTestId('sheet-price-unit-unstated')).toBeInTheDocument();
  });
});

describe('the ledger row opens it', () => {
  function mountRow(props: Record<string, unknown> = {}) {
    return render(
      <LedgerRow
        row={row()}
        expanded
        onToggle={() => {}}
        selected={false}
        onSelectChange={() => {}}
        bulkRunning={false}
        {...props}
      />,
    );
  }

  it('offers the control at every stage, not only where an act is available', () => {
    const onOpen = vi.fn();
    mountRow({ onOpenResponses: onOpen, row: row({ stage: 'delivered', status: 'delivered' }) });
    fireEvent.click(screen.getByTestId('open-responses'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders no control at all when the page gives it no opener', () => {
    // The prop is optional so the row keeps working outside `OrdersNext`; a
    // button wired to nothing would be the rehearsal-die fault without the
    // rehearsal label.
    mountRow();
    expect(screen.queryByTestId('open-responses')).not.toBeInTheDocument();
  });
});

describe('an order past the pending stage', () => {
  it('offers neither act and says so', () => {
    mount({ stage: 'delivered', status: 'delivered' });
    expect(screen.queryByTestId('responses-acts')).not.toBeInTheDocument();
    expect(screen.getByTestId('responses-no-acts')).toHaveTextContent(
      /nothing to confirm or reject here/i,
    );
    // The answers stay readable — the record does not close with the order.
    expect(screen.getByTestId('response-summary')).toBeInTheDocument();
  });
});


/**
 * ADR 0125 Q3 — founder, 2026-09-05: "Return to NEGOTIATING, with the decline
 * recorded."
 *
 * The gateway stopped writing terminal REJECTED for a vendor's no, so the order
 * stays OPEN after one. The sheet has to say that: a refusal sitting on a live
 * order, with nothing explaining why it is still live, is worse than the old
 * behaviour because it looks like a bug.
 */
describe('a vendor decline', () => {
  it.each(['rejection', 'declined', 'out_of_stock', 'OUT_OF_STOCK', ' Rejection '])(
    'is read from intent %s',
    (intent) => {
      expect(isDecline(intent)).toBe(true);
    },
  );

  it.each(['counter_offer', 'price_acceptance', 'question', '', null, undefined, 7])(
    'is NOT read from %s',
    (intent) => {
      // `counter_offer` is the one that matters: haggling is not refusing, and
      // marking it as a decline would put the note on every negotiation.
      expect(isDecline(intent)).toBe(false);
    },
  );

  it('is carried onto the response the sheet renders', () => {
    const [row] = readVendorResponses([convo({ detectedIntent: 'out_of_stock' })]);
    expect(row.declined).toBe(true);
    expect(readVendorResponses([convo()])[0].declined).toBe(false);
  });

  it('is said on the answer, and says the order is still open', () => {
    convosMock.current = {
      data: [convo({ detectedIntent: 'rejection' })],
      isError: false,
      error: null,
    };
    mount();
    const note = screen.getByTestId('response-declined');
    expect(note).toHaveTextContent(VENDOR_DECLINED_NOTE.slice(0, 40));
    expect(note).toHaveTextContent(/still open/i);
  });

  it('says nothing of the kind on an ordinary answer', () => {
    mount();
    expect(screen.queryByTestId('response-declined')).toBeNull();
  });
});
