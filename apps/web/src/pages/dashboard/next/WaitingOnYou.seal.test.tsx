/**
 * The dashboard's "Waiting on you" card, sealed.
 *
 * This card was one of the two approval call sites ADR 0116's addendum left
 * unsealed: it awaited `ordersApi.approveOrder(order.id)` with an id alone, so
 * from the moment the gateway began demanding a seal every approval from the
 * dashboard would have been refused — and the card would have said "the
 * approval didn't reach the server", a claim about the network that a refusal
 * makes false. The founder's decision of 2026-09-04 was to give it the hold
 * gesture rather than a one-click mint-and-approve.
 *
 * Each case below fails against the pre-fix file:
 *
 *  1. it mints before it writes — the pre-fix card never minted at all;
 *  2. a mint that fails approves nothing and says so — the pre-fix card had no
 *     mint to fail;
 *  3. the gateway's 403 sentence is printed as itself — the pre-fix card
 *     replaced every failure with one sentence about the network;
 *  4. the row leaves the queue only for an order the gateway actually
 *     approved.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type ApproveInput = { orderId: string; challenge: string | null };
const approveMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn<(input: ApproveInput) => Promise<unknown>>(async () => ({})),
  isPending: false,
}));
type Mint = (orderId: string) => Promise<string | null>;
const mintMock = vi.hoisted(() => vi.fn<Mint>(async () => 'seal-token'));

vi.mock('@/services/api/orders', () => ({
  mintOrderSeal: (id: string) => mintMock(id),
}));
vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useApproveOrder: () => approveMock,
}));

import { WaitingOnYou } from './WaitingOnYou';
import type { Order } from '@/services/api/types';

/**
 * One row of `GET /procurement/orders/pending` as `OrderResponseDto` actually
 * serialises it (`mapOrderRow`, procurement.service.ts). This fixture used to
 * carry `unitPrice`, `totalPrice`, `wineId`, `createdAt`, `updatedAt` and
 * `providerName` — six names the route has never sent — and a lowercase status
 * the gateway does not speak. Every test below passed on it while the live
 * card read `undefined` for both money figures and printed "$0" in the money
 * column and on the seal itself.
 */
function order(over: Partial<Order> = {}): Order {
  return {
    id: 'o-1',
    orderNumber: 'ORD-2026-00042',
    restaurantId: 'r-1',
    inventoryId: 'i-1',
    providerId: 'p-1',
    quantity: 5,
    unitType: 'case',
    bottlesTotal: 60,
    finalPrice: 400,
    totalCost: 2000,
    status: 'APPROVAL_NEEDED',
    requestedAt: '2026-09-01T10:00:00Z',
    wineName: 'Barolo Riserva',
    ...over,
  } as Order;
}

function mount(pending: Order[] | null | undefined, onChanged = vi.fn()) {
  return render(
    <MemoryRouter>
      <WaitingOnYou pending={pending} onChanged={onChanged} />
    </MemoryRouter>,
  );
}

/** Open the row so the ceremony is in the tree. */
function openRow(name = /Barolo Riserva/i) {
  fireEvent.click(screen.getByRole('button', { name }));
}

/**
 * The first row's die.
 *
 * Every row keeps its ceremony in the tree (the expand is a grid-rows
 * animation, not a mount), so a `getByRole` would find one per pending order.
 */
const die = () => screen.getAllByRole('button', { name: /hold to approve/i })[0];

function seal() {
  fireEvent.keyDown(die(), { key: 'Enter' });
  fireEvent.keyDown(die(), { key: 'Enter' });
}

beforeEach(() => {
  approveMock.mutateAsync.mockReset();
  approveMock.mutateAsync.mockResolvedValue({});
  mintMock.mockReset();
  mintMock.mockResolvedValue('seal-token');
});

