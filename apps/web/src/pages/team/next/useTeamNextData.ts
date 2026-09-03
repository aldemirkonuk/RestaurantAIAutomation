/**
 * TeamNext data — the founder's three additive ideas derived entirely from
 * endpoints that already exist (getWeek's coverage + labour, certifications,
 * the roster, the coverage rules). Nothing is invented:
 *
 * 1. Coverage gaps become the page's first object — named, countable rows,
 *    each with a real suggested cover: a member whose role matches, who has
 *    no shift that day, picked by fewest scheduled hours this week (a fair-
 *    rotation heuristic computed from the same week's shifts — not an AI
 *    claim). No candidate → said in words.
 * 2. The week's labour figure vs target, with overtime named — only when
 *    labour tracking is enabled; otherwise the figure is withheld in words.
 * 3. Credentials as exposure, not as a link the schema does not have: an
 *    expired certification names the member and how much of their week is at
 *    stake, and says plainly that nothing records WHICH shifts require it.
 *
 * THE COVERAGE ENGINE HAS AN OFF STATE, AND IT IS THE PRODUCTION ONE
 * ------------------------------------------------------------------
 * `coverage_templates` is empty in production, so `coverage.days[].gaps` is
 * empty for a reason that has nothing to do with staffing: nothing has ever
 * been required. "No gaps" and "no rules" render identically unless the page
 * asks. So it asks — `getCoverageTemplates` is a first-class query here, and
 * the page can create the first rule rather than pointing at the legacy drawer
 * its own flag replaces (ADR 0089).
 *
 * EVERY QUERY KEY CARRIES THE TENANT
 * ----------------------------------
 * The gateway scopes every one of these endpoints by restaurant through the
 * `X-Restaurant-Id` header the client stamps from localStorage
 * (services/api/client.ts:67-69) — the key never sees it. The branch switcher
 * is in the GLOBAL header and `AuthContext.setActiveRestaurantId` re-issues the
 * JWT without clearing the query cache, so an unkeyed bucket serves the
 * previous restaurant's week, roster and credentials after a switch. The legacy
 * desk got this right; the redesign did not (ADR 0089).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../contexts/AuthContext';
import {
  getCertifications,
  getCoverageTemplates,
  getTeamMembers,
  getWeek,
  type Certification,
  type Shift,
  type TeamMember,
  type WeekPayload,
} from '../../../services/api/team';
import { mondayOf, parsePeriod } from './tm-format';

/**
 * /team's server-side windows.
 *
 * There is exactly ONE, and it is not on this half of the page: the per-member
 * performance benchmark reads the most recent 200 `server_sales` rows across
 * the whole restaurant and renders a median and an inter-quartile band from
 * them. Every read this hook makes — the week, the roster, the credential file,
 * the coverage rules — is uncapped, so no figure on the redesigned surface is a
 * window dressed as a total. The register is page-wide rather than half-wide so
 * the one real window is declared where a guard can hold it.
 */
export const TEAM_SERVER_WINDOWS = {
  /** performance.service.ts:139 — the team benchmark ends `.limit(200)`. */
  BENCHMARK_SERVICES: 200,
} as const;

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

export interface CertExposureVM {
  cert: Certification;
  memberName: string;
  memberId: string;
  /**
   * How many shifts this member holds in the visible week — the exposure if
   * the credential turns out to be required for any of them. NOT a count of
   * blocked shifts: `team_certifications` has no role or applies-to column
   * (baseline schema :5609-5620), so nothing in the data connects a credential
   * to a shift. `null` when the week has not answered.
   */
  shiftsThisWeek: number | null;
  /** A renewal request over broadcast reaches only linked accounts. */
  memberLinked: boolean;
}

export interface CoverageRule {
  id: string;
  role: string;
  day_of_week: number | null;
  shift_period: string;
  min_staff: number;
}

/**
 * The page's view model. Every field whose job is to say "the query has not
 * answered" is nullable, and none of them falls back to an empty list: an
 * empty roster, an empty rule file and a failed fetch are three different
 * things and the page prints three different sentences.
 */
