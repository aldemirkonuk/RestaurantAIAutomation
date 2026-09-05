/**
 * The commodity index-series register for THIS house.
 *
 * The founder's call, 2026-09-05, verbatim: *"Both: the line now, the alert
 * behind a flag"*. This is the line. It is a CONTEXT LINE and never a claim:
 * it says what a published series last printed, who published it, for which
 * period, on which base and in which unit, and — where a person has asserted
 * one — which of this house's items they mapped to it. It does not say a price
 * will rise. It is never compared with a vendor quote, and it is never averaged
 * with one.
 *
 * WHAT THIS READS. `GET /commodity-index/me`
 * (`apps/api-gateway/src/commodity/commodity.controller.ts`) resolves the
 * caller's jurisdiction server-side using the SAME normaliser
 * `/price-index/me` uses, and returns the series that speak for it — plus the
 * world series, which speaks for every house including one whose address the
 * register cannot place.
 *
 * WHY IT IS A SECOND HOOK AND NOT A SECOND PANEL. The founder's batch-37 call
 * was *"a seperate table for index series"*, and it is a separate table for
 * five measured reasons (an index number is not a price, has no currency, has
 * a 26-character unit, names a commodity class rather than a product, and can
 * be world-scoped). So it is its own endpoint. But it is the SAME KIND of thing
 * a reader is looking at — a published reference, not a quote — so it draws
 * inside the labelled index box rather than in a third box of its own.
 *
 * THE ONE THING THAT MUST NEVER RENDER ALIKE. `latest === null` is not "the
 * index is flat". It means this register holds no observation, and the endpoint
 * sends its own sentence in `note` saying which of the four reasons applies:
 * the register could not be read, the series has no observation yet, the series
 * may not be fetched at all (the USDA 403), or the mapping could not be read.
 * The panel prints those words and never an empty row.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { apiClient } from '@/services/api/client';
import { FailureVM, failureOf } from './useNotificationsNextData';
import { num } from './nt-format';

/** The newest observation a series published, exactly as the register holds it. */
export interface CommodityObservation {
  periodStart: string;
  periodGrain: string;
  value: number;
  issuedAt: string;
  /**
   * ADR 0117 Q27. `issuer_stated` is a date the publisher printed;
   * `fetch_date` is the day we read the file because nobody published one.
   * Only the first may be rendered as "issued" — and this is not hypothetical:
   * the FAO CSV states no date of any kind, and ONS states two.
   */
  issuedAtBasis: string;
  fetchedAt: string;
  vintage: string | null;
}

/**
 * The per-bottle duty this rate implies for one exposed item, or the named
 * reason there is none.
 *
 * Never a bare null: "no duty is shown" has several causes and a person can act
 * on most of them — nobody has stated this bottle's strength, nobody has stated
 * its size, it is registered in two sizes — while one of them (the publisher
 * never said what its rate is per) no amount of typing fixes.
 */
export type CommodityDuty =
  | { derived: true; amount: number; currency: string; basis: string }
  | { derived: false; reason: string; detail: string };

/** One house item a PERSON mapped to this series. Never inferred. */
export interface CommodityExposure {
  id: string;
  houseItemId: string;
  /** Present only on a RATE series. */
  duty: CommodityDuty | null;
  /** Null with basis `unset` is the common case, and it is said out loud. */
  passThrough: number | null;
  passThroughBasis: string;
  lagDays: number | null;
  lagBasis: string;
  note: string | null;
}

