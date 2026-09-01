/**
 * TeamNext data — the founder's three additive ideas derived entirely from
 * endpoints that already exist (getWeek's coverage + labour, certifications,
 * the roster). Nothing is invented:
 *
 * 1. Coverage gaps become the page's first object — named, countable rows,
 *    each with a real suggested cover: a member whose role matches, who has
 *    no shift that day, picked by fewest scheduled hours this week (a fair-
 *    rotation heuristic computed from the same week's shifts — not an AI
 *    claim). No candidate → said in words.
 * 2. The week's labour figure vs target, with overtime named — only when
 *    labour tracking is enabled; otherwise the figure is withheld in words.
 * 3. Credentials as blockers: an expired/expiring certification blocks the
 *    shifts its member holds inside this week; each blocker carries the
 *    count and a one-tap renewal request (broadcast to that member).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getCertifications,
  getTeamMembers,
  getWeek,
  type Certification,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import { mondayOf, parsePeriod } from './tm-format';

export interface GapVM {
  date: string;
  role: string;
  /** As the coverage rules speak it: "am" | "pm" (or, defensively, a time range). */
  period: string;
  unfilled: number;
  /** Real candidate, or null — the row then says why. */
  suggested: { memberId: string; name: string; hoursThisWeek: number } | null;
  /**
   * Clock times for the one-tap assign, with their provenance — copied from
   * real shifts of the same role and period (same day first, then this
   * week), never invented. Null → the control is disabled and says why.
   */
  times: { start: string; end: string; source: string } | null;
}

export interface CertBlockVM {
  cert: Certification;
  memberName: string;
  memberId: string;
  /** Shifts this member holds in the visible week — the blast radius. */
  blockedShifts: number;
  /** A renewal request over broadcast reaches only linked accounts. */
  memberLinked: boolean;
}

function hoursOf(s: Shift): number {
  const [sh, sm] = s.start_time.split(':').map(Number);
  const [eh, em] = s.end_time.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const span = eh + em / 60 - (sh + sm / 60);
  return span > 0 ? span : span + 24; // overnight shifts wrap
}

