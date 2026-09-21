/**
 * Weight — sketch 103 · 1d, accepted by the founder 2026-09-06.
 *
 * Two halves: the paper gains weight as you edit, so a stray click cannot lift
 * it; and the seal reads back exactly what it bound.
 *
 * Against the pre-fix files (`git show HEAD:…`) every assertion here fails: a
 * scrim click called `onClose()` on all sixty surfaces with no dirty check
 * (finder B, D3), and `HoldToApprove` had no success line at all — the census
 * draws failure on four of sixty rows and success on none (D17).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { Panel } from './Sheet';
import { resetLabelWarnings, resetSheetWidth } from './overlayState';
import { HoldToApprove } from './HoldToApprove';

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

/** The click outside. Hidden from assistive technology (the Close control is
    the named way out), so it is found by structure. */
const scrim = () => document.querySelector('.mdv-ovl__scrim') as HTMLElement;

const HOLDING =
  'This asks for the amount to release. Sealing moves the money; leaving writes nothing.';

beforeEach(() => {
  setReducedMotion(false);
  resetLabelWarnings();
  resetSheetWidth();
  document.body.style.overflow = '';
});
afterEach(() => vi.useRealTimers());

describe('a dirty panel leans instead of lifting', () => {
  function mount(onClose = vi.fn(), onTear = vi.fn()) {
    render(
      <div className="mudavym">
        <Panel open onClose={onClose} onTear={onTear} dirty label={HOLDING} title="Release the payment">
          <button type="button">body</button>
        </Panel>
      </div>,
    );
    return { onClose, onTear };
  }

  it('refuses a scrim click and says what it is holding', () => {
    const { onClose } = mount();
    fireEvent.click(scrim());
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'This panel is holding unsaved edits. Click Close to leave; nothing will be written.',
      ),
    ).toBeInTheDocument();
  });

  it('speaks the lean in a live region, not only in the movement', () => {
    mount();
    fireEvent.click(scrim());
    const said = screen.getByRole('status');
    expect(said).toHaveAttribute('aria-live', 'polite');
    expect(said).toHaveTextContent(/holding unsaved edits/);
  });

  it('leaves on Escape said twice, and names that as the way out', () => {
    const { onClose, onTear } = mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'This panel is holding unsaved edits. Press Escape again to leave; nothing will be written.',
      ),
    ).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onTear).toHaveBeenCalledWith('esc');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disarms after six seconds — an Escape minutes later is not a confirmation', () => {
    vi.useFakeTimers();
    const { onClose } = mount();
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the Close control still leaves at once — the weight is never a trap', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves a clean panel exactly as it was', () => {
    const onClose = vi.fn();
    render(
      <div className="mudavym">
        <Panel open onClose={onClose} label={HOLDING} title="Release the payment">
          <button type="button">body</button>
        </Panel>
      </div>,
    );
    fireEvent.click(scrim());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.mdv-ovl__weight')).toBeNull();
  });
});

