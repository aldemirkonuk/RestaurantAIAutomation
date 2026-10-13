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
  shelves: number;
  shelvesDone: number;
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
  /** What the books expect on this shelf -- never how many (blind count). */
  items: CountShelfItem[];
}

export interface CountSession {
  id: string;
  kind: CountSessionKind;
  status: 'open' | 'signed_off' | 'abandoned';
  openedAt: string;
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

export async function listOpenCountSessions(): Promise<CountSessionSummary[]> {
  const res = await apiClient.get<{ sessions: CountSessionSummary[] }>(PATH);
  return res.data?.sessions ?? [];
}

export async function openCountSession(body: {
  kind: CountSessionKind;
  zoneIds?: string[];
  openKey: string;
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
