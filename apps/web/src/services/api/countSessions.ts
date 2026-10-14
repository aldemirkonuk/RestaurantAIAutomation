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
  sessionStatus: string;
  replayed?: boolean;
  message?: string;
}

export async function listOpenCountSessions(): Promise<{
  sessions: CountSessionSummary[];
  periods: CountPeriods | null;
}> {
  const res = await apiClient.get<{ sessions: CountSessionSummary[]; periods?: CountPeriods | null }>(PATH);
  return { sessions: res.data?.sessions ?? [], periods: res.data?.periods ?? null };
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
  countedBy: string | null;
  countedAt: string;
  afterSignOff: boolean;
  expected?: number;
  expectedOpenMl?: number | null;
  variance?: number;
  value?: number | null;
}

export interface CountReview {
  id: string;
  kind: CountSessionKind;
  status: 'open' | 'signed_off' | 'abandoned';
  openedAt: string;
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
  elsewhere: ReviewLine[];
  held: Array<{
    id: string;
    inventoryId: string;
    name: string;
    locationId: string | null;
    shelf: string;
    counted: number;
    openMl: number | null;
    countedBy: string | null;
    countedAt: string;
    against: ReviewLine | null;
  }>;
  parked: Array<{
    id: string;
    locationId: string;
    shelf: string;
    description: string;
    counted: number;
    countedBy: string | null;
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
  stamped: number | null;
  replayed: boolean;
}

const at = (sessionId: string) => `${PATH}/${encodeURIComponent(sessionId)}`;

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
