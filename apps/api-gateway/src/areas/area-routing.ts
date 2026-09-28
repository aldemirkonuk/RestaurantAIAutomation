/**
 * Who an alert reaches, who sees what first, and who may act for everyone in
 * an area — as PURE functions over one snapshot of the house (ADR 0218).
 *
 * Nothing here reads a database or a clock. `AreaRoutingService` reads the
 * snapshot; these functions decide. That split is what lets every rule below
 * be tested, and mutation-tested, without a stub standing in for the thing
 * under test.
 *
 * THE LADDER (the founder, 2026-09-21, through the lane brief)
 * ------------------------------------------------------------
 * "notifications for an area go to its members, then its lead, then
 * owners/managers (no one assigned -> owners/managers)", and during Away "their
 * area's items route to the rest of the area then lead then managers".
 *
 *   0. Nobody in the house is in any area  -> everyone, as before this ADR.
 *      A house-wide item (no label, or a switched-off area) -> everyone.
 *   1. The area's members who are not Away. A lead is a member of the area
 *      they lead (the mark sits on the membership row), so "then its lead" is
 *      reached inside this step whenever the lead is present: the lead never
 *      needs a step of their own to be alerted.
 *   2. Otherwise the owners and managers who are not Away.
 *   3. Otherwise every owner (every manager, in a house whose access rows name
 *      no owner), INBOX ONLY: a row in their notification centre,
 *      no push and no live ping. The one case where Away is not absolute, and
 *      it is quiet on purpose — an alert must land somewhere (judge v1 §4.3,
 *      "a card always reaches someone"), and a person who is Away must not be
 *      woken (the founder: "during Away no alerts ... reach them").
 *
 * Owners and managers "see everything": when step 1 alerts the area, owners
 * and managers who are not Away still get the row in their inbox, without the
 * push. Areas change who is ALERTED, never what an owner can SEE.
 */

import {
  AREA_DEFAULT_NAMES,
  AREA_KINDS,
  type AreaKind,
  type AreaLabel,
} from "./area-label";

export type HouseRole = "owner" | "manager" | "staff";

/** One active member of the house with an account (`public.users.user_id`). */
export interface HouseMember {
  userId: string;
  role: HouseRole;
}

/** A kind as this house has it: its own name, on or off. */
export interface AreaSetting {
  kind: AreaKind;
  name: string;
  enabled: boolean;
}

/**
 * One person in one area. `userId` is null for a roster row with no account:
 * that person is IN the area (the Team page shows them there) but cannot be
 * alerted, so routing passes over them.
 */
export interface AreaMembership {
  memberId: string;
  userId: string | null;
  kind: AreaKind;
  isLead: boolean;
}

/** Away dates, inclusive at both ends, as house-local calendar days. */
export interface AwayWindow {
  userId: string;
  from: string;
  until: string;
}

export interface HouseAreasSnapshot {
  members: HouseMember[];
  /** All six kinds, defaults filled in for the ones the house never touched. */
  areas: AreaSetting[];
  memberships: AreaMembership[];
  away: AwayWindow[];
  /** Today in the house's own time zone, `YYYY-MM-DD`. */
  today: string;
}

export type RouteStep =
  /** Everyone not Away — a house-wide item, or a house that uses no areas. */
  | "everyone"
  /** The labelled area's members who are not Away. */
  | "area"
  /** Nobody in the area could be alerted: owners and managers not Away. */
  | "owners_managers"
  /** Everyone who could be alerted is Away: every owner, inbox only. */
  | "owners_inbox_only";

export interface RouteDecision {
  /** The label actually routed on — null when house-wide or switched off. */
  label: AreaLabel;
  step: RouteStep;
  /** Row + push + live ping. */
  alert: string[];
  /**
   * Row, no push. In the "area" step the funnel also sends these people the
   * live in-app ping (`notifications.service.ts`, `liveIds`); in the
   * last-resort step they are Away, so they get the row and nothing else.
   */
  inboxOnly: string[];
  /** How many people would have been reached but are Away today. */
  heldAway: number;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Away covers `day` when from ≤ day ≤ until (both inclusive). */
export function isAwayOn(window: AwayWindow, day: string): boolean {
  return window.from <= day && day <= window.until;
}

/** The calendar day at `now` in `timeZone`, as `YYYY-MM-DD`. */
export function houseLocalDay(now: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD. The locale is a FORMAT choice here, never a
  // display one: nothing a person reads comes out of this function.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Every kind, with the house's own setting or the default. */
export function fillAreas(
  rows: Array<{ kind: AreaKind; name: string; enabled: boolean }>,
): AreaSetting[] {
  const byKind = new Map(rows.map((r) => [r.kind, r]));
  return AREA_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return {
      kind,
      name: row?.name?.trim() || AREA_DEFAULT_NAMES[kind],
      enabled: row ? row.enabled !== false : true,
    };
  });
}

function enabledKinds(s: HouseAreasSnapshot): Set<AreaKind> {
  return new Set(s.areas.filter((a) => a.enabled).map((a) => a.kind));
}

/**
 * Does this house use areas at all? Only when somebody is in a switched-on
 * area. With nobody assigned, the house sees no change (lane brief).
 */
