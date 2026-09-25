/**
 * ONE toast (sketch 119, "the shared pieces"): `useToast()` keeps one public
 * surface for its ~9 callers, but which visual system answers is gated —
 * off (legacy default), its own Radix toasts, unchanged; on, every call is
 * forwarded to `sonner` instead, landing on the SAME `<Toaster/>` the ~30
 * direct `sonner` callers already use.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    promise: vi.fn(),
  }),
}));

import { ToastProvider, UNDO_DURATION, useToast } from './ToastContext';
import { clearMudavymDesignCache } from '../lib/mudavym/useMudavymDesign';

function Probe() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.success('Order sent', { description: 'not yet confirmed by the vendor' })}
    >
      fire
    </button>
  );
}

function mount() {
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
}

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  vi.mocked(sonnerToast.success).mockClear();
  vi.mocked(sonnerToast.dismiss).mockClear();
});
afterEach(() => window.localStorage.clear());

// [2026-09-25: `shell` is in LIVE_PAGES (ADR 0149 row 36's bracket, founder
// Q2/Q4 of 2026-09-22). "Off" is no longer the default or any house's flag;
// only the browser's QA override '0' reaches the legacy renderer now.]
describe("shell off (the QA override '0' -- since 2026-09-25 the only way to legacy)", () => {
  beforeEach(() => window.localStorage.setItem('mudavym.design.shell', '0'));

  it('never calls sonner — the legacy Radix toast renders its own markup', () => {
    mount();
    act(() => screen.getByText('fire').click());
    expect(sonnerToast.success).not.toHaveBeenCalled();
    // The legacy renderer's own title/description land in the DOM.
    expect(screen.getByText('Order sent')).toBeTruthy();
    expect(screen.getByText('not yet confirmed by the vendor')).toBeTruthy();
  });
});

describe('shell on (the default: live in code, no override, no flag row)', () => {
  it('forwards a call to sonner with no override set at all', () => {
    mount();
    act(() => screen.getByText('fire').click());
    expect(sonnerToast.success).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('not yet confirmed by the vendor')).toBeNull();
  });
});

describe('shell on (browser override)', () => {
  beforeEach(() => window.localStorage.setItem('mudavym.design.shell', '1'));

  it('forwards every call to sonner instead of rendering its own toast', () => {
    mount();
    act(() => screen.getByText('fire').click());
    expect(sonnerToast.success).toHaveBeenCalledTimes(1);
    const [title, opts] = vi.mocked(sonnerToast.success).mock.calls[0];
    expect(title).toBe('Order sent');
    expect(opts).toMatchObject({ description: 'not yet confirmed by the vendor' });
    // No second, Radix-rendered toast landed in the DOM — sonner is the only surface.
    expect(screen.queryByText('not yet confirmed by the vendor')).toBeNull();
  });

  it('dismiss(id) forwards the exact id sonner assigned this toast', () => {
    let returnedId = '';
    function Fire() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => { returnedId = toast.success('x'); }}>
          fire
        </button>
      );
    }
    render(
      <ToastProvider>
        <Fire />
      </ToastProvider>,
    );
    act(() => screen.getByText('fire').click());
    const [, opts] = vi.mocked(sonnerToast.success).mock.calls[0];
    expect((opts as { id?: string })?.id).toBe(returnedId);
  });
});

/**
 * The provider wraps the whole app (App.tsx: the socket, realtime, the
 * Router). The house flag answers AFTER the first render, so a provider that
 * returned a different component for on and off remounted every page beneath
 * it once per load. Children must survive the gate turning on.
 * [2026-09-25: with `shell` in LIVE_PAGES no house flag flips it any more;
 * the QA override is the only thing that still can, and it is what this
 * test flips.]
 */
describe('the gate turning on mid-session', () => {
  it('never remounts what the provider wraps', () => {
    let mounts = 0;
    function Child() {
      const [id] = useState(() => {
        mounts += 1;
        return mounts;
      });
      return <span>child {id}</span>;
    }
    function Fire() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.success('switched')}>
          fire2
        </button>
      );
    }
    const tree = () => (
      <ToastProvider>
        <Child />
        <Fire />
      </ToastProvider>
    );
    window.localStorage.setItem('mudavym.design.shell', '0');
    const { rerender } = render(tree());
    expect(mounts).toBe(1);
    // Off: the call is the legacy renderer's, sonner is not touched.
    act(() => screen.getByText('fire2').click());
    expect(sonnerToast.success).not.toHaveBeenCalled();
    // The house flag answers: the override stands in for it (same hook, same
    // three layers — the override is read on every render).
    window.localStorage.setItem('mudavym.design.shell', '1');
    rerender(tree());
    expect(mounts).toBe(1);
    expect(screen.getByText('child 1')).toBeTruthy();
    // ...and the value did switch: a call now reaches sonner.
    act(() => screen.getByText('fire2').click());
    expect(sonnerToast.success).toHaveBeenCalledWith('switched', expect.anything());
    expect(mounts).toBe(1);
  });
});

describe('the undo toast', () => {
  function UndoProbe({ onUndo }: { onUndo: () => void }) {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast.undo('Recommendation dismissed', onUndo)}>
        dismiss it
      </button>
    );
  }

  it('shell on: one sonner action labelled Undo that calls back, with the 8 s drain', () => {
    window.localStorage.setItem('mudavym.design.shell', '1');
    vi.mocked(sonnerToast).mockClear();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <UndoProbe onUndo={onUndo} />
      </ToastProvider>,
    );
    act(() => screen.getByText('dismiss it').click());
    const [title, opts] = vi.mocked(sonnerToast).mock.calls[0] as [
      string,
      { action?: { label: string; onClick: () => void }; duration?: number },
    ];
    expect(title).toBe('Recommendation dismissed');
    expect(opts.duration).toBe(UNDO_DURATION);
    expect(opts.action?.label).toBe('Undo');
    expect(onUndo).not.toHaveBeenCalled();
    opts.action?.onClick();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('shell off (QA override): the legacy toast draws an Undo control that calls back', () => {
    window.localStorage.setItem('mudavym.design.shell', '0');
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <UndoProbe onUndo={onUndo} />
      </ToastProvider>,
    );
    act(() => screen.getByText('dismiss it').click());
    expect(screen.getByText('Recommendation dismissed')).toBeTruthy();
    act(() => screen.getByRole('button', { name: 'Undo' }).click());
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});
