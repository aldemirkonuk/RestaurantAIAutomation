import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DatabaseService } from "../database/database.service";
import { AreaRoutingService } from "../areas/area-routing.service";
import { NotificationsService } from "../notifications/notifications.service";
import { ExpoPushService } from "../push/expo-push.service";
import { isWithinQuietHours, type QuietHours } from "../calendar/reminder-window";
import { AwayHoldService } from "./away-hold.service";
import {
  type HeldRow,
  LEFT_BEFORE_RETURN,
  isClaimable,
  releaseVerdict,
} from "./away-hold";
import { NotesService } from "./notes.service";
import { TeamService } from "./team.service";

const RELEASE_CRON = "*/15 * * * *";
const RELEASE_JOB = "away-held-release";
const QUIET_OFF: QuietHours = { enabled: false, start: "22:00", end: "08:00" };

/** What one release pass did, in counts — never ids or words. */
export interface ReleaseTally {
  considered: number;
  released: number;
  stillAway: number;
  quietHours: number;
  /** The person left the house before coming back: dropped, never delivered. */
  leftHouse: number;
  /** The note or the roster row was deleted while it waited: nothing was owed. */
  gone: number;
  /** Another release holds the claim. */
  claimedElsewhere: number;
  /** A delivery threw; the claim was handed back for the next sweep. */
  failed: number;
  /** Houses whose Away, membership or quiet-hours read failed: nothing moved. */
  unreadable: number;
}

function emptyTally(): ReleaseTally {
  return {
    considered: 0,
    released: 0,
    stillAway: 0,
    quietHours: 0,
    leftHouse: 0,
    gone: 0,
    claimedElsewhere: 0,
    failed: 0,
    unreadable: 0,
  };
}

/**
 * Delivers what waited for a person while they were Away (ADR 0218, the
 * founder's round-2 answer 3, 2026-09-21): "a note/message sent to one person
 * who is Away waits until they are back".
 *
 * WHEN "BACK" IS. The first sweep on a house-local day that is no longer an
 * Away day for them, outside their own quiet hours — so the return day's
 * first minutes do not wake anyone the product would not otherwise wake. An
 * "End Away now" releases at once (`releaseFor`), under the same quiet-hours
 * rule.
 *
 * NOT FLAGGED. Holding is live wherever Away is, so releasing must be too: a
 * release behind an off-by-default flag would turn "waits until they are back"
 * into "never arrives".
 *
 * FAILURES. An unreadable Away, membership or quiet-hours register moves
 * nothing for that house on this pass (it is delayed, never guessed), and the
 * log says so. A delivery that throws hands its claim back for the next pass.
 */
@Injectable()
export class AwayReleaseService {
  private readonly logger = new Logger(AwayReleaseService.name);

  static readonly CRON = RELEASE_CRON;
  static readonly JOB = RELEASE_JOB;

  constructor(
    private readonly db: DatabaseService,
    private readonly hold: AwayHoldService,
    private readonly areaRouting: AreaRoutingService,
    private readonly notes: NotesService,
    private readonly notifications: NotificationsService,
    private readonly push: ExpoPushService,
    private readonly team: TeamService,
  ) {}

  private get sb(): any {
    return this.db.getClient();
  }

  @Cron(RELEASE_CRON, { name: RELEASE_JOB })
  async sweep(now: Date = new Date()): Promise<ReleaseTally> {
    const tally = emptyTally();
    let rows: HeldRow[];
    try {
      rows = await this.hold.pending();
    } catch (e: any) {
      this.logger.error(`AWAY_HOLD_RELEASE_UNREADABLE — ${e?.message}. Nothing was released on this pass.`);
      tally.unreadable++;
      return tally;
    }
    const byHouse = new Map<string, HeldRow[]>();
    for (const r of rows) {
      const list = byHouse.get(r.restaurant_id) ?? [];
      list.push(r);
      byHouse.set(r.restaurant_id, list);
    }
    for (const [rid, list] of byHouse) {
      add(tally, await this.releaseHouse(rid, list, now));
    }
    if (tally.considered > 0) {
      this.logger.log(
        `AWAY_HOLD_RELEASE ${Object.entries(tally)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`,
      );
    }
    return tally;
  }

