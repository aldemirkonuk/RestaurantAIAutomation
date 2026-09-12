import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { AccessChangeReceipt, recordAccessChange } from "../team/access-audit";

@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(private readonly databaseService: DatabaseService) {}

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
   */
  async updateMemberRole(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
    newRole: "owner" | "manager" | "staff",
  ): Promise<AccessChangeReceipt> {
    await this.assertMembership(actorUserId, restaurantId, "owner");

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

    // Capture the before-state while it still exists. After the UPDATE below
    // nothing can reconstruct what the role used to be.
    // Bound, because `maybeSingle()` answers `data: null` for BOTH "no row" and
    // "the query failed". Discarding the error made a failed read produce
    // `previousRole = null`, and the audit row this method exists to write would
    // then record the change as coming FROM no role at all — a false record,
    // which is worse than no record and is precisely what ADR 0088 forbids.
    const { data: before, error: beforeErr } =
      await this.databaseService.supabase
        .from("user_restaurant_access")
        .select("role")
        .eq("user_id", targetUserId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
    if (beforeErr) {
      this.logger.error(
        `changeRole: could not read the current role of ${targetUserId} in ` +
          `${restaurantId}: ${beforeErr.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read the member's current role, so the change was not made " +
          "— recording it would have meant inventing what it changed from.",
      );
    }
    const previousRole: string | null = before?.role ?? null;

    const { error: uraErr } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .update({ role: newRole })
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId);

    if (uraErr) {
      this.logger.error(
        `updateMemberRole URA update failed: ${uraErr.message}`,
      );
      throw new InternalServerErrorException("Failed to update member role");
    }

    await this.databaseService.supabase
      .from("users")
      .update({ role: newRole })
      .eq("user_id", targetUserId);

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

  async removeMember(
    actorUserId: string,
    restaurantId: string,
    targetUserId: string,
  ): Promise<void> {
    const selfLeave = actorUserId === targetUserId;

    if (selfLeave) {
      await this.assertMembership(actorUserId, restaurantId);
    } else {
      await this.assertMembership(actorUserId, restaurantId, "owner|manager");
    }

    const { data: targetAccess } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (!targetAccess) {
      // Fallback: check if target user has restaurant_id set in users table
      const { data: targetUser } = await this.databaseService.supabase
        .from("users")
        .select("restaurant_id, role")
        .eq("user_id", targetUserId)
        .maybeSingle();

      if (!targetUser || targetUser.restaurant_id !== restaurantId) {
        throw new NotFoundException("Member not found in this restaurant");
      }

      if (targetUser.role === "owner") {
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

      await this.databaseService.supabase
        .from("users")
        .update({ restaurant_id: null })
        .eq("user_id", targetUserId);

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

    const { error } = await this.databaseService.supabase
      .from("user_restaurant_access")
      .delete()
      .eq("user_id", targetUserId)
      .eq("restaurant_id", restaurantId);

    if (error) {
      this.logger.error(`removeMember delete failed: ${error.message}`);
      throw new InternalServerErrorException("Failed to remove member");
    }

    // Also clear the legacy restaurant_id in users table just in case
    await this.databaseService.supabase
      .from("users")
      .update({ restaurant_id: null })
      .eq("user_id", targetUserId);
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

    if (actorAccess.role === "manager" && role !== "staff") {
      throw new ForbiddenException("Managers can only add staff members");
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
      await this.databaseService.supabase.from("organization_members").upsert(
        {
          organization_id: restaurant.organization_id,
          user_id: targetUser.user_id,
          role,
        },
        { onConflict: "organization_id,user_id" },
      );
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
