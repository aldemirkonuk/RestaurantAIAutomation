import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { isKnownTimeZone } from "../calendar/reminder-window";
import {
  type AccessChange,
  type AccessChangeReceipt,
  recordAccessChange,
} from "../team/access-audit";
import {
  AREA_DEFAULT_NAMES,
  AREA_NAME_MAX,
  type AreaKind,
  isAreaKind,
} from "./area-label";
import {
  type AreaSetting,
  type HouseRole,
  fillAreas,
  houseLocalDay,
  isIsoDay,
} from "./area-routing";

/**
 * The person asking, as the verified token names them (ADR 0218).
 *
 * `restaurantId` and `role` both come from `JwtStrategy.validate`, which reads
 * the role IN THE HOUSE THE TOKEN NAMES from `user_restaurant_access` on every
 * request (ADR 0162) and answers 503 when it cannot. Nothing here takes a
 * house or a role from the request body or the URL.
 */
export interface HouseActor {
  userId: string;
  restaurantId: string;
  role: HouseRole;
  name: string | null;
}

export interface AreaView extends AreaSetting {
  defaultName: string;
  /** People in this area (with or without an account). */
  members: number;
  leads: number;
}

export interface MembershipView {
  memberId: string;
  userId: string | null;
  kind: AreaKind;
  lead: boolean;
}

export interface AreasReadout {
  role: HouseRole;
  /** Owners and managers edit areas, memberships and lead marks. */
  canManage: boolean;
  /** Somebody is in a switched-on area. False: the house sees no change. */
  inUse: boolean;
  areas: AreaView[];
  /**
   * Owners and managers: every membership in the house. Staff: their own
   * only — who else works where is roster information, and the roster is
   * manager-gated (`TeamService.listMembers`).
   */
  memberships: MembershipView[];
  mine: { memberId: string | null; areas: AreaKind[]; leadOf: AreaKind[] };
}

export interface AwayView {
  userId: string;
  from: string;
  until: string;
  /** Today (house-local) falls inside the window. */
  activeNow: boolean;
  /** The person set it themselves. */
  setBySelf: boolean;
}

export interface AwayReadout {
  today: string;
  canManage: boolean;
  /**
   * Owners and managers: every window that has not ended. Staff: their own.
   * Dates only — there is nothing else to show, because nothing else is kept.
   */
  windows: AwayView[];
}

/** The longest Away window accepted in one go, in days (inclusive). */
export const AWAY_MAX_DAYS = 366;

function isManager(role: HouseRole): boolean {
  return role === "owner" || role === "manager";
}

