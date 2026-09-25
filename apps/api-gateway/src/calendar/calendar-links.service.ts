import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import * as crypto from "crypto";
import { DatabaseService } from "../database/database.service";
import {
  AREAS_NOT_MODELLED,
  FEED_CATEGORIES,
  PERSON_AREAS,
  feedRoleOf,
  feedScopeFor,
  isFeedCategory,
  scopeSentence,
  selectEvents,
  selectShifts,
  type FeedCategory,
  type FeedRole,
  type PersonAreas,
  type PersonAreasSource,
} from "./feed-scope";
import {
  expiredNoticeFeed,
  renderFeed,
  type FeedEventRow,
  type FeedRecurrenceRule,
  type FeedShift,
} from "./ical-render";
import { resolveZone } from "./zoned-time";
import { roleInHouse } from "../auth/house-role";
import { stopCalendarLinksOnLeaving } from "./stop-links-on-leaving";

/**
 * Personal calendar links (ADR 0111, review trail 2026-09-21).
 *
 * The founder, 2026-09-21: *"every manager, staff and their labeled
 * taskforces/areas, owners have different calendar subscriptions, they can
 * connect their own. Soit should be personalized"* — and, on the example of
 * Ayse at the bar and the owner, *"Yes, personal links"*.
 *
 * THE RULES THIS FILE HOLDS
 * -------------------------
 *  1. A link is made only by the person it belongs to, by pressing a button
 *     (`create`). Reading (`getMine`) never writes — a page view does not
 *     mint a credential (the defect this lane first closed).
 *  2. One live link per person per house (a partial unique index,
 *     migration 20260925180300). The secret is stored as a SHA-256 hash and
 *     shown once, the way `mcp_server_credentials` keeps its keys.
 *  3. What a link serves is decided when the calendar app ASKS, from the
 *     person's role in the house at that moment (`feed-scope.ts`). A person
 *     who leaves the house loses the link for good: every door that ends a
 *     membership stops it, audited, before its first membership write
 *     (`stop-links-on-leaving.ts`; the founder, round 6t: *"Yes, revoke on
 *     leaving (Recommended)"*), and a live link whose person has no role —
 *     a membership that ended outside those doors — is stopped by the feed
 *     itself. A returning person connects again; an old address never
 *     revives. Nobody else's link is touched.
 *  4. The person may rotate or revoke their own. An owner may stop anyone's
 *     link; a manager may stop a manager's or staff's, never an owner's
 *     (ADR 0162's owner rule; the founder, round 6t: *"No, owners only
 *     (Recommended)"*). Every one of those acts — and a category pick — is
 *     filed to `system_audit_log` under the caller's `public.users` id, never
 *     with the secret.
 *  5. Nothing expires on a timer.
 *  6. A dead address (revoked, rotated away, left the house, never existed,
 *     the retired shared house link) answers `expiredNoticeFeed` — the same
 *     bytes for all of them. A read that FAILS is not a dead address: it is
 *     `FeedUnavailableError`, which the controller answers 503 so the
 *     subscriber keeps its last good copy instead of being told its link
 *     expired.
 */

/** A read the feed needed failed. Never shown to a subscriber as "expired". */
export class FeedUnavailableError extends Error {}

const SECRET_SHAPE = /^[0-9a-f]{64}$/;

/** How far back a link reaches for shifts. Events are served whole, as before. */
const SHIFT_LOOKBACK_DAYS = 31;

export function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

interface LinkRow {
  id: string;
  restaurant_id: string;
  user_id: string;
  categories: string[] | null;
  created_at: string;
  issued_at: string;
  last_fetched_at: string | null;
}

/** What the page is told about the caller's own link. Never the secret. */
export interface MyCalendarLink {
  connected: boolean;
  createdAt: string | null;
  issuedAt: string | null;
  lastFetchedAt: string | null;
  role: FeedRole;
  scope: string;
  categories: FeedCategory[] | null;
  canPickCategories: boolean;
  areasModelled: boolean;
  /** True for an owner or manager of a house whose shared link was retired. */
  houseLinkRetired: boolean;
}

export interface HouseLinkRow {
  userId: string;
  name: string | null;
  /**
   * The person's role in the house now, read the way the ADR 0162 doors read
   * it (`house-role.ts`); null when they are no longer a member.
   */
  role: FeedRole | null;
  /** Whether the caller may stop this link (owners manage owners). */
  canStop: boolean;
  createdAt: string;
  issuedAt: string;
  lastFetchedAt: string | null;
}

