import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
  forwardRef,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { GmailService } from "../communications/gmail.service";
import { HouseLettersService } from "../communications/letters/house-letters.service";
import { isLiveMembership } from "../common/tenant/live-membership";

/**
 * POST /notifications/send-email — who may send, and to whom.
 *
 * THE RULE (founder, 2026-09-16, ADR 0149 answer 15; ADR 0147 "Named, not
 * fixed"): an owner or a manager of the ACTIVE house, and recipients limited to
 * the house's members and its vendors' contacts. Before this the route sent to
 * any address the body named, for any signed-in user of any role — an open
 * relay through the deployment's shared mailbox.
 *
 * WHAT DECIDES, AND FROM WHERE
 * ---------------------------
 * - The house and the person come from the verified token (`userId`,
 *   `restaurantId`), never from the body.
 * - The role is the person's role IN THIS HOUSE, and ONLY from a live
 *   `user_restaurant_access` row (`isLiveMembership`: active, `valid_from` not
 *   in the future, `valid_until` null or in the future). The token's `role` is
 *   `users.role`, one value for every house the person belongs to, so it cannot
 *   answer this, and the route deliberately carries no `RolesGuard` that reads
 *   it.
 * - THERE IS NO LEGACY FALLBACK (removed 2026-09-17, notify-lane review B1).
 *   The first build let a person with no access row for this house fall back to
 *   `users.restaurant_id` + `users.role`. Both columns are written from the
 *   request body by the public `POST /auth/register` (`auth.service.ts`
 *   register: `restaurant_id: data.restaurantId, role: data.role`, and
 *   `RegisterData` is an interface, so the ValidationPipe strips nothing), and
 *   the token's `restaurantId` is signed from that column. So anyone who knew a
 *   house's id could register as its "owner" and send mail as the house. A
 *   person with no live access row is not a member here, whatever their
 *   account row claims.
 * - Recipients are resolved SERVER-SIDE into one book: the email of every
 *   LIVE member of this house (same predicate), plus the house's vendor book as
 *   `HouseLettersService.book` defines it (`providers.contact_email`,
 *   `providers.primary_contact.email`, `provider_contacts.email`). The composer,
 *   the house inbox's sender filter and this route read the SAME book, so an
 *   address cannot be writable here and unknown there. Every address in `to`,
 *   `cc` and `bcc` must be in it, compared case- and whitespace-insensitively.
 *   One address outside it refuses the whole send, and the refusal names it.
 *
 * WHAT IS RECORDED
 * ----------------
 * One `system_audit_log` row per attempt that reached the house check —
 * `house_email_sent`, `house_email_refused` or `house_email_failed` — carrying
 * COUNTS, the vendor ids and the message id, never an address or the body
 * (ADR 0040: an address never lands in a row a page renders; `/logs` reads this
 * table). A failed audit write after a send that already left is reported back
 * as `audited: false`, not hidden.
 *
 * Refusal rows are COLLAPSED per (person, house, kind of refusal): within
 * `REFUSAL_AUDIT_WINDOW_MS` of a written refusal row, a repeat is counted and
 * not written, and the next row written for that key carries
 * `suppressedRepeats` — so a signed-in staff member looping on the route
 * cannot fill the house's log, and no refusal disappears uncounted. The
 * counter lives in this process: a restart, or a second gateway instance,
 * starts its own window. Sent and failed rows are never collapsed.
 *
 * WHAT A FAILURE LOOKS LIKE
 * -------------------------
 * A read that fails is a 503 naming what could not be read, never an empty book
 * (which would refuse every address with a wrong reason) and never a pass. A
 * send the mail provider refuses is a 502 carrying its words. No mail provider
 * on this deployment is a 503 — the previous `NotificationsService.sendEmail`
 * answered `success: true` with a mock message id when Gmail was absent.
 */

export interface HouseEmailActor {
  userId?: string | null;
  restaurantId?: string | null;
}

export interface HouseEmailInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
}

export interface HouseEmailReceipt {
  success: true;
  message_id: string | null;
  timestamp: string;
  recipients: { to: number; cc: number; bcc: number };
  audited: boolean;
}

