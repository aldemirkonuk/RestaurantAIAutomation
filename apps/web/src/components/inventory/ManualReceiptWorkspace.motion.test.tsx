import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const seen: Record<string, any>[] = [];
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: any) => children,
  motion: {
    div: ({ children, initial, animate, exit, transition, className }: any) => {
      seen.push({ initial, animate, exit, transition, className });
      return <div className={className}>{children}</div>;
    },
  },
}));
vi.mock('../../lib/menuScannerPersistence', () => ({ persistBatchToInventory: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'manager' }, restaurant: { id: 'r1' } }) }));
vi.mock('../../hooks/queries', () => ({ useWines: () => ({ data: [], isFetching: false }) }));
vi.mock('../../hooks/queries/useProviderQueries', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../hooks/useStorageLocations', () => ({ useStorageLocations: () => ({ locations: [] }) }));

import { ManualReceiptWorkspace } from './ManualReceiptWorkspace';

function mount() {
  seen.length = 0;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ManualReceiptWorkspace isOpen onClose={() => {}} />
    </QueryClientProvider>,
  );
}
function reducedMotion(on: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as any;
}

describe('the receive modal enters on the house settle and never exits (r102 motion-2)', () => {
  const original = window.matchMedia;
  beforeEach(() => reducedMotion(false));
  afterEach(() => {
    window.matchMedia = original;
  });

  it('enters with the 320ms settle and carries no exit props', () => {
    mount();
    const panel = seen.find((p) => p.initial && p.initial.scale === 0.97)!;
    expect(panel).toBeTruthy();
    expect(panel.transition.duration).toBeCloseTo(0.32);
    expect(panel.transition.ease).toEqual([0.16, 1, 0.3, 1]);
    expect(seen.every((p) => p.exit === undefined)).toBe(true);
  });

  it('under reduced motion it is an instant swap: no initial state to animate from', () => {
    reducedMotion(true);
    mount();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((p) => p.initial === false)).toBe(true);
    expect(seen.every((p) => p.exit === undefined)).toBe(true);
  });
});
