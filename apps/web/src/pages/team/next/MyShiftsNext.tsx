/**
 * My Shifts — the staff half of `/team`, on the Mudavym layer.
 *
 * One person, one week: what I am working, what I can pick up, whether I have
 * told my manager I have seen the published week, and one control to ask for
 * time off. `TeamNext` routes here for anyone who is not an owner or a manager,
 * exactly as `TeamCommandPage.tsx:36-37` always did on the legacy half.
 *
 * THE HONEST STATE THIS PAGE EXISTS TO KEEP. A failed `my-week` fetch used to
 * render seven days of "Off" — a whole week reported as free because the
 * gateway was down (ADR 0089). A day with nothing on it says "Off" ONLY when
 * the week actually answered; otherwise it says the week is not known, and the
 * banner says which of the two happened.
 *
 * PAID OR UNPAID (ADR 0215; founder 2026-09-21, "Take all five"). The person
 * asking may say whether the days are paid leave; whoever approves the request
 * decides, and their word replaces this one. Left to the manager, the request
 * is filed as not yet said.
 *
 * ANY DAYS, AND THE ANSWER (F-191). A request names its own first and last
 * day — one day, a long weekend, three weeks — not the week on screen. The
 * person's own requests are listed with where each stands (the gateway lists
 * only their own to staff), and a decision also reaches them as a notice.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Wordmark } from '@/components/mudavym';
import {
  acknowledgeSchedule,
  assignCover,
  createTimeOff,
  getMyWeek,
  getTimeOff,
  getTeamNotes,
  openTeamNote,
  withdrawTimeOff,
  type LeaveType,
  type MyWeekPayload,
} from '../../../services/api/team';
import { useActiveRestaurantId } from './useTeamNextData';
import { useAuth } from '../../../contexts/AuthContext';
import { houseToday, useHouseZone, useSettleOnHouseDay } from '@/lib/houseZone';
import { AwayCard, HouseAwayCard } from './AwayCard';
import { useHouseAreas } from './useHouseAreas';
import {
  DOW,
  EM,
  addDays,
  dayNum,
  fmtDayShort,
  fmtTime,
  fmtWeekRange,
  houseLocale,
  mondayOf,
  todayIso,
  weekFromLink,
  weekDays,
} from './tm-format';
import { MutationError } from './tm-bits';
import { writeOutcomeUnknown } from '@/lib/draftWriteKey';
import type { TimeOffRow } from './useTeamNextData';
import './team-next.css';

/**
 * The gateway's words when a claim lost to someone else (409): it names who
 * has the shift. Any other failure says nothing about who holds it.
 */
function takenByWords(e: unknown): string | null {
  const r = (e as { response?: { status?: unknown; data?: { message?: unknown } } } | null)?.response;
  if (r?.status !== 409) return null;
  const m = r.data?.message;
  return typeof m === 'string' && m.trim() ? m : 'Someone else has already taken this shift.';
}

/** Where a request stands, in the person's words. */
const DECISION: Record<string, string> = {
  pending: 'waiting for your manager',
  approved: 'approved',
  denied: 'turned down',
  withdrawn: 'withdrawn',
};

/** The gateway's own words when it has them — a 409 says why a claim was refused. */
function serverMessage(e: unknown): string | null {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && typeof m[0] === 'string') return m[0];
  return null;
}