export function areasInUse(s: HouseAreasSnapshot): boolean {
  const on = enabledKinds(s);
  return s.memberships.some((m) => on.has(m.kind));
}

/** A label on a switched-off area is house-wide. */
export function effectiveLabel(label: AreaLabel, s: HouseAreasSnapshot): AreaLabel {
  if (label === null) return null;
  return enabledKinds(s).has(label) ? label : null;
}

/** The user ids that are Away on the snapshot's day. */
export function awayToday(s: HouseAreasSnapshot): Set<string> {
  return new Set(s.away.filter((w) => isAwayOn(w, s.today)).map((w) => w.userId));
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function routeAlert(label: AreaLabel, s: HouseAreasSnapshot): RouteDecision {
  const away = awayToday(s);
  const everyone = unique(s.members.map((m) => m.userId));
  const inHouse = new Set(everyone);
  const present = (ids: string[]) => ids.filter((id) => !away.has(id));
  const ownersManagers = unique(
    s.members.filter((m) => m.role === "owner" || m.role === "manager").map((m) => m.userId),
  );
  const owners = unique(s.members.filter((m) => m.role === "owner").map((m) => m.userId));

  const eff = effectiveLabel(label, s);

  // A house whose access rows name no owner falls back to its managers, so the
  // last step is never "nobody" while anybody holds the house.
  const lastResort = (heldAway: number): RouteDecision => ({
    label: eff,
    step: "owners_inbox_only",
    alert: [],
    inboxOnly: owners.length > 0 ? owners : ownersManagers,
    heldAway,
  });

  if (eff === null || !areasInUse(s)) {
    const alert = present(everyone);
    if (alert.length === 0 && everyone.length > 0) return lastResort(everyone.length);
    return { label: eff, step: "everyone", alert, inboxOnly: [], heldAway: everyone.length - alert.length };
  }

  const areaPeople = unique(
    s.memberships
      .filter((m) => m.kind === eff && m.userId !== null && inHouse.has(m.userId))
      .map((m) => m.userId as string),
  );
  const areaAlert = present(areaPeople);
  if (areaAlert.length > 0) {
    const alerted = new Set(areaAlert);
    return {
      label: eff,
      step: "area",
      alert: areaAlert,
      inboxOnly: present(ownersManagers).filter((id) => !alerted.has(id)),
      heldAway: areaPeople.length - areaAlert.length,
    };
  }

  const managersAlert = present(ownersManagers);
  const heldInArea = areaPeople.length;
  if (managersAlert.length > 0) {
    return {
      label: eff,
      step: "owners_managers",
      alert: managersAlert,
      inboxOnly: [],
      heldAway: heldInArea + (ownersManagers.length - managersAlert.length),
    };
  }
  return lastResort(unique([...areaPeople, ...ownersManagers]).length);
}

// ---------------------------------------------------------------------------
// FOCUS, NOT FILTER — the order a staff list is read in
// ---------------------------------------------------------------------------

export interface Viewer {
  role: HouseRole;
  /** The switched-on areas this person is in. */
  areas: ReadonlySet<AreaKind>;
  /** The switched-on areas this person leads (always a subset of `areas`). */
  leadOf: ReadonlySet<AreaKind>;
}

/**
 * Split a list into "your areas" and "the rest of the house".
 *
 * Nothing is removed: `yours` + `rest` is the whole list, each half in the
 * order it arrived. Owners and managers see everything in its own order
 * (`yours` empty), and so does a person in no area — with no areas assigned
 * the house sees no change.
 */
export function splitForViewer<T>(
  items: readonly T[],
  labelOf: (item: T) => AreaLabel,
  viewer: Viewer,
): { yours: T[]; rest: T[] } {
  if (viewer.role !== "staff" || viewer.areas.size === 0) {
    return { yours: [], rest: [...items] };
  }
  const yours: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    const label = labelOf(item);
    if (label !== null && viewer.areas.has(label)) yours.push(item);
    else rest.push(item);
  }
  return { yours, rest };
}

// ---------------------------------------------------------------------------
// THE LEAD MARK — "Yes, cards only"
// ---------------------------------------------------------------------------

export interface ActForEveryone {
  allowed: boolean;
  /** Why: the house role, or the lead mark on this item's area. */
  via: "house_role" | "area_lead" | null;
}

/**
 * May this person act FOR EVERYONE on an item carrying `label` — snooze it for
 * everyone, finish it, dismiss it, undo someone else's act on it?
 *
 * The founder, 2026-09-21: *"Yes, cards only"* — a lead acts for everyone
 * inside the area they lead and nowhere else, and the mark grants NO pay and
 * NO roster access (it never changes the house role; nothing here reads or
 * writes one). Owners and managers act everywhere, as they do today.
 *
 * A house-wide item has no area, so no lead reaches it. The recommendation
 * catalogue (another lane) decides which of its verbs ask this question; this
 * function is the one place the answer lives.
 */
export function mayActForEveryone(viewer: Viewer, label: AreaLabel): ActForEveryone {
  if (viewer.role === "owner" || viewer.role === "manager") {
    return { allowed: true, via: "house_role" };
  }
  if (label !== null && viewer.leadOf.has(label)) {
    return { allowed: true, via: "area_lead" };
  }
  return { allowed: false, via: null };
}
