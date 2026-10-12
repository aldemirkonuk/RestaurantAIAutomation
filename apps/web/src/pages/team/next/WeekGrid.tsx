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

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { houseToday } from '@/lib/houseZone';
import { houseWallClock } from '@/lib/houseCalendar';
import { useDraftWriteKey, writeOutcomeUnknown } from '@/lib/draftWriteKey';
import { serverMessage } from './TeamOverlays';
import {
  createShift,
  deleteShift,
  offerCover,
  reportCallout,
  type Certification,
  type CoverageDay,
  type HouseMoney,
  type Shift,
  type TeamMember,
} from '../../../services/api/team';
import {
  DOW,
  EM,
  breakCounted,
  breakUnderMinimum,
  fmtBreak,
  fmtDayShort,
  fmtHours,
  fmtMoneyWhole,
  houseLocale,
  recordedBreakMinutes,
  resolveName,
  todayIso,
  weekDays,
  workedHours,
} from './tm-format';
import {
  Card,
  Fact,
  KV,
  Mark,
  useHouseLabourRules,
  useHouseRegion,
  useShiftTime,
} from './tm-bits';
import { PerformanceCard } from './PerformanceCard';
import { deleteOrConfirm, type ShiftSheetTarget } from './ShiftSheet';

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
  /**
   * The owner only (ADR 0215). Anyone else gets hours: the gateway does not
   * send them a shift's cost, because the cost divided by the hours is the wage.
   */
  moneyVisible: boolean;
  /** The house's currency and country, sent with the money. */
  money: HouseMoney | null;
  scheduleId: string | null;
  onEditShift: (t: ShiftSheetTarget) => void;
  onChanged: () => void;
  /** The house's time zone (`useHouseZone`): "today" is the house's day, not the device's (F-1073). */
  zone?: string | null;
  /**
   * True when a person is on approved leave or Away that day (`useTeamNextData`).
   * Cover is never offered to them: the gateway refuses the claim (F-1148).
   */
  offOn?: (m: TeamMember, date: string) => boolean;
  /**
   * True once the week is published (F-1224). Until it is known to be, a
   * call-out and a cover offer are not offered: the crew has not seen the
   * week, so nobody could take its shifts.
   */
  published?: boolean;
}

/** A cover offer's answer: the people it was written to, and those with no account (F-1225). */
interface CoverReach {
  notified: number | null;
  noAccount: number;
}

/**
 * Whether a shift is over on the house's clock (`houseWallClock`), the
 * gateway's `shiftHasEnded`: an end before the start runs into the next day.
 */