/** A role word from `roleInHouse`, narrowed to the three the feed knows. */
function narrowRole(role: string | null): FeedRole | null {
  if (role === null) return null;
  return role === "owner" ? "owner" : role === "manager" ? "manager" : "staff";
}

type AuditAction =
  | "calendar_link_created"
  | "calendar_link_rotated"
  | "calendar_link_revoked"
  | "calendar_link_categories_changed";

@Injectable()
export class CalendarLinksService {
  private readonly logger = new Logger(CalendarLinksService.name);

  /** Overridable in tests, so the expired notice is compared at one instant. */
  clock: () => Date = () => new Date();

  constructor(
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(PERSON_AREAS)
    private readonly areasSource?: PersonAreasSource,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  private get areas(): PersonAreasSource {
    return this.areasSource ?? AREAS_NOT_MODELLED;
  }

  // ==========================================================================
  // WHO THE PERSON IS IN THIS HOUSE
  // ==========================================================================

  /**
   * The person's role here, read the way the feed reads it. A failed read
   * throws — it is never "not a member".
   */
  async roleOf(restaurantId: string, userId: string): Promise<FeedRole | null> {
    const { data: access, error: accessErr } = await this.db
      .from("user_restaurant_access")
      .select("role, valid_until")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (accessErr) {
      throw new FeedUnavailableError(
        `Could not read this person's access to the house: ${accessErr.message}`,
      );
    }
    let userRow: { restaurant_id?: string | null } | null = null;
    if (!access || access.length === 0) {
      const { data: user, error: userErr } = await this.db
        .from("users")
        .select("restaurant_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (userErr) {
        throw new FeedUnavailableError(
          `Could not read this person's user row: ${userErr.message}`,
        );
      }
      userRow = user ?? null;
    }
    return feedRoleOf(access ?? [], userRow, restaurantId, this.clock());
  }

  private async liveLinkOf(
    restaurantId: string,
    userId: string,
  ): Promise<LinkRow | null> {
    const { data, error } = await this.db
      .from("calendar_feed_links")
      .select(
        "id, restaurant_id, user_id, categories, created_at, issued_at, last_fetched_at",
      )
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) {
      throw new Error(`Could not read your calendar link: ${error.message}`);
    }
    return (data as LinkRow | null) ?? null;
  }

  // ==========================================================================
  // THE CALLER'S OWN LINK
  // ==========================================================================

  /** Read-only. Never creates anything. */
  async getMine(restaurantId: string, userId: string): Promise<MyCalendarLink> {
    const role = await this.requireRole(restaurantId, userId);
    const link = await this.liveLinkOf(restaurantId, userId);
    const areas =
      role === "staff"
        ? await this.areas.areasOf(restaurantId, userId)
        : ({ modelled: false } as PersonAreas);
    const houseLinkRetired =
      role === "staff" ? false : await this.houseLinkWasRetired(restaurantId);
    return this.describe(role, link, areas, houseLinkRetired);
  }

  /**
   * Make the caller's link. The secret is returned here and nowhere else.
   * A second press (another tab) finds the live row and returns
   * `secret: null` — the existing secret cannot be shown again.
   */
  async create(
    restaurantId: string,
    userId: string,
    categories?: readonly string[] | null,
  ): Promise<{ link: MyCalendarLink; secret: string | null }> {
    await this.requireRole(restaurantId, userId);
    const picked = this.validatePick(categories);

    const existing = await this.liveLinkOf(restaurantId, userId);
    if (existing) {
      return { link: await this.getMine(restaurantId, userId), secret: null };
    }

    const secret = crypto.randomBytes(32).toString("hex");
    const now = this.clock().toISOString();
    const { data: inserted, error } = await this.db
      .from("calendar_feed_links")
      .insert({
        restaurant_id: restaurantId,
        user_id: userId,
        token_hash: hashSecret(secret),
        categories: picked ?? null,
        created_at: now,
        issued_at: now,
      })
      .select("id")
      .single();

    if (error) {
      // 23505 on the live-person index: another press won between the read
      // above and this insert. Theirs is the link; this secret was never kept.
      if ((error as { code?: string }).code === "23505") {
        return { link: await this.getMine(restaurantId, userId), secret: null };
      }
      throw new Error(`Could not create your calendar link: ${error.message}`);
    }

    await this.audit(
      restaurantId,
      userId,
      "calendar_link_created",
      (inserted as { id: string }).id,
      {
        for_user_id: userId,
        categories: picked ?? null,
      },
    );
    return { link: await this.getMine(restaurantId, userId), secret };
  }

