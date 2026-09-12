/**
 * TeamNext — the Mudavym redesign of `/team` (ADR 0045 §5 wave,
 * MAKEOVER-VERDICTS: KEEP, "spot on", plus three founder-requested additions
 * built here as the page's leading objects):
 *
 * 1. Coverage gaps are the FIRST object — named, countable rows ("2 unfilled
 *    · Saturday · line"), each with a real suggested cover (role-matching,
 *    free that day, fewest hours this week — a fair-rotation derivation, not
 *    an AI claim) and one control to assign. And, because gaps are this page's
 *    declared first object, the page can START the engine that produces them:
 *    with no coverage rule on file it says the engine is idle and offers the
 *    form that creates the first rule (ADR 0089).
 * 2. Labour cost as the week builds — total vs target with overtime named,
 *    only when labour tracking is on; withheld in words otherwise.
 * 3. Credentials as exposure — an expired card names the member and how much
 *    of their week is at stake, and says plainly that nothing records which
 *    shifts require it. `team_certifications` has no role or applies-to
 *    column, so a "blocked shifts" count would assert a link the schema does
 *    not have (ADR 0089).
 *
 * Motions (06-pages/team.md §1b): panel rows settle open; ink micro-states.
 * Honesty: unknown figures are em dashes; an unparseable gap period disables
 * the one-tap assign and says why rather than guessing times.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wordmark } from '@/components/mudavym';
import { useAuth } from '../../../contexts/AuthContext';
import { MyShifts } from '../command/MyShifts';
import { broadcast, createCoverageTemplate, createShift } from '../../../services/api/team';
import { ink } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, fmtDayShort, fmtMoneyWhole, fmtWeekday } from './tm-format';
import {
  useActiveRestaurantId,
  useTeamNextData,
  type CertExposureVM,
  type GapVM,
} from './useTeamNextData';

function PanelTitle({ children }: { children: string }) {
  return (
    <h2
      style={{
        fontFamily: MONO,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--ink-3, #7C7365)',
        margin: '0 0 10px',
      }}
    >
      {children}
    </h2>
  );
}

const panelStyle = {
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-1, #F3EFE6)',
  borderRadius: 12,
  padding: '16px 18px',
} as const;

const noteStyle = {
  fontFamily: SANS,
  fontSize: 12.5,
  color: 'var(--ink-2, #4F473C)',
  margin: 0,
} as const;

const quietStyle = { ...noteStyle, color: 'var(--ink-3, #7C7365)' } as const;

const fieldStyle = {
  fontFamily: SANS,
  fontSize: 12.5,
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FAF7F1)',
  color: 'var(--ink-1, #211C16)',
} as const;

const labelStyle = {
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  display: 'block',
  marginBottom: 3,
} as const;

const ctlStyle = {
  fontSize: 11.5,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 8,
  border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
  color: 'var(--seal-deep, #14515C)',
  cursor: 'pointer',
} as const;

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
 * legacy Ops drawer this page's flag replaces. A surface that names a job it
 * cannot start is worse than one that admits the engine is off.
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
    <div
      style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--paper-2, #EAE4D8)' }}
    >
      <div className="flex flex-wrap items-end gap-2" style={{ fontFamily: SANS }}>
        <label style={{ flex: '1 1 150px' }}>
          <span style={labelStyle}>Role</span>
          <input
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="Floor, Bar, Host…"
            style={{ ...fieldStyle, width: '100%' }}
          />
        </label>
        <label>
          <span style={labelStyle}>Day</span>
          <select
            value={form.dayOfWeek}
            onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}
            style={fieldStyle}
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
          <span style={labelStyle}>Service</span>
          <select
            value={form.shiftPeriod}
            onChange={(e) => setForm({ ...form, shiftPeriod: e.target.value })}
            style={fieldStyle}
          >
            <option value="am">day</option>
            <option value="pm">evening</option>
          </select>
        </label>
        <label>
          <span style={labelStyle}>People</span>
          <input
            type="number"
            min={0}
            value={form.minStaff}
            onChange={(e) => setForm({ ...form, minStaff: e.target.value })}
            style={{ ...fieldStyle, width: 70 }}
          />
        </label>
        <button
          type="button"
          className="tm-ctl"
          disabled={!form.role.trim() || add.isPending}
          onClick={() => add.mutate()}
          style={{
            ...ctlStyle,
            cursor: form.role.trim() && !add.isPending ? 'pointer' : 'not-allowed',
            background: form.role.trim() ? undefined : 'var(--paper-2, #EAE4D8)',
            color: form.role.trim() ? ctlStyle.color : 'var(--ink-3, #7C7365)',
          }}
        >
          {add.isPending ? 'Adding…' : 'Add coverage rule'}
        </button>
      </div>
      {add.isError && (
        <p role="alert" style={{ ...noteStyle, fontSize: 11, marginTop: 8 }}>
          The rule was not saved — the engine is still idle. Try again.
        </p>
      )}
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
    // camelCase per the gateway's CreateShiftDto (forbidNonWhitelisted rejects
    // snake_case bodies outright — team-audit.md, BLOCKER 3). shiftType is
    // omitted on purpose: the server derives am/pm from the start time.
    mutationFn: () =>
      createShift({
        scheduleId: scheduleId ?? undefined,
        shiftDate: gap.date,
        startTime: gap.times!.start,
        endTime: gap.times!.end,
        role: gap.role,
        memberId: gap.suggested!.memberId,
      }),
    // No terminal "assigned" latch: the week refetch recomputes the gap, and
    // a 2-unfilled row must come back assignable for the second slot.
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
      style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)', fontFamily: SANS }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--ink-1, #211C16)',
          minWidth: 82,
        }}
      >
        {gap.unfilled} unfilled
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
        {fmtWeekday(gap.date)} · {gap.role} · {periodLabel(gap.period)}
        {gap.times ? ` · ${gap.times.start.slice(0, 5)}–${gap.times.end.slice(0, 5)}` : ''}
      </span>
      <span className="ml-auto" style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
        {gap.suggested
          ? `suggest ${gap.suggested.name} — ${gap.suggested.hoursThisWeek}h this week` +
            (gap.times ? ` · ${gap.times.source}` : '')
          : reason}
      </span>
      <button
        type="button"
        className="tm-ctl"
        disabled={!canAssign || assign.isPending}
        onClick={() => assign.mutate()}
        style={{
          fontSize: 11.5,
          fontWeight: 600,
          padding: '4px 10px',
          borderRadius: 8,
          border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
          background: canAssign ? undefined : 'var(--paper-2, #EAE4D8)',
          color: canAssign ? 'var(--seal-deep, #14515C)' : 'var(--ink-3, #7C7365)',
          cursor: canAssign && !assign.isPending ? 'pointer' : 'not-allowed',
        }}
      >
        {assign.isPending ? 'Assigning…' : 'Assign'}
      </button>
      {/* the reason is on-screen text, not a hover-only title (a11y) */}
      {!canAssign && reason && gap.suggested !== null && (
        <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', width: '100%' }}>{reason}</span>
      )}
      {assign.isError && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', width: '100%' }}>
          The assignment did not go through — the desk still shows the gap. Try again or use the
          shift desk.
        </span>
      )}
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
      style={{ borderBottom: '1px solid var(--paper-2, #EAE4D8)', fontFamily: SANS }}
    >
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
        {block.memberName}
      </span>
      <span style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
        {block.cert.cert_type} · {block.cert.status}
        {block.cert.expires_at ? ` · ${fmtDayShort(block.cert.expires_at.slice(0, 10))}` : ''}
      </span>
      <span
        className="ml-auto"
        style={{
          fontFamily: MONO,
          fontSize: 11,
          color: (shifts ?? 0) > 0 ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
        }}
      >
        {shifts === null
          ? `${EM} shifts this week`
          : shifts > 0
            ? `scheduled for ${shifts} shift${shifts === 1 ? '' : 's'} this week`
            : 'not scheduled this week'}
      </span>
      {!block.memberLinked ? (
        <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
          no linked account — a request would reach nobody
        </span>
      ) : (
        <button
          type="button"
          className="tm-ctl"
          disabled={renew.isPending}
          onClick={() => renew.mutate()}
          style={{ ...ctlStyle, fontSize: 11.5, padding: '4px 10px' }}
        >
          {renew.isPending ? 'Sending…' : 'Request renewal'}
        </button>
      )}
      {renew.isSuccess && (
        // NOT a latch. Nothing on the server records that a renewal was asked
        // for, so this page cannot know on the next load whether it was — it
        // says only what it just did.
        // TODO(gateway, not this branch): record renewal requests against the
        // certification so this can become a state instead of a moment.
        <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)', width: '100%' }}>
          Sent just now. Nothing records the request, so this will not show after a reload.
        </span>
      )}
      {renew.isError && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', width: '100%' }}>
          The request did not send. Try again.
        </span>
      )}
    </div>
  );
}