export interface CommoditySeriesVM {
  seriesKey: string;
  issuer: string;
  issuerJurisdiction: string;
  seriesTitle: string;
  sourceUrl: string;
  valueKind: string;
  unit: string;
  basePeriod: string | null;
  currency: string | null;
  priceBasis: string | null;
  cadence: string;
  licence: string;
  attribution: string | null;
  redistribution: string;
  admission: string;
  /**
   * TRUE when this series' only route in is a person's own download and that
   * download has not happened. The parser exists and has never seen real bytes,
   * so the panel must never draw it as working (the founder's Q1 answer,
   * 2026-09-05: a one-off human read, logged).
   */
  awaitingHumanDownload: boolean;
  /** A rate's instrument, in the issuer's own citation. Null for anything else. */
  statute: string | null;
  /** The date the issuer says a rate is in force from. */
  effectiveFrom: string | null;
  /**
   * For a rate: whether a per-bottle duty line can EVER be derived from it, and
   * the sentence saying why or why not. "This product cannot yet show you a
   * duty for your bottle" and "this publisher does not say what its number is
   * per" are different facts, and only the first is fixable by typing anything.
   */
  duty: { supported: boolean; sentence: string } | null;
  armed: boolean;
  /** Who armed it, when, and on which numbers. Null on an unarmed series. */
  armedBy: { label: string; at: string; proposalHash: string } | null;
  withheld: { reason: string; measuredOn: string } | null;
  silent: { reason: string; measuredOn: string } | null;
  latest: CommodityObservation | null;
  stale: boolean | null;
  staleReason: string | null;
  observationCount: number | null;
  exposures: CommodityExposure[];
  note: string | null;
}

export interface HouseCommodityVM {
  state: 'loading' | 'unreadable' | 'ready';
  failure: FailureVM | null;
  jurisdiction: string | null;
  requested: string | null;
  series: CommoditySeriesVM[];
  /** Whether a scheduled reader is armed at all. Off by default and by design. */
  fetchArmed: boolean;
  /** The endpoint's own sentence when nothing speaks for this house. */
  silence: string | null;
  /** True when no series has a mapping. The panel then shows the list + a sentence. */
  noExposureRecorded: boolean;
}

const LOADING: HouseCommodityVM = {
  state: 'loading',
  failure: null,
  jurisdiction: null,
  requested: null,
  series: [],
  fetchArmed: false,
  silence: null,
  noExposureRecorded: false,
};

/** A monthly index moves once a month. Five minutes is more than ample. */
export const COMMODITY_POLL_MS = 300_000;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function pairOf(raw: unknown): { reason: string; measuredOn: string } | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r) return null;
  return {
    reason: str(r.reason) ?? 'no reason recorded',
    measuredOn: str(r.measuredOn) ?? '',
  };
}

/**
 * Read one duty outcome off the wire.
 *
 * A payload that is neither derived-with-a-number nor refused-with-a-reason
 * becomes `null` — drawn as nothing — rather than a zero. A duty of 0 IS a real
 * answer (a de-alcoholised product on HMRC's 0-1.2% band), so it must arrive as
 * `derived: true, amount: 0` and never as an absence.
 */
function dutyOf(raw: unknown): CommodityDuty | null {
  const d = (raw ?? null) as Record<string, unknown> | null;
  if (!d) return null;
  if (d.derived === true) {
    const amount = num(d.amount);
    const currency = str(d.currency);
    if (amount === null || !currency) return null;
    return { derived: true, amount, currency, basis: str(d.basis) ?? '' };
  }
  if (d.derived === false) {
    return {
      derived: false,
      reason: str(d.reason) ?? 'unstated',
      detail: str(d.detail) ?? 'No duty is shown and no reason was given.',
    };
  }
  return null;
}

function observationOf(raw: unknown): CommodityObservation | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r) return null;
  const value = num(r.value);
  if (value === null) return null;
  return {
    periodStart: str(r.periodStart) ?? '',
    periodGrain: str(r.periodGrain) ?? 'month',
    value,
    issuedAt: str(r.issuedAt) ?? '',
    issuedAtBasis: str(r.issuedAtBasis) ?? 'fetch_date',
    fetchedAt: str(r.fetchedAt) ?? '',
    vintage: str(r.vintage),
  };
}

