/**
 * TeamNext — the Mudavym `/team` (ADR 0045 §5 wave, MAKEOVER-VERDICTS: KEEP,
 * "spot on", plus three founder-requested additions), completed to PARITY with
 * the legacy desk on 2026-09-04.
 *
 * THE THREE ADDITIONS, still the page's leading objects:
 *
 * 1. Coverage gaps are the FIRST object — named, countable rows ("2 unfilled ·
 *    Saturday · line"), each with a real suggested cover (role-matching, free
 *    that day, fewest hours this week — a fair-rotation derivation, not an AI
 *    claim) and one control to assign. And, because gaps are this page's
 *    declared first object, the page can START the engine that produces them:
 *    with no coverage rule on file it says the engine is idle and offers the
 *    form that creates the first rule (ADR 0089).
 * 2. Labour cost as the week builds — total vs target with overtime named, only
 *    when labour tracking is on; withheld in words otherwise, and now saying
 *    HOW MANY shifts are unpriced when the total cannot be computed.
 * 3. Credentials as exposure — an expired card names the member and how much of
 *    their week is at stake, and says plainly that nothing records which shifts
 *    require it (`team_certifications` has no role or applies-to column).
 *
 * WHAT THE PARITY PASS ADDED, AND THE ONE IDEA THAT ORGANISES IT.
 *
 * The page note said the desk's operating half "stayed legacy": the roster, the
 * shift editors, publish, copy-week, time-off, broadcast, export and the staff
 * view lived only in `pages/team/command/**`, so flipping the flag handed a
 * manager a page that could not schedule. All of it is here now, and the shape
 * it took is one rule: **the page holds the week, and every act on it opens the
 * house overlay whose shape says what kind of act it is** (ADR 0112). A record
 * arrives from the right (`Sheet`: a shift, a person, a message). A decision
 * arrives in the middle (`Panel`: publish, re-publish, copy-week — the two that
 * delete are sealed with `HoldToApprove` and say what they destroy). A menu
 * hangs off its own control (`Popover`: the shift menu, export). Nothing on the
 * page is a rail of controls whose consequences you learn by pressing them.
 *
 * Motions: `pages/team/next/MOTIONS.md`. Honesty: an unknown is an em dash, a
 * failed read says which register did not answer, and a control whose backend
 * is not real is disabled with the reason (see the import note in the header).
 */

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Megaphone,
  Send,
  Upload,
  UsersRound,
} from 'lucide-react';
import { Wordmark } from '@/components/mudavym';
import { useAuth } from '../../../contexts/AuthContext';
import { MyShiftsNext } from './MyShiftsNext';
import { broadcast, createCoverageTemplate, createShift, type TeamMember } from '../../../services/api/team';
import {
  EM,
  addDays,
  fmtDayShort,
  fmtMoneyWhole,
  fmtWeekRange,
  fmtWeekday,
  mondayOf,
} from './tm-format';
import { ensureFraunces, MutationError } from './tm-bits';
import { LENSES, WeekGrid, type Lens } from './WeekGrid';
import { RosterSheet, MemberSheet } from './RosterSheet';
import { ShiftSheet, type ShiftSheetTarget } from './ShiftSheet';
import {
  CopyWeekPanel,
  CrewNoteSheet,
  CrewNoteStrip,
  ExportPopover,
  PublishPanel,
  TimeOffSheet,
} from './TeamOverlays';
import { TeamRecordSection, TrailSheet } from './TeamRecord';
import {
  useActiveRestaurantId,
  useTeamNextData,
  type CertExposureVM,
  type GapVM,
} from './useTeamNextData';
import './team-next.css';

/** Coverage rules speak "am"/"pm" — said as service language on screen. */
function periodLabel(period: string): string {
  if (period === 'am') return 'day';
  if (period === 'pm') return 'evening';
  return period;
}

const DOW_JS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The control that starts the staffing engine.
 *
 * Before this existed, a page whose declared first object is "coverage gaps"
 * could not create the only thing that produces one; the sole route was the
 * legacy Ops drawer this page's flag replaces.
 */
