/**
 * useMayPriceCocktails — who may price a cocktail or take one off the list
 * (F-270). The gateway answers those acts only for the owner or a manager of
 * the house; the page reads the same rule so staff are not offered a button
 * that is refused after the press.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const auth = vi.hoisted(() => ({
  value: { activeRole: null, user: null } as {
    activeRole: string | null;
    user: { role: string } | null;
  },
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => auth.value,
}));

import { useMayPriceCocktails } from './useCellarNextData';

describe('useMayPriceCocktails', () => {
  it.each([
    ['owner', null, true],
    ['manager', null, true],
    ['staff', null, false],
    // The role in THIS house wins over the account-wide one.
    ['staff', 'owner', false],
    // No house active yet: the account-wide role is the fallback.
    [null, 'manager', true],
    // Admin is refused by the gateway too; unknown reads as staff.
    ['admin', null, false],
    [null, null, false],
  ])('house role %j, account role %j → %j', (activeRole, globalRole, expected) => {
    auth.value = { activeRole, user: globalRole ? { role: globalRole } : null };
    const { result } = renderHook(() => useMayPriceCocktails());
    expect(result.current).toBe(expected);
  });
});
