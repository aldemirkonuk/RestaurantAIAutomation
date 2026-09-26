import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { readRestaurantRole } from "./organizations.service";
import {
  type ActAmount,
  type AuthorityGrantRow,
  type VendorSendStanding,
  VENDOR_SEND_SCOPE,
  askSentence,
  decideVendorSend,
  sendRefusal,
} from "./vendor-send-authority";

/**
 * Every column the gate reads off `authority_grants`, as a literal for
 * `scripts/check_read_columns_exist.py`.
 */
const GRANT_COLUMNS =
  "id, grantor_user_id, grantee_user_id, scope, limit_amount, limit_currency, expires_at, created_at, revoked_at, vouched_by_user_id, suspended_at, deleted_at";

/** A standing plus the role it was read from, so a readout can name it. */
export type VendorSendReading = VendorSendStanding & { role: string | null };

/**
 * The shape a panel reads to decide between "hold to send" and "hold to ask" —
 * `mayApprove`'s twin (`procurement.service.ts` `orderApprovalGate`), for
 * vendor sends (founder, 2026-09-21: *"a mayApprove-shaped 'send or ask'
 * field for the draft panel"*).
 */
export interface SendOrAsk {
  readable: boolean;
  /** true when this person's hold SENDS. */
  maySend: boolean;
  mode: "send" | "ask" | null;
  basis: "owner" | "manager" | "grant" | null;
  /** The grant a grantee sends under — "granted by" is shown where it is used. */
  grant: {
    id: string;
    grantedBy: { userId: string; name: string | null };
    expiresAt: string | null;
    limitAmount: number | null;
    limitCurrency: string | null;
  } | null;
  /** null when the person may send; otherwise the whole sentence. */
  sentence: string | null;
}

/**
 * The reads behind `decideVendorSend` — who may send to a vendor with one hold
 * (ADR 0112 F12; ADR 0175 D10; the founder's 2026-09-21 answer).
 *
 * WHY THIS SERVICE DEPENDS ON THE DATABASE AND NOTHING ELSE
 * --------------------------------------------------------
 * Every vendor-send path needs it: procurement (approve-draft, manual-reply,
 * confirm-deal), conversations (`/conversations/:id/approve`) and the house
 * composer in communications. `OrganizationsService` would drag `AuthModule`
 * behind it, and `AuthModule` imports `CommunicationsModule` — a cycle for the
 * composer. The role rule itself is NOT copied: `readRestaurantRole` is the one
 * implementation, lifted out of `OrganizationsService` for this.
 *
 * FAILS CLOSED, AND SAYS IT FAILED
 * --------------------------------
 * Every read here is strict. A role or grant that could not be READ throws a
 * 500 naming the read; it never becomes "ask a manager", which would report an
 * outage as a fact about the person (ADR 0020), and it never becomes "send",
 * which would open the gate on an error.
 */