  /**
   * Replace the secret on the caller's live link — one UPDATE, so there is no
   * moment with two live secrets or none. The old address answers the expired
   * notice from the next request. With no live link this is a `create`.
   */
  async rotate(
    restaurantId: string,
    userId: string,
    retried = false,
  ): Promise<{ link: MyCalendarLink; secret: string }> {
    await this.requireRole(restaurantId, userId);
    const existing = await this.liveLinkOf(restaurantId, userId);
    if (!existing) {
      const made = await this.create(restaurantId, userId);
      if (made.secret) return { link: made.link, secret: made.secret };
      // Lost a create race to another tab: rotate the link that tab made,
      // once — a second loss is reported, not looped on.
      if (!retried) return this.rotate(restaurantId, userId, true);
      throw new Error(
        "Could not make a new calendar link: it kept changing underneath. Try again.",
      );
    }

    const secret = crypto.randomBytes(32).toString("hex");
    const { data: updated, error } = await this.db
      .from("calendar_feed_links")
      .update({
        token_hash: hashSecret(secret),
        issued_at: this.clock().toISOString(),
        last_fetched_at: null,
      })
      .eq("id", existing.id)
      .is("revoked_at", null)
      .select("id");
    if (error) {
      throw new Error(`Could not make a new calendar link: ${error.message}`);
    }
    if (!updated || updated.length === 0) {
      throw new Error(
        "Could not make a new calendar link: your link was stopped while this was being made. Connect again.",
      );
    }

    await this.audit(
      restaurantId,
      userId,
      "calendar_link_rotated",
      existing.id,
      {
        for_user_id: userId,
      },
    );
    return { link: await this.getMine(restaurantId, userId), secret };
  }

  /** Stop the caller's own link. Nothing to stop is `revoked: false`, no audit row. */
  async revokeMine(
    restaurantId: string,
    userId: string,
  ): Promise<{ revoked: boolean }> {
    return this.revoke(restaurantId, userId, userId);
  }

  /**
   * The person's pick of what their own link shows. Every member may narrow
   * their own (the founder, round 6t: *"Everyone can narrow (Recommended)"*);
   * a pick only ever removes from what the role allows (`feedScopeFor`).
   */
  async setCategories(
    restaurantId: string,
    userId: string,
    categories: readonly string[] | null,
  ): Promise<MyCalendarLink> {
    await this.requireRole(restaurantId, userId);
    const picked = this.validatePick(categories);
    const existing = await this.liveLinkOf(restaurantId, userId);
    if (!existing) {
      throw new NotFoundException(
        "Connect your calendar first, then pick what it shows.",
      );
    }
    // The before-state, copied now: nothing below may be allowed to change
    // what the audit row says it changed from.
    const from = existing.categories ? [...existing.categories] : null;
    const { error } = await this.db
      .from("calendar_feed_links")
      .update({ categories: picked ?? null })
      .eq("id", existing.id)
      .is("revoked_at", null);
    if (error) {
      throw new Error(`Could not save what your link shows: ${error.message}`);
    }
    await this.audit(
      restaurantId,
      userId,
      "calendar_link_categories_changed",
      existing.id,
      {
        for_user_id: userId,
        from,
        to: picked ?? null,
      },
    );
    return this.getMine(restaurantId, userId);
  }

  // ==========================================================================
  // EVERYONE'S LINKS — owner/manager (gated at the controller)
  // ==========================================================================

