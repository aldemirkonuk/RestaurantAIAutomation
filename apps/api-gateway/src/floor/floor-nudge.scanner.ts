/**
 * The floor's nudge scanner (ADR 0345 E3, ADR 0352). Once a minute:
 *
 * 1. **One runner.** Every replica INSERTs the same `floor_nudge_ticks.tick_at`
 *    (the minute); the primary key lets exactly one win and only the winner
 *    scans. A failed lock write scans nothing.
 * 2. **Behind the switch.** Only houses whose `floor_checker` is on are read
 *    (E7). A house with no time zone gets no pushes and no presence reads
 *    (ADR 0351 › The house's clock).
 * 3. **Claim before send.** Each push is claimed by an INSERT into
 *    `floor_nudge_sends` on (house, idempotency key, person); a conflict means
 *    another tick or replica already sent it.
 *    - late:  `late:<seating>:<anchor>:<15-minute window index>` — the anchor
 *      is the visit (or the Paid undo) the lateness counts from, so a new
 *      visit starts a new series and a stale one is never re-sent inside its
 *      window.
 *    - Food up climb: `food_up:<event id>:<threshold minutes>`.
 *    - manager step: the same key under kind `manager_step`.
 * 4. **The chain.** The holder (or the cover named at their On break) gets the
 *    STAFF copy. When nobody can be sent to — no holder, no cover, no device,
 *    the send failed — the MANAGER copy goes to the house's owners and
 *    managers. Open as OD-236, the executor's reading under OD-242: ADR 0351's
 *    full absence chain (presence reads, Away, quiet hours, the last-step
 *    notification row) is not built; this is the reversible first rung.
 *
 * Paid stops the late clock (ADR 0353): a paid table is never nudged.
 */
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { exactMinutesSince, seatingFreshness } from "@wineops/floor-core";
import { DatabaseService } from "../database/database.service";
import { NotificationsService } from "../notifications/notifications.service";
import { OWNER_AND_MANAGER, houseMembersInRoles } from "../common/tenant/live-membership";
import { SETTINGS_ROW_FLAG_NAME } from "../settings/feature-flag-registry";
import { FLOOR_FLAG } from "./floor-flag";
import { type FloorHouse, isUniqueViolation, readFloorHouse, serviceDateOf } from "./floor-common";
import { readHolders } from "./floor-holders";
import { type FloorPushTarget, managerCopy, pushTo, staffCopy } from "./floor-push";
import { FloorService } from "./floor.service";

/** E3: a late table is re-nudged at most once per 15 minutes per anchor. */
export const LATE_WINDOW_MIN = 15;
/** How far back a Food up may still climb. Older ones are left alone. */
export const FOOD_UP_LOOKBACK_MIN = 90;

export type NudgeKind = "late" | "food_up" | "manager_step";

export function lateKey(seatingId: string, anchor: string, minutesLate: number): string {
  return `late:${seatingId}:${anchor}:${Math.floor(Math.max(0, minutesLate) / LATE_WINDOW_MIN)}`;
}

export function foodUpKey(eventId: string, thresholdMin: number): string {
  return `food_up:${eventId}:${thresholdMin}`;
}

/** The minute a tick stands for, as the lock's key. */
export function tickOf(now: number): string {
  return new Date(Math.floor(now / 60_000) * 60_000).toISOString();
}

interface TickCounts {
  houses: number;
  claimed: number;
}