function shiftEnded(s: Shift, nowWall: string): boolean {
  const end = s.end_time.slice(0, 5);
  let day = s.shift_date;
  if (end < s.start_time.slice(0, 5)) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    day = d.toISOString().slice(0, 10);
  }
  return `${day}T${end}` <= nowWall.slice(0, 16);
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
  moneyVisible,
  money,
  scheduleId,
  onEditShift,
  onChanged,
  zone,
  offOn,
  published = false,
}: GridProps) {
  const fmtTime = useShiftTime();
  const region = useHouseRegion();
  /** The house's decimal mark for hours (F-1120). */
  const hoursIn = houseLocale(region);
  /** The house's country's labour rules (founder S195); none claimed where not built in. */
  const rules = useHouseLabourRules();
  const reviewAt = rules.weeklyReviewHours;
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const today = todayIso(houseToday(zone));
  const [selected, setSelected] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Shift | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  /**
   * The cell a write came from (F-401). Adding a shift removes the empty
   * cell's `+` that opened the sheet, and deleting one removes the chip or the
   * expander whose button opened it, so the Sheet's own "back to the opener"
   * finds nothing and focus falls to <body>. When the week re-reads, focus goes
   * back to that cell instead: its first shift, or its `+`.
   */
  const focusCell = useRef<string | null>(null);
  /**
   * Shifts already offered for cover in this sitting (F-398): one offer each,
   * with whom it reached (F-1225).
   */
  const [offered, setOffered] = useState<ReadonlyMap<string, CoverReach>>(() => new Map());
  /** The cover slot each call-out reported in this sitting opened (F-1113). */
  const [slotOf, setSlotOf] = useState<ReadonlyMap<string, string>>(() => new Map());
  // `shifts ?? []` inline would be a new array on every render, so every memo
  // below it would recompute on every render — the grid is the biggest thing on
  // the page and it redraws whenever an overlay opens.
  const rows = useMemo(() => shifts ?? [], [shifts]);

  useEffect(() => {
    const key = focusCell.current;
    if (!key) return;
    const active = document.activeElement;
    // Focus that already landed back in the grid needs no help.
    if (active && active !== document.body && gridRef.current?.contains(active)) {
      focusCell.current = null;
      return;
    }
    if (active && active !== document.body) return; // still inside the sheet
    const cell = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${key}"]`);
    const target = cell?.querySelector<HTMLElement>('.tm-chip, .tm-add');
    if (target) {
      focusCell.current = null;
      target.focus();
    }
  }, [rows]);

  function rememberCell(memberId: string | null | undefined, date: string | undefined) {
    focusCell.current = memberId && date ? `${memberId}|${date}` : null;
  }
  function editShift(t: ShiftSheetTarget) {
    rememberCell(t.shift?.member_id ?? t.memberId, t.shift?.shift_date ?? t.date);
    onEditShift(t);
  }

  /** WORKED hours per person: breaks out, a called-out shift out (ADR 0215). */
  const hoursById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      if (!s.member_id || s.state === 'callout') continue;
      m.set(
        s.member_id,
        (m.get(s.member_id) ?? 0) + workedHours(s, rules),
      );
    }
    return m;
  }, [rows, rules]);

  /** Sat/Sun closes per member — the legacy fairness signal, unchanged. */
  const closesById = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rows) {
      if (!s.member_id || s.state === 'callout') continue;
      const dow = new Date(`${s.shift_date}T00:00:00`).getDay();
      if (dow !== 0 && dow !== 6) continue;
      const endH = Number(s.end_time.split(':')[0] ?? 0);
      // A close ends late, or after midnight: an end before the start
      // (18:00–01:00) is the next morning and counts too (F-379). Equal times
      // are a moment, not a night, as shiftHours reads them (F-874).
      const overnight = s.end_time.slice(0, 5) < s.start_time.slice(0, 5);
      if (endH < 22 && !overnight) continue;
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
    const overWeek = reviewAt != null && hours > reviewAt;
    const fair = overWeek || closes >= 2;
    // A shift with no break recorded is counted with the minimum its house's
    // country owes (ADR 0215; any length, founder round 6y; S195): the lens
    // says the break is assumed, and a recorded break shorter than the law
    // asks for says that instead.
    const assumedBreak = breakCounted(s, rules).assumed;
    const shortBreak = breakUnderMinimum(s, rules);
    // A day past the daily line (Germany's 10 hours, §3 ArbZG; California's
    // 8, Labor Code §510).
    const longDay =
      rules.dailyReviewHours != null && workedHours(s, rules) > rules.dailyReviewHours;
    const lapsed = id ? lapsedIds.has(id) : false;
    const compliance = assumedBreak || shortBreak || longDay || lapsed || s.state === 'callout';
    const why =
      s.state === 'callout'
        ? 'called out'
        : lapsed
          ? 'credential lapsed'
          : shortBreak
            ? 'break under the legal minimum'
            : longDay
              ? `over ${rules.dailyReviewHours}h in a day · review`
            : assumedBreak
              ? 'break assumed · not recorded'
              : overWeek
                ? `over ${reviewAt}h · review`
                : closes >= 2
                  ? `${closes} weekend closes`
                  : '';
    return { fair, compliance, why };
  }

  /** What the chip's second line says under the current lens. */
  function chipMeta(s: Shift): string {
    const f = flagsFor(s);
    if (lens === 'labour') {
      // Hours for anyone who is not the owner: the cost is withheld, not unknown.
      if (!moneyVisible) return fmtHours(workedHours(s, rules), hoursIn);
      if (!labourEnabled) return 'labour off';
      // An owner's shift, to a manager who sees pay: withheld because it is
      // the owner's (founder 2026-09-27, item 71), so hours, not "not priced".
      if (s.pay_withheld === 'owner') return fmtHours(workedHours(s, rules), hoursIn);
      // An unpriced shift is unknown, not free. `?? 0` here is exactly the
      // defect ADR 0089 found in the Tonight pulse.
      return s.labor_cost == null ? `${EM} not priced` : fmtMoneyWhole(s.labor_cost, money);
    }
    if (lens === 'fairness') return f.fair ? f.why || 'fairness' : (s.role ?? s.shift_type);
    if (lens === 'compliance') {
      return f.compliance ? f.why || 'check' : (s.role ?? s.shift_type);
    }
    return s.role ?? s.shift_type;
  }

  /**
   * A lost answer may be a written copy or a done delete (F-1118): the week
   * is read again, a second Duplicate of the same shift sends the same key so
   * the gateway answers it with the copy it already made, and a second Delete
   * that finds no shift is the first one's delete.
   */
  const duplicateKey = useDraftWriteKey('shift-duplicate');
  const triedDelete = useRef(new Set<string>());
  const duplicate = useMutation({
    mutationFn: (s: Shift) => {
      rememberCell(s.member_id, s.shift_date);
      const draft = {
        scheduleId: s.schedule_id ?? scheduleId ?? undefined,
        memberId: s.member_id ?? undefined,
        shiftDate: s.shift_date,
        startTime: s.start_time,
        endTime: s.end_time,
        role: s.role ?? undefined,
        shiftType: s.shift_type,
        // The copy keeps the break on record, as a copied week does (ADR
        // 0215); nothing on record stays nothing on record, so it is assumed.
        ...(recordedBreakMinutes(s) != null ? { breakMinutes: recordedBreakMinutes(s) } : {}),
      };
      return createShift(draft, undefined, duplicateKey.keyFor(draft));
    },
    onSuccess: () => {
      duplicateKey.renew();
      onChanged();
    },
    onError: (e) => {
      if (writeOutcomeUnknown(e)) onChanged();
    },
  });
  // F-1116: a retry after a lost answer carries the same key, so the gateway
  // answers with the first call-out instead of opening a second slot.
  const calloutKey = useDraftWriteKey('callout');
  const callout = useMutation({
    mutationFn: (shiftId: string) =>
      reportCallout(shiftId, undefined, undefined, calloutKey.keyFor({ shiftId })),
    onSuccess: (r, shiftId) => {
      calloutKey.renew();
      if (r?.open?.id) setSlotOf((prev) => new Map(prev).set(shiftId, r.open.id));
      onChanged();
    },
    // A refusal (already reported, already open) or a lost answer: the week is
    // read again, so the grid shows what the call-out actually left.
    onError: (e) => {
      if (writeOutcomeUnknown(e) || (e as { response?: { status?: number } })?.response?.status === 409)
        onChanged();
    },
  });
  const calloutNote = !callout.isError
    ? null
    : writeOutcomeUnknown(callout.error)
      ? 'We could not confirm the call-out. It may already be reported; the week has been read again, so check the shift before reporting it again.'
      : (callout.error as { response?: { status?: number } })?.response?.status === 409
        ? serverMessage(callout.error)
        : null;
  const drop = useMutation({
    mutationFn: (s: Shift) => {
      rememberCell(s.member_id, s.shift_date);
      return deleteOrConfirm(
        s.id,
        () => deleteShift(s.id, undefined, `shift-delete:${s.id}`),
        triedDelete.current,
      );
    },
    onSuccess: () => {
      setSelected(null);
      onChanged();
    },
    onError: (e) => {
      if (writeOutcomeUnknown(e)) onChanged();
    },
  });
  /**
   * Cover is offered to at most three people, chosen the way the legacy desk
   * chose them: active, free that day, position or skill matching the station,
   * an account to reach, not on leave or Away that day (F-1148). The list is
   * shown before it is sent — an offer is a message to real people.
   */
  const cover = useMutation({
    // F-1113: the push says "Tap to claim", so it names the open slot, never
    // the held or called-out row nobody can claim. The candidates are still
    // chosen against the called-out row, so its person is not asked.
    mutationFn: (s: Shift) => {
      const slot = coverSlotFor(s);
      if (!slot) throw new Error('no open slot to offer');
      const ids = candidatesFor(s).map((m) => m.id);
      // F-1225: an offer to nobody is never sent.
      if (!ids.length) throw new Error('nobody is free to ask');
      return offerCover(slot.id, ids);
    },
    // Nothing records the offer against the shift, so a second press would
    // push "Shift available" to the same people again. Once sent, it stays sent
    // for as long as the page is open, with whom it reached (F-1225).
    onSuccess: (r: { notified?: unknown; noAccount?: unknown } | undefined, s) =>
      setOffered((prev) =>
        new Map(prev).set(s.id, {
          notified: typeof r?.notified === 'number' ? r.notified : null,
          noAccount: typeof r?.noAccount === 'number' ? r.noAccount : 0,
        }),
      ),
  });

  /**
   * F-1224: why cover cannot be asked for on this shift, or `null` when it
   * can. A week the crew has not seen, or a shift that is over, has nobody
   * who could take it; the gateway refuses both.
   */
  function coverClosed(s: Shift): string | null {
    if (!published) {
      return 'This week is not published yet, so the crew has not seen it. A call-out or a cover offer can be made once it is.';
    }
    if (shiftEnded(s, houseWallClock(zone, Date.now()))) {
      return 'This shift is over, so there is no cover left to ask for.';
    }
    return null;
  }

  /**
   * The shift a cover offer may name: an open one. A called-out row's slot is
   * the one its call-out opened, or failing that the open shift on the same
   * window; a shift someone still holds has none until it is called out.
   */
  function coverSlotFor(s: Shift): Shift | null {
    if (!s.member_id || s.state === 'open') return s;
    if (s.state !== 'callout') return null;
    const isOpen = (x: Shift) => !x.member_id || x.state === 'open';
    const known = slotOf.get(s.id);
    const byId = known ? rows.find((x) => x.id === known && isOpen(x)) : undefined;
    return (
      byId ??
      rows.find(
        (x) =>
          isOpen(x) &&
          x.shift_date === s.shift_date &&
          x.start_time === s.start_time &&
          x.end_time === s.end_time &&
          (x.role ?? null) === (s.role ?? null),
      ) ??
      null
    );
  }

  function candidatesFor(s: Shift): TeamMember[] {
    const busy = new Set(
      rows
        .filter((x) => x.shift_date === s.shift_date && x.member_id && x.state !== 'callout')
        .map((x) => x.member_id as string),
    );
    const role = (s.role ?? '').trim().toLowerCase();
    return (members ?? [])
      .filter(
        (m) =>
          m.status === 'active' && m.id !== s.member_id && !busy.has(m.id) && !offOn?.(m, s.shift_date),
      )
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
    <div className="tm-gridwrap" ref={gridRef}>
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
                    onClick={() => editShift({ date: days[0], memberId: m.id })}
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
                      data-over={hours !== null && reviewAt != null && hours > reviewAt ? 'true' : undefined}
                    >
                      {shifts === null ? EM : fmtHours(hours ?? 0, hoursIn)}
                    </span>
                  </button>
                  {days.map((d) => {
                    const cell = rows.filter((s) => s.member_id === m.id && s.shift_date === d);
                    return (
                      <div className="tm-cell" key={d} data-cell={`${m.id}|${d}`}>
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
                            onClick={() => editShift({ date: d, memberId: m.id })}
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
                    coverSlot={coverSlotFor(selectedShift)}
                    closed={coverClosed(selectedShift)}
                    onEdit={() => editShift({ shift: selectedShift })}
                    onDuplicate={() => duplicate.mutate(selectedShift)}
                    duplicatePending={duplicate.isPending}
                    onCallout={() => callout.mutate(selectedShift.id)}
                    onCover={() => cover.mutate(selectedShift)}
                    calloutPending={callout.isPending}
                    calloutFailed={callout.isError}
                    calloutNote={calloutNote}
                    coverPending={cover.isPending}
                    coverFailed={cover.isError}
                    coverReach={offered.get(selectedShift.id) ?? null}
                    moneyVisible={moneyVisible}
                    money={money}
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
              editShift({ shift: menuFor });
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
          {menuFor.state !== 'callout' && !coverClosed(menuFor) && (
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
          )}
          {!coverClosed(menuFor) && (
            <button
              type="button"
              className="mdv-item"
              disabled={
                offered.has(menuFor.id) ||
                !coverSlotFor(menuFor) ||
                candidatesFor(menuFor).length === 0
              }
              onClick={() => {
                cover.mutate(menuFor);
                setMenuFor(null);
              }}
            >
              <UsersRound size={14} aria-hidden className="mdv-item__icon" />
              <span className="mdv-item__text">
                {offered.has(menuFor.id)
                  ? 'Cover offered'
                  : candidatesFor(menuFor).length === 0
                    ? 'Nobody is free to cover'
                    : 'Offer cover'}
              </span>
            </button>
          )}
          <button
            type="button"
            className="mdv-item"
            onClick={() => {
              drop.mutate(menuFor);
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
            ? writeOutcomeUnknown(duplicate.error)
              ? 'No answer came back, so the copy may already be on the schedule. Check the week before duplicating again.'
              : 'The shift was not duplicated — the week is unchanged.'
            : writeOutcomeUnknown(drop.error)
              ? 'No answer came back, so the shift may already be gone. Check the week before deleting it again.'
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
  coverSlot,
  closed,
  onEdit,
  onDuplicate,
  duplicatePending,
  onCallout,
  onCover,
  calloutPending,
  calloutFailed,
  calloutNote,
  coverPending,
  coverFailed,
  coverReach,
  moneyVisible,
  money,
}: {
  shift: Shift;
  member: TeamMember;
  candidates: TeamMember[];
  /** The open shift an offer would name; `null` while someone still holds this one. */
  coverSlot: Shift | null;
  /** Why no call-out or offer can be made here (F-1224); `null` when one can. */
  closed: string | null;
  onEdit: () => void;
  onDuplicate: () => void;
  duplicatePending: boolean;
  onCallout: () => void;
  onCover: () => void;
  calloutPending: boolean;
  calloutFailed: boolean;
  /** What the gateway or the lost answer says instead of "not reported", when it says more. */
  calloutNote: string | null;
  coverPending: boolean;
  coverFailed: boolean;
  /** Whom this sitting's offer reached; `null` until one is sent (F-1225). */
  coverReach: CoverReach | null;
  moneyVisible: boolean;
  money: HouseMoney | null;
}) {
  const fmtTime = useShiftTime();
  const region = useHouseRegion();
  /** The house's decimal mark for hours (F-1120). */
  const hoursIn = houseLocale(region);
  const rules = useHouseLabourRules();
  const name = resolveName(member);
  const coverSent = coverReach !== null;
  // F-1231: on a phone the grid scrolls sideways, and the detail spans all of
  // it; it is pinned to the visible edge (team-next.css) and brought into view.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [shift.id]);
  return (
    <div className="tm-expand" ref={ref}>
      <div className="tm-facts">
        <Fact k="Who" v={name.text} />
        <Fact k="When" v={`${fmtDayShort(shift.shift_date)} · ${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}`} />
        <Fact k="Station" v={shift.role ?? EM} />
        <Fact k="Kind" v={shift.shift_type} />
        <Fact k="State" v={shift.state} />
        <Fact
          k="Hours"
          v={fmtHours(workedHours(shift, rules), hoursIn)}
        />
        <Fact k="Break" v={fmtBreak(shift, rules)} />
        {moneyVisible && (
          <Fact
            k="Cost"
            v={
              shift.pay_withheld === 'owner'
                ? "the owner's — an owner's pay is seen by an owner only"
                : shift.labor_cost == null
                  ? `${EM} not priced`
                  : fmtMoneyWhole(shift.labor_cost, money)
            }
          />
        )}
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
          {closed ? (
            <p className="tm-hint">{closed}</p>
          ) : !coverSlot && (
            <p className="tm-hint">
              {shift.state === 'callout'
                ? 'The cover slot for this call-out is no longer open, so there is nothing to offer.'
                : `${name.text} still holds this shift, so nobody else could take it. Report a call-out first; the open shift it creates is what gets offered.`}
            </p>
          )}
          {coverReach && (
            <p className="tm-hint" role="status">
              {reachWords(coverReach)} Nothing records the offer against the shift, so this
              will not show after a reload.
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
        {/* The right-click menu's Duplicate, here too: a phone and a keyboard
            have no right-click (F-400). */}
        <button
          type="button"
          className="tm-ctl tm-ctl--quiet"
          disabled={duplicatePending}
          onClick={onDuplicate}
        >
          {duplicatePending ? 'Duplicating…' : 'Duplicate onto the same day'}
        </button>
        {/* A called-out shift is reported once (F-1116). */}
        {shift.state !== 'callout' && !closed && (
          <button
            type="button"
            className="tm-ctl tm-ctl--quiet"
            disabled={calloutPending}
            onClick={onCallout}
          >
            {calloutPending ? 'Reporting…' : 'Report a call-out'}
          </button>
        )}
        {!closed && (
          <button
            type="button"
            className="tm-ctl tm-ctl--quiet"
            disabled={coverPending || coverSent || candidates.length === 0 || !coverSlot}
            onClick={onCover}
          >
            {coverPending
              ? 'Offering…'
              : coverSent
                ? 'Cover offered'
                : candidates.length === 0
                  ? 'Nobody is free to cover'
                  : `Offer cover to ${candidates.length}`}
          </button>
        )}
      </div>
      {calloutFailed && (
        <p className="tm-alert" role="alert">
          {calloutNote ??
            'The call-out was not reported, so the shift is unchanged and still shows as worked.'}
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

/** What an offer reached, in words (F-1225). */
function reachWords(r: CoverReach): string {
  const people = (n: number) => (n === 1 ? '1 person' : `${n} people`);
  const unlinked =
    r.noAccount > 0
      ? ` ${people(r.noAccount)} picked ${r.noAccount === 1 ? 'has' : 'have'} no account, so ask them in person.`
      : '';
  if (r.notified === null) return `Offered just now.${unlinked}`;
  if (r.notified === 0) {
    return r.noAccount > 0
      ? `Nobody could be reached in the app.${unlinked}`
      : 'Nobody could be reached: the offer did not land on anyone’s bell. Ask them in person.';
  }
  return `Asked ${people(r.notified)} just now, on their bell and their phone if push is on.${unlinked}`;
}
