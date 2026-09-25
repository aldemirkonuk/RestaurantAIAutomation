/**
 * OrderCeremony — the two order-hold shapes (ADR 0160 sec110 item 6,
 * corrected), and the two fixes this file pins down:
 *
 * 1. THE SENT STATE IS THE MUTATION'S, NEVER THE CLICK'S (2026-09-18). Before
 *    that fix, deleting the pending/error wiring (reverting to a local
 *    `useState<'idle'|'asking'|'done'>` that flips to `'done'` synchronously
 *    at a click) would leave every other cellar test green — none of them
 *    render this component in isolation. These tests fail on that regression
 *    specifically: they assert the control still reads a pending label WHILE
 *    `pending` is true, and only `approvedLabel` once `sent` turns true, and
 *    that an error drawn from `errorMessage` returns the control to a fresh,
 *    re-armable start rather than leaving it stuck mid-send.
 * 2. THE HOLD NEVER DROPS OUT (2026-09-19, cellar re-verification, two
 *    BLOCKING findings — see OrderCeremony.tsx's own header). A shipped
 *    `confirm` ceremony (click, then "are you sure?", no hold) and a shipped
 *    `auto` ceremony (one click, no hold, no question) both sent a real
 *    order with no physical hold gesture at all — the design ADR 0160 sec110
 *    item 6's correction explicitly rules out. Both are gone; `hold` and
 *    `auto` below both open with `HoldToApprove`, and these tests drive the
 *    actual gesture (Enter arms it, a second Enter completes it — the same
 *    deterministic path `HoldToApprove`'s own reduced-motion/keyboard mode
 *    uses, chosen here specifically because it needs no fake timers) to pin
 *    that neither ceremony has a way to send without it.
 */

import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OrderCeremony from './OrderCeremony';

function renderCeremony(over: Partial<ComponentProps<typeof OrderCeremony>> = {}) {
  const onApprove = vi.fn();
  const props: ComponentProps<typeof OrderCeremony> = {
    ceremony: 'auto',
    label: 'Order 6 from Acme',
    approvedLabel: 'Order sent',
    onApprove,
    pending: false,
    sent: false,
    errorMessage: null,
    ...over,
  };
  const utils = render(<OrderCeremony {...props} />);
  return { ...utils, onApprove, props };
}

/** A promise this test controls the settling of, for the async half of `hold`'s "Yes, order". */
function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Completes the physical hold via the deterministic keyboard path: arm, then approve. No fake timers needed. */
function completeHoldByKeyboard(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: 'Enter' });
}

describe('OrderCeremony — sent (either ceremony short-circuits on it)', () => {
  it('shows the disabled approved control when `sent` is true, before rendering `auto`', () => {
    renderCeremony({ ceremony: 'auto', sent: true });
    const btn = screen.getByTestId('order-ceremony-sent');
    expect(btn).toHaveTextContent('Order sent');
    expect(btn).toBeDisabled();
  });

  it('shows the disabled approved control when `sent` is true, before rendering `hold`', () => {
    renderCeremony({ ceremony: 'hold', sent: true });
    const btn = screen.getByTestId('order-ceremony-sent');
    expect(btn).toHaveTextContent('Order sent');
    expect(btn).toBeDisabled();
  });
});

