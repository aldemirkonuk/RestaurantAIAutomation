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
  getTeamNotes,
  getTimeOff,
  getWeek,
  type Certification,
  type Shift,
  type TeamNotesReadout,
  type TeamMember,
  type WeekPayload,
} from '../../../services/api/team';
import { apiClient } from '../../../services/api/client';
import { mondayOf, parsePeriod, resolveName } from './tm-format';

/**
 * /team's server-side windows.
 *
 * There is exactly ONE: the per-member performance benchmark reads the most
 * recent 200 `server_sales` rows across the whole restaurant and renders a
 * median and an inter-quartile band from them. Every read this hook makes — the
 * week, the roster, the credential file, the coverage rules, the time-off file
 * — is uncapped, so the only windowed figure on either half is that benchmark.
 *
 * It used to be reachable only from the legacy desk's inspector. Since the
 * parity build (2026-09-04) the redesigned half renders it too, in the roster
 * expander and under the selected shift (`PerformanceCard.tsx`), which is why
 * that file carries the `LE` marker: a ceiling on the SAMPLE a statistic was
 * computed over, never a floor on a count (ADR 0051 clause 2).
 */
export const TEAM_SERVER_WINDOWS = {
  /** performance.service.ts:139 — the team benchmark ends `.limit(200)`. */
  BENCHMARK_SERVICES: 200,
  /**
   * settings-audit.service.ts:252,270 — the trail read is
   * `Math.min(200, limit)` then `.limit(capped)`. `/team` asks for 100, so the
   * sheet holds at most that many rows and says so: "the last ≤100 changes",
   * never "everything that has happened here". The server offers no total to
   * read back, which is exactly why the cap has to be declared instead.
   */
  TRAIL_ROWS: 100,
} as const;


/**
 * The settings trail, read through the ONE reader that already exists.
 *
 * `GET /settings-audit` (`apps/api-gateway/src/settings-audit/`) reads
 * `system_audit_log` for this restaurant and already reads back the two actions
 * `recordAccessChange` files — `member_role_changed` and `team_member_removed`
 * (`settings-audit.service.ts:80-84`, written at
 * `apps/api-gateway/src/team/access-audit.ts:73`). So `/team` gets a trail by
 * calling that route and nothing else: no new table, no second reader, no fork.
 *
 * The types mirror `SettingsAuditReadout` (`settings-audit.service.ts:121-151`)
 * and are declared here rather than imported from `pages/settings/next`,
 * because a `next` directory stands alone (p4 rule). The gateway's own spec is
 * what holds the shape.
 */
export interface TeamTrailEntry {
  id: string;
  occurredAt: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  subject: string | null;
  actor: { userId: string | null; name: string | null; email: string | null };
  fields: Record<string, { from: unknown; to: unknown }>;
}

export interface TeamTrail {
  entries: TeamTrailEntry[];
  /** `false` renders as words. An unreadable log is never an empty one. */
  readable: boolean;
  reason: string | null;
  oldestAt: string | null;
  /** Before this instant nothing was recorded at all, and the sheet says so. */
  recordingSince: string;
}

/** The two actions on that trail that are about people, not about settings. */
export const TEAM_TRAIL_ACTIONS = ['member_role_changed', 'team_member_removed'] as const;

/**
 * What `/team` can and cannot say about where a value came from.
 *
 * `team_settings` carries `updated_at` and NO author column (baseline
 * `:5653-5658`), and `TeamService.updateSettings` files nothing into
 * `system_audit_log` today — so a labour setting has a date and never a name.
 * The register prints the date and says the author is unrecorded, rather than
 * leaving the line off and letting the value look self-evident.
 */
export interface TeamProvenance {
  /** ISO instant of the last write, or null when nothing records one. */
  when: string | null;
  /** Why there is no date. Required when `when` is null. */
  whenUnknown?: string;
  /** Who wrote it, or null. Nothing on this page records an author yet. */
  who: string | null;
  /** Where the value is kept, named by table. */
  kept: string;
}

/**
 * `team_settings.labor_target_pct` is `numeric(5,2) DEFAULT 28 NOT NULL`
 * (baseline `:5656`). A row that exists therefore ALWAYS carries a number, and
 * 28 is indistinguishable from "nobody chose one" — the same shape as
 * `providers.lead_time_days DEFAULT 7`, which the vendor-terms register exists
 * to catch. Nothing files an audit row when this column is written, so there is
 * no provenance that could tell the two apart.
 *
 * So: 28 with no provenance is NOT a target. It is rendered as unknown, with
 * the default named, and the week is never measured against it.
 */
