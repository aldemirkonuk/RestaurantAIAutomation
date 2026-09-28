/**
 * HoldToApprove — the challenge half.
 *
 * The gesture itself (hold, early release, keyboard arm) is unchanged and is
 * not re-pinned here. What is new on 2026-09-04 is that a caller may ask for a
 * PROVABLE seal: the control mints a one-time token when the gesture BEGINS and
 * hands it to `onApprove`, and if the mint fails it does not approve at all.
 *
 * Both of those are failure-shaped. A token fetched at the moment of approval
 * would be the assertion model with extra steps; an approval that proceeds
 * without its token would be the same hole arriving through the UI instead of
 * the API. So each is a test.
 *
 * The keyboard path is used throughout: it is the two-step confirm, it needs no
 * rAF clock, and it exercises exactly the same `commit`.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HoldToApprove } from './HoldToApprove';

const press = () =>
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

describe('HoldToApprove without a challenge', () => {
  it('still approves, and passes null rather than inventing a token', async () => {
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);

    press(); // arm
    press(); // confirm

    await waitFor(() => expect(onApprove).toHaveBeenCalledTimes(1));
    expect(onApprove).toHaveBeenCalledWith(null);
  });
});

describe('HoldToApprove with a challenge', () => {
  it('mints the seal when the gesture BEGINS, not when it completes', async () => {
    const onChallenge = vi.fn(async () => 'tok-123');
    render(
      <HoldToApprove onApprove={vi.fn()} onChallenge={onChallenge} label="Approve" />,
    );

    press(); // arm — the gesture has begun
    await waitFor(() => expect(onChallenge).toHaveBeenCalledTimes(1));
  });

  it('hands the token to onApprove', async () => {
    const onApprove = vi.fn();
    render(
      <HoldToApprove
        onApprove={onApprove}
        onChallenge={async () => 'tok-123'}
        label="Approve"
      />,
    );

    press();
    press();

    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('tok-123'));
  });

  it('mints ONCE per gesture, however many times the key is pressed', async () => {
    const onChallenge = vi.fn(async () => 'tok-123');
    render(
      <HoldToApprove onApprove={vi.fn()} onChallenge={onChallenge} label="Approve" />,
    );

    press();
    press();

    await waitFor(() => expect(onChallenge).toHaveBeenCalledTimes(1));
  });

  it('does NOT approve when the seal cannot be issued, and says so', async () => {
    const onApprove = vi.fn();
    render(
      <HoldToApprove
        onApprove={onApprove}
        onChallenge={async () => null}
        label="Approve"
      />,
    );

    press();
    press();

    expect(
      await screen.findByText(/the seal could not be issued — nothing sent/i),
    ).toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('does not approve when the mint THROWS either', async () => {
    const onApprove = vi.fn();
    render(
      <HoldToApprove
        onApprove={onApprove}
        onChallenge={async () => {
          throw new Error('gateway refused');
        }}
        label="Approve"
      />,
    );

    press();
    press();

    expect(
      await screen.findByText(/the seal could not be issued/i),
    ).toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('lets the operator try again after a failed mint', async () => {
    const onApprove = vi.fn();
    let fail = true;
    render(
      <HoldToApprove
        onApprove={onApprove}
        onChallenge={async () => (fail ? null : 'tok-2')}
        label="Approve"
      />,
    );

    press();
    press();
    await screen.findByText(/the seal could not be issued/i);

    fail = false;
    press();
    press();
    await waitFor(() => expect(onApprove).toHaveBeenCalledWith('tok-2'));
  });
});
