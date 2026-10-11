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
import { houseToday } from './houseCalendar';

const reads = new Map<string, Promise<string | null>>();
/** The zones already read, for a formatter that cannot wait on a promise. */
const known = new Map<string, string | null>();

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
      (res) => {
        const zone = typeof res?.timezone === 'string' && res.timezone ? res.timezone : null;
        known.set(restaurantId, zone);
        return zone;
      },
      () => {
        reads.delete(restaurantId);
        return null;
      },
    );
    reads.set(restaurantId, read);
  }
  return read;
}

/**
 * The active house's zone if it has already been read, else `null` (the
 * device's clock stands in). For formatters that print a stamp in the house's
 * hand (F-1123); a page that holds `useHouseZone()` re-renders when it lands.
 */
export function knownHouseZone(): string | null {
  return known.get(activeHouseId()) ?? null;
}

/** Mounted `useHouseZone` callers, told when a remembered zone is dropped. */
const listeners = new Set<() => void>();

/**
 * Forget the remembered zone of one house, or of every house, and have every
 * mounted reader read it again. Called when a zone is recorded (F-995) and at
 * a house switch; without it a page kept the old zone until a full reload.
 */
export function forgetHouseZones(restaurantId?: string): void {
  if (restaurantId) {
    reads.delete(restaurantId);
    known.delete(restaurantId);
  } else {
    reads.clear();
    known.clear();
  }
  for (const told of [...listeners]) told();
}

/**
 * The active house's IANA zone. `undefined` while it is being read; `null`
 * when there is none to use (the device's clock stands in).
 */
export function useHouseZone(): string | null | undefined {
  const rid = activeHouseId();
  const [said, setSaid] = useState<{ rid: string; zone: string | null } | undefined>(undefined);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const told = () => setEpoch((n) => n + 1);
    listeners.add(told);
    return () => {
      listeners.delete(told);
    };
  }, []);
  useEffect(() => {
    if (!rid) return;
    let live = true;
    void readHouseZone(rid).then((zone) => {
      if (live) setSaid({ rid, zone });
    });
    return () => {
      live = false;
    };
  }, [rid, epoch]);
  if (!rid) return null;
  return said && said.rid === rid ? said.zone : undefined;
}

/** The house's calendar day at `now` — kept with the rest of the house calendar. */
export { houseToday };

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