export const LABOR_TARGET_COLUMN_DEFAULT = 28;

export interface TargetReading {
  /** The percentage to render, or null when there is no target to speak of. */
  pct: number | null;
  /** One sentence saying what the value is, and why. Always rendered. */
  why: string;
}

export function readLabourTarget(
  targetPct: number | null,
  hasProvenance: boolean,
): TargetReading {
  if (targetPct === null) {
    return {
      pct: null,
      why: 'No labour target is on file, so the week is not measured against one.',
    };
  }
  if (targetPct === LABOR_TARGET_COLUMN_DEFAULT && !hasProvenance) {
    return {
      pct: null,
      why: `No target set. The stored value is ${LABOR_TARGET_COLUMN_DEFAULT}%, which is the column's own default (\`team_settings.labor_target_pct numeric(5,2) DEFAULT 28 NOT NULL\`), and nothing records anyone choosing it — so it is read as unknown rather than as a target this house set.`,
    };
  }
  return {
    pct: targetPct,
    why: 'Kept on the restaurant, in `team_settings`. No column records who set it.',
  };
}

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

/** `time_off_requests` as the gateway returns it (baseline `:5666-5677`). */
export interface TimeOffRow {
  id: string;
  member_id: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: string;
  reviewed_by: string | null;
  created_at: string;
}

/**
 * The labour block, including the three fields the gateway added with ADR 0088
 * that `services/api/team.ts`'s `WeekPayload` does not yet name. They are read
 * here rather than typed there because the shared service module belongs to
 * both halves of this page and this branch owns only the redesigned one; §13 of
 * the page note carries the one-line request to widen the shared type.
 *
 * `totalCost` is `null` — never a partial and never 0 — until every
 * member-assigned shift carries a cost (`schedule.service.ts:854-860`), and
 * `unpricedShifts` is how the page says WHY it is unknown.
 */
