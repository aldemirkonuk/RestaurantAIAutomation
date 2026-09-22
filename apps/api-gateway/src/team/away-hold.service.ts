import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AreaRoutingService } from "../areas/area-routing.service";
import type { HeldKind, HeldRow } from "./away-hold";

/** One message or note waiting for one person. */
export interface NewHeld {
  restaurant_id: string;
  user_id: string;
  kind: HeldKind;
  note_id?: string | null;
  member_id?: string | null;
  title?: string | null;
  body?: string | null;
  channels?: string[];
  sent_by: string;
  away_until: string;
}

const HELD_COLUMNS =
  "id, restaurant_id, user_id, kind, note_id, member_id, title, body, channels, sent_by, away_until, created_at, claimed_at";

/**
 * The hold table, `house_away_held` (ADR 0218, the founder's round-2 answer 3:
 * a message sent to one person who is Away waits until they are back).
 *
 * The senders (`TeamController.broadcast` to named people, `NotesService`)
 * ask `awayToday` who is Away and `hold` what they will not deliver now;
 * `AwayReleaseService` claims, delivers and deletes. Every read binds its
 * error: an unreadable hold table is never an empty one.
 */
@Injectable()
export class AwayHoldService {
  private readonly logger = new Logger(AwayHoldService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly areaRouting: AreaRoutingService,
  ) {}

  private get sb(): any {
    return this.db.getClient();
  }

  /**
   * Who is Away today in this house, with their last Away day — or `null`
   * when that cannot be read. `null` is said out loud by the caller (the
   * send's response carries `away.readable: false`) and the send goes to
   * everyone as before: a message is never held on a guess.
   */
  async awayToday(restaurantId: string, now: Date = new Date()): Promise<Map<string, string> | null> {
    try {
      return (await this.areaRouting.awayOn(restaurantId, now)).until;
    } catch (e: any) {
      this.logger.error(
        `AWAY_HOLD_AWAY_UNREADABLE restaurant=${restaurantId} — ${e?.message}. ` +
          "Nothing is held on this send; it goes to everyone it names, now.",
      );
      return null;
    }
  }

  /**
   * Write the holds. `false` when the write failed: the caller then delivers
   * to those people NOW rather than drop the message, and says so.
   */
  async hold(rows: NewHeld[]): Promise<boolean> {
    if (rows.length === 0) return true;
    const { error } = await this.sb.from("house_away_held").insert(
      rows.map((r) => ({
        restaurant_id: r.restaurant_id,
        user_id: r.user_id,
        kind: r.kind,
        note_id: r.note_id ?? null,
        member_id: r.member_id ?? null,
        title: r.title ?? null,
        body: r.body ?? null,
        channels: r.channels ?? [],
        sent_by: r.sent_by,
        away_until: r.away_until,
      })),
    );
    if (error) {
      this.logger.error(
        `AWAY_HOLD_WRITE_FAILED restaurant=${rows[0].restaurant_id} rows=${rows.length} — ${error.message}. ` +
          "Delivered now instead of held.",
      );
      return false;
    }
    return true;
  }

  /** Every held row, optionally for one house and one person. Throws on error. */
  async pending(filter: { restaurantId?: string; userId?: string } = {}): Promise<HeldRow[]> {
    let q = this.sb.from("house_away_held").select(HELD_COLUMNS);
    if (filter.restaurantId) q = q.eq("restaurant_id", filter.restaurantId);
    if (filter.userId) q = q.eq("user_id", filter.userId);
    const { data, error } = await q;
    if (error) throw new Error(`house_away_held could not be read: ${error.message}`);
    return ((data ?? []) as any[]).map((r) => ({
      ...r,
      away_until: String(r.away_until).slice(0, 10),
      channels: Array.isArray(r.channels) ? r.channels : [],
    })) as HeldRow[];
  }

  /**
   * Take the row for one release. Compare-and-set on the claim it was read
   * with, so two sweeps (or a sweep and an "End Away now") cannot both win it.
   */
  async claim(row: HeldRow, now: Date): Promise<boolean> {
    let q = this.sb
      .from("house_away_held")
      .update({ claimed_at: now.toISOString() })
      .eq("id", row.id)
      .eq("restaurant_id", row.restaurant_id);
    q = row.claimed_at === null ? q.is("claimed_at", null) : q.eq("claimed_at", row.claimed_at);
    const { data, error } = await q.select("id");
    if (error) throw new Error(`house_away_held could not be claimed: ${error.message}`);
    return Array.isArray(data) && data.length === 1;
  }

  /** Give a claim back after a failed delivery, so the next sweep tries again. */
  async unclaim(row: HeldRow): Promise<void> {
    const { error } = await this.sb
      .from("house_away_held")
      .update({ claimed_at: null })
      .eq("id", row.id)
      .eq("restaurant_id", row.restaurant_id);
    if (error) {
      this.logger.error(
        `AWAY_HOLD_UNCLAIM_FAILED held=${row.id} — ${error.message}. ` +
          "The next sweep takes it over once the claim is stale.",
      );
    }
  }

  /**
   * Delete the row: it was delivered, or its person left the house. The words
   * of a message are kept only while it waits (KVKK: the minimum), so nothing
   * of it outlives its delivery here.
   */
  async done(row: HeldRow): Promise<void> {
    const { error } = await this.sb
      .from("house_away_held")
      .delete()
      .eq("id", row.id)
      .eq("restaurant_id", row.restaurant_id);
    if (error) {
      // Delivered but not deleted: a later sweep would deliver it again, so
      // this is loud. The claim stays, which keeps it from being retaken
      // until the claim goes stale.
      this.logger.error(`AWAY_HOLD_DELETE_FAILED held=${row.id} — ${error.message}.`);
    }
  }
}
