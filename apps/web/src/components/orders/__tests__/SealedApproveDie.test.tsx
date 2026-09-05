/**
 * The seal on the two call sites that were NOT sealed on 2026-09-04.
 *
 * ADR 0116's addendum built challenge-and-redeem for `pages/orders/next`, and
 * left the legacy `pages/Orders.tsx` and `dashboard/next/WaitingOnYou.tsx`
 * calling approve with an id alone. The founder's decision that day was "give
 * both legacy call sites the hold gesture", and `SealedApproveDie` is the one
 * implementation both of them use.
 *
 * Every case here is a way the control could lie about a seal:
 *
 *  1. minting at the moment of approval instead of at the start of the gesture
 *     (the assertion model with extra steps);
 *  2. approving anyway when the mint failed — the one failure the whole
 *     mechanism exists to prevent, arriving through the UI instead of the API;
 *  3. approving the subset that happened to mint, which makes the count a lie
 *     about what the operator agreed to;
 *  4. sending ONE seal for N orders, which would mean "whatever this person
 *     selected" — precisely the open-ended approval a seal is bound against;
 *  5. burying the gateway's 403 sentence inside a generic wrapper;
 *  6. reporting an approval the gateway refused.
 *
 * None of these can pass against the pre-fix tree, which had no such control
 * at all: `WaitingOnYou` awaited `ordersApi.approveOrder(order.id)` and the
 * legacy bulk approve called no endpoint whatsoever.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

import { SealedApproveDie } from '../SealedApproveDie';

const die = () => screen.getByRole('button', { name: /hold to approve/i });

/**
 * Complete the ceremony the way a keyboard does: Enter arms, Enter commits.
 *
 * Not a click — `HoldToApprove` is a hold and a click fires nothing at all, so
 * a test that clicked would pass whatever the control did.
 */
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