describe('the seal reads back what it bound', () => {
  it('shows nothing until the wax lands, then the heading and the caller words', () => {
    const onApprove = vi.fn();
    const onSealed = vi.fn();
    render(
      <div className="mudavym">
        <HoldToApprove
          onApprove={onApprove}
          onSealed={onSealed}
          boundSummary="₺4,280 to Selim Şarap, summed from 3 delivery rows"
          label="Hold to release"
        />
      </div>,
    );
    expect(screen.queryByText('What the seal bound')).toBeNull();

    // Reduced motion is off, so the keyboard's two-step is the deterministic
    // path to a completed seal in jsdom (no rAF clock).
    const control = screen.getByRole('button', { name: 'Hold to release' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(screen.getByText('What the seal bound')).toBeInTheDocument();
    expect(screen.getByText(/₺4,280 to Selim Şarap/)).toBeInTheDocument();
    expect(onSealed).toHaveBeenCalledTimes(1);
    expect(onSealed.mock.calls[0][0]).toEqual({
      summary: '₺4,280 to Selim Şarap, summed from 3 delivery rows',
      challenge: null,
    });
  });

  it('waits for an asynchronous write before issuing its receipt', async () => {
    let confirm!: () => void;
    const write = new Promise<void>((resolve) => { confirm = resolve; });
    const onApprove = vi.fn(() => write);
    const onSealed = vi.fn();
    render(<HoldToApprove onApprove={onApprove} onSealed={onSealed} boundSummary="Order 118" />);
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    // Inert, and said so — but not `disabled`, which drops focus to <body> and
    // out of an overlay's trap mid-confirmation. The third Enter below is what
    // proves the inertness.
    expect(control).toHaveAttribute('aria-disabled', 'true');
    expect(control).toHaveAttribute('aria-busy', 'true');
    expect(control).not.toHaveAttribute('disabled');
    expect(screen.queryByText('What the seal bound')).toBeNull();
    expect(onSealed).not.toHaveBeenCalled();
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(onApprove).toHaveBeenCalledTimes(1);
    await act(async () => { confirm(); await write; });
    expect(screen.getByText('What the seal bound')).toBeInTheDocument();
    expect(onSealed).toHaveBeenCalledWith({ summary: 'Order 118', challenge: null });
  });

  it('does not claim success or nothing sent when a write rejects after minting', async () => {
    const onSealed = vi.fn();
    render(<HoldToApprove onApprove={async () => { throw new Error('connection lost'); }}
      onChallenge={async () => 'tok_118'} onSealed={onSealed} boundSummary="Order 118" />);
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText('What the seal bound')).toBeNull();
    expect(onSealed).not.toHaveBeenCalled();
    expect(screen.getByText(/Approval could not be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing sent/)).toBeNull();
    expect(control).not.toBeDisabled();
  });

  it('does not stamp a synchronously refused write', () => {
    const onSealed = vi.fn();
    render(<HoldToApprove onApprove={() => { throw new Error('refused'); }}
      onSealed={onSealed} boundSummary="Order 118" />);
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(screen.queryByText('What the seal bound')).toBeNull();
    expect(onSealed).not.toHaveBeenCalled();
    expect(screen.getByText(/Approval could not be confirmed/)).toBeInTheDocument();
  });

  it('renders the end state under reduced motion, not a shorter one', () => {
    setReducedMotion(true);
    render(
      <div className="mudavym">
        <HoldToApprove onApprove={() => {}} boundSummary="6 bottles written off" label="Hold to write off" />
      </div>,
    );
    const control = screen.getByRole('button', { name: 'Hold to write off' });
    fireEvent.pointerDown(control, { pointerId: 1 });
    fireEvent.pointerDown(control, { pointerId: 1 });
    expect(screen.getByText('What the seal bound')).toBeInTheDocument();
    expect(screen.getByText('6 bottles written off')).toBeInTheDocument();
  });

  it('draws no heading over nothing when the caller described no write', () => {
    render(
      <div className="mudavym">
        <HoldToApprove onApprove={() => {}} label="Hold to approve" />
      </div>,
    );
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(screen.queryByText('What the seal bound')).toBeNull();
  });

  it('carries the challenge token into the receipt when one was minted', async () => {
    const onSealed = vi.fn();
    render(
      <div className="mudavym">
        <HoldToApprove
          onApprove={() => {}}
          onChallenge={async () => 'tok_118'}
          onSealed={onSealed}
          boundSummary="Order 118"
          label="Hold to approve"
        />
      </div>,
    );
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSealed).toHaveBeenCalledWith({ summary: 'Order 118', challenge: 'tok_118' });
  });
});

