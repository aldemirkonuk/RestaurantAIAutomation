import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { isKnownTimeZone } from "../calendar/reminder-window";
import { type AreaKind, type AreaLabel, isAreaKind } from "./area-label";
import {
  type AreaMembership,
  type AwayWindow,
  type HouseAreasSnapshot,
  type HouseMember,
  type HouseRole,
  type RouteDecision,
  fillAreas,
  houseLocalDay,
  isAwayOn,
  routeAlert,
} from "./area-routing";

/**
 * What the notification funnel is told about one fan-out.
 *
 * `degraded` is non-null when the area registers could not be read. The funnel
 * then writes to EVERY member, exactly as before ADR 0218: a routing failure
 * must never cost the house an alert, and a failure that silently narrowed the
 * audience to nobody would be the absence-reported-as-health fault again. The
 * sentence is logged at error level under `AREA_ROUTING_UNREADABLE` so the
 * fallback is loud, never quiet.
 */
export interface RoutingOutcome extends RouteDecision {
  degraded: string | null;
}

/**
 * Reads one house's areas, memberships, roles and Away dates, and hands them to
 * the pure ladder in `area-routing.ts`.
 *
 * Every read binds its error and THROWS inside `snapshot`, because an
 * unreadable register is not an empty one: "nobody is Away" and "the Away
 * table did not answer" must not look the same. `route` is the one place the
 * throw is caught, and it falls back to today's audience rather than to none.
 */
@Injectable()
export class AreaRoutingService {
  private readonly logger = new Logger(AreaRoutingService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb(): any {
    return this.db.getClient();
  }

  /**
   * The routing snapshot for `memberIds` — the audience the funnel already
   * resolved (`DatabaseService.getRestaurantMemberIds`), so "everyone" here is
   * byte-for-byte the audience it had before this ADR.
   */
  async snapshot(
    restaurantId: string,
    memberIds: string[],
    now: Date,
  ): Promise<HouseAreasSnapshot> {
    const [access, house, areas, memberships] = await Promise.all([
      this.sb
        .from("user_restaurant_access")
        .select("user_id, role")
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true),
      this.sb.from("restaurants").select("timezone").eq("id", restaurantId).maybeSingle(),
      this.sb
        .from("house_areas")
        .select("kind, name, enabled")
        .eq("restaurant_id", restaurantId),
      this.sb
        .from("house_area_members")
        .select("member_id, kind, is_lead")
        .eq("restaurant_id", restaurantId),
    ]);
    for (const [name, res] of [
      ["user_restaurant_access", access],
      ["restaurants", house],
      ["house_areas", areas],
      ["house_area_members", memberships],
    ] as const) {
      if (res?.error) throw new Error(`${name} could not be read: ${res.error.message}`);
    }

    const zone = this.zoneOf(restaurantId, house.data?.timezone);
    const today = houseLocalDay(now, zone);

    const roles = new Map<string, HouseRole>();
    for (const row of (access.data ?? []) as any[]) {
      roles.set(row.user_id, readRole(row.role));
    }
    const members: HouseMember[] = [...new Set(memberIds)].map((userId) => ({
      userId,
      // A member the funnel knows only through the legacy `users.restaurant_id`
      // row has no access row, and that row proves membership, never privilege
      // (ADR 0088): staff.
      role: roles.get(userId) ?? "staff",
    }));

    const memberRows = ((memberships.data ?? []) as any[]).filter((r) => isAreaKind(r.kind));
    const rosterIds = [...new Set(memberRows.map((r) => r.member_id as string))];
    const accountOf = new Map<string, string | null>();
    if (rosterIds.length > 0) {
      const roster = await this.sb
        .from("team_members")
        .select("id, user_id")
        .eq("restaurant_id", restaurantId)
        .in("id", rosterIds);
      if (roster.error) throw new Error(`team_members could not be read: ${roster.error.message}`);
      for (const r of (roster.data ?? []) as any[]) accountOf.set(r.id, r.user_id ?? null);
    }
    const areaMemberships: AreaMembership[] = memberRows.map((r) => ({
      memberId: r.member_id,
      userId: accountOf.get(r.member_id) ?? null,
      kind: r.kind as AreaKind,
      isLead: r.is_lead === true,
    }));

    const away = await this.readAway(restaurantId, today);

    return {
      members,
      areas: fillAreas(((areas.data ?? []) as any[]).filter((r) => isAreaKind(r.kind))),
      memberships: areaMemberships,
      away,
      today,
    };
  }