  /**
   * Release what waits for one person in one house now — called when their
   * Away is ended or moved off today. Never throws: the sweep is the backstop.
   */
  async releaseFor(restaurantId: string, userId: string, now: Date = new Date()): Promise<ReleaseTally> {
    try {
      const rows = await this.hold.pending({ restaurantId, userId });
      if (rows.length === 0) return emptyTally();
      return await this.releaseHouse(restaurantId, rows, now);
    } catch (e: any) {
      this.logger.error(
        `AWAY_HOLD_RELEASE_FOR_FAILED restaurant=${restaurantId} — ${e?.message}. The next sweep delivers it.`,
      );
      const t = emptyTally();
      t.unreadable++;
      return t;
    }
  }

  private async releaseHouse(restaurantId: string, rows: HeldRow[], now: Date): Promise<ReleaseTally> {
    const tally = emptyTally();
    const claimable = rows.filter((r) => isClaimable(r.claimed_at, now));
    tally.claimedElsewhere += rows.length - claimable.length;
    if (claimable.length === 0) return tally;
    tally.considered += claimable.length;

    const userIds = [...new Set(claimable.map((r) => r.user_id))];
    let facts;
    try {
      const away = await this.areaRouting.awayOn(restaurantId, now);
      const [members, quiet] = await Promise.all([
        this.membersOf(restaurantId, userIds),
        this.quietNow(restaurantId, userIds, now, away.zone),
      ]);
      facts = { members, awayToday: new Set(away.until.keys()), quietNow: quiet };
    } catch (e: any) {
      this.logger.error(
        `AWAY_HOLD_RELEASE_UNREADABLE restaurant=${restaurantId} — ${e?.message}. ` +
          `${claimable.length} held item(s) keep waiting; the next pass tries again.`,
      );
      tally.considered -= claimable.length;
      tally.unreadable++;
      return tally;
    }

    for (const row of claimable) {
      const verdict = releaseVerdict(row.user_id, facts);
      if (verdict === "still_away") {
        tally.stillAway++;
        continue;
      }
      if (verdict === "quiet_hours") {
        tally.quietHours++;
        continue;
      }
      let won: boolean;
      try {
        won = await this.hold.claim(row, now);
      } catch (e: any) {
        this.logger.error(`AWAY_HOLD_CLAIM_FAILED held=${row.id} — ${e?.message}. The next pass tries again.`);
        tally.failed++;
        continue;
      }
      if (!won) {
        tally.claimedElsewhere++;
        continue;
      }
      if (verdict === "not_in_house") {
        if (row.kind === "team_note" && row.note_id && row.member_id) {
          await this.notes.closeHeldForLeaver(row.note_id, row.member_id, LEFT_BEFORE_RETURN);
        }
        await this.hold.done(row);
        tally.leftHouse++;
        continue;
      }
      try {
        const delivered = await this.deliver(row);
        await this.hold.done(row);
        if (delivered) tally.released++;
        else tally.gone++;
      } catch (e: any) {
        this.logger.error(
          `AWAY_HOLD_DELIVERY_FAILED held=${row.id} restaurant=${restaurantId} — ${e?.message}. ` +
            "Handed back for the next pass.",
        );
        await this.hold.unclaim(row);
        tally.failed++;
      }
    }
    return tally;
  }

