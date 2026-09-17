/**
 * The market-price register: what is being quoted below what it had lately
 * been going for.
 *
 * The founder's ask, verbatim: *"Add a section (maybe a box) that will
 * endpoint to market price notifications eg. Prod X is now selling lower than
 * 30 day avg. (buy it now sth like that)"*.
 *
 * WHAT THIS READS, AND WHAT IT DOES NOT.
 * `GET /vendor-intel/below-average` was built for this box in the same pass
 * (`apps/api-gateway/src/vendor-intel/vendor-intel.controller.ts`, the
 * arithmetic in `price-below-average.ts`, eleven jest cases). It sweeps
 * `vendor_price_observations` for the window, groups by product identity,
 * compares the newest sighting against the mean of the EARLIER sightings, and
 * reports what it skipped and why. It is a READ. It does not write a
 * notification row, and this page does not pretend one exists: the producer
 * that would turn a price drop into a line in the book is specified in the
 * page note §13 and belongs to a different pair of hands.
 *
 * MEASURED BEFORE IT WAS DRAWN (2026-09-03): `vendor_price_observations`
 * holds **zero rows** — an exact-count HEAD against the project this gateway
 * is pointed at came back with a content-range of nothing over nothing, i.e.
 * no rows at all, for this tenant and for the market. So the first screen
 * is not "nothing is cheap": it is "the register has no sightings at all yet",
 * with the two ways a sighting gets written named on the box. Those are not
 * the same sentence and the page must never collapse them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { FailureVM, failureOf } from './useNotificationsNextData';
import { num } from './nt-format';

export interface MarketPriceItem {
  productKey: string;
  /**
   * The class every sighting in this comparison shares — 'quoted' |
   * 'public_site' | 'other:<type>' (ADR 0117, `price-below-average.ts:91`).
   * A product with both quotes and scraped prices yields up to one item per
   * class, never one item mixing them.
   */
  sourceClass: string;
  productName: string | null;
  currency: string;
  latestPrice: number | null;
  latestAt: string | null;
  latestVendor: string | null;
  latestSource: string | null;
  averagePrice: number | null;
  averageOf: number | null;
  absoluteBelow: number | null;
  fractionBelow: number | null;
}

export interface MarketPriceVM {
  state: 'loading' | 'unreadable' | 'ready';
  failure: FailureVM | null;
  items: MarketPriceItem[];
  /**
   * Tier-4 public vendor-site comparisons. Its OWN line, never merged into
   * `items`: the founder's rule of 2026-09-04 is that a public page price is
   * shown, and shown apart from anything a vendor actually quoted.
   */
  publicSiteItems: MarketPriceItem[];
  /** How much the sweep actually looked at — the empty state depends on it. */
  scannedObservations: number | null;
  scannedProducts: number | null;
  /**
   * (product, class) groups the products split into. When it exceeds
   * `scannedProducts`, at least one product carried more than one class of
   * sighting and they were NOT averaged together.
   */
  scannedComparisons: number | null;
  /** Groups dropped, and the reason, so a short list can be read. */
  skippedThin: number | null;
  skippedNotBelow: number | null;
  skippedMixedCurrency: number | null;
  /** Sightings whose `source_type` has no class. Counted so a new one is loud. */
  skippedUnrecognisedClass: number | null;
  windowDays: number | null;
  minObservations: number | null;
}

const LOADING: MarketPriceVM = {
  state: 'loading',
  failure: null,
  items: [],
  publicSiteItems: [],
  scannedObservations: null,
  scannedProducts: null,
  scannedComparisons: null,
  skippedThin: null,
  skippedNotBelow: null,
  skippedMixedCurrency: null,
  skippedUnrecognisedClass: null,
  windowDays: null,
  minObservations: null,
};

function itemOf(raw: Record<string, unknown>): MarketPriceItem {
  const latest = (raw.latest ?? {}) as Record<string, unknown>;
  const average = (raw.average ?? {}) as Record<string, unknown>;
  return {
    productKey: String(raw.productKey ?? ''),
    sourceClass: typeof raw.sourceClass === 'string' ? raw.sourceClass : 'quoted',
    productName: typeof raw.productName === 'string' ? raw.productName : null,
    currency: typeof raw.currency === 'string' ? raw.currency : 'USD',
    latestPrice: num(latest.unitPrice),
    latestAt: typeof latest.observedAt === 'string' ? latest.observedAt : null,
    latestVendor: typeof latest.vendorName === 'string' ? latest.vendorName : null,
    latestSource: typeof latest.sourceType === 'string' ? latest.sourceType : null,
    averagePrice: num(average.unitPrice),
    averageOf: num(average.observations),
    absoluteBelow: num(raw.absoluteBelow),
    fractionBelow: num(raw.fractionBelow),
  };
}

/** Re-read on the same cadence as the book, so the two never disagree by much. */
export const MARKET_POLL_MS = 60_000;

export function useMarketPrice(): MarketPriceVM & { refresh: () => void } {
  const { activeRestaurantId } = useAuth();
  const [vm, setVm] = useState<MarketPriceVM>(LOADING);
  const tenant = useRef<string | null>(activeRestaurantId);

  useEffect(() => {
    tenant.current = activeRestaurantId;
    setVm(LOADING);
  }, [activeRestaurantId]);

  const read = useCallback(async () => {
    if (!activeRestaurantId) return;
    const forTenant = activeRestaurantId;
    try {
      const res = await apiClient.get('/vendor-intel/below-average', {
        params: { windowDays: 30 },
      });
      if (tenant.current !== forTenant) return;
      const d = (res.data ?? {}) as Record<string, unknown>;
      const scanned = (d.scanned ?? {}) as Record<string, unknown>;
      const skipped = (d.skipped ?? {}) as Record<string, unknown>;
      const window_ = (d.window ?? {}) as Record<string, unknown>;
      setVm({
        state: 'ready',
        failure: null,
        items: Array.isArray(d.items)
          ? (d.items as Array<Record<string, unknown>>).map(itemOf)
          : [],
        publicSiteItems: Array.isArray(d.publicSiteItems)
          ? (d.publicSiteItems as Array<Record<string, unknown>>).map(itemOf)
          : [],
        scannedObservations: num(scanned.observations),
        scannedProducts: num(scanned.products),
        scannedComparisons: num(scanned.comparisons),
        skippedThin: num(skipped.thinHistory),
        skippedNotBelow: num(skipped.notBelow),
        skippedMixedCurrency: num(skipped.mixedCurrency),
        skippedUnrecognisedClass: num(skipped.unrecognisedClass),
        windowDays: num(window_.days),
        minObservations: num(d.minObservations),
      });
    } catch (err) {
      if (tenant.current !== forTenant) return;
      // A refused or broken sweep is NOT an empty market. The box says which.
      setVm({ ...LOADING, state: 'unreadable', failure: failureOf(err) });
    }
  }, [activeRestaurantId]);

  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), MARKET_POLL_MS);
    return () => clearInterval(id);
  }, [read]);

  return { ...vm, refresh: () => void read() };
}
