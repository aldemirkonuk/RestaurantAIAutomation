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
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { readRestaurantRole } from "./organizations.service";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";
import type { IssueAuthorityGrantDto } from "./authority-grants.dto";

const REGISTER_COLUMNS =
  "id, restaurant_id, grantor_user_id, grantee_user_id, scope, limit_amount, limit_currency, expires_at, created_at, revoked_at, revoked_by_user_id, vouched_by_user_id, vouched_at, suspended_at, suspended_reason, owner_only, deleted_at";

/** The acts on a grant the seal covers (ADR 0175 amendment, founder answer 4). */
export const GRANT_ISSUE_ACT = "issue_grant";
export const GRANT_REVOKE_ACT = "revoke_grant";
export const GRANT_REAPPROVE_ACT = "reapprove_grant";
export const GRANT_DELETE_ACT = "delete_grant";
export type GrantAct = "revoke" | "reapprove" | "delete";
const ACT_OF: Record<GrantAct, string> = {
  revoke: GRANT_REVOKE_ACT,
  reapprove: GRANT_REAPPROVE_ACT,
  delete: GRANT_DELETE_ACT,
};

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
  vouched_by_user_id: string | null;
  vouched_at: string | null;
  suspended_at: string | null;
  suspended_reason: string | null;
  owner_only: boolean | null;
  deleted_at: string | null;
}

type Person = { userId: string | null; name: string | null };

export interface AuthorityGrantView {
  id: string;
  scope: string;
  grantee: { userId: string; name: string | null };
  grantedBy: Person;
  /** The owner the grant rests on now; differs from grantedBy after a re-approval. */
  vouchedBy: Person;
  limitAmount: number | null;
  limitCurrency: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: Person | null;
  /** When it stopped because its owner went, and why; null while it has not. */
  awaitingSince: string | null;
  awaitingReason: string | null;
  ownerOnly: boolean;
  /**
   * live = counts now. awaiting_reapproval = its owner went; it waits for a
   * current owner (founder, 2026-09-21). revoked / expired = ended.
   */
  state: "live" | "awaiting_reapproval" | "expired" | "revoked";
}

export type RegisterViewer = "owner" | "manager" | "other";

