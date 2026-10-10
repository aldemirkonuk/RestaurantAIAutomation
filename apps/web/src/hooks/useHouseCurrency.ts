/**
 * Read the house's currency (`GET /settings/currency`) and publish it to the
 * money helpers in `lib/houseCurrency.ts`. A page that prints money calls this
 * once at the top, so it re-renders when the answer lands. Returns the same
 * three-state value as `getHouseCurrency()`: `undefined` not read yet (or the
 * read failed), `null` not recorded, else the code.
 *
 * Kept out of `lib/houseCurrency.ts` so `lib/utils.ts` does not pull the auth
 * context into every component that imports `cn`.
 */
import { useContext, useEffect, useSyncExternalStore } from 'react';
import { AuthContext } from '../contexts/AuthContext';
import { getActiveRestaurantId } from '../services/api/client';
import { settingsApi } from '../services/api/settings';
import { getHouseCurrency, setHouseCurrency, subscribeHouseCurrency } from '../lib/houseCurrency';

/** The house the store's answer belongs to, so a branch switch never shows the last house's money. */
let answeredFor: string | null = null;

export function useHouseCurrency(): string | null | undefined {
  // The context when there is one; a page rendered without the provider (its
  // own tests) falls back to the id the API client sends, and never throws.
  const restaurantId = useContext(AuthContext)?.activeRestaurantId ?? (getActiveRestaurantId() || null);
  useEffect(() => {
    if (!restaurantId) {
      answeredFor = null;
      setHouseCurrency(undefined);
      return;
    }
    if (answeredFor !== restaurantId) setHouseCurrency(undefined);
    let live = true;
    settingsApi
      .houseCurrency()
      .then((d) => {
        if (!live) return;
        answeredFor = restaurantId;
        setHouseCurrency(d && d.readable ? d.code : undefined);
      })
      .catch(() => {
        if (live && answeredFor !== restaurantId) setHouseCurrency(undefined);
      });
    return () => {
      live = false;
    };
  }, [restaurantId]);
  return useSyncExternalStore(subscribeHouseCurrency, getHouseCurrency, getHouseCurrency);
}