export interface TeamNextData {
  weekStart: string;
  week: WeekPayload | null;
  gaps: GapVM[];
  gapsKnown: boolean;
  membersFailed: boolean;
  certsFailed: boolean;
  rulesFailed: boolean;
  scheduleId: string | null;
  certExposures: CertExposureVM[];
  certsKnown: boolean;
  /** How many certifications exist at all — an empty file is not a clean one. */
  certsOnFile: number | null;
  /** Members with an expired credential who are scheduled this week. */
  exposedMembers: number;
  membersCount: number | null;
  /** The coverage rules themselves — `null` until they answer, never `[]`. */
  coverageRules: CoverageRule[] | null;
  overtimeNamed: { name: string; hours: number }[];
  hasData: boolean;
  isError: boolean;
  errorMessage: string;
  noRestaurant: boolean;
  refetch: () => void;
}

function hoursOf(s: Shift): number {
  const [sh, sm] = s.start_time.split(':').map(Number);
  const [eh, em] = s.end_time.split(':').map(Number);
  if (![sh, sm, eh, em].every(Number.isFinite)) return 0;
  const span = eh + em / 60 - (sh + sm / 60);
  return span > 0 ? span : span + 24; // overnight shifts wrap
}

/**
 * The active restaurant, or null. Two people who resolve no restaurant are not
 * the same tenant — they are two unknowns — so the empty case does not get a
 * shared `''` bucket; the queries simply do not run and the page says so.
 */
export function useActiveRestaurantId(): string | null {
  const { activeRestaurantId, user } = useAuth();
  return activeRestaurantId || user?.restaurantId || null;
}

export function useTeamNextData(now = new Date()): TeamNextData {
  const weekStart = mondayOf(now);
  const rid = useActiveRestaurantId();
  const enabled = rid !== null;

  const weekQ = useQuery({
    queryKey: ['team-next-week', rid, weekStart],
    queryFn: () => getWeek(weekStart),
    enabled,
    staleTime: 30_000,
  });
  const membersQ = useQuery({
    queryKey: ['team-next-members', rid],
    queryFn: () => getTeamMembers(),
    enabled,
    staleTime: 60_000,
  });
  const certsQ = useQuery({
    queryKey: ['team-next-certs', rid],
    queryFn: () => getCertifications(),
    enabled,
    staleTime: 60_000,
  });
  const rulesQ = useQuery({
    queryKey: ['team-next-coverage-rules', rid],
    queryFn: () => getCoverageTemplates() as Promise<CoverageRule[]>,
    enabled,
    staleTime: 60_000,
  });

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

  const certExposures: CertExposureVM[] = useMemo(() => {
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
        shiftsThisWeek: shiftCount.get(c.member_id) ?? 0,
        memberLinked: linkedOf.get(c.member_id) ?? false,
      }))
      .sort((a, b) => (b.shiftsThisWeek ?? 0) - (a.shiftsThisWeek ?? 0));
  }, [certsQ.data, membersQ.data, members, shifts, weekQ.data]);

  /**
   * People, not shifts. The old figure summed every shift an expired-credential
   * holder worked and called them "blocked", which asserted a link the schema
   * does not carry. What is actually countable is how many people are affected.
   */
  const exposedMembers = certExposures.filter(
    (e) => e.cert.status === 'expired' && (e.shiftsThisWeek ?? 0) > 0,
  ).length;

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
    rulesFailed: rulesQ.isError,
    scheduleId: weekQ.data?.schedule?.id ?? null,
    certExposures,
    certsKnown: certsQ.data !== undefined && membersQ.data !== undefined && weekQ.data !== undefined,
    certsOnFile: certsQ.data === undefined ? null : certsQ.data.length,
    exposedMembers,
    membersCount: membersQ.data === undefined ? null : members.length,
    coverageRules: rulesQ.data === undefined ? null : rulesQ.data,
    hasData: weekQ.data !== undefined,
    isError: weekQ.isError,
    errorMessage: weekQ.error instanceof Error ? weekQ.error.message : 'unknown error',
    noRestaurant: !enabled,
    refetch: () => {
      void weekQ.refetch();
      void membersQ.refetch();
      void certsQ.refetch();
      void rulesQ.refetch();
    },
  };
}