describe('the mint happens when the gesture begins', () => {
  it('asks for the seal on the FIRST press, before anything is written', async () => {
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve · $2,000" />);

    fireEvent.keyDown(die(), { key: 'Enter' });
    await waitFor(() => expect(mintMock).toHaveBeenCalledWith('o-1'));
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('mints ONCE per gesture, however many times the key is pressed', async () => {
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();
    await waitFor(() => expect(approveMock.mutateAsync).toHaveBeenCalled());
    expect(mintMock).toHaveBeenCalledTimes(1);
  });

  it('carries the minted token into the approval', async () => {
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();

    await waitFor(() =>
      expect(approveMock.mutateAsync).toHaveBeenCalledWith({
        orderId: 'o-1',
        challenge: 'seal-token',
      }),
    );
  });
});

describe('one seal per order, even in bulk', () => {
  it('mints a separate seal for every selected order and spends each on its own', async () => {
    mintMock.mockImplementation(async (id: string) => `seal-${id}`);
    render(<SealedApproveDie orderIds={['o-1', 'o-2', 'o-3']} label="Hold to approve 3 orders" />);
    seal();

    await waitFor(() => expect(approveMock.mutateAsync).toHaveBeenCalledTimes(3));
    expect(mintMock.mock.calls.map(([id]) => id)).toEqual(['o-1', 'o-2', 'o-3']);
    expect(approveMock.mutateAsync.mock.calls.map(([a]) => a)).toEqual([
      { orderId: 'o-1', challenge: 'seal-o-1' },
      { orderId: 'o-2', challenge: 'seal-o-2' },
      { orderId: 'o-3', challenge: 'seal-o-3' },
    ]);
  });

  it('approves NOTHING when a single order in the batch fails to mint', async () => {
    mintMock.mockImplementation(async (id: string) => (id === 'o-2' ? null : `seal-${id}`));
    render(<SealedApproveDie orderIds={['o-1', 'o-2']} label="Hold to approve 2 orders" />);
    seal();

    expect(
      await screen.findByText(/The seal could not be issued — nothing sent\./i),
    ).toBeInTheDocument();
    // Not "o-1 approved, o-2 skipped": approving the subset that happened to
    // mint would make the count a lie about what was agreed to.
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('a mint that fails approves nothing, and says why', () => {
  it('says so when the mint resolves null', async () => {
    mintMock.mockResolvedValue(null);
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();

    expect(
      await screen.findByText(/The seal could not be issued — nothing sent\./i),
    ).toBeInTheDocument();
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('says so when the mint THROWS', async () => {
    mintMock.mockRejectedValue(new Error('403'));
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();

    expect(
      await screen.findByText(/The seal could not be issued — nothing sent\./i),
    ).toBeInTheDocument();
    expect(approveMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('sends nothing at all when there is no order to seal', async () => {
    render(<SealedApproveDie orderIds={[]} label="Hold to approve" />);
    expect(die()).toBeDisabled();
    expect(mintMock).not.toHaveBeenCalled();
  });
});

describe('the refusal that comes back', () => {
  it('prints a 403 body VERBATIM, without the generic wrapper', async () => {
    const sentence =
      'This order is over the 1000 ceiling this house set for a manager, so it waits for an owner to seal it.';
    approveMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error(sentence), { response: { status: 403 } }),
    );
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(sentence);
    expect(alert).not.toHaveTextContent(/The gateway refused/i);
  });

  it('keeps the generic wrapper for a NON-403 — a dropped connection explains nothing', async () => {
    approveMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('Network Error'), { response: { status: 500 } }),
    );
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /The gateway refused \(Network Error\) — nothing approved on that order\./i,
    );
  });

  it('reports the split honestly and hands back ONLY the ids the gateway approved', async () => {
    const sentence = 'This order needs an owner, so nothing was approved.';
    approveMock.mutateAsync.mockImplementation(async ({ orderId }: { orderId: string }) => {
      if (orderId === 'o-2') {
        throw Object.assign(new Error(sentence), { response: { status: 403 } });
      }
      return {};
    });
    const onApproved = vi.fn();
    render(
      <SealedApproveDie orderIds={['o-1', 'o-2']} label="Hold to approve" onApproved={onApproved} />,
    );
    seal();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/1 sealed, 1 refused and still pending\./i);
    expect(alert).toHaveTextContent(sentence);
    await waitFor(() => expect(onApproved).toHaveBeenCalledWith(['o-1']));
  });

  it('does not leave the die reading "Approved" over an order that is still pending', async () => {
    approveMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('refused'), { response: { status: 403 } }),
    );
    render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    seal();

    await screen.findByRole('alert');
    // The ceremony is returned to rest, armed, rather than sealed.
    expect(screen.getByRole('button', { name: /hold to approve/i })).toBeEnabled();
    expect(screen.queryByText(/^Approved$/)).not.toBeInTheDocument();
  });
});

describe('the ground it lands on', () => {
  it('scopes the house tokens to the control, so the legacy page reads in both themes', () => {
    // Measured in the running app: outside `.mudavym` the die keeps its light
    // fallbacks (#F3EFE6 / #211C16) even under `html.dark`, while the legacy
    // page itself goes Warm Charcoal via `globals.css` (`.dark .bg-white →
    // #1D1813`). Without this class the die was a cream slab on a dark page.
    const { container } = render(<SealedApproveDie orderIds={['o-1']} label="Hold to approve" />);
    expect(container.firstElementChild).toHaveClass('mudavym');
  });

  it('keeps the caller’s own class beside it', () => {
    const { container } = render(
      <SealedApproveDie orderIds={['o-1']} label="Hold to approve" className="min-w-[260px]" />,
    );
    expect(container.firstElementChild).toHaveClass('mudavym');
    expect(container.firstElementChild).toHaveClass('min-w-[260px]');
  });
});

describe('the report after a clean run', () => {
  it('says how many were sealed, and hands every id back', async () => {
    const onApproved = vi.fn();
    render(
      <SealedApproveDie orderIds={['o-1', 'o-2']} label="Hold to approve" onApproved={onApproved} />,
    );
    seal();

    expect(await screen.findByText(/2 orders sealed\./i)).toBeInTheDocument();
    expect(onApproved).toHaveBeenCalledWith(['o-1', 'o-2']);
  });
});
