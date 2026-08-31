/**
 * TeamNext — the Mudavym redesign of `/team` (ADR 0045 §5 wave,
 * MAKEOVER-VERDICTS: KEEP, "spot on", plus three founder-requested additions
 * built here as the page's leading objects):
 *
 * 1. Coverage gaps are the FIRST object — named, countable rows ("2 unfilled
 *    · Saturday · line"), each with a real suggested cover (role-matching,
 *    free that day, fewest hours this week — a fair-rotation derivation, not
 *    an AI claim) and one control to assign.
 * 2. Labour cost as the week builds — total vs target with overtime named,
 *    only when labour tracking is on; withheld in words otherwise.
 * 3. Credentials as blockers, not badges — an expired card blocks the shifts
 *    its member holds this week, with a one-tap renewal request; a schedule
 *    with blocked shifts says it should not be published.
 *
 * Motions (06-pages/team.md §1b): panel rows settle open; ink micro-states.
 * Honesty: unknown figures are em dashes; an unparseable gap period disables
 * the one-tap assign and says why rather than guessing times.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wordmark } from '@/components/mudavym';
import { broadcast, createShift } from '../../../services/api/team';
import { ink } from '../../../lib/mudavym/motion';
import { EM, MONO, SANS, SERIF, fmtDayShort, fmtMoneyWhole, fmtWeekday } from './tm-format';
import { useTeamNextData, type CertBlockVM, type GapVM } from './useTeamNextData';

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

/** Coverage rules speak "am"/"pm" — said as service language on screen. */
function periodLabel(period: string): string {
  if (period === 'am') return 'day';
  if (period === 'pm') return 'evening';
  return period;
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
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['team-next-week', weekStart] }),
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
          background: canAssign ? 'transparent' : 'var(--paper-2, #EAE4D8)',
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

function CertRow({ block }: { block: CertBlockVM }) {
  const [requested, setRequested] = useState(false);
  const renew = useMutation({
    mutationFn: () =>
      broadcast({
        title: 'Certification renewal needed',
        message: `Your ${block.cert.cert_type} is ${block.cert.status}. Please renew and upload the new document — shifts it covers are blocked until then.`,
        memberIds: [block.memberId],
      }),
    onSuccess: () => setRequested(true),
  });
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
      <span className="ml-auto" style={{ fontFamily: MONO, fontSize: 11, color: block.blockedShifts > 0 ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)' }}>
        {block.blockedShifts > 0
          ? `blocks ${block.blockedShifts} shift${block.blockedShifts === 1 ? '' : 's'}`
          : block.cert.status === 'expiring'
            ? 'expires inside the window — blocks nothing yet'
            : 'no shifts this week'}
      </span>
      {requested ? (
        <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--seal-deep, #14515C)' }}>requested</span>
      ) : !block.memberLinked ? (
        <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
          no linked account — a request would reach nobody
        </span>
      ) : (
        <button
          type="button"
          className="tm-ctl"
          disabled={renew.isPending}
          onClick={() => renew.mutate()}
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
            background: 'transparent',
            color: 'var(--seal-deep, #14515C)',
            cursor: 'pointer',
          }}
        >
          {renew.isPending ? 'Sending…' : 'Request renewal'}
        </button>
      )}
      {renew.isError && (
        <span role="alert" style={{ fontSize: 11, color: 'var(--ink-2, #4F473C)', width: '100%' }}>
          The request did not send. Try again.
        </span>
      )}
    </div>
  );
}

export default function TeamNext() {
  const data = useTeamNextData();
  const labor = data.week?.labor ?? null;

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
            <button
              type="button"
              className="tm-ctl"
              onClick={data.refetch}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                borderRadius: 8,
                border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        )}

        {/* ── 1 · the founder's first object: what is unfilled ─────────── */}
        <section aria-label="Coverage gaps" style={{ ...panelStyle, marginBottom: 16 }}>
          <PanelTitle>Unfilled — the week's first job</PanelTitle>
          {!data.gapsKnown && !data.isError ? (
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
              Reaching the gateway…
            </p>
          ) : data.gaps.length === 0 && data.gapsKnown ? (
            <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
              Every required slot this week is staffed. Nothing is waiting on you here.
            </p>
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
            <p role="alert" style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-2, #4F473C)', margin: '8px 0 0' }}>
              The roster could not be read — suggested covers are withheld, not empty.
            </p>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2" style={{ marginBottom: 16 }}>
          {/* ── 2 · cost as you build the week ─────────────────────────── */}
          <section aria-label="Labour cost" style={panelStyle}>
            <PanelTitle>The week's labour</PanelTitle>
            {!data.week ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
                {data.isError ? `${EM} — the week is unknown.` : 'Reaching the gateway…'}
              </p>
            ) : !labor?.enabled ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
                Labour tracking is off for this restaurant, so no figure is shown — a withheld
                number, not a zero. Turn it on in team settings to see cost build with the week.
              </p>
            ) : (
              <div style={{ fontFamily: SANS }}>
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 26,
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

          {/* ── 3 · credentials as blockers ─────────────────────────────── */}
          <section aria-label="Credentials" style={panelStyle}>
            <PanelTitle>Credentials that block</PanelTitle>
            {data.certsFailed ? (
              <p role="alert" style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
                The credentials file could not be read — blockers are unknown, not absent.
              </p>
            ) : !data.certsKnown && !data.isError ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-3, #7C7365)', margin: 0 }}>
                Reaching the gateway…
              </p>
            ) : data.certBlocks.length === 0 && data.certsKnown ? (
              <p style={{ fontFamily: SANS, fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: 0 }}>
                Every credential on file is valid through this week.
              </p>
            ) : (
              <>
                {data.blockedTotal > 0 && (
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
                    {data.blockedTotal} shift{data.blockedTotal === 1 ? '' : 's'} this week{' '}
                    {data.blockedTotal === 1 ? 'is' : 'are'} held by an expired credential — this
                    schedule should not be published as it stands.
                  </p>
                )}
                <div style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)' }}>
                  {data.certBlocks.map((b) => (
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
                  <span style={{ display: 'block', fontSize: 11, color: d.openShifts > 0 ? 'var(--ink-2, #4F473C)' : 'var(--ink-3, #7C7365)' }}>
                    {d.openShifts > 0 ? `${d.openShifts} open` : 'covered'}
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
