/**
 * The "your shift" strip on the staff home (design review round 2, c2 #14).
 *
 * The home was three actions and a list, and left a third of the phone empty
 * with no answer to the first thing a floor worker wants to know: when am I on.
 * This is one line under the actions: the shift in progress, today's next one,
 * or the next one this week. It reads the same `my-week` the Team page's "My
 * shifts" reads, so the two cannot disagree.
 *
 * A failed read says so in words and a person with no shift left says that;
 * neither is a blank. A shift called out is not a shift.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { getMyWeek, type Shift } from '@/services/api/team';
import { fmtTime, fmtWeekday, mondayOf } from '../../team/next/tm-format';
import { DASH } from './format';

export interface ShiftLine {
  /** `now` is in progress, `today` is later today, `later` is another day this week. */
  when: 'now' | 'today' | 'later';
  shift: Shift;
}

function isoDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Minutes after midnight of an `HH:MM[:SS]` clock time, or null. */
function minutes(t: string): number | null {
  const [h, m] = t.split(':').map((n) => parseInt(n, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

/**
 * The one shift to show: the one in progress, else the next to start, from the
 * shifts assigned to this person. An end before its start is an overnight.
 */
export function pickShift(mine: Shift[], now: Date): ShiftLine | null {
  const today = isoDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const live = mine
    .filter((s) => s.state !== 'callout' && s.shift_date >= today)
    .sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time));
  for (const s of live) {
    if (s.shift_date > today) return { when: 'later', shift: s };
    const start = minutes(s.start_time);
    const end = minutes(s.end_time);
    if (start === null || end === null) return { when: 'today', shift: s };
    const overnight = end <= start;
    if (nowMin < start) return { when: 'today', shift: s };
    if (overnight || nowMin < end) return { when: 'now', shift: s };
  }
  return null;
}

export function shiftWords(line: ShiftLine): { lead: string; time: string; role: string | null } {
  const { shift, when } = line;
  const lead = when === 'now' ? 'On now' : when === 'today' ? 'Today' : fmtWeekday(shift.shift_date);
  return {
    lead,
    time: `${fmtTime(shift.start_time)} to ${fmtTime(shift.end_time)}`,
    role: shift.role,
  };
}

export function StaffShiftStrip() {
  const { activeRestaurantId, user } = useAuth();
  const rid = activeRestaurantId || user?.restaurantId || null;
  const now = new Date();
  const weekStart = mondayOf(now);
  const q = useQuery({
    queryKey: ['staff-home-my-week', rid, weekStart],
    queryFn: () => getMyWeek(weekStart),
    enabled: rid !== null,
    staleTime: 60_000,
  });

  let body: JSX.Element;
  if (q.isError) {
    body = <p className="sh-shift__line sh-note">{DASH} Your shifts couldn’t be reached just now.</p>;
  } else if (!q.data) {
    body = <div className="dn-skel sh-shift__skel" aria-hidden />;
  } else if (!q.data.member) {
    body = <p className="sh-shift__line sh-note">You aren’t on this house’s roster yet.</p>;
  } else {
    const line = pickShift(q.data.mine, now);
    if (!line) {
      body = <p className="sh-shift__line sh-note">No shift left this week.</p>;
    } else {
      const w = shiftWords(line);
      body = (
        <p className="sh-shift__line" data-when={line.when}>
          <span className="sh-shift__lead">{w.lead}</span>
          <span className="sh-shift__time">{w.time}</span>
          {w.role ? <span className="sh-shift__role">{w.role}</span> : null}
        </p>
      );
    }
  }

  return (
    <section aria-label="Your shift" className="sh-shift" data-testid="staff-shift">
      <Clock size={18} strokeWidth={1.75} aria-hidden className="sh-shift__icon" />
      <div className="sh-shift__body">
        <h2 className="sh-shift__title">Your shift</h2>
        {body}
      </div>
      <Link to="/team" className="sh-shift__all">
        All shifts
      </Link>
    </section>
  );
}
