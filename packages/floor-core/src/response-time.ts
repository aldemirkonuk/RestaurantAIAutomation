/**
 * Response time = the gap (minutes) between consecutive visit anchors on a
 * seating: seated → check_in → check_in → …
 *
 * Ported from the Floor Checker's `lib/response-time.ts` (frozen at
 * `5958689`). Each closed gap is one sample, as there. ADR 0346 D4 changes
 * which gaps count and whose they are; each change is marked below:
 *
 * - D4 (b) Silence is not rewarded (ADR 0346 `:63`). The open gap, from the
 *   last anchor, is one more sample when it exceeds T = max(1, warnAfterMin).
 *   It ends at the earliest of Paid, leave and the caretaker's last tap on any
 *   table that service day (`caretakerLastTapAt`), so a leave tapped next
 *   morning does not stretch it. A seating with neither Paid nor leave is
 *   listed in `seatingsNotClosed` (the report's *Not closed*); its gap to the
 *   last tap still counts. The checker counted no gap for a party nobody
 *   visited, so its waiter scored 100. Gaps over 120 minutes are kept; the
 *   checker dropped them (`response-time.ts:72`).
 * - D4 (c) The greeting gap belongs to the table's waiter: seated → first visit
 *   is credited to the seating's caretaker at seat time, not to whoever tapped
 *   Seat. Later gaps keep the checker's handoff rule (`gapCreditActorId`).
 * - D4 (e) Paid stops the clock: no gap accrues after Paid, so a check-in after
 *   Paid closes nothing and the open gap ends at Paid.
 * - F7 (founder, 2026-10-31, "Keep them in"): a hidden table's seatings stay
 *   in the waiter's samples. ADR 0346 D5 / ADR 0303 `:60`: they leave the
 *   per-table samples.
 *
 * `now` is the end of the window, for every seating, with facts or without:
 * an event, Paid, leave or tap stamped after it is not seen, so nothing
 * stamped later can change the figures for that window, and an open gap with
 * no terminator yet (a live board, a caretaker with no tap passed) stops at
 * `now`. (The hidden flag is read as it is at the call, F7, so `byTable` can
 * still change when a table is hidden later.) Reading the window end as the
 * last terminator is the executor's under OD-242, inside the D4 (b)
 * terminators ADR 0346 `:63` already attributes to the executor.
 *
 * The seat time is an anchor (ADR 0346 D4 b). The port's floor schema (its
 * migration is not on main yet) keeps it on `floor_seatings.seated_at`; its
 * `floor_events` audit trail also logs a `seated` row, but `floor_visits`,
 * where visit anchors come from, has none. So a
 * seating's facts carry `seatedAt`, and when its events hold no "seated" event
 * the anchor is made from `seatedAt` / `seatedBy`. A seating with facts and no
 * events at all (seated, never visited) is still scored. At one millisecond, a
 * seated anchor sorts before a check-in, then events sort by actor id, then by
 * table id, so the order in which a caller lists same-millisecond events
 * never changes a seating's samples.
 *
 * Not built here, and owed by the caller or a later part:
 *
 * - D8's absence rule inside D4 (c) (ADR 0346 `:64`). The caller passes a
 *   `caretakerAtSeatId` already cleared to null for anyone known absent
 *   (ADR 0351 `:23`) or no longer a member at seat time; splitting the
 *   greeting gap when the caretaker goes absent before the first visit waits
 *   for the absence flags owed with the alert scanner (ADR 0351 `:29`).
 * - *Not closed* "beside its caretaker" (`:63`): this returns seating ids, and
 *   the caller joins each to its caretaker.
 * - Paid undone (ADR 0353 `:43`): `paidAt` is the seating's Paid as it stands
 *   at the call, so an undone Paid is passed as null.
 *
 * Executor's readings under OD-242, inside the terminators `:63` attributes
 * to the executor: the open gap is credited by the handoff rule (the last
 * anchor's actor, or the caretaker at seat time when that anchor is the seat
 * itself), while the caretaker's last tap bounds it; so a colleague whose
 * check-in is the last anchor carries the open gap up to the caretaker's last
 * tap. A caretaker whose last tap comes before the last anchor adds no open
 * gap: no time was shown on the floor. Facts listed twice for one seating:
 * the last row wins. With no caretaker at seat time (none assigned, cleared as
 * absent, or a deleted user), `:64` says only who must not get the greeting
 * gap; D8's "the live cover or else the waiter" (`:92`) is said of alerts,
 * and these facts carry no live cover. So credit follows the visit, not the
 * Seat tap: a closed greeting gap goes to the first visitor, who may be the
 * person who seated; an open one past T goes to no waiter's figure, only to
 * the table's (when the table is not hidden).
 *
 * Handoff rule (Hybrid attribution, kept): when the waiter who closes a gap is
 * different from the waiter on the previous anchor, credit the **previous**
 * actor — the open gap belonged to them. A mid-party claim + quick tap must
 * not dump a long late gap onto the new waiter or erase the prior waiter's
 * accountability.
 */