export function MyShiftsNext({ ground }: { ground?: 'charcoal' }) {
  const rid = useActiveRestaurantId();
  const qc = useQueryClient();
  // F-571: "this week" is the house's week, not the device's (lib/houseZone.ts);
  // a ?week= link still opens its own week (HEAD), and is never moved by it.
  const zone = useHouseZone();
  const [weekStart, setWeekStart] = useState(() => weekFromLink(window.location.search, houseToday(zone)));
  const linkedWeek = new URLSearchParams(window.location.search).has('week');
  useSettleOnHouseDay(zone, mondayOf, linkedWeek ? () => {} : setWeekStart);
  const days = weekDays(weekStart);
  const { user } = useAuth();
  const house = useHouseAreas();
  const myAreas = house.areas
    ? house.areas.mine.areas.map((k) => {
        const name = house.areas!.areas.find((a) => a.kind === k)?.name ?? k;
        return house.areas!.mine.leadOf.includes(k) ? `${name} (you lead it)` : name;
      })
    : null;

  const q = useQuery({
    queryKey: ['team-next-my-week', rid, weekStart],
    queryFn: () => getMyWeek(weekStart) as Promise<MyWeekPayload>,
    enabled: rid !== null,
    staleTime: 30_000,
  });
  const payload = q.data;
  const weekKnown = payload !== undefined;
  const invalidate = () =>
    void qc.invalidateQueries({ queryKey: ['team-next-my-week', rid, weekStart] });

  const ack = useMutation({
    mutationFn: (scheduleId: string) => acknowledgeSchedule(scheduleId),
    onSuccess: invalidate,
  });
  const claim = useMutation({
    mutationFn: (v: { shiftId: string; memberId: string }) =>
      assignCover(v.shiftId, v.memberId),
    // A failed claim refetches too: when someone else took the shift, the
    // stale "Take it" button must go, not wait for the next poll (F-348).
    onSettled: invalidate,
  });
  const claimTakenBy = takenByWords(claim.error);
  /**
   * The week's notes addressed to ME. The gateway filters by the caller's own
   * roster row, so a staff member never reads a note they were not named on.
   */
  const notesQ = useQuery({
    queryKey: ['team-next-notes', rid, weekStart],
    queryFn: () => getTeamNotes(weekStart),
    enabled: rid !== null,
    staleTime: 30_000,
  });
  const markRead = useMutation({
    mutationFn: (noteId: string) => openTeamNote(noteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team-next-notes', rid, weekStart] }),
  });

  /** What the person says about pay; `unknown` = left to whoever approves. */
  const [leaveType, setLeaveType] = useState<LeaveType>('unknown');
  /**
   * The days asked for, first and last inclusive. Starts as today, one day: the
   * week on screen made one tap on a Friday ask for four days already worked
   * (F-923). A past day can still be picked — sick leave is often filed after.
   */
  const [offFrom, setOffFrom] = useState(() => todayIso(houseToday(zone)));
  const [offTo, setOffTo] = useState(() => todayIso(houseToday(zone)));
  // F-1008: seeded before the house's zone is read, so on the device's day;
  // once it is known, days still on that day move to the house's.
  useSettleOnHouseDay(zone, todayIso, setOffFrom);
  useSettleOnHouseDay(zone, todayIso, setOffTo);
  const rangeOk = offFrom !== '' && offTo !== '' && offFrom <= offTo;
  /** The range last sent, so the same days are not filed twice by a second press. */
  const [sentKey, setSentKey] = useState<string | null>(null);
  const rangeKey = `${offFrom}|${offTo}`;
  /** The gateway lists a staff member's own requests only (ADR 0088). */
  const mineQ = useQuery({
    queryKey: ['team-next-my-time-off', rid],
    queryFn: () => getTimeOff() as Promise<TimeOffRow[]>,
    enabled: rid !== null,
    staleTime: 30_000,
  });
  const askOff = useMutation({
    mutationFn: (memberId: string) =>
      createTimeOff({
        memberId,
        startDate: offFrom,
        endDate: offTo,
        reason: 'Requested from My Shifts',
        ...(leaveType !== 'unknown' ? { leaveType } : {}),
      }),
    onSuccess: () => {
      setSentKey(rangeKey);
      void qc.invalidateQueries({ queryKey: ['team-next-my-time-off', rid] });
    },
    // A lost answer may be a sent request (F-1083): read your requests again.
    // A second try is refused in words if it did land (the same days are
    // already in a request), so no key is needed here.
    onError: (e) => {
      if (writeOutcomeUnknown(e)) {
        void qc.invalidateQueries({ queryKey: ['team-next-my-time-off', rid] });
      }
    },
  });

  /** Taking back a request nobody has answered yet (F-936). */
  const withdraw = useMutation({
    mutationFn: (requestId: string) => withdrawTimeOff(requestId),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['team-next-my-time-off', rid] });
    },
  });

  const memberId = payload?.member?.id ?? null;
  /** Shift times on the house's clock: "17:00" in a Turkish house (F-1007). */
  const clock = houseLocale(payload?.country);
  const myRequests = (mineQ.data ?? []).filter((r) => !memberId || r.member_id === memberId);
  /**
   * A week its manager has not published is still being drawn (F-506). The
   * gateway sends staff none of its shifts; a day then is not "Off", it is not
   * out yet.
   */
  const published = payload?.schedule?.status === 'published';

  return (
    <div className="tm-page mudavym" data-ground={ground === 'charcoal' ? 'charcoal' : undefined}>
      <div className="tm-wrap" style={{ maxWidth: 860 }}>
        <header className="tm-head">
          <div>
            <Wordmark size={13} />
            <h1 className="tm-title">My shifts</h1>
            <p className="tm-sub">
              {payload?.member?.display_name ? `${payload.member.display_name} · ` : ''}
              {fmtWeekRange(weekStart)}
            </p>
          </div>
          <div className="tm-headline">
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              aria-label="Previous week"
              onClick={() => setWeekStart(addDays(weekStart, -7))}
            >
              <ChevronLeft className="tm-icon" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setWeekStart(mondayOf(houseToday(zone)))}
            >
              This week
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              aria-label="Next week"
              onClick={() => setWeekStart(addDays(weekStart, 7))}
            >
              <ChevronRight className="tm-icon" aria-hidden="true" />
            </button>
          </div>
        </header>

        {q.isError && (
          <div className="tm-banner" role="alert">
            <span>
              {payload
                ? `Your week could not be refreshed (${q.error instanceof Error ? q.error.message : 'unknown error'}) — what is below is the last answer, not the present.`
                : `Your week could not be loaded (${q.error instanceof Error ? q.error.message : 'unknown error'}). Nothing below is claimed — this is not a week off.`}
            </span>
            <button type="button" className="tm-ctl" onClick={() => void q.refetch()}>
              Try again
            </button>
          </div>
        )}

        <MutationError when={ack.isError}>
          {serverMessage(ack.error) ??
            'Your manager was not told you have seen this week. Try again.'}
        </MutationError>
        <MutationError when={claim.isError}>
          {claimTakenBy ?? serverMessage(claim.error) ?? 'The shift was not claimed. Try again.'}
        </MutationError>
        <MutationError when={askOff.isError}>
          {writeOutcomeUnknown(askOff.error)
            ? 'No answer came back, so the request may already be with your manager. Check your requests before asking again.'
            : (serverMessage(askOff.error) ??
              'The request did not reach your manager. Nothing is on their desk.')}
        </MutationError>
        <MutationError when={withdraw.isError}>
          {serverMessage(withdraw.error) ??
            'The request was not withdrawn. It is still waiting for your manager.'}
        </MutationError>

        {/* F-1005: with no roster row there is nothing to confirm against; the
            button only ever failed, so it is not offered. */}
        {payload?.schedule?.status === 'published' && !payload.acknowledged && memberId && (
          <div className="tm-banner">
            <span>
              The week of {fmtDayShort(payload.schedule.week_start)} is published. Telling your manager
              you have seen it is how they know the floor is covered.
            </span>
            <button
              type="button"
              className="tm-ctl tm-ctl--seal"
              disabled={ack.isPending}
              onClick={() => payload.schedule && ack.mutate(payload.schedule.id)}
            >
              <Check className="tm-icon" aria-hidden="true" />
              {ack.isPending ? 'Sending…' : 'I have seen it'}
            </button>
          </div>
        )}
        {payload?.schedule?.status === 'published' && payload.acknowledged && (
          <p className="tm-quiet" style={{ marginBottom: 14 }}>
            You have told your manager you have seen this week.
          </p>
        )}
        {weekKnown && !published && (
          <p className="tm-quiet" style={{ marginBottom: 14 }}>
            Your manager has not published this week yet. Your shifts, and any open ones
            you can pick up, show here once they do.
          </p>
        )}

        {askOff.isSuccess && sentKey === rangeKey && (
          <p className="tm-quiet" style={{ marginBottom: 14 }}>
            Your request went to your manager just now. It is listed below until they
            decide, and you will get a notice when they do. Whoever approves it decides
            whether the days are paid.
          </p>
        )}

        {notesQ.isError || (notesQ.data && !notesQ.data.readable) ? (
          <p className="tm-alert" role="alert">
            The notes about this week could not be read, so whether your manager has said
            anything is unknown — not no.
          </p>
        ) : (notesQ.data?.notes.length ?? 0) > 0 ? (
          <section className="tm-panel" style={{ marginBottom: 14 }}>
            <h2 className="tm-panel__title">From your manager</h2>
            <MutationError when={markRead.isError}>
              Your manager was not told you have read this. Try again.
            </MutationError>
            {notesQ.data!.notes.map((n) => {
              // Only the caller's own row says they have read it — a colleague's
              // open is not theirs (F-921).
              const mine = n.recipients.find(
                (r) => r.openedAt !== null && (memberId === null || r.memberId === memberId),
              );
              return (
                <div key={n.id} style={{ paddingTop: 8 }}>
                  <p className="tm-note">{n.body}</p>
                  {mine ? (
                    <p className="tm-quiet" style={{ fontSize: 11.5 }}>
                      You have read this.
                    </p>
                  ) : (
                    <div className="tm-actions">
                      <button
                        type="button"
                        className="tm-ctl tm-ctl--sm"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        {markRead.isPending ? 'Marking…' : 'Mark as read'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ) : null}

        <hr className="tm-rule" />

        {q.isLoading ? (
          <p className="tm-quiet">Reading your week…</p>
        ) : (
          days.map((d, i) => {
            const mine = published ? (payload?.mine ?? []).filter((s) => s.shift_date === d) : [];
            return (
              <div className="tm-day" key={d}>
                <div className="tm-day__d">
                  <span className="tm-day__dow">{DOW[i]}</span>
                  <span className="tm-day__n">{dayNum(d)}</span>
                </div>
                <div className="tm-day__body">
                  {mine.length === 0 && (
                    <span className="tm-quiet">
                      {!weekKnown ? `${EM} not known` : published ? 'Off' : `${EM} not out yet`}
                    </span>
                  )}
                  {mine.map((s) => (
                    <span key={s.id} className="tm-chip" data-state={s.state}>
                      <span className="tm-chip__t">
                        {fmtTime(s.start_time, clock)}–{fmtTime(s.end_time, clock)}
                      </span>
                      <span className="tm-chip__m">{s.role ?? s.shift_type}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {published && (payload?.open ?? []).length > 0 && memberId && (
          <section className="tm-panel" style={{ marginTop: 18 }}>
            <h2 className="tm-panel__title">Open shifts you can pick up</h2>
            {payload!.open.map((s) => (
              <div
                key={s.id}
                className="tm-day"
                style={{ background: 'transparent', border: 0, padding: '6px 0' }}
              >
                <div className="tm-day__body">
                  <span style={{ fontSize: 12.5 }}>
                    {DOW[days.indexOf(s.shift_date)] ?? ''} {dayNum(s.shift_date)} ·{' '}
                    {fmtTime(s.start_time, clock)}–{fmtTime(s.end_time, clock)}
                    {s.role ? ` · ${s.role}` : ''}
                  </span>
                  <button
                    type="button"
                    className="tm-ctl tm-ctl--sm"
                    style={{ marginLeft: 'auto' }}
                    disabled={claim.isPending}
                    onClick={() => claim.mutate({ shiftId: s.id, memberId })}
                  >
                    {claim.isPending ? 'Claiming…' : 'Take it'}
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="tm-cards" style={{ marginTop: 18 }}>
          <AwayCard
            userId={user?.userId ?? null}
            personLabel={user?.name || 'You'}
            window={user?.userId ? (house.awayByUser.get(user.userId) ?? null) : null}
            today={house.away?.today ?? null}
            failed={house.awayFailed}
            self
          />
          <HouseAwayCard
            away={house.away}
            failed={house.awayFailed}
            selfId={user?.userId ?? null}
          />
          {house.areasFailed && (
            // A failed read must not look like "you are in no area".
            <section className="tm-card">
              <h4 className="tm-card__h">Your areas</h4>
              <p className="tm-alert" role="alert" style={{ margin: 0 }}>
                Your areas could not be read, so which ones are yours is unknown — not
                &quot;none&quot;.
              </p>
            </section>
          )}
          {myAreas !== null && myAreas.length > 0 && (
            <section className="tm-card">
              <h4 className="tm-card__h">Your areas</h4>
              <p className="tm-note" style={{ margin: 0 }}>
                {myAreas.join(', ')}
              </p>
              <p className="tm-hint">
                Alerts for these areas come to you first. Everything else in the house is
                still yours to see.
              </p>
            </section>
          )}
        </section>

        {memberId ? (
          <div className="tm-actions" style={{ marginTop: 18, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                First day off
              </span>
              <input
                type="date"
                className="tm-input"
                value={offFrom}
                disabled={askOff.isPending}
                onChange={(e) => setOffFrom(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                Last day off
              </span>
              <input
                type="date"
                className="tm-input"
                value={offTo}
                min={offFrom || undefined}
                disabled={askOff.isPending}
                onChange={(e) => setOffTo(e.target.value)}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tm-label" style={{ margin: 0 }}>
                Paid or unpaid?
              </span>
              <select
                className="tm-select"
                value={leaveType}
                disabled={askOff.isPending}
                onChange={(e) => setLeaveType(e.target.value as LeaveType)}
              >
                <option value="unknown">Leave it to my manager</option>
                <option value="paid">Paid leave</option>
                <option value="unpaid">Unpaid leave</option>
              </select>
            </label>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              disabled={askOff.isPending || !rangeOk || sentKey === rangeKey}
              onClick={() => askOff.mutate(memberId)}
            >
              {askOff.isPending
                ? 'Sending…'
                : sentKey === rangeKey
                  ? 'Asked'
                  : offFrom === offTo
                    ? 'Ask for this day off'
                    : 'Ask for these days off'}
            </button>
            {!rangeOk && (
              <p className="tm-alert" role="alert" style={{ margin: 0, flexBasis: '100%' }}>
                {/* F-1019: a cleared date is not a reversed range. */}
                {offFrom === '' || offTo === ''
                  ? 'Pick both days.'
                  : 'The last day off comes before the first. Pick the days again.'}
              </p>
            )}
          </div>
        ) : (
          weekKnown && (
            <p className="tm-quiet" style={{ marginTop: 18 }}>
              Your account is not linked to a roster row here, so there is nothing to
              schedule you against and no request this page can file. Ask your manager to
              add you.
            </p>
          )
        )}

        {memberId &&
          (mineQ.isError ? (
            <p className="tm-alert" role="alert" style={{ marginTop: 14 }}>
              Your time-off requests could not be read, so whether one is waiting or decided is
              unknown — not none.
            </p>
          ) : myRequests.length > 0 ? (
            <section className="tm-panel" style={{ marginTop: 14 }}>
              <h2 className="tm-panel__title">Your time-off requests</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {myRequests.map((r) => (
                  <li key={r.id} className="tm-note" style={{ paddingTop: 6 }}>
                    {r.start_date === r.end_date
                      ? fmtDayShort(r.start_date)
                      : `${fmtDayShort(r.start_date)} ${EM} ${fmtDayShort(r.end_date)}`}
                    {' · '}
                    {DECISION[r.status] ?? r.status}
                    {r.leave_type === 'paid' ? ' · paid' : r.leave_type === 'unpaid' ? ' · unpaid' : ''}
                    {r.status === 'pending' && (
                      <button
                        type="button"
                        className="tm-ctl tm-ctl--quiet tm-ctl--sm"
                        style={{ marginLeft: 8 }}
                        disabled={withdraw.isPending}
                        onClick={() => withdraw.mutate(r.id)}
                      >
                        Withdraw it
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null)}
      </div>
    </div>
  );
}

export default MyShiftsNext;
