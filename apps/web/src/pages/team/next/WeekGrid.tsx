/**
 * The week, as a grid you can edit — the desk's operating half, on the Mudavym
 * layer. The facts are the legacy grid's (`ManagerShiftDesk.tsx:600-760`): day
 * columns carrying the day's coverage, member rows carrying that member's
 * hours, shift chips, an open-shift `+` in every empty cell, a right-click menu
 * on a chip, and open shifts that belong to nobody gathered under the grid.
 *
 * TWO THINGS ARE DELIBERATELY DIFFERENT.
 *
 * 1. **The lens changes the words, not the colours.** The legacy grid painted
 *    seven shift types in seven hues and then outlined risk in amber and rose.
 *    This house has one chromatic colour and it is the seal (ADR 0042), so the
 *    lens rewrites the chip's second line — cost, or the fairness reason, or the
 *    compliance reason — and anything that needs attention takes a rule on its
 *    leading edge. That reads in both grounds and does not depend on hue, which
 *    is also the only version of this that works for a colour-blind manager.
 * 2. **The inspector is a row expander, not a rail.** Selecting a chip opens the
 *    /inventory anatomy under that member's row: fact strip, cards, action bar.
 *    The founder confirmed the in-place expander as the house shape for a ledger
 *    table, and a schedule is one.
 */

import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CalendarX2,
  Copy,
  Pencil,
  Trash2,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';
