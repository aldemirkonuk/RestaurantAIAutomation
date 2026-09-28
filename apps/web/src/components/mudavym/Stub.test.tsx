/**
 * The Stub — sketch 103 · 1b, and the tear that puts it on the row.
 *
 * Against the pre-fix primitive (`git show HEAD:…/Sheet.tsx`, measured
 * 2026-09-06) Esc and a scrim click called `onClose()` unconditionally on all
 * sixty surfaces with no dirty check at all (finder B, D3 — "the most damaging
 * single defect in the primitive, because it is uniform"). These tests fail
 * there: `onTear` is never called and the draft is destroyed.
 */

import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { Sheet, Panel, resetLabelWarnings, resetSheetWidth } from './Sheet';
import { Stub } from './Stub';
import { tuck } from '../../lib/mudavym/motion';

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

beforeEach(() => {
  setReducedMotion(false);
  resetLabelWarnings();
  resetSheetWidth();
  document.body.style.overflow = '';
});

describe('a dirty sheet tears instead of being destroyed', () => {
  it('calls onTear at the gesture and closes when the tuck has run', () => {
    vi.useFakeTimers();
    const onTear = vi.fn();
    const onClose = vi.fn();
    render(
      <div className="mudavym">
        <Sheet
          open
          onClose={onClose}
          onTear={onTear}
          dirty
          label="A word on this delivery. Sending writes it to the thread; leaving holds it here."
        >
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    // The caller is told immediately, so the stub lands in the same frame.
    expect(onTear).toHaveBeenCalledWith('esc');
    // …and the sheet is still on screen, leaving on `tuck`.
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(tuck.ms);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('tears on a click outside too, and names that reason', () => {
    vi.useFakeTimers();
    const onTear = vi.fn();
    render(
      <div className="mudavym">
        <Sheet
          open
          onClose={() => {}}
          onTear={onTear}
          dirty
          label="A word on this delivery. Sending writes it to the thread; leaving holds it here."
        >
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Close A word on this delivery/ }),
    );
    expect(onTear).toHaveBeenCalledWith('outside');
    act(() => {
      vi.advanceTimersByTime(tuck.ms);
    });
    vi.useRealTimers();
  });

  it('closes at once under reduced motion — the end state, not a shorter tear', () => {
    setReducedMotion(true);
    const onClose = vi.fn();
    const onTear = vi.fn();
    render(
      <div className="mudavym">
        <Sheet
          open
          onClose={onClose}
          onTear={onTear}
          dirty
          label="A word on this delivery. Sending writes it to the thread; leaving holds it here."
        >
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onTear).toHaveBeenCalledWith('esc');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves a clean sheet exactly as it was — closes now, tells nobody it tore', () => {
    const onClose = vi.fn();
    const onTear = vi.fn();
    render(
      <div className="mudavym">
        <Sheet
          open
          onClose={onClose}
          onTear={onTear}
          label="Nothing here is unwritten, so leaving costs nothing at all."
        >
          <button type="button">body</button>
        </Sheet>
      </div>,
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onTear).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks a dirty surface on the root so the CSS never has to read a prop', () => {
    render(
      <div className="mudavym">
        <Panel open onClose={() => {}} dirty label="This panel is holding unsaved edits right now.">
          <button type="button">body</button>
        </Panel>
      </div>,
    );
    expect(document.querySelector('.mdv-ovl')).toHaveAttribute('data-dirty', 'true');
  });
});

describe('the stub on the row', () => {
  afterEach(() => vi.useRealTimers());

  it('holds the words and offers both ways out, in words', () => {
    render(
      <div className="mudavym">
        <Stub words="Two bottles short — asked Selim" onResume={() => {}} onDiscard={() => {}} />
      </div>,
    );
    expect(screen.getByText('Held here · unwritten')).toBeInTheDocument();
    expect(screen.getByText(/Two bottles short/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
  });

  it('fires the discard at the click and offers ten seconds to put it back (F10)', () => {
    vi.useFakeTimers();
    const onDiscard = vi.fn();
    const onRestore = vi.fn();
    render(
      <div className="mudavym">
        <Stub words="a draft" onResume={() => {}} onDiscard={onDiscard} onRestore={onRestore} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    // Undo-after, not are-you-sure: the act has already happened.
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Discarded · nothing was written')).toBeInTheDocument();
    expect(screen.getByText(/10 seconds to put them back/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText(/6 seconds to put them back/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Put it back' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Held here · unwritten')).toBeInTheDocument();
  });

  it('closes the window when the ten seconds are up and leaves the row clean', () => {
    vi.useFakeTimers();
    render(
      <div className="mudavym">
        <Stub words="a draft" onResume={() => {}} onDiscard={() => {}} onRestore={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
    expect(document.querySelector('.mdv-stub')).toBeNull();
  });

  it('offers no undo it cannot honour — no onRestore, no button', () => {
    const onDiscard = vi.fn();
    render(
      <div className="mudavym">
        <Stub words="a draft" onResume={() => {}} onDiscard={onDiscard} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Put it back' })).toBeNull();
    expect(document.querySelector('.mdv-stub')).toBeNull();
  });

  it('resumes to the caller, which is what re-opens the sheet', () => {
    function Row() {
      const [held, setHeld] = useState(true);
      const [open, setOpen] = useState(false);
      return (
        <div className="mudavym">
          {held ? (
            <Stub
              words="Two bottles short"
              onResume={() => {
                setHeld(false);
                setOpen(true);
              }}
              onDiscard={() => setHeld(false)}
            />
          ) : null}
          <Sheet
            open={open}
            onClose={() => setOpen(false)}
            dirty
            onTear={() => setHeld(true)}
            label="A word on this delivery. Sending writes it to the thread; leaving holds it here."
          >
            <button type="button">body</button>
          </Sheet>
        </div>
      );
    }
    render(<Row />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('.mdv-stub')).toBeNull();
  });
});
