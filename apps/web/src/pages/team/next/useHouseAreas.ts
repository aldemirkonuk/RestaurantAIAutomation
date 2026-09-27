/**
 * Areas and Away for `/team` (ADR 0218). Both reads are keyed by the tenant,
 * for the reason `useTeamNextData` states: the branch switcher re-issues the
 * token without clearing the query cache, and an unkeyed bucket would serve
 * the previous house's areas after a switch.
 *
 * `null` while a read is outstanding or after it failed; `failed` says which.
 * An unreadable Away file is never shown as "nobody is away".
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAreas, getAway, type AreasReadout, type AwayReadout, type AwayView } from '../../../services/api/areas';
import { useActiveRestaurantId } from './useTeamNextData';

export const areasKey = (rid: string | null) => ['house-areas', rid] as const;
export const awayKey = (rid: string | null) => ['house-away', rid] as const;

export interface HouseAreasData {
  areas: AreasReadout | null;
  areasFailed: boolean;
  away: AwayReadout | null;
  awayFailed: boolean;
  /** userId → their current or next window. */
  awayByUser: Map<string, AwayView>;
}

export function useHouseAreas(): HouseAreasData {
  const rid = useActiveRestaurantId();
  const areasQ = useQuery({ queryKey: areasKey(rid), queryFn: getAreas, enabled: !!rid });
  const awayQ = useQuery({ queryKey: awayKey(rid), queryFn: getAway, enabled: !!rid });
  const awayByUser = useMemo(() => {
    const m = new Map<string, AwayView>();
    for (const w of awayQ.data?.windows ?? []) m.set(w.userId, w);
    return m;
  }, [awayQ.data]);
  return {
    areas: areasQ.data ?? null,
    areasFailed: areasQ.isError,
    away: awayQ.data ?? null,
    awayFailed: awayQ.isError,
    awayByUser,
  };
}