/** Roles that may write as the house. */
const SENDING_ROLES = new Set(["owner", "manager"]);
const ROLE_RANK: Record<string, number> = { owner: 3, manager: 2, staff: 1 };

interface BookAddress {
  kind: "member" | "vendor_contact";
  providerId: string | null;
}

function norm(address: string): string {
  return address.trim().toLowerCase();
}

/** How long repeats of one refusal are counted instead of written. */
export const REFUSAL_AUDIT_WINDOW_MS = 10 * 60 * 1000;
/** Above this many tracked keys, expired windows are pruned. */
const REFUSAL_AUDIT_MAX_KEYS = 1000;

@Injectable()
export class HouseEmailService {
  private readonly logger = new Logger(HouseEmailService.name);
  /** key `${userId}|${restaurantId}|${refusal}` -> the open collapse window. */
  private readonly refusalAudits = new Map<
    string,
    { writtenAt: number; suppressed: number }
  >();

  constructor(
    private readonly db: DatabaseService,
    @Inject(forwardRef(() => HouseLettersService))
    private readonly letters: HouseLettersService,
    @Optional()
    @Inject(forwardRef(() => GmailService))
    private readonly gmail?: GmailService,
  ) {}

  async send(
    actor: HouseEmailActor,
    input: HouseEmailInput,
  ): Promise<HouseEmailReceipt> {
    const userId = actor?.userId ? String(actor.userId) : "";
    if (!userId) {
      throw new UnauthorizedException(
        "No user on this session; an email cannot be sent on nobody's behalf.",
      );
    }
    const restaurantId = actor?.restaurantId ? String(actor.restaurantId) : "";
    if (!restaurantId) {
      throw new BadRequestException(
        "No active restaurant on this session, so there is no house to send for and no address book to check recipients against.",
      );
    }

    const role = await this.houseRole(userId, restaurantId);
    if (!role || !SENDING_ROLES.has(role)) {
      const reason = role
        ? `Only an owner or a manager of this house can send email from Mudavym; your role here is ${role}.`
        : "You are not a current member of this house, so you cannot send email for it.";
      await this.auditRefusal(userId, restaurantId, "role", reason, {
        role: role ?? null,
      });
      throw new ForbiddenException(reason);
    }

    const to = dedupe(input.to ?? []);
    const cc = dedupe(input.cc ?? []).filter(
      (a) => !to.some((t) => norm(t) === norm(a)),
    );
    const bcc = dedupe(input.bcc ?? []).filter(
      (a) =>
        !to.some((t) => norm(t) === norm(a)) &&
        !cc.some((c) => norm(c) === norm(a)),
    );
    if (to.length === 0) {
      throw new BadRequestException(
        "Name at least one recipient. Mudavym sends only to this house's members and the contacts in its vendor book.",
      );
    }

    const book = await this.addressBook(restaurantId);
    const named = [...to, ...cc, ...bcc];
    const notInBook = named.filter((a) => !book.has(norm(a)));
    if (notInBook.length > 0) {
      const reason =
        `Mudavym sends only to this house's members and the contacts in its vendor book. ` +
        `Not in the book: ${notInBook.join(", ")}. Add the address to the vendor's contacts first, or remove it.`;
      await this.auditRefusal(
        userId,
        restaurantId,
        "recipient_not_in_book",
        "One or more recipients are not this house's members or vendor contacts.",
        {
          named: named.length,
          notInBook: notInBook.length,
        },
      );
      throw new ForbiddenException(reason);
    }

    const matched = named.map((a) => book.get(norm(a))!);
    const counts = {
      to: to.length,
      cc: cc.length,
      bcc: bcc.length,
      members: matched.filter((m) => m.kind === "member").length,
      vendorContacts: matched.filter((m) => m.kind === "vendor_contact")
        .length,
      providerIds: [
        ...new Set(
          matched
            .map((m) => m.providerId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
    };

    if (!this.gmail) {
      await this.audit(
        userId,
        restaurantId,
        "house_email_failed",
        "No mail provider is configured on this deployment.",
        { failure: "mail_not_configured", ...counts },
      );
      throw new ServiceUnavailableException(
        "Email is not configured on this deployment, so nothing was sent.",
      );
    }

    let result: { success: boolean; messageId?: string; error?: string };
    try {
      result = await this.gmail.sendEmail({
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: input.subject,
        html: input.bodyHtml,
        text: input.bodyText,
      });
    } catch (e: any) {
      result = { success: false, error: e?.message ?? "the sender threw" };
    }

    if (!result.success) {
      const words = result.error ?? "the mail provider gave no reason";
      await this.audit(
        userId,
        restaurantId,
        "house_email_failed",
        `The mail provider refused the send: ${words}`,
        { failure: "provider_refused", ...counts },
      );
      throw new BadGatewayException(
        `The email was not sent: ${words}`,
      );
    }

    const audited = await this.audit(
      userId,
      restaurantId,
      "house_email_sent",
      `Sent to ${named.length} address${named.length === 1 ? "" : "es"} in this house's book.`,
      { messageId: result.messageId ?? null, ...counts },
    );
    this.logger.log(
      `HOUSE_EMAIL_SENT house=${restaurantId} actor=${userId} recipients=${named.length} messageId=${result.messageId ?? "none"} audited=${audited}`,
    );

    return {
      success: true,
      message_id: result.messageId ?? null,
      timestamp: new Date().toISOString(),
      recipients: { to: to.length, cc: cc.length, bcc: bcc.length },
      audited,
    };
  }

  /**
   * The caller's role in THIS house, or null when they are not a current
   * member. ONLY a live `user_restaurant_access` row counts — never
   * `users.restaurant_id` / `users.role`, which the public register route
   * writes from its request body (see the header). A failed read throws; it is
   * never read as "not a member".
   */
  private async houseRole(
    userId: string,
    restaurantId: string,
  ): Promise<string | null> {
    const { data, error } = await this.db.supabase
      .from("user_restaurant_access")
      .select("role, is_active, valid_from, valid_until")
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId);
    if (error) {
      throw new ServiceUnavailableException(
        `Your access to this house could not be read (${error.message}), so nothing was sent.`,
      );
    }

    const now = this.now();
    const roles = ((data ?? []) as Array<{
      role?: string | null;
      is_active?: boolean | null;
      valid_from?: string | null;
      valid_until?: string | null;
    }>)
      .filter((r) => isLiveMembership(r, now))
      .map((r) => String(r.role ?? "").toLowerCase())
      .filter(Boolean)
      .sort((a, b) => (ROLE_RANK[b] ?? 0) - (ROLE_RANK[a] ?? 0));
    return roles[0] ?? null;
  }

  /**
   * Every address this house may write to from this route: its current
   * members, and its vendor book. Keyed by normalised address.
   */
  private async addressBook(
    restaurantId: string,
  ): Promise<Map<string, BookAddress>> {
    const book = new Map<string, BookAddress>();

    // --- members -----------------------------------------------------------
    // Live access rows only. No `users.restaurant_id` "home house" members:
    // that column is body-written at registration (see the header).
    const { data: access, error: accessError } = await this.db.supabase
      .from("user_restaurant_access")
      .select("user_id, is_active, valid_from, valid_until")
      .eq("restaurant_id", restaurantId);
    if (accessError) {
      throw new ServiceUnavailableException(
        `This house's members could not be read (${accessError.message}), so no recipient could be checked and nothing was sent.`,
      );
    }
    const now = this.now();
    const liveIds = new Set(
      ((access ?? []) as Array<{
        user_id: string;
        is_active?: boolean | null;
        valid_from?: string | null;
        valid_until?: string | null;
      }>)
        .filter((r) => isLiveMembership(r, now))
        .map((r) => String(r.user_id)),
    );

    if (liveIds.size > 0) {
      const { data: members, error: membersError } = await this.db.supabase
        .from("users")
        .select("user_id, email")
        .in("user_id", [...liveIds]);
      if (membersError) {
        throw new ServiceUnavailableException(
          `This house's members could not be read (${membersError.message}), so no recipient could be checked and nothing was sent.`,
        );
      }
      for (const m of (members ?? []) as Array<{
        user_id: string;
        email?: string | null;
      }>) {
        if (m.email) {
          book.set(norm(m.email), { kind: "member", providerId: null });
        }
      }
    }

    // --- the vendor book -----------------------------------------------------
    let vendors: Awaited<ReturnType<HouseLettersService["book"]>>;
    try {
      vendors = await this.letters.book(restaurantId);
    } catch (e: any) {
      const words =
        e instanceof HttpException
          ? String((e.getResponse() as any)?.message ?? e.message)
          : String(e?.message ?? e);
      throw new ServiceUnavailableException(
        `${words} No recipient could be checked, so nothing was sent.`,
      );
    }
    for (const v of vendors) {
      const key = norm(v.email);
      // A member entry wins: the same person is not re-labelled a vendor.
      if (!book.has(key)) {
        book.set(key, { kind: "vendor_contact", providerId: v.providerId });
      }
    }

    return book;
  }

  /** The clock the membership window and the refusal collapse read. */
  protected now(): number {
    return Date.now();
  }

  /**
   * A refusal row, collapsed per (person, house, refusal kind) inside
   * `REFUSAL_AUDIT_WINDOW_MS`. A repeat inside the window is COUNTED, logged at
   * debug, and carried as `suppressedRepeats` on the next row written for the
   * same key. Never throws.
   */
  private async auditRefusal(
    userId: string,
    restaurantId: string,
    refusal: "role" | "recipient_not_in_book",
    reason: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    const now = this.now();
    const key = `${userId}|${restaurantId}|${refusal}`;
    const open = this.refusalAudits.get(key);
    if (open && now - open.writtenAt < REFUSAL_AUDIT_WINDOW_MS) {
      open.suppressed += 1;
      this.logger.debug(
        `HOUSE_EMAIL_REFUSAL_COLLAPSED house=${restaurantId} actor=${userId} refusal=${refusal} repeats=${open.suppressed}`,
      );
      return;
    }

    if (this.refusalAudits.size >= REFUSAL_AUDIT_MAX_KEYS) {
      for (const [k, w] of this.refusalAudits) {
        if (now - w.writtenAt >= REFUSAL_AUDIT_WINDOW_MS) {
          this.refusalAudits.delete(k);
        }
      }
    }

    const suppressedRepeats = open?.suppressed ?? 0;
    const written = await this.audit(
      userId,
      restaurantId,
      "house_email_refused",
      reason,
      {
        refusal,
        ...changes,
        ...(suppressedRepeats > 0 ? { suppressedRepeats } : {}),
      },
    );
    if (written) {
      this.refusalAudits.set(key, { writtenAt: now, suppressed: 0 });
    } else if (open) {
      // Nothing was written, so the repeats are still owed to the next row.
      open.suppressed = suppressedRepeats;
    }
  }

  /** One audit row. Returns whether it was written; never throws. */
  private async audit(
    userId: string,
    restaurantId: string,
    action: "house_email_sent" | "house_email_refused" | "house_email_failed",
    reason: string,
    changes: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const { error } = await this.db.supabase.from("system_audit_log").insert({
        actor_type: "user",
        actor_id: userId,
        action,
        entity_type: "house_email",
        entity_id: null,
        restaurant_id: restaurantId,
        reason,
        changes: { route: "POST /notifications/send-email", ...changes },
      });
      if (error) {
        this.logger.error(
          `HOUSE_EMAIL_AUDIT_UNWRITTEN house=${restaurantId} actor=${userId} action=${action}: ${error.message}`,
        );
        return false;
      }
      return true;
    } catch (e: any) {
      this.logger.error(
        `HOUSE_EMAIL_AUDIT_UNWRITTEN house=${restaurantId} actor=${userId} action=${action}: ${e?.message}`,
      );
      return false;
    }
  }
}

/** Trimmed, non-empty, first spelling kept, case-insensitive duplicates dropped. */
function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const a = raw.trim();
    if (!a || seen.has(norm(a))) continue;
    seen.add(norm(a));
    out.push(a);
  }
  return out;
}