function seriesOf(raw: Record<string, unknown>): CommoditySeriesVM {
  return {
    seriesKey: str(raw.seriesKey) ?? '',
    issuer: str(raw.issuer) ?? 'Issuer not named on the series',
    issuerJurisdiction: str(raw.issuerJurisdiction) ?? '',
    seriesTitle: str(raw.seriesTitle) ?? 'Untitled series',
    sourceUrl: str(raw.sourceUrl) ?? '',
    valueKind: str(raw.valueKind) ?? 'index_number',
    unit: str(raw.unit) ?? '',
    basePeriod: str(raw.basePeriod),
    currency: str(raw.currency),
    priceBasis: str(raw.priceBasis),
    cadence: str(raw.cadence) ?? '',
    licence: str(raw.licence) ?? 'unstated',
    attribution: str(raw.attribution),
    redistribution: str(raw.redistribution) ?? 'unstated',
    admission: str(raw.admission) ?? 'fetch',
    awaitingHumanDownload: raw.awaitingHumanDownload === true,
    statute: str(raw.statute),
    effectiveFrom: str(raw.effectiveFrom),
    duty:
      raw.duty && typeof raw.duty === 'object'
        ? {
            supported: (raw.duty as Record<string, unknown>).supported === true,
            sentence: str((raw.duty as Record<string, unknown>).sentence) ?? '',
          }
        : null,
    armed: raw.armed === true,
    armedBy:
      raw.armedBy && typeof raw.armedBy === 'object'
        ? {
            label: str((raw.armedBy as Record<string, unknown>).label) ?? 'not named',
            at: str((raw.armedBy as Record<string, unknown>).at) ?? '',
            proposalHash:
              str((raw.armedBy as Record<string, unknown>).proposalHash) ?? '',
          }
        : null,
    withheld: pairOf(raw.withheld),
    silent: pairOf(raw.silent),
    latest: observationOf(raw.latest),
    // `null` is UNKNOWN and renders as neither fresh nor stale. Coercing it to
    // false would say "this is current" about a series nobody has read.
    stale: typeof raw.stale === 'boolean' ? raw.stale : null,
    staleReason: str(raw.staleReason),
    observationCount:
      typeof raw.observationCount === 'number' ? raw.observationCount : null,
    exposures: Array.isArray(raw.exposures)
      ? (raw.exposures as Array<Record<string, unknown>>).map((e) => ({
          id: String(e.id ?? ''),
          houseItemId: String(e.houseItemId ?? ''),
          duty: dutyOf(e.duty),
          passThrough: num(e.passThrough),
          passThroughBasis: str(e.passThroughBasis) ?? 'unset',
          lagDays: num(e.lagDays),
          lagBasis: str(e.lagBasis) ?? 'unset',
          note: str(e.note),
        }))
      : [],
    note: str(raw.note),
  };
}

export function useHouseCommodity(): HouseCommodityVM & { refresh: () => void } {
  const { activeRestaurantId } = useAuth();
  const [vm, setVm] = useState<HouseCommodityVM>(LOADING);
  const tenant = useRef<string | null>(activeRestaurantId);

  useEffect(() => {
    tenant.current = activeRestaurantId;
    setVm(LOADING);
  }, [activeRestaurantId]);

  const read = useCallback(async () => {
    if (!activeRestaurantId) return;
    const forTenant = activeRestaurantId;
    try {
      const res = await apiClient.get('/commodity-index/me');
      if (tenant.current !== forTenant) return;
      const d = (res.data ?? {}) as Record<string, unknown>;
      setVm({
        state: 'ready',
        failure: null,
        jurisdiction: str(d.jurisdiction),
        requested: str(d.requested),
        series: Array.isArray(d.series)
          ? (d.series as Array<Record<string, unknown>>).map(seriesOf)
          : [],
        fetchArmed: d.fetchArmed === true,
        silence: str(d.silence),
        noExposureRecorded: d.noExposureRecorded === true,
      });
    } catch (err) {
      if (tenant.current !== forTenant) return;
      // A refused or broken read is NOT "no series speaks for this house".
      setVm({ ...LOADING, state: 'unreadable', failure: failureOf(err) });
    }
  }, [activeRestaurantId]);

  useEffect(() => {
    void read();
    const id = setInterval(() => void read(), COMMODITY_POLL_MS);
    return () => clearInterval(id);
  }, [read]);

  return { ...vm, refresh: () => void read() };
}
