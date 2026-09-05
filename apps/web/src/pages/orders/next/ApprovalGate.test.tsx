/**
 * The awaiting state, in words, on the row.
 *
 * ADR 0116 gave `/settings` `?tab=thresholds` something to be true of: an order
 * above the house's ceiling can no longer be sealed by a role below the rule.
 * The gateway is the gate — it refuses independently and these tests do not
 * replace the ones that prove it (`order-approval-gate.spec.ts`, 21 cases).
 *
 * What this file owns is the half the founder actually sees, and each case is a
 * way the page could lie about it:
 *
 *  1. a row the caller MAY NOT seal shows the ceremony DISABLED with the rule,
 *     the number and who may sign — never hidden. A control that disappears
 *     teaches nothing; the person learns to split the order in two.
 *  2. a row the caller MAY seal is untouched — the gate must not creep.
 *  3. a gate that has NOT ANSWERED leaves the ceremony armed. An unread gate is
 *     not a permissive one, and the page must not invent a verdict.
 *  4. a gate that FAILED says so in words rather than silently arming or
 *     silently disabling.
 *  5. a 403 from the seal prints the gateway's sentence VERBATIM, not wrapped in
 *     "The gateway refused (…)" — the sentence was written to be read.
 *  6. untestable rules are stated, because "we could not tell" is a different
 *     outcome from "it did not fire".
 *
 * None of these would pass against the row as it stood before this pass.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const approveMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));

/**
 * The mint. The row asks for a one-time seal when the GESTURE BEGINS (founder,
 * 2026-09-04), so the ceremony is now asynchronous and every case below has to
 * wait for it — which is itself the assertion that the approval no longer
 * happens without one.
 */
const mintMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string | null> => 'seal-token'),
);

vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: mintMock,
}));

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => approveMock,
  useMarkOrderDelivered: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

import { LedgerRow } from './LedgerRow';
import type { ApprovalGateRow, OrderRowVM } from './useOrdersNextData';

function row(over: Partial<OrderRowVM> = {}): OrderRowVM {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00001',
    wineName: 'Barolo Riserva',
    producer: 'Giacomo Conterno',
    providerName: 'Anadolu',
    quantity: 5,
    unitPrice: 400,
    computedTotal: 2000,
    listedTotal: 2000,
    total: 2000,
    stage: 'pending',
    status: 'pending',
    recurring: false,
    recurrenceLabel: null,
    requestedAt: '2026-09-01T10:00:00Z',
    approvedAt: null,
    deliveredAt: null,
    notes: null,
    ...over,
  };
}

function verdict(over: Partial<ApprovalGateRow> = {}): ApprovalGateRow {
  return {
    orderId: 'o-1',
    requiredRole: 'owner',
    firedBy: ['manager_ceiling'],
    reasons: ['over the 1000 ceiling this house set for a manager'],
    untestable: [],
    mayApprove: false,
    sentence:
      'This order is over the 1000 ceiling this house set for a manager, so it waits for an owner to seal it. ' +
      'You are signed in as manager at this house, so nothing was approved and the order stays open for an owner.',
    ...over,
  };
}

function mount(props: Partial<React.ComponentProps<typeof LedgerRow>> = {}) {
  return render(
    <LedgerRow
      row={row()}
      expanded={false}
      onToggle={() => {}}
      selected={false}
      onSelectChange={() => {}}
      bulkRunning={false}
      {...props}
    />,
  );
}

const die = () => screen.getByRole('button', { name: /hold to approve/i });

/**
 * Complete the ceremony the way a keyboard does: Enter arms it, Enter commits.
 *
 * Not a click. `HoldToApprove` is a hold, and a click fires nothing at all — a
 * test that clicked it would pass whatever the row did, which is the kind of
 * test that proves nothing (`HoldToApprove.tsx:154-161`, `stepConfirm`).
 */
function seal() {
  fireEvent.keyDown(die(), { key: 'Enter' });
  fireEvent.keyDown(die(), { key: 'Enter' });
}

beforeEach(() => {
  approveMock.mutate.mockReset();
  approveMock.isPending = false;
  mintMock.mockReset();
  mintMock.mockResolvedValue('seal-token');
});

describe('a row the caller may not seal', () => {
  it('disables the ceremony and prints the rule, the number and who may sign', () => {
    mount({ approval: verdict() });

    expect(die()).toBeDisabled();
    expect(
      screen.getByText(/over the 1000 ceiling this house set for a manager/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/waits for an owner to seal it/i)).toBeInTheDocument();
  });

  it('is DISABLED, never hidden — the control stays on the page', () => {
    mount({ approval: verdict() });
    // The ceremony is still rendered. A control that disappears teaches nothing.
    expect(die()).toBeInTheDocument();
  });

  it('labels the column with who it is waiting on', () => {
    mount({ approval: verdict({ requiredRole: 'owner' }) });
    expect(screen.getByText(/waiting on an owner/i)).toBeInTheDocument();
  });

  it('states rules that could not be tested, separately from rules that did not fire', () => {
    mount({
      approval: verdict({ untestable: ['new_vendor'] }),
    });
    expect(screen.getByText(/could not be tested on this order/i)).toBeInTheDocument();
    expect(screen.getByText(/An\s+unknown is not a finding/i)).toBeInTheDocument();
  });
});