import { Popover } from '@/components/mudavym';
import {
  createShift,
  deleteShift,
  offerCover,
  reportCallout,
  type Certification,
  type CoverageDay,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import {
  DOW,
  EM,
  fmtDayShort,
  fmtHours,
  fmtTime,
  resolveName,
  shiftHours,
  todayIso,
  weekDays,
} from './tm-format';
import { Card, Fact, KV, Mark } from './tm-bits';
import { PerformanceCard } from './PerformanceCard';
import type { ShiftSheetTarget } from './ShiftSheet';

export type Lens = 'coverage' | 'labour' | 'fairness' | 'compliance';

export const LENSES: ReadonlyArray<[Lens, string]> = [
  ['coverage', 'coverage'],
  ['labour', 'labour'],
  ['fairness', 'fairness'],
  ['compliance', 'compliance'],
];

interface GridProps {
  weekStart: string;
  /** `null` until the week answers. Seven days of "off" is not an answer. */
  shifts: Shift[] | null;
  members: TeamMember[] | null;
  membersFailed: boolean;
  certs: Certification[] | null;
  coverage: CoverageDay[] | null;
  /** True when the week read FAILED, as opposed to not having answered yet. */
  weekFailed: boolean;
  /** True when no coverage rule exists at all — a day is then not "covered". */
  engineIdle: boolean;
  lens: Lens;
  labourEnabled: boolean;
  scheduleId: string | null;
  onEditShift: (t: ShiftSheetTarget) => void;
  onChanged: () => void;
}

export function WeekGrid({
  weekStart,
  shifts,
  members,
  membersFailed,
  certs,
  coverage,
  weekFailed,
  engineIdle,
  lens,
  labourEnabled,
  scheduleId,
  onEditShift,
  onChanged,
}: GridProps) {
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const today = todayIso();
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Shift | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  // `shifts ?? []` inline would be a new array on every render, so every memo
  // below it would recompute on every render — the grid is the biggest thing on
  // the page and it redraws whenever an overlay opens.
  const rows = useMemo(() => shifts ?? [], [shifts]);

  const hoursById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      if (!s.member_id) continue;
      m.set(s.member_id, (m.get(s.member_id) ?? 0) + shiftHours(s.start_time, s.end_time));
    }
    return m;
  }, [rows]);

  /** Sat/Sun closes per member — the legacy fairness signal, unchanged. */
  const closesById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      if (!s.member_id || s.state === 'callout') continue;
      const dow = new Date(`${s.shift_date}T00:00:00`).getDay();
      if (dow !== 0 && dow !== 6) continue;
      const endH = Number(s.end_time.split(':')[0] ?? 0);
      if (endH < 22 && endH !== 0) continue;
      m.set(s.member_id, (m.get(s.member_id) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const lapsedIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of certs ?? []) {
      if (c.status === 'expired' || c.status === 'expiring') s.add(c.member_id);
    }
    return s;
  }, [certs]);

  function flagsFor(s: Shift): { fair: boolean; compliance: boolean; why: string } {
    const id = s.member_id;
    const hours = id ? (hoursById.get(id) ?? 0) : 0;
    const closes = id ? (closesById.get(id) ?? 0) : 0;
    const fair = hours > 40 || closes >= 2;
    const long = shiftHours(s.start_time, s.end_time) >= 6;
    const noBreak = long && !(s.shift_breaks?.length ?? 0);
    const lapsed = id ? lapsedIds.has(id) : false;
    const compliance = noBreak || lapsed || s.state === 'callout';
    const why =
      s.state === 'callout'
        ? 'called out'
        : lapsed
          ? 'credential lapsed'
          : noBreak
            ? 'no break planned'
            : hours > 40
              ? 'over 40h'
              : closes >= 2
                ? `${closes} weekend closes`
                : '';
    return { fair, compliance, why };
  }

  /** What the chip's second line says under the current lens. */
  function chipMeta(s: Shift): string {
    const f = flagsFor(s);
    if (lens === 'labour') {
      if (!labourEnabled) return 'labour off';
      // An unpriced shift is unknown, not free. `?? 0` here is exactly the
      // defect ADR 0089 found in the Tonight pulse.
      return s.labor_cost == null ? `${EM} not priced` : `$${Math.round(s.labor_cost)}`;
    }
    if (lens === 'fairness') return f.fair ? f.why || 'fairness' : (s.role ?? s.shift_type);
    if (lens === 'compliance') {
      return f.compliance ? f.why || 'check' : (s.role ?? s.shift_type);
    }
    return s.role ?? s.shift_type;
  }

  const duplicate = useMutation({
    mutationFn: (s: Shift) =>
      createShift({
        scheduleId: s.schedule_id ?? scheduleId ?? undefined,
        memberId: s.member_id ?? undefined,
        shiftDate: s.shift_date,
        startTime: s.start_time,
        endTime: s.end_time,
        role: s.role ?? undefined,
        shiftType: s.shift_type,
      }),
    onSuccess: onChanged,
  });
  const callout = useMutation({
    mutationFn: (shiftId: string) => reportCallout(shiftId),
    onSuccess: onChanged,
  });
  const drop = useMutation({
    mutationFn: (shiftId: string) => deleteShift(shiftId),
    onSuccess: () => {
      setSelected(null);
      onChanged();
    },
  });
  /**
   * Cover is offered to at most three people, chosen the way the legacy desk
   * chose them: active, free that day, position or skill matching the station,
   * an account to reach. The list is shown before it is sent — an offer is a
   * message to real people.
   */
  const cover = useMutation({
    mutationFn: (s: Shift) => offerCover(s.id, candidatesFor(s).map((m) => m.id)),
  });

  function candidatesFor(s: Shift): TeamMember[] {
    const busy = new Set(
      rows
        .filter((x) => x.shift_date === s.shift_date && x.member_id && x.state !== 'callout')
        .map((x) => x.member_id as string),
    );
    const role = (s.role ?? '').trim().toLowerCase();
    return (members ?? [])
      .filter((m) => m.status === 'active' && m.id !== s.member_id && !busy.has(m.id))
      .map((m) => {
        let score = 0;
        if (role && (m.position ?? '').trim().toLowerCase() === role) score += 3;
        if (role && m.skills.some((sk) => sk.trim().toLowerCase() === role)) score += 2;
        if (m.accountLinked) score += 1;
        return { m, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.m);
  }

  const selectedShift = rows.find((s) => s.id === selected) ?? null;
  const unassigned = rows.filter((s) => !s.member_id);

  /**
   * Three different silences, three different sentences. A week that has not
   * answered YET is not a week that failed, and neither is a week whose
   * coverage array simply has no row for this day.
   */
  function dayStatusLine(date: string): { text: string; short: boolean } {
    if (coverage === null) {
      return { text: weekFailed ? `${EM} not read` : 'reading…', short: false };
    }
    const cov = coverage.find((c) => c.date === date);
    if (!cov) return { text: `${EM} not read`, short: false };
    if (cov.openShifts > 0) return { text: `${cov.openShifts} open`, short: true };
    if (cov.status === 'gap') {
      const n = cov.gaps.length;
      return { text: `${n} rule${n === 1 ? '' : 's'} unmet`, short: true };
    }
    if (engineIdle) return { text: 'no rule to meet', short: false };
    return { text: 'covered', short: false };
  }

  return (
    <div className="tm-gridwrap">
      <div className="tm-grid">
        <div className="tm-row">
          <div className="tm-dayhead" style={{ textAlign: 'left' }}>
            <span className="tm-dayhead__d">Roster</span>
            <span className="tm-dayhead__s">
              {members === null ? `${EM} not read` : `${members.length} on file`}
            </span>
          </div>
          {days.map((d, i) => {
            const cov = (coverage ?? []).find((c) => c.date === d);
            const line = dayStatusLine(d);
            return (
              <div className="tm-dayhead" key={d} data-today={d === today ? 'true' : undefined}>
                <span className="tm-dayhead__d">{DOW[i]}</span>
                <span className="tm-dayhead__n">{fmtDayShort(d)}</span>
                <span className="tm-dayhead__s">
                  {cov ? `${cov.staffed} staffed` : `${EM} staffed`}
                </span>
                <span className="tm-dayhead__s" data-short={line.short ? 'true' : undefined}>
                  {line.text}
                </span>
              </div>
            );
          })}
        </div>

        {membersFailed ? (
          <p className="tm-alert" role="alert" style={{ margin: 14 }}>
            The roster could not be read, so the grid has no rows to draw — who works here
            is unknown, not nobody.
          </p>
        ) : members === null ? (
          <p className="tm-quiet" style={{ padding: 24, textAlign: 'center' }}>
            Reaching the gateway…
          </p>
        ) : members.length === 0 ? (
          <p className="tm-note" style={{ padding: 24, textAlign: 'center' }}>
            Nobody is on the roster, so there is no week to build. Add the first person
            from People.
          </p>
        ) : (
          members.map((m) => {
            const name = resolveName(m);
            const hours = hoursById.get(m.id) ?? null;
            const showExpander = selectedShift?.member_id === m.id;
            return (
              <div key={m.id}>
                <div className="tm-row">
                  <button
                    type="button"
                    className="tm-membercell"
                    onClick={() => onEditShift({ date: days[0], memberId: m.id })}
                    title="Add a shift for this person"
                  >
                    <Mark name={name} avatarUrl={m.avatar_url} owner={m.role === 'owner'} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="tm-membercell__name" data-known={String(name.known)}>
                        {name.text}
                      </span>
                      <span className="tm-membercell__sub">
                        {m.position ?? m.employment_type}
                      </span>
                    </span>
                    <span
                      className="tm-membercell__h"
                      data-over={hours !== null && hours > 40 ? 'true' : undefined}
                    >
                      {shifts === null ? EM : fmtHours(hours ?? 0)}
                    </span>
                  </button>
                  {days.map((d) => {
                    const cell = rows.filter((s) => s.member_id === m.id && s.shift_date === d);
                    return (
                      <div className="tm-cell" key={d}>
                        {cell.map((s) => {
                          const f = flagsFor(s);
                          const flagged =
                            (lens === 'fairness' && f.fair) ||
                            (lens === 'compliance' && f.compliance);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className="tm-chip"
                              data-selected={selected === s.id ? 'true' : undefined}
                              data-flag={flagged ? 'true' : undefined}
                              data-state={s.state}
                              onClick={() => setSelected(selected === s.id ? null : s.id)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                menuAnchor.current = e.currentTarget;
                                setSelected(s.id);
                                setMenuFor(s);
                              }}
                            >
                              <span className="tm-chip__t">
                                {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                              </span>
                              <span className="tm-chip__m">{chipMeta(s)}</span>
                            </button>
                          );
                        })}
                        {cell.length === 0 && (
                          <button
                            type="button"
                            className="tm-add"
                            aria-label={`Add a shift for ${name.text} on ${fmtDayShort(d)}`}
                            onClick={() => onEditShift({ date: d, memberId: m.id })}
                          >
                            <UserRoundPlus className="tm-icon" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {showExpander && selectedShift && (
                  <ShiftDetail
                    shift={selectedShift}
                    member={m}
                    candidates={candidatesFor(selectedShift)}
                    onEdit={() => onEditShift({ shift: selectedShift })}
                    onCallout={() => callout.mutate(selectedShift.id)}
                    onCover={() => cover.mutate(selectedShift)}
                    calloutPending={callout.isPending}
                    calloutFailed={callout.isError}
                    coverPending={cover.isPending}
                    coverFailed={cover.isError}
                    coverSent={cover.isSuccess}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {unassigned.length > 0 && (
        <div style={{ padding: '10px 12px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="tm-panel__title" style={{ margin: 0, alignSelf: 'center' }}>
            Open shifts
          </span>
          {unassigned.map((s) => (
            <button
              key={s.id}
              type="button"
              className="tm-chip"
              data-state="open"
              style={{ width: 'auto' }}
              onClick={() => onEditShift({ shift: s })}
            >
              <span className="tm-chip__t">
                {fmtDayShort(s.shift_date)} · {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
              </span>
              <span className="tm-chip__m">{s.role ?? 'nobody assigned'}</span>
            </button>
          ))}
        </div>
      )}

      {menuFor && (
        <Popover
          open
          onClose={() => setMenuFor(null)}
          anchorRef={menuAnchor}
          label="Shift actions"
          width={220}
          showClose={false}
        >
          <button
            type="button"
            className="mdv-item"
            onClick={() => {
              onEditShift({ shift: menuFor });
              setMenuFor(null);
            }}
          >
            <Pencil size={14} aria-hidden className="mdv-item__icon" />
            <span className="mdv-item__text">Edit shift</span>
          </button>
          <button
            type="button"
            className="mdv-item"
            onClick={() => {
              duplicate.mutate(menuFor);
              setMenuFor(null);
            }}
          >
            <Copy size={14} aria-hidden className="mdv-item__icon" />
            <span className="mdv-item__text">Duplicate onto the same day</span>
          </button>
          <button
            type="button"
            className="mdv-item"
            onClick={() => {
              callout.mutate(menuFor.id);
              setMenuFor(null);
            }}
          >
            <CalendarX2 size={14} aria-hidden className="mdv-item__icon" />
            <span className="mdv-item__text">Report a call-out</span>
          </button>
          <button
            type="button"
            className="mdv-item"
            onClick={() => {
              cover.mutate(menuFor);
              setMenuFor(null);
            }}
          >
            <UsersRound size={14} aria-hidden className="mdv-item__icon" />
            <span className="mdv-item__text">Offer cover</span>
          </button>
          <button
            type="button"
            className="mdv-item"
            onClick={() => {
              drop.mutate(menuFor.id);
              setMenuFor(null);
            }}
          >
            <Trash2 size={14} aria-hidden className="mdv-item__icon" />
            <span className="mdv-item__text">Delete shift</span>
          </button>
          <p className="mdv-note">
            Deleting removes the shift from the week at once. Nobody who has already seen
            the published schedule is told it changed.
          </p>
        </Popover>
      )}

      {(duplicate.isError || drop.isError) && (
        <p className="tm-alert" role="alert" style={{ margin: 12 }}>
          {duplicate.isError
            ? 'The shift was not duplicated — the week is unchanged.'
            : 'The shift was not deleted — it is still on the schedule.'}
        </p>
      )}
    </div>
  );
}

/* ── the row expander under a selected shift ─────────────────────────────── */

function ShiftDetail({
  shift,
  member,
  candidates,
  onEdit,
  onCallout,
  onCover,
  calloutPending,
  calloutFailed,
  coverPending,
  coverFailed,
  coverSent,
}: {
  shift: Shift;
  member: TeamMember;
  candidates: TeamMember[];
  onEdit: () => void;
  onCallout: () => void;
  onCover: () => void;
  calloutPending: boolean;
  calloutFailed: boolean;
  coverPending: boolean;
  coverFailed: boolean;
  coverSent: boolean;
}) {
  const name = resolveName(member);
  return (
    <div className="tm-expand">
      <div className="tm-facts">
        <Fact k="Who" v={name.text} />
        <Fact k="When" v={`${fmtDayShort(shift.shift_date)} · ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}`} />
        <Fact k="Station" v={shift.role ?? EM} />
        <Fact k="Kind" v={shift.shift_type} />
        <Fact k="State" v={shift.state} />
        <Fact
          k="Cost"
          v={shift.labor_cost == null ? `${EM} not priced` : `$${Math.round(shift.labor_cost)}`}
        />
      </div>
      <div className="tm-cards">
        <Card title="Cover, if this falls through">
          {candidates.length === 0 ? (
            <p className="tm-quiet">
              Nobody on the roster is active, free that day and matched to this station, so
              an offer would reach nobody.
            </p>
          ) : (
            candidates.map((c) => {
              const n = resolveName(c);
              return (
                <KV
                  key={c.id}
                  k={n.text}
                  v={c.accountLinked ? (c.position ?? 'free') : 'no account'}
                />
              );
            })
          )}
          {coverSent && (
            <p className="tm-hint">
              Offered just now. Nothing records the offer against the shift, so this will
              not show after a reload.
            </p>
          )}
        </Card>
        {shift.note && (
          <Card title="Note">
            <p className="tm-note">{shift.note}</p>
          </Card>
        )}
        <PerformanceCard memberId={member.id} memberName={name.text} />
      </div>
      <div className="tm-actions">
        <button type="button" className="tm-ctl" onClick={onEdit}>
          Edit shift
        </button>
        <button
          type="button"
          className="tm-ctl tm-ctl--quiet"
          disabled={calloutPending}
          onClick={onCallout}
        >
          {calloutPending ? 'Reporting…' : 'Report a call-out'}
        </button>
        <button
          type="button"
          className="tm-ctl tm-ctl--quiet"
          disabled={coverPending || candidates.length === 0}
          onClick={onCover}
        >
          {coverPending ? 'Offering…' : `Offer cover to ${candidates.length}`}
        </button>
      </div>
      {calloutFailed && (
        <p className="tm-alert" role="alert">
          The call-out was not reported, so the shift is unchanged and still shows as
          worked.
        </p>
      )}
      {coverFailed && (
        <p className="tm-alert" role="alert">
          The cover offer did not send. Nobody was asked.
        </p>
      )}
    </div>
  );
}