export function useTeamNextData(now = new Date()) {
  const weekStart = mondayOf(now);
  const weekQ = useQuery({
    queryKey: ['team-next-week', weekStart],
    queryFn: () => getWeek(weekStart),
    staleTime: 30_000,
  });
  const membersQ = useQuery({ queryKey: ['team-next-members'], queryFn: () => getTeamMembers(), staleTime: 60_000 });
  const certsQ = useQuery({ queryKey: ['team-next-certs'], queryFn: () => getCertifications(), staleTime: 60_000 });

  const shifts = weekQ.data?.shifts ?? [];
  const members = membersQ.data ?? [];

  const hoursByMember = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shifts) {
      if (!s.member_id) continue;
      m.set(s.member_id, (m.get(s.member_id) ?? 0) + hoursOf(s));
    }
    return m;
  }, [shifts]);

  const gaps: GapVM[] = useMemo(() => {
    if (!weekQ.data || membersQ.data === undefined) return [];
    const busyByDate = new Map<string, Set<string>>();
    for (const s of shifts) {
      if (!s.member_id) continue;
      if (!busyByDate.has(s.shift_date)) busyByDate.set(s.shift_date, new Set());
      busyByDate.get(s.shift_date)!.add(s.member_id);
    }
    // Exact role equality, case-insensitive — the same rule the gateway's
    // coverage computation uses. Substring matching false-matched roles
    // (team-audit.md; the gateway carries the identical correction).
    const roleMatches = (m: TeamMember, role: string) => {
      const r = role.trim().toLowerCase();
      return (
        (m.position ?? '').trim().toLowerCase() === r ||
        m.skills.some((sk) => sk.trim().toLowerCase() === r)
      );
    };
    // Coverage rules speak in "am"/"pm"; the gateway's boundary is 15:00.
    const periodOf = (start: string): 'am' | 'pm' => {
      const [h] = start.split(':').map(Number);
      return Number.isFinite(h) && h < 15 ? 'am' : 'pm';
    };
    /** The most common start–end pair among the given shifts, or null. */
    const modalTimes = (pool: Shift[]): { start: string; end: string } | null => {
      const counts = new Map<string, { start: string; end: string; n: number }>();
      for (const s of pool) {
        const key = `${s.start_time}–${s.end_time}`;
        const cur = counts.get(key) ?? { start: s.start_time, end: s.end_time, n: 0 };
        cur.n += 1;
        counts.set(key, cur);
      }
      let best: { start: string; end: string; n: number } | null = null;
      for (const c of counts.values()) if (!best || c.n > best.n) best = c;
      return best ? { start: best.start, end: best.end } : null;
    };
    const out: GapVM[] = [];
    for (const day of weekQ.data.coverage.days) {
      for (const g of day.gaps) {
        const unfilled = Math.max(g.required - g.staffed, 0);
        if (unfilled === 0) continue;
        const busy = busyByDate.get(day.date) ?? new Set<string>();
        const candidates = members
          .filter((m) => m.status === 'active' && !busy.has(m.id) && roleMatches(m, g.role))
          .sort((a, b) => (hoursByMember.get(a.id) ?? 0) - (hoursByMember.get(b.id) ?? 0));
        const pick = candidates[0] ?? null;

        // Times are copied from real shifts of this role+period, never made up:
        // same day first, then anywhere this week. A gap period that already
        // carries clock times ("17:00–23:00") is honoured as-is.
        const parsed = parsePeriod(g.period);
        const sameRolePeriod = (s: Shift) =>
          (s.role ?? '').trim().toLowerCase() === g.role.trim().toLowerCase() &&
          (g.period === 'am' || g.period === 'pm' ? periodOf(s.start_time) === g.period : true);
        let times: GapVM['times'] = null;
        if (parsed) {
          times = { ...parsed, source: 'from the coverage rule' };
        } else {
          const sameDay = modalTimes(shifts.filter((s) => s.shift_date === day.date && sameRolePeriod(s)));
          if (sameDay) times = { ...sameDay, source: `times from this day's ${g.role} shifts` };
          else {
            const sameWeek = modalTimes(shifts.filter(sameRolePeriod));
            if (sameWeek) times = { ...sameWeek, source: `times from this week's ${g.role} shifts` };
          }
        }

        out.push({
          date: day.date,
          role: g.role,
          period: g.period,
          unfilled,
          suggested: pick
            ? {
                memberId: pick.id,
                name: pick.display_name,
                hoursThisWeek: Math.round((hoursByMember.get(pick.id) ?? 0) * 10) / 10,
              }
            : null,
          times,
        });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [weekQ.data, membersQ.data, members, shifts, hoursByMember]);

  const certBlocks: CertBlockVM[] = useMemo(() => {
    if (certsQ.data === undefined || membersQ.data === undefined || !weekQ.data) return [];
    const nameOf = new Map(members.map((m) => [m.id, m.display_name]));
    const linkedOf = new Map(members.map((m) => [m.id, Boolean(m.accountLinked && m.user_id)]));
    const shiftCount = new Map<string, number>();
    for (const s of shifts) {
      if (!s.member_id) continue;
      shiftCount.set(s.member_id, (shiftCount.get(s.member_id) ?? 0) + 1);
    }
    return certsQ.data
      .filter((c) => c.status === 'expired' || c.status === 'expiring')
      .map((c) => ({
        cert: c,
        memberId: c.member_id,
        memberName: nameOf.get(c.member_id) ?? 'unknown member',
        blockedShifts: c.status === 'expired' ? (shiftCount.get(c.member_id) ?? 0) : 0,
        memberLinked: linkedOf.get(c.member_id) ?? false,
      }))
      .sort((a, b) => b.blockedShifts - a.blockedShifts);
  }, [certsQ.data, membersQ.data, members, shifts, weekQ.data]);

  const blockedTotal = certBlocks.reduce((n, b) => n + b.blockedShifts, 0);

  const overtimeNamed = useMemo(() => {
    const nameOf = new Map(members.map((m) => [m.id, m.display_name]));
    return (weekQ.data?.labor.overtime ?? []).map((o) => ({
      name: nameOf.get(o.memberId) ?? 'unknown member',
      hours: o.hours,
    }));
  }, [weekQ.data, members]);

  return {
    overtimeNamed,
    weekStart,
    week: weekQ.data ?? null,
    gaps,
    gapsKnown: weekQ.data !== undefined && membersQ.data !== undefined,
    membersFailed: membersQ.isError,
    certsFailed: certsQ.isError,
    scheduleId: weekQ.data?.schedule?.id ?? null,
    certBlocks,
    certsKnown: certsQ.data !== undefined && membersQ.data !== undefined && weekQ.data !== undefined,
    blockedTotal,
    membersCount: membersQ.data === undefined ? null : members.length,
    hasData: weekQ.data !== undefined,
    isError: weekQ.isError,
    errorMessage: weekQ.error instanceof Error ? weekQ.error.message : 'unknown error',
    refetch: () => {
      void weekQ.refetch();
      void membersQ.refetch();
      void certsQ.refetch();
    },
  };
}