function dayDiff(from: string, until: string): number {
  return Math.round(
    (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

@Injectable()
export class HouseAreasService {
  private readonly logger = new Logger(HouseAreasService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb(): any {
    return this.db.getClient();
  }

  private assertManage(actor: HouseActor): void {
    if (!isManager(actor.role)) {
      throw new ForbiddenException(
        "Only owners and managers change areas, who works in them and who leads them.",
      );
    }
  }

  private unreadable(what: string, message: string): never {
    this.logger.error(`HOUSE_AREAS_UNREADABLE ${what}: ${message}`);
    throw new ServiceUnavailableException(
      `${what} could not be read, so nothing was shown or changed. Try again.`,
    );
  }

  private async today(restaurantId: string): Promise<string> {
    const { data, error } = await this.sb
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) this.unreadable("The house's time zone", error.message);
    const tz = data?.timezone;
    return houseLocalDay(new Date(), typeof tz === "string" && isKnownTimeZone(tz) ? tz : "UTC");
  }

  // ==========================================================================
  // READ
  // ==========================================================================

  async readout(actor: HouseActor): Promise<AreasReadout> {
    const rid = actor.restaurantId;
    const [areas, memberships, mineRow] = await Promise.all([
      this.sb.from("house_areas").select("kind, name, enabled").eq("restaurant_id", rid),
      this.sb
        .from("house_area_members")
        .select("member_id, kind, is_lead")
        .eq("restaurant_id", rid),
      this.sb
        .from("team_members")
        .select("id")
        .eq("restaurant_id", rid)
        .eq("user_id", actor.userId)
        .maybeSingle(),
    ]);
    if (areas.error) this.unreadable("The house's areas", areas.error.message);
    if (memberships.error) this.unreadable("Who works in which area", memberships.error.message);
    if (mineRow.error) this.unreadable("Your roster row", mineRow.error.message);

    const settings = fillAreas(((areas.data ?? []) as any[]).filter((r) => isAreaKind(r.kind)));
    const rows = ((memberships.data ?? []) as any[]).filter((r) => isAreaKind(r.kind));

    const rosterIds = [...new Set(rows.map((r) => r.member_id as string))];
    const accountOf = new Map<string, string | null>();
    if (rosterIds.length > 0) {
      const roster = await this.sb
        .from("team_members")
        .select("id, user_id")
        .eq("restaurant_id", rid)
        .in("id", rosterIds);
      if (roster.error) this.unreadable("The roster", roster.error.message);
      for (const r of (roster.data ?? []) as any[]) accountOf.set(r.id, r.user_id ?? null);
    }

    const all: MembershipView[] = rows.map((r) => ({
      memberId: r.member_id,
      userId: accountOf.get(r.member_id) ?? null,
      kind: r.kind,
      lead: r.is_lead === true,
    }));
    const on = new Set(settings.filter((s) => s.enabled).map((s) => s.kind));
    const myMemberId: string | null = mineRow.data?.id ?? null;
    const mine = all.filter((m) => m.memberId === myMemberId);

    return {
      role: actor.role,
      canManage: isManager(actor.role),
      inUse: all.some((m) => on.has(m.kind)),
      areas: settings.map((s) => ({
        ...s,
        defaultName: AREA_DEFAULT_NAMES[s.kind],
        members: all.filter((m) => m.kind === s.kind).length,
        leads: all.filter((m) => m.kind === s.kind && m.lead).length,
      })),
      memberships: isManager(actor.role) ? all : mine,
      mine: {
        memberId: myMemberId,
        areas: mine.filter((m) => on.has(m.kind)).map((m) => m.kind),
        leadOf: mine.filter((m) => m.lead && on.has(m.kind)).map((m) => m.kind),
      },
    };
  }

  // ==========================================================================
  // AREAS — rename, switch on or off
  // ==========================================================================

  async setArea(
    actor: HouseActor,
    kind: string,
    patch: { name?: string; enabled?: boolean },
  ): Promise<{ area: AreaSetting; changed: boolean; receipt: AccessChangeReceipt | null }> {
    this.assertManage(actor);
    const k = this.kindOf(kind);
    const rid = actor.restaurantId;

    let name: string | undefined;
    if (patch.name !== undefined) {
      name = String(patch.name).trim();
      if (name === "" || name.length > AREA_NAME_MAX) {
        throw new BadRequestException(
          `An area's name is 1 to ${AREA_NAME_MAX} characters.`,
        );
      }
    }

    const { data: existing, error } = await this.sb
      .from("house_areas")
      .select("id, kind, name, enabled")
      .eq("restaurant_id", rid)
      .eq("kind", k)
      .maybeSingle();
    if (error) this.unreadable("The area", error.message);

    const before: AreaSetting = fillAreas(existing ? [existing] : []).find((a) => a.kind === k)!;
    const after: AreaSetting = {
      kind: k,
      name: name ?? before.name,
      enabled: patch.enabled ?? before.enabled,
    };
    const fields: Record<string, { from: unknown; to: unknown }> = {};
    if (after.name !== before.name) fields.name = { from: before.name, to: after.name };
    if (after.enabled !== before.enabled) fields.enabled = { from: before.enabled, to: after.enabled };
    if (Object.keys(fields).length === 0) {
      return { area: before, changed: false, receipt: null };
    }

    const now = new Date().toISOString();
    let id: string;
    if (existing) {
      const { error: upErr } = await this.sb
        .from("house_areas")
        .update({ name: after.name, enabled: after.enabled, updated_at: now, updated_by: actor.userId })
        .eq("id", existing.id)
        .eq("restaurant_id", rid);
      if (upErr) throw new ServiceUnavailableException(`The area was not saved: ${upErr.message}`);
      id = existing.id;
    } else {
      const { data: ins, error: insErr } = await this.sb
        .from("house_areas")
        .insert({
          restaurant_id: rid,
          kind: k,
          name: after.name,
          enabled: after.enabled,
          updated_by: actor.userId,
        })
        .select("id")
        .single();
      if (insErr) this.writeFailed("The area", insErr);
      id = ins.id;
    }

    const receipt = await this.audit({
      restaurantId: rid,
      actorUserId: actor.userId,
      targetUserId: null,
      action: "house_area_changed",
      entityType: "house_area",
      entityId: id,
      changes: { subject: `${after.name} (${k})`, fields },
    });
    return { area: after, changed: true, receipt };
  }

  // ==========================================================================
  // MEMBERSHIP AND THE LEAD MARK
  // ==========================================================================

  async setMembership(
    actor: HouseActor,
    kind: string,
    memberId: string,
    body: { lead?: boolean },
  ): Promise<{ membership: MembershipView; receipts: AccessChangeReceipt[] }> {
    this.assertManage(actor);
    const k = this.kindOf(kind);
    const rid = actor.restaurantId;
    const person = await this.rosterRow(rid, memberId);
    const areaName = await this.areaName(rid, k);

    const { data: existing, error } = await this.sb
      .from("house_area_members")
      .select("id, is_lead")
      .eq("restaurant_id", rid)
      .eq("member_id", memberId)
      .eq("kind", k)
      .maybeSingle();
    if (error) this.unreadable("Who works in this area", error.message);

    const wasLead = existing ? existing.is_lead === true : false;
    const lead = body.lead ?? wasLead;
    const receipts: AccessChangeReceipt[] = [];
    const subject = `${person.name} · ${areaName}`;
    const now = new Date().toISOString();

    if (!existing) {
      const { error: insErr } = await this.sb.from("house_area_members").insert({
        restaurant_id: rid,
        member_id: memberId,
        kind: k,
        is_lead: lead,
        created_by: actor.userId,
        updated_by: actor.userId,
      });
      if (insErr) this.writeFailed("The area membership", insErr);
      receipts.push(
        await this.audit({
          restaurantId: rid,
          actorUserId: actor.userId,
          targetUserId: person.userId,
          action: "area_member_added",
          entityType: "team_member",
          entityId: memberId,
          changes: { subject, fields: { area: { from: null, to: k } } },
        }),
      );
    } else if (lead !== wasLead) {
      const { error: upErr } = await this.sb
        .from("house_area_members")
        .update({ is_lead: lead, updated_at: now, updated_by: actor.userId })
        .eq("id", existing.id)
        .eq("restaurant_id", rid);
      if (upErr) throw new ServiceUnavailableException(`The lead mark was not saved: ${upErr.message}`);
    }

    if (lead !== wasLead) {
      receipts.push(
        await this.audit({
          restaurantId: rid,
          actorUserId: actor.userId,
          targetUserId: person.userId,
          action: lead ? "area_lead_granted" : "area_lead_removed",
          entityType: "team_member",
          entityId: memberId,
          changes: { subject, fields: { lead: { from: wasLead, to: lead } } },
          notice: lead
            ? {
                title: `You lead ${areaName}`,
                message:
                  `You can now snooze, finish, dismiss and undo ${areaName}'s cards for everyone. ` +
                  "It changes nothing else: no pay, no roster, no other area.",
              }
            : {
                title: `You no longer lead ${areaName}`,
                message: `You still see ${areaName}'s cards; acting on them for everyone is back with the owners and managers.`,
              },
        }),
      );
    }

    return {
      membership: { memberId, userId: person.userId, kind: k, lead },
      receipts,
    };
  }

  async removeMembership(
    actor: HouseActor,
    kind: string,
    memberId: string,
  ): Promise<{ removed: true; receipt: AccessChangeReceipt }> {
    this.assertManage(actor);
    const k = this.kindOf(kind);
    const rid = actor.restaurantId;
    const person = await this.rosterRow(rid, memberId);
    const areaName = await this.areaName(rid, k);

    const { data: existing, error } = await this.sb
      .from("house_area_members")
      .select("id, is_lead")
      .eq("restaurant_id", rid)
      .eq("member_id", memberId)
      .eq("kind", k)
      .maybeSingle();
    if (error) this.unreadable("Who works in this area", error.message);
    if (!existing) throw new NotFoundException(`${person.name} is not in ${areaName}.`);

    const { error: delErr } = await this.sb
      .from("house_area_members")
      .delete()
      .eq("id", existing.id)
      .eq("restaurant_id", rid);
    if (delErr) throw new ServiceUnavailableException(`Nothing was removed: ${delErr.message}`);

    const fields: Record<string, { from: unknown; to: unknown }> = {
      area: { from: k, to: null },
    };
    if (existing.is_lead === true) fields.lead = { from: true, to: false };
    const receipt = await this.audit({
      restaurantId: rid,
      actorUserId: actor.userId,
      targetUserId: person.userId,
      action: "area_member_removed",
      entityType: "team_member",
      entityId: memberId,
      changes: { subject: `${person.name} · ${areaName}`, fields },
    });
    return { removed: true, receipt };
  }

  // ==========================================================================
  // AWAY — dates only
  // ==========================================================================

  async listAway(actor: HouseActor): Promise<AwayReadout> {
    const rid = actor.restaurantId;
    const today = await this.today(rid);
    let q = this.sb
      .from("house_away")
      .select("user_id, away_from, away_until, set_by")
      .eq("restaurant_id", rid)
      .gte("away_until", today);
    if (!isManager(actor.role)) q = q.eq("user_id", actor.userId);
    const { data, error } = await q;
    if (error) this.unreadable("Away dates", error.message);
    return {
      today,
      canManage: isManager(actor.role),
      windows: ((data ?? []) as any[]).map((r) => {
        const from = String(r.away_from).slice(0, 10);
        const until = String(r.away_until).slice(0, 10);
        return {
          userId: r.user_id,
          from,
          until,
          activeNow: from <= today && today <= until,
          setBySelf: r.set_by === r.user_id,
        };
      }),
    };
  }

  async setAway(
    actor: HouseActor,
    targetUserId: string,
    body: { from: string; until: string },
  ): Promise<{ window: AwayView; receipt: AccessChangeReceipt | null }> {
    const rid = actor.restaurantId;
    const self = targetUserId === actor.userId;
    if (!self && !isManager(actor.role)) {
      throw new ForbiddenException(
        "Away dates are personal: you can set your own, and owners and managers can set them for someone.",
      );
    }
    const { from, until } = body;
    if (!isIsoDay(from) || !isIsoDay(until)) {
      throw new BadRequestException("Away dates are calendar days, YYYY-MM-DD.");
    }
    if (until < from) throw new BadRequestException("Away ends on or after the day it starts.");
    if (dayDiff(from, until) + 1 > AWAY_MAX_DAYS) {
      throw new BadRequestException(`One Away window is at most ${AWAY_MAX_DAYS} days.`);
    }
    const today = await this.today(rid);
    if (until < today) throw new BadRequestException("Those dates are already over.");

    const targetName = self ? actor.name : await this.assertHouseMember(rid, targetUserId);

    const { data: existing, error } = await this.sb
      .from("house_away")
      .select("away_from, away_until")
      .eq("restaurant_id", rid)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error) this.unreadable("Away dates", error.message);

    const now = new Date().toISOString();
    if (existing) {
      const { error: upErr } = await this.sb
        .from("house_away")
        .update({ away_from: from, away_until: until, set_by: actor.userId, updated_at: now })
        .eq("restaurant_id", rid)
        .eq("user_id", targetUserId);
      if (upErr) throw new ServiceUnavailableException(`Away was not saved: ${upErr.message}`);
    } else {
      const { error: insErr } = await this.sb.from("house_away").insert({
        restaurant_id: rid,
        user_id: targetUserId,
        away_from: from,
        away_until: until,
        set_by: actor.userId,
      });
      if (insErr) this.writeFailed("Away", insErr);
    }

    // A person's own dates are theirs and are not written to the house log
    // (judge v1 §4.6). Dates set FOR someone are, and the person is told.
    let receipt: AccessChangeReceipt | null = null;
    if (!self) {
      const before = existing
        ? `${String(existing.away_from).slice(0, 10)} to ${String(existing.away_until).slice(0, 10)}`
        : null;
      receipt = await this.audit({
        restaurantId: rid,
        actorUserId: actor.userId,
        targetUserId,
        action: "away_set_for_member",
        entityType: "restaurant_member",
        entityId: targetUserId,
        changes: {
          subject: targetName ?? null,
          fields: { away: { from: before, to: `${from} to ${until}` } },
        },
        notice: {
          title: "Away dates set for you",
          message:
            `${actor.name ?? "An owner or manager"} set you Away from ${from} to ${until}. ` +
            "Most alerts will skip you on those days. You can change or end it from Team.",
        },
      });
    }

    return {
      window: {
        userId: targetUserId,
        from,
        until,
        activeNow: from <= today && today <= until,
        setBySelf: self,
      },
      receipt,
    };
  }

  async endAway(
    actor: HouseActor,
    targetUserId: string,
  ): Promise<{ ended: true; receipt: AccessChangeReceipt | null }> {
    const rid = actor.restaurantId;
    const self = targetUserId === actor.userId;
    if (!self && !isManager(actor.role)) {
      throw new ForbiddenException(
        "Away dates are personal: you can end your own, and owners and managers can end someone's.",
      );
    }
    const { data: existing, error } = await this.sb
      .from("house_away")
      .select("away_from, away_until")
      .eq("restaurant_id", rid)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error) this.unreadable("Away dates", error.message);
    if (!existing) throw new NotFoundException("No Away dates are on file for this person.");

    const { error: delErr } = await this.sb
      .from("house_away")
      .delete()
      .eq("restaurant_id", rid)
      .eq("user_id", targetUserId);
    if (delErr) throw new ServiceUnavailableException(`Away was not ended: ${delErr.message}`);

    let receipt: AccessChangeReceipt | null = null;
    if (!self) {
      const targetName = await this.nameOf(targetUserId);
      receipt = await this.audit({
        restaurantId: rid,
        actorUserId: actor.userId,
        targetUserId,
        action: "away_ended_for_member",
        entityType: "restaurant_member",
        entityId: targetUserId,
        changes: {
          subject: targetName,
          fields: {
            away: {
              from: `${String(existing.away_from).slice(0, 10)} to ${String(existing.away_until).slice(0, 10)}`,
              to: null,
            },
          },
        },
        notice: {
          title: "Your Away dates were ended",
          message: `${actor.name ?? "An owner or manager"} ended your Away. Alerts reach you again.`,
        },
      });
    }
    return { ended: true, receipt };
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private kindOf(kind: string): AreaKind {
    if (!isAreaKind(kind)) {
      throw new BadRequestException(
        "Unknown area. The kinds are kitchen, bar, floor, cellar, receiving and management.",
      );
    }
    return kind;
  }

  private async areaName(restaurantId: string, kind: AreaKind): Promise<string> {
    const { data, error } = await this.sb
      .from("house_areas")
      .select("kind, name, enabled")
      .eq("restaurant_id", restaurantId)
      .eq("kind", kind)
      .maybeSingle();
    if (error) this.unreadable("The area", error.message);
    return fillAreas(data ? [data] : []).find((a) => a.kind === kind)!.name;
  }

  /** The roster row in THIS house, or 404. Never a row from another house. */
  private async rosterRow(
    restaurantId: string,
    memberId: string,
  ): Promise<{ userId: string | null; name: string }> {
    const { data, error } = await this.sb
      .from("team_members")
      .select("id, user_id, display_name")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) this.unreadable("The roster", error.message);
    if (!data) throw new NotFoundException("That person is not on this house's roster.");
    return { userId: data.user_id ?? null, name: data.display_name?.trim() || "No name on file" };
  }

  /**
   * The target is an active member of THIS house (the same test
   * `TeamService.assertAccess` uses: an active access row, or the legacy
   * `users.restaurant_id`). Returns their name for the log line.
   */
  private async assertHouseMember(restaurantId: string, userId: string): Promise<string | null> {
    const [access, user] = await Promise.all([
      this.sb
        .from("user_restaurant_access")
        .select("user_id")
        .eq("user_id", userId)
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .maybeSingle(),
      this.sb.from("users").select("user_id, name, restaurant_id").eq("user_id", userId).maybeSingle(),
    ]);
    if (access.error) this.unreadable("House membership", access.error.message);
    if (user.error) this.unreadable("The person's account", user.error.message);
    const member = !!access.data || user.data?.restaurant_id === restaurantId;
    if (!member) throw new NotFoundException("That person is not a member of this house.");
    return user.data?.name ?? null;
  }

  /**
   * A name for the log line's subject only. The act has already happened when
   * this runs, so an unreadable name is logged and the row is written without
   * one (its entity id still names the person) rather than undoing the act.
   */
  private async nameOf(userId: string): Promise<string | null> {
    const { data, error } = await this.sb
      .from("users")
      .select("name")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      this.logger.warn(`HOUSE_AREAS_NAME_UNREADABLE user=${userId}: ${error.message}`);
      return null;
    }
    return data?.name ?? null;
  }

  private writeFailed(what: string, error: { code?: string; message: string }): never {
    if (error.code === "23505") {
      throw new ConflictException(`${what} was changed by someone else just now. Reload and try again.`);
    }
    throw new ServiceUnavailableException(`${what} was not saved: ${error.message}`);
  }

  private audit(change: AccessChange): Promise<AccessChangeReceipt> {
    return recordAccessChange(this.sb, this.logger, change);
  }
}