/**
 * `/team` splits by role on BOTH halves now. The legacy entry
 * (`TeamCommandPage.tsx:36-37`) always did; the redesign was routed straight to
 * the manager surface from `App.tsx`, so a non-manager with the flag on got the
 * shift desk — and while most of its writes 403, `GET certifications` carries
 * no role requirement server-side (`team.service.ts:397`), so the whole
 * credential file rendered to any member. A hidden route is not access control:
 * the gateway half of this is a separate branch's, and until it lands the
 * client must not ask for what it should not show.
 *
 * TODO(gateway, not this branch): `listCertifications` calls
 * `assertAccess(userId, restaurantId)` with NO required role
 * (`apps/api-gateway/src/team/team.service.ts:397`). Until it requires
 * owner/manager, the split below is defence in depth and not access control —
 * any member who calls `GET /restaurants/:rid/team/certifications` directly
 * still gets the whole credential file.
 */
export default function TeamNext() {
  const { activeRole, user, activeRestaurantId } = useAuth();
  const role = activeRole ?? user?.role ?? null;

  if (!user || role == null) {
    return (
      <div className="p-10 text-center" style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-3, #7C7365)' }}>
        Loading team…
      </div>
    );
  }
  if (!activeRestaurantId && !user.restaurantId) {
    return (
      <div className="p-10 text-center" style={{ fontFamily: SANS, fontSize: 13, color: 'var(--ink-2, #4F473C)' }}>
        No restaurant selected. Switch branch from the header, then open Team again.
      </div>
    );
  }
  return role === 'owner' || role === 'manager' ? <TeamNextManager /> : <MyShifts />;
}

