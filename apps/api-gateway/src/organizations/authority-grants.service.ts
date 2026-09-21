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
import { NotificationsService } from "../notifications/notifications.service";
import { readRestaurantRole } from "./organizations.service";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";
import { VENDOR_SEND_SCOPE } from "./vendor-send-authority";
import type { IssueAuthorityGrantDto } from "./authority-grants.dto";

const REGISTER_COLUMNS =
  "id, restaurant_id, grantor_user_id, grantee_user_id, scope, limit_amount, limit_currency, expires_at, created_at, revoked_at, revoked_by_user_id";

interface GrantRow {
  id: string;
  restaurant_id: string;
  grantor_user_id: string | null;
  grantee_user_id: string;
  scope: string;
  limit_amount: string | number | null;
  limit_currency: string | null;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
}

export interface AuthorityGrantView {
  id: string;
  scope: string;
  grantee: { userId: string; name: string | null };
  grantedBy: { userId: string | null; name: string | null };
  limitAmount: number | null;
  limitCurrency: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: { userId: string | null; name: string | null } | null;
  /** live = not revoked and not expired, as of the read. */
  state: "live" | "expired" | "revoked";
}

/**
 * The owners' register of who may send to vendors (ADR 0112 F12).
 *
 * THE FOUNDER'S RULES, EACH ENFORCED HERE
 * --------------------------------------
 * 2026-09-21: *"only an owner issues, any owner revokes, every grant/revocation
 * told to all owners, 'granted by' shown where used."* F12 (2026-09-05): *"Any
 * owner may revoke any grant. Every revocation is told to the owners as a
 * security change."*
 *
 *   - issue: the caller's role in THIS house must read `owner`, strictly (a
 *     role that could not be read is a 500, never a pass).
 *   - revoke: the same, for ANY owner — not only the one who issued it.
 *   - told: every issue and every revocation is written to every owner's bell
 *     (and the grantee's, who needs to know what they can now do). The
 *     response says how many were told, and says so plainly when nobody could
 *     be: the grant still stands, because failing the grant because the
 *     paper failed would tell the owner something false.
 *
 * NOT BUILT HERE, AND SAID SO (ADR 0175 amendment, 2026-09-21): F12's single
 * tamper-evident `security_events` ledger does not exist yet; the grant row
 * and the owners' notices are the record until it does. Issuing a grant is not
 * yet sealed by a hold on the server.
 */
