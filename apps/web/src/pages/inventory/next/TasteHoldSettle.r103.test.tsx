/**
 * r103: the taste line's give-back is tied to when the read ANSWERS, not to mount. A slow read keeps
 * its slot until it answers, then gives it back over the whole 200 ms (it used to vanish in one frame).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/taste', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getTaste: api.get }));

import TasteSummary, { HOLD_COLLAPSE_MS } from './TasteSummary';

const empty = { state: 'ready' as const, data: { effective: null, layers: [] } };
const slow = (ms: number) => new Promise((res) => setTimeout(() => res(empty), ms));

beforeEach(() => { cleanup(); api.get.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

async function mountSlow(ms: number) {
  vi.useFakeTimers();
  api.get.mockImplementation(() => slow(ms));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><TasteSummary id="i1" restaurantId="r1" open={false} onOpen={() => {}} /></QueryClientProvider>);
  await act(async () => { vi.advanceTimersByTime(0); });
}
// React draws between timers, as a browser does: step the clock 5 ms at a time, each step flushed by its own act.
const advance = async (ms: number) => {
  for (let t = 0; t < ms; t += 5) await act(async () => { vi.advanceTimersByTime(5); });
};
const hold = () => screen.queryByTestId('taste-line-hold');

describe('the hold is released from the answer, not from mount (r103)', () => {
  it('a 700 ms read keeps its slot until it answers, then tweens for the full 200 ms', async () => {
    await mountSlow(700);
    await advance(650);
    expect(hold()).not.toBeNull();
    expect(hold()).not.toHaveAttribute('data-collapsing');
    await advance(60);          // answered at 700, now 710
    expect(hold()).toHaveAttribute('data-collapsing', 'true');
    await advance(HOLD_COLLAPSE_MS - 50);  // ~860: still tweening
    expect(hold()).toHaveAttribute('data-collapsing', 'true');
    await advance(80);          // past 700 + 200
    expect(hold()).toBeNull();
  });

  it('a 450 ms read (between the grace and the old 540 ms cut) gets its whole tween too', async () => {
    await mountSlow(450);
    await advance(460);
    expect(hold()).toHaveAttribute('data-collapsing', 'true');
    await advance(HOLD_COLLAPSE_MS - 30);  // ~630: the old code was gone at 540
    expect(hold()).toHaveAttribute('data-collapsing', 'true');
    await advance(60);
    expect(hold()).toBeNull();
  });
});
