import { useAuth } from '../contexts/AuthContext';
import { mayActForTheHouse } from '../lib/recommendationState';

/**
 * Whether the person signed in is an owner or a manager of the open house —
 * the role the house's money and settings acts need on the gateway (roles
 * sweep, 2026-10-08: F-312 a wine's cost, F-317 settling a delivery). The page
 * only stops offering what the gateway would refuse; the gateway still decides.
 *
 * The house role first, the account's role as the fallback, as the inventory
 * page's price controls read it. Where no auth provider wraps the component,
 * `useAuth` throws after reading the context; that is caught here so the
 * component still renders, offering nothing (fails closed). The context read
 * itself runs on every render, so the hook order never changes.
 */
export function useMayActForTheHouse(): boolean {
  try {
    const auth = useAuth();
    return mayActForTheHouse(auth?.activeRole ?? auth?.user?.role ?? null);
  } catch {
    return false;
  }
}