  async listHouse(
    restaurantId: string,
    actorUserId: string,
  ): Promise<HouseLinkRow[]> {
    const actorRole = narrowRole(
      await this.houseRoleOf(restaurantId, actorUserId),
    );
    const { data, error } = await this.db
      .from("calendar_feed_links")
      .select("user_id, created_at, issued_at, last_fetched_at")
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true });
    if (error) {
      throw new Error(
        `Could not read who has connected a calendar: ${error.message}`,
      );
    }
    const rows = (data ?? []) as Array<{
      user_id: string;
      created_at: string;
      issued_at: string;
      last_fetched_at: string | null;
    }>;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.user_id);
    const { data: users, error: usersErr } = await this.db
      .from("users")
      .select("user_id, name, email, restaurant_id, role")
      .in("user_id", ids);
    if (usersErr) {
      throw new Error(
        `Could not read the names of who has connected: ${usersErr.message}`,
      );
    }
    const { data: access, error: accessErr } = await this.db
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .in("user_id", ids);
    if (accessErr) {
      throw new Error(
        `Could not read the roles of who has connected: ${accessErr.message}`,
      );
    }
    const userRows = new Map<
      string,
      {
        user_id: string;
        name?: string | null;
        email?: string | null;
        restaurant_id?: string | null;
        role?: string | null;
      }
    >();
    for (const u of (users ?? []) as Array<{
      user_id: string;
      name?: string | null;
      email?: string | null;
      restaurant_id?: string | null;
      role?: string | null;
    }>) {
      userRows.set(u.user_id, u);
    }
    const accessRows = new Map<string, { role?: string | null }>();
    for (const a of (access ?? []) as Array<{
      user_id: string;
      role?: string | null;
    }>) {
      accessRows.set(a.user_id, a);
    }
    return rows.map((r) => {
      const u = userRows.get(r.user_id) ?? null;
      const access = accessRows.get(r.user_id) ?? null;
      // An active access row proves membership even with a NULL role (the
      // column's CHECK lets NULL through): such a person reads as staff here,
      // never as "no longer in this house".
      const role = narrowRole(
        access ? (access.role ?? "staff") : roleInHouse(null, u, restaurantId),
      );
      return {
        userId: r.user_id,
        name: u?.name?.trim() || u?.email?.trim() || null,
        role,
        canStop: CalendarLinksService.mayStop(
          actorRole,
          role,
          r.user_id === actorUserId,
        ),
        createdAt: r.created_at,
        issuedAt: r.issued_at,
        lastFetchedAt: r.last_fetched_at,
      };
    });
  }

  /**
   * Owners manage owners (ADR 0162's owner rule; ADR 0111, round 6t, the
   * founder: *"No, owners only (Recommended)"*). An owner may stop anyone's
   * link. A manager may stop a manager's or staff's, never an owner's. Staff,
   * and anyone who is not a member, stop nobody else's. Your own is always
   * yours to stop.
   */
  static mayStop(
    actorRole: FeedRole | null,
    targetRole: FeedRole | null,
    ownLink: boolean,
  ): boolean {
    if (ownLink) return actorRole !== null;
    if (actorRole === "owner") return true;
    if (actorRole === "manager") return targetRole !== "owner";
    return false;
  }

  /**
   * An owner or manager stops someone's link (theirs included).
   *
   * The gate is here, in code, on BOTH roles read before any write — the
   * controller's `assertCanManageRestaurant` is the outer door, this is the
   * owner rule it cannot express: a manager stops a manager's or staff's link,
   * never an owner's, and only an owner stops an owner's (`mayStop`). Both
   * roles are read the way the ADR 0162 removal doors read them
   * (`house-role.ts` `roleInHouse`: the active access row, else a `users` row
   * naming the house at its role), so a person who is an owner there is an
   * owner here too. A refused stop writes nothing. The audit row of a stop
   * records both roles.
   */
  async revokeFor(
    restaurantId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<{ revoked: boolean }> {
    const actorRole = narrowRole(
      await this.houseRoleOf(restaurantId, actorUserId),
    );
    if (actorRole !== "owner" && actorRole !== "manager") {
      throw new ForbiddenException(
        "Only an owner or a manager can stop someone else's calendar link.",
      );
    }
    const own = targetUserId === actorUserId;
    const targetRole = own
      ? actorRole
      : narrowRole(await this.houseRoleOf(restaurantId, targetUserId));
    if (!CalendarLinksService.mayStop(actorRole, targetRole, own)) {
      throw new ForbiddenException(
        "Only an owner can stop an owner's calendar link.",
      );
    }
    return this.revoke(restaurantId, actorUserId, targetUserId, {
      actor_role: actorRole,
      target_role: targetRole,
    });
  }

  private async revoke(
    restaurantId: string,
    actorUserId: string,
    targetUserId: string,
    roles: Record<string, unknown> = {},
  ): Promise<{ revoked: boolean }> {
    const { data, error } = await this.db
      .from("calendar_feed_links")
      .update({
        revoked_at: this.clock().toISOString(),
        revoked_by: actorUserId,
        revoke_reason:
          actorUserId === targetUserId
            ? "revoked_by_self"
            : "revoked_by_manager",
      })
      .eq("restaurant_id", restaurantId)
      .eq("user_id", targetUserId)
      .is("revoked_at", null)
      .select("id");
    if (error) {
      throw new Error(`Could not stop the calendar link: ${error.message}`);
    }
    const hit = (data ?? []) as Array<{ id: string }>;
    if (hit.length === 0) return { revoked: false };

    await this.audit(
      restaurantId,
      actorUserId,
      "calendar_link_revoked",
      hit[0].id,
      {
        for_user_id: targetUserId,
        by: actorUserId === targetUserId ? "self" : "owner_or_manager",
        ...roles,
      },
    );
    return { revoked: true };
  }

  // ==========================================================================
  // THE FEED
  // ==========================================================================

  /**
   * What a calendar app gets for `secret`. Dead addresses get the expired
   * notice; a failed read throws `FeedUnavailableError`.
   */
  async renderFor(secret: string): Promise<string> {
    const now = this.clock();
    if (!SECRET_SHAPE.test(secret)) return expiredNoticeFeed(now);

    const { data: linkData, error: linkErr } = await this.db
      .from("calendar_feed_links")
      .select("id, restaurant_id, user_id, categories")
      .eq("token_hash", hashSecret(secret))
      .is("revoked_at", null)
      .maybeSingle();
    if (linkErr) {
      throw new FeedUnavailableError(
        `Could not read the calendar link: ${linkErr.message}`,
      );
    }
    const link = linkData as Pick<
      LinkRow,
      "id" | "restaurant_id" | "user_id" | "categories"
    > | null;
    if (!link) return expiredNoticeFeed(now);

    // Rule 3: the role NOW. No role → the membership is over → the link is
    // stopped for good (a door that ended it outside `stop-links-on-leaving`:
    // a lapsed `valid_until`, a hand-run delete) and answers the notice.
    const role = await this.roleOf(link.restaurant_id, link.user_id);
    if (!role) {
      await this.stopLeftover(link.restaurant_id, link.user_id, now);
      return expiredNoticeFeed(now);
    }

    const { data: house, error: houseErr } = await this.db
      .from("restaurants")
      .select("name, timezone")
      .eq("id", link.restaurant_id)
      .maybeSingle();
    if (houseErr) {
      throw new FeedUnavailableError(
        `Could not read the house: ${houseErr.message}`,
      );
    }
    if (!house) return expiredNoticeFeed(now);

    const scope = feedScopeFor(role, link.categories);
    const areas: PersonAreas =
      scope.events === "house_and_areas"
        ? await this.areas.areasOf(link.restaurant_id, link.user_id)
        : { modelled: false };

    const events = await this.readEvents(link.restaurant_id);
    // `calendar_events` has no area label yet, so every event is house-wide.
    const shownEvents = selectEvents(events, scope, areas, () => null);
    const rules = await this.readRules(shownEvents);
    const shifts = await this.readShifts(
      link.restaurant_id,
      link.user_id,
      scope,
      now,
    );

    const houseName =
      (house as { name?: string | null }).name?.trim() || "Mudavym";
    const body = renderFeed({
      calendarName: `${houseName} Calendar`,
      zone: resolveZone((house as { timezone?: string | null }).timezone),
      events: shownEvents,
      rules,
      shifts,
    });

    await this.markFetched(link.id, now);
    return body;
  }

  private async readEvents(restaurantId: string): Promise<FeedEventRow[]> {
    const { data, error } = await this.db
      .from("calendar_events")
      .select(
        "id, title, description, event_type, start_date, start_time, end_date, end_time, all_day, status, is_recurring, parent_event_id",
      )
      .eq("restaurant_id", restaurantId)
      .is("parent_event_id", null)
      .order("start_date", { ascending: true });
    if (error) {
      throw new FeedUnavailableError(
        `Could not read the calendar: ${error.message}`,
      );
    }
    return (data ?? []) as FeedEventRow[];
  }

  private async readRules(
    events: readonly FeedEventRow[],
  ): Promise<FeedRecurrenceRule[]> {
    const ids = events.filter((e) => e.is_recurring).map((e) => e.id);
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from("calendar_recurrence_rules")
      .select(
        "calendar_event_id, frequency, interval_value, end_on_date, end_after_count, days_of_week",
      )
      .in("calendar_event_id", ids);
    if (error) {
      throw new FeedUnavailableError(
        `Could not read how events repeat: ${error.message}`,
      );
    }
    return (data ?? []) as FeedRecurrenceRule[];
  }

  private async readShifts(
    restaurantId: string,
    userId: string,
    scope: ReturnType<typeof feedScopeFor>,
    now: Date,
  ): Promise<FeedShift[]> {
    if (scope.categories && !scope.categories.has("shifts")) return [];

    const { data: members, error: membersErr } = await this.db
      .from("team_members")
      .select("id, user_id, display_name")
      .eq("restaurant_id", restaurantId);
    if (membersErr) {
      throw new FeedUnavailableError(
        `Could not read the team: ${membersErr.message}`,
      );
    }
    const roster = (members ?? []) as Array<{
      id: string;
      user_id: string | null;
      display_name: string | null;
    }>;
    const mine = new Set(
      roster.filter((m) => m.user_id === userId).map((m) => m.id),
    );
    if (scope.shifts === "own" && mine.size === 0) return [];

    const since = new Date(now.getTime() - SHIFT_LOOKBACK_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { data: rows, error: shiftsErr } = await this.db
      .from("shifts")
      .select(
        "id, schedule_id, member_id, shift_date, start_time, end_time, role, state",
      )
      .eq("restaurant_id", restaurantId)
      .gte("shift_date", since)
      .order("shift_date", { ascending: true });
    if (shiftsErr) {
      throw new FeedUnavailableError(
        `Could not read the shifts: ${shiftsErr.message}`,
      );
    }
    const shown = selectShifts(
      (rows ?? []) as Array<{
        id: string;
        schedule_id: string | null;
        member_id: string | null;
        shift_date: string;
        start_time: string;
        end_time: string;
        role: string | null;
        state: string | null;
      }>,
      scope,
      mine,
    );
    if (shown.length === 0) return [];

    const scheduleIds = Array.from(
      new Set(
        shown.map((s) => s.schedule_id).filter((id): id is string => !!id),
      ),
    );
    const published = new Set<string>();
    if (scheduleIds.length > 0) {
      const { data: schedules, error: schedErr } = await this.db
        .from("schedules")
        .select("id, status")
        .in("id", scheduleIds);
      if (schedErr) {
        throw new FeedUnavailableError(
          `Could not read the schedules: ${schedErr.message}`,
        );
      }
      for (const s of (schedules ?? []) as Array<{
        id: string;
        status: string | null;
      }>) {
        if (s.status === "published") published.add(s.id);
      }
    }

    const nameOf = new Map(
      roster.map((m) => [m.id, m.display_name?.trim() || null]),
    );
    return shown.map((s) => {
      const what = s.role?.trim() ? `shift · ${s.role.trim()}` : "shift";
      const own = !!s.member_id && mine.has(s.member_id);
      const summary = own
        ? `Your ${what}`
        : !s.member_id || s.state === "open"
          ? `Open ${what}`
          : `${nameOf.get(s.member_id) ?? "Someone"} — ${what}`;
      return {
        id: s.id,
        shift_date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        summary,
        draft: !s.schedule_id || !published.has(s.schedule_id),
        calledOut: s.state === "callout",
      };
    });
  }

  /**
   * A live link whose person is no longer a member: stop it, as the system,
   * the same way the leaving doors do (audited, `left_house`), so that if the
   * person is let back in the old address does not serve again. Best effort:
   * the notice is the right answer either way, and a failed stop is logged,
   * not turned into a 503 for a dead address.
   */
  private async stopLeftover(
    restaurantId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    try {
      await stopCalendarLinksOnLeaving(
        this.db,
        this.logger,
        {
          restaurantId,
          userId,
          actorUserId: null,
          via: "feed_found_no_membership",
        },
        now,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `a link of someone no longer in the house was not stopped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Record that a calendar app read this link. Best effort: the answer has
   * already been built, and failing the subscriber because the note failed
   * would trade a real calendar for a bookkeeping line.
   */
  private async markFetched(linkId: string, now: Date): Promise<void> {
    try {
      const { error } = await this.db
        .from("calendar_feed_links")
        .update({ last_fetched_at: now.toISOString() })
        .eq("id", linkId);
      if (error)
        this.logger.warn(`last_fetched_at not recorded: ${error.message}`);
    } catch (err: unknown) {
      this.logger.warn(
        `last_fetched_at not recorded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  /**
   * The person's role word here, read the way the ADR 0162 doors read it
   * (`house-role.ts` `roleInHouse`). Used ONLY for the owner rule on stopping
   * someone else's link, never for what a feed serves (`roleOf`, which reads a
   * `users`-row member as staff). A failed read throws: it is never "not an
   * owner".
   */
  private async houseRoleOf(
    restaurantId: string,
    userId: string,
  ): Promise<string | null> {
    const { data: access, error: accessErr } = await this.db
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();
    if (accessErr) {
      throw new Error(
        `Could not read a role in this house, so nothing was changed: ${accessErr.message}`,
      );
    }
    const { data: user, error: userErr } = await this.db
      .from("users")
      .select("restaurant_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (userErr) {
      throw new Error(
        `Could not read a role in this house, so nothing was changed: ${userErr.message}`,
      );
    }
    return roleInHouse(
      (access as { role?: string | null } | null) ?? null,
      (user as {
        restaurant_id?: string | null;
        role?: string | null;
      } | null) ?? null,
      restaurantId,
    );
  }

  private async requireRole(
    restaurantId: string,
    userId: string,
  ): Promise<FeedRole> {
    const role = await this.roleOf(restaurantId, userId);
    if (!role) {
      throw new ForbiddenException("You are not a member of this house.");
    }
    return role;
  }

  /**
   * Any member may pick for their own link, and every entry must be a known
   * category. `undefined`/`null` means "no pick": everything the role allows.
   * A pick can only narrow — `feedScopeFor` intersects it with the role.
   */
  private validatePick(
    categories: readonly string[] | null | undefined,
  ): FeedCategory[] | null {
    if (categories === undefined || categories === null) return null;
    const unknown = categories.filter((c) => !isFeedCategory(c));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown calendar categories: ${unknown.join(", ")}. Known: ${FEED_CATEGORIES.join(", ")}.`,
      );
    }
    return Array.from(new Set(categories)) as FeedCategory[];
  }

  private describe(
    role: FeedRole,
    link: LinkRow | null,
    areas: PersonAreas,
    houseLinkRetired: boolean,
  ): MyCalendarLink {
    const scope = feedScopeFor(role, link?.categories ?? null);
    return {
      connected: !!link,
      createdAt: link?.created_at ?? null,
      issuedAt: link?.issued_at ?? null,
      lastFetchedAt: link?.last_fetched_at ?? null,
      role,
      scope: scopeSentence(scope, areas),
      categories: scope.categories ? Array.from(scope.categories) : null,
      // Every member may narrow their own link (round 6t).
      canPickCategories: true,
      areasModelled: areas.modelled,
      houseLinkRetired,
    };
  }

  /** Whether migration 20260925180300 switched off this house's shared link. */
  private async houseLinkWasRetired(restaurantId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from("system_audit_log")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("action", "calendar_ical_house_link_retired")
      .limit(1);
    if (error) {
      throw new Error(
        `Could not read whether the shared calendar link was retired: ${error.message}`,
      );
    }
    return (data ?? []).length > 0;
  }

  /**
   * File one `system_audit_log` row. Same shape as `recordAccessChange`
   * (`team/access-audit.ts`). Never throws: the change has already happened,
   * and failing the request would tell the caller it did not.
   */
  private async audit(
    restaurantId: string,
    actorUserId: string,
    action: AuditAction,
    linkId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { error } = await this.db.from("system_audit_log").insert({
        actor_type: "user",
        actor_id: actorUserId,
        action,
        entity_type: "calendar_link",
        entity_id: linkId,
        // Never the secret or its hash.
        changes,
        restaurant_id: restaurantId,
      });
      if (error) {
        this.logger.error(
          `${action} happened but the audit row failed to write: ${error.message}`,
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `${action} happened but the audit row threw: ${message}`,
      );
    }
  }
}