function TeamNextManager() {
  const data = useTeamNextData();
  const labor = data.week?.labor ?? null;
  const rules = data.coverageRules;
  // Three states, three sentences: the rule file has not answered, it is
  // empty (the engine has never been asked for anything), or it holds rules
  // and the week genuinely meets all of them.
  const engineIdle = rules !== null && rules.length === 0;

  return (
    <div
      className="mudavym min-h-screen"
      style={{ background: 'var(--paper-0, #FAF7F1)', color: 'var(--ink-1, #211C16)' }}
    >
      <style>{`
        .tm-ctl { transition: background ${ink.ms}ms ${ink.easing}, border-color ${ink.ms}ms ${ink.easing} }
        .tm-ctl:hover:not(:disabled) { background: var(--seal-tint, rgba(26,94,107,.10)) }
        .tm-ctl:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        @media (prefers-reduced-motion: reduce) { .tm-ctl, [data-tm-chip] { transition: none !important } }
      `}</style>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Wordmark size={13} />
            <h1
              style={{
                fontFamily: SERIF,
                fontSize: 30,
                fontWeight: 600,
                letterSpacing: '-0.015em',
                lineHeight: 1.1,
                margin: '4px 0 0',
              }}
            >
              Team
            </h1>
          </div>
          <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
            week of {fmtDayShort(data.weekStart)}
            {' · '}
            {data.membersCount === null ? EM : `${data.membersCount} members`}
            {data.week?.schedule ? ` · schedule ${data.week.schedule.status}` : ''}
          </span>
        </header>

        {data.isError && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{ fontFamily: SANS, border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
              {data.week
                ? `The week could not be refreshed (${data.errorMessage}) — what is below is the last answer, not the present.`
                : `The gateway could not be reached (${data.errorMessage}). The week is unknown — nothing below is claimed.`}
            </span>
            <button type="button" className="tm-ctl" onClick={data.refetch} style={{ ...ctlStyle, fontSize: 12 }}>
              Try again
            </button>
          </div>
        )}

        {/* ── 1 · the founder's first object: what is unfilled ─────────── */}
        <section aria-label="Coverage gaps" style={{ ...panelStyle, marginBottom: 16 }}>
          <PanelTitle>Unfilled — the week's first job</PanelTitle>
          {data.rulesFailed ? (
            <p role="alert" style={noteStyle}>
              The coverage rules could not be read, so whether anything is required this week is
              unknown — not nothing.
            </p>
          ) : !data.gapsKnown && !data.isError ? (
            <p style={quietStyle}>Reaching the gateway…</p>
          ) : engineIdle ? (
            <>
              <p style={noteStyle}>
                No coverage rule exists, so the staffing engine has never been asked for anything
                and this week has no gaps to show. That is an idle engine, not a staffed week — add
                the first rule and the gaps above become real.
              </p>
              <CoverageRuleForm weekStart={data.weekStart} />
            </>
          ) : data.gaps.length === 0 && data.gapsKnown && rules !== null ? (
            <p style={noteStyle}>
              Every required slot this week is staffed, against {rules.length} coverage rule
              {rules.length === 1 ? '' : 's'}. Nothing is waiting on you here.
            </p>
          ) : data.gaps.length === 0 ? (
            <p style={quietStyle}>Reaching the gateway…</p>
          ) : (
            <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
              {data.gaps.map((g) => (
                <GapRow
                  key={`${g.date}-${g.role}-${g.period}`}
                  gap={g}
                  weekStart={data.weekStart}
                  scheduleId={data.scheduleId}
                />
              ))}
            </div>
          )}
          {data.membersFailed && (
            <p role="alert" style={{ ...noteStyle, fontSize: 11.5, margin: '8px 0 0' }}>
              The roster could not be read — suggested covers are withheld, not empty.
            </p>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2" style={{ marginBottom: 16 }}>
          {/* ── 2 · cost as you build the week ─────────────────────────── */}
          <section aria-label="Labour cost" style={panelStyle}>
            <PanelTitle>The week's labour</PanelTitle>
            {!data.week ? (
              <p style={quietStyle}>
                {data.isError ? `${EM} — the week is unknown.` : 'Reaching the gateway…'}
              </p>
            ) : !labor?.enabled ? (
              <p style={noteStyle}>
                Labour tracking is off for this restaurant, so no figure is shown — a withheld
                number, not a zero. Turn it on in team settings to see cost build with the week.
              </p>
            ) : (
              <div style={{ fontFamily: SANS }}>
                <span
                  style={{
                    fontFamily: MONO,
                    // wave value: page-level figures sit at 22 across Mudavym
                    // pages (so-format's Count, CommunicationsNext's glance
                    // strip) — this was the one holdout at 26.
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtMoneyWhole(labor.totalCost ?? null)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)', marginLeft: 8 }}>
                  {labor.totalHours}h scheduled
                  {typeof labor.targetPct === 'number' ? ` · target ${labor.targetPct}% of sales` : ''}
                </span>
                {data.overtimeNamed.length > 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '8px 0 0' }}>
                    Over 40h before publish:{' '}
                    {data.overtimeNamed.map((o) => `${o.name} (${o.hours}h)`).join(', ')}
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)', margin: '8px 0 0' }}>
                    No one crosses an overtime threshold as scheduled.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── 3 · credentials as exposure ─────────────────────────────── */}
          <section aria-label="Credentials" style={panelStyle}>
            <PanelTitle>Credentials to check</PanelTitle>
            {data.certsFailed ? (
              <p role="alert" style={noteStyle}>
                The credentials file could not be read — exposure is unknown, not absent.
              </p>
            ) : !data.certsKnown && !data.isError ? (
              <p style={quietStyle}>Reaching the gateway…</p>
            ) : data.certsOnFile === 0 ? (
              <p style={noteStyle}>
                No credential is on file for anyone, so nothing can be checked against this week —
                an empty file, not a clean one.
              </p>
            ) : data.certExposures.length === 0 && data.certsKnown ? (
              <p style={noteStyle}>
                Every credential on file is valid through this week ({data.certsOnFile} on file).
              </p>
            ) : (
              <>
                {data.exposedMembers > 0 && (
                  <p
                    style={{
                      fontFamily: SANS,
                      fontSize: 12.5,
                      color: 'var(--ink-1, #211C16)',
                      borderLeft: '3px solid var(--ink-1, #211C16)',
                      paddingLeft: 10,
                      margin: '0 0 8px',
                    }}
                  >
                    {data.exposedMembers} {data.exposedMembers === 1 ? 'person is' : 'people are'}{' '}
                    scheduled this week with an expired credential. A certification carries no role
                    and no shift, so which shifts require it is not recorded — check before
                    publishing rather than reading this as a count of blocked shifts.
                  </p>
                )}
                <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                  {data.certExposures.map((b) => (
                    <CertRow key={b.cert.id} block={b} />
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ── the week at a glance ─────────────────────────────────────── */}
        {data.week && (
          <section aria-label="Week coverage" style={panelStyle}>
            <PanelTitle>The week, day by day</PanelTitle>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', fontFamily: SANS }}>
              {data.week.coverage.days.map((d) => (
                <div
                  key={d.date}
                  className="rounded-lg px-3 py-2"
                  style={{
                    background: 'var(--paper-0, #FAF7F1)',
                    border:
                      d.status === 'gap'
                        ? '1px solid var(--ink-2, #4F473C)'
                        : '1px solid var(--paper-2, #EAE4D8)',
                    transition: `border-color ${ink.ms}ms ${ink.easing}`,
                  }}
                  data-tm-chip
                >
                  <span style={{ display: 'block', fontFamily: MONO, fontSize: 9.5, color: 'var(--ink-3, #7C7365)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {fmtDayShort(d.date)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--ink-1, #211C16)' }}>
                    {d.staffed} staffed
                  </span>
                  {/* A day whose own status is 'gap' is not "covered" just
                      because no shift row is unassigned: the gap is a coverage
                      RULE that is unmet, which is a different thing. */}
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color:
                        d.openShifts > 0 || d.status === 'gap'
                          ? 'var(--ink-2, #4F473C)'
                          : 'var(--ink-3, #7C7365)',
                    }}
                  >
                    {d.openShifts > 0
                      ? `${d.openShifts} open`
                      : d.status === 'gap'
                        ? `${d.gaps.length} rule${d.gaps.length === 1 ? '' : 's'} unmet`
                        : engineIdle
                          ? 'no rule to meet'
                          : 'covered'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
