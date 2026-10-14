/**
 * Stock-take sessions (F-1544): a walk of the house's shelves, shelf by
 * shelf. The gateway takes the house and the person from the token, so no
 * call here names a restaurant (count-sessions.controller.ts).
 *
 * A line of the walk is NOT posted here: it goes through the existing
 * per-item count route (`recordSpotCount`) with `sessionId`, so ADR 0078's
 * one count writer stays the one writer.
 */

import { apiClient } from './client';

const PATH = '/count-sessions';

export type CountSessionKind = 'closing' | 'month_end' | 'full' | 'opening';

export interface CountSessionSummary {
  id: string;
  kind: CountSessionKind;
  status: 'open' | 'signed_off' | 'abandoned';
  openedAt: string;
  /** F-1544 lane 5: the month (YYYY-MM) its counts are filed in; null when it names none. */
  period?: string | null;
  shelves: number;
  shelvesDone: number;
}

/**
 * The months a count opened now may be for (F-1544 lane 5, F1 b): this
 * month, and the month that just ended while within its 6 hours. Null when
 * the house has no time zone.
 */
export interface CountPeriods {
  current: string;
  ended: string | null;
}

/**
 * The month a count is filed in -- "October" for 2026-10 -- in the reader's
 * language (F-1544 lane 5, F1 b). Shown on the list, the walk and the review.
 */
