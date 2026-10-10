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
import {
  getHouseCurrency,
  localeOfCountry,
  setHouseCurrency,
  setHouseLocale,
  subscribeHouseCurrency,
} from '../lib/houseCurrency';

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
      setHouseLocale(null);
      return;
    }
    if (answeredFor !== restaurantId) {
      setHouseCurrency(undefined);
      setHouseLocale(null);
    }
    let live = true;
    settingsApi
      .houseCurrency()
      .then((d) => {
        if (!live) return;
        answeredFor = restaurantId;
        // The same read carries the country the house groups its figures by
        // (F-908). Set first: the hook re-renders on the currency, so the
        // locale must already be in place when that lands.
        setHouseLocale(d && d.readable ? localeOfCountry(d.country) : null);
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
