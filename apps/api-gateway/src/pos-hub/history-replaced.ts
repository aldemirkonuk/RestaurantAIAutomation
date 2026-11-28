/**
 * r110 onboarding (DD-r109-22 (2), DD-r110-19): when a check lands on a
 * house-day that holds imported till history, the trigger
 * pos_checks_replace_history_day deletes that day's history in the check's own
 * transaction, so the day is counted once. This file only says so: it reads
 * the per-day history counts around an ingest's writes and names the days that
 * lost theirs.
 *
 * The window is every UTC date a check names, one day either side, which holds
 * every house-day of those checks in any zone, clamped to the days history can
 * exist on (today back HISTORY_MAX_DAYS_BACK, a day of zone slack either way):
 * a till that stamps 1970-01-01 as a null default must not cost hundreds of
 * reads per webhook. It is read in spans of at most HISTORY_WINDOW_DAYS so no
 * read meets the 1000-row cap.
 */

import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { HISTORY_MAX_DAYS_BACK } from "./history-import";

export const HISTORY_WINDOW_DAYS = 900;

export interface HistoryReplaced {
  /** House-days whose imported history this ingest's checks replaced, sorted, at most 50. */
  days: string[];
  daysCount: number;
  /** Item-days of history deleted on those days. */
  itemDays: number;
  /** The same in words, or null when nothing was replaced. */
  said: string | null;
}

const DAY_MS = 86_400_000;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The dates to read, or null when no check names a readable instant. */
export function historyWindow(
  checks: { openedAt?: string | null; closedAt?: string | null }[],
  now: Date = new Date(),
): { from: string; to: string } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of checks) {
    for (const stamp of [c.openedAt, c.closedAt]) {
      if (typeof stamp !== "string") continue;
      const ms = Date.parse(stamp);
      if (!Number.isFinite(ms)) continue;
      lo = Math.min(lo, ms);
      hi = Math.max(hi, ms);
    }
  }
  if (!Number.isFinite(lo)) return null;
  const today = Date.parse(utcDay(now.getTime()));
  const from = Math.max(Date.parse(utcDay(lo - DAY_MS)), today - (HISTORY_MAX_DAYS_BACK + 2) * DAY_MS);
  const to = Math.min(Date.parse(utcDay(hi + DAY_MS)), today + 2 * DAY_MS);
  if (from > to) return null;
  return { from: utcDay(from), to: utcDay(to) };
}

/** Item-days of history per house-day in the window, or null when it could not be read. */
export async function readHistoryDayCounts(
  client: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> },
  restaurantId: string,
  window: { from: string; to: string },
): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  const end = Date.parse(`${window.to}T00:00:00Z`);
  for (let start = Date.parse(`${window.from}T00:00:00Z`); start <= end; start += HISTORY_WINDOW_DAYS * DAY_MS) {
    const spanEnd = Math.min(end, start + (HISTORY_WINDOW_DAYS - 1) * DAY_MS);
    let data: any;
    try {
      const res = await client.rpc("pos_sales_history_day_counts", {
        p_restaurant_id: restaurantId,
        p_from: utcDay(start),
        p_to: utcDay(spanEnd),
      });
      if (res.error) return null;
      data = res.data;
    } catch {
      return null;
    }
    if (!Array.isArray(data)) return null;
    for (const row of data) {
      const n = Number(row?.item_days);
      if (typeof row?.sale_date === "string" && Number.isFinite(n)) counts.set(row.sale_date.slice(0, 10), n);
    }
  }
  return counts;
}

/**
 * The days whose history is gone after the writes. Only the trigger deletes
 * history, and an import never saves a day that holds a check, so a count that
 * fell is a day this ingest's checks replaced.
 */
export function sayHistoryReplaced(
  before: Map<string, number>,
  after: Map<string, number>,
): HistoryReplaced {
  const days: string[] = [];
  let itemDays = 0;
  for (const [day, n] of before) {
    const left = after.get(day) ?? 0;
    if (left < n) {
      days.push(day);
      itemDays += n - left;
    }
  }
  days.sort();
  const said =
    days.length === 0
      ? null
      : `The till's own checks now hold ${days.length === 1 ? "1 day" : `${days.length} days`} that had imported history, so that history was removed and each day is counted once: ${days.slice(0, 5).join(", ")}${days.length > 5 ? ` and ${days.length - 5} more` : ""}.`;
  return { days: days.slice(0, 50), daysCount: days.length, itemDays, said };
}

/** The hub's seam for the counts, so an ingest without it reads none and says nothing. */
@Injectable()
export class TillHistoryDays {
  constructor(private readonly dbService: DatabaseService) {}

  read(restaurantId: string, window: { from: string; to: string }): Promise<Map<string, number> | null> {
    return readHistoryDayCounts(this.dbService.getClient() as any, restaurantId, window);
  }
}