export interface VisitEvent {
  tableId: string | null;
  actorId: string | null;
  seatingId: string | null;
  type: string;
  createdAt: string;
}

/**
 * What a seating's events do not say. Without it a seating gets the checker's
 * treatment of gaps (closed gaps up to `now` only, prior-actor credit; the
 * 120-minute cut is still gone) and is listed in `seatingsWithoutFacts`, so a
 * caller can see the corrections did not apply.
 */
export interface SeatingFacts {
  seatingId: string;
  tableId: string | null;
  /** `floor_seatings.seated_at`: the first anchor when no "seated" event is passed. */
  seatedAt: string;
  /** `floor_seatings.seated_by`: who tapped Seat (the made anchor's actor). */
  seatedBy: string | null;
  /**
   * The waiter caring for the table when the party was seated (D4 c). The
   * checker's seated event carries whoever tapped Seat (`app/actions.ts:233`),
   * which may be a manager; the caretaker is the assigned waiter (`:222`).
   * Pass null, never "", for no caretaker: "" drops the gap from every
   * waiter's figure, the first visitor's included.
   */
  caretakerAtSeatId: string | null;
  /** Paid, by tap or the till's auto-Paid (D4 e). Unreadable or after `now`: absent. */
  paidAt: string | null;
  /** Unreadable or after `now`: absent. */
  leftAt: string | null;
  /**
   * The caretaker's last tap on any table that service day (D4 b, ADR 0346
   * `:63`): the open gap ends here if that is earliest. Required, like
   * `tableHidden`, so a report cannot forget it; null (a live board, or no
   * tap known) leaves the window's end. Unreadable or after `now`: absent.
   */
  caretakerLastTapAt: string | null;
  /**
   * The table is hidden now (ADR 0303). See F7 above. Required: a forgotten
   * flag must not put a hidden table back into the per-table figures. A JS
   * caller that omits it anyway gets the table left out of `byTable`.
   */
  tableHidden: boolean;
}

export interface ResponseSampleOptions {
  seatings: SeatingFacts[];
  /** The house's warn minutes; T = max(1, warnAfterMin). Finite, else RangeError. */
  warnAfterMin: number;
  /**
   * The end of the window, in ms. Live callers pass the clock; a report passes
   * its window's end. No event, Paid or leave stamped after it counts, and an
   * open gap stops here. Must be finite (else RangeError).
   */
  now: number;
}

export interface ResponseSamples {
  byTable: Map<string, number[]>;
  byWaiter: Map<string, number[]>;
  /** Seatings with events but no `SeatingFacts`: D4 (b), (c), (e) not applied. */
  seatingsWithoutFacts: string[];
  /**
   * Seatings with facts, no "seated" event and an unreadable `seatedAt`: the
   * greeting gap (and, with no events, every gap) went unmeasured, which is
   * not the same as on time.
   */
  seatingsWithoutAnchor: string[];
  /**
   * Seatings with facts and neither Paid nor leave seen by the window's end:
   * the report's *Not closed* (D4 b), a count of missing taps, not lateness.
   */
  seatingsNotClosed: string[];
}

export function avgOf(samples: number[]): number | null {
  if (samples.length === 0) return null;
  return Math.round(
    (samples.reduce((a, b) => a + b, 0) / samples.length) * 10,
  ) / 10;
}

/**
 * Who receives a response-gap sample for coaching / score.
 * Same actor → closer. Actor change mid-gap → prior actor (owner of the wait).
 */
export function gapCreditActorId(
  prevActorId: string | null | undefined,
  currActorId: string | null | undefined,
): string | null {
  if (prevActorId && currActorId && prevActorId !== currActorId) {
    return prevActorId;
  }
  return currActorId ?? prevActorId ?? null;
}

function push(map: Map<string, number[]>, key: string, value: number): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function timeOf(iso: string): number {
  return new Date(iso).getTime();
}

