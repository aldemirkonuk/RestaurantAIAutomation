/**
 * Who the page offers "rule a day out" to (OPS-04, 2026-10-07).
 *
 * The gateway refuses `POST` and `DELETE /analytics/exclusions/:rid` to anyone
 * but an owner or a manager of the house (`RolesGuard`, the role on the
 * caller's access row in the token's house). The page's `canRuleOutDays`
 * reads that same row, `activeRole`, and never the account-wide `user.role`
 * fallback the shell uses for its own reading, so the controls are never
 * drawn for someone the gateway would refuse.
 *
 * A separate file from `useRecommendationsNextData.test.tsx` because this one
 * needs `useAuth` to return a `user` as well.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
const who = vi.hoisted(() => ({
  activeRole: null as string | null,
  user: null as { role: string } | null,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1', activeRole: who.activeRole, user: who.user }),
}));
vi.mock('@/services/api/client', () => ({ apiClient: api }));
vi.mock('@/services/api/team', () => ({ getTeamMembers: vi.fn(async () => []) }));

import { useRecommendationsNextData } from './useRecommendationsNextData';

beforeEach(() => {
  who.activeRole = null;
  who.user = null;
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url.includes('/exclusions'))
      return {
        data: {
          items: [{ businessDate: '2026-09-02', reason: 'closed', createdAt: null }],
          readable: true,
          problem: null,
        },
      };
    return { data: { recommendations: [], rulesEvaluated: 0, generatedAt: null } };
  });
});

async function ready() {
  const hook = renderHook(() => useRecommendationsNextData());
  await waitFor(() => expect(hook.result.current.exclusions).toBeDefined());
  return hook.result;
}

describe('canRuleOutDays — owners and managers of this house (OPS-04)', () => {
  it.each(['owner', 'manager'])('[REVERT-FAILS] %s may rule a day out', async (r) => {
    who.activeRole = r;
    const result = await ready();
    expect(result.current.canRuleOutDays).toBe(true);
  });

  it.each([
    ['staff', 'staff'],
    ['the platform admin', 'admin'],
    ['a role that is not a house role', 'guest'],
    ['a role not read yet', null],
  ])('[REVERT-FAILS] %s may not', async (_label, r) => {
    who.activeRole = r;
    const result = await ready();
    expect(result.current.canRuleOutDays).toBe(false);
  });

  it('[REVERT-FAILS] reads activeRole alone: an account-wide manager with no role read here is not offered it', async () => {
    who.activeRole = null;
    who.user = { role: 'manager' };
    const result = await ready();
    // The shell's own reading falls back to the account role…
    expect(result.current.role).toBe('manager');
    // …but the gateway does not, so neither does the strike.
    expect(result.current.canRuleOutDays).toBe(false);
  });

  it('staff still read the struck days: the list is loaded whatever the role', async () => {
    who.activeRole = 'staff';
    const result = await ready();
    expect(result.current.exclusions).toEqual({
      items: [{ businessDate: '2026-09-02', reason: 'closed', createdAt: null }],
      readable: true,
      problem: null,
    });
  });
});
