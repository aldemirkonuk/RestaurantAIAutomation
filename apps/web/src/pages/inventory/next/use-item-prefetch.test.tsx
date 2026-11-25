/**
 * A phone has no hover (r107 g5). A touch or pen pointerdown on a row warms the
 * drawer's reads with no 150 ms dwell, once per good per 5 s; a touch that
 * becomes a scroll (pointercancel, or a move past 10 px) warms nothing; a mouse
 * still takes the 150 ms path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useItemPrefetch } from './use-item-prefetch';

const api = vi.hoisted(() => ({ figures: vi.fn(), usedIn: vi.fn(), nutrition: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemFigures: api.figures,
  getItemUsedIn: api.usedIn,
  getItemNutrition: api.nutrition,
}));

function List() {
  const p = useItemPrefetch('r1', () => 'wine');
  return (
    <div
      onPointerOver={p.onPointerOver}
      onPointerOut={p.onPointerOut}
      onPointerDown={p.onPointerDown}
      onPointerMove={p.onPointerMove}
      onPointerUp={p.onPointerUp}
      onPointerCancel={p.onPointerCancel}
    >
      {['a', 'b'].map((id) => (
        <button key={id} data-row-id={id} data-testid={`row-${id}`}>row {id}</button>
      ))}
    </div>
  );
}

const reads = () => api.figures.mock.calls.length + api.usedIn.mock.calls.length + api.nutrition.mock.calls.length;
const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

let qc: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  qc = new QueryClient();
  for (const f of Object.values(api)) f.mockReset().mockResolvedValue({});
  render(<QueryClientProvider client={qc}><List /></QueryClientProvider>);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('touch warms the drawer reads', () => {
  it('a touch pointerdown that is held past the guard fires all three reads, with no 150 ms dwell', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    await wait(60);
    expect(reads()).toBe(3);
  });

  it('a tap (down, up inside the slop) fires at the lift, before any guard', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerUp(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 6, clientY: 6 });
    await wait(0);
    expect(reads()).toBe(3);
  });

  it('a pen warms too', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'pen', clientX: 5, clientY: 5 });
    await wait(60);
    expect(reads()).toBe(3);
  });

  it('a touch the browser cancels for a scroll fires none', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerCancel(screen.getByTestId('row-a'), { pointerType: 'touch' });
    await wait(500);
    expect(reads()).toBe(0);
  });

  it('a finger that travels past 10 px fires none, even if it comes back and lifts', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 40 });
    fireEvent.pointerUp(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    await wait(500);
    expect(reads()).toBe(0);
  });

  it('a wobble inside 10 px still warms', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 9, clientY: 9 });
    await wait(60);
    expect(reads()).toBe(3);
  });

  it('the same row again inside 5 s warms once; after 5 s it may warm again', async () => {
    const down = () => fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    down();
    await wait(60);
    // The cache is emptied each time, so only the 5 s rule can hold a second warm back.
    qc.clear(); api.figures.mockClear(); api.usedIn.mockClear(); api.nutrition.mockClear();
    await wait(1000);
    down();
    await wait(60);
    expect(reads()).toBe(0);
    await wait(5000);
    qc.clear();
    down();
    await wait(60);
    expect(reads()).toBe(3);
  });

  it('another row is not held back by the first', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    await wait(60);
    fireEvent.pointerDown(screen.getByTestId('row-b'), { pointerType: 'touch', clientX: 5, clientY: 5 });
    await wait(60);
    expect(reads()).toBe(6);
  });

  it('a mouse pointerdown does not use the touch path, and its hover still takes 150 ms', async () => {
    fireEvent.pointerDown(screen.getByTestId('row-a'), { pointerType: 'mouse' });
    await wait(60);
    expect(reads()).toBe(0);
    fireEvent.pointerOver(screen.getByTestId('row-b'), { pointerType: 'mouse' });
    await wait(100);
    expect(reads()).toBe(0);
    await wait(60);
    expect(reads()).toBe(3);
  });
});