/** A parseable time in ms, else null: an unreadable Paid or leave is absent. */
function finiteTime(iso: string | null): number | null {
  if (!iso) return null;
  const ms = timeOf(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Only "seated" and "check_in" reach the sort (see `responseSamples`). */
function typeRank(e: VisitEvent): number {
  return e.type === "seated" ? 0 : 1;
}

function byId(a: string | null, b: string | null): number {
  const ia = a ?? "";
  const ib = b ?? "";
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Time, then seated before check_in, then actor id, then table id: never the
 * input order. Events equal on all four are interchangeable for every sample.
 */
function byAnchorOrder(a: VisitEvent, b: VisitEvent): number {
  const dt = timeOf(a.createdAt) - timeOf(b.createdAt);
  if (dt !== 0) return dt;
  const dk = typeRank(a) - typeRank(b);
  if (dk !== 0) return dk;
  return byId(a.actorId, b.actorId) || byId(a.tableId, b.tableId);
}

/** Collect response-time samples keyed by table and by credited waiter. */
export function responseSamples(
  events: VisitEvent[],
  opts: ResponseSampleOptions,
): ResponseSamples {
  // Without a finite window end or T nothing can be measured, and an empty
  // result would read as "no evidence"; refuse instead.
  if (!Number.isFinite(opts.now) || !Number.isFinite(opts.warnAfterMin)) {
    throw new RangeError("responseSamples: now and warnAfterMin must be finite");
  }
  const T = Math.max(1, opts.warnAfterMin);
  /** A readable time no later than the window's end, else null (not seen). */
  const seen = (iso: string | null): number | null => {
    const ms = finiteTime(iso);
    return ms !== null && ms <= opts.now ? ms : null;
  };
  const factsById = new Map(opts.seatings.map((s) => [s.seatingId, s]));

  const bySeating = new Map<string, VisitEvent[]>();
  for (const e of events) {
    if (!e.seatingId) continue;
    if (e.type !== "seated" && e.type !== "check_in") continue;
    // An unreadable time cannot be placed in order; it is left out here,
    // before the seat-time anchor is chosen, so an unreadable "seated" row
    // cannot hide `seatedAt`.
    if (!Number.isFinite(timeOf(e.createdAt))) continue;
    const list = bySeating.get(e.seatingId) ?? [];
    list.push(e);
    bySeating.set(e.seatingId, list);
  }

  const byTable = new Map<string, number[]>();
  const byWaiter = new Map<string, number[]>();
  const seatingsWithoutFacts: string[] = [];
  const seatingsWithoutAnchor: string[] = [];
  const seatingsNotClosed: string[] = [];

  // Every seating with events, then every seating with facts and none.
  const seatingIds = new Set<string>(bySeating.keys());
  for (const s of opts.seatings) seatingIds.add(s.seatingId);

  for (const seatingId of seatingIds) {
    const all = [...(bySeating.get(seatingId) ?? [])];
    const facts = factsById.get(seatingId);
    if (!facts) seatingsWithoutFacts.push(seatingId);

    // D4 (b): the seat time is an anchor even when no seated row was passed.
    if (facts && !all.some((e) => e.type === "seated")) {
      if (finiteTime(facts.seatedAt) === null) {
        seatingsWithoutAnchor.push(seatingId);
      } else {
        all.push({
          seatingId,
          tableId: facts.tableId,
          actorId: facts.seatedBy,
          type: "seated",
          createdAt: facts.seatedAt,
        });
      }
    }

    // D4 (e), (b): the clock stops at the earlier of Paid and leave, else at
    // now. A Paid or leave after now, the window's end, is not seen; a
    // seating without facts stops at now.
    const paid = facts ? seen(facts.paidAt) : null;
    const left = facts ? seen(facts.leftAt) : null;
    if (facts && paid === null && left === null) seatingsNotClosed.push(seatingId);
    const stopMs = Math.min(paid ?? opts.now, left ?? opts.now);
    const list = all
      .filter((e) => timeOf(e.createdAt) <= stopMs)
      .sort(byAnchorOrder);
    if (list.length === 0) continue;

    const record = (tableId: string | null, creditId: string | null, minutes: number) => {
      // ADR 0346 D5 / ADR 0303 :60: a hidden table leaves per-table figures.
      // A missing flag is read as hidden; a seating without facts keeps the
      // checker's treatment.
      const hidden = facts ? facts.tableHidden !== false : false;
      if (tableId && !hidden) push(byTable, tableId, minutes);
      // F7: but its gaps stay in the waiter's samples.
      if (creditId) push(byWaiter, creditId, minutes);
    };

    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      if (curr.type !== "check_in") continue;
      // Finite and sorted, so never negative. D4 (b): no 120-minute cut; the
      // checker skipped `minutes > 120` here.
      const minutes = (timeOf(curr.createdAt) - timeOf(prev.createdAt)) / 60_000;

      // D4 (c): the greeting gap goes to the caretaker at seat time.
      // With facts and no caretaker, the first visitor (who may have seated).
      const creditId =
        prev.type === "seated" && facts
          ? facts.caretakerAtSeatId ?? curr.actorId
          : gapCreditActorId(prev.actorId, curr.actorId);
      record(curr.tableId, creditId, minutes);
    }

    // D4 (b): the open gap after the last anchor counts when it exceeds T.
    const last = list[list.length - 1];
    if (facts) {
      // D4 (b): the caretaker's last tap ends the open gap too. It ends only
      // the open gap: a colleague's check-in after it still closes a gap.
      const tap = seen(facts.caretakerLastTapAt);
      const openEnd = tap === null ? stopMs : Math.min(stopMs, tap);
      const minutes = (openEnd - timeOf(last.createdAt)) / 60_000;
      if (minutes > T) {
        // A seat with no caretaker: no waiter's figure; the table's, if shown.
        const creditId =
          last.type === "seated" ? facts.caretakerAtSeatId : last.actorId;
        record(facts.tableId ?? last.tableId, creditId, minutes);
      }
    }
  }

  return { byTable, byWaiter, seatingsWithoutFacts, seatingsWithoutAnchor, seatingsNotClosed };
}

export function avgResponseMin(
  samples: Map<string, number[]>,
  id: string,
): number | null {
  return avgOf(samples.get(id) ?? []);
}
