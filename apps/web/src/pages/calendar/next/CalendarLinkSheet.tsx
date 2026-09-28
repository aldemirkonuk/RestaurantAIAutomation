/**
 * Connect my calendar — one person's own calendar link (ADR 0111, review trail
 * 2026-09-21).
 *
 * The founder, 2026-09-21: "every manager, staff and their labeled
 * taskforces/areas, owners have different calendar subscriptions, they can
 * connect their own." And on a stopped link: "an empty calendar with a little
 * text appeared, and saying calendar link expired, connect again".
 *
 * Written for the person, not the operator: what the link shows, one button
 * to connect, the address once with a copy button, and plain words for what
 * "get a new link" and "stop" do to the phone that already has it. Everyone
 * may narrow their own link by category, and a pick only ever shows less
 * (round 6t: "Everyone can narrow"). Owners and managers also see who has
 * connected and can stop a link — only that person's stops — but a manager
 * never an owner's (round 6t: "No, owners only"): the row says so instead of
 * offering the button. The address is shown once, and the sheet says so in
 * the words every surface uses (round 6t: "Show once").
 *
 * The state comes from `useMyCalendarLink`, which the page holds, so opening
 * this sheet reads nothing new about the caller and never makes a link.
 */

import { useEffect, useMemo, useState } from 'react';
import { Sheet } from '@/components/mudavym';
import type { MyCalendarLinkState } from '@/components/calendar-link/useMyCalendarLink';
import { NARROW_ONLY, ON_LEAVING, SHOWN_ONCE } from '@/components/calendar-link/calendar-link-copy';
import { getErrorMessage } from '../../../services/api/client';
import {
  CALENDAR_LINK_CATEGORIES,
  listHouseCalendarLinks,
  stopCalendarLinkFor,
  type CalendarLinkCategory,
  type HouseCalendarLink,
} from '../../../services/api/calendar';

