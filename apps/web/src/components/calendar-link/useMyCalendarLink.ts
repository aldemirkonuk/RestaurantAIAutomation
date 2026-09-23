/**
 * The signed-in person's own calendar link (ADR 0111, review trail 2026-09-21).
 *
 * The founder, 2026-09-21: "Ayse (bar staff) connects HER OWN link to her
 * phone. [...] When Ayse leaves, only her link stops; nobody else
 * re-subscribes."
 *
 * One hook so every surface that offers the link behaves the same way:
 *
 *  - Opening a page READS (`GET /calendar/ical-token`). It never makes a link:
 *    a page view that minted a credential was the defect this lane began with.
 *  - `connect`, `renew`, `stop` and `pick` are the only writers, each on a
 *    click.
 *  - The address comes back once, on the answer to `connect`/`renew`, and is
 *    kept in memory only — never in storage, never re-read. Leaving the page
 *    forgets it; the person gets a new link to see one again.
 *  - A failed read is an error sentence, never "not connected".
 */

import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { getErrorMessage } from '../../services/api/client';
import {
  connectMyCalendar,
  getMyCalendarLink,
  pickMyCalendarCategories,
  renewMyCalendarLink,
  stopMyCalendarLink,
  subscribeAddress,
  type CalendarLinkCategory,
  type IssuedCalendarLink,
  type MyCalendarLink,
} from '../../services/api/calendar';

export type CalendarLinkBusy = 'connect' | 'renew' | 'stop' | 'pick' | null;

export interface MyCalendarLinkState {
  link: MyCalendarLink | null;
  loading: boolean;
  /** The read failed. Never shown as "not connected". */
  readError: string | null;
  /** The address, only in the moment after it was made. */
  justIssued: { address: string; webcal: string | null } | null;
  /** A create that found a link already made (another tab): no address to show. */
  alreadyMade: boolean;
  busy: CalendarLinkBusy;
  /** The last act's refusal or failure, in the gateway's words. */
  actError: string | null;
  connect: (categories?: CalendarLinkCategory[] | null) => Promise<void>;
  renew: () => Promise<void>;
  stop: () => Promise<void>;
  pick: (categories: CalendarLinkCategory[] | null) => Promise<void>;
  reload: () => void;
}

function shown(issued: IssuedCalendarLink | null | undefined) {
  if (!issued) return null;
  const address = subscribeAddress(issued);
  const webcal = issued.webcalUrl ?? address.replace(/^https?:\/\//, 'webcal://');
  return { address, webcal };
}

export function useMyCalendarLink(): MyCalendarLinkState {
  // Read without `useAuth`'s throw: the house only keys the re-read, and a
  // surface rendered outside the provider still reads the caller's link.
  const activeRestaurantId = useContext(AuthContext)?.activeRestaurantId ?? null;
  const [link, setLink] = useState<MyCalendarLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [justIssued, setJustIssued] = useState<MyCalendarLinkState['justIssued']>(null);
  const [alreadyMade, setAlreadyMade] = useState(false);
  const [busy, setBusy] = useState<CalendarLinkBusy>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setReadError(null);
    // A house switch forgets the address shown for the previous house.
    setJustIssued(null);
    setAlreadyMade(false);
    getMyCalendarLink()
      .then((l) => {
        if (live) setLink(l);
      })
      .catch((e) => {
        if (live) {
          setLink(null);
          setReadError(getErrorMessage(e));
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [activeRestaurantId, tick]);

  const act = useCallback(
    async (which: Exclude<CalendarLinkBusy, null>, run: () => Promise<void>) => {
      setBusy(which);
      setActError(null);
      try {
        await run();
      } catch (e) {
        setActError(getErrorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const connect = useCallback(
    (categories?: CalendarLinkCategory[] | null) =>
      act('connect', async () => {
        const next = await connectMyCalendar(categories);
        setLink(next);
        setJustIssued(shown(next.issued));
        setAlreadyMade(!next.issued);
      }),
    [act],
  );

  const renew = useCallback(
    () =>
      act('renew', async () => {
        const next = await renewMyCalendarLink();
        setLink(next);
        setJustIssued(shown(next.issued));
        setAlreadyMade(false);
      }),
    [act],
  );

  const stop = useCallback(
    () =>
      act('stop', async () => {
        await stopMyCalendarLink();
        setJustIssued(null);
        setAlreadyMade(false);
        // The stop happened; say so now, then re-read. A failed re-read is a
        // read error on its own line, never "the stop did not work".
        setLink((l) =>
          l ? { ...l, connected: false, createdAt: null, issuedAt: null, lastFetchedAt: null } : l,
        );
        setTick((t) => t + 1);
      }),
    [act],
  );

  const pick = useCallback(
    (categories: CalendarLinkCategory[] | null) =>
      act('pick', async () => {
        setLink(await pickMyCalendarCategories(categories));
      }),
    [act],
  );

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { link, loading, readError, justIssued, alreadyMade, busy, actError, connect, renew, stop, pick, reload };
}
