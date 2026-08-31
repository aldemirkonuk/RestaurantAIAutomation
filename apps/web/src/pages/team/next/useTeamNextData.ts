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
import { mondayOf } from './tm-format';

export interface GapVM {
  date: string;
  role: string;
  period: string;
  unfilled: number;
  /** Real candidate, or null — the row then says why. */
  suggested: { memberId: string; name: string; hoursThisWeek: number } | null;
}

export interface CertBlockVM {
  cert: Certification;
  memberName: string;
  memberId: string;
  /** Shifts this member holds in the visible week — the blast radius. */
  blockedShifts: number;
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
    const roleMatches = (m: TeamMember, role: string) => {
      const r = role.toLowerCase();
      return (
        (m.position ?? '').toLowerCase().includes(r) ||
        m.skills.some((sk) => sk.toLowerCase().includes(r))
      );
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
        });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }, [weekQ.data, membersQ.data, members, shifts, hoursByMember]);

  const certBlocks: CertBlockVM[] = useMemo(() => {
    if (certsQ.data === undefined || membersQ.data === undefined || !weekQ.data) return [];
    const nameOf = new Map(members.map((m) => [m.id, m.display_name]));
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