function CoverageRuleForm({ weekStart }: { weekStart: string }) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const [form, setForm] = useState({ role: '', dayOfWeek: '', shiftPeriod: 'pm', minStaff: '1' });

  const add = useMutation({
    mutationFn: () =>
      createCoverageTemplate({
        dayOfWeek: form.dayOfWeek === '' ? undefined : Number(form.dayOfWeek),
        shiftPeriod: form.shiftPeriod,
        role: form.role.trim(),
        minStaff: Math.max(0, Number(form.minStaff) || 0),
      }),
    onSuccess: () => {
      setForm({ role: '', dayOfWeek: '', shiftPeriod: 'pm', minStaff: '1' });
      void qc.invalidateQueries({ queryKey: ['team-next-coverage-rules', rid] });
      void qc.invalidateQueries({ queryKey: ['team-next-week', rid, weekStart] });
    },
  });

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--paper-2)' }}>
      <div className="flex flex-wrap items-end gap-2">
        <label style={{ flex: '1 1 150px' }}>
          <span className="tm-label">Role</span>
          <input
            className="tm-input"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="Floor, Bar, Host…"
          />
        </label>
        <label>
          <span className="tm-label">Day</span>
          <select
            className="tm-select"
            value={form.dayOfWeek}
            onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}
          >
            <option value="">Every day</option>
            {DOW_JS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="tm-label">Service</span>
          <select
            className="tm-select"
            value={form.shiftPeriod}
            onChange={(e) => setForm({ ...form, shiftPeriod: e.target.value })}
          >
            <option value="am">day</option>
            <option value="pm">evening</option>
          </select>
        </label>
        <label>
          <span className="tm-label">People</span>
          <input
            type="number"
            min={0}
            className="tm-input"
            style={{ width: 74 }}
            value={form.minStaff}
            onChange={(e) => setForm({ ...form, minStaff: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="tm-ctl"
          disabled={!form.role.trim() || add.isPending}
          onClick={() => add.mutate()}
        >
          {add.isPending ? 'Adding…' : 'Add coverage rule'}
        </button>
      </div>
      <MutationError when={add.isError}>
        The rule was not saved — the engine is still idle. Try again.
      </MutationError>
    </div>
  );
}

function GapRow({
  gap,
  weekStart,
  scheduleId,
}: {
  gap: GapVM;
  weekStart: string;
  scheduleId: string | null;
}) {
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const assign = useMutation({
    // camelCase per the gateway's CreateShiftDto (`forbidNonWhitelisted`
    // rejects snake_case bodies outright). `shiftType` is omitted on purpose:
    // the server derives am/pm from the start time.
    mutationFn: () =>
      createShift({
        scheduleId: scheduleId ?? undefined,
        shiftDate: gap.date,
        startTime: gap.times!.start,
        endTime: gap.times!.end,
        role: gap.role,
        memberId: gap.suggested!.memberId,
      }),
    // No terminal "assigned" latch: the week refetch recomputes the gap, and a
    // 2-unfilled row must come back assignable for the second slot.
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team-next-week', rid, weekStart] }),
  });

  const canAssign = gap.suggested !== null && gap.times !== null;
  const reason =
    gap.suggested === null
      ? 'no free, role-matching member this day'
      : gap.times === null
        ? 'no shift of this role to copy times from — set times in the shift desk'
        : null;

  return (
    <div
      className="flex flex-wrap items-center gap-3 py-2.5"
      style={{ borderBottom: '1px solid var(--paper-2)' }}
    >
      <span
        style={{
          fontFamily: 'var(--tm-mono)',
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-1)',
          minWidth: 82,
        }}
      >
        {gap.unfilled} unfilled
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
        {fmtWeekday(gap.date)} · {gap.role} · {periodLabel(gap.period)}
        {gap.times ? ` · ${gap.times.start.slice(0, 5)}–${gap.times.end.slice(0, 5)}` : ''}
      </span>
      <span className="ml-auto" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
        {gap.suggested
          ? `suggest ${gap.suggested.name} — ${gap.suggested.hoursThisWeek}h this week` +
            (gap.times ? ` · ${gap.times.source}` : '')
          : reason}
      </span>
      <button
        type="button"
        className="tm-ctl tm-ctl--sm"
        disabled={!canAssign || assign.isPending}
        onClick={() => assign.mutate()}
      >
        {assign.isPending ? 'Assigning…' : 'Assign'}
      </button>
      {/* the reason is on-screen text, not a hover-only title (a11y) */}
      {!canAssign && reason && gap.suggested !== null && (
        <span style={{ fontSize: 11, color: 'var(--ink-3)', width: '100%' }}>{reason}</span>
      )}
      <MutationError when={assign.isError}>
        The assignment did not go through — the desk still shows the gap. Try again or set
        the shift by hand in the grid.
      </MutationError>
    </div>
  );
}

function CertRow({ block }: { block: CertExposureVM }) {
  const renew = useMutation({
    mutationFn: () =>
      broadcast({
        title: 'Certification renewal needed',
        message: `Your ${block.cert.cert_type} is ${block.cert.status}. Please renew and upload the new document.`,
        memberIds: [block.memberId],
      }),
  });
  const shifts = block.shiftsThisWeek;
  return (
    <div
      className="flex flex-wrap items-center gap-3 py-2.5"
      style={{ borderBottom: '1px solid var(--paper-2)' }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1)' }}>
        {block.memberName}
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>
        {block.cert.cert_type} · {block.cert.status}
        {block.cert.expires_at ? ` · ${fmtDayShort(block.cert.expires_at.slice(0, 10))}` : ''}
      </span>
      <span
        className="ml-auto"
        style={{
          fontFamily: 'var(--tm-mono)',
          fontSize: 11,
          color: (shifts ?? 0) > 0 ? 'var(--ink-1)' : 'var(--ink-3)',
        }}
      >
        {shifts === null
          ? `${EM} shifts this week`
          : shifts > 0
            ? `scheduled for ${shifts} shift${shifts === 1 ? '' : 's'} this week`
            : 'not scheduled this week'}
      </span>
      {!block.memberLinked ? (
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          no linked account — a request would reach nobody
        </span>
      ) : (
        <button
          type="button"
          className="tm-ctl tm-ctl--sm"
          disabled={renew.isPending}
          onClick={() => renew.mutate()}
        >
          {renew.isPending ? 'Sending…' : 'Request renewal'}
        </button>
      )}
      {renew.isSuccess && (
        // NOT a latch. Nothing on the server records that a renewal was asked
        // for, so this page cannot know on the next load whether it was.
        // TODO(gateway, not this branch): record renewal requests against the
        // certification so this can become a state instead of a moment.
        <span style={{ fontSize: 11, color: 'var(--ink-3)', width: '100%' }}>
          Sent just now. Nothing records the request, so this will not show after a reload.
        </span>
      )}
      <MutationError when={renew.isError}>The request did not send. Try again.</MutationError>
    </div>
  );
}

/**
 * `/team` splits by role on BOTH halves. The legacy entry
 * (`TeamCommandPage.tsx:36-37`) always did; the redesign was routed straight to
 * the manager surface from `App.tsx`, so a non-manager with the flag on got the
 * shift desk — and `GET certifications` carries no role requirement server-side
 * (`team.service.ts:397`), so the whole credential file rendered to any member.
 *
 * TODO(gateway, not this branch): until `listCertifications` requires
 * owner/manager, the split below is defence in depth and not access control —
 * any member who calls the route directly still gets the credential file.
 */
export default function TeamNext({ ground }: { ground?: 'charcoal' }) {
  const { activeRole, user, activeRestaurantId } = useAuth();
  const role = activeRole ?? user?.role ?? null;

  if (!user || role == null) {
    return (
      <div className="tm-page mudavym">
        <p className="tm-quiet" style={{ padding: 40, textAlign: 'center' }}>
          Loading team…
        </p>
      </div>
    );
  }
  if (!activeRestaurantId && !user.restaurantId) {
    return (
      <div className="tm-page mudavym">
        <p className="tm-note" style={{ padding: 40, textAlign: 'center' }}>
          No restaurant selected. Switch branch from the header, then open Team again.
        </p>
      </div>
    );
  }
  return role === 'owner' || role === 'manager' ? (
    <TeamNextManager ground={ground} />
  ) : (
    <MyShiftsNext ground={ground} />
  );
}

type Overlay =
  | { kind: 'roster' }
  | { kind: 'member'; member: TeamMember | null }
  | { kind: 'shift'; target: ShiftSheetTarget }
  | { kind: 'publish'; republish: boolean }
  | { kind: 'copy' }
  | { kind: 'note'; only: string | null }
  | { kind: 'timeoff' }
  | { kind: 'trail' }
  | { kind: 'export' };

function TeamNextManager({ ground }: { ground?: 'charcoal' }) {
  ensureFraunces();
  const qc = useQueryClient();
  const rid = useActiveRestaurantId();
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [lens, setLens] = useState<Lens>('coverage');
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const exportAnchor = useRef<HTMLButtonElement | null>(null);

  const data = useTeamNextData(weekStart);
  const labor = data.labor;
  const rules = data.coverageRules;
  // Three states, three sentences: the rule file has not answered, it is empty
  // (the engine has never been asked for anything), or it holds rules and the
  // week genuinely meets all of them.
  const engineIdle = rules !== null && rules.length === 0;

  const refreshWeek = () => {
    void qc.invalidateQueries({ queryKey: ['team-next-week', rid, weekStart] });
    void qc.invalidateQueries({ queryKey: ['team-next-members', rid] });
    void qc.invalidateQueries({ queryKey: ['team-next-time-off', rid] });
    void qc.invalidateQueries({ queryKey: ['team-next-notes', rid, weekStart] });
  };

  const ownerCount = useMemo(
    () => (data.members === null ? null : data.members.filter((m) => m.role === 'owner').length),
    [data.members],
  );
  const pendingLeave = (data.timeOff ?? []).filter((r) => r.status === 'pending').length;

  return (
    <div className="tm-page mudavym" data-ground={ground === 'charcoal' ? 'charcoal' : undefined}>
      <div className="tm-wrap">
        <header className="tm-head">
          <div>
            <Wordmark size={13} />
            <h1 className="tm-title">Team</h1>
            <p className="tm-sub">
              {fmtWeekRange(weekStart)}
              {' · '}
              {data.membersCount === null ? EM : `${data.membersCount} members`}
              {data.week?.schedule ? ` · schedule ${data.week.schedule.status}` : ''}
            </p>
          </div>
          <div className="tm-headline">
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setOverlay({ kind: 'roster' })}
            >
              <UsersRound className="tm-icon" aria-hidden="true" />
              People · {data.membersCount === null ? EM : data.membersCount}
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setOverlay({ kind: 'timeoff' })}
            >
              <CalendarDays className="tm-icon" aria-hidden="true" />
              Time off
              {data.timeOff === null ? ` · ${EM}` : pendingLeave > 0 ? ` · ${pendingLeave}` : ''}
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setOverlay({ kind: 'note', only: null })}
            >
              <Megaphone className="tm-icon" aria-hidden="true" />
              Write a note
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--seal"
              onClick={() => setOverlay({ kind: 'publish', republish: data.published })}
            >
              <Send className="tm-icon" aria-hidden="true" />
              {data.published ? 'Re-publish' : 'Publish week'}
            </button>
          </div>
        </header>

        {data.isError && (
          <div className="tm-banner" role="alert">
            <span>
              {data.week
                ? `The week could not be refreshed (${data.errorMessage}) — what is below is the last answer, not the present.`
                : `The gateway could not be reached (${data.errorMessage}). The week is unknown — nothing below is claimed.`}
            </span>
            <button type="button" className="tm-ctl" onClick={data.refetch}>
              Try again
            </button>
          </div>
        )}

        {/* ── 1 · the founder's first object: what is unfilled ─────────────── */}
        <section aria-label="Coverage gaps" className="tm-panel" style={{ marginBottom: 16 }}>
          <h2 className="tm-panel__title">Unfilled — the week&apos;s first job</h2>
          {data.rulesFailed ? (
            <p className="tm-note" role="alert">
              The coverage rules could not be read, so whether anything is required this
              week is unknown — not nothing.
            </p>
          ) : !data.gapsKnown && !data.isError ? (
            <p className="tm-quiet">Reaching the gateway…</p>
          ) : engineIdle ? (
            <>
              <p className="tm-note">
                No coverage rule exists, so the staffing engine has never been asked for
                anything and this week has no gaps to show. That is an idle engine, not a
                staffed week — add the first rule and the gaps above become real.
              </p>
              <CoverageRuleForm weekStart={weekStart} />
            </>
          ) : data.gaps.length === 0 && data.gapsKnown && rules !== null ? (
            <p className="tm-note">
              Every required slot this week is staffed, against {rules.length} coverage rule
              {rules.length === 1 ? '' : 's'}. Nothing is waiting on you here.
            </p>
          ) : data.gaps.length === 0 ? (
            <p className="tm-quiet">Reaching the gateway…</p>
          ) : (
            <div style={{ borderTop: '1px solid var(--paper-2)' }}>
              {data.gaps.map((g) => (
                <GapRow
                  key={`${g.date}-${g.role}-${g.period}`}
                  gap={g}
                  weekStart={weekStart}
                  scheduleId={data.scheduleId}
                />
              ))}
            </div>
          )}
          {data.membersFailed && (
            <p className="tm-note" role="alert" style={{ fontSize: 11.5, marginTop: 8 }}>
              The roster could not be read — suggested covers are withheld, not empty.
            </p>
          )}
        </section>

        <div className="tm-grid2">
          {/* ── 2 · cost as you build the week ────────────────────────────── */}
          <section aria-label="Labour cost" className="tm-panel">
            <h2 className="tm-panel__title">The week&apos;s labour</h2>
            {!data.week ? (
              <p className="tm-quiet">
                {data.isError ? `${EM} — the week is unknown.` : 'Reaching the gateway…'}
              </p>
            ) : !labor?.enabled ? (
              <p className="tm-note">
                Labour tracking is off for this restaurant, so no figure is shown — a
                withheld number, not a zero. Turn it on in team settings to see cost build
                with the week.
              </p>
            ) : (
              <div>
                <span className="tm-fig">{fmtMoneyWhole(labor.totalCost)}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)', marginLeft: 8 }}>
                  {labor.totalHours}h scheduled
                  {data.target.pct === null
                    ? ' · no target set'
                    : ` · target ${data.target.pct}% of sales`}
                </span>
                {data.target.pct === null && (
                  <p style={{ fontSize: 11.5, color: 'var(--ink-3)', margin: '6px 0 0' }}>
                    {data.target.why}
                  </p>
                )}
                {labor.totalCost === null && (
                  <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '8px 0 0' }}>
                    {labor.unpricedShifts === null
                      ? 'The total cannot be computed, because at least one shift has no wage on file. A partial sum would read as the week.'
                      : `${labor.unpricedShifts} of ${(labor.pricedShifts ?? 0) + labor.unpricedShifts} assigned shifts have no wage on file, so there is no week total to show — not a $0 week.`}
                  </p>
                )}
                {data.overtimeNamed.length > 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-2)', margin: '8px 0 0' }}>
                    Over 40h before publish:{' '}
                    {data.overtimeNamed.map((o) => `${o.name} (${o.hours}h)`).join(', ')}
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '8px 0 0' }}>
                    No one crosses an overtime threshold as scheduled.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── 3 · credentials as exposure ───────────────────────────────── */}
          <section aria-label="Credentials" className="tm-panel">
            <h2 className="tm-panel__title">Credentials to check</h2>
            {data.certsFailed ? (
              <p className="tm-note" role="alert">
                The credentials file could not be read — exposure is unknown, not absent.
              </p>
            ) : !data.certsKnown && !data.isError ? (
              <p className="tm-quiet">Reaching the gateway…</p>
            ) : data.certsOnFile === 0 ? (
              <p className="tm-note">
                No credential is on file for anyone, so nothing can be checked against this
                week — an empty file, not a clean one.
              </p>
            ) : data.certExposures.length === 0 && data.certsKnown ? (
              <p className="tm-note">
                Every credential on file is valid through this week ({data.certsOnFile} on
                file).
              </p>
            ) : (
              <>
                {data.exposedMembers > 0 && (
                  <p
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink-1)',
                      borderLeft: '3px solid var(--ink-1)',
                      paddingLeft: 10,
                      margin: '0 0 8px',
                    }}
                  >
                    {data.exposedMembers} {data.exposedMembers === 1 ? 'person is' : 'people are'}{' '}
                    scheduled this week with an expired credential. A certification carries
                    no role and no shift, so which shifts require it is not recorded — check
                    before publishing rather than reading this as a count of blocked shifts.
                  </p>
                )}
                <div style={{ borderTop: '1px solid var(--paper-2)' }}>
                  {data.certExposures.map((b) => (
                    <CertRow key={b.cert.id} block={b} />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <hr className="tm-rule" />

        {/* ── the week itself ──────────────────────────────────────────────── */}
        <div className="tm-head" style={{ marginBottom: 10 }}>
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
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              onClick={() => setOverlay({ kind: 'copy' })}
            >
              Copy last week
            </button>
            <button
              type="button"
              className="tm-ctl tm-ctl--quiet"
              ref={exportAnchor}
              onClick={() => setOverlay({ kind: 'export' })}
            >
              <Download className="tm-icon" aria-hidden="true" />
              Export
            </button>
            {/* The import modal's apply path is a 1200ms `setTimeout` and a
                success toast (`components/team/ShiftImportModal.tsx:100-105`) —
                it uploads nothing and writes no shift. A working-looking button
                over a simulation is the one thing this page may not ship, so
                the control is here, disabled, with the reason. §13 carries the
                request to build the real import. */}
            <button type="button" className="tm-ctl" disabled title="No import route exists yet">
              <Upload className="tm-icon" aria-hidden="true" />
              Import a sheet
            </button>
          </div>
          <div className="tm-headline">
            <span className="tm-panel__title" style={{ margin: 0 }}>
              Lens
            </span>
            {LENSES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className="tm-ctl tm-ctl--sm"
                aria-pressed={lens === value}
                style={
                  lens === value
                    ? { background: 'var(--seal-tint)', borderColor: 'var(--seal)' }
                    : { borderColor: 'var(--paper-2)', color: 'var(--ink-2)' }
                }
                onClick={() => setLens(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="tm-quiet" style={{ marginBottom: 8 }}>
          The import control is disabled because no import route exists — the legacy dialog
          simulates the upload and reports a success it did not perform.
        </p>

        <CrewNoteStrip
          members={data.members}
          notes={data.notes}
          notesFailed={data.notesFailed}
          receipts={data.week?.receipts ?? null}
          published={data.published}
          weekStart={weekStart}
          onCompose={() => setOverlay({ kind: 'note', only: null })}
        />

        <WeekGrid
          weekStart={weekStart}
          shifts={data.shifts}
          members={data.members}
          membersFailed={data.membersFailed}
          certs={data.certs}
          coverage={data.week?.coverage.days ?? null}
          weekFailed={data.isError && !data.week}
          engineIdle={engineIdle}
          lens={lens}
          labourEnabled={labor?.enabled ?? false}
          scheduleId={data.scheduleId}
          onEditShift={(target) => setOverlay({ kind: 'shift', target })}
          onChanged={refreshWeek}
        />

        <hr className="tm-rule" />

        <TeamRecordSection
          labourEnabled={labor === null ? null : labor.enabled}
          wageVisible={data.wageVisible}
          target={data.target}
          settingsUpdatedAt={data.settingsUpdatedAt}
          settingsConfigured={data.settingsConfigured}
          coverageRuleCount={rules === null ? null : rules.length}
          certsOnFile={data.certsOnFile}
          onOpenTrail={() => setOverlay({ kind: 'trail' })}
        />
      </div>

      {overlay?.kind === 'roster' && (
        <RosterSheet
          members={data.members}
          membersFailed={data.membersFailed}
          shifts={data.shifts}
          certs={data.certs}
          timeOff={data.timeOff}
          wageVisible={data.wageVisible}
          onClose={() => setOverlay(null)}
          onEdit={(m) => setOverlay({ kind: 'member', member: m })}
          onAdd={() => setOverlay({ kind: 'member', member: null })}
        />
      )}
      {overlay?.kind === 'member' && (
        <MemberSheet
          member={overlay.member}
          wageVisible={data.wageVisible}
          ownerCount={ownerCount}
          onClose={() => setOverlay(null)}
          onChanged={refreshWeek}
        />
      )}
      {overlay?.kind === 'shift' && (
        <ShiftSheet
          target={overlay.target}
          members={data.members}
          scheduleId={data.scheduleId}
          onClose={() => setOverlay(null)}
          onChanged={refreshWeek}
        />
      )}
      {overlay?.kind === 'publish' && (
        <PublishPanel
          weekStart={weekStart}
          scheduleId={data.scheduleId}
          republish={overlay.republish}
          receiptsSeen={data.receiptsSeen}
          onClose={() => setOverlay(null)}
          onDone={refreshWeek}
        />
      )}
      {overlay?.kind === 'copy' && (
        <CopyWeekPanel
          weekStart={weekStart}
          shiftsOnTarget={data.shifts === null ? null : data.shifts.length}
          onClose={() => setOverlay(null)}
          onDone={refreshWeek}
        />
      )}
      {overlay?.kind === 'note' && (
        <CrewNoteSheet
          members={data.members}
          membersFailed={data.membersFailed}
          only={overlay.only}
          weekStart={weekStart}
          scheduleId={data.scheduleId}
          onClose={() => setOverlay(null)}
          onSent={refreshWeek}
        />
      )}
      {overlay?.kind === 'trail' && (
        <TrailSheet
          trail={data.trail}
          failed={data.trailFailed}
          members={data.members}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay?.kind === 'timeoff' && (
        <TimeOffSheet
          requests={data.timeOff}
          failed={data.timeOffFailed}
          members={data.members}
          weekStart={weekStart}
          onClose={() => setOverlay(null)}
          onChanged={refreshWeek}
        />
      )}
      {overlay?.kind === 'export' && (
        <ExportPopover
          anchorRef={exportAnchor}
          weekStart={weekStart}
          shifts={data.shifts}
          members={data.members}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}
