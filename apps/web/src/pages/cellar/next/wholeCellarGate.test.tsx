/**
 * The whole-cellar section costs six register reads, and it must not spend them
 * before somebody asks — nor ever close a view the reader opened by hand.
 *
 * Two claims the page makes in prose, pinned as behaviour:
 *
 *  1. **`useWholeCellar` fires nothing while it is not enabled.** The section's
 *     own copy says "Not read on page load: this is one request per register,
 *     and a page does not spend that on somebody who came to look at one card."
 *     A promise about network cost that no test holds is a promise that a later
 *     refactor — moving the `enabled` flag, or dropping it into a `useEffect` —
 *     breaks silently, because six extra reads look like nothing on a fast
 *     laptop. `useCellarNextData.ts:697` is the gate; this is its measurement.
 *     The unread-readout case (`carried === null`) is pinned separately,
 *     because it fails open in a different way: not a disabled query but no
 *     query at all.
 *  2. **The `defaultOpen` sync is upward only.** The readout arrives after the
 *     first paint, so `defaultOpen` flips true one render in and the section
 *     must open. But the same effect, written as `setOpen(defaultOpen)`, would
 *     also SHUT a section the reader had opened by hand the moment the readout
 *     said the house does not qualify — a view closing itself under the
 *     reader's cursor. The rerender test is the only thing that separates the
 *     two implementations; both satisfy "it opens when defaultOpen is true".
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const get = vi.fn();
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a) },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', loading: false, isAuthenticated: true }),
}));

import { useWholeCellar } from './useCellarNextData';
import WholeCellar from './WholeCellar';

const CARRIED = ['beer', 'whiskey', 'cocktails'] as const;

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

/** Only the register reads count — the section's other hooks are not the gate. */
function registerReads(): string[] {
  return get.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/registers/'));
}

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ data: { rows: [] } });
});

describe('useWholeCellar spends nothing until it is asked to', () => {
  it('reads no register while `enabled` is false', async () => {
    renderHook(() => useWholeCellar(false, [...CARRIED]), { wrapper: wrapper() });
    // Give the query client every chance to fire; the point is that it does not.
    await new Promise((r) => setTimeout(r, 30));
    expect(registerReads()).toEqual([]);
  });

  it('reads no register while the readout is unread, even when enabled', async () => {
    renderHook(() => useWholeCellar(true, null), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 30));
    expect(registerReads()).toEqual([]);
  });

  it('reads one register per carried kind the moment it IS enabled', async () => {
    renderHook(() => useWholeCellar(true, [...CARRIED]), { wrapper: wrapper() });
    await waitFor(() => expect(registerReads()).toHaveLength(CARRIED.length));
    for (const register of CARRIED) {
      expect(registerReads().some((u) => u.endsWith(`/registers/${register}`))).toBe(true);
    }
  });

  /**
   * `/wines` is a different endpoint with the inventory overlay laid over it,
   * so its rows are not this list's shape — the section says so in a sentence
   * rather than fetching a book it cannot print.
   */
  it('never reads the wines register, which is a different shape', async () => {
    renderHook(() => useWholeCellar(true, ['wines', 'beer']), { wrapper: wrapper() });
    await waitFor(() => expect(registerReads()).toHaveLength(1));
    expect(registerReads()[0]).toContain('/registers/beer');
  });
});

describe('the defaultOpen sync is upward only', () => {
  function mount(defaultOpen: boolean) {
    return render(<WholeCellar carried={[...CARRIED]} defaultOpen={defaultOpen} />, {
      wrapper: wrapper(),
    });
  }

  it('opens itself when the readout arrives saying the house qualifies', async () => {
    const { rerender } = mount(false);
    expect(screen.getByTestId('whole-cellar-open')).toBeTruthy();

    rerender(<WholeCellar carried={[...CARRIED]} defaultOpen />);
    await waitFor(() => expect(screen.queryByTestId('whole-cellar-open')).toBeNull());
  });

  it('does NOT close a section the reader opened when defaultOpen flips back to false', async () => {
    const { rerender } = mount(false);
    fireEvent.click(screen.getByTestId('whole-cellar-open'));
    expect(screen.queryByTestId('whole-cellar-open')).toBeNull();

    // The readout resolves — the house qualifies — and then re-resolves the
    // other way (a tenant switch, a refetch). It is that true → false
    // TRANSITION that a two-way `setOpen(defaultOpen)` acts on; a rerender
    // with an unchanged prop runs no effect in either implementation, so the
    // transition is what has to be exercised for this to prove anything.
    rerender(<WholeCellar carried={[...CARRIED]} defaultOpen />);
    await new Promise((r) => setTimeout(r, 20));
    rerender(<WholeCellar carried={[...CARRIED]} defaultOpen={false} />);
    await new Promise((r) => setTimeout(r, 20));

    // Still open: the rule may open a view, it may never take one away.
    expect(screen.queryByTestId('whole-cellar-open')).toBeNull();
    expect(screen.getByLabelText('Search the whole cellar')).toBeTruthy();
  });

  it('stays open across a true → false → true cycle without flickering shut', async () => {
    const { rerender } = mount(true);
    await waitFor(() => expect(screen.queryByTestId('whole-cellar-open')).toBeNull());
    rerender(<WholeCellar carried={[...CARRIED]} defaultOpen={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('whole-cellar-open')).toBeNull();
    rerender(<WholeCellar carried={[...CARRIED]} defaultOpen />);
    expect(screen.queryByTestId('whole-cellar-open')).toBeNull();
  });
});