@Injectable()
export class FloorNudgeScanner {
  private readonly logger = new Logger(FloorNudgeScanner.name);
  private readonly runner = `${process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local"}:${process.pid}`;

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    private readonly floor: FloorService,
  ) {}

  private get sb() {
    return this.db.supabase;
  }

  @Cron("0 * * * * *", { name: "floor-nudge-scanner" })
  async onTick(): Promise<void> {
    await this.tick(Date.now());
  }

  /** One scan. Returns null when this replica did not win the minute. */
  async tick(now: number): Promise<TickCounts | null> {
    const tickAt = tickOf(now);
    const lock = await this.sb.from("floor_nudge_ticks").insert({ tick_at: tickAt, runner: this.runner });
    if (lock.error) {
      if (!isUniqueViolation(lock.error)) this.logger.warn(`floor tick lock not written: ${lock.error.message}`);
      return null;
    }
    const counts: TickCounts = { houses: 0, claimed: 0 };
    let failure: string | null = null;
    try {
      for (const rid of await this.enabledHouses()) {
        try {
          const house = await readFloorHouse(this.sb, rid);
          if (!house.zone) continue;
          counts.houses++;
          counts.claimed += await this.scanLate(rid, house, now);
          counts.claimed += await this.scanFoodUp(rid, house, now);
        } catch (e) {
          // One house's failure never stops another's nudges.
          this.logger.error(`floor scan failed for ${rid}: ${(e as Error)?.message}`);
          failure = failure ?? `house ${rid}: ${(e as Error)?.message}`;
        }
      }
    } catch (e) {
      failure = (e as Error)?.message ?? "scan failed";
    }
    await this.sb
      .from("floor_nudge_ticks")
      .update({ finished_at: new Date().toISOString(), houses: counts.houses, claimed: counts.claimed, error: failure })
      .eq("tick_at", tickAt);
    return counts;
  }

  /** Houses with the switch on. A failed read throws: nothing is scanned. */
  async enabledHouses(): Promise<string[]> {
    const { data, error } = await this.sb
      .from("restaurant_feature_flags")
      .select("restaurant_id")
      .eq("flag_name", SETTINGS_ROW_FLAG_NAME)
      .eq(FLOOR_FLAG, true);
    if (error) throw new Error(`floor switch read failed: ${error.message}`);
    return [...new Set(((data ?? []) as Array<{ restaurant_id: string }>).map((r) => r.restaurant_id))];
  }

  /** Claim one send. True = this caller owns it and must send. */
  async claim(rid: string, key: string, userId: string, kind: NudgeKind, seatingId: string | null): Promise<string | null> {
    const { data, error } = await this.sb
      .from("floor_nudge_sends")
      .insert({ restaurant_id: rid, idempotency_key: key, user_id: userId, kind, seating_id: seatingId })
      .select("id")
      .single();
    if (isUniqueViolation(error)) return null;
    if (error || !data) {
      this.logger.warn(`floor nudge claim failed: ${error?.message}`);
      return null;
    }
    return (data as { id: string }).id;
  }

  private async settle(claimId: string, outcome: "sent" | "not_sent" | "failed", detail: string | null) {
    await this.sb.from("floor_nudge_sends").update({ outcome, detail }).eq("id", claimId);
  }

  /**
   * Send `target` to `audience` (staff copy); when no one got it, step up to
   * the owners and managers (manager copy). Returns how many sends were claimed.
   */
  async deliver(rid: string, key: string, kind: "late" | "food_up", seatingId: string | null, audience: string[], target: FloorPushTarget): Promise<number> {
    let claimed = 0;
    let reached = 0;
    for (const userId of audience) {
      const id = await this.claim(rid, key, userId, kind, seatingId);
      if (!id) {
        // Already claimed earlier: count it as reached so the step is not re-run.
        reached++;
        continue;
      }
      claimed++;
      try {
        const r = await pushTo(this.notifications, userId, staffCopy(target), target.lateAfterMin);
        if (r.sent > 0) reached++;
        await this.settle(id, r.sent > 0 ? "sent" : "not_sent", r.reason);
      } catch (e) {
        await this.settle(id, "failed", (e as Error)?.message ?? null);
      }
    }
    if (reached > 0) return claimed;

    let managers: string[];
    try {
      managers = await houseMembersInRoles(this.sb, rid, OWNER_AND_MANAGER);
    } catch (e) {
      this.logger.error(`floor manager step skipped, members unread: ${(e as Error)?.message}`);
      return claimed;
    }
    const detail = audience.length === 0 ? "nobody holds this table" : "the waiter's phone did not take it";
    for (const userId of managers) {
      const id = await this.claim(rid, key, userId, "manager_step", seatingId);
      if (!id) continue;
      claimed++;
      try {
        const r = await pushTo(this.notifications, userId, managerCopy({ ...target, managerDetail: detail }), target.lateAfterMin);
        await this.settle(id, r.sent > 0 ? "sent" : "not_sent", r.reason);
      } catch (e) {
        await this.settle(id, "failed", (e as Error)?.message ?? null);
      }
    }
    return claimed;
  }

  async scanLate(rid: string, house: FloorHouse, now: number): Promise<number> {
    const { data, error } = await this.sb
      .from("floor_seatings")
      .select("id, table_id, seated_at, paid_at, paid_undone_at")
      .eq("restaurant_id", rid)
      .is("left_at", null)
      .is("paid_at", null);
    if (error) throw new Error(`open seatings unread: ${error.message}`);
    const open = (data ?? []) as Array<{ id: string; table_id: string; seated_at: string; paid_undone_at: string | null }>;
    if (open.length === 0) return 0;

    const visits = await this.floor.lastVisits(rid, open.map((s) => s.id));
    const late = open
      .map((s) => {
        const anchor = FloorService.lastVisitAnchor(visits.get(s.id)?.at ?? null, s.paid_undone_at) ?? s.seated_at;
        const status = seatingFreshness({ seatedAt: s.seated_at, lastVisitAt: anchor === s.seated_at ? null : anchor }, house.warnAfterMin, house.lateAfterMin, now);
        return { s, anchor, status };
      })
      .filter((x) => x.status === "late");
    if (late.length === 0) return 0;

    const holders = await readHolders(this.sb, rid, serviceDateOf(house.zone, now));
    const labels = await this.labels(rid, late.map((x) => x.s.table_id));
    let claimed = 0;
    for (const { s, anchor } of late) {
      const minutes = (exactMinutesSince(anchor, now) ?? 0) - house.lateAfterMin;
      const audience = await this.floor.audienceFor(rid, holders.byTable.get(s.table_id) ?? []);
      claimed += await this.deliver(rid, lateKey(s.id, anchor, minutes), "late", s.id, audience, {
        restaurantId: rid,
        houseName: house.name,
        tableId: s.table_id,
        tableLabel: labels.get(s.table_id) ?? "?",
        word: "Late",
        lateAfterMin: house.lateAfterMin,
      });
      await this.sb.from("floor_seatings").update({ last_nudge_at: new Date(now).toISOString() }).eq("id", s.id).eq("restaurant_id", rid);
    }
    return claimed;
  }

  /**
   * A Food up nobody acknowledged climbs once at warn_after_min and once at
   * late_after_min after it was raised, through the same chain.
   */
  async scanFoodUp(rid: string, house: FloorHouse, now: number): Promise<number> {
    const since = new Date(now - FOOD_UP_LOOKBACK_MIN * 60_000).toISOString();
    const { data, error } = await this.sb
      .from("floor_events")
      .select("id, kind, table_id, seating_id, meta, created_at")
      .eq("restaurant_id", rid)
      .in("kind", ["food_up", "food_ack"])
      .gte("created_at", since);
    if (error) throw new Error(`food up unread: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; kind: string; table_id: string | null; seating_id: string | null; meta: Record<string, unknown> | null; created_at: string }>;
    const acked = new Set(rows.filter((r) => r.kind === "food_ack").map((r) => String(r.meta?.food_up_id ?? "")));
    const pending = rows.filter((r) => r.kind === "food_up" && r.table_id && !acked.has(r.id));
    if (pending.length === 0) return 0;

    const holders = await readHolders(this.sb, rid, serviceDateOf(house.zone, now));
    const labels = await this.labels(rid, pending.map((r) => r.table_id!));
    let claimed = 0;
    for (const ev of pending) {
      const age = exactMinutesSince(ev.created_at, now) ?? 0;
      const threshold = age >= house.lateAfterMin ? house.lateAfterMin : age >= house.warnAfterMin ? house.warnAfterMin : null;
      if (threshold === null) continue;
      const audience = await this.floor.audienceFor(rid, holders.byTable.get(ev.table_id!) ?? []);
      claimed += await this.deliver(rid, foodUpKey(ev.id, threshold), "food_up", ev.seating_id, audience, {
        restaurantId: rid,
        houseName: house.name,
        tableId: ev.table_id!,
        tableLabel: labels.get(ev.table_id!) ?? "?",
        word: "Food up",
        lateAfterMin: house.lateAfterMin,
      });
    }
    return claimed;
  }

  private async labels(rid: string, tableIds: string[]): Promise<Map<string, string>> {
    const { data, error } = await this.sb.from("restaurant_tables").select("id, label").eq("restaurant_id", rid).in("id", [...new Set(tableIds)]);
    if (error) throw new Error(`tables unread: ${error.message}`);
    return new Map(((data ?? []) as Array<{ id: string; label: string }>).map((t) => [t.id, t.label]));
  }
}
