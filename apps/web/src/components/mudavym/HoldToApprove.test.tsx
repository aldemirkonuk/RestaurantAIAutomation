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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { HoldToApprove } from './HoldToApprove';

const press = () =>
  fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

function setReducedMotion(reduce: boolean) {
  (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

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

/* ── the arm window — ADR 0134 rule 5, locked 2026-09-21 ("Until Esc or click
   away") ────────────────────────────────────────────────────────────────── */
describe('the two-step confirm stays armed until the reader disarms it', () => {
  afterEach(() => {
    vi.useRealTimers();
    setReducedMotion(false);
  });

  // The armed label ("Enter again to approve") and the status hint below it
  // ("Press Enter again to approve — Esc or clicking elsewhere cancels.")
  // both contain this phrase, so every assertion below matches the label's
  // own exact text — never a substring regex — to stay unambiguous.
  const ARMED_LABEL = 'Enter again to approve';

  it('is still armed well past the old 3s window, with no input at all', () => {
    vi.useFakeTimers();
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);

    press(); // arm
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000); // 3.3x the removed ARM_WINDOW_MS
    });

    // Still armed, not idle: the SAME control confirms rather than re-arming.
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();
    press(); // confirm
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('disarms on Escape', () => {
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);
    const control = screen.getByRole('button');

    press(); // arm
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();

    fireEvent.keyDown(control, { key: 'Escape' });
    expect(screen.queryByText(ARMED_LABEL)).toBeNull();

    press(); // this is a fresh arm, not a confirm
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('disarms on a pointerdown outside the control', () => {
    const onApprove = vi.fn();
    render(
      <div>
        <HoldToApprove onApprove={onApprove} label="Approve" />
        <button type="button">elsewhere</button>
      </div>,
    );
    const control = screen.getByRole('button', { name: 'Approve' });

    fireEvent.keyDown(control, { key: 'Enter' }); // arm
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByText(ARMED_LABEL)).toBeNull();

    fireEvent.keyDown(control, { key: 'Enter' }); // this is a fresh arm, not a confirm
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('disarms on Escape pressed while focus is somewhere else', () => {
    const onApprove = vi.fn();
    render(
      <div>
        <HoldToApprove onApprove={onApprove} label="Approve" />
        <input aria-label="elsewhere" />
      </div>,
    );
    const control = screen.getByRole('button', { name: 'Approve' });

    fireEvent.keyDown(control, { key: 'Enter' }); // arm
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();

    // The key lands on another element, never on the control's own onKeyDown.
    fireEvent.keyDown(screen.getByLabelText('elsewhere'), { key: 'Escape' });
    expect(screen.queryByText(ARMED_LABEL)).toBeNull();

    fireEvent.keyDown(control, { key: 'Enter' }); // this is a fresh arm, not a confirm
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('disarms on a pointerdown outside even when that element stops propagation', () => {
    const onApprove = vi.fn();
    render(
      <div>
        <HoldToApprove onApprove={onApprove} label="Approve" />
        <button type="button" onPointerDown={(e) => e.stopPropagation()}>
          elsewhere
        </button>
      </div>,
    );
    const control = screen.getByRole('button', { name: 'Approve' });

    fireEvent.keyDown(control, { key: 'Enter' }); // arm
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByText(ARMED_LABEL)).toBeNull();
  });

  it('does NOT disarm on a pointerdown on the control itself — the reduced-motion tap that confirms it', () => {
    setReducedMotion(true);
    const onApprove = vi.fn();
    render(<HoldToApprove onApprove={onApprove} label="Approve" />);
    const control = screen.getByRole('button');

    fireEvent.pointerDown(control); // arm (reduced-motion path)
    expect(screen.getByText(ARMED_LABEL)).toBeInTheDocument();

    fireEvent.pointerDown(control); // confirm — must not be read as "clicked away"
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});