describe('the seal the dashboard carries', () => {
  it('mints when the gesture BEGINS, not when it completes', async () => {
    mount([order()]);
    openRow();

    fireEvent.keyDown(die(), { key: 'Enter' });
    await waitFor(() => expect(mintMock).toHaveBeenCalledWith('o-1'));
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('carries the minted token into the approval', async () => {
    mount([order()]);
    openRow();
    seal();

    await waitFor(() =>
      expect(approveMock.mutateAsync).toHaveBeenCalledWith({
        orderId: 'o-1',
        challenge: 'seal-token',
      }),
    );
  });

  it('approves NOTHING when the seal cannot be issued, and says so', async () => {
    mintMock.mockResolvedValue(null);
    mount([order()]);
    openRow();
    seal();

    expect(
      await screen.findByText(/The seal could not be issued — nothing sent\./i),
    ).toBeInTheDocument();
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('what the card says when the gateway refuses', () => {
  it('prints the 403 sentence as itself, not as a claim about the network', async () => {
    const sentence =
      'This order is over the 1000 ceiling this house set for a manager, so it waits for an owner to seal it.';
    approveMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error(sentence), { response: { status: 403 } }),
    );
    mount([order()]);
    openRow();
    seal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent(/didn’t reach the server/i);
  });

  it('keeps the generic line ONLY for a real network failure', async () => {
    // The pre-fix card gave this sentence to every failure, including a clean
    // 403. It is the right sentence for exactly one case: a request that did
    // not come back with a decision in it.
    approveMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('Network Error'), { response: { status: 500 } }),
    );
    mount([order()]);
    openRow();
    seal();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /The gateway refused \(Network Error\) — nothing approved on that order\./i,
    );
  });

  it('leaves the refused order in the queue', async () => {
    approveMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('refused'), { response: { status: 403 } }),
    );
    const onChanged = vi.fn();
    mount([order()], onChanged);
    openRow();
    seal();

    await screen.findByRole('alert');
    expect(screen.getByText(/Barolo Riserva/i)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('an order the gateway did approve', () => {
  it('leaves the queue, and the count follows it', async () => {
    vi.useFakeTimers();
    try {
      const onChanged = vi.fn();
      mount([order(), order({ id: 'o-2', wineName: 'Chablis' })], onChanged);
      openRow();
      seal();

      await vi.waitFor(() => expect(approveMock.mutateAsync).toHaveBeenCalled());
      await vi.waitFor(() =>
        expect(screen.queryByText(/Barolo Riserva/i)).not.toBeInTheDocument(),
      );
      expect(screen.getByText(/Chablis/i)).toBeInTheDocument();
      // The refetch waits for the seal to land rather than racing it.
      expect(onChanged).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(onChanged).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the states that are not an approval', () => {
  it('prints the route\'s own total on the row and on the seal, never $0', () => {
    // The defect: `formatMoney(undefined)` is the string "$0", so a card reading
    // a key the route does not send showed a real order as costing nothing —
    // on the control a human holds to spend the money. Measured 2026-09-05.
    mount([order()]);
    expect(screen.getByText('$2,000')).toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    openRow();
    expect(screen.getByRole('button', { name: /Hold to approve · \$2,000/i })).toBeInTheDocument();
  });

  it('says nothing about money the route did not carry', () => {
    // An absent total is an em dash and a bare "Hold to approve" — not a zero,
    // and not a dash on the die, where it reads as a rendering fault.
    mount([order({ totalCost: undefined, finalPrice: undefined })]);
    expect(screen.getByText('—')).toBeInTheDocument();
    openRow();
    expect(screen.getByRole('button', { name: /^Hold to approve$/i })).toBeInTheDocument();
  });

  it('says the queue could not be reached rather than drawing an empty desk', () => {
    mount(null);
    expect(screen.getByText(/couldn’t be reached/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been approved or lost/i)).toBeInTheDocument();
  });

  it('tells "measured, none" apart from "not asked yet"', () => {
    mount([]);
    expect(screen.getByText(/Nothing is waiting on you\./i)).toBeInTheDocument();
  });
});
