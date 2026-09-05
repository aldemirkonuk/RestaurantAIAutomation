/**
 * The seal on the act that was never sealed at all.
 *
 * ADR 0125. Until 2026-09-05 the legacy desk's Reject — the only one production
 * shows — was `confirm('Are you sure?')` then `apiClient.delete(...)` with no
 * reason argument, so the one column recording why a house did not buy a wine
 * was left null by every rejection it made. `SealedRejectDie` is the one
 * implementation the three call sites now share.
 *
 * Every case here is a way the control could lie about a rejection:
 *
 *  1. minting at the moment of the write instead of at the start of the gesture
 *     (the assertion model with extra steps);
 *  2. cancelling anyway when the mint failed;
 *  3. cancelling with no reason, or with whitespace standing in for one;
 *  4. burying the gateway's 400/403/422 sentence in a generic wrapper — the
 *     422 is where "the wine is already on the shelf" lives, and it is the one
 *     sentence a person most needs to read;
 *  5. reporting a rejection the gateway refused.
 *
 * None of these can pass against the pre-fix tree, which had no such control.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

type CancelInput = { orderId: string; reason?: string; challenge?: string | null };
const cancelMock = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn<(input: CancelInput) => Promise<unknown>>(async () => ({})),
  isPending: false,
}));

type Mint = (orderId: string) => Promise<string | null>;
const mintMock = vi.hoisted(() => vi.fn<Mint>(async () => 'cancel-seal-token'));

vi.mock('@/services/api/orders', () => ({
  mintOrderCancelSeal: (id: string) => mintMock(id),
}));

vi.mock('@/hooks/queries/useOrderQueries', () => ({
  useCancelOrder: () => cancelMock,
}));

import { SealedRejectDie } from '../SealedRejectDie';

const die = () => screen.getByRole('button', { name: /hold to reject/i });
const box = () => screen.getByTestId('legacy-reject-reason');

/** Enter arms, Enter commits — a click on a hold fires nothing at all. */
function hold() {
  fireEvent.keyDown(die(), { key: 'Enter' });
  fireEvent.keyDown(die(), { key: 'Enter' });
}

function say(reason: string) {
  fireEvent.change(box(), { target: { value: reason } });
}

beforeEach(() => {
  cancelMock.mutate.mockReset();
  cancelMock.mutateAsync.mockReset();
  cancelMock.mutateAsync.mockResolvedValue({});
  mintMock.mockReset();
  mintMock.mockResolvedValue('cancel-seal-token');
});

describe('a reason comes first', () => {
  it('holds the die disabled until one is typed', () => {
    render(<SealedRejectDie orderId="ord-1" />);
    expect(die()).toBeDisabled();
    say('The vintage is wrong on every line.');
    expect(die()).not.toBeDisabled();
  });

  it('treats whitespace as no reason at all', () => {
    render(<SealedRejectDie orderId="ord-1" />);
    say('    ');
    expect(die()).toBeDisabled();
  });

  it('says what is missing, rather than only refusing', () => {
    render(<SealedRejectDie orderId="ord-1" />);
    fireEvent.blur(box());
    expect(screen.getByTestId('legacy-reject-needs-reason')).toHaveTextContent(
      /only account anyone will have/i,
    );
  });
});

describe('the seal is minted when the gesture begins', () => {
  it('mints for this order and carries the token onto the write', async () => {
    render(<SealedRejectDie orderId="ord-1" />);
    say('Price is 18% over what we last paid.');
    hold();
    await waitFor(() => expect(cancelMock.mutateAsync).toHaveBeenCalled());
    expect(mintMock).toHaveBeenCalledWith('ord-1');
    expect(cancelMock.mutateAsync).toHaveBeenCalledWith({
      orderId: 'ord-1',
      reason: 'Price is 18% over what we last paid.',
      challenge: 'cancel-seal-token',
    });
  });

  it('trims the reason it sends, so a stray newline is not the account', async () => {
    render(<SealedRejectDie orderId="ord-1" />);
    say('  Corked across the lot.\n');
    hold();
    await waitFor(() => expect(cancelMock.mutateAsync).toHaveBeenCalled());
    expect(cancelMock.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Corked across the lot.' }),
    );
  });

  it('cancels nothing when the mint returns nothing', async () => {
    mintMock.mockResolvedValue(null);
    render(<SealedRejectDie orderId="ord-1" />);
    say('No longer needed.');
    hold();
    await waitFor(() => expect(mintMock).toHaveBeenCalled());
    expect(cancelMock.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId('legacy-reject-refusal')).toHaveTextContent(
      /nothing was cancelled/i,
    );
  });

  it('prints the gateway’s own refusal when the mint is refused', async () => {
    // 422 at the MINT is where "the wine is already on the shelf" arrives —
    // at the start of the hold, not after a second and a half of ceremony.
    mintMock.mockRejectedValue(
      Object.assign(
        new Error(
          'This order is delivered, so it cannot be cancelled. The wine has been counted into stock.',
        ),
        { response: { status: 422 } },
      ),
    );
    render(<SealedRejectDie orderId="ord-1" />);
    say('Changed our mind.');
    hold();
    await waitFor(() =>
      expect(screen.getByTestId('legacy-reject-refusal')).toHaveTextContent(
        /counted into stock/i,
      ),
    );
    // And the sentence is printed as itself, not wrapped.
    expect(screen.getByTestId('legacy-reject-refusal')).not.toHaveTextContent(
      /The seal could not be issued \(/,
    );
    expect(cancelMock.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('a refusal from the write is printed as itself', () => {
  it.each([400, 403, 422])('prints the gateway sentence on a %s', async (status) => {
    cancelMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('A cancellation has to say why.'), {
        response: { status },
      }),
    );
    render(<SealedRejectDie orderId="ord-1" />);
    say('Because.');
    hold();
    await waitFor(() =>
      expect(screen.getByTestId('legacy-reject-refusal')).toHaveTextContent(
        'A cancellation has to say why.',
      ),
    );
    expect(screen.getByTestId('legacy-reject-refusal')).not.toHaveTextContent(
      /The gateway refused \(/,
    );
  });

  it('keeps the generic framing for a failure that is not about this order', async () => {
    cancelMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('Network Error'), { response: { status: 502 } }),
    );
    render(<SealedRejectDie orderId="ord-1" />);
    say('Because.');
    hold();
    await waitFor(() =>
      expect(screen.getByTestId('legacy-reject-refusal')).toHaveTextContent(
        /nothing was rejected, and no reason was written/i,
      ),
    );
  });

  it('reports nothing rejected when the gateway refused', async () => {
    const onRejected = vi.fn();
    cancelMock.mutateAsync.mockRejectedValue(
      Object.assign(new Error('nope'), { response: { status: 403 } }),
    );
    render(<SealedRejectDie orderId="ord-1" onRejected={onRejected} />);
    say('Because.');
    hold();
    await waitFor(() => expect(cancelMock.mutateAsync).toHaveBeenCalled());
    expect(onRejected).not.toHaveBeenCalled();
  });

  it('reports the rejection only after the gateway made it', async () => {
    const onRejected = vi.fn();
    render(<SealedRejectDie orderId="ord-1" onRejected={onRejected} />);
    say('Because.');
    hold();
    await waitFor(() => expect(onRejected).toHaveBeenCalledWith('ord-1'));
  });
});
