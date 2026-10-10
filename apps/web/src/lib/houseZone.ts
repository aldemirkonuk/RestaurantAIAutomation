/**
 * F-571 (2026-10-09): the house's time zone, read once per house, so a page's
 * "today", "this week" and default new-entry day are the HOUSE's day — the
 * same day the gateway files figures under (ADR 0290) — and not whatever the
 * viewer's device clock says. A Los Angeles house opened from Istanbul after
 * 14:00 would otherwise open tomorrow on /calendar and /team.
 *
 * The zone comes from `GET /restaurants/:id/operating-hours`, which any member
 * may read and which already carries `restaurants.timezone`. One read per
 * house per page load; every caller shares it.
 *
 * With no zone set, no house picked, or a failed read, the device's clock
 * stands in — what these pages did before — and a failed read is retried on
 * the next mount rather than remembered.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { restaurantsApi } from '@/services/api/restaurants';

const reads = new Map<string, Promise<string | null>>();

/** The picked house — the key `services/api/client`'s `getActiveRestaurantId` reads. */
function activeHouseId(): string {
  try {
    return localStorage.getItem('activeRestaurantId') || '';
  } catch {
    return '';
  }
}

export function readHouseZone(restaurantId: string): Promise<string | null> {
  let read = reads.get(restaurantId);
  if (!read) {
    read = restaurantsApi.getOperatingHours(restaurantId).then(
      (res) => (typeof res?.timezone === 'string' && res.timezone ? res.timezone : null),
      () => {
        reads.delete(restaurantId);
        return null;
      },
    );
    reads.set(restaurantId, read);
  }
  return read;
}

/** Test seam: forget every remembered read. */
export function forgetHouseZones(): void {
  reads.clear();
}

/**
 * The active house's IANA zone. `undefined` while it is being read; `null`
 * when there is none to use (the device's clock stands in).
 */
export function useHouseZone(): string | null | undefined {
  const rid = activeHouseId();
  const [said, setSaid] = useState<{ rid: string; zone: string | null } | undefined>(undefined);
  useEffect(() => {
    if (!rid) return;
    let live = true;
    void readHouseZone(rid).then((zone) => {
      if (live) setSaid({ rid, zone });
    });
    return () => {
      live = false;
    };
  }, [rid]);
  if (!rid) return null;
  return said && said.rid === rid ? said.zone : undefined;
}

/**
 * The house's calendar day at `now`, as a LOCAL-midnight Date — so the pages'
 * existing local-getter helpers (`dayKey`, `mondayOf`, `getDate`) read the
 * house's day off it unchanged. No zone (or one this browser cannot read)
 * gives the device's day.
 */
export function houseToday(zone: string | null | undefined, now: Date = new Date()): Date {
  if (zone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now);
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const y = get('year');
      const m = get('month');
      const d = get('day');
      if (y && m && d) return new Date(y, m - 1, d);
    } catch {
      /* a zone name this browser cannot read: the device's day stands in */
    }
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * A page opens on the device's day while the zone is read. Once it is known,
 * an anchor still on the device's day (say "this week" = its Monday) moves to
 * the house's; one the person already moved is left where they put it.
 */
export function useSettleOnHouseDay(
  zone: string | null | undefined,
  anchorOf: (day: Date) => string,
  setAnchor: Dispatch<SetStateAction<string>>,
): void {
  const known = zone !== undefined;
  useEffect(() => {
    if (!known) return;
    const device = anchorOf(new Date());
    const house = anchorOf(houseToday(zone));
    setAnchor((current) => (current === device ? house : current));
    // once, when the zone becomes known
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known]);
}