function day(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function lastRead(iso: string | null): string {
  return iso ? `last read by a calendar app on ${day(iso)}` : 'no calendar app has read it yet';
}

type Confirming = null | 'renew' | 'stop' | { person: string };

export default function CalendarLinkSheet({
  state,
  onClose,
}: {
  state: MyCalendarLinkState;
  onClose: () => void;
}) {
  const { link, loading, readError, justIssued, alreadyMade, busy, actError } = state;
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const manages = link?.role === 'owner' || link?.role === 'manager';

  /* ── the person's own pick (narrows only) ───────────────────────────── */
  const savedPick = useMemo(() => link?.categories ?? null, [link?.categories]);
  const [pick, setPick] = useState<CalendarLinkCategory[] | null>(savedPick);
  useEffect(() => setPick(savedPick), [savedPick]);
  const pickChanged = JSON.stringify(pick) !== JSON.stringify(savedPick);

  /* ── who has connected (owners and managers) ────────────────────────── */
  const [people, setPeople] = useState<HouseCalendarLink[] | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [stopping, setStopping] = useState<string | null>(null);
  const [peopleTick, setPeopleTick] = useState(0);
  useEffect(() => {
    if (!manages) return;
    let live = true;
    setPeopleError(null);
    listHouseCalendarLinks()
      .then((rows) => live && setPeople(rows))
      .catch((e) => {
        if (!live) return;
        setPeople(null);
        setPeopleError(getErrorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [manages, link?.connected, peopleTick]);

  const stopFor = async (userId: string) => {
    setStopping(userId);
    setPeopleError(null);
    try {
      await stopCalendarLinkFor(userId);
      setConfirming(null);
      setPeopleTick((t) => t + 1);
      state.reload();
    } catch (e) {
      setPeopleError(getErrorMessage(e));
    } finally {
      setStopping(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied. Paste it into your calendar app.');
    } catch {
      setCopied('This browser would not copy it. Select the link above and copy it by hand.');
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      label="Connect my calendar. This makes a link only you use, and shows it once. Closing writes nothing."
      eyebrow="Your calendar"
      title="Connect my calendar"
    >
      <div className="cn-form">
        {loading && <p className="cn-quiet">Reading your calendar link…</p>}

        {readError && (
          <div role="alert" className="cn-notice">
            <span>Your calendar link could not be read — {readError}. Nothing was changed.</span>
            <button type="button" className="cn-btn cn-ink" onClick={state.reload}>
              Try again
            </button>
          </div>
        )}

        {link && (
          <>
            {link.houseLinkRetired && !link.connected && (
              <p role="status" className="cn-notice">
                The shared calendar link for this house was switched off. Everyone now connects
                their own. Anyone still using the old one sees “Calendar link expired - connect
                again”. Connect yours below.
              </p>
            )}

            <p style={{ fontSize: 13.5, lineHeight: 1.55, margin: '0 0 12px' }}>{link.scope}</p>
            <p className="cn-quiet">Your link is yours alone. {ON_LEAVING}</p>

            {!link.connected && (
              <div className="cn-actions">
                <button
                  type="button"
                  className="cn-btn cn-ink"
                  data-primary="true"
                  disabled={busy !== null}
                  onClick={() => void state.connect()}
                >
                  {busy === 'connect' ? 'Connecting…' : 'Connect my calendar'}
                </button>
              </div>
            )}

            {justIssued && (
              <section aria-label="Your calendar link" style={{ marginTop: 16 }}>
                <p className="cn-label">Your link</p>
                <p className="cn-quiet">Copy it now. {SHOWN_ONCE}</p>
                <p data-secret="credential" className="cn-address">
                  {justIssued.address}
                </p>
                <div className="cn-row" style={{ marginTop: 8 }}>
                  <button type="button" className="cn-btn cn-ink" onClick={() => void copy(justIssued.address)}>
                    Copy link
                  </button>
                  {justIssued.webcal && (
                    <a className="cn-btn cn-ink" href={justIssued.webcal}>
                      Open in my calendar app
                    </a>
                  )}
                </div>
                {copied && (
                  <p role="status" className="cn-quiet" style={{ marginTop: 6 }}>
                    {copied}
                  </p>
                )}
                <ul className="cn-quiet" style={{ paddingLeft: 18, marginTop: 10 }}>
                  <li>iPhone or Mac: tap “Open in my calendar app”, then Subscribe.</li>
                  <li>Google Calendar: Other calendars, then From URL, then paste the link.</li>
                  <li>Outlook: Add calendar, then Subscribe from web, then paste the link.</li>
                </ul>
              </section>
            )}

            {alreadyMade && !justIssued && (
              <p role="status" className="cn-notice">
                You already had a link, made in another window. It cannot be shown again. Get a
                new link to see one.
              </p>
            )}

            {link.connected && (
              <section aria-label="Your link" style={{ marginTop: 16 }}>
                <p className="cn-quiet">
                  Connected on {day(link.createdAt)}, {lastRead(link.lastFetchedAt)}.
                </p>
                {!justIssued && <p className="cn-quiet">{SHOWN_ONCE}</p>}

                {confirming === 'renew' ? (
                  <div className="cn-notice" role="group" aria-label="Confirm a new link">
                    <span>
                      Your current link stops. Any calendar using it shows “Calendar link expired -
                      connect again” until you add the new one.
                    </span>
                    <span className="cn-row">
                      <button
                        type="button"
                        className="cn-btn cn-ink"
                        data-primary="true"
                        disabled={busy !== null}
                        onClick={() => {
                          setConfirming(null);
                          void state.renew();
                        }}
                      >
                        Yes, make a new link
                      </button>
                      <button type="button" className="cn-btn cn-ink" onClick={() => setConfirming(null)}>
                        Keep my link
                      </button>
                    </span>
                  </div>
                ) : confirming === 'stop' ? (
                  <div className="cn-notice" role="group" aria-label="Confirm stopping your link">
                    <span>
                      Your calendar app will show “Calendar link expired - connect again”. You can
                      connect again any time.
                    </span>
                    <span className="cn-row">
                      <button
                        type="button"
                        className="cn-btn cn-ink"
                        disabled={busy !== null}
                        onClick={() => {
                          setConfirming(null);
                          void state.stop();
                        }}
                      >
                        Yes, stop my link
                      </button>
                      <button type="button" className="cn-btn cn-ink" onClick={() => setConfirming(null)}>
                        Keep it
                      </button>
                    </span>
                  </div>
                ) : (
                  <div className="cn-row">
                    <button
                      type="button"
                      className="cn-btn cn-ink"
                      disabled={busy !== null}
                      onClick={() => setConfirming('renew')}
                    >
                      {busy === 'renew' ? 'Making a new link…' : 'Get a new link'}
                    </button>
                    <button
                      type="button"
                      className="cn-btn cn-ink"
                      disabled={busy !== null}
                      onClick={() => setConfirming('stop')}
                    >
                      {busy === 'stop' ? 'Stopping…' : 'Stop my link'}
                    </button>
                  </div>
                )}
              </section>
            )}

            {link.connected && link.canPickCategories && (
              <section aria-label="What my link shows" style={{ marginTop: 20 }}>
                <p className="cn-label">What my link shows</p>
                <div className="cn-chiprow" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="cn-chip"
                    aria-pressed={pick === null}
                    onClick={() => setPick(null)}
                  >
                    Everything
                  </button>
                  {CALENDAR_LINK_CATEGORIES.map((c) => {
                    const on = pick !== null && pick.includes(c.key);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className="cn-chip"
                        aria-pressed={on}
                        onClick={() =>
                          setPick((p) => {
                            const cur = p ?? [];
                            return on ? cur.filter((k) => k !== c.key) : [...cur, c.key];
                          })
                        }
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="cn-btn cn-ink"
                  disabled={!pickChanged || busy !== null}
                  onClick={() => void state.pick(pick)}
                >
                  {busy === 'pick' ? 'Saving…' : 'Save what my link shows'}
                </button>
                <p className="cn-quiet" style={{ marginTop: 6 }}>
                  {NARROW_ONLY} Your link stays the same; your calendar app picks up the change
                  within the hour.
                </p>
              </section>
            )}

            {actError && (
              <p role="alert" className="cn-notice">
                That did not work — {actError}
              </p>
            )}

            {manages && (
              <section aria-label="Who has connected" style={{ marginTop: 24 }}>
                <p className="cn-label">Who has connected</p>
                {peopleError && (
                  <p role="alert" className="cn-notice">
                    The list could not be read — {peopleError}
                  </p>
                )}
                {people === null && !peopleError && <p className="cn-quiet">Reading…</p>}
                {people !== null && people.length === 0 && (
                  <p className="cn-quiet">Nobody in this house has connected a calendar yet.</p>
                )}
                {people !== null && people.length > 0 && (
                  <ul className="cn-people">
                    {people.map((p) => (
                      <li key={p.userId}>
                        <span>
                          <strong>{p.name ?? 'A member of this house'}</strong>
                          <span className="cn-meta">
                            {p.role === null ? ' · no longer in this house' : ''} · since{' '}
                            {day(p.createdAt)}, {lastRead(p.lastFetchedAt)}
                          </span>
                        </span>
                        {!p.canStop ? (
                          <span className="cn-meta">Only an owner can stop an owner’s link.</span>
                        ) : typeof confirming === 'object' && confirming?.person === p.userId ? (
                          <span className="cn-row">
                            <button
                              type="button"
                              className="cn-btn cn-ink"
                              disabled={stopping !== null}
                              onClick={() => void stopFor(p.userId)}
                            >
                              {stopping === p.userId ? 'Stopping…' : 'Yes, stop it'}
                            </button>
                            <button type="button" className="cn-btn cn-ink" onClick={() => setConfirming(null)}>
                              Keep it
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="cn-btn cn-ink"
                            aria-label={`Stop ${p.name ?? 'this person'}'s calendar link`}
                            disabled={stopping !== null}
                            onClick={() => setConfirming({ person: p.userId })}
                          >
                            Stop
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="cn-quiet" style={{ marginTop: 6 }}>
                  Stopping someone’s link stops only theirs. Their calendar shows “Calendar link
                  expired - connect again”, and they can connect again.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