export interface LaborVM {
  enabled: boolean;
  totalHours: number;
  totalCost: number | null;
  targetPct: number | null;
  costComplete: boolean | null;
  pricedShifts: number | null;
  unpricedShifts: number | null;
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
  /** The roster itself. `null` until it answers — an empty team is not a silence. */
  members: TeamMember[] | null;
  /** The whole credential file. `null` until it answers; `[]` means none exist. */
  certs: Certification[] | null;
  /** The week's crew notes, as a record. `null` until the register answers. */
  notes: TeamNotesReadout | null;
  notesFailed: boolean;
  /** Who changed what on this team. `null` until the trail answers. */
  trail: TeamTrail | null;
  trailFailed: boolean;
  /** The labour target, read against the column default. Never a bare number. */
  target: TargetReading;
  /** When `team_settings` was last written, or null when no row exists. */
  settingsUpdatedAt: string | null;
  /** False when no `team_settings` row exists — every value is then a code default. */
  settingsConfigured: boolean;
  /** The week's shifts. `null` until the week answers. */
  shifts: Shift[] | null;
  /** Time-off requests. `null` until they answer; `[]` means none are on file. */
  timeOff: TimeOffRow[] | null;
  timeOffFailed: boolean;
  /** Labour, with the reason a cost is unknown. `null` until the week answers. */
  labor: LaborVM | null;
  /** Wage columns are hidden when the restaurant says so (`team_settings`). */
  wageVisible: boolean;
  /** How many people have opened the published week; `null` when unknown. */
  receiptsSeen: number | null;
  published: boolean;
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

/**
 * `anchor` is either a Date (the week containing it) or an explicit week-start
 * string, which is how the grid's back/forward controls move without the hook
 * having to own the navigation state.
 */
export function useTeamNextData(anchor: Date | string = new Date()): TeamNextData {
  const weekStart = typeof anchor === 'string' ? anchor : mondayOf(anchor);
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
  /**
   * Limit 100 like `/settings` — the same route, the same page size. It is not
   * declared in TEAM_SERVER_WINDOWS because it caps a LIST being displayed, not
   * the sample of a statistic; the sheet says how far back the rows reach with
   * `oldestAt`, which is the honest mark for a paged list.
   */
  const trailQ = useQuery({
    queryKey: ['team-next-trail', rid],
    queryFn: async () => {
      const { data } = await apiClient.get<TeamTrail>(
        `/settings-audit?limit=${TEAM_SERVER_WINDOWS.TRAIL_ROWS}`,
      );
      return data;
    },
    enabled,
    staleTime: 60_000,
  });
  /** Keyed by the WEEK as well as the tenant: a note belongs to one week. */
  const notesQ = useQuery({
    queryKey: ['team-next-notes', rid, weekStart],
    queryFn: () => getTeamNotes(weekStart),
    enabled,
    staleTime: 30_000,
  });
  const timeOffQ = useQuery({
    queryKey: ['team-next-time-off', rid],
    queryFn: () => getTimeOff() as Promise<TimeOffRow[]>,
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
                // `resolveName`, never `display_name`: the stored value is the
                // gateway's placeholder on any row backfilled before the 2026-09-04
                // fix, and "suggest Team member" is not a suggestion.
                name: resolveName(pick).text,
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
    const nameOf = new Map(members.map((m) => [m.id, resolveName(m).text]));
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
    const nameOf = new Map(members.map((m) => [m.id, resolveName(m).text]));
    return (weekQ.data?.labor.overtime ?? []).map((o) => ({
      name: nameOf.get(o.memberId) ?? 'unknown member',
      hours: o.hours,
    }));
  }, [weekQ.data, members]);

  /**
   * The gateway sends three fields the shared `WeekPayload` type does not name
   * yet (see LaborVM). Read through one narrowing here rather than sprinkling
   * casts through the renderers, and every one of them stays nullable so an
   * older gateway that omits them reads as "unknown" rather than "complete".
   */
  const laborRaw = weekQ.data?.labor as
    | (WeekPayload['labor'] & {
        costComplete?: boolean;
        pricedShifts?: number;
        unpricedShifts?: number;
      })
    | undefined;
  /** `configured` and `updated_at` are on the wire (measured 2026-09-04) but not
      on the shared `TeamSettings` type; §13 asks for the type to be widened. */
  const settingsRaw = weekQ.data?.settings as
    | (WeekPayload['settings'] & { configured?: boolean; updated_at?: string })
    | undefined;
  const labor: LaborVM | null = laborRaw
    ? {
        enabled: laborRaw.enabled,
        totalHours: laborRaw.totalHours,
        totalCost: typeof laborRaw.totalCost === 'number' ? laborRaw.totalCost : null,
        targetPct: typeof laborRaw.targetPct === 'number' ? laborRaw.targetPct : null,
        costComplete:
          typeof laborRaw.costComplete === 'boolean' ? laborRaw.costComplete : null,
        pricedShifts:
          typeof laborRaw.pricedShifts === 'number' ? laborRaw.pricedShifts : null,
        unpricedShifts:
          typeof laborRaw.unpricedShifts === 'number' ? laborRaw.unpricedShifts : null,
      }
    : null;

  return {
    overtimeNamed,
    weekStart,
    week: weekQ.data ?? null,
    members: membersQ.data === undefined ? null : members,
    certs: certsQ.data === undefined ? null : certsQ.data,
    notes: notesQ.data === undefined ? null : notesQ.data,
    notesFailed: notesQ.isError,
    trail: trailQ.data === undefined ? null : trailQ.data,
    trailFailed: trailQ.isError,
    target: readLabourTarget(
      laborRaw && typeof laborRaw.targetPct === 'number' ? laborRaw.targetPct : null,
      // Nothing files an audit row for a labour setting yet, so this is FALSE
      // by measurement, not by omission: `TeamService.updateSettings` has no
      // `record()` call (page note §13.5).
      false,
    ),
    settingsUpdatedAt: settingsRaw?.updated_at ?? null,
    settingsConfigured: settingsRaw?.configured === true,
    shifts: weekQ.data === undefined ? null : shifts,
    timeOff: timeOffQ.data === undefined ? null : timeOffQ.data,
    timeOffFailed: timeOffQ.isError,
    labor,
    // A restaurant with no settings row is `wage_visible: true`
    // (`team.service.ts` getSettings) — the gateway's answer, not a guess here.
    wageVisible: weekQ.data?.settings?.wage_visible !== false,
    receiptsSeen: weekQ.data === undefined ? null : weekQ.data.receipts.length,
    published: weekQ.data?.schedule?.status === 'published',
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
      void timeOffQ.refetch();
      void trailQ.refetch();
      void notesQ.refetch();
    },
  };
}
