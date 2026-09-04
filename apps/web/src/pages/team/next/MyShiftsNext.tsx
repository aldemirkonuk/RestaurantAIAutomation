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
  type MyWeekPayload,
} from '../../../services/api/team';
import { useActiveRestaurantId } from './useTeamNextData';
import {
  DOW,
  EM,
  addDays,
  dayNum,
  fmtDayShort,
  fmtTime,
  fmtWeekRange,
  mondayOf,
  weekDays,
} from './tm-format';
import { ensureFraunces, MutationError } from './tm-bits';
import './team-next.css';

export function MyShiftsNext({ ground }: { ground?: 'charcoal' }) {
  ensureFraunces();
  const rid = useActiveRestaurantId();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const days = weekDays(weekStart);

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
    onSuccess: invalidate,
  });
  const askOff = useMutation({
    mutationFn: (memberId: string) =>
      createTimeOff({
        memberId,
        startDate: days[0],
        endDate: days[6],
        reason: 'Requested from My Shifts',
      }),
  });

  const memberId = payload?.member?.id ?? null;

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
              onClick={() => setWeekStart(mondayOf(new Date()))}
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
          Your manager was not told you have seen this week. Try again.
        </MutationError>
        <MutationError when={claim.isError}>
          The shift was not claimed — it is still open for someone else.
        </MutationError>
        <MutationError when={askOff.isError}>
          The request did not reach your manager. Nothing is on their desk.
        </MutationError>

        {payload?.schedule?.status === 'published' && !payload.acknowledged && (
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
        {weekKnown && payload?.schedule === null && (
          <p className="tm-quiet" style={{ marginBottom: 14 }}>
            No schedule has been published for this week yet, so anything below is a draft
            your manager is still working on.
          </p>
        )}

        {askOff.isSuccess && (
          <p className="tm-quiet" style={{ marginBottom: 14 }}>
            Your request went to your manager just now. You will see it decided on their
            desk, not here — nothing on this page reads the request file back.
          </p>
        )}

        <hr className="tm-rule" />

        {q.isLoading ? (
          <p className="tm-quiet">Reading your week…</p>
        ) : (
          days.map((d, i) => {
            const mine = (payload?.mine ?? []).filter((s) => s.shift_date === d);
            return (
              <div className="tm-day" key={d}>
                <div className="tm-day__d">
                  <span className="tm-day__dow">{DOW[i]}</span>
                  <span className="tm-day__n">{dayNum(d)}</span>
                </div>
                <div className="tm-day__body">
                  {mine.length === 0 && (
                    <span className="tm-quiet">
                      {weekKnown ? 'Off' : `${EM} not known`}
                    </span>
                  )}
                  {mine.map((s) => (
                    <span key={s.id} className="tm-chip" data-state={s.state}>
                      <span className="tm-chip__t">
                        {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                      </span>
                      <span className="tm-chip__m">{s.role ?? s.shift_type}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}

        {(payload?.open ?? []).length > 0 && memberId && (
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
                    {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
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

        {memberId ? (
          <div className="tm-actions" style={{ marginTop: 18 }}>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              disabled={askOff.isPending}
              onClick={() => askOff.mutate(memberId)}
            >
              {askOff.isPending ? 'Sending…' : 'Ask for this week off'}
            </button>
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
      </div>
    </div>
  );
}

export default MyShiftsNext;