@Injectable()
export class VendorSendAuthorityService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.supabase;
  }

  /** What this person's hold does, for this act, in this house. */
  async standing(
    userId: string,
    restaurantId: string,
    opts: { amount?: ActAmount | null; now?: Date } = {},
  ): Promise<VendorSendReading> {
    if (!userId?.trim() || !restaurantId?.trim()) {
      throw new ForbiddenException("A named person in a named house is required. Nothing was sent.");
    }
    const role = await readRestaurantRole(this.db, userId, restaurantId, { strict: true });
    const lowered = (role ?? "").trim().toLowerCase();

    // An owner or a manager needs no grant read at all — and must not be
    // refused because the grant table could not be read.
    if (lowered === "owner" || lowered === "manager") {
      return { ...decideVendorSend({ role, grants: [], ownerIds: new Set(), now: opts.now ?? new Date() }), role };
    }

    const grants = await this.grantsHeldBy(userId, restaurantId);
    // The owners the grants REST ON (their vouchers), each read now, strictly.
    // A latched grant needs no read: it waits whatever its voucher is today.
    const ownerIds = new Set<string>();
    const vouchers = [
      ...new Set(
        grants
          .filter((g) => !g.suspended_at && !g.deleted_at && !g.revoked_at)
          .map((g) => g.vouched_by_user_id)
          .filter((g): g is string => !!g),
      ),
    ];
    for (const voucher of vouchers) {
      const voucherRole = await readRestaurantRole(this.db, voucher, restaurantId, { strict: true });
      if ((voucherRole ?? "").trim().toLowerCase() === "owner") ownerIds.add(voucher);
    }
    return {
      ...decideVendorSend({ role, grants, ownerIds, now: opts.now ?? new Date(), amount: opts.amount ?? null }),
      role,
    };
  }

  /**
   * The readout. A standing that could not be READ is `readable: false` with
   * the reason — never "ask" (an outage reported as a fact about the person)
   * and never "send".
   *
   * `canAsk` says whether this surface has a request path: where it does (a
   * drafted reply, a reply from the thread) the sentence says the hold will
   * ask; where it does not (the house composer) it says who can send instead.
   */
  async readout(
    userId: string,
    restaurantId: string,
    opts: { canAsk: boolean; amount?: ActAmount | null; act?: string },
  ): Promise<SendOrAsk> {
    const unreadable = (why: string): SendOrAsk => ({
      readable: false,
      maySend: false,
      mode: null,
      basis: null,
      grant: null,
      sentence: `Whether your hold sends could not be read (${why}). Nothing will be sent until it can.`,
    });
    let reading: VendorSendReading;
    try {
      reading = await this.standing(userId, restaurantId, { amount: opts.amount ?? null });
    } catch (e: any) {
      return unreadable(e?.message ?? "no reason given");
    }
    const act = opts.act ?? "send it";
    if (reading.mode === "ask") {
      return {
        readable: true,
        maySend: false,
        mode: "ask",
        basis: null,
        grant: null,
        sentence: opts.canAsk
          ? askSentence(reading.reason, act)
          : sendRefusal(reading.reason, act, { canAsk: false }).replace(/^Nothing was sent\. /, ""),
      };
    }
    if (reading.basis !== "grant") {
      return { readable: true, maySend: true, mode: "send", basis: reading.basis, grant: null, sentence: null };
    }
    let grantorName: string | null = null;
    try {
      grantorName = (await this.namesOf([reading.grant.grantorUserId])).get(reading.grant.grantorUserId) ?? null;
    } catch {
      // "granted by" with no readable name still names the grant; the panel
      // says the name could not be read rather than dropping the line.
    }
    return {
      readable: true,
      maySend: true,
      mode: "send",
      basis: "grant",
      grant: {
        id: reading.grant.id,
        grantedBy: { userId: reading.grant.grantorUserId, name: grantorName },
        expiresAt: reading.grant.expiresAt,
        limitAmount: reading.grant.limitAmount,
        limitCurrency: reading.grant.limitCurrency,
      },
      sentence: null,
    };
  }

  /**
   * The gate. Returns the standing when this person may send; otherwise throws
   * a 403 whose message is the whole sentence (what was not done, why, and
   * what to do instead).
   */
  async assertMaySend(
    userId: string,
    restaurantId: string,
    act: string,
    opts: { amount?: ActAmount | null; canAsk: boolean },
  ): Promise<Extract<VendorSendReading, { mode: "send" }>> {
    const reading = await this.standing(userId, restaurantId, { amount: opts.amount });
    if (reading.mode !== "send") {
      throw new ForbiddenException(sendRefusal(reading.reason, act, { canAsk: opts.canAsk }));
    }
    return reading;
  }

  /**
   * A send made under a grant is a grant event (ADR 0112 F12: "grant checks
   * write to one tamper-evident security_events chain"; founder, 2026-09-21:
   * every grant event is written there). Called at the ACT, after the seal is
   * spent and BEFORE anything leaves: if the ledger cannot be written the send
   * is refused, because a send under a grant the ledger does not show is the
   * one record F12 exists to keep. An owner or a manager sends by role, which
   * is not a grant event, and nothing is written for them.
   */
  async witnessGrantUse(
    grantId: string | null | undefined,
    input: { userId: string; restaurantId: string; act: string; subject: string },
  ): Promise<void> {
    if (!grantId) return;
    const { error } = await this.db.rpc("authority_grant_relied_on", {
      p_house: input.restaurantId,
      p_actor: input.userId,
      p_grant: grantId,
      p_act: input.act,
      p_subject: input.subject,
    });
    if (error) {
      throw new InternalServerErrorException(
        `Your grant could not be written to the house's security ledger (${error.message}), so nothing was sent. A send under a grant is always recorded there.`,
      );
    }
  }

  /** This person's grants in this house, live or not (the decision sorts them). */
  async grantsHeldBy(userId: string, restaurantId: string): Promise<AuthorityGrantRow[]> {
    const { data, error } = await this.db
      .from("authority_grants")
      .select(GRANT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("grantee_user_id", userId)
      .eq("scope", VENDOR_SEND_SCOPE);
    if (error) {
      throw new InternalServerErrorException(
        `Whether an owner has named this person could not be read (${error.message}). Nothing was sent.`,
      );
    }
    return (data ?? []) as unknown as AuthorityGrantRow[];
  }

  /**
   * The people a request is told to: this house's owners and managers, by the
   * same rule the gate uses (an active access row first, the legacy
   * `users.role` only for a person with no active access row here).
   */
  async ownersAndManagers(restaurantId: string): Promise<{ owners: string[]; managers: string[] }> {
    const { data: access, error: accessError } = await this.db
      .from("user_restaurant_access")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (accessError) {
      throw new InternalServerErrorException(
        `This house's owners and managers could not be read (${accessError.message}).`,
      );
    }
    const { data: legacy, error: legacyError } = await this.db
      .from("users")
      .select("user_id, role")
      .eq("restaurant_id", restaurantId);
    if (legacyError) {
      throw new InternalServerErrorException(
        `This house's owners and managers could not be read (${legacyError.message}).`,
      );
    }
    const roleOf = new Map<string, string>();
    for (const row of (access ?? []) as Array<{ user_id: string; role: string | null }>) {
      if (row.role) roleOf.set(row.user_id, row.role.trim().toLowerCase());
    }
    for (const row of (legacy ?? []) as Array<{ user_id: string; role: string | null }>) {
      if (!roleOf.has(row.user_id) && row.role) roleOf.set(row.user_id, row.role.trim().toLowerCase());
    }
    const owners: string[] = [];
    const managers: string[] = [];
    for (const [id, role] of roleOf) {
      if (role === "owner") owners.push(id);
      else if (role === "manager") managers.push(id);
    }
    return { owners, managers };
  }

  /**
   * Names for people, for "asked by …", "sent by …" and "granted by …".
   * Strict: a failed read throws rather than rendering everybody as nobody.
   */
  async namesOf(userIds: Array<string | null | undefined>): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((id): id is string => !!id))];
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const { data, error } = await this.db.from("users").select("user_id, name").in("user_id", ids);
    if (error) {
      throw new InternalServerErrorException(`Who these people are could not be read (${error.message}).`);
    }
    for (const row of (data ?? []) as Array<{ user_id: string; name: string | null }>) {
      if (row.name) out.set(row.user_id, row.name);
    }
    return out;
  }
}
