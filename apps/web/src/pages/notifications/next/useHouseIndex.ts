/**
 * The posted-price index register for THIS house's own state.
 *
 * The founder's call, 2026-09-04, verbatim: *"Run it, labelled tier 4, never
 * beside a quote"* and *"Show as a labelled index line, own register"*.
 *
 * WHAT THIS READS. `GET /price-index/me`
 * (`apps/api-gateway/src/price-index/price-index.controller.ts:57-82`) resolves
 * the caller's `restaurants.state_province` server-side — the web does not
 * carry it — normalises it to ISO-3166-2 and returns the posted-list /
 * control-state-shelf lines recorded for that jurisdiction, each carrying its
 * class, issuer, date, basis and unit (ADR 0117). It is a SEPARATE register
 * from `GET /vendor-intel/below-average`: a posted list is not a quote, and
 * the two are never averaged, ranked or drawn together.
 *
 * WHAT IT DOES NOT DO. It never converts a posted unit to a 750ml bottle, and
 * it never compares an index line to a vendor's price. The panel prints the
 * line as posted.
 *
 * MEASURED, 2026-09-04, against the project this gateway is pointed at
 * (`GET /api/v1/price-index/...`, dev-bypass owner session):
 *   - `me`         → `state: null`, silence "This house has no state recorded…"
 *                    (the demo tenant has no `state_province`).
 *   - `Michigan` / `Illinois` / `California` → `lines: []`, silence "The index
 *                    register could not be read. This is unknown, not empty."
 *                    `price_index_postings` is not present on that project;
 *                    the migration exists in this branch and is unapplied.
 *   - `Turkey`     → `state: null`, silence '"Turkey" is not a jurisdiction
 *                    this register recognises.'
 * So the panel's true first screen today is WORDS from the endpoint — never an
 * empty box and never a zero.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { FailureVM, failureOf } from './useNotificationsNextData';
import { num } from './nt-format';

/** One posted line, exactly as the register holds it. */
export interface HouseIndexLine {
  id: string;
  /** Which registry source wrote this row — the key the box title is looked up by. */
  sourceKey: string;
  sourceClass: string;
  issuer: string;
  issuedAt: string | null;
  /**
   * Whose clock `issuedAt` came from (ADR 0117 Q27). 'issuer_stated' is a date
   * the publisher printed; 'fetch_date' is the day we read the page because
   * nobody published one; null is a row written before the register recorded a
   * basis. Only the first may be rendered as "issued".
   */
  issuedAtBasis: string | null;
  priceBasis: string | null;
  productName: string;
  brand: string | null;
  region: string | null;
  price: number | null;
  currency: string;
  priceUnit: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  packageDesc: string | null;
  sourceUrl: string | null;
  /**
   * When WE read it. The produce box is titled with this rather than with the
   * issuer's date, because "read on" is a claim about us and is always true.
   */
  fetchedAt: string | null;
}

/** A publisher for this jurisdiction, and why it is quiet if it is. */
export interface HouseIndexSource {
  key: string;
  sourceClass: string;
  issuer: string;
  cadence: string | null;
  withheld: { reason: string; measuredOn: string } | null;
  /**
   * Present only on a source whose rows get their own labelled box — today the
   * produce index (ADR 0117 Q24, the founder's *"show it, labelled as produce,
   * in its own box"*). Absent means the rows draw as drinks postings.
   */
  display: { category: string; shortIssuer: string; extent: string } | null;
  rows: number | null;
}

export interface HouseIndexVM {
  state: 'loading' | 'unreadable' | 'ready';
  failure: FailureVM | null;
  /** The normalised ISO jurisdiction, or null when none could be resolved. */
  jurisdiction: string | null;
  /** What the caller asked for — the house's own free-text state. */
  requested: string | null;
  lines: HouseIndexLine[];
  sources: HouseIndexSource[];
  /** The endpoint's own sentence for a silent register. Never paraphrased. */
  silence: string | null;
}

const LOADING: HouseIndexVM = {
  state: 'loading',
  failure: null,
  jurisdiction: null,
  requested: null,
  lines: [],
  sources: [],
  silence: null,
};

/** A posted list changes on a monthly-to-weekly cadence; five minutes is ample. */
export const INDEX_POLL_MS = 300_000;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function lineOf(raw: Record<string, unknown>): HouseIndexLine {
  return {
    id: String(raw.id ?? ''),
    sourceKey: str(raw.sourceKey) ?? '',
    sourceClass: str(raw.sourceClass) ?? 'unstated',
    issuer: str(raw.issuer) ?? 'Issuer not named on the line',
    issuedAt: str(raw.issuedAt),
    issuedAtBasis: str(raw.issuedAtBasis),
    priceBasis: str(raw.priceBasis),
    productName: str(raw.productName) ?? 'Unnamed product',
    brand: str(raw.brand),
    region: str(raw.region),
    price: num(raw.price),
    currency: str(raw.currency) ?? 'USD',
    priceUnit: str(raw.priceUnit),
    sizeValue: num(raw.sizeValue),
    sizeUnit: str(raw.sizeUnit),
    packageDesc: str(raw.packageDesc),
    sourceUrl: str(raw.sourceUrl),
    fetchedAt: str(raw.fetchedAt),
  };
}

function sourceOf(raw: Record<string, unknown>): HouseIndexSource {
  const w = (raw.withheld ?? null) as Record<string, unknown> | null;
  const d = (raw.display ?? null) as Record<string, unknown> | null;
  return {
    key: String(raw.key ?? ''),
    sourceClass: str(raw.sourceClass) ?? 'unstated',
    issuer: str(raw.issuer) ?? 'Issuer not named',
    cadence: str(raw.cadence),
    display: d
      ? {
          category: str(d.category) ?? 'Public index',
          shortIssuer: str(d.shortIssuer) ?? 'Issuer not named',
          extent: str(d.extent) ?? '',
        }
      : null,
    withheld: w
      ? {
          reason: str(w.reason) ?? 'no reason recorded',
          measuredOn: str(w.measuredOn) ?? '',
        }
      : null,
    rows: num(raw.rows),
  };
}

export function useHouseIndex(): HouseIndexVM & { refresh: () => void } {
  const { activeRestaurantId } = useAuth();
  const [vm, setVm] = useState<HouseIndexVM>(LOADING);
  const tenant = useRef<string | null>(activeRestaurantId);

  useEffect(() => {
    tenant.current = activeRestaurantId;
    setVm(LOADING);
  }, [activeRestaurantId]);

  const read = useCallback(async () => {
    if (!activeRestaurantId) return;
    const forTenant = activeRestaurantId;
    try {
      // 'me' resolves the house's own jurisdiction server-side.
      const res = await apiClient.get('/price-index/me');
      if (tenant.current !== forTenant) return;
      const d = (res.data ?? {}) as Record<string, unknown>;
      setVm({
        state: 'ready',
        failure: null,
        jurisdiction: str(d.state),
        requested: str(d.requested),
        lines: Array.isArray(d.lines)
          ? (d.lines as Array<Record<string, unknown>>).map(lineOf)
          : [],
        sources: Array.isArray(d.sources)
          ? (d.sources as Array<Record<string, unknown>>).map(sourceOf)
          : [],
        silence: str(d.silence),
      });
    } catch (err) {
      if (tenant.current !== forTenant) return;
      // A refused or broken read is NOT "this state posts nothing".
      setVm({ ...LOADING, state: 'unreadable', failure: failureOf(err) });
    }
  }, [activeRestaurantId]);

  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), INDEX_POLL_MS);
    return () => clearInterval(id);
  }, [read]);

  return { ...vm, refresh: () => void read() };
}
