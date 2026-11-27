/**
 * The line above the goals for a reader who is not an owner or a manager
 * claims no more than the page shows (walk r37 w3): with a goal's reading
 * withheld from staff, "You can read every figure here" was false.
 */
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const auth = vi.hoisted(() => ({ role: 'staff' as string | null }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'house-1', activeRole: auth.role }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock('@/hooks/useGoalScenarios', () => ({ useGoalScenarios: () => ({ book: null }) }));

import { GOALS_DESK_NOT_YOURS, useGoalsDesk } from './useGoalsDesk';

const wrap = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const reasonFor = (role: string | null) => {
  auth.role = role;
  return renderHook(() => useGoalsDesk({ place: () => {}, queryRoot: 'reports' }), { wrapper: wrap })
    .result.current.readOnlyReason;
};

describe('the goals desk line for a reader without the controls', () => {
  it('staff are told whose the controls are, and not that every figure is theirs to read', () => {
    const line = reasonFor('staff');
    expect(line).toBe(GOALS_DESK_NOT_YOURS);
    expect(line).not.toMatch(/every figure/i);
  });

  it('an owner and a manager get no such line', () => {
    expect(reasonFor('owner')).toBeNull();
    expect(reasonFor('manager')).toBeNull();
  });
});