describe('a row the caller may seal', () => {
  it('leaves the ceremony armed and says nothing about rules', () => {
    mount({ approval: verdict({ mayApprove: true, sentence: null, requiredRole: null, firedBy: [], reasons: [] }) });

    expect(die()).not.toBeDisabled();
    expect(screen.queryByText(/ceiling/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Approve · Anadolu/i)).toBeInTheDocument();
  });
});

describe('a gate that has not answered', () => {
  it('leaves the ceremony ARMED — an unread gate is not a permissive one', () => {
    // The decisive case. If an absent verdict disabled the ceremony, every
    // order would be unsealable the moment the gate endpoint hiccuped; if it
    // silently claimed permission, the page would be inventing a verdict. It
    // does neither: it renders as it did before ADR 0116 and lets the gateway
    // answer.
    mount({ approval: undefined });
    expect(die()).not.toBeDisabled();
    expect(screen.queryByText(/waiting on/i)).not.toBeInTheDocument();
  });

  it('a FAILED gate says so in words', () => {
    mount({ approval: undefined, approvalGateError: 'relation missing' });
    expect(
      screen.getByText(/approval rules could not be read \(relation missing\)/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/The gateway still decides/i)).toBeInTheDocument();
    // And it still does not pretend to be the gate.
    expect(die()).not.toBeDisabled();
  });
});

describe('the refusal that comes back from the seal', () => {
  it('prints a 403 body VERBATIM, without the generic wrapper', async () => {
    const sentence =
      'This order is the first order this house has placed with this vendor, so it waits for an owner to seal it.';
    approveMock.mutate.mockImplementation(
      (_input: unknown, opts: { onError: (e: unknown) => void }) => {
        opts.onError(Object.assign(new Error(sentence), { response: { status: 403 } }));
      },
    );

    mount({ approval: verdict({ mayApprove: true, sentence: null }) });
    seal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent(/The gateway refused/i);
  });

  it('keeps the generic wrapper for a NON-403 — a dropped connection explains nothing', async () => {
    approveMock.mutate.mockImplementation(
      (_input: unknown, opts: { onError: (e: unknown) => void }) => {
        opts.onError(Object.assign(new Error('Network Error'), { response: { status: 500 } }));
      },
    );

    mount({ approval: verdict({ mayApprove: true, sentence: null }) });
    seal();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /The gateway refused \(Network Error\) — still pending, nothing approved\./i,
    );
  });
});


/**
 * The seal on an order is REDEEMED, not asserted (founder, 2026-09-04; ADR 0116
 * addendum). None of these pass against the row as it stood this morning: it
 * called `approve.mutate(row.id)` with nothing else, and the gateway believed
 * it because the claim and the act were the same request.
 */
describe('the seal the row carries', () => {
  it('mints the seal when the gesture BEGINS, not when it completes', async () => {
    mount({ approval: verdict({ mayApprove: true, sentence: null }) });

    // One Enter arms the ceremony — the gesture has begun and nothing is
    // approved yet. The mint must already have been asked for by now: a token
    // fetched at the moment of approval is the assertion model with extra steps.
    fireEvent.keyDown(die(), { key: 'Enter' });
    await waitFor(() => expect(mintMock).toHaveBeenCalledWith('o-1'));
    expect(approveMock.mutate).not.toHaveBeenCalled();
  });

  it('carries the minted token into the approval', async () => {
    mount({ approval: verdict({ mayApprove: true, sentence: null }) });
    seal();

    await waitFor(() =>
      expect(approveMock.mutate).toHaveBeenCalledWith(
        { orderId: 'o-1', challenge: 'seal-token' },
        expect.anything(),
      ),
    );
  });

  it('approves NOTHING when the seal cannot be issued, and says so', async () => {
    mintMock.mockResolvedValue(null);
    mount({ approval: verdict({ mayApprove: true, sentence: null }) });
    seal();

    expect(
      await screen.findByText(/The seal could not be issued — nothing sent\./i),
    ).toBeInTheDocument();
    // The one failure this whole mechanism exists to prevent, arriving through
    // the UI instead of the API.
    expect(approveMock.mutate).not.toHaveBeenCalled();
  });

  it('approves NOTHING when the mint THROWS', async () => {
    mintMock.mockRejectedValue(new Error('403'));
    mount({ approval: verdict({ mayApprove: true, sentence: null }) });
    seal();

    expect(
      await screen.findByText(/The seal could not be issued — nothing sent\./i),
    ).toBeInTheDocument();
    expect(approveMock.mutate).not.toHaveBeenCalled();
  });

  it('mints ONCE per gesture, however many times the key is pressed', async () => {
    mount({ approval: verdict({ mayApprove: true, sentence: null }) });
    fireEvent.keyDown(die(), { key: 'Enter' });
    fireEvent.keyDown(die(), { key: 'Enter' });
    await waitFor(() => expect(approveMock.mutate).toHaveBeenCalled());
    expect(mintMock).toHaveBeenCalledTimes(1);
  });
});