describe('OrderCeremony — auto (hold, sends the instant it completes, no question after)', () => {
  it('renders the hold control, not a plain click button', () => {
    renderCeremony({ ceremony: 'auto', label: 'Hold to order' });
    expect(screen.getByRole('button', { name: /Hold to order/ })).toBeInTheDocument();
    expect(screen.queryByTestId('order-ceremony-asking')).not.toBeInTheDocument();
  });

  it('calls the real onApprove the moment the hold completes — no ask step in between', () => {
    const { onApprove } = renderCeremony({ ceremony: 'auto', label: 'Hold to order' });
    completeHoldByKeyboard(screen.getByRole('button', { name: /Hold to order/ }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('order-ceremony-asking')).not.toBeInTheDocument();
  });

  it('disables the control while pending — a second hold cannot fire before the first attempt answers', () => {
    renderCeremony({ ceremony: 'auto', label: 'Hold to order', pending: true });
    expect(screen.getByRole('button', { name: /Hold to order/ })).toBeDisabled();
  });

  it('is not disabled at rest, and re-enables once pending clears', () => {
    const { rerender, props } = renderCeremony({ ceremony: 'auto', label: 'Hold to order', pending: true });
    expect(screen.getByRole('button', { name: /Hold to order/ })).toBeDisabled();
    rerender(<OrderCeremony {...props} pending={false} />);
    expect(screen.getByRole('button', { name: /Hold to order/ })).not.toBeDisabled();
  });

  it('shows the failure reason beside the control', () => {
    renderCeremony({ ceremony: 'auto', label: 'Hold to order', errorMessage: 'the gateway refused it (500)' });
    expect(screen.getByTestId('order-ceremony-error')).toHaveTextContent('the gateway refused it (500)');
    expect(screen.getByRole('button', { name: /Hold to order/ })).toBeInTheDocument();
  });

  it('shows no error line when nothing has failed', () => {
    renderCeremony({ ceremony: 'auto', label: 'Hold to order' });
    expect(screen.queryByTestId('order-ceremony-error')).not.toBeInTheDocument();
  });

  it('remounts the control on a failed attempt, so a stale internal state can never survive into the retry', () => {
    const { rerender, props } = renderCeremony({ ceremony: 'auto', label: 'Hold to order' });
    const before = screen.getByRole('button', { name: /Hold to order/ });
    rerender(<OrderCeremony {...props} errorMessage="no reason given" />);
    const after = screen.getByRole('button', { name: /Hold to order/ });
    expect(after).not.toBe(before);
  });
});

describe('OrderCeremony — hold (DEFAULT: hold, then "are you sure?", before it sends)', () => {
  it('renders the hold control, and asks nothing until the hold completes', () => {
    const { onApprove } = renderCeremony({ ceremony: 'hold', label: 'Hold to order' });
    expect(screen.getByRole('button', { name: /Hold to order/ })).toBeInTheDocument();
    expect(screen.queryByTestId('order-ceremony-asking')).not.toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('completing the hold opens "Send it?" and does NOT call the real onApprove yet', () => {
    const { onApprove } = renderCeremony({ ceremony: 'hold', label: 'Hold to order' });
    completeHoldByKeyboard(screen.getByRole('button', { name: /Hold to order/ }));
    const asking = screen.getByTestId('order-ceremony-asking');
    expect(asking).toHaveTextContent('Send it?');
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('moves focus to "Yes, order" once the ask appears', () => {
    renderCeremony({ ceremony: 'hold', label: 'Hold to order' });
    completeHoldByKeyboard(screen.getByRole('button', { name: /Hold to order/ }));
    expect(screen.getByTestId('order-ceremony-confirm-yes')).toHaveFocus();
  });

  it('"Yes, order" calls the real onApprove exactly once', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <OrderCeremony
        ceremony="hold"
        label="Hold to order"
        approvedLabel="Order sent"
        onApprove={onApprove}
        pending={false}
        sent={false}
      />,
    );
    completeHoldByKeyboard(screen.getByRole('button', { name: /Hold to order/ }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('order-ceremony-confirm-yes'));
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('while the real write is in flight after "Yes", both ask buttons disable and read Sending…', async () => {
    const write = deferred();
    const onApprove = vi.fn(() => write.promise);
    render(
      <OrderCeremony
        ceremony="hold"
        label="Hold to order"
        approvedLabel="Order sent"
        onApprove={onApprove}
        pending={false}
        sent={false}
      />,
    );
    completeHoldByKeyboard(screen.getByRole('button', { name: /Hold to order/ }));
    fireEvent.click(screen.getByTestId('order-ceremony-confirm-yes'));

    const yes = screen.getByTestId('order-ceremony-confirm-yes');
    expect(yes).toHaveTextContent('Sending…');
    expect(yes).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await act(async () => {
      write.resolve();
      await write.promise;
    });
  });

  it('once the real write resolves, the control seals to approvedLabel and the ask row is gone', async () => {
    const write = deferred();
    const onApprove = vi.fn(() => write.promise);
    render(
      <OrderCeremony
        ceremony="hold"
        label="Hold to order"
        approvedLabel="Order sent"
        onApprove={onApprove}
        pending={false}
        sent={false}
      />,
    );
    completeHoldByKeyboard(screen.getByRole('button', { name: /Hold to order/ }));
    fireEvent.click(screen.getByTestId('order-ceremony-confirm-yes'));

    await act(async () => {
      write.resolve();
      await write.promise;
    });

    await waitFor(() => expect(screen.getByText('Order sent')).toBeInTheDocument());
    expect(screen.queryByTestId('order-ceremony-asking')).not.toBeInTheDocument();
  });

  it('Cancel never calls the real onApprove, and returns to a fresh, re-armable hold control', () => {
    const { onApprove } = renderCeremony({ ceremony: 'hold', label: 'Hold to order' });
    const before = screen.getByRole('button', { name: /Hold to order/ });
    completeHoldByKeyboard(before);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('order-ceremony-asking')).not.toBeInTheDocument();
    const after = screen.getByRole('button', { name: /Hold to order/ });
    expect(after).not.toBe(before); // remounted — a fresh instance, not the same one un-committed
    expect(after).not.toBeDisabled();
  });

  it('a failed write drops back to a fresh hold control with the reason shown, never stuck on the ask', async () => {
    const write = deferred();
    const onApprove = vi.fn(() => write.promise);
    const { rerender } = render(
      <OrderCeremony
        ceremony="hold"
        label="Hold to order"
        approvedLabel="Order sent"
        onApprove={onApprove}
        pending={false}
        sent={false}
      />,
    );
    const before = screen.getByRole('button', { name: /Hold to order/ });
    completeHoldByKeyboard(before);
    fireEvent.click(screen.getByTestId('order-ceremony-confirm-yes'));

    await act(async () => {
      write.reject(new Error('rejected'));
      await write.promise.catch(() => undefined);
    });

    // The reject settles synchronously with the errorMessage prop below in
    // real use (the caller's mutation hook flips `isError` from the same
    // rejection) — pinned here by re-rendering with it, same as `auto`'s own
    // failure test above.
    rerender(
      <OrderCeremony
        ceremony="hold"
        label="Hold to order"
        approvedLabel="Order sent"
        onApprove={onApprove}
        pending={false}
        sent={false}
        errorMessage="the gateway refused it (500)"
      />,
    );

    expect(screen.queryByTestId('order-ceremony-asking')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-ceremony-error')).toHaveTextContent('the gateway refused it (500)');
    const after = screen.getByRole('button', { name: /Hold to order/ });
    expect(after).not.toBe(before);
    expect(after).not.toBeDisabled();
  });

  it('shows no error line when nothing has failed', () => {
    renderCeremony({ ceremony: 'hold', label: 'Hold to order' });
    expect(screen.queryByTestId('order-ceremony-error')).not.toBeInTheDocument();
  });
});
