/**
 * Who may write on the goals desk, as the page decides it.
 *
 * `activeRole` is `null` in more than one state, including before the first
 * read returns, after a failed read, and when the read finds no role for this
 * person here. The sentence for `null` says the role is not confirmed here and
 * says nothing about it becoming known later.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ role: 'manager' as 'owner' | 'manager' | 'staff' | null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: auth.role }),
}));
vi.mock('@/hooks/useGoalScenarios', () => ({ useGoalScenarios: () => ({}) }));
vi.mock('@/services/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { useGoalsDesk } from './useGoalsDesk';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

const desk = () =>
  renderHook(() => useGoalsDesk({ place: vi.fn(), queryRoot: 'reports-next' }), { wrapper: wrapper() })
    .result.current;

describe('useGoalsDesk — who may write', () => {
  it.each(['owner', 'manager'] as const)('lets %s write, with no note', (role) => {
    auth.role = role;
    const d = desk();
    expect(d.canWrite).toBe(true);
    expect(d.readOnlyReason).toBeNull();
  });

  it('keeps the desk read-only for staff, with the staff sentence', () => {
    auth.role = 'staff';
    const d = desk();
    expect(d.canWrite).toBe(false);
    expect(d.readOnlyReason).toBe(
      'Goals are set by owners and managers. You can read every figure here; the controls are theirs.',
    );
  });

  it('[REVERT-FAILS] keeps the desk read-only for a role that is not known, and says it is not confirmed, not that it will be', () => {
    auth.role = null;
    const d = desk();
    expect(d.canWrite).toBe(false);
    expect(d.readOnlyReason).toBe(
      'Your role at this restaurant is not confirmed here, so the desk is read-only. ' +
        'Ask a manager or an owner to set or change a goal.',
    );
    expect(d.readOnlyReason).not.toMatch(/yet|until/i);
  });
});