/* ── fixes from the lane A audit (2026-09-17) ───────────────────────────── */
describe('the hold after a failure, a stuck write, and its own words', () => {
  /* Judge probe J4: the failure line stayed and hid the armed hint. */
  it('replaces an old failure line with the armed hint on the next keyboard gesture', async () => {
    let calls = 0;
    render(
      <HoldToApprove
        onApprove={async () => {
          calls += 1;
          if (calls === 1) throw new Error('connection lost');
        }}
      />,
    );
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText(/Approval could not be confirmed/)).toBeInTheDocument();

    fireEvent.keyDown(control, { key: 'Enter' });
    expect(screen.queryByText(/Approval could not be confirmed/)).toBeNull();
    expect(
      screen.getByText('Press Enter again to approve — Esc or clicking elsewhere cancels.'),
    ).toBeInTheDocument();
  });

  it('stops waiting on a write that never settles, when asked to, and says the outcome is unconfirmed', () => {
    vi.useFakeTimers();
    const onSealed = vi.fn();
    render(
      <HoldToApprove
        onApprove={() => new Promise<void>(() => {})}
        onSealed={onSealed}
        confirmTimeoutMs={8000}
        boundSummary="Order 118"
      />,
    );
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(control).toHaveAttribute('aria-busy', 'true');
    act(() => {
      vi.advanceTimersByTime(7999);
    });
    expect(control).toHaveAttribute('aria-busy', 'true');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(control).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText(/Approval could not be confirmed/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing sent/)).toBeNull();
    expect(onSealed).not.toHaveBeenCalled();
  });

  it('still stamps a write that confirms after the wait ran out — a re-send would duplicate it', async () => {
    vi.useFakeTimers();
    let confirm!: () => void;
    const write = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    const onSealed = vi.fn();
    render(
      <HoldToApprove onApprove={() => write} onSealed={onSealed} confirmTimeoutMs={5000} boundSummary="Order 118" />,
    );
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/Approval could not be confirmed/)).toBeInTheDocument();
    await act(async () => {
      confirm();
      await write;
    });
    expect(onSealed).toHaveBeenCalledTimes(1);
    expect(screen.getByText('What the seal bound')).toBeInTheDocument();
    expect(screen.queryByText(/Approval could not be confirmed/)).toBeNull();
  });

  it('never lets a late answer to an older gesture stamp over a newer one', async () => {
    vi.useFakeTimers();
    let confirmFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      confirmFirst = resolve;
    });
    const onApprove = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve());
    const onSealed = vi.fn();
    render(<HoldToApprove onApprove={onApprove} onSealed={onSealed} confirmTimeoutMs={5000} />);
    const control = screen.getByRole('button', { name: 'Hold to approve' });
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    // The reader checked the record and tried again; this write confirms.
    fireEvent.keyDown(control, { key: 'Enter' });
    fireEvent.keyDown(control, { key: 'Enter' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onSealed).toHaveBeenCalledTimes(1);
    // The first write answers late. It must not produce a second receipt.
    await act(async () => {
      confirmFirst();
      await first;
    });
    expect(onApprove).toHaveBeenCalledTimes(2);
    expect(onSealed).toHaveBeenCalledTimes(1);
  });

  it('speaks in the caller’s words for a hold that is not an approval', async () => {
    render(
      <HoldToApprove
        label="Hold to send"
        onApprove={async () => {
          throw new Error('timeout');
        }}
        copy={{
          armed: 'Enter again to send',
          armedHint: 'Press Enter again to send — Esc cancels.',
          pending: 'Confirming the send…',
          unconfirmed: 'The letter could not be confirmed as sent. Check the thread before trying again.',
        }}
      />,
    );
    const control = screen.getByRole('button', { name: 'Hold to send' });
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(screen.getByText('Enter again to send')).toBeInTheDocument();
    expect(screen.getByText('Press Enter again to send — Esc cancels.')).toBeInTheDocument();
    fireEvent.keyDown(control, { key: 'Enter' });
    expect(screen.getByText('Confirming the send…')).toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByText('The letter could not be confirmed as sent. Check the thread before trying again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/approval/i)).toBeNull();
  });
});