@Injectable()
export class AuthorityGrantsService {
  private readonly logger = new Logger(AuthorityGrantsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly authority: VendorSendAuthorityService,
    @Optional()
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications?: NotificationsService,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  private async assertOwner(userId: string, restaurantId: string, act: string): Promise<void> {
    const role = await readRestaurantRole(this.db, userId, restaurantId, { strict: true });
    if ((role ?? "").trim().toLowerCase() !== "owner") {
      throw new ForbiddenException(`Only an owner of this house may ${act}. Nothing was changed.`);
    }
  }

  /**
   * The register. An owner sees every grant this house has issued; anybody
   * else sees only the grants that name them.
   */
  async list(userId: string, restaurantId: string): Promise<{ viewerIsOwner: boolean; grants: AuthorityGrantView[] }> {
    const role = await readRestaurantRole(this.db, userId, restaurantId, { strict: true });
    const viewerIsOwner = (role ?? "").trim().toLowerCase() === "owner";
    let query = this.db
      .from("authority_grants")
      .select(REGISTER_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    if (!viewerIsOwner) query = query.eq("grantee_user_id", userId);
    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException(`This house's grants could not be read (${error.message}).`);
    }
    const rows = (data ?? []) as unknown as GrantRow[];
    return { viewerIsOwner, grants: await this.present(rows) };
  }

  async issue(
    userId: string,
    restaurantId: string,
    dto: IssueAuthorityGrantDto,
  ): Promise<{ grant: AuthorityGrantView; told: number; says: string }> {
    await this.assertOwner(userId, restaurantId, "name someone who may send to vendors");

    // Each of the three is an answer the owner gives. A missing key is not "no
    // limit" or "never expires" — it is no answer, and no default stands in.
    for (const key of ["limitAmount", "limitCurrency", "expiresAt"] as const) {
      if (!Object.prototype.hasOwnProperty.call(dto, key)) {
        throw new BadRequestException(
          `Say ${key === "expiresAt" ? "when the grant ends (or null for until revoked)" : "the money limit (or null for letters only)"}: "${key}" was missing. Nothing was granted.`,
        );
      }
    }
    const limitAmount = dto.limitAmount ?? null;
    const limitCurrency = dto.limitCurrency ?? null;
    if ((limitAmount === null) !== (limitCurrency === null)) {
      throw new BadRequestException(
        "A money limit needs its currency, and a currency needs a limit. Nothing was granted.",
      );
    }
    const expiresAt = dto.expiresAt ?? null;
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      throw new BadRequestException("That end date has already passed. Nothing was granted.");
    }
    if (dto.granteeUserId === userId) {
      throw new BadRequestException(
        "An owner cannot name themself: a grant exists so an owner can vouch for somebody else. Nothing was granted.",
      );
    }

    const granteeRole = await readRestaurantRole(this.db, dto.granteeUserId, restaurantId, { strict: true });
    const lowered = (granteeRole ?? "").trim().toLowerCase();
    if (!lowered) {
      throw new BadRequestException("That person is not a member of this house. Nothing was granted.");
    }
    if (lowered === "owner" || lowered === "manager") {
      throw new ConflictException(
        `That person is already ${lowered === "owner" ? "an owner" : "a manager"} here and may send with one hold. Nothing was granted.`,
      );
    }

    const { data, error } = await this.db
      .from("authority_grants")
      .insert({
        restaurant_id: restaurantId,
        grantor_user_id: userId,
        grantee_user_id: dto.granteeUserId,
        scope: VENDOR_SEND_SCOPE,
        limit_amount: limitAmount,
        limit_currency: limitCurrency,
        expires_at: expiresAt,
      })
      .select(REGISTER_COLUMNS)
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(
        `The grant was not written (${error?.message ?? "no row returned"}). Nothing was granted.`,
      );
    }
    const [grant] = await this.present([data as unknown as GrantRow]);
    const told = await this.tell(restaurantId, grant, "issued");
    return {
      grant,
      told,
      says:
        told > 0
          ? `${grant.grantee.name ?? "They"} may now send to vendors with one hold. Every owner and the person named were told (${told} ${told === 1 ? "notice" : "notices"}).`
          : `${grant.grantee.name ?? "They"} may now send to vendors with one hold, but the owners could not be told; tell them yourself.`,
    };
  }

  async revoke(
    userId: string,
    restaurantId: string,
    grantId: string,
  ): Promise<{ grant: AuthorityGrantView; told: number; says: string }> {
    await this.assertOwner(userId, restaurantId, "revoke a grant");
    const { data, error } = await this.db
      .from("authority_grants")
      .update({ revoked_at: new Date().toISOString(), revoked_by_user_id: userId })
      .eq("id", grantId)
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null)
      .select(REGISTER_COLUMNS);
    if (error) {
      throw new InternalServerErrorException(`The grant was not revoked (${error.message}). It still counts.`);
    }
    const rows = (data ?? []) as unknown as GrantRow[];
    if (rows.length === 0) {
      // Either no such grant in this house (a 404, the same answer another
      // house's grant gets — ADR 0147) or it was already revoked.
      const { data: existing, error: readError } = await this.db
        .from("authority_grants")
        .select("id, revoked_at")
        .eq("id", grantId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle();
      if (readError) {
        throw new InternalServerErrorException(`Whether the grant exists could not be read (${readError.message}).`);
      }
      if (!existing) throw new NotFoundException("No such grant in this house.");
      throw new ConflictException("That grant was already revoked. Nothing changed.");
    }
    const [grant] = await this.present(rows);
    const told = await this.tell(restaurantId, grant, "revoked");
    return {
      grant,
      told,
      says:
        told > 0
          ? `Revoked. ${grant.grantee.name ?? "They"} can no longer send with one hold. Every owner and the person named were told (${told} ${told === 1 ? "notice" : "notices"}).`
          : `Revoked. ${grant.grantee.name ?? "They"} can no longer send with one hold, but the owners could not be told; tell them yourself.`,
    };
  }

  private async present(rows: GrantRow[]): Promise<AuthorityGrantView[]> {
    const names = await this.authority.namesOf(
      rows.flatMap((r) => [r.grantee_user_id, r.grantor_user_id, r.revoked_by_user_id]),
    );
    const now = Date.now();
    return rows.map((r) => {
      const limit = r.limit_amount === null || r.limit_amount === undefined ? null : Number(r.limit_amount);
      const state: AuthorityGrantView["state"] = r.revoked_at
        ? "revoked"
        : r.expires_at && new Date(r.expires_at).getTime() <= now
          ? "expired"
          : "live";
      return {
        id: r.id,
        scope: r.scope,
        grantee: { userId: r.grantee_user_id, name: names.get(r.grantee_user_id) ?? null },
        grantedBy: {
          userId: r.grantor_user_id,
          name: r.grantor_user_id ? (names.get(r.grantor_user_id) ?? null) : null,
        },
        limitAmount: Number.isFinite(limit as number) ? (limit as number) : null,
        limitCurrency: r.limit_currency,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        revokedAt: r.revoked_at,
        revokedBy: r.revoked_at
          ? {
              userId: r.revoked_by_user_id,
              name: r.revoked_by_user_id ? (names.get(r.revoked_by_user_id) ?? null) : null,
            }
          : null,
        state,
      };
    });
  }

  /** Every owner, and the grantee, is told. Returns how many rows were written. */
  private async tell(
    restaurantId: string,
    grant: AuthorityGrantView,
    what: "issued" | "revoked",
  ): Promise<number> {
    if (!this.notifications) {
      this.logger.error("A grant change could not be told: notifications are not wired into the grants register.");
      return 0;
    }
    let owners: string[];
    try {
      owners = (await this.authority.ownersAndManagers(restaurantId)).owners;
    } catch (e: any) {
      this.logger.error(`A grant change could not be told: ${e?.message}`);
      return 0;
    }
    const who = grant.grantee.name ?? "A member";
    const by = what === "issued" ? (grant.grantedBy.name ?? "an owner") : (grant.revokedBy?.name ?? "an owner");
    const limit =
      grant.limitAmount === null ? "letters only, no money limit" : `up to ${grant.limitAmount} ${grant.limitCurrency}`;
    const until = grant.expiresAt ? `until ${grant.expiresAt.slice(0, 10)}` : "until revoked";
    const { inserted } = await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: what === "issued" ? "authority_grant_issued" : "authority_grant_revoked",
        title:
          what === "issued"
            ? `${who} may now send to vendors`
            : `${who} may no longer send to vendors`,
        message:
          what === "issued"
            ? `${by} named ${who} to send to vendors with one hold (${limit}, ${until}). A security change: every owner is told.`
            : `${by} revoked ${who}'s grant to send to vendors. A security change: every owner is told.`,
        // The web bell only: a push would carry a person's name and a money
        // limit to a locked screen (ADR 0175 D3; grants stay off the shade,
        // D2's lane recommendation). The founder asked for the web bell now.
        priority: "low",
        actionUrl: "/team",
        actionLabel: "See who may send",
        metadata: { grantId: grant.id, change: what },
      },
      { onlyUserIds: [...new Set([...owners, grant.grantee.userId])] },
    );
    return inserted;
  }
}
