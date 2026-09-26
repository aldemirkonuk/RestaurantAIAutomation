import {
  BadRequestException,
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
import { WebsocketGateway } from "../websocket/websocket.gateway";
import { cancelPendingInvitesFrom } from "../auth/cancel-house-invites";
import { markMembershipLeft } from "../auth/membership-ended";
import { recordAccessChange } from "./access-audit";
import { recordOwnWageChange, type OwnWageReceipt } from "./own-wage-notice";
import {
  LeaveType,
  labourSettingsRefusal,
  memberForViewer,
  onTheRoster,
  seesMoney,
  TeamRole,
  wageWriteRefusal,
  ownWageTellsTheOwner,
  workedHours,
  isWorked,
} from "./pay-rules";
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
 * How long a removed person's records are kept: `wage_record_retention()` in
 * the database (migration `20260927150110`, founder 2026-09-21/22, five years).
 * Stated here only to print "kept until"; the database's clock is the one that
 * deletes.
 */
export const FORMER_STAFF_RETENTION_YEARS = 5;

/**
 * Team ops service: the operational staff profile that sits on top of the
 * existing membership roster (user_restaurant_access). Owns members,
 * certifications, availability, time-off/swap requests, coverage rules and
 * the per-restaurant team settings (labor toggle).
 */
@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly websocketGateway?: WebsocketGateway,
  ) {}

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
    opts?: { payAccess?: boolean },
  ): Promise<{ role: Role; payAccess: boolean }> {
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

    // Read only where money is at stake, and only for a manager: an owner
    // sees pay regardless and staff never do (ADR 0215, round 4 item 19).
    const payAccess =
      opts?.payAccess === true && role === "manager"
        ? await this.managerPayAccess(userId, restaurantId)
        : false;

    return { role, payAccess };
  }

  /**
   * Whether an owner switched this manager's pay access on
   * (`user_restaurant_access.team_pay_access`, ADR 0215, founder 2026-09-25
   * round 4 item 19: "Pay visibility only"). Read on its own, never folded
   * into `assertAccess`'s membership read: until migration `20260927150220`
   * applies, the column does not exist, and a membership read that failed on
   * it would lock every manager and owner out of /team. A failed read here is
   * logged and answers OFF — the money is withheld, never shown on a guess —
   * and the page already says withheld money is the owner's.
   */
  private async managerPayAccess(
    userId: string,
    restaurantId: string,
  ): Promise<boolean> {
    const { data, error } = await this.sb
      .from("user_restaurant_access")
      .select("team_pay_access")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `managerPayAccess: could not read the pay switch for ${userId} in ` +
          `${restaurantId}, so pay is withheld: ${error.message}`,
      );
      return false;
    }
    return data?.team_pay_access === true;
  }

  /**
   * Per-channel opt-outs for these users, read from `notification_preferences`
   * — the register the scheduled mailer already honours. `null` means the read
   * failed; the caller must not read that as "nobody opted out". See
   * `broadcast-preferences.ts` for why the rule is restated rather than
   * imported from the resolver.
   */
  async channelOptOuts(
    userIds: string[],
    restaurantId: string,
  ): Promise<ChannelPreferences | null> {
    return loadChannelOptOuts(this.sb, userIds, restaurantId);
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

  /**
   * The ids of everyone on this house's roster now — inactive people
   * included, because only a removal takes a person off it (ADR 0215 item
   * 19). A removed person's shifts and leave are kept but are not part of the
   * working week (`onTheRoster`, item 20). A failed read RAISES: an empty set
   * here would hide every shift and every leave request, and "could not read
   * the roster" is not "nobody works here".
   */
  async rosterMemberIds(restaurantId: string): Promise<Set<string>> {
    const { data, error } = await this.sb
      .from("team_members")
      .select("id")
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.error(
        `rosterMemberIds: could not read the roster of ${restaurantId}: ` +
          error.message,
      );
      throw new InternalServerErrorException(
        "Could not read who is on the team, so the request was not answered.",
      );
    }
    return new Set((data ?? []).map((m: any) => m.id as string));
  }

  async listMembers(userId: string, restaurantId: string): Promise<any[]> {
    // Manager-gated: the roster exposes linked accounts. Its wages are the
    // owner's alone (ADR 0215).
    const viewer = await this.assertAccess(userId, restaurantId, "manager", {
      payAccess: true,
    });
    const { role } = viewer;

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

    /*
     * `team_settings.wage_visible` used to decide this, and it did not hold: it
     * blanked the roster's wage and nothing else, so the week's `labor_cost`
     * gave every wage back to any manager, and switching it off hid wages from
     * the owner too. The founder's rule is a role (ADR 0215, 2026-09-21:
     * "Owner only"), applied to every row by `memberForViewer`. The flag is no
     * longer read.
     */

    /**
     * Enrich with membership role + linked user profile.
     *
     * `public.users` has NO `avatar_url` column (baseline
     * `20260805000000_baseline_from_production.sql:5848-5861`; avatars live on
     * `team_members`). Naming it here made PostgREST answer 42703 and, with
     * `error` unbound by the destructure, `data` came back `null` — so
     * `userMap` was empty and EVERY member returned `linkedUser: null`.
     * Measured against the demo tenant on 2026-09-04: 3 of 3 roster rows came
     * back unnamed while `GET /restaurants/:rid/members` — which fixed the
     * identical bug at `restaurants/members.service.ts:101-117` — returned
     * "Demo User", "Sarah Johnson" and "David Chen" for the same three user
     * ids. Same fault, same module family, one of them already repaired.
     *
     * Both errors are now bound. A roster whose identities could not be read
     * is not a roster of anonymous people, and a member list whose roles could
     * not be read is not a list of people with no role.
     */
    const userIds = [
      ...new Set((members ?? []).map((m: any) => m.user_id).filter(Boolean)),
    ];
    const [{ data: access, error: accessError }, { data: users, error: usersError }] =
      await Promise.all([
        this.sb
          .from("user_restaurant_access")
          .select("user_id, role, is_active")
          .eq("restaurant_id", restaurantId),
        userIds.length
          ? this.sb
              .from("users")
              .select("user_id, name, email")
              .in("user_id", userIds)
          : Promise.resolve({ data: [] as any[], error: null }),
      ]);
    if (accessError || usersError) {
      this.logger.error(
        `listMembers could not read member identities for ${restaurantId}: ` +
          `${accessError?.message ?? ""} ${usersError?.message ?? ""}`.trim(),
      );
      throw new InternalServerErrorException("Failed to load team members");
    }
    const roleMap = new Map(
      (access ?? []).map((a: any) => [a.user_id, a.role]),
    );
    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));
    // The owner is the one who switches a manager's pay access, so only the
    // owner's roster carries it; `null` on a row = the switch could not be read.
    const switches = role === "owner" ? await this.payAccessByUser(restaurantId) : null;

    return (members ?? []).map((m: any) => {
      const memberRole = m.user_id ? (roleMap.get(m.user_id) ?? null) : null;
      return memberForViewer(
        {
          ...m,
          role: memberRole,
          linkedUser: m.user_id ? (userMap.get(m.user_id) ?? null) : null,
          accountLinked: !!m.user_id,
          ...(role === "owner" && memberRole === "manager"
            ? {
                payAccess:
                  switches === null ? null : switches.get(m.user_id) === true,
              }
            : {}),
        },
        viewer,
      );
    });
  }

  /**
   * Every membership's pay switch in this house, or `null` when it could not
   * be read (before migration `20260927150220`, or a failed read). Read apart
   * from the roster's own membership read for the same reason as
   * `managerPayAccess`: a missing column must not take the roster down.
   */
  private async payAccessByUser(
    restaurantId: string,
  ): Promise<Map<string, boolean> | null> {
    const { data, error } = await this.sb
      .from("user_restaurant_access")
      .select("user_id, team_pay_access")
      .eq("restaurant_id", restaurantId);
    if (error) {
      this.logger.warn(
        `payAccessByUser: could not read the pay switches of ${restaurantId}: ${error.message}`,
      );
      return null;
    }
    return new Map(
      (data ?? []).map((a: any) => [a.user_id as string, a.team_pay_access === true]),
    );
  }

  /**
   * Switch a manager's pay access on or off — the owner's alone (ADR 0215,
   * founder 2026-09-25 round 4 item 19, "Pay visibility only": "The switch
   * decides whether that manager can see and edit pay; their other rights are
   * unchanged"). Only a person who is a MANAGER of this house by an active
   * membership has the switch: an owner sees pay regardless, staff never do,
   * and a roster row with no account has no membership to carry it. Every
   * change is a `team_pay_access_changed` audit row, and the manager is told;
   * a save that moves nothing records nothing. Each read binds its error: a
   * switch whose before-state cannot be read is not written.
   */
  async setPayAccess(
    userId: string,
    restaurantId: string,
    memberId: string,
    payAccess: boolean,
  ): Promise<{
    memberId: string;
    payAccess: boolean;
    changed: boolean;
    audited: boolean;
    notified: boolean;
  }> {
    await this.assertAccess(userId, restaurantId, "owner");
    const { data: member, error: memberErr } = await this.sb
      .from("team_members")
      .select("user_id, display_name")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (memberErr) this.cannotReadPaySwitch(memberId, memberErr);
    if (!member) throw new NotFoundException("Team member not found");
    if (!member.user_id) {
      throw new BadRequestException(
        "This person has no account in this house, so there is no manager access to switch. Nothing was saved.",
      );
    }
    const { data: access, error: accessErr } = await this.sb
      .from("user_restaurant_access")
      .select("role, is_active, team_pay_access")
      .eq("user_id", member.user_id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (accessErr) this.cannotReadPaySwitch(memberId, accessErr);
    if (!access || access.is_active !== true || access.role !== "manager") {
      throw new BadRequestException(
        "Only a manager of this house has a pay switch: an owner sees pay already and staff never do. Nothing was saved.",
      );
    }
    const before = access.team_pay_access === true;
    if (before === payAccess) {
      return { memberId, payAccess, changed: false, audited: false, notified: false };
    }
    const { error: writeErr } = await this.sb
      .from("user_restaurant_access")
      .update({ team_pay_access: payAccess })
      .eq("user_id", member.user_id)
      .eq("restaurant_id", restaurantId)
      .eq("role", "manager")
      .eq("is_active", true);
    if (writeErr) {
      this.logger.error(
        `setPayAccess could not write the pay switch for member ${memberId}: ${writeErr.message}`,
      );
      throw new InternalServerErrorException(
        "The pay switch was not saved, so this manager's access to pay is unchanged.",
      );
    }
    const receipt = await recordAccessChange(this.sb, this.logger, {
      restaurantId,
      actorUserId: userId,
      targetUserId: member.user_id,
      action: "team_pay_access_changed",
      entityType: "team_member",
      entityId: memberId,
      changes: { team_pay_access: { from: before, to: payAccess } },
      notice: payAccess
        ? {
            title: "You can now see and set pay on Team",
            message:
              "An owner of this restaurant switched your pay access on: you now see wages, shift cost and labour totals on Team, and can set a colleague's wage. Your other rights are unchanged.",
          }
        : {
            title: "Your pay access on Team was switched off",
            message:
              "An owner of this restaurant switched your pay access off: Team now shows you hours, not wages or cost. Your other rights are unchanged.",
          },
    });
    return { memberId, payAccess, changed: true, ...receipt };
  }

  /** A pay switch whose before-state cannot be read is not written. */
  private cannotReadPaySwitch(memberId: string, err: { message: string }): never {
    this.logger.error(
      `setPayAccess could not read member ${memberId}: ${err.message}`,
    );
    throw new InternalServerErrorException(
      "Could not read this person's access here, so the pay switch was not changed.",
    );
  }

  /**
   * Only an owner writes a wage (ADR 0215) — and, since 2026-09-25 (round 4
   * item 19), a manager the owner switched on (`wageWriteRefusal`); since
   * round 5 (item 32) that includes their own wage, with the owner told
   * (`ownWageTellsTheOwner`, `recordOwnWageChange`). A manager could once set
   * anyone's wage with no record; this refuses a writer who may not see pay
   * before anything is written, and it refuses in words — a wage silently
   * dropped from a save would read as saved.
   */
  private assertMayWriteWage(viewer: { role: Role; payAccess: boolean }): void {
    const refusal = wageWriteRefusal(viewer);
    if (refusal) throw new ForbiddenException(refusal);
  }

  /**
   * Whether roster row `memberId` is the caller's own, and what its wage was.
   * Read only when a manager with pay access sets a wage: the answer decides
   * whether the owner is told, and the before-figure is what they are told.
   * A failed read refuses the write — a self-set wage the owner cannot be told
   * about is the one write this must not let through unnamed.
   */
  private async readOwnRow(
    userId: string,
    restaurantId: string,
    memberId: string,
  ): Promise<{ self: boolean; before: number | null; name: string | null }> {
    const { data, error } = await this.sb
      .from("team_members")
      .select("user_id, hourly_wage, display_name")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        `readOwnRow could not read member ${memberId}: ${error.message}`,
      );
      throw new InternalServerErrorException(
        "Could not read whose row this is, so the wage was not saved.",
      );
    }
    return {
      self: data?.user_id === userId,
      before: data?.hourly_wage == null ? null : Number(data.hourly_wage),
      name: data?.display_name ?? null,
    };
  }

  /** The house currency the wage trigger records, for the owner's notice. */
  private async houseCurrency(restaurantId: string): Promise<string | null> {
    const { data, error } = await this.sb
      .from("restaurants")
      .select("currency")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.warn(
        `own-wage notice: currency unreadable for ${restaurantId}: ${error.message}`,
      );
      return null;
    }
    return data?.currency ?? null;
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

    /**
     * The same 42703 as `listMembers` above — `public.users` has no
     * `avatar_url` — but here it did not merely blank a field: with `data`
     * null the map was empty, every branch of the name expression below fell
     * through, and this backfill WROTE the literal "Team member" into
     * `team_members.display_name` (a NOT NULL column, baseline `:5632`) for
     * every access row it created. Those rows are durable, so the demo
     * tenant's three roster rows still read "Team member" today with
     * `email: null` — a fabricated name produced by a failed read, which is
     * the write-path form of [[absence-reported-as-health]].
     *
     * The error is now bound and a failed identity read ABORTS the backfill:
     * an ops profile that cannot be named is not created at all, because the
     * only name available would be one nobody chose.
     */
    const { data: users, error: usersError } = await this.sb
      .from("users")
      .select("user_id, name, email")
      .in(
        "user_id",
        missing.map((m: any) => m.user_id),
      );
    if (usersError) {
      this.logger.error(
        `ensureRosterFromAccess: identities unreadable (${usersError.message}) — ` +
          "no roster rows created rather than rows carrying a placeholder name",
      );
      // Not a silent return. There ARE access rows here with no ops profile,
      // so swallowing this would answer the caller's "who is on this team?"
      // with a roster that is short by exactly the people it could not name —
      // the absence reported as health, one layer up.
      throw new InternalServerErrorException("Failed to load team members");
    }
    const userMap = new Map((users ?? []).map((u: any) => [u.user_id, u]));
    const rows = missing.map((a: any) => {
      const u = userMap.get(a.user_id);
      return {
        restaurant_id: restaurantId,
        user_id: a.user_id,
        /**
         * `users.name` is NOT NULL (baseline `:5852`), so after the fix above
         * a found user always yields a real name. The literal survives only
         * for the case where an access row points at a user row that is not
         * there — a broken reference, not a person called this. `/team`'s
         * Mudavym roster recognises it as the placeholder it is and renders
         * "No name on file" (`pages/team/next/tm-format.ts`), never as a name.
         */
        display_name: u?.name || u?.email || "Team member",
        email: u?.email ?? null,
        /** Avatars live on `team_members`; `public.users` has no such column. */
        avatar_url: null,
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
    const viewer = await this.assertAccess(userId, restaurantId, "manager", {
      payAccess: true,
    });
    const setsWage = dto.hourlyWage !== undefined && dto.hourlyWage !== null;
    // A new roster row is nobody's own yet: it has no account linked.
    if (setsWage) this.assertMayWriteWage(viewer);
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
        // Who set the wage, in the same statement: the database writes the
        // `team_member_wage_changes` row from it and clears it (ADR 0215).
        // Undefined (no wage set) is dropped from the JSON body; an inline
        // key keeps this write readable by check_order_capture_contract.py.
        wage_changed_by: setsWage ? userId : undefined,
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
    return memberForViewer(data, viewer);
  }

  async updateMember(
    userId: string,
    restaurantId: string,
    memberId: string,
    dto: UpdateTeamMemberDto,
  ): Promise<any> {
    const viewer = await this.assertAccess(userId, restaurantId, "manager", {
      payAccess: true,
    });
    // Before any write: a manager may still edit everything else about a
    // person, and nothing about their pay unless an owner switched their pay
    // access on (ADR 0215; round 4 item 19). Their own included, and then the
    // owner is told (round 5 item 32).
    let own: { self: boolean; before: number | null; name: string | null } = {
      self: false,
      before: null,
      name: null,
    };
    if (dto.hourlyWage !== undefined) {
      this.assertMayWriteWage(viewer);
      if (viewer.role !== "owner" && seesMoney(viewer)) {
        own = await this.readOwnRow(userId, restaurantId, memberId);
      }
    }
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
    if (dto.hourlyWage !== undefined) {
      patch.hourly_wage = dto.hourlyWage;
      // The wage and the record of who changed it are ONE statement: the
      // trigger writes the change row (old, new, who, when) from this and
      // clears it, so they commit or fail together.
      patch.wage_changed_by = userId;
    }
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

    // A manager who set their own wage: the owner is told, and the trail
    // names it (round 5 item 32). Only when the figure actually moved — the
    // wage trigger records a change only then, and a notice about a wage that
    // did not change would be a claim about nothing.
    const after = dto.hourlyWage == null ? null : Number(dto.hourlyWage);
    let ownWage: OwnWageReceipt | undefined;
    if (ownWageTellsTheOwner(viewer, own.self) && own.before !== after) {
      ownWage = await recordOwnWageChange(this.sb, this.logger, {
        restaurantId,
        actorUserId: userId,
        memberId,
        displayName: own.name,
        before: own.before,
        after,
        currency: await this.houseCurrency(restaurantId),
      });
    }
    const out = memberForViewer(data, viewer);
    return ownWage ? { ...out, ownWage } : out;
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
   *
   * Owners manage owners (ADR 0162, the founder's addendum 2026-09-18): a
   * manager removes a manager or staff here, never an owner, the same rule as
   * `MembersService.removeMember`. Until PR #393's sixth round this door let a
   * manager remove an owner whenever another owner remained (v3.0-TECH-DEBT
   * 44.1n). And the removal now also stops the person's `users` row naming this
   * house, so the `users`-row fallback no longer counts them as a member here
   * (44.1j).
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
    const actor = await this.assertAccess(userId, restaurantId, "manager");

    // Capture the before-state while it still exists. Nothing below can
    // reconstruct it once the rows are gone. Every read before the first write
    // binds its error: a failed read here used to look like "no row", and the
    // owner check below then had nothing to refuse on.
    const { data: member, error: memberErr } = await this.sb
      .from("team_members")
      .select("user_id, display_name, position, email")
      .eq("id", memberId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (memberErr) this.cannotReadRemovalTarget(memberId, memberErr);

    let previousRole: string | null = null;
    let accessRevoked = false;

    if (member?.user_id) {
      // The access row in any state, because this removal deletes it in any
      // state. Its role is the before-state the audit row records.
      const { data: access, error: accessErr } = await this.sb
        .from("user_restaurant_access")
        .select("role, is_active")
        .eq("user_id", member.user_id)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (accessErr) this.cannotReadRemovalTarget(memberId, accessErr);
      previousRole = access?.role ?? null;
      const activeOwner = access?.is_active === true && access.role === "owner";

      // What the person is here, read the way `assertMembership` reads a
      // member: an active access row decides; with none, a `users` row naming
      // this house, at its role.
      let targetRole: string | null =
        access?.is_active === true ? (access.role ?? null) : null;
      if (access?.is_active !== true) {
        const { data: linked, error: linkedErr } = await this.sb
          .from("users")
          .select("restaurant_id, role")
          .eq("user_id", member.user_id)
          .maybeSingle();
        if (linkedErr) this.cannotReadRemovalTarget(memberId, linkedErr);
        if (linked && linked.restaurant_id === restaurantId) {
          targetRole = linked.role ?? null;
        }
      }

      // Owners manage owners: a manager removes a manager or staff, never an
      // owner, whether the owner is one by an active access row, by the
      // `users` row, or by an inactive owner's row this removal would delete.
      // Before any write.
      if (
        (targetRole === "owner" || access?.role === "owner") &&
        actor.role !== "owner"
      ) {
        throw new ForbiddenException(
          "Only an owner of this house can remove an owner.",
        );
      }

      if (activeOwner) {
        // Active owners only, and a failed count refuses: `if (count && …)`
        // skipped this guard whenever the count could not be read.
        const { count, error: countErr } = await this.sb
          .from("user_restaurant_access")
          .select("*", { count: "exact", head: true })
          .eq("restaurant_id", restaurantId)
          .eq("role", "owner")
          .eq("is_active", true);
        if (countErr) this.cannotReadRemovalTarget(memberId, countErr);

        if ((count ?? 0) <= 1) {
          throw new ForbiddenException(
            "Cannot remove the last owner of the restaurant.",
          );
        }
      }

      // The `users` row stops naming this house (only this house) before the
      // access row goes; the reverse order could leave the person a member by
      // a `users` row nobody meant to keep (v3.0-TECH-DEBT 44.1j).
      const { error: clearErr } = await this.sb
        .from("users")
        .update({ restaurant_id: null })
        .eq("user_id", member.user_id)
        .eq("restaurant_id", restaurantId);
      if (clearErr) {
        this.logger.error(
          `deleteMember could not clear users.restaurant_id for ` +
            `${member.user_id} in ${restaurantId}: ${clearErr.message}`,
        );
        throw new InternalServerErrorException("Failed to remove member");
      }

      // Remove from user_restaurant_access so they lose access and are not
      // backfilled. Its error is read: `accessRevoked: true` on a delete that
      // failed would be a receipt for something that did not happen.
      const { error: revokeErr } = await this.sb
        .from("user_restaurant_access")
        .delete()
        .eq("user_id", member.user_id)
        .eq("restaurant_id", restaurantId);
      if (revokeErr) {
        this.logger.error(
          `deleteMember could not revoke access for ${member.user_id} in ` +
            `${restaurantId}: ${revokeErr.message}`,
        );
        throw new InternalServerErrorException("Failed to remove member");
      }
      accessRevoked = true;
      // A manager deleting their own roster row is leaving (ADR 0164, round
      // 5, item 26): only people removed by someone else see /no-access.
      if (member.user_id === userId)
        await markMembershipLeft(this.sb, userId, restaurantId, this.logger);
      this.websocketGateway?.evictFromHouse(member.user_id, restaurantId);
      await cancelPendingInvitesFrom(
        this.sb,
        member.user_id,
        restaurantId,
        this.logger,
      );
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

  /**
   * The owner's FORMER-STAFF HISTORY (ADR 0215, founder 2026-09-25 round 4
   * item 19, "Owner-only history (Recommended)": "Hidden from the team views;
   * the owner can open a 'former staff' history for pay and legal records").
   *
   * One entry per person whose departure is recorded
   * (`team_member_departures`): the shifts, leave requests, wage changes and
   * credentials kept for them, each for five years after the removal
   * (`wage_record_retention()`), then deleted by the nightly job. The team
   * views never show these rows (`onTheRoster`); this is the one place that
   * reads them, and only an owner may.
   *
   * THE NAME comes from the removal's own audit row
   * (`system_audit_log`, `team_member_removed`, `changes.display_name`),
   * which `deleteMember` has written since ADR 0088. The departure row holds
   * no name, on purpose (KVKK: the minimum; `20260927150110`), so none is
   * added here: when the audit row is missing, the entry says the name was
   * not recorded rather than inventing one.
   *
   * Leave carries dates, status and type, never the free-text `reason`.
   * Every read binds its error: a history that could not be read is a 500 in
   * words, never an empty list that would read as "nobody has left".
   */
  async listFormerStaff(
    userId: string,
    restaurantId: string,
  ): Promise<{
    retentionYears: number;
    money: { currency: string | null; country: string | null; readable: boolean };
    people: any[];
  }> {
    await this.assertAccess(userId, restaurantId, "owner");
    const fail = (what: string, err: { message: string }): never => {
      this.logger.error(
        `listFormerStaff could not read ${what} for ${restaurantId}: ${err.message}`,
      );
      throw new InternalServerErrorException(
        `Could not read the former-staff history (${what}), so it is not shown.`,
      );
    };

    const { data: departures, error: depErr } = await this.sb
      .from("team_member_departures")
      .select("member_id, left_at")
      .eq("restaurant_id", restaurantId)
      .order("left_at", { ascending: false });
    if (depErr) fail("departures", depErr);

    const { data: house, error: houseErr } = await this.sb
      .from("restaurants")
      .select("currency, country")
      .eq("id", restaurantId)
      .maybeSingle();
    const money = houseErr
      ? { currency: null, country: null, readable: false }
      : {
          currency: house?.currency ?? null,
          country: house?.country ?? null,
          readable: true,
        };
    if (houseErr) {
      this.logger.warn(
        `listFormerStaff could not read the currency of ${restaurantId}: ${houseErr.message}`,
      );
    }

    const ids = (departures ?? []).map((d: any) => d.member_id as string);
    if (ids.length === 0) {
      return { retentionYears: FORMER_STAFF_RETENTION_YEARS, money, people: [] };
    }

    const [shiftsQ, leaveQ, wagesQ, certsQ, removalsQ] = await Promise.all([
      this.sb
        .from("shifts")
        .select("*, shift_breaks(*)")
        .eq("restaurant_id", restaurantId)
        .in("member_id", ids)
        .order("shift_date", { ascending: false }),
      this.sb
        .from("time_off_requests")
        .select("id, member_id, start_date, end_date, status, leave_type")
        .eq("restaurant_id", restaurantId)
        .in("member_id", ids)
        .order("start_date", { ascending: false }),
      this.sb
        .from("team_member_wage_changes")
        .select("member_id, old_wage, new_wage, currency, changed_by_role, changed_at")
        .eq("restaurant_id", restaurantId)
        .in("member_id", ids)
        .order("changed_at", { ascending: false }),
      this.sb
        .from("team_certifications")
        .select("id, member_id, cert_type, issued_at, expires_at, doc_url, status")
        .eq("restaurant_id", restaurantId)
        .in("member_id", ids)
        .order("expires_at", { ascending: true }),
      this.sb
        .from("system_audit_log")
        .select("entity_id, changes, created_at")
        .eq("restaurant_id", restaurantId)
        .eq("action", "team_member_removed")
        .in("entity_id", ids),
    ]);
    if (shiftsQ.error) fail("shifts", shiftsQ.error);
    if (leaveQ.error) fail("leave requests", leaveQ.error);
    if (wagesQ.error) fail("wage changes", wagesQ.error);
    if (certsQ.error) fail("credentials", certsQ.error);
    if (removalsQ.error) fail("the removal records", removalsQ.error);

    const byMember = <T extends { member_id: string }>(rows: T[] | null) => {
      const m = new Map<string, T[]>();
      for (const r of rows ?? []) {
        const list = m.get(r.member_id) ?? [];
        list.push(r);
        m.set(r.member_id, list);
      }
      return m;
    };
    const shifts = byMember((shiftsQ.data ?? []) as any[]);
    const leave = byMember((leaveQ.data ?? []) as any[]);
    const wages = byMember((wagesQ.data ?? []) as any[]);
    const certs = byMember((certsQ.data ?? []) as any[]);
    const removal = new Map<string, any>();
    for (const r of (removalsQ.data ?? []) as any[]) {
      const seen = removal.get(r.entity_id);
      if (!seen || String(r.created_at) > String(seen.created_at)) {
        removal.set(r.entity_id, r);
      }
    }

    const people = (departures ?? []).map((d: any) => {
      const id = d.member_id as string;
      const said = removal.get(id)?.changes ?? null;
      const name =
        typeof said?.display_name === "string" && said.display_name.trim()
          ? said.display_name.trim()
          : null;
      const kept = shifts.get(id) ?? [];
      const worked = kept.filter(isWorked);
      const hours = worked.reduce((n: number, s: any) => n + workedHours(s), 0);
      const unpriced = worked.filter((s: any) => s.labor_cost == null).length;
      const keptUntil = new Date(d.left_at);
      keptUntil.setUTCFullYear(keptUntil.getUTCFullYear() + FORMER_STAFF_RETENTION_YEARS);
      return {
        memberId: id,
        name,
        position:
          typeof said?.position === "string" && said.position.trim()
            ? said.position.trim()
            : null,
        leftAt: d.left_at,
        keptUntil: keptUntil.toISOString(),
        shifts: kept.map((s: any) => ({
          id: s.id,
          shift_date: s.shift_date,
          start_time: s.start_time,
          end_time: s.end_time,
          state: s.state,
          role: s.role ?? null,
          workedHours: Math.round(workedHours(s) * 100) / 100,
          labor_cost: s.labor_cost ?? null,
        })),
        totals: {
          shiftsWorked: worked.length,
          workedHours: Math.round(hours * 10) / 10,
          /** `null` when any worked shift has no cost on file — never a partial. */
          cost:
            unpriced > 0
              ? null
              : Math.round(
                  worked.reduce((n: number, s: any) => n + Number(s.labor_cost), 0) * 100,
                ) / 100,
          unpricedShifts: unpriced,
        },
        leave: (leave.get(id) ?? []).map((l: any) => ({
          id: l.id,
          start_date: l.start_date,
          end_date: l.end_date,
          status: l.status,
          leave_type: l.leave_type ?? "unknown",
        })),
        wageChanges: (wages.get(id) ?? []).map((w: any) => ({
          old_wage: w.old_wage,
          new_wage: w.new_wage,
          currency: w.currency ?? null,
          changed_by_role: w.changed_by_role ?? null,
          changed_at: w.changed_at,
        })),
        credentials: (certs.get(id) ?? []).map((c: any) => ({
          id: c.id,
          cert_type: c.cert_type,
          issued_at: c.issued_at,
          expires_at: c.expires_at,
          doc_url: c.doc_url ?? null,
          status: c.status,
        })),
      };
    });
    return { retentionYears: FORMER_STAFF_RETENTION_YEARS, money, people };
  }

  /** A member whose role here cannot be read is not removed. */
  private cannotReadRemovalTarget(
    memberId: string,
    err: { message: string },
  ): never {
    this.logger.error(
      `deleteMember could not read member ${memberId}: ${err.message}`,
    );
    throw new InternalServerErrorException(
      "Could not read this member's role here, so nobody was removed.",
    );
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
  /**
   * PUBLIC since 2026-09-04: `NotesService` needs it to answer "which roster
   * row is the caller?" when recording that a crew note was opened. Kept as one
   * implementation rather than copied, so the error handling below — a failed
   * lookup RAISES rather than returning the `null` that means "no ops profile"
   * — cannot drift between two versions of the same question.
   */
  async ownMemberId(
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
    // A removed person's credentials are kept five years, not listed (ADR
    // 0215, founder 2026-09-25 round 4 item 19): they appear only in the
    // owner's former-staff history. A staff caller's list is already their own.
    const rows =
      role === "staff"
        ? (data ?? [])
        : onTheRoster(data ?? [], await this.rosterMemberIds(restaurantId));
    return rows.map((c: any) => ({
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
    if (role === "staff") return data ?? [];
    // A removed person's requests are kept five years, not listed (ADR 0215
    // item 20): before 20260927150200 the removal deleted them, and a
    // pending one would otherwise wait for a decision about someone gone.
    return onTheRoster(data ?? [], await this.rosterMemberIds(restaurantId));
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
        // Whether the days are paid (ADR 0215). Omitted, the column's own
        // default applies: 'unknown', because nobody said.
        leave_type: dto.leaveType || undefined,
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
    const leaveType: LeaveType | undefined = dto.leaveType;
    const { data, error } = await this.sb
      .from("time_off_requests")
      .update({
        status: dto.status,
        reviewed_by: userId,
        updated_at: new Date().toISOString(),
        // The reviewer says whether the days are paid; omitted, it stays as
        // it was (ADR 0215). A type is a classification of time, not money.
        leave_type: leaveType || undefined,
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
   * save a labour setting gets a stored 28 it never chose. Making that column
   * nullable is a separate migration against a table with no rows; it is named
   * in `.planning/06-pages/team.md` §9 rather than silently carried.
   */
  async getSettings(userId: string, restaurantId: string): Promise<any> {
    const { role } = await this.assertAccess(userId, restaurantId);
    const mayChange = this.labourSettingsMayChange(role);
    const { data } = await this.sb
      .from("team_settings")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    /*
     * `wage_visible` is RETIRED (ADR 0215) and is not returned: a flag a caller
     * could still read would read as the rule. Who sees money is a role, and
     * `moneyVisibleTo` says which.
     */
    if (data) {
      const { wage_visible: _retired, ...rest } = data;
      return { ...rest, moneyVisibleTo: "owner", mayChange, configured: true };
    }
    return {
      restaurant_id: restaurantId,
      labor_tracking_enabled: true,
      labor_target_pct: null,
      moneyVisibleTo: "owner",
      mayChange,
      configured: false,
    };
  }

  /**
   * What this viewer may change in the labour settings, so the page can say so
   * instead of offering a switch the gateway will refuse. The rule itself is
   * `labourSettingsRefusal` (pay-rules.ts); this only describes it per role.
   */
  private labourSettingsMayChange(role: TeamRole): {
    trackingOff: boolean;
    trackingOn: boolean;
    target: boolean;
  } {
    const saves = role === "owner" || role === "manager";
    return {
      trackingOff:
        saves &&
        labourSettingsRefusal(role, { laborTrackingEnabled: false }) === null,
      trackingOn:
        saves &&
        labourSettingsRefusal(role, { laborTrackingEnabled: true }) === null,
      target:
        saves && labourSettingsRefusal(role, { laborTargetPct: 1 }) === null,
    };
  }

  async updateSettings(
    userId: string,
    restaurantId: string,
    dto: UpdateTeamSettingsDto,
  ): Promise<any> {
    const { role } = await this.assertAccess(userId, restaurantId, "manager");
    // Refused in words rather than dropped: the whitelist pipe would otherwise
    // strip it and answer 200, and a switch that answers "saved" and does
    // nothing is worse than no switch (ADR 0215).
    if (dto.wageVisible !== undefined) {
      throw new BadRequestException(
        "Wage visibility is no longer a setting: wages and labour cost are " +
          "shown to the owner only, and managers see hours. Nothing was saved.",
      );
    }
    // Only the owner switches labour-cost tracking off or changes the labour
    // target (founder, 2026-09-21, ADR 0215). Refused before any write.
    const refusal = labourSettingsRefusal(role, dto);
    if (refusal) throw new ForbiddenException(refusal);
    // What the settings were, for the record below. A failed read is an
    // error, not "no settings yet": the record would otherwise say the change
    // started from nothing.
    const { data: before, error: beforeErr } = await this.sb
      .from("team_settings")
      .select("labor_tracking_enabled, labor_target_pct")
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (beforeErr) {
      this.logger.error(
        `updateSettings: could not read the settings of ${restaurantId}: ` +
          beforeErr.message,
      );
      throw new InternalServerErrorException(
        "Could not read the current team settings, so nothing was saved.",
      );
    }
    const patch: Record<string, any> = {
      restaurant_id: restaurantId,
      updated_at: new Date().toISOString(),
    };
    if (dto.laborTrackingEnabled !== undefined)
      patch.labor_tracking_enabled = dto.laborTrackingEnabled;
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
    // The save answers in the same shape as `getSettings`: the retired flag is
    // not handed back, because a flag a caller can still read would read as the
    // rule (ADR 0215). `.select()` returns every column, the retired one too.
    const { wage_visible: _retired, ...rest } = data ?? {};
    const audited = await this.recordSettingsChange(
      userId,
      restaurantId,
      role,
      before,
      patch,
    );
    return {
      ...rest,
      moneyVisibleTo: "owner",
      mayChange: this.labourSettingsMayChange(role),
      configured: true,
      audited,
    };
  }

  /**
   * Who changed the labour settings, when, as what role, and from what to what
   * (ADR 0215: the owner's alone to switch off or re-target, so the record
   * says who did). Only the fields the save wrote AND moved are recorded; a
   * save that moved nothing records nothing. Never throws: the change has
   * happened, and undoing it because the paper failed would be worse than
   * saying so, which the reply's `audited: false` does.
   */
  private async recordSettingsChange(
    userId: string,
    restaurantId: string,
    role: TeamRole,
    before: Record<string, any> | null,
    written: Record<string, any>,
  ): Promise<boolean | null> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ["labor_tracking_enabled", "labor_target_pct"]) {
      if (!(k in written)) continue;
      const from = before?.[k] ?? null;
      const to = written[k] ?? null;
      // Compared as numbers when both are numeric: numeric(5,2) reads back
      // as "30.00" or 30 depending on the client, and neither is a change.
      const same =
        from !== null &&
        to !== null &&
        !isNaN(Number(from)) &&
        !isNaN(Number(to))
          ? Number(from) === Number(to)
          : from === to;
      if (!same) changes[k] = { from, to };
    }
    // Nothing moved: nothing to record, and `null` says so (not "failed").
    if (Object.keys(changes).length === 0) return null;
    try {
      const { error } = await this.sb.from("system_audit_log").insert({
        actor_type: "user",
        actor_id: userId,
        action: "team_labour_settings_changed",
        entity_type: "team_settings",
        entity_id: restaurantId,
        changes: { ...changes, role },
        restaurant_id: restaurantId,
        reason: null,
      });
      if (error) {
        this.logger.error(
          `team_labour_settings_changed happened but the audit row failed: ${error.message}`,
        );
        return false;
      }
      return true;
    } catch (err: any) {
      this.logger.error(
        `team_labour_settings_changed happened but the audit row threw: ${err?.message}`,
      );
      return false;
    }
  }
}
