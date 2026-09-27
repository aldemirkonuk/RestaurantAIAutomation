import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AccessChangeReceipt, recordAccessChange } from "../team/access-audit";
import { grantRefusal } from "../auth/role-grant";
import { stopCalendarLinksOnLeaving } from "../calendar/stop-links-on-leaving";
import { cancelPendingInvitesFrom } from "../auth/cancel-house-invites";
import { markMembershipLeft } from "../auth/membership-ended";
import {
  ORG_ROW_INSERT_ONLY,
  orgRoleForHouseGrant,
} from "../organizations/org-role";
import { WebsocketGateway } from "../websocket/websocket.gateway";

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway?: WebsocketGateway,
  ) {}

  /**
   * PUBLIC because it is the ONE membership check in this module (ADR 0093 A3
   * reuses it for the operating-hours endpoints rather than writing a second
   * one). Two membership checks in the same module is how a role gate ends up
   * enforced on one route and not the next.
   */
  async assertMembership(
    actorUserId: string,
    restaurantId: string,
    requiredRole?: "owner" | "manager" | "owner|manager",
  ): Promise<{ role: string }> {
    let accessRole: string | null = null;

    const { data: access } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", actorUserId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (access) {
      accessRole = access.role;
    } else {
      const { data: user } = await this.databaseService.supabase
        .from("users")
        .select("restaurant_id, role")
        .eq("user_id", actorUserId)
        .maybeSingle();

      if (user && user.restaurant_id === restaurantId) {
        accessRole = user.role || "staff";
      }
    }

    if (!accessRole)
      throw new ForbiddenException("Access denied to this restaurant");

    if (requiredRole === "owner" && accessRole !== "owner") {
      throw new ForbiddenException("Only owners can perform this action");
    }
    if (requiredRole === "owner|manager" && accessRole === "staff") {
      throw new ForbiddenException(
        "Only owners and managers can perform this action",
      );
    }

    return { role: accessRole };
  }

  async getMembers(actorUserId: string, restaurantId: string): Promise<any[]> {
    await this.assertMembership(actorUserId, restaurantId);

    const { data: rows, error } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select(
        "id, role, created_at, valid_until, is_active, user_id, invited_via",
      )
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      // `user_restaurant_access` has NO `granted_at`. That column lives on
      // `user_roles` (baseline migration 20260805000000, line 5834); this
      // table's creation timestamp is `created_at` (same file, line 5815).
      // Ordering by the absent name made PostgREST answer 42703 for every
      // tenant, and the catch below turned that into an empty roster.
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error(
        `getMembers failed for restaurant ${restaurantId}: ${error.message}`,
      );
      // A failed read is NEVER an empty roster. Returning `[]` here reported
      // the absence of an answer as "this restaurant has no members" — the
      // standing fault scripts/check_read_errors_not_swallowed.py exists for.
      throw new InternalServerErrorException(
        "Could not read the member roster",
      );
    }

    const userIds = [...new Set((rows ?? []).map((r: any) => r.user_id))];
    if (userIds.length === 0) return [];

    // `public.users` has NO `avatar_url` and NO `auth_provider` (baseline
    // migration 20260805000000, lines 5848-5861 -- the provider column is
    // `oauth_provider`, and avatars live on `team_members`). Naming them made
    // PostgREST answer 42703 and, with `error` unbound, every member came back
    // with `users: null` -- a roster of anonymous rows that looked like data.
    const { data: users, error: usersError } = await this.databaseService.supabase
      .from("users")
      .select("user_id, name, email, oauth_provider")
      .in("user_id", userIds);

    if (usersError) {
      this.logger.error(
        `getMembers could not read member identities for ${restaurantId}: ${usersError.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read the member roster",
      );
    }

    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));

    return (rows ?? []).map((r: any) => ({
      ...r,
      users: userMap.get(r.user_id) ?? null,
    }));
  }

  async getInvites(actorUserId: string, restaurantId: string): Promise<any[]> {
    await this.assertMembership(actorUserId, restaurantId, "owner|manager");

    const { data: invites, error } = await this.databaseService.supabase
      .from("organization_invites")
      .select("id, code, role, expires_at, created_at, invited_by")
      .eq("restaurant_id", restaurantId)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(
        `getInvites failed for restaurant ${restaurantId}: ${error.message}`,
      );
      // Same rule: an unreadable invite list is not an empty invite list.
      throw new InternalServerErrorException(
        "Could not read the pending invites",
      );
    }

    return invites ?? [];
  }

  /**
   * Change a member's role.
   *
   * This is the other half of ADR 0088 T2. A role change decides whether a
   * person sees wages and the whole roster, it is owner-gated, it protects only
   * the last-owner case — and it used to perform two bare UPDATEs with no audit
   * row, no notification and no before/after capture, so it changed silently
   * and unrecoverably. It now files itself through the same
   * `recordAccessChange` the removal uses, and returns a receipt saying whether
   * the record was actually written.
   *
   * It changes the role in THIS house only (ADR 0162, the founder's answer of
   * 2026-09-18, "Only that house"). The target must be a member here, and the
   * global `users.role` is written only when their `users` row names this
   * house. Until then only the ACTOR was checked, so an owner of any house
   * could set anyone's global `users.role` (v3.0-TECH-DEBT 44.1p).
   */
  async updateMemberRole(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
    newRole: "owner" | "manager" | "staff",
  ): Promise<AccessChangeReceipt> {
    await this.assertMembership(actorUserId, restaurantId, "owner");

    // The target must be a member of THIS house, read the way
    // `assertMembership` reads one: an active access row here decides; with
    // none, a `users` row whose `restaurant_id` names this house, at
    // `users.role || "staff"`. Anyone else is not a member here: 404, before
    // any write. The role read is also the before-state the audit row records.
    // Both reads bind their errors, because `maybeSingle()` answers
    // `data: null` for BOTH "no row" and "the query failed". Discarding the
    // error made a failed read produce `previousRole = null`, and the audit
    // row this method exists to write would then record the change as coming
    // FROM no role at all — a false record, which is worse than no record and
    // is precisely what ADR 0088 forbids.
    const { data: targetAccess, error: targetAccessErr } =
      await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("role")
        .eq("user_id", targetUserId)
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .maybeSingle();
    if (targetAccessErr) {
      this.cannotReadCurrentRole(targetUserId, restaurantId, targetAccessErr);
    }

    let previousRole: string | null;
    if (targetAccess) {
      previousRole = targetAccess.role ?? null;
    } else {
      const { data: targetUser, error: targetUserErr } =
        await this.databaseService.supabase
          .from("users")
          .select("restaurant_id, role")
          .eq("user_id", targetUserId)
          .maybeSingle();
      if (targetUserErr) {
        this.cannotReadCurrentRole(targetUserId, restaurantId, targetUserErr);
      }
      if (!targetUser || targetUser.restaurant_id !== restaurantId) {
        throw new NotFoundException("Member not found in this restaurant");
      }
      previousRole = targetUser.role || "staff";
    }

    if (actorUserId === targetUserId && newRole !== "owner") {
      const { count } = await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("role", "owner")
        .eq("is_active", true);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          "You're the only owner. Transfer ownership or delete the restaurant first.",
        );
      }
    }

    // Only the ACTIVE row, the one the target read above admitted them by. A
    // member admitted by their `users` row may still hold an inactive row here;
    // rewriting it would hand a role nobody granted to whoever reactivates it.
    const { error: uraErr } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .update({ role: newRole })
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (uraErr) {
      this.logger.error(
        `updateMemberRole URA update failed: ${uraErr.message}`,
      );
      throw new InternalServerErrorException("Failed to update member role");
    }

    // `users.role` is ONE value for every house the person belongs to, and
    // `RolesGuard` gates every `@Roles` route on it. [Since PR #393's sixth
    // round, only for a token that names no house: a token that names one gets
    // the role in that house (`auth/house-role.ts`).] A change in this house
    // writes it only when their `users` row names this house; a member here
    // whose `users` row names another house keeps the role that house gave
    // them. For a member known only by that row, it IS their role here, so a
    // failed write is a failed change. For a member with an access row the
    // change above has happened and is recorded below; the failure is logged.
    const { error: usersErr } = await this.databaseService.supabase
      .from("users")
      .update({ role: newRole })
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId);
    if (usersErr) {
      this.logger.error(
        `updateMemberRole users update failed for ${targetUserId} in ` +
          `${restaurantId}: ${usersErr.message}`,
      );
      if (!targetAccess) {
        throw new InternalServerErrorException("Failed to update member role");
      }
    }

    return recordAccessChange(this.databaseService.supabase, this.logger, {
      restaurantId,
      actorUserId,
      targetUserId,
      action: "member_role_changed",
      entityType: "restaurant_member",
      entityId: targetUserId,
      changes: { role: { from: previousRole, to: newRole } },
      notice: {
        title: "Your role in this restaurant changed",
        message: `An owner changed your role to ${newRole}. What you can see and do here has changed with it.`,
      },
    });
  }

  /** A target whose role here cannot be read is not changed. */
  private cannotReadCurrentRole(
    targetUserId: string,
    restaurantId: string,
    err: { message: string },
  ): never {
    this.logger.error(
      `changeRole: could not read the current role of ${targetUserId} in ` +
        `${restaurantId}: ${err.message}`,
    );
    throw new InternalServerErrorException(
      "Could not read the member's current role, so the change was not made " +
        "— recording it would have meant inventing what it changed from.",
    );
  }

  async removeMember(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
  ): Promise<void> {
    const selfLeave = actorUserId === targetUserId;

    const actor = selfLeave
      ? await this.assertMembership(actorUserId, restaurantId)
      : await this.assertMembership(actorUserId, restaurantId, "owner|manager");

    // Both target reads bind their errors. `maybeSingle()` answers `data: null`
    // for "no row" AND for "the query failed", so a failed access read used to
    // look like "no access row": the removal then fell through to the `users`
    // row, read the target's role there, and a manager whose target was an
    // owner by access row (and anything else by `users.role`) could remove them
    // (PR #393's planner, risk 4). A target whose role here cannot be read is
    // not removed.
    const { data: targetAccess, error: targetAccessErr } =
      await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("role")
        .eq("user_id", targetUserId)
        .eq("restaurant_id", restaurantId)
        .eq("is_active", true)
        .maybeSingle();
    if (targetAccessErr) {
      this.cannotReadRemovalTarget(targetUserId, restaurantId, targetAccessErr);
    }

    // The target's role here, read the way `assertMembership` reads a member:
    // their access row, or with none, a `users` row naming this house.
    let targetRole: string | null = targetAccess?.role ?? null;
    if (!targetAccess) {
      const { data: targetUser, error: targetUserErr } =
        await this.databaseService.supabase
          .from("users")
          .select("restaurant_id, role")
          .eq("user_id", targetUserId)
          .maybeSingle();
      if (targetUserErr) {
        this.cannotReadRemovalTarget(targetUserId, restaurantId, targetUserErr);
      }

      if (!targetUser || targetUser.restaurant_id !== restaurantId) {
        throw new NotFoundException("Member not found in this restaurant");
      }
      targetRole = targetUser.role;
    }

    // Owners manage owners (ADR 0162, the founder's addendum 2026-09-18): a
    // manager removes a manager or staff, never an owner. Before any write, on
    // both paths. An owner leaving is the actor removing themself as owner, so
    // it passes here and meets the last-owner guard below.
    if (targetRole === "owner" && actor.role !== "owner") {
      throw new ForbiddenException(
        "Only an owner of this house can remove an owner.",
      );
    }

    if (!targetAccess) {
      if (targetRole === "owner") {
        const { count } = await this.databaseService.supabase
          .from("users")
          .select("*", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("role", "owner");

        if ((count ?? 0) <= 1) {
          throw new BadRequestException(
            "You're the only owner. Transfer ownership or delete the restaurant first.",
          );
        }
      }

      await this.stopCalendarLinkOfLeaver(actorUserId, restaurantId, targetUserId);
      await this.clearUsersRowHouse(targetUserId, restaurantId);
      this.websocketGateway?.evictFromHouse(targetUserId, restaurantId);
      await cancelPendingInvitesFrom(
        this.databaseService.supabase,
        targetUserId,
        restaurantId,
        this.logger,
      );
      return;
    }

    if (targetAccess.role === "owner") {
      const { count } = await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", restaurantId)
        .eq("role", "owner")
        .eq("is_active", true);

      if ((count ?? 0) <= 1) {
        throw new BadRequestException(
          "You're the only owner. Transfer ownership or delete the restaurant first.",
        );
      }
    }

    // The `users` row first, then the access row: if the delete fails the
    // person is still a member by their access row, which is the truth; the
    // other order could leave them a member by a `users` row nobody meant to
    // keep (v3.0-TECH-DEBT 44.1j).
    await this.stopCalendarLinkOfLeaver(actorUserId, restaurantId, targetUserId);
    await this.clearUsersRowHouse(targetUserId, restaurantId);

    const { error } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .delete()
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`removeMember delete failed: ${error.message}`);
      throw new InternalServerErrorException("Failed to remove member");
    }

    // Removing oneself is leaving (ADR 0164, round 5, item 26): only people
    // removed by someone else are sent to /no-access.
    if (selfLeave)
      await markMembershipLeft(
        this.databaseService.supabase,
        targetUserId,
        restaurantId,
        this.logger,
      );

    this.websocketGateway?.evictFromHouse(targetUserId, restaurantId);
    await cancelPendingInvitesFrom(
      this.databaseService.supabase,
      targetUserId,
      restaurantId,
      this.logger,
    );
  }

  /**
   * The leaver's calendar link in this house stops for good, audited, before
   * the first membership write (ADR 0111, 2026-09-21, round 6t: *"Yes, revoke
   * on leaving (Recommended)"*). A stop that fails throws here, so nothing
   * about the membership has changed; see `calendar/stop-links-on-leaving.ts`.
   */
  private async stopCalendarLinkOfLeaver(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
  ): Promise<void> {
    await stopCalendarLinksOnLeaving(
      this.databaseService.supabase,
      this.logger,
      {
        restaurantId,
        userId: targetUserId,
        actorUserId,
        via: "MembersService.removeMember",
      },
    );
  }

  /**
   * The person's `users` row stops naming THIS house, and only this house.
   *
   * Removal cleared `users.restaurant_id` whatever house it named, so taking
   * someone out of house B also took away house A, the one their `users` row
   * named: their home house in the token, and for a member known only by that
   * row, their membership there. A role or a removal in one house must not
   * change what a person may do in another (ADR 0162, answer A). The write's
   * error is read: a removal that left the row naming this house would leave
   * the person a member by it.
   */
  private async clearUsersRowHouse(
    targetUserId: string,
    restaurantId: string,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("users")
      .update({ restaurant_id: null })
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.error(
        `removeMember could not clear users.restaurant_id for ${targetUserId} ` +
          `in ${restaurantId}: ${error.message}`,
      );
      throw new InternalServerErrorException("Failed to remove member");
    }
  }

  /** A target whose role here cannot be read is not removed. */
  private cannotReadRemovalTarget(
    targetUserId: string,
    restaurantId: string,
    err: { message: string },
  ): never {
    this.logger.error(
      `removeMember: could not read the role of ${targetUserId} in ` +
        `${restaurantId}: ${err.message}`,
    );
    throw new InternalServerErrorException(
      "Could not read this member's role here, so nobody was removed.",
    );
  }

  async addMember(
    actorUserId: string,
    restaurantId: string,
    email: string,
    role: "owner" | "manager" | "staff",
  ): Promise<void> {
    const actorAccess = await this.assertMembership(
      actorUserId,
      restaurantId,
      "owner|manager",
    );

    // Who may add whom is ADR 0162, the same rule an invitation follows: an
    // owner adds any role, a manager a manager or staff, never an owner. This
    // used to refuse a manager who added a manager while the invitation let a
    // manager mint an owner's invite; one rule now serves both doors.
    const refusal = grantRefusal(actorAccess.role, role, "add");
    if (refusal) {
      throw new ForbiddenException(refusal);
    }

    const { data: targetUser } = await this.databaseService.supabase
      .from("users")
      .select("user_id")
      .ilike("email", email.trim())
      .maybeSingle();

    if (!targetUser) {
      throw new NotFoundException(
        "User not found. Send them an invite link to create an account first.",
      );
    }

    const { data: existingAccess } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("id")
      .eq("user_id", targetUser.user_id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();

    if (existingAccess) {
      throw new ConflictException(
        "User is already a member of this restaurant",
      );
    }

    const { data: restaurant } = await this.databaseService.supabase
      .from("restaurants")
      .select("organization_id")
      .eq("id", restaurantId)
      .maybeSingle();

    const { error: uraErr } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .insert({
        user_id: targetUser.user_id,
        restaurant_id: restaurantId,
        role,
        invited_via: null,
        is_active: true,
      });

    if (uraErr) {
      this.logger.error(`addMember URA insert failed: ${uraErr.message}`);
      throw new InternalServerErrorException("Failed to add member");
    }

    if (restaurant?.organization_id) {
      // Insert-only, and never `owner` (organizations/org-role.ts, ADR 0164):
      // adding someone to a house must not make them an owner of the
      // organisation, nor stop an existing owner being one.
      const { error: orgRowError } = await this.databaseService.supabase
        .from("organization_members")
        .upsert(
          {
            organization_id: restaurant.organization_id,
            user_id: targetUser.user_id,
            role: orgRoleForHouseGrant(role),
          },
          ORG_ROW_INSERT_ONLY,
        );
      if (orgRowError) {
        this.logger.error(
          `addMember could not add ${targetUser.user_id} to organisation ` +
            `${restaurant.organization_id}: ${orgRowError.message}`,
        );
      }
    }
  }

  async revokeInvite(
    actorUserId: string,
    restaurantId: string,
    code: string,
  ): Promise<void> {
    await this.assertMembership(actorUserId, restaurantId, "owner|manager");

    const { error } = await this.databaseService.supabase
      .from("organization_invites")
      .delete()
      .eq("code", code.toUpperCase())
      .eq("restaurant_id", restaurantId)
      .is("used_at", null);

    if (error) {
      this.logger.error(`revokeInvite failed: ${error.message}`);
      throw new InternalServerErrorException("Failed to revoke invite");
    }
  }
}
