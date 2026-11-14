import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, Suspense, type ReactElement, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { isStaleChunkError, lazyWithRefresh } from './lazyWithRefresh';

describe('isStaleChunkError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://x/assets/a.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Loading chunk 12 failed',
    'ChunkLoadError',
    "Expected a JavaScript module script but the server responded with a MIME type of 'text/html'",
  ])('reads %s as a stale file', (m) => expect(isStaleChunkError(new Error(m))).toBe(true));

  it('does not read an ordinary error as a stale file', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});

class Catch extends Component<{ children: ReactNode; onError?: (m: string) => void }, { e: boolean }> {
  state = { e: false };
  static getDerivedStateFromError() {
    return { e: true };
  }
  componentDidCatch(e: Error) {
    this.props.onError?.(e.message);
  }
  render() {
    return this.state.e ? <p data-testid="failed" /> : this.props.children;
  }
}

describe('lazyWithRefresh', () => {
  const reload = vi.fn();
  const original = window.location;
  beforeEach(() => {
    sessionStorage.clear();
    reload.mockReset();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, reload } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    sessionStorage.clear();
  });

  const draw = (factory: () => Promise<{ default: () => ReactElement }>) => {
    const Lazy = lazyWithRefresh(factory);
    return render(
      <Suspense fallback={<p data-testid="wait" />}>
        <Lazy />
      </Suspense>,
    );
  };

  it('draws the chunk once it is read and clears the reload mark', async () => {
    sessionStorage.setItem('chunk_reload', '1');
    draw(() => Promise.resolve({ default: () => <p data-testid="drawn" /> }));
    expect(screen.getByTestId('wait')).toBeTruthy();
    expect(await screen.findByTestId('drawn')).toBeTruthy();
    expect(sessionStorage.getItem('chunk_reload')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads the page once when a deploy took the old file away', async () => {
    draw(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('chunk_reload')).toBe('1');
    expect(screen.getByTestId('wait')).toBeTruthy();
  });

  it('does not reload a second time; the failure is thrown instead', async () => {
    sessionStorage.setItem('chunk_reload', '1');
    const caught = vi.fn();
    const Lazy = lazyWithRefresh(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Catch onError={caught}>
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>
      </Catch>,
    );
    expect(await screen.findByTestId('failed')).toBeTruthy();
    expect(caught).toHaveBeenCalledWith('Failed to fetch dynamically imported module');
    expect(reload).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('throws an ordinary failure without reloading', async () => {
    const Lazy = lazyWithRefresh(() => Promise.reject(new Error('boom')));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Catch>
        <Suspense fallback={null}>
          <Lazy />
        </Suspense>
      </Catch>,
    );
    expect(await screen.findByTestId('failed')).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('chunk_reload')).toBeNull();
    spy.mockRestore();
  });
});
