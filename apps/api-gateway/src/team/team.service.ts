import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
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

  async assertAccess(
    userId: string,
    restaurantId: string,
    required?: "owner" | "manager",
  ): Promise<{ role: Role }> {
    const { data: access } = await this.sb
      .from("user_restaurant_access")
      .select("role")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();

    if (!access) throw new ForbiddenException("Access denied to this restaurant");

    const role = access.role as Role;
    if (required === "owner" && role !== "owner")
      throw new ForbiddenException("Only owners can perform this action");
    if (required === "manager" && role === "staff")
      throw new ForbiddenException("Only owners and managers can perform this action");

    return { role };
  }

  // ── Members ────────────────────────────────────────────────────────────
  /**
   * Roster = operational team_members merged with the membership rows in
   * user_restaurant_access. Auto-links account-less members to a real user by
   * email (the "manager adds staff, they claim the account later" flow).
   */
  /** Verify a member row belongs to this tenant (prevents cross-restaurant refs). */
  async assertMemberInRestaurant(restaurantId: string, memberId: string): Promise<void> {
    const { data } = await this.sb
      .from("team_members")
      .select("id")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (!data) throw new NotFoundException("Member not found in this restaurant");
  }

  async listMembers(userId: string, restaurantId: string): Promise<any[]> {
    // Manager-gated: the roster exposes wages + linked accounts.
    await this.assertAccess(userId, restaurantId, "manager");

    const { data: members, error } = await this.sb
      .from("team_members")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error(`listMembers failed: ${error.message}`);
      return [];
    }

    await this.autoLinkByEmail(restaurantId, members ?? []);

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
    const roleMap = new Map((access ?? []).map((a: any) => [a.user_id, a.role]));
    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));

    return (members ?? []).map((m: any) => ({
      ...m,
      role: m.user_id ? roleMap.get(m.user_id) ?? null : null,
      linkedUser: m.user_id ? userMap.get(m.user_id) ?? null : null,
      accountLinked: !!m.user_id,
    }));
  }

  /**
   * Best-effort: link an account-less member to a real user by email — but
   * ONLY to a user who already has active access to THIS restaurant. This
   * prevents linking a stranger who happens to share an email and prevents
   * any cross-tenant leakage. Case-insensitive; the update is tenant-scoped.
   */
  private async autoLinkByEmail(restaurantId: string, members: any[]): Promise<void> {
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
    if (dto.email !== undefined) patch.email = dto.email;
    if (dto.phone !== undefined) patch.phone = dto.phone;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.employmentType !== undefined) patch.employment_type = dto.employmentType;
    if (dto.homeLocation !== undefined) patch.home_location = dto.homeLocation;
    if (dto.hourlyWage !== undefined) patch.hourly_wage = dto.hourlyWage;
    if (dto.skills !== undefined) patch.skills = dto.skills;
    if (dto.hireDate !== undefined) patch.hire_date = dto.hireDate;
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.notes !== undefined) patch.notes = dto.notes;

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

  async deleteMember(
    userId: string,
    restaurantId: string,
    memberId: string,
  ): Promise<void> {
    await this.assertAccess(userId, restaurantId, "manager");
    const { error } = await this.sb
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId);
    if (error) throw new InternalServerErrorException("Failed to remove member");
  }

  // ── Certifications ───────────────────────────────────────────────────────
  private certStatus(expiresAt?: string | null): string {
    if (!expiresAt) return "valid";
    const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000;
    if (days < 0) return "expired";
    if (days <= 21) return "expiring";
    return "valid";
  }

  async listCertifications(userId: string, restaurantId: string): Promise<any[]> {
    await this.assertAccess(userId, restaurantId);
    const { data } = await this.sb
      .from("team_certifications")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("expires_at", { ascending: true });
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
    if (error) throw new InternalServerErrorException("Failed to add certification");
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
    if (error) throw new InternalServerErrorException("Failed to update certification");
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
  async listTimeOff(userId: string, restaurantId: string): Promise<any[]> {
    await this.assertAccess(userId, restaurantId);
    const { data } = await this.sb
      .from("time_off_requests")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    return data ?? [];
  }

  async createTimeOff(
    userId: string,
    restaurantId: string,
    dto: CreateTimeOffDto,
  ): Promise<any> {
    await this.assertAccess(userId, restaurantId);
    await this.assertMemberInRestaurant(restaurantId, dto.memberId);
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
    if (error) throw new InternalServerErrorException("Failed to create request");
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
    if (error) throw new InternalServerErrorException("Failed to review request");
    if (!data) throw new NotFoundException("Request not found");
    return data;
  }

  async listSwaps(userId: string, restaurantId: string): Promise<any[]> {
    await this.assertAccess(userId, restaurantId);
    const { data } = await this.sb
      .from("swap_requests")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    return data ?? [];
  }

  // ── Coverage templates ───────────────────────────────────────────────────
  async listCoverageTemplates(userId: string, restaurantId: string): Promise<any[]> {
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
    if (error) throw new InternalServerErrorException("Failed to add coverage rule");
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
  async getSettings(userId: string, restaurantId: string): Promise<any> {
    await this.assertAccess(userId, restaurantId);
    const { data } = await this.sb
      .from("team_settings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    return (
      data ?? {
        restaurant_id: restaurantId,
        labor_tracking_enabled: true,
        wage_visible: true,
        labor_target_pct: 28,
      }
    );
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
    if (dto.laborTargetPct !== undefined) patch.labor_target_pct = dto.laborTargetPct;
    const { data, error } = await this.sb
      .from("team_settings")
      .upsert(patch, { onConflict: "restaurant_id" })
      .select()
      .single();
    if (error) throw new InternalServerErrorException("Failed to update settings");
    return data;
  }
}
