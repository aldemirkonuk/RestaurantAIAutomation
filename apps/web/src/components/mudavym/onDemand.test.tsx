/**
 * perf-p9-5: an overlay loads from its own chunk, preloaded on intent.
 *  - closed and never opened: nothing mounts and the loader is never called;
 *  - preload downloads without mounting;
 *  - the first open mounts it, and it stays mounted after a close (the old
 *    static import's behaviour: no new exit animation, no fade);
 *  - pointer or focus on a `data-preload` button, and the idle callback, start
 *    the download.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { onDemand } from './onDemand';

const loads = vi.hoisted(() => ({ ask: vi.fn(), palette: vi.fn() }));
function Probe({ open }: { open: boolean }) {
  return open ? <div data-testid="x" /> : <div data-testid="x-closed" />;
}

describe('onDemand', () => {
  it('mounts nothing and loads nothing until first open, then stays mounted', async () => {
    const load = vi.fn(async () => ({ default: Probe }));
    const { Component } = onDemand(load);
    const { rerender } = render(<Component open={false} />);
    expect(load).not.toHaveBeenCalled();
    expect(screen.queryByTestId('x-closed')).toBeNull();

    rerender(<Component open />);
    expect(await screen.findByTestId('x')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);

    rerender(<Component open={false} />);
    expect(screen.getByTestId('x-closed')).toBeInTheDocument();
  });

  it('preload downloads without mounting', async () => {
    const load = vi.fn(async () => ({ default: Probe }));
    const { Component, preload } = onDemand(load);
    preload();
    expect(load).toHaveBeenCalledTimes(1);
    render(<Component open={false} />);
    expect(screen.queryByTestId('x-closed')).toBeNull();
  });

  it('a failed preload does not throw', async () => {
    const { preload } = onDemand(async () => {
      throw new Error('offline');
    });
    expect(() => preload()).not.toThrow();
  });
});

describe('preloadOnIntent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    loads.ask.mockClear();
    loads.palette.mockClear();
    // Re-registered after the reset so each test's import evaluates them anew.
    vi.doMock('../askai/AskPanel', () => {
      loads.ask();
      return { default: ({ open }: { open: boolean }) => (open ? <div data-testid="ask" /> : null) };
    });
    vi.doMock('../command/CommandPalette', () => {
      loads.palette();
      return { CommandPalette: ({ open }: { open: boolean }) => (open ? <div data-testid="pal" /> : null) };
    });
  });
  afterEach(() => vi.useRealTimers());

  it('pointer over a data-preload="ask" button starts the Ask download only', async () => {
    const { preloadOnIntent } = await import('./preloadOnIntent');
    const stop = preloadOnIntent();
    const b = document.createElement('button');
    b.setAttribute('data-preload', 'ask');
    b.innerHTML = '<span>Ask</span>';
    document.body.appendChild(b);
    await act(async () => {
      b.firstElementChild!.dispatchEvent(new Event('pointerover', { bubbles: true }));
      await Promise.resolve();
    });
    expect(loads.ask).toHaveBeenCalledTimes(1);
    expect(loads.palette).not.toHaveBeenCalled();
    stop();
    b.remove();
  });

  it('focus on a data-preload="palette" button starts the palette download only', async () => {
    const { preloadOnIntent } = await import('./preloadOnIntent');
    const stop = preloadOnIntent();
    const b = document.createElement('button');
    b.setAttribute('data-preload', 'palette');
    document.body.appendChild(b);
    await act(async () => {
      b.dispatchEvent(new Event('focusin', { bubbles: true }));
      await Promise.resolve();
    });
    expect(loads.palette).toHaveBeenCalledTimes(1);
    expect(loads.ask).not.toHaveBeenCalled();
    stop();
    b.remove();
  });

  it('both download once the page has gone idle', async () => {
    let idle: (() => void) | undefined;
    (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (cb: () => void) => {
      idle = cb;
      return 1;
    };
    (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = () => {};
    const { preloadOnIntent } = await import('./preloadOnIntent');
    const stop = preloadOnIntent();
    // Nothing downloads before the browser says it is idle.
    expect(loads.ask).not.toHaveBeenCalled();
    await act(async () => {
      idle!();
      await vi.dynamicImportSettled();
    });
    expect(loads.ask).toHaveBeenCalledTimes(1);
    expect(loads.palette).toHaveBeenCalledTimes(1);
    stop();
    delete (window as unknown as Record<string, unknown>).requestIdleCallback;
    delete (window as unknown as Record<string, unknown>).cancelIdleCallback;
  });

  it('cleanup removes the listeners and the idle timer', async () => {
    const { preloadOnIntent } = await import('./preloadOnIntent');
    const stop = preloadOnIntent();
    stop();
    const b = document.createElement('button');
    b.setAttribute('data-preload', 'ask');
    document.body.appendChild(b);
    await act(async () => {
      b.dispatchEvent(new Event('pointerover', { bubbles: true }));
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
    });
    expect(loads.ask).not.toHaveBeenCalled();
    b.remove();
  });
});
