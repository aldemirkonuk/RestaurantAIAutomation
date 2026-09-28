/**
 * Poll the day line — mirrors `useHouseCounter.ts`'s cadence and honesty
 * rules exactly (60 s + focus + online; kept as a SEPARATE hook rather than
 * a shared generic, so a change to one polled read can never silently change
 * the other's behaviour — see that file's own doc comment for the two rules
 * this repeats: what a failure leaves on screen, and what offline leaves on
 * screen).
 *
 * WHAT A FAILURE LEAVES ON SCREEN
 * -------------------------------
 * The last answer, DATED, and the failure named beside it — never an empty
 * line. WHAT OFFLINE LEAVES ON SCREEN: the line freezes and dates itself
 * ("will read on return"); no read is attempted until the device says it is
 * online again.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { readHouseDay } from '../../services/api/houseDay';
import type { HouseDayRead } from './dayRead';

export const DAY_POLL_MS = 60_000;

export interface DayFailure {
  at: string;
  status: number | null;
  sentence: string;
}

export interface HouseDayState {
  last: HouseDayRead | null;
  reading: boolean;
  failure: DayFailure | null;
  offline: boolean;
  readNow: () => void;
}

function statusOf(err: unknown): number | null {
  const s = (err as { response?: { status?: unknown } })?.response?.status;
  return typeof s === 'number' ? s : null;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** `houseKey` resets the line when the house changes. */
export function useHouseDay(houseKey: string | null, enabled = true): HouseDayState {
  const [last, setLast] = useState<HouseDayRead | null>(null);
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<DayFailure | null>(null);
  const [offline, setOffline] = useState(!isOnline());
  const alive = useRef(true);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const read = useCallback(async () => {
    if (!enabled || !houseKey) return;
    if (!isOnline()) {
      setOffline(true);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    setReading(true);
    try {
      const answer = await readHouseDay();
      if (!alive.current || gen !== generation.current) return;
      setLast(answer);
      setFailure(null);
    } catch (err) {
      if (!alive.current || gen !== generation.current) return;
      const status = statusOf(err);
      setFailure({
        at: new Date().toISOString(),
        status,
        sentence: status === null ? 'The day line did not answer.' : `The day line could not be read (${status}).`,
      });
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        if (alive.current) setReading(false);
      }
    }
  }, [enabled, houseKey]);

  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setLast(null);
    setFailure(null);
    setReading(false);
  }, [houseKey]);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void read(), DAY_POLL_MS);
    const onFocus = () => void read();
    const onOnline = () => {
      setOffline(false);
      void read();
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, read]);

  const readNow = useCallback(() => void read(), [read]);

  return { last, reading, failure, offline, readNow };
}
