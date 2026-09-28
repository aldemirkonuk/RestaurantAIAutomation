/**
 * Poll the counter — the bell's staircase, step one: 60 s and on window focus
 * (`useBellBook.ts` `BELL_POLL_MS`; the founder's cadence of 2026-09-04), plus
 * a read when the device comes back online.
 *
 * WHAT A FAILURE LEAVES ON SCREEN
 * -------------------------------
 * The last answer, DATED, and the failure named beside it — never an empty
 * counter. A read that fails after one that landed does not turn seven
 * answered registers into zero; it says "from 14:01:48" and "not read at
 * 14:02:50". A first read that fails leaves no registers at all and says so.
 *
 * WHAT OFFLINE LEAVES ON SCREEN
 * -----------------------------
 * The counter freezes and dates itself, and no read is attempted until the
 * device says it is online again — a promise of "again in 60 s" from a device
 * that cannot reach the house would be a cadence claim with nothing behind it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { readHouseCounter } from '../../services/api/houseCounter';
import type { HouseCounterRead } from './counterRead';
import { houseSaid } from './houseSaid';

export const COUNTER_POLL_MS = 60_000;

export interface CounterFailure {
  at: string;
  status: number | null;
  sentence: string;
}

export interface HouseCounterState {
  /** The last answer that landed, or null before the first. */
  last: HouseCounterRead | null;
  /** A read is in flight. */
  reading: boolean;
  /** The most recent read failed; cleared by the next that lands. */
  failure: CounterFailure | null;
  /** The device reports no network; reads are held until it returns. */
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

/**
 * `houseKey` resets the counter when the house changes: one house's registers
 * must never render under another's name while the new read is in flight.
 */
export function useHouseCounter(houseKey: string | null, enabled = true): HouseCounterState {
  const [last, setLast] = useState<HouseCounterRead | null>(null);
  const [reading, setReading] = useState(false);
  const [failure, setFailure] = useState<CounterFailure | null>(null);
  const [offline, setOffline] = useState(!isOnline());
  const alive = useRef(true);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const failedBefore = useRef(false);

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
      const answer = await readHouseCounter();
      if (!alive.current || gen !== generation.current) return;
      setLast(answer);
      setFailure(null);
      failedBefore.current = false;
    } catch (err) {
      if (!alive.current || gen !== generation.current) return;
      const status = statusOf(err);
      const f: CounterFailure = {
        at: new Date().toISOString(),
        status,
        sentence:
          status === null
            ? 'The counter did not answer.'
            : `The counter could not be read (${status}).`,
      };
      setFailure(f);
      // Once per run of failures, not once a minute: the log is the sitting's
      // record, and a line every poll would bury what the house actually said.
      if (!failedBefore.current) {
        houseSaid('not_read', 'The counter was not read', f.sentence);
        failedBefore.current = true;
      }
    } finally {
      if (gen === generation.current) {
        inFlight.current = false;
        if (alive.current) setReading(false);
      }
    }
  }, [enabled, houseKey]);

  // A new house: forget the old one's answer before the first read lands.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    failedBefore.current = false;
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
    const id = setInterval(() => void read(), COUNTER_POLL_MS);
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