  /**
   * Who the funnel writes to for one item carrying `label`.
   *
   * Never throws. On an unreadable register it answers "everyone in
   * `memberIds`", says so in `degraded`, and logs it — see `RoutingOutcome`.
   */
  async route(
    restaurantId: string,
    memberIds: string[],
    label: AreaLabel,
    now: Date = new Date(),
  ): Promise<RoutingOutcome> {
    try {
      const snap = await this.snapshot(restaurantId, memberIds, now);
      return { ...routeAlert(label, snap), degraded: null };
    } catch (e: any) {
      const reason = String(e?.message ?? e);
      this.logger.error(
        `AREA_ROUTING_UNREADABLE restaurant=${restaurantId} label=${label ?? "house"} — ${reason}. ` +
          "Written to every member, as before areas existed; nobody is treated as Away on this send.",
      );
      return {
        label,
        step: "everyone",
        alert: [...new Set(memberIds)],
        inboxOnly: [],
        heldAway: 0,
        degraded: reason,
      };
    }
  }

  /**
   * The user ids Away on the house-local day at `now`, for the producer
   * ledger's audience split. Throws on an unreadable register; the caller
   * decides what that costs.
   */
  async awayUserIds(restaurantId: string, now: Date, timeZone: string): Promise<Set<string>> {
    const zone = isKnownTimeZone(timeZone) ? timeZone : "UTC";
    const today = houseLocalDay(now, zone);
    const windows = await this.readAway(restaurantId, today);
    return new Set(windows.filter((w) => isAwayOn(w, today)).map((w) => w.userId));
  }

  /**
   * Who is Away on the house-local day at `now`, with the last day of each
   * window — what a sender is told ("away until 28 Sep") when a message to
   * one person is held for their return (ADR 0218, the founder's round-2
   * answer 3). Throws on an unreadable register or time zone; the caller
   * decides what that costs.
   */
  async awayOn(
    restaurantId: string,
    now: Date,
  ): Promise<{ today: string; zone: string; until: Map<string, string> }> {
    const { data, error } = await this.sb
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw new Error(`restaurants could not be read: ${error.message}`);
    const zone = this.zoneOf(restaurantId, data?.timezone);
    const today = houseLocalDay(now, zone);
    const until = new Map<string, string>();
    for (const w of await this.readAway(restaurantId, today)) {
      if (isAwayOn(w, today)) until.set(w.userId, w.until);
    }
    return { today, zone, until };
  }

  /**
   * Every window in this house that ends on or after `sinceDay`. The digest
   * asks about the day a letter FELL DUE, which can be yesterday, so it needs
   * windows that today's read would already have dropped. Throws on error.
   */
  async awayWindowsSince(restaurantId: string, sinceDay: string): Promise<AwayWindow[]> {
    return this.readAway(restaurantId, sinceDay);
  }

  /** Every window that has not ended before `today`. */
  private async readAway(restaurantId: string, today: string): Promise<AwayWindow[]> {
    const { data, error } = await this.sb
      .from("house_away")
      .select("user_id, away_from, away_until")
      .eq("restaurant_id", restaurantId)
      .gte("away_until", today);
    if (error) throw new Error(`house_away could not be read: ${error.message}`);
    return ((data ?? []) as any[]).map((r) => ({
      userId: r.user_id,
      from: String(r.away_from).slice(0, 10),
      until: String(r.away_until).slice(0, 10),
    }));
  }

  private zoneOf(restaurantId: string, tz: unknown): string {
    if (typeof tz === "string" && isKnownTimeZone(tz)) return tz;
    this.logger.error(
      `AREA_ROUTING_TIMEZONE_UNKNOWN restaurant=${restaurantId} timezone=${JSON.stringify(tz)} — ` +
        "Away dates are read against UTC for this house until the column is fixed.",
    );
    return "UTC";
  }
}

export function readRole(value: unknown): HouseRole {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  return v === "owner" || v === "manager" ? v : "staff";
}