/**
 * The register of who may send to vendors (ADR 0112 F12), and the only way a
 * grant changes.
 *
 * THE FOUNDER'S RULES, EACH ENFORCED HERE
 * --------------------------------------
 * 2026-09-21 (first answer): *"only an owner issues, any owner revokes, every
 * grant/revocation told to all owners, 'granted by' shown where used."*
 * 2026-09-21 (answers on the amendment's forks):
 *   (1) a grant whose owner is demoted or removed STOPS and stays as awaiting
 *       an owner's re-approval; only a CURRENT owner re-activates it, under
 *       the seal, or an owner deletes it — *"no owner grant, no activation, or
 *       no going back once grant author gone"*;
 *   (2) managers see the register by default; an owner may mark a grant
 *       owner-only (hidden from managers); staff see only grants naming them;
 *   (4) issue, revoke and re-approve are sealed on the server, and every grant
 *       event is written to the one security ledger with the owners told.
 *
 * HOW
 * ---
 *   - WHO: the caller's role in THIS house must read `owner`, strictly (a role
 *     that could not be read is a 500, never a pass). The database function
 *     each act calls checks it again.
 *   - SEAL: every issue, revoke, re-approve and delete redeems a seal
 *     (`authority_grant`, keyed on the grant, or on the house for an issue)
 *     before the write. The seal's id travels into the ledger row.
 *   - WRITE + LEDGER: every change is ONE database function
 *     (20260921114800) that changes the grant and appends the security event
 *     in one transaction. This service never writes `authority_grants`
 *     directly; `scripts/check_grant_writes_are_ledgered.py` keeps it so.
 *   - TOLD: every event is written to every owner's bell, and the grantee's.
 *     The response says how many were told, and says so plainly when nobody
 *     could be: the grant change stands, because failing it because the
 *     paper failed would tell the owner something false.
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
    @Optional() private readonly seal?: SealChallengeService,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  private requireSeal(): SealChallengeService {
    if (!this.seal) {
      throw new InternalServerErrorException(
        "The seal could not be checked (it is not wired into the grants register), so nothing was changed. This is a gateway fault, not a decision about the grant.",
      );
    }
    return this.seal;
  }

  private async roleOf(userId: string, restaurantId: string): Promise<string> {
    const role = await readRestaurantRole(this.db, userId, restaurantId, { strict: true });
    return (role ?? "").trim().toLowerCase();
  }

  private async assertOwner(userId: string, restaurantId: string, act: string): Promise<void> {
    if ((await this.roleOf(userId, restaurantId)) !== "owner") {
      throw new ForbiddenException(`Only an owner of this house may ${act}. Nothing was changed.`);
    }
  }

  /**
   * The register, by who is reading (founder, 2026-09-21): an owner sees
   * every grant; a manager sees every grant not marked owner-only; anyone else
   * sees only the grants that name them. Deleted grants are not listed; the
   * security ledger keeps their history.
   */
  async list(
    userId: string,
    restaurantId: string,
  ): Promise<{ viewerIsOwner: boolean; viewer: RegisterViewer; grants: AuthorityGrantView[] }> {
    const role = await this.roleOf(userId, restaurantId);
    const viewer: RegisterViewer = role === "owner" ? "owner" : role === "manager" ? "manager" : "other";
    let query = this.db
      .from("authority_grants")
      .select(REGISTER_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (viewer === "manager") query = query.eq("owner_only", false);
    if (viewer === "other") query = query.eq("grantee_user_id", userId);
    const { data, error } = await query;
    if (error) {
      throw new InternalServerErrorException(`This house's grants could not be read (${error.message}).`);
    }
    const rows = (data ?? []) as unknown as GrantRow[];
    return { viewerIsOwner: viewer === "owner", viewer, grants: await this.present(restaurantId, rows) };
  }

  /** The checks an issue must pass, shared by the seal and the act so the two cannot disagree. */
  private async checkIssue(userId: string, restaurantId: string, dto: IssueAuthorityGrantDto) {
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
    const granteeRole = await this.roleOf(dto.granteeUserId, restaurantId);
    if (!granteeRole) {
      throw new BadRequestException("That person is not a member of this house. Nothing was granted.");
    }
    if (granteeRole === "owner" || granteeRole === "manager") {
      throw new ConflictException(
        `That person is already ${granteeRole === "owner" ? "an owner" : "a manager"} here and may send with one hold. Nothing was granted.`,
      );
    }
    const ownerOnly = dto.ownerOnly === true;
    return { limitAmount, limitCurrency, expiresAt, ownerOnly };
  }

  private static issueArgs(
    granteeUserId: string,
    v: { limitAmount: number | null; limitCurrency: string | null; expiresAt: string | null; ownerOnly: boolean },
  ): Record<string, unknown> {
    return {
      grantee: granteeUserId,
      limitAmount: v.limitAmount,
      limitCurrency: v.limitCurrency,
      expiresAt: v.expiresAt,
      ownerOnly: v.ownerOnly,
    };
  }

  /** Begin the hold on an issue: a seal over the grantee, the limit, the expiry and the visibility. */
  async issueSeal(
    userId: string,
    restaurantId: string,
    dto: IssueAuthorityGrantDto,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    const v = await this.checkIssue(userId, restaurantId, dto);
    const issued = await this.requireSeal().issue({
      restaurantId,
      actorUserId: userId,
      subjectKind: "authority_grant",
      subjectId: restaurantId,
      action: GRANT_ISSUE_ACT,
      args: AuthorityGrantsService.issueArgs(dto.granteeUserId, v),
    });
    return { challenge: issued.challenge, expiresAt: issued.expiresAt, act: issued.action };
  }

  async issue(
    userId: string,
    restaurantId: string,
    dto: IssueAuthorityGrantDto,
    challenge: string | null | undefined,
  ): Promise<{ grant: AuthorityGrantView; told: number; says: string }> {
    const v = await this.checkIssue(userId, restaurantId, dto);
    const { sealId } = await this.requireSeal().redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "authority_grant",
      subjectId: restaurantId,
      action: GRANT_ISSUE_ACT,
      args: AuthorityGrantsService.issueArgs(dto.granteeUserId, v),
      challenge,
    });
    const { data, error } = await this.db.rpc("authority_grant_issue", {
      p_house: restaurantId,
      p_actor: userId,
      p_grantee: dto.granteeUserId,
      p_limit_amount: v.limitAmount,
      p_limit_currency: v.limitCurrency,
      p_expires_at: v.expiresAt,
      p_owner_only: v.ownerOnly,
      p_seal_id: sealId,
    });
    const row = firstRow(data);
    if (error || !row) {
      throw new InternalServerErrorException(
        `The grant was not written (${error?.message ?? "no row returned"}). Nothing was granted.`,
      );
    }
    const [grant] = await this.present(restaurantId, [row]);
    const told = await this.tell(restaurantId, grant, "issued", userId);
    return {
      grant,
      told,
      says:
        told > 0
          ? `${grant.grantee.name ?? "They"} may now send to vendors with one hold. Every owner and the person named were told (${told} ${told === 1 ? "notice" : "notices"}).`
          : `${grant.grantee.name ?? "They"} may now send to vendors with one hold, but the owners could not be told; tell them yourself.`,
    };
  }

  /** One grant of this house, strictly read; a 404 for another house's (ADR 0147). */
  private async grantOfHouse(restaurantId: string, grantId: string): Promise<GrantRow> {
    const { data, error } = await this.db
      .from("authority_grants")
      .select(REGISTER_COLUMNS)
      .eq("id", grantId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(`The grant could not be read (${error.message}). Nothing was changed.`);
    }
    if (!data) throw new NotFoundException("No such grant in this house.");
    return data as unknown as GrantRow;
  }

  /**
   * Whether each act may be taken on this grant NOW, in the words the owner
   * reads when it may not. Shared by the seal and the act.
   */
  private async checkAct(userId: string, restaurantId: string, grantId: string, act: GrantAct): Promise<GrantRow> {
    const verb = act === "revoke" ? "revoke a grant" : act === "reapprove" ? "re-approve a grant" : "delete a grant";
    await this.assertOwner(userId, restaurantId, verb);
    const row = await this.grantOfHouse(restaurantId, grantId);
    const [view] = await this.present(restaurantId, [row]);
    if (row.deleted_at) throw new ConflictException("That grant was deleted. Nothing changed.");
    if (act === "revoke") {
      if (row.revoked_at) throw new ConflictException("That grant was already revoked. Nothing changed.");
      return row;
    }
    if (row.revoked_at) throw new ConflictException("That grant was revoked; it cannot be brought back. Issue a new one.");
    if (view.state !== "awaiting_reapproval") {
      throw new ConflictException(
        view.state === "expired"
          ? "That grant has expired; it cannot be brought back. Issue a new one."
          : act === "reapprove"
            ? "That grant is not waiting for an owner: it still counts. Nothing changed."
            : "That grant still counts, so it is revoked, not deleted. Nothing changed.",
      );
    }
    if (act === "reapprove" && row.grantee_user_id === userId) {
      throw new ForbiddenException("A person cannot re-approve their own grant. Nothing changed.");
    }
    return row;
  }

  /** Begin the hold on a revoke, a re-approve or a delete. */
  async actSeal(
    userId: string,
    restaurantId: string,
    grantId: string,
    act: GrantAct,
  ): Promise<{ challenge: string; expiresAt: string; act: string }> {
    await this.checkAct(userId, restaurantId, grantId, act);
    const issued = await this.requireSeal().issue({
      restaurantId,
      actorUserId: userId,
      subjectKind: "authority_grant",
      subjectId: grantId,
      action: ACT_OF[act],
      args: { grantId },
    });
    return { challenge: issued.challenge, expiresAt: issued.expiresAt, act: issued.action };
  }

  async revoke(userId: string, restaurantId: string, grantId: string, challenge: string | null | undefined) {
    return this.act(userId, restaurantId, grantId, "revoke", challenge);
  }

  async reapprove(userId: string, restaurantId: string, grantId: string, challenge: string | null | undefined) {
    return this.act(userId, restaurantId, grantId, "reapprove", challenge);
  }

  async remove(userId: string, restaurantId: string, grantId: string, challenge: string | null | undefined) {
    return this.act(userId, restaurantId, grantId, "delete", challenge);
  }

  private async act(
    userId: string,
    restaurantId: string,
    grantId: string,
    act: GrantAct,
    challenge: string | null | undefined,
  ): Promise<{ grant: AuthorityGrantView; told: number; says: string }> {
    await this.checkAct(userId, restaurantId, grantId, act);
    const { sealId } = await this.requireSeal().redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "authority_grant",
      subjectId: grantId,
      action: ACT_OF[act],
      args: { grantId },
      challenge,
    });
    // Each function named as a literal, so `check_queried_tables_exist.py` can
    // see the database object every act reaches.
    const args = { p_house: restaurantId, p_actor: userId, p_grant: grantId, p_seal_id: sealId };
    const { data, error } =
      act === "revoke"
        ? await this.db.rpc("authority_grant_revoke", args)
        : act === "reapprove"
          ? await this.db.rpc("authority_grant_reapprove", args)
          : await this.db.rpc("authority_grant_delete", args);
    if (error) {
      throw new InternalServerErrorException(
        `The grant was not changed (${error.message}). ${act === "revoke" ? "It still counts." : "It is as it was."}`,
      );
    }
    const row = firstRow(data);
    if (!row) {
      // The function found the grant no longer in a state this act applies
      // to — another owner acted between the check and the write.
      throw new ConflictException("Another owner changed that grant a moment ago. Nothing was changed; refresh the register.");
    }
    const [grant] = await this.present(restaurantId, [row]);
    const what = act === "revoke" ? "revoked" : act === "reapprove" ? "reapproved" : "deleted";
    const told = await this.tell(restaurantId, grant, what, userId);
    const who = grant.grantee.name ?? "They";
    const lead =
      act === "revoke"
        ? `Revoked. ${who} can no longer send with one hold.`
        : act === "reapprove"
          ? `Re-approved. ${who} may send with one hold again, now resting on you.`
          : `Deleted. ${who}'s grant is gone from the register; the security ledger keeps its history.`;
    return {
      grant,
      told,
      says:
        told > 0
          ? `${lead} Every owner and the person named were told (${told} ${told === 1 ? "notice" : "notices"}).`
          : `${lead} The owners could not be told; tell them yourself.`,
    };
  }

  /** An owner marks a grant owner-only, or not. Not an authority change, so not sealed; still on the ledger and told. */
  async setOwnerOnly(
    userId: string,
    restaurantId: string,
    grantId: string,
    ownerOnly: boolean,
  ): Promise<{ grant: AuthorityGrantView; told: number; says: string }> {
    if (typeof ownerOnly !== "boolean") {
      throw new BadRequestException('Say whether the grant is owner-only ("ownerOnly": true or false). Nothing was changed.');
    }
    await this.assertOwner(userId, restaurantId, "change who sees a grant");
    const current = await this.grantOfHouse(restaurantId, grantId);
    if (current.deleted_at) throw new ConflictException("That grant was deleted. Nothing changed.");
    if ((current.owner_only === true) === ownerOnly) {
      throw new ConflictException(`That grant is already ${ownerOnly ? "owner-only" : "seen by managers"}. Nothing changed.`);
    }
    const { data, error } = await this.db.rpc("authority_grant_set_owner_only", {
      p_house: restaurantId,
      p_actor: userId,
      p_grant: grantId,
      p_owner_only: ownerOnly,
    });
    if (error) throw new InternalServerErrorException(`Who sees the grant was not changed (${error.message}).`);
    const row = firstRow(data);
    if (!row) throw new ConflictException("Another owner changed that grant a moment ago. Nothing was changed; refresh the register.");
    const [grant] = await this.present(restaurantId, [row]);
    const told = await this.tell(restaurantId, grant, ownerOnly ? "hidden" : "shown", userId);
    return {
      grant,
      told,
      says: ownerOnly
        ? "Owner-only: managers no longer see this grant in the register. The owners were told."
        : "Managers see this grant in the register again. The owners were told.",
    };
  }

  private async present(restaurantId: string, rows: GrantRow[]): Promise<AuthorityGrantView[]> {
    if (rows.length === 0) return [];
    const [names, { owners }] = await Promise.all([
      this.authority.namesOf(
        rows.flatMap((r) => [r.grantee_user_id, r.grantor_user_id, r.revoked_by_user_id, r.vouched_by_user_id]),
      ),
      this.authority.ownersAndManagers(restaurantId),
    ]);
    const ownerIds = new Set(owners);
    const now = Date.now();
    const person = (id: string | null): Person => ({ userId: id, name: id ? (names.get(id) ?? null) : null });
    return rows.map((r) => {
      const limit = r.limit_amount === null || r.limit_amount === undefined ? null : Number(r.limit_amount);
      const waiting = !!r.suspended_at || !r.vouched_by_user_id || !ownerIds.has(r.vouched_by_user_id);
      const state: AuthorityGrantView["state"] = r.revoked_at
        ? "revoked"
        : r.expires_at && new Date(r.expires_at).getTime() <= now
          ? "expired"
          : waiting
            ? "awaiting_reapproval"
            : "live";
      return {
        id: r.id,
        scope: r.scope,
        grantee: { userId: r.grantee_user_id, name: names.get(r.grantee_user_id) ?? null },
        grantedBy: person(r.grantor_user_id),
        vouchedBy: person(r.vouched_by_user_id),
        limitAmount: Number.isFinite(limit as number) ? (limit as number) : null,
        limitCurrency: r.limit_currency,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
        revokedAt: r.revoked_at,
        revokedBy: r.revoked_at ? person(r.revoked_by_user_id) : null,
        awaitingSince: state === "awaiting_reapproval" ? (r.suspended_at ?? null) : null,
        awaitingReason:
          state === "awaiting_reapproval"
            ? (r.suspended_reason ?? (r.vouched_by_user_id ? "voucher_no_longer_owner" : "voucher_removed"))
            : null,
        ownerOnly: r.owner_only === true,
        state,
      };
    });
  }

  /** Every owner, and the grantee, is told. Returns how many rows were written. */
  private async tell(
    restaurantId: string,
    grant: AuthorityGrantView,
    what: "issued" | "revoked" | "reapproved" | "deleted" | "hidden" | "shown",
    actorUserId: string,
  ): Promise<number> {
    if (!this.notifications) {
      this.logger.error("A grant change could not be told: notifications are not wired into the grants register.");
      return 0;
    }
    let owners: string[];
    let actorName: string | null = null;
    try {
      owners = (await this.authority.ownersAndManagers(restaurantId)).owners;
      actorName = (await this.authority.namesOf([actorUserId])).get(actorUserId) ?? null;
    } catch (e: any) {
      this.logger.error(`A grant change could not be told: ${e?.message}`);
      return 0;
    }
    const who = grant.grantee.name ?? "A member";
    const by = actorName ?? "an owner";
    const limit =
      grant.limitAmount === null ? "letters only, no money limit" : `up to ${grant.limitAmount} ${grant.limitCurrency}`;
    const until = grant.expiresAt ? `until ${grant.expiresAt.slice(0, 10)}` : "until revoked";
    const words: Record<typeof what, { title: string; message: string }> = {
      issued: {
        title: `${who} may now send to vendors`,
        message: `${by} named ${who} to send to vendors with one hold (${limit}, ${until}). A security change: every owner is told.`,
      },
      revoked: {
        title: `${who} may no longer send to vendors`,
        message: `${by} revoked ${who}'s grant to send to vendors. A security change: every owner is told.`,
      },
      reapproved: {
        title: `${who} may send to vendors again`,
        message: `${by} re-approved ${who}'s grant to send to vendors (${limit}, ${until}); it now rests on ${by}. A security change: every owner is told.`,
      },
      deleted: {
        title: `${who}'s grant to send was deleted`,
        message: `${by} deleted ${who}'s grant, which was waiting for an owner's re-approval. A security change: every owner is told.`,
      },
      hidden: {
        title: `A grant is now owner-only`,
        message: `${by} marked ${who}'s grant to send to vendors owner-only: managers no longer see it in the register.`,
      },
      shown: {
        title: `A grant is visible to managers again`,
        message: `${by} made ${who}'s grant to send to vendors visible to managers again.`,
      },
    };
    // The grantee is told of what changes what they can do; a visibility
    // change does not, and the owners only are told of it.
    const audience = what === "hidden" || what === "shown" ? owners : [...owners, grant.grantee.userId];
    const { inserted } = await this.notifications.persistForRestaurant(
      restaurantId,
      {
        type: `authority_grant_${what}`,
        title: words[what].title,
        message: words[what].message,
        // The web bell only: a push would carry a person's name and a money
        // limit to a locked screen (ADR 0175 D3; grants stay off the shade,
        // D2's lane recommendation). The founder asked for the web bell now.
        priority: "low",
        actionUrl: "/team",
        actionLabel: "See who may send",
        metadata: { grantId: grant.id, change: what },
      },
      { onlyUserIds: [...new Set(audience)] },
    );
    return inserted;
  }
}

/** A composite-returning RPC answers one row (or null, which PostgREST sends for a NULL composite). */
function firstRow(data: unknown): GrantRow | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  const r = row as Partial<GrantRow>;
  return r.id ? (r as GrantRow) : null;
}
