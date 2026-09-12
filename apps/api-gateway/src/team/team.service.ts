import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { recordAccessChange } from "./access-audit";
import {
  ChannelPreferences,
  loadChannelOptOuts,
} from "./broadcast-preferences";
import {
  CreateCertDto,
  CreateCoverageTemplateDto,
  CreateTeamMemberDto,
  CreateTimeOffDto,
  ReviewRequestDto,
  UpdateCertDto,
  UpdateTeamMemberDto,
  UpdateTeamSettingsDto,
} from "./dto/team.dto";

type Role = "owner" | "manager" | "staff";

/**
 * Team ops service: the operational staff profile that sits on top of the
 * existing membership roster (user_restaurant_access). Owns members,
 * certifications, availability, time-off/swap requests, coverage rules and
 * the per-restaurant team settings (labor toggle).
 */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(private readonly db: DatabaseService) {}

  private get sb() {
    return this.db.supabase;
  }

  /**
   * `user_restaurant_access` is the register of record for privilege here.
   *
   * The legacy `users.restaurant_id` row is still honoured — one production
   * user reaches /team through it and nothing else (measured 2026-09-02) — but
   * it proves MEMBERSHIP ONLY, never privilege. `users.role` is
   * `varchar(20) DEFAULT 'manager' NOT NULL` (baseline `:5854`), so the column
   * cannot distinguish "an owner set this to manager" from "nobody ever
   * touched it": a user row with a restaurant id and an untouched role used to
   * be a manager of /team. That production user's role is exactly `manager`,
   * i.e. the default, which is why it is read as `staff` from here.
   *
   * No real owner is demoted by this: all 11 access rows in production live in
   * `user_restaurant_access` (8 owner, 3 manager), which still decides.
   * See ADR 0088.
   */
  async assertAccess(
    userId: string,
    restaurantId: string,
    required?: "owner" | "manager",
  ): Promise<{ role: Role }> {
    let accessRole: string | null = null;

    const { data: access } = await this.sb
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (access) {
      accessRole = access.role;
    } else {
      const { data: user } = await this.sb
        .from("users")
        .select("restaurant_id, role")
        .eq("user_id", userId)
        .maybeSingle();

      if (user && user.restaurant_id === restaurantId) {
        // Deliberately NOT `user.role`. See the comment above.
        accessRole = "staff";
      }
    }

    if (!accessRole)
      throw new ForbiddenException("Access denied to this restaurant");

    const role = accessRole as Role;
    if (required === "owner" && role !== "owner")
      throw new ForbiddenException("Only owners can perform this action");
    if (required === "manager" && role === "staff")
      throw new ForbiddenException(
        "Only owners and managers can perform this action",
      );

    return { role };
  }

  /**
   * Per-channel opt-outs for these users, read from `notification_preferences`
   * — the register the scheduled mailer already honours. `null` means the read
   * failed; the caller must not read that as "nobody opted out". See
   * `broadcast-preferences.ts` for why the rule is restated rather than
   * imported from the resolver.
   */
  async channelOptOuts(userIds: string[]): Promise<ChannelPreferences | null> {
    return loadChannelOptOuts(this.sb, userIds);
  }

  // ── Members ────────────────────────────────────────────────────────────
  /**
   * Roster = operational team_members merged with the membership rows in
   * user_restaurant_access. Auto-links account-less members to a real user by
   * email (the "manager adds staff, they claim the account later" flow).
   */
  /** Verify a member row belongs to this tenant (prevents cross-restaurant refs). */
  async assertMemberInRestaurant(
    restaurantId: string,
    memberId: string,
  ): Promise<void> {
    const { data } = await this.sb
      .from("team_members")
      .select("id")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!data)
      throw new NotFoundException("Member not found in this restaurant");
  }

  async listMembers(userId: string, restaurantId: string): Promise<any[]> {
    // Manager-gated: the roster exposes wages + linked accounts.
    await this.assertAccess(userId, restaurantId, "manager");

    // Ensure every active URA membership has a team_members ops profile.
    await this.ensureRosterFromAccess(restaurantId);

    const { data: members, error } = await this.sb
      .from("team_members")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error(`listMembers failed: ${error.message}`);
      throw new InternalServerErrorException("Failed to load team members");
    }

    await this.autoLinkByEmail(restaurantId, members ?? []);

    const settings = await this.getSettings(userId, restaurantId);
    const showWage = settings?.wage_visible !== false;

    // Enrich with membership role + linked user profile.
    const userIds = [
      ...new Set((members ?? []).map((m: any) => m.user_id).filter(Boolean)),
    ];
    const [{ data: access }, { data: users }] = await Promise.all([
      this.sb
        .from("user_restaurant_access")
        .select("user_id, role, is_active")
        .eq("restaurant_id", restaurantId),
      userIds.length
        ? this.sb
            .from("users")
            .select("user_id, name, email, avatar_url")
            .in("user_id", userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const roleMap = new Map(
      (access ?? []).map((a: any) => [a.user_id, a.role]),
    );
    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));

    return (members ?? []).map((m: any) => {
      const row = {
        ...m,
        role: m.user_id ? (roleMap.get(m.user_id) ?? null) : null,
        linkedUser: m.user_id ? (userMap.get(m.user_id) ?? null) : null,
        accountLinked: !!m.user_id,
      };
      if (!showWage) row.hourly_wage = null;
      return row;
    });
  }

  /**
   * Backfill team_members from user_restaurant_access so Settings-era members
   * appear on the Manager Shift Desk without a manual re-add.
   */
  private async ensureRosterFromAccess(restaurantId: string): Promise<void> {
    const { data: access } = await this.sb
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (!access?.length) return;

    const { data: existing } = await this.sb
      .from("team_members")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .not("user_id", "is", null);
    const linked = new Set((existing ?? []).map((m: any) => m.user_id));
    const missing = access.filter(
      (a: any) => a.user_id && !linked.has(a.user_id),
    );
    if (!missing.length) return;

    const { data: users } = await this.sb
      .from("users")
      .select("user_id, name, email, avatar_url")
      .in(
        "user_id",
        missing.map((m: any) => m.user_id),
      );
    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));
    const rows = missing.map((a: any) => {
      const u = userMap.get(a.user_id);
      return {
        restaurant_id: restaurantId,
        user_id: a.user_id,
        display_name: u?.name || u?.email || "Team member",
        email: u?.email ?? null,
        avatar_url: u?.avatar_url ?? null,
        position:
          a.role === "owner"
            ? "Owner"
            : a.role === "manager"
              ? "Manager"
              : "Staff",
        employment_type: "full_time",
        status: "active",
        /**
         * A wage nobody entered is UNKNOWN (ADR 0051, ADR 0088).
         *
         * This line used to read
         * `a.role === "staff" ? 22 : a.role === "manager" ? 28 : 32`, described
         * in its own comment as a "mock wage". It was not a fallback for
         * missing data: measured on production 2026-09-02, all 11
         * `team_members` rows carried exactly those literals — 8 at $32.00
         * (owner), 3 at $28.00 (manager) — so 100% of the wage data in the
         * database was invented by this backfill, and it was the sole input to
         * `laborCost()`, `shifts.labor_cost`, the week total, the Tonight-labor
         * pulse, the per-shift labour lens and the CSV export's "Labor cost"
         * column.
         *
         * The backfill itself stays — creating an ops profile from an access
         * row is real work. Only the invented number goes.
         */
        hourly_wage: null,
      };
    });
    const { error } = await this.sb.from("team_members").insert(rows);
    if (error) this.logger.warn(`ensureRosterFromAccess: ${error.message}`);
  }

  /**
   * Best-effort: link an account-less member to a real user by email — but
   * ONLY to a user who already has active access to THIS restaurant. This
   * prevents linking a stranger who happens to share an email and prevents
   * any cross-tenant leakage. Case-insensitive; the update is tenant-scoped.
   */
  private async autoLinkByEmail(
    restaurantId: string,
    members: any[],
  ): Promise<void> {
    const orphans = members.filter((m) => !m.user_id && m.email);
    if (!orphans.length) return;

    // Candidate users = active members of this restaurant only.
    const { data: access } = await this.sb
      .from("user_restaurant_access")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    const candidateIds = (access ?? []).map((a: any) => a.user_id);
    if (!candidateIds.length) return;

    const { data: users } = await this.sb
      .from("users")
      .select("user_id, email")
      .in("user_id", candidateIds);
    const byEmail = new Map(
      (users ?? [])
        .filter((u: any) => u.email)
        .map((u: any) => [(u.email as string).toLowerCase(), u.user_id]),
    );
    for (const m of orphans) {
      const uid = byEmail.get((m.email as string).toLowerCase());
      if (!uid) continue;
      const { error } = await this.sb
        .from("team_members")
        .update({ user_id: uid, updated_at: new Date().toISOString() })
        .eq("id", m.id)
        .eq("restaurant_id", restaurantId)
        .is("user_id", null);
      if (!error) m.user_id = uid;
    }
  }

  async createMember(
    userId: string,
    restaurantId: string,
    dto: CreateTeamMemberDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    const { data, error } = await this.sb
      .from("team_members")
      .insert({
        restaurant_id: restaurantId,
        display_name: dto.displayName,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        position: dto.position ?? null,
        employment_type: dto.employmentType ?? "full_time",
        home_location: dto.homeLocation ?? null,
        hourly_wage: dto.hourlyWage ?? null,
        skills: dto.skills ?? [],
        hire_date: dto.hireDate ?? null,
        notes: dto.notes ?? null,
        status: dto.employmentType === "trial" ? "trial" : "active",
      })
      .select()
      .single();
    if (error) {
      this.logger.error(`createMember failed: ${error.message}`);
      throw new InternalServerErrorException("Failed to create team member");
    }
    return data;
  }

  async updateMember(
    userId: string,
    restaurantId: string,
    memberId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.displayName !== undefined) patch.display_name = dto.displayName;
    if (dto.email !== undefined) patch.email = dto.email || null;
    if (dto.phone !== undefined) patch.phone = dto.phone || null;
    if (dto.position !== undefined) patch.position = dto.position || null;
    if (dto.employmentType !== undefined) {
      patch.employment_type = dto.employmentType;
      if (dto.status === undefined && dto.employmentType === "trial") {
        patch.status = "trial";
      }
    }
    if (dto.homeLocation !== undefined)
      patch.home_location = dto.homeLocation || null;
    if (dto.hourlyWage !== undefined) patch.hourly_wage = dto.hourlyWage;
    if (dto.skills !== undefined) patch.skills = dto.skills;
    if (dto.hireDate !== undefined) patch.hire_date = dto.hireDate || null;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.notes !== undefined) patch.notes = dto.notes || null;

    const { data, error } = await this.sb
      .from("team_members")
      .update(patch)
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .select()
      .maybeSingle();
    if (error) {
      this.logger.error(`updateMember failed: ${error.message}`);
      throw new InternalServerErrorException("Failed to update team member");
    }
    if (!data) throw new NotFoundException("Team member not found");
    return data;
  }

  /**
   * Remove a member from the roster, and — when they have an account — revoke
   * their access to the restaurant.
   *
   * This is manager-gated and STAYS manager-gated: the founder's decision
   * (ADR 0088) was that the problem is not who may do it, it is that nobody
   * could afterwards find out who did. So the removal now writes a
   * `system_audit_log` row carrying actor, target and the role lost, and tells
   * the person whose access it revoked. The receipt says whether each of those
   * two writes actually happened, because a removal that silently failed to
   * file itself looks identical to one that filed itself correctly.
   */
  async deleteMember(
    userId: string,
    restaurantId: string,
    memberId: string,
  ): Promise<{
    removed: true;
    audited: boolean;
    notified: boolean;
    accessRevoked: boolean;
  }> {
    await this.assertAccess(userId, restaurantId, "manager");

    // Capture the before-state while it still exists. Nothing below can
    // reconstruct it once the rows are gone.
    const { data: member } = await this.sb
      .from("team_members")
      .select("user_id, display_name, position, email")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .single();

    let previousRole: string | null = null;
    let accessRevoked = false;

    // If member has a linked user, check their access role — owners cannot be removed.
    if (member?.user_id) {
      const { data: access } = await this.sb
        .from("user_restaurant_access")
        .select("role")
        .eq("user_id", member.user_id)
        .eq("restaurant_id", restaurantId)
        .single();
      previousRole = access?.role ?? null;

      if (access?.role === "owner") {
        const { count } = await this.sb
          .from("user_restaurant_access")
          .select("*", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("role", "owner");

        if (count && count <= 1) {
          throw new ForbiddenException(
            "Cannot remove the last owner of the restaurant.",
          );
        }
      }

      // Remove from user_restaurant_access so they lose access and are not backfilled.
      await this.sb
        .from("user_restaurant_access")
        .delete()
        .eq("user_id", member.user_id)
        .eq("restaurant_id", restaurantId);
      accessRevoked = true;
    }

    // Remove from team_members roster.
    const { error } = await this.sb
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId);
    if (error)
      throw new InternalServerErrorException("Failed to remove member");

    const receipt = await recordAccessChange(this.sb, this.logger, {
      restaurantId,
      actorUserId: userId,
      targetUserId: member?.user_id ?? null,
      action: "team_member_removed",
      entityType: "team_member",
      entityId: memberId,
      changes: {
        access_role: { from: previousRole, to: null },
        user_id: member?.user_id ?? null,
        display_name: member?.display_name ?? null,
        position: member?.position ?? null,
      },
      notice: {
        title: "Your access to this restaurant was removed",
        message:
          "A manager removed you from the team, so your access to this restaurant has ended. " +
          "Talk to them if this was not expected.",
      },
    });

    return { removed: true, accessRevoked, ...receipt };
  }

  // ── Certifications ───────────────────────────────────────────────────────
  private certStatus(expiresAt?: string | null): string {
    if (!expiresAt) return "valid";
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    if (days < 0) return "expired";
    if (days <= 21) return "expiring";
    return "valid";
  }

  /**
   * The member row this user is, in this restaurant. `null` when they have no
   * ops profile yet (an account-less roster entry, or a brand-new account).
   */
  private async ownMemberId(
    userId: string,
    restaurantId: string,
  ): Promise<string | null> {
    // `null` here means "no ops profile", and callers scope a staff member's
    // credential file by it. A discarded error made a failed lookup return the
    // same `null`, so a database hiccup silently became "this person has no
    // member row" — an answer about the data, manufactured from an answer about
    // the query. Raised rather than returned so the caller cannot read a
    // failure as an absence; the doc comment's `null` keeps its one meaning.
    const { data, error } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `ownMemberId: lookup failed for user ${userId} in ${restaurantId}: ` +
          error.message,
      );
      throw new InternalServerErrorException(
        "Could not look up your team profile, so the request was not answered.",
      );
    }
    return data?.id ?? null;
  }

  /**
   * The credential file. Managers see the restaurant's; **staff see only their
   * own** (ADR 0088). It carried no role requirement at all, so any member
   * could read every colleague's certificates, issue and expiry dates.
   *
   * Scoping rather than manager-gating, because "when does my own card
   * expire?" is a real staff question and a 403 would take it away.
   */
  async listCertifications(
    userId: string,
    restaurantId: string,
  ): Promise<any[]> {
    const { role } = await this.assertAccess(userId, restaurantId);
    let q = this.sb
      .from("team_certifications")
      .select("*")
      .eq("restaurant_id", restaurantId);
    if (role === "staff") {
      const mine = await this.ownMemberId(userId, restaurantId);
      if (!mine) return [];
      q = q.eq("member_id", mine);
    }
    const { data } = await q.order("expires_at", { ascending: true });
    return (data ?? []).map((c: any) => ({
      ...c,
      status: this.certStatus(c.expires_at),
    }));
  }

  async createCert(
    userId: string,
    restaurantId: string,
    dto: CreateCertDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    await this.assertMemberInRestaurant(restaurantId, dto.memberId);
    const { data, error } = await this.sb
      .from("team_certifications")
      .insert({
        restaurant_id: restaurantId,
        member_id: dto.memberId,
        cert_type: dto.certType,
        issued_at: dto.issuedAt ?? null,
        expires_at: dto.expiresAt ?? null,
        doc_url: dto.docUrl ?? null,
        status: this.certStatus(dto.expiresAt),
      })
      .select()
      .single();
    if (error)
      throw new InternalServerErrorException("Failed to add certification");
    return data;
  }

  async updateCert(
    userId: string,
    restaurantId: string,
    certId: string,
    dto: UpdateCertDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    const patch: Record<string, any> = { updated_at: new Date().toISOString() };
    if (dto.certType !== undefined) patch.cert_type = dto.certType;
    if (dto.issuedAt !== undefined) patch.issued_at = dto.issuedAt;
    if (dto.expiresAt !== undefined) {
      patch.expires_at = dto.expiresAt;
      patch.status = this.certStatus(dto.expiresAt);
    }
    if (dto.docUrl !== undefined) patch.doc_url = dto.docUrl;
    if (dto.status !== undefined) patch.status = dto.status;
    const { data, error } = await this.sb
      .from("team_certifications")
      .update(patch)
      .eq("id", certId)
      .eq("restaurant_id", restaurantId)
      .select()
      .single();
    if (error)
      throw new InternalServerErrorException("Failed to update certification");
    return data;
  }

  async deleteCert(
    userId: string,
    restaurantId: string,
    certId: string,
  ): Promise<void> {
    await this.assertAccess(userId, restaurantId, "manager");
    await this.sb
      .from("team_certifications")
      .delete()
      .eq("id", certId)
      .eq("restaurant_id", restaurantId);
  }

  // ── Time off & swaps (Phase 2 workflow: create + review) ─────────────────
  /**
   * Time-off requests. Managers see the restaurant's — they have to, to review
   * them. **Staff see only their own** (ADR 0088): the table carries a free-text
   * `reason`, and every member could read every colleague's dates and the
   * sentence explaining them.
   */
  async listTimeOff(userId: string, restaurantId: string): Promise<any[]> {
    const { role } = await this.assertAccess(userId, restaurantId);
    let q = this.sb
      .from("time_off_requests")
      .select("*")
      .eq("restaurant_id", restaurantId);
    if (role === "staff") {
      const mine = await this.ownMemberId(userId, restaurantId);
      if (!mine) return [];
      q = q.eq("member_id", mine);
    }
    const { data } = await q.order("created_at", { ascending: false });
    return data ?? [];
  }

  async createTimeOff(
    userId: string,
    restaurantId: string,
    dto: CreateTimeOffDto,
  ): Promise<any> {
    const { role } = await this.assertAccess(userId, restaurantId);
    await this.assertMemberInRestaurant(restaurantId, dto.memberId);

    if (role === "staff") {
      const { data: me } = await this.sb
        .from("team_members")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!me || me.id !== dto.memberId) {
        throw new ForbiddenException(
          "You can only request time off for yourself",
        );
      }
    }

    const { data, error } = await this.sb
      .from("time_off_requests")
      .insert({
        restaurant_id: restaurantId,
        member_id: dto.memberId,
        start_date: dto.startDate,
        end_date: dto.endDate,
        reason: dto.reason ?? null,
      })
      .select()
      .single();
    if (error)
      throw new InternalServerErrorException("Failed to create request");
    return data;
  }

  async reviewTimeOff(
    userId: string,
    restaurantId: string,
    requestId: string,
    dto: ReviewRequestDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    const { data, error } = await this.sb
      .from("time_off_requests")
      .update({
        status: dto.status,
        reviewed_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId)
      .eq("restaurant_id", restaurantId)
      .select()
      .maybeSingle();
    if (error)
      throw new InternalServerErrorException("Failed to review request");
    if (!data) throw new NotFoundException("Request not found");
    return data;
  }

  /*
   * `listSwaps` / `GET …/team/swaps` was deleted here (ADR 0088).
   *
   * `swap_requests` has no writer anywhere in the repository — grepped across
   * `apps/`, `services/` and `supabase/`, the only reference outside the
   * baseline DDL was this read — and no client called the route. It could
   * therefore only ever answer `[]`, which a caller reads as "no swap requests
   * pending" rather than "this feature does not exist"
   * ([[absence-reported-as-health]]). Production holds 0 rows.
   *
   * The table is left in place: a swap workflow is a reasonable thing to build,
   * and when it is built it will need a writer first.
   */

  // ── Coverage templates ───────────────────────────────────────────────────
  async listCoverageTemplates(
    userId: string,
    restaurantId: string,
  ): Promise<any[]> {
    await this.assertAccess(userId, restaurantId);
    const { data } = await this.sb
      .from("coverage_templates")
      .select("*")
      .eq("restaurant_id", restaurantId);
    return data ?? [];
  }

  async createCoverageTemplate(
    userId: string,
    restaurantId: string,
    dto: CreateCoverageTemplateDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    const { data, error } = await this.sb
      .from("coverage_templates")
      .insert({
        restaurant_id: restaurantId,
        day_of_week: dto.dayOfWeek ?? null,
        shift_period: dto.shiftPeriod,
        role: dto.role,
        min_staff: dto.minStaff,
      })
      .select()
      .single();
    if (error)
      throw new InternalServerErrorException("Failed to add coverage rule");
    return data;
  }

  async deleteCoverageTemplate(
    userId: string,
    restaurantId: string,
    id: string,
  ): Promise<void> {
    await this.assertAccess(userId, restaurantId, "manager");
    await this.sb
      .from("coverage_templates")
      .delete()
      .eq("id", id)
      .eq("restaurant_id", restaurantId);
  }

  // ── Settings (labor toggle) ──────────────────────────────────────────────
  /**
   * Labour settings, and whether anyone ever chose them.
   *
   * This returned `{labor_tracking_enabled: true, wage_visible: true,
   * labor_target_pct: 28}` for a restaurant with no row, and the week payload
   * printed that as "target 28% of sales" — a figure nobody chose, rendered as
   * a decision (ADR 0051). Production holds **0** `team_settings` rows, so
   * every restaurant was reading the invented target.
   *
   * The two booleans keep their defaults: they are *feature* defaults (is the
   * lens on, are wages visible), not measurements, and turning the lens off by
   * default would hide a real figure rather than stop inventing one. The target
   * becomes `null`, and `configured` says which of the two you are looking at
   * so a caller can render `—` rather than a number.
   *
   * RESIDUAL, stated: `team_settings.labor_target_pct` is
   * `numeric(5,2) DEFAULT 28 NOT NULL` in the schema, so the first restaurant to
   * toggle `wage_visible` gets a stored 28 it never chose. Making that column
   * nullable is a separate migration against a table with no rows; it is named
   * in `.planning/06-pages/team.md` §9 rather than silently carried.
   */
  async getSettings(userId: string, restaurantId: string): Promise<any> {
    await this.assertAccess(userId, restaurantId);
    const { data } = await this.sb
      .from("team_settings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (data) return { ...data, configured: true };
    return {
      restaurant_id: restaurantId,
      labor_tracking_enabled: true,
      wage_visible: true,
      labor_target_pct: null,
      configured: false,
    };
  }

  async updateSettings(
    userId: string,
    restaurantId: string,
    dto: UpdateTeamSettingsDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId, "manager");
    const patch: Record<string, any> = {
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    };
    if (dto.laborTrackingEnabled !== undefined)
      patch.labor_tracking_enabled = dto.laborTrackingEnabled;
    if (dto.wageVisible !== undefined) patch.wage_visible = dto.wageVisible;
    if (dto.laborTargetPct !== undefined)
      patch.labor_target_pct = dto.laborTargetPct;
    const { data, error } = await this.sb
      .from("team_settings")
      .upsert(patch, { onConflict: "restaurant_id" })
      .select()
      .single();
    if (error) {
      throw new InternalServerErrorException(
        `Failed to update team settings: ${error.message}`,
      );
    }
    return data;
  }
}