export function periodWords(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** A place a count can be narrowed to when it is opened (S227 owed: zone choice). */
export interface CountZone {
  id: string;
  name: string;
  /** Leaf shelves under it -- what a count of it walks. */
  shelves: number;
}

/** A count that has ended: signed off, or stopped (S227 owed). */
export interface EndedCountSession {
  id: string;
  kind: CountSessionKind;
  status: 'signed_off' | 'abandoned';
  openedAt: string;
  endedAt: string | null;
  /** Who signed it off or stopped it. */
  endedBy: string | null;
  period: string | null;
}

export interface CountShelfItem {
  inventoryId: string;
  name: string;
  producer: string;
  vintage: string | null;
  /** Bottles of it sit on no shelf or on a zone of zones: count it whole (F-945). */
  countWhole: boolean;
}

export interface CountShelf {
  locationId: string;
  name: string;
  order: number;
  claimedByMe: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  /** F-1544 lane 4: how many times a manager sent this shelf back. */
  round?: number;
  recountAskedAt?: string | null;
  /** What the books expect on this shelf -- never how many (blind count). */
  items: CountShelfItem[];
}

export interface CountSession {
  id: string;
  kind: CountSessionKind;
  status: 'open' | 'signed_off' | 'abandoned';
  openedAt: string;
  period?: string | null;
  shelves: CountShelf[];
}

export interface ShelfDoneResult {
  locationId: string;
  done: boolean;
  posted: string[];
  held: string[];
  refused: Array<{ inventoryId: string; reason: string }>;
  /** F-1616: items no longer on this shelf's books; not counted, named back. */
  skipped?: Array<{ inventoryId: string; name: string }>;
  sessionStatus: string;
  replayed?: boolean;
  message?: string;
}

export async function listOpenCountSessions(): Promise<{
  sessions: CountSessionSummary[];
  periods: CountPeriods | null;
  /** Null when the gateway sent no places, so "no shelves" is never guessed (F-1712). */
  zones: CountZone[] | null;
  ended: EndedCountSession[];
}> {
  const res = await apiClient.get<{
    sessions: CountSessionSummary[];
    periods?: CountPeriods | null;
    zones?: CountZone[];
    ended?: EndedCountSession[];
  }>(PATH);
  return {
    sessions: res.data?.sessions ?? [],
    periods: res.data?.periods ?? null,
    zones: res.data?.zones ?? null,
    ended: res.data?.ended ?? [],
  };
}

export async function openCountSession(body: {
  kind: CountSessionKind;
  zoneIds?: string[];
  openKey: string;
  /** YYYY-MM; not named = this month. */
  period?: string;
}): Promise<CountSession> {
  const res = await apiClient.post<CountSession>(PATH, body);
  return res.data;
}

export async function pullCountSession(sessionId: string): Promise<CountSession> {
  const res = await apiClient.get<CountSession>(`${PATH}/${encodeURIComponent(sessionId)}`);
  return res.data;
}

export async function claimCountShelf(
  sessionId: string,
  locationId: string,
  takeOver = false,
): Promise<{ locationId: string; claimedByMe: boolean; claimedAt: string | null }> {
  const res = await apiClient.post(
    `${PATH}/${encodeURIComponent(sessionId)}/shelves/${encodeURIComponent(locationId)}/claim`,
    { takeOver },
  );
  return res.data;
}

export async function markCountShelfDone(
  sessionId: string,
  locationId: string,
  body: { clientDoneId: string; zeroItemIds: string[]; countedAgoMs?: number },
): Promise<ShelfDoneResult> {
  const res = await apiClient.post<ShelfDoneResult>(
    `${PATH}/${encodeURIComponent(sessionId)}/shelves/${encodeURIComponent(locationId)}/done`,
    body,
  );
  return res.data;
}

export async function parkCountLine(
  sessionId: string,
  body: {
    clientLineId: string;
    locationId: string;
    description: string;
    countedQty: number;
    /** S234 owed: the open bottle in tenths; left out when not counted. */
    openTenths?: number;
    countedAgoMs?: number;
  },
): Promise<{ id: string; sessionId: string; state: string }> {
  const res = await apiClient.post(`${PATH}/${encodeURIComponent(sessionId)}/parked`, body);
  return res.data;
}

// ---------------------------------------------------------------------------
// F-1544 lane 4: the review. The books, the difference and its value come
// only to an owner or a manager (the gateway leaves them out for anyone else).
// ---------------------------------------------------------------------------

export interface ReviewLine {
  countId: string;
  inventoryId: string;
  name: string;
  counted: number;
  openMl: number | null;
  /** S230 owed: the open bottles in tenths of the item's bottle; null when not counted. */
  openTenths?: number | null;
  /** False: the item names no bottle size, so the tenths stand on 750 ml. */
  bottleSizeKnown?: boolean;
  countedBy: string | null;
  /** S227: on a line loaded from a paper sheet, who counted it on paper. */
  paperBy?: string;
  countedAt: string;
  afterSignOff: boolean;
  expected?: number;
  expectedOpenMl?: number | null;
  variance?: number;
  /** F-1621: the open bottles' difference, in tenths of a bottle; null when not counted. */
  openDifferenceTenths?: number | null;
  value?: number | null;
}

export interface CountReview {
  id: string;
  kind: CountSessionKind;
  status: 'open' | 'signed_off' | 'abandoned';
  openedAt: string;
  /** The month (YYYY-MM) its counts are filed in; null when it names none. */
  period?: string | null;
  signedOffAt: string | null;
  signedOffBy: string | null;
  seesMoney: boolean;
  currency: string | null;
  shelves: Array<{
    locationId: string;
    name: string;
    done: boolean;
    doneAt: string | null;
    doneBy: string | null;
    round: number;
    recountAskedAt: string | null;
    lines: ReviewLine[];
    missed: Array<{ inventoryId: string; name: string }>;
    value?: number | null;
  }>;
  notCounted: Array<{ locationId: string; name: string; round: number }>;
  /** F-1683: on a Full count, items off the shelves not counted whole since it opened. */
  offShelf?: Array<{ inventoryId: string; name: string }>;
  /** F-1683: every shelf's missed items plus offShelf: items nobody counted. */
  itemsNotCounted?: number;
  elsewhere: ReviewLine[];
  held: Array<{
    id: string;
    inventoryId: string;
    name: string;
    locationId: string | null;
    shelf: string;
    counted: number;
    openMl: number | null;
    openTenths?: number | null;
    bottleSizeKnown?: boolean;
    countedBy: string | null;
    paperBy?: string;
    countedAt: string;
    against: ReviewLine | null;
  }>;
  parked: Array<{
    id: string;
    locationId: string;
    shelf: string;
    description: string;
    counted: number;
    /** S234 owed: the open bottle, in ml and in the tenths staff entered. */
    openMl?: number | null;
    openTenths?: number | null;
    countedBy: string | null;
    paperBy?: string;
    countedAt: string;
  }>;
  moved: Array<{ inventoryId: string; name: string; bottles: number; from: string; to: string }>;
  afterSignOff: ReviewLine[];
}

export interface SignOffResult {
  id: string;
  status: string;
  signedOff: boolean;
  signedOffAt: string | null;
  notCounted: number;
  /** F-1683: present when sign-off asked because items on the books were never counted. */
  itemsNotCounted?: number;
  stamped: number | null;
  replayed: boolean;
}

const at = (sessionId: string) => `${PATH}/${encodeURIComponent(sessionId)}`;

/**
 * Writes down a loaded count sheet (S227 owed, ADR 0335 §3): who counted on
 * paper (blank: the person loading it), how many lines went in, were refused
 * and were not sent, and the sheet's shelf keys its lines are keyed on.
 */
export async function recordCountSheetLoad(
  sessionId: string,
  body: {
    countedByName: string;
    rowsIn: number;
    rowsRefused: number;
    rowsNotSent: number;
    shelfKeys: string[];
  },
): Promise<{ id: string; logged: boolean }> {
  const res = await apiClient.post(`${at(sessionId)}/sheet-loads`, {
    countedByName: body.countedByName,
    rowsIn: body.rowsIn,
    rowsRefused: body.rowsRefused,
    rowsNotSent: body.rowsNotSent,
    shelfKeys: body.shelfKeys,
  });
  return res.data;
}

export async function reviewCountSession(sessionId: string): Promise<CountReview> {
  const res = await apiClient.get<CountReview>(`${at(sessionId)}/review`);
  return res.data;
}

export async function chooseHeldCountLine(sessionId: string, heldLineId: string) {
  const res = await apiClient.post(`${at(sessionId)}/held/${encodeURIComponent(heldLineId)}/use`, {});
  return res.data as { heldLineId: string; state: string; countId: string | null; replayed: boolean };
}

export async function dropHeldCountLine(sessionId: string, heldLineId: string) {
  const res = await apiClient.post(`${at(sessionId)}/held/${encodeURIComponent(heldLineId)}/drop`, {});
  return res.data as { heldLineId: string; state: string; replayed: boolean };
}

export async function carryParkedCountLine(sessionId: string, parkedId: string, inventoryId: string) {
  const res = await apiClient.post(`${at(sessionId)}/parked/${encodeURIComponent(parkedId)}/carry`, {
    inventoryId,
  });
  return res.data as { parkedId: string; state: string; countId: string | null; held?: boolean };
}

export async function dropParkedCountLine(sessionId: string, parkedId: string) {
  const res = await apiClient.post(`${at(sessionId)}/parked/${encodeURIComponent(parkedId)}/drop`, {});
  return res.data as { parkedId: string; state: string; replayed: boolean };
}

export async function askShelfRecount(sessionId: string, locationId: string, seenRound: number) {
  const res = await apiClient.post(
    `${at(sessionId)}/shelves/${encodeURIComponent(locationId)}/recount`,
    { seenRound },
  );
  return res.data as { locationId: string; round: number; setAside: number; replayed: boolean };
}

export async function signOffCountSession(
  sessionId: string,
  evenIfUnfinished = false,
): Promise<SignOffResult> {
  const res = await apiClient.post<SignOffResult>(`${at(sessionId)}/sign-off`, { evenIfUnfinished });
  return res.data;
}

/**
 * F-1617: an owner or a manager stops a count. The counts it already made
 * stay on the books (each posted when it arrived); stopping twice is the same
 * stop, and a signed-off count cannot be stopped (count-sessions.service.ts
 * `abandon`).
 */
export async function abandonCountSession(
  sessionId: string,
): Promise<{ id: string; status: string; abandonedAt: string | null }> {
  const res = await apiClient.post(`${at(sessionId)}/abandon`, {});
  return res.data;
}

export interface HoldingHouse {
  id: string;
  name: string;
  city: string | null;
}

/**
 * F-1629: which of the person's own houses holds a count, for a link opened
 * in another of their houses. Null when none of theirs does (the gateway
 * never names a house the person is not in).
 */
export async function houseHoldingCount(sessionId: string): Promise<HoldingHouse | null> {
  const res = await apiClient.get('/auth/houses/holding', { params: { count: sessionId } });
  const house = res.data?.house;
  return house && typeof house.id === 'string' ? (house as HoldingHouse) : null;
}