  /** `false`: the note or roster row is gone, so nothing was owed. Throws on a failed delivery. */
  private async deliver(row: HeldRow): Promise<boolean> {
    if (row.kind === "team_note") {
      if (!row.note_id || !row.member_id) throw new Error("a held note names no note or no person");
      const out = await this.notes.releaseHeld(row.restaurant_id, row.note_id, row.member_id);
      return out.delivered;
    }
    // A team message, exactly as `TeamController.broadcast` sends one to a
    // named person: the inbox row, then the push unless they switched it off.
    const channels = row.channels ?? [];
    if (!row.body) throw new Error("a held message carries no words");
    if (channels.includes("inbox")) {
      const out = await this.notifications.persistForRestaurant(
        row.restaurant_id,
        {
          type: "system",
          title: row.title ?? "Team broadcast",
          message: row.body,
          priority: "high",
          actionUrl: "/team",
          actionLabel: "Open Team",
        },
        // `skipMobilePush`: the push leg below is this path's own, read against
        // the person's push switch. Without it the funnel's own fan-out pushed
        // a second time at priority "high", ignored a push opt-out, and pushed
        // an inbox-only message too — the same defect #448 closed for
        // `TeamController.broadcast`, which this delivery mirrors.
        { onlyUserIds: [row.user_id], skipMobilePush: true },
      );
      // The funnel swallows its own failures and answers 0; for one person
      // who is a member, 0 is a failed write, never "nobody wanted it".
      if (!out || out.inserted === 0) throw new Error("the inbox row was not written");
    }
    if (channels.includes("push")) {
      const optOuts = await this.team.channelOptOuts([row.user_id], row.restaurant_id);
      if (optOuts === null) {
        this.logger.warn(
          `AWAY_HOLD_PUSH_SKIPPED held=${row.id} — push preferences could not be read, so no push was sent.`,
        );
      } else if (!optOuts.optedOut.push.has(row.user_id)) {
        await this.push.sendToUsers([row.user_id], {
          title: row.title ?? "Message from your manager",
          body: row.body,
          priority: "high",
          data: { type: "team_broadcast", actionUrl: "/team" },
        });
      }
    }
    return true;
  }

  /**
   * The held people who are still members of this house, read the way the
   * token reads a house (`auth/house-role.ts`): an active access row, or the
   * legacy `users.restaurant_id`. Throws on a failed read — "not a member" must never
   * be what an unreadable table looks like, or a returning person's messages
   * would be thrown away.
   */
  private async membersOf(restaurantId: string, userIds: string[]): Promise<Set<string>> {
    const [access, users] = await Promise.all([
      this.sb
        .from("user_restaurant_access")
        .select("user_id, role")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .in("user_id", userIds),
      this.sb.from("users").select("user_id, restaurant_id, role").in("user_id", userIds),
    ]);
    if (access.error) throw new Error(`user_restaurant_access could not be read: ${access.error.message}`);
    if (users.error) throw new Error(`users could not be read: ${users.error.message}`);
    const accessOf = new Map(((access.data ?? []) as any[]).map((r) => [r.user_id, r]));
    const userOf = new Map(((users.data ?? []) as any[]).map((r) => [r.user_id, r]));
    const out = new Set<string>();
    for (const id of userIds) {
      const access = accessOf.get(id) ?? null;
      const user = userOf.get(id) ?? null;
      if (access || (user && user.restaurant_id === restaurantId)) out.add(id);
    }
    return out;
  }

  /** The held people inside their own quiet hours right now. Throws on error. */
  private async quietNow(
    restaurantId: string,
    userIds: string[],
    now: Date,
    zone: string,
  ): Promise<Set<string>> {
    const { data, error } = await this.sb
      .from("notification_preferences")
      .select("user_id, restaurant_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end")
      .in("user_id", userIds);
    if (error) throw new Error(`notification_preferences could not be read: ${error.message}`);
    const quiet = new Map<string, QuietHours>();
    for (const raw of (data ?? []) as any[]) {
      // A person with rows in two houses: this house's row wins.
      if (quiet.has(raw.user_id) && raw.restaurant_id !== restaurantId) continue;
      quiet.set(raw.user_id, {
        enabled: raw.quiet_hours_enabled === true,
        start: raw.quiet_hours_start || "22:00",
        end: raw.quiet_hours_end || "08:00",
      });
    }
    return new Set(
      userIds.filter((id) => isWithinQuietHours(now, zone, quiet.get(id) ?? QUIET_OFF)),
    );
  }
}

function add(into: ReleaseTally, from: ReleaseTally): void {
  for (const k of Object.keys(into) as Array<keyof ReleaseTally>) into[k] += from[k];
}
