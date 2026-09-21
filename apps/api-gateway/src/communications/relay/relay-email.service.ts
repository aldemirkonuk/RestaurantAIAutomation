/**
 * `POST /communications/email` — what each door may send, and the record every
 * send leaves (ADR 0149 #19, 2026-09-16; ADR 0147 "Named and not fixed").
 *
 * WHAT THIS CLOSES
 * ----------------
 * ADR 0084 (2026-09-02) wrote the route down as an open relay: `@Body()` only,
 * no tenant, no check on the destination, no record. ADR 0099 gave it a caller
 * identity (the `X-Admin-Key` service key) and nothing else — a holder of that
 * key could still send any HTML to any address on the internet from the
 * deployment's verified sender, for no house, and leave no trace. The founder's
 * answer was *"Two doors, both locked"*:
 *
 *   ORCHESTRATOR (service key). The send names the house, the vendor, and the
 *     conversation or order it is for. Each is checked against the rows: the
 *     conversation and the order must be that house's, the conversation must be
 *     with that vendor, and EVERY recipient (to, cc, bcc) must be one of that
 *     vendor's addresses in the house's book (`HouseLettersService.book`, the
 *     one definition of "a vendor contact of this house" — ADR 0118).
 *
 *   PERSON (JWT). An owner or manager of the session's house — resolved from
 *     the database for THAT house (`OrganizationsService.readRestaurantRole`,
 *     which says 503 when the role cannot be read rather than "no role"), not
 *     from the token's snapshot. Recipients are limited to the house's members
 *     and its vendors' contacts. Raw HTML from a person is refused, and a
 *     letter to a vendor runs the house-letter guardrails that transfer to a
 *     human draft (commitment language, an unfilled merge field).
 *
 *     THEN IT QUEUES THROUGH THE HOUSE'S OWN CONNECTED MAILBOX, NAMING THE
 *     PERSON AS AUTHOR (founder, 2026-09-17; superseding, the SAME day, first
 *     the adversarial review's 409 and then this door's own immediate send).
 *     Every check above still refuses first; what changed is the last step,
 *     twice. The route never sends from the deployment's shared mailbox —
 *     ADR 0118 D1 still rules that out — so it resolves the SAME sending
 *     identity the letters composer already uses (`HouseSenderService.resolve`,
 *     the `gmail_send` grant). The FIRST answer had it send immediately
 *     through that identity. The review that followed found the collision:
 *     `GET /communications/letters/sender` already promises every send from
 *     that mailbox a server-side 2-minute undo window (ADR 0118 D2,
 *     `identity.ceremony`/`identity.undoMs`/`identity.words`,
 *     house-sender.service.ts:405-413) — a promise an immediate send from this
 *     door broke. The founder's SECOND answer, later the same day: *"the
 *     person door QUEUES like every other send from the house's own
 *     mailbox"*. So it does — a `relay_email_queue` row
 *     (`status: "HOUSE_QUEUED"`, `scheduled_send_at = now + identity.undoMs`),
 *     cancellable at `POST /communications/email/:id/cancel` until then,
 *     dispatched by `RelayEmailCron` once a minute (`dispatchQueued`, below),
 *     which RE-RESOLVES the identity and sends through `HouseLettersService`'s
 *     own `sendThroughGrant` — never trusting a grant or token captured at
 *     queue time, which could have expired or been revoked (ADR 0114) in the
 *     two minutes between. The already-signed text (the person's words plus
 *     the `— {name}` author line) is what a manager approved and what leaves;
 *     it is not re-derived at dispatch time. When the house has none —
 *     `kind: "none"` or a failed read, `"unknown"` — the door still refuses to
 *     queue, with that resolver's own sentence (never a bare, unexplained 409)
 *     and a `code` a caller can render without parsing prose:
 *     `HOUSE_MAILBOX_NOT_CONNECTED`. `relay_email_queue` is door-agnostic and
 *     a sibling of `procurement_conversations`' own `HOUSE_QUEUED` rows (the
 *     letters composer's queue), not the same table — that table's
 *     `provider_id` is `NOT NULL`, and this door also reaches a house's own
 *     members, with no vendor at all (migration
 *     20260921110000_a_persons_mail_queues_like_the_houses_own.sql explains
 *     why at length).
 *
 * THE RECORD
 * ----------
 * `system_audit_log`, which already exists (baseline 20260805000000:5553), has
 * RLS on, has a nullable un-keyed `actor_id` and a `correlation_id`, and is
 * already read by `/logs` for the house.
 *
 *   relay_email_queued     the person door's queue row was written (never a
 *                          send). Its `correlation_id` is the SAME id the
 *                          `relay_email_queue` row itself carries, so the two
 *                          following rows below — written later, by the
 *                          dispatcher — read as one story, not three.
 *   relay_email_attempted  written BEFORE the provider is called. It is the
 *                          gate: if it cannot be written, nothing is sent (503).
 *                          A send that happened with no row naming it is the
 *                          fault this closes, so the paper comes first. On the
 *                          orchestrator's door this follows the POST directly;
 *                          on the person door it follows minutes later, from
 *                          `dispatchQueued`, once the undo window has closed.
 *   relay_email_sent       the provider accepted it (message and thread ids).
 *   relay_email_failed     the provider refused or threw (the error, verbatim),
 *                          or — person door only — the sending identity was no
 *                          longer usable when the dispatcher re-resolved it.
 *   relay_email_refused    a door refused it (the reason). Best-effort, and only
 *                          where a house is known.
 *   relay_email_unavailable a check could not be made — a read failed (5xx).
 *                          An outage is not a refusal, so it is not filed as one.
 *
 * WHAT A REFUSAL ROW CARRIES depends on who was refused. An owner or manager's
 * refusal records the recipients, subject and ids they sent. A caller NOT shown
 * to be one (staff, no role, or a role that could not be read) gets a row with
 * the status and the gateway's own reason and nothing they typed — otherwise
 * any member could write subjects and addresses of their choosing into the
 * house's /logs.
 *
 * All rows of one send share `correlation_id`. The outcome row is written after
 * the send and NEVER throws — undoing a delivered message is not possible, so a
 * failed outcome write is logged loudly and returned as
 * `audit.outcomeRecorded: false` rather than turned into a 500 that would tell
 * the caller the mail did not go.
 *
 * `actor_id` is `public.users.user_id` (the id the JWT carries; `auth.users` is
 * disjoint) on the person door, and NULL with `actor_type = 'service'` and
 * `changes.actor = 'orchestrator'` on the service door.
 *
 * NAMED AND NOT CHECKED
 * ---------------------
 * `threadId`, `inReplyTo` and `references` are not ownership-checked. They
 * decide where a message files in the deployment's own mailbox and how a mail
 * client threads it; they cannot add a recipient. What they COULD do — carry a
 * line break into the MIME header block and add a `Bcc:` — is refused by the
 * DTO (`SINGLE_HEADER_LINE`, communication.dto.ts).
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../../database/database.service";
import { GmailService } from "../gmail.service";
import {
  HouseLettersService,
  sameAddress,
  sendThroughGrant,
} from "../letters/house-letters.service";
import { HouseSenderService } from "../letters/house-sender.service";
import { houseActor, type TokenUser } from "../letters/house-letters.actor";
import { MimeHeaderError } from "../mime-headers";
import {
  OrganizationsService,
  RestaurantRoleUnreadableError,
} from "../../organizations/organizations.service";
import { roleSatisfies } from "../../procurement/order-approval-gate";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import type { IntegrationId } from "../../integrations/integrations-oauth.constants";
import type { SendEmailDto } from "../dto/communication.dto";
import type { RelayDoor } from "./relay-door.guard";

export const RELAY_AUDIT_ACTIONS = {
  QUEUED: "relay_email_queued",
  ATTEMPTED: "relay_email_attempted",
  SENT: "relay_email_sent",
  FAILED: "relay_email_failed",
  REFUSED: "relay_email_refused",
  UNAVAILABLE: "relay_email_unavailable",
} as const;

/** `letter` rows in `communication_templates` (house-letters.service.ts). */
const LETTER_TEMPLATE_TYPE = "letter";

/** The lifecycle words `relay_email_queue.status` owns — see the migration's
 *  own column comment for the transitions. Mirrors `LETTER_STATUS`
 *  (house-letters.service.ts) in shape but is NOT that table: a query must
 *  never assume the two share rows. */
export const RELAY_QUEUE_STATUS = {
  QUEUED: "HOUSE_QUEUED",
  SENDING: "HOUSE_SENDING",
  CANCELLED: "HOUSE_CANCELLED",
  FAILED: "HOUSE_FAILED",
  SENT: "SENT",
} as const;

/**
 * The person door's refusal code when this house has no connected mailbox
 * (`HouseSenderService.resolve` returned `sendable: false`, whether that is
 * `kind: "none"` — nobody has consented — or `kind: "unknown"` — the read
 * failed). The sentence itself always comes from `identity.words`, which
 * already states the two cases in different, honest words (ADR 0051 clause
 * 3: "unknown" is not "none"); this constant is only the machine-readable
 * half, so a caller does not have to parse prose to show "connect your
 * mailbox" versus "try again". Exported so the spec asserts the code.
 */
export const HOUSE_MAILBOX_NOT_CONNECTED = "house_mailbox_not_connected";

/** What a refusal row may carry — see "WHAT A REFUSAL ROW CARRIES" above. */
type RefusalDetail = "full" | "status_only";

export interface RelayResult {
  /** For a queued person-door send, `success` means "queued", not "sent" —
   *  read `queued` (present) versus `messageId` (absent) to tell the two
   *  apart. HTTP-level: the controller answers 202 when `queued` is present,
   *  200 otherwise. */
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
  /**
   * `true` only when `success` is `false` AND the failure is a header refusal
   * (ADR 0172's `MimeHeaderError`, thrown by `mime-headers.ts` before any
   * provider call) rather than a transport failure — GmailService/
   * `sendThroughGrant` never called the provider, so nothing left the
   * process. `sendAsOrchestrator` reads this to answer 422 rather than 200
   * (founder, 2026-09-21: "a header refusal on the relay path answers a
   * FINAL 422 — not 200 success:false — so both send paths behave alike").
   * Typed, never inferred from `error`'s text (PR #405's own rule: classify
   * by fields, not strings).
   */
  refusedBeforeSend?: boolean;
  channel: "email";
  door: RelayDoor;
  /** Populated only on the person door: which mailbox it sent (or will send)
   *  from and who it named as the author. Absent on the service door, which
   *  sends the HTML it is given from the deployment's own mailbox and names
   *  nobody. */
  sender?: {
    kind: string;
    address: string | null;
    authorName: string | null;
  };
  /** Present only on a person-door send that queued rather than sent
   *  (`RelayEmailService.sendAsPerson`). `says` is `identity.words` verbatim
   *  — the SAME sentence `GET /communications/letters/sender` already shows,
   *  so this response never promises a recall that sentence does not, or
   *  fails to promise one it does. */
  queued?: {
    id: string;
    status: "HOUSE_QUEUED";
    dispatchAt: string;
    undoMs: number;
    says: string;
  };
  audit: {
    correlationId: string;
    /** `false` only for a queued send: nothing has been attempted with a
     *  provider yet, so there is no attempt gate to have passed. `true` on
     *  every path that reaches (or reached) `dispatch()`. */
    attemptRecorded: boolean;
    outcomeRecorded: boolean;
  };
}

interface SendPlan {
  door: RelayDoor;
  restaurantId: string;
  actorUserId: string | null;
  providerId: string | null;
  conversationId: string | null;
  orderId: string | null;
  templateId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  subject: string;
  html: string;
  text: string | undefined;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

type Row = Record<string, unknown>;

@Injectable()
export class RelayEmailService {
  private readonly logger = new Logger(RelayEmailService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly gmail: GmailService,
    private readonly letters: HouseLettersService,
    private readonly organizations: OrganizationsService,
    /** ADR 0118's sending identity — the same resolver the letters composer
     *  uses, so the person door's mailbox answer never disagrees with the
     *  composer's own sender line. */
    private readonly sender: HouseSenderService,
    /** `getAccessToken` is the one door ADR 0114's house-revocation check
     *  runs behind (house-letters.service.ts:390-409 does the same call for
     *  the same reason). */
    private readonly oauth: IntegrationsOauthService,
  ) {}

  // ==========================================================================
  // The orchestrator's door
  // ==========================================================================

  async sendAsOrchestrator(dto: SendEmailDto): Promise<RelayResult> {
    const restaurantId = dto.restaurantId ?? null;
    const providerId = dto.providerId ?? null;
    const conversationId = dto.conversationId ?? null;
    const orderId = dto.orderId ?? null;

    if (!restaurantId || !providerId || (!conversationId && !orderId)) {
      const missing = [
        !restaurantId && "the house (restaurantId)",
        !providerId && "the vendor (providerId)",
        !conversationId && !orderId && "the conversation or order (conversationId or orderId)",
      ].filter(Boolean);
      // No audit row: without a house there is nowhere to file it, and the
      // refusal is the whole of what happened.
      throw new ForbiddenException(
        `A service send must name what it is for, and this one does not name ${missing.join(", ")}. The service key proves who is calling, not which house the mail belongs to. Nothing was sent.`,
      );
    }

    const base = {
      door: "orchestrator" as const,
      restaurantId,
      actorUserId: null,
      providerId,
      conversationId,
      orderId,
      templateId: dto.templateId ?? null,
    };

    try {
      if (!dto.bodyHtml) {
        throw new BadRequestException(
          "The service door sends the HTML it is given, and this request carries no bodyHtml. Nothing was sent.",
        );
      }

      await this.assertConversationAndOrder({
        restaurantId,
        providerId,
        conversationId,
        orderId,
      });

      const vendorAddresses = await this.vendorAddresses(restaurantId, providerId);
      if (vendorAddresses.length === 0) {
        throw new ForbiddenException(
          `Vendor ${providerId} has no address in this house's book — it is not one of this house's vendors, or it has no contact address on record. Nothing was sent.`,
        );
      }
      this.assertRecipients(
        dto,
        vendorAddresses,
        `that vendor's addresses in this house's book (${vendorAddresses.join(", ")})`,
      );
      await this.assertReplyTo(restaurantId, dto.replyTo);
    } catch (err) {
      await this.recordRefusal(base, dto, err);
      throw err;
    }

    const result = await this.dispatch({
      ...base,
      ...this.addresses(dto),
      subject: dto.subject,
      html: dto.bodyHtml,
      text: dto.bodyText,
      threadId: dto.threadId,
      inReplyTo: dto.inReplyTo,
      references: dto.references,
    });

    // Founder, 2026-09-21: "a header refusal on the relay path answers a
    // FINAL 422 (not 200 success:false), so both send paths behave alike and
    // the draft closes with the reason shown." `dispatch()` already wrote the
    // ATTEMPTED and FAILED rows (with `refusedBeforeSend: true` on the
    // latter) before returning — this only decides what the HTTP RESPONSE
    // says, the same way `sendAsPerson`'s guardrail refusal already answers
    // 422 rather than a 200 carrying `success: false`. The orchestrator's own
    // `_relay_final_refusal_code` (provider_conversation_agent.py) then reads
    // this 422 through the SAME "gateway refused the send: HTTP {code}"
    // string the 400/403/422 door refusals already produce, so a header
    // refusal closes the draft exactly like any other structural one.
    if (!result.success && result.refusedBeforeSend) {
      // Every `MimeHeaderError` sentence already ends in a full stop
      // (mime-headers.ts), so drop it before appending ours — this text is
      // stored on the draft verbatim and shown to a manager.
      const said = (
        result.error ?? "the provider refused to build this message"
      ).replace(/\.\s*$/, "");
      throw new UnprocessableEntityException(
        `${said}. Nothing was sent — the provider was never called. Fix the header named above and try again.`,
      );
    }
    return result;
  }

  // ==========================================================================
  // The person's door
  // ==========================================================================

  async sendAsPerson(
    user: TokenUser | null | undefined,
    dto: SendEmailDto,
  ): Promise<RelayResult> {
    // 401 with no person; 400 with no active house (house-letters.actor.ts).
    const { userId, restaurantId } = houseActor(user);

    const base = {
      door: "person" as const,
      restaurantId,
      actorUserId: userId,
      providerId: dto.providerId ?? null,
      conversationId: dto.conversationId ?? null,
      orderId: dto.orderId ?? null,
      templateId: dto.templateId ?? null,
    };

    // Until the role is read and is owner or manager, a refusal row carries
    // the status and the gateway's own reason — nothing this caller typed.
    let detail: RefusalDetail = "status_only";
    try {
      // JwtAuthGuard's tenant match already refuses this; stated again here so
      // a caller that reaches the service another way cannot name a house.
      if (dto.restaurantId && dto.restaurantId !== restaurantId) {
        throw new ForbiddenException(
          "This request names a different house from the one this session is signed in to. Mail is sent only for the session's own house. Nothing was sent.",
        );
      }

      let role: string | null;
      try {
        role = await this.organizations.readRestaurantRole(userId, restaurantId);
      } catch (err) {
        if (!(err instanceof RestaurantRoleUnreadableError)) throw err;
        throw new ServiceUnavailableException(
          `Your role at this house could not be read: ${err.message}. Whether you may send from it is unknown, not refused. Nothing was sent.`,
        );
      }
      if (!roleSatisfies(role, "manager")) {
        throw new ForbiddenException(
          `Only an owner or a manager of this house may send mail from it. ${
            role
              ? `You are signed in as ${role} at this house`
              : "This session holds no role at this house"
          }, so nothing was sent.`,
        );
      }
      detail = "full";

      if (dto.bodyHtml !== undefined) {
        throw new ForbiddenException(
          "Raw HTML is accepted only on the service door. A person's mail is the words they wrote, in bodyText. Nothing was sent.",
        );
      }
      const text = (dto.bodyText ?? "").trim();
      if (!text) {
        throw new BadRequestException(
          "This mail has no words: bodyText is empty. Nothing was sent.",
        );
      }

      if (base.templateId) {
        await this.assertLetterTemplate(restaurantId, base.templateId);
      }
      if (base.conversationId || base.orderId) {
        await this.assertConversationAndOrder({
          restaurantId,
          providerId: base.providerId,
          conversationId: base.conversationId,
          orderId: base.orderId,
        });
      }

      const book = await this.readBook(restaurantId);
      if (
        base.providerId &&
        !book.some((e) => e.providerId === base.providerId)
      ) {
        throw new ForbiddenException(
          `Vendor ${base.providerId} has no address in this house's book, so it is not a vendor this house can write to. Nothing was sent.`,
        );
      }
      const vendorAddresses = book.map((e) => e.email);
      const memberAddresses = await this.memberAddresses(restaurantId);
      this.assertRecipients(
        dto,
        [...vendorAddresses, ...memberAddresses],
        "this house's members and its vendors' contacts",
      );
      await this.assertReplyTo(restaurantId, dto.replyTo, memberAddresses);

      const writesToVendor = this.recipientsOf(dto).some((r) =>
        vendorAddresses.some((v) => sameAddress(v, r)),
      );
      if (writesToVendor) {
        const blocking = this.letters
          .guardrails({ body: text, subject: dto.subject, priorOutboundOnOrder: null })
          .filter((h) => h.blocking);
        if (blocking.length > 0) {
          throw new UnprocessableEntityException({
            message: `${blocking.map((h) => h.says).join(" ")} Nothing was sent.`,
            guardrails: blocking,
          });
        }
      }

      // Every lock ADR 0149 #19 decided has held. What was left — which
      // mailbox a person's mail leaves from — is the founder's answer of
      // 2026-09-17: the SAME identity the letters composer already resolves
      // (ADR 0118), never the deployment's shared one.
      const identity = await this.sender.resolve(restaurantId, userId);
      if (!identity.sendable || !identity.grant || identity.undoMs == null) {
        // `identity.undoMs` is structurally `number | null`
        // (`HouseSenderIdentity`) because the subdomain ("seal" ceremony) and
        // "none" kinds carry no undo window at all — but both of those are
        // already refused by `!identity.grant` above, since only the house's
        // own connected mailbox ("undo" ceremony) ever returns a grant. This
        // arm is therefore unreachable today; it exists so a future kind that
        // is `sendable` with a `grant` but no window is refused rather than
        // silently queued with `scheduled_send_at = NaN`.
        throw new ConflictException({
          message: `${identity.words} Nothing was sent.`,
          code: HOUSE_MAILBOX_NOT_CONNECTED,
        });
      }

      // ADR 0114: a manager may cut the house off from a member's grant
      // without touching the member's own credential. Same door house-letters
      // queues behind (house-letters.service.ts:390-409); a ForbiddenException
      // from it is that cutoff, not an unknown failure, and is rethrown as-is.
      // The token itself is discarded — queuing needs no token, only proof
      // that sending is usable RIGHT NOW, so this house is told immediately
      // rather than two minutes later when the dispatcher discovers the same
      // thing. `dispatchQueued` fetches its own fresh token at send time
      // regardless, never trusting this one to still be good then.
      try {
        await this.oauth.getAccessToken(
          identity.grant.personUserId,
          restaurantId,
          identity.grant.integrationId as IntegrationId,
        );
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new ConflictException(
          `The mailbox this house sends from could not be used: ${message} Nothing was sent.`,
        );
      }

      // Name the author. The grant that carries this mail may belong to a
      // different member than the one who wrote it (`resolve` prefers the
      // asker's own grant but falls back to the house's first live one), and
      // the recipient sees only the grant's mailbox in the envelope — so the
      // words themselves say who wrote them. Never invented: a nameless
      // lookup sends the person's own words unsigned rather than guess. The
      // signed text is what is queued — what a manager approved when they hit
      // send is exactly what leaves; it is not re-derived at dispatch time.
      const authorName = await this.actorName(userId);
      const signedText = authorName ? `${text}\n\n— ${authorName}` : text;

      return this.queueForHouse({
        base,
        dto,
        // Rebuilt as a literal, field by field, rather than passing `identity`
        // through whole: `identity` is typed `HouseSenderIdentity`, where
        // `undoMs: number | null`, and passing the OBJECT rather than the
        // narrowed EXPRESSION `identity.undoMs` would lose the guard's
        // narrowing (the guard above already ruled out `null` for this call).
        identity: {
          kind: identity.kind,
          address: identity.address,
          undoMs: identity.undoMs,
          words: identity.words,
        },
        authorName,
        signedText,
      });
    } catch (err) {
      await this.recordRefusal(base, dto, err, detail);
      throw err;
    }
  }

  /**
   * Queue a person-door send exactly the way ADR 0118 D2 already promises
   * every send from this mailbox behaves — a row, not a timer (`dispatchDue`'s
   * own reasoning, house-letters.cron.ts: a `setTimeout` in the request's
   * process is a promise the process cannot keep across a deploy or a crash).
   * `RelayEmailCron.run` -> `dispatchQueued` (below) sends it once
   * `scheduled_send_at` has passed; `POST /communications/email/:id/cancel`
   * (`cancelQueued`, below) pulls it back before then.
   *
   * The row IS the record: unlike an immediate send, queuing is fully
   * reversible on this side, so a failed audit-log write here does not risk
   * an unaudited send the way `dispatch()`'s ATTEMPTED gate exists to prevent
   * — it is written best-effort, after the row, the same way the SENT/FAILED
   * outcome row is.
   */
  private async queueForHouse(params: {
    base: Pick<
      SendPlan,
      | "door"
      | "restaurantId"
      | "actorUserId"
      | "providerId"
      | "conversationId"
      | "orderId"
      | "templateId"
    >;
    dto: SendEmailDto;
    identity: { kind: string; address: string | null; undoMs: number; words: string };
    authorName: string | null;
    signedText: string;
  }): Promise<RelayResult> {
    const { base, dto, identity, authorName, signedText } = params;
    const addr = this.addresses(dto);
    const correlationId = `relay-email:${randomUUID()}`;
    const queueId = randomUUID();
    const dispatchAt = new Date(Date.now() + identity.undoMs).toISOString();

    const { error } = await this.db.client.from("relay_email_queue").insert({
      id: queueId,
      restaurant_id: base.restaurantId,
      actor_user_id: base.actorUserId,
      provider_id: base.providerId,
      conversation_id: base.conversationId,
      order_id: base.orderId,
      template_id: base.templateId,
      to_addresses: addr.to,
      cc_addresses: addr.cc,
      bcc_addresses: addr.bcc,
      reply_to: addr.replyTo,
      subject: dto.subject,
      body_text: signedText,
      thread_id: dto.threadId ?? null,
      in_reply_to: dto.inReplyTo ?? null,
      mail_references: dto.references ?? null,
      sender_kind: identity.kind,
      sender_address: identity.address,
      author_name: authorName,
      status: RELAY_QUEUE_STATUS.QUEUED,
      scheduled_send_at: dispatchAt,
      correlation_id: correlationId,
    });

    if (error) {
      throw new ServiceUnavailableException(
        `The mail was NOT queued and NOT sent — the send queue refused the row (${error.message}). Nothing was sent.`,
      );
    }

    const sender = { kind: identity.kind, address: identity.address, authorName };
    const outcomeRecorded = await this.insertBestEffort(
      this.auditRow(
        { ...base, ...addr, subject: dto.subject },
        RELAY_AUDIT_ACTIONS.QUEUED,
        correlationId,
        { outcome: "queued", queueId, dispatchAt, sender },
      ),
      `the queued outcome of ${correlationId}`,
    );

    return {
      success: true,
      channel: "email",
      door: "person",
      sender,
      queued: {
        id: queueId,
        status: RELAY_QUEUE_STATUS.QUEUED,
        dispatchAt,
        undoMs: identity.undoMs,
        says: identity.words,
      },
      audit: { correlationId, attemptRecorded: false, outcomeRecorded },
    };
  }

  // ==========================================================================
  // The send, between its two rows
  // ==========================================================================

  /**
   * `send` is the transport: it returns the ids on success or throws on
   * failure (both branches below are already built to catch a throw, since
   * the previous single caller — GmailService — could itself throw as well
   * as return `{success:false}`; the default arm below folds that shape into
   * the same "throws on failure" contract so this function has one). Defaults
   * to the deployment's own mailbox, which is all the orchestrator's door
   * ever used before the person door existed. `extraAudit` is merged into
   * every row this send writes — the person door uses it to name which
   * mailbox and author the send carried, without this function needing to
   * know that concept exists. `correlationId` defaults to a fresh one — the
   * orchestrator's door and the person door's queue-time refusal path both
   * want that — but `dispatchQueued` passes the QUEUE ROW's own id, so
   * `relay_email_queued` and the attempt/outcome rows it produces later read
   * as one story sharing one id, never three unrelated ones.
   */
  private async dispatch(
    plan: SendPlan,
    send: (
      plan: SendPlan,
    ) => Promise<{ messageId?: string; threadId?: string }> = (p) =>
      this.sendThroughDeploymentMailbox(p),
    extraAudit: Record<string, unknown> = {},
    correlationId: string = `relay-email:${randomUUID()}`,
  ): Promise<RelayResult> {

    const { error: gateError } = await this.db.client
      .from("system_audit_log")
      .insert(this.auditRow(plan, RELAY_AUDIT_ACTIONS.ATTEMPTED, correlationId, {
        outcome: "attempting",
        ...extraAudit,
      }));
    if (gateError) {
      this.logger.error(
        `relay: the attempt row could not be written for house ${plan.restaurantId} (${gateError.message}); refusing to send.`,
      );
      throw new ServiceUnavailableException(
        `The audit row for this send could not be written (${gateError.message}), and a send with no record is what this route no longer allows. Nothing was sent.`,
      );
    }

    let messageId: string | undefined;
    let threadId: string | undefined;
    let error: string | undefined;
    let success = false;
    // `MimeHeaderError` (ADR 0172): the encoder refused to build the message
    // — no provider was ever called, so this proves non-delivery the same
    // way a pre-transport door refusal does. Set from a typed `instanceof`
    // check, never from `error`'s text (PR #405's rule). Both transports can
    // throw it: `GmailService.sendEmail` catches it internally and this class
    // re-throws it (`sendThroughDeploymentMailbox`, below) to keep one
    // detection point here; `sendThroughGrant` (the person door's transport)
    // throws it directly, uncaught, already.
    let refusedBeforeSend = false;
    try {
      const result = await send(plan);
      success = true;
      messageId = result.messageId;
      threadId = result.threadId;
    } catch (err) {
      success = false;
      error = err instanceof Error ? err.message : String(err);
      refusedBeforeSend = err instanceof MimeHeaderError;
    }

    const outcomeRecorded = await this.insertBestEffort(
      this.auditRow(
        plan,
        success ? RELAY_AUDIT_ACTIONS.SENT : RELAY_AUDIT_ACTIONS.FAILED,
        correlationId,
        success
          ? { outcome: "sent", messageId: messageId ?? null, threadId: threadId ?? null, ...extraAudit }
          : { outcome: "failed", error, refusedBeforeSend, ...extraAudit },
        success ? null : (error ?? null),
      ),
      `the ${success ? "sent" : "failed"} outcome of ${correlationId}`,
    );

    return {
      success,
      messageId,
      threadId,
      error,
      ...(refusedBeforeSend ? { refusedBeforeSend } : {}),
      channel: "email",
      door: plan.door,
      ...(extraAudit.sender
        ? { sender: extraAudit.sender as RelayResult["sender"] }
        : {}),
      audit: { correlationId, attemptRecorded: true, outcomeRecorded },
    };
  }

  /** The orchestrator's transport, and the person door's before 2026-09-17:
   *  the deployment's own shared mailbox, via GmailService. */
  private async sendThroughDeploymentMailbox(
    plan: SendPlan,
  ): Promise<{ messageId?: string; threadId?: string }> {
    const result = await this.gmail.sendEmail({
      to: plan.to,
      cc: plan.cc.length ? plan.cc : undefined,
      bcc: plan.bcc.length ? plan.bcc : undefined,
      subject: plan.subject,
      html: plan.html,
      text: plan.text,
      replyTo: plan.replyTo ?? undefined,
      threadId: plan.threadId,
      inReplyTo: plan.inReplyTo,
      references: plan.references,
    });
    if (result.success !== true) {
      // ADR 0172: `GmailService.sendEmail` catches `MimeHeaderError` itself
      // and reports it as `refusedBeforeSend` rather than letting it
      // propagate — re-throw the SAME typed error here so `dispatch()`'s
      // catch can tell "the provider refused" (a transport failure) apart
      // from "we never called the provider" (a header refusal) without
      // parsing `result.error`'s text.
      if (result.refusedBeforeSend) {
        throw new MimeHeaderError(
          result.error ?? "the provider reported no reason",
        );
      }
      throw new Error(result.error ?? "the provider reported no reason");
    }
    return { messageId: result.messageId, threadId: result.threadId };
  }

  /**
   * The person door's transport since 2026-09-17: the house's own connected
   * mailbox, via the SAME `sendThroughGrant` the letters composer's
   * dispatcher uses (house-letters.service.ts) — deliberately not
   * `GmailService`, which is built on the deployment's shared sender.
   */
  private async sendThroughHouseGrant(
    plan: SendPlan,
    token: string,
    from: string,
  ): Promise<{ messageId?: string; threadId?: string }> {
    const messageId = await sendThroughGrant({
      token,
      from,
      to: plan.to,
      cc: plan.cc,
      bcc: plan.bcc,
      subject: plan.subject,
      text: plan.text ?? "",
      replyTo: plan.replyTo ?? undefined,
      threadId: plan.threadId,
      inReplyTo: plan.inReplyTo,
      references: plan.references,
    });
    // sendThroughGrant reports only the new message's id: Gmail's own
    // response threadId is not read (mirrors dispatchDue, which stores
    // gmail_message_id and nothing else). A continued thread still reports
    // the threadId the caller supplied; a fresh one reports none rather than
    // guess at what Gmail assigned.
    return { messageId: messageId ?? undefined, threadId: plan.threadId };
  }

  /**
   * The acting person's display name, for the author line on a person-door
   * send. Never invents (mirrors HouseSenderService.personName, private
   * there and so re-declared rather than reused), but — unlike that
   * mirror — it is not permitted to swallow a failed read: that mirror's
   * caller degrades to a *stated* fallback ("another member of this
   * house"); this caller's fallback is silence, so a read that failed
   * cannot look the same as a row that is genuinely nameless. `error` and a
   * thrown read are the same fact every sibling read on this path already
   * surfaces as 503 (`readRestaurantRole`, `readBook`, `memberAddresses`,
   * `assertConversationAndOrder`, `assertLetterTemplate`) — only a row
   * that was read successfully and truly has no name returns null.
   */
  private async actorName(userId: string): Promise<string | null> {
    let data: Record<string, unknown> | null;
    try {
      const result = await this.db.client
        .from("users")
        .select("name")
        .eq("user_id", userId)
        .maybeSingle();
      if (result.error) {
        throw new ServiceUnavailableException(
          `Who this mail is from could not be read: ${result.error.message}. Nothing was sent.`,
        );
      }
      data = result.data as Record<string, unknown> | null;
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Who this mail is from could not be read: ${message}. Nothing was sent.`,
      );
    }
    if (!data) return null;
    const name = data.name;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  }

  // ==========================================================================
  // The person door's queue — dispatch and undo
  // ==========================================================================

  /**
   * Send every queued person-door mail whose undo window has closed.
   *
   * Called by `RelayEmailCron` once a minute — same shape as
   * `HouseLettersService.dispatchDue` (a cron reading rows, never a
   * `setTimeout` in the request's process, for the reason stated at the top
   * of house-letters.cron.ts: a deploy or a crash inside the window must not
   * silently drop a queued send). Reuses `dispatch()` for the actual send so
   * a queued send gets EXACTLY the same `relay_email_attempted` /
   * `_sent` / `_failed` audit trail an immediate send gets — sharing the
   * queue row's OWN `correlation_id`, never a fresh one, so `relay_email_queued`
   * and what follows it read as one story in `/logs`.
   *
   * The sending identity is RE-RESOLVED from `actor_user_id` here, never
   * trusted from what `sendAsPerson` denormalised at queue time: the minutes
   * between queuing and dispatch are exactly the window in which a grant
   * could be revoked (ADR 0114) or the house could disconnect its mailbox
   * entirely. `extraAudit.sender` still uses the row's own denormalised
   * kind/address/author, which is a description of what was PROMISED at
   * queue time and is what belongs on the paper trail either way.
   */
  async dispatchQueued(nowMs = Date.now()): Promise<{
    considered: number;
    sent: number;
    failed: number;
    skipped: number;
    /** A row whose SENT/HOUSE_FAILED write itself could not be made, so the
     *  row is stuck HOUSE_SENDING regardless of what the provider did. Never
     *  folded into `sent` or `failed` — a stuck row proves neither. See the
     *  loop's own comment on why this is not silently discarded. */
    statusUpdateErrors: number;
  }> {
    const { data, error } = await this.db.client
      .from("relay_email_queue")
      .select(
        "id, restaurant_id, actor_user_id, provider_id, conversation_id, order_id, template_id, to_addresses, cc_addresses, bcc_addresses, reply_to, subject, body_text, thread_id, in_reply_to, mail_references, sender_kind, sender_address, author_name, correlation_id",
      )
      .eq("status", RELAY_QUEUE_STATUS.QUEUED)
      .lte("scheduled_send_at", new Date(nowMs).toISOString())
      .limit(50);

    if (error) {
      // Thrown, never returned as the zero-shape: `{ considered: 0, ... }` is
      // what a quiet minute looks like, and an unreadable queue reported that
      // way reads as "nothing was due" for as long as the outage lasts.
      // `RelayEmailCron.run` logs it and records it as `lastRun().error`.
      // ADR 0161 — the same rule `HouseLettersService.dispatchDue` follows.
      throw new Error(
        `relay queue dispatch could not read what is due: ${error.message}`,
      );
    }

    const rows = (data ?? []) as unknown as Row[];
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let statusUpdateErrors = 0;

    for (const row of rows) {
      const id = String(row.id);

      // Claim the row first. Two dispatcher ticks — or two gateway instances
      // — must never both send it.
      const { data: claimed, error: claimError } = await this.db.client
        .from("relay_email_queue")
        .update({ status: RELAY_QUEUE_STATUS.SENDING })
        .eq("id", id)
        .eq("status", RELAY_QUEUE_STATUS.QUEUED)
        .select("id");
      if (claimError || !claimed || (claimed as unknown[]).length === 0) {
        skipped += 1;
        continue;
      }

      const correlationId = String(row.correlation_id);
      const plan: SendPlan = {
        door: "person",
        restaurantId: String(row.restaurant_id),
        actorUserId: String(row.actor_user_id),
        providerId: (row.provider_id as string | null) ?? null,
        conversationId: (row.conversation_id as string | null) ?? null,
        orderId: (row.order_id as string | null) ?? null,
        templateId: (row.template_id as string | null) ?? null,
        to: ((row.to_addresses as string[] | null) ?? []) as string[],
        cc: ((row.cc_addresses as string[] | null) ?? []) as string[],
        bcc: ((row.bcc_addresses as string[] | null) ?? []) as string[],
        replyTo: (row.reply_to as string | null) ?? null,
        subject: String(row.subject ?? ""),
        html: "",
        text: String(row.body_text ?? ""),
        threadId: (row.thread_id as string | undefined) ?? undefined,
        inReplyTo: (row.in_reply_to as string | undefined) ?? undefined,
        references: (row.mail_references as string | undefined) ?? undefined,
      };
      const sender = {
        kind: (row.sender_kind as string | null) ?? "house_mailbox",
        address: (row.sender_address as string | null) ?? null,
        authorName: (row.author_name as string | null) ?? null,
      };

      let result: RelayResult;
      try {
        result = await this.dispatch(
          plan,
          async (p) => {
            const identity = await this.sender.resolve(
              p.restaurantId,
              p.actorUserId as string,
            );
            if (!identity.sendable || !identity.grant) {
              throw new Error(identity.words);
            }
            const token = await this.oauth.getAccessToken(
              identity.grant.personUserId,
              p.restaurantId,
              identity.grant.integrationId as IntegrationId,
            );
            const fromAddress =
              identity.address ?? identity.grant.accountEmail ?? "";
            return this.sendThroughHouseGrant(p, token, fromAddress);
          },
          { sender },
          correlationId,
        );
      } catch (err) {
        // dispatch()'s own gate — the ATTEMPTED row — could not be written.
        // A send with no record is exactly what this route refuses to allow,
        // so nothing was attempted; recorded on the queue row as failed
        // rather than left HOUSE_SENDING forever.
        const message = err instanceof Error ? err.message : String(err);
        result = {
          success: false,
          error: message,
          channel: "email",
          door: "person",
          audit: { correlationId, attemptRecorded: false, outcomeRecorded: false },
        };
      }

      if (result.success) {
        // Not a bare `await`: a failed write here would leave a row the
        // provider genuinely sent stuck HOUSE_SENDING forever, and the row's
        // own comment (this migration's header) says that must never happen
        // silently. `sent` counts a ROW moved to SENT, never a provider
        // response alone — the two can now disagree, and only the row's own
        // state may be trusted by anything reading this table afterward.
        const { error: statusError } = await this.db.client
          .from("relay_email_queue")
          .update({
            status: RELAY_QUEUE_STATUS.SENT,
            sent_at: new Date().toISOString(),
            gmail_message_id: result.messageId ?? null,
            scheduled_send_at: null,
          })
          .eq("id", id);
        if (statusError) {
          statusUpdateErrors += 1;
          this.logger.error(
            `queued mail ${id} was sent through the provider, but its row could not be moved to SENT (${statusError.message}); it is stuck HOUSE_SENDING and must not be read as a clean send until this is corrected by hand.`,
          );
        } else {
          sent += 1;
        }
      } else {
        this.logger.error(`queued mail ${id} was not sent: ${result.error}`);
        const { error: statusError } = await this.db.client
          .from("relay_email_queue")
          .update({
            status: RELAY_QUEUE_STATUS.FAILED,
            failure_reason: result.error ?? "unknown",
            scheduled_send_at: null,
          })
          .eq("id", id);
        if (statusError) {
          statusUpdateErrors += 1;
          this.logger.error(
            `queued mail ${id}'s failure could also not be recorded (${statusError.message}); it is stuck HOUSE_SENDING rather than HOUSE_FAILED.`,
          );
        } else {
          failed += 1;
        }
      }
    }

    return { considered: rows.length, sent, failed, skipped, statusUpdateErrors };
  }

  /**
   * Pull a queued person-door send back before it leaves — the same recall
   * `GET /communications/letters/sender` promises for every send from this
   * mailbox (ADR 0118 D2), applied to `relay_email_queue` the way
   * `HouseLettersService.cancel` applies it to `procurement_conversations`.
   * Only a row still `HOUSE_QUEUED` and still before its `scheduled_send_at`
   * may move; a row the dispatcher may already hold (`HOUSE_SENDING`) or has
   * already finished (`SENT`/`HOUSE_FAILED`) is refused rather than marked
   * cancelled, because "cancelled" would then be a claim about a send that
   * already happened.
   *
   * Author-only (founder, 2026-09-18, ADR 0149 row 43 — "only author is the
   * best option"): the row's own `actor_user_id` is who queued it, and only
   * that person may pull it back. A pooled inbox other owners could also
   * cancel from was raised in the same answer and recorded as a direction,
   * not built — see `.planning/06-pages/communications.md`'s relay section.
   */
  async cancelQueued(params: {
    restaurantId: string;
    userId: string;
    id: string;
  }): Promise<{ id: string; status: string; says: string }> {
    const { data, error } = await this.db.client
      .from("relay_email_queue")
      .select("id, status, scheduled_send_at, restaurant_id, actor_user_id")
      .eq("id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .maybeSingle();

    if (error) {
      throw new ServiceUnavailableException(
        `That send could not be read (${error.message}), so it was NOT cancelled. Check what /communications/email queued before assuming it was stopped.`,
      );
    }
    if (!data) {
      throw new NotFoundException("No such queued send in this house.");
    }

    const row = data as Row;
    if (String(row.actor_user_id) !== params.userId) {
      throw new ForbiddenException(
        "Only the person who queued this send can pull it back. Ask them to cancel it, or let it go and follow up once it has left.",
      );
    }
    if (String(row.status) !== RELAY_QUEUE_STATUS.QUEUED) {
      throw new ConflictException(
        `That send is "${String(row.status)}", not queued, so it was not cancelled. Only a send still inside its window can be pulled back.`,
      );
    }
    const due = row.scheduled_send_at
      ? new Date(String(row.scheduled_send_at)).getTime()
      : 0;
    if (due <= Date.now()) {
      throw new ConflictException(
        "That send's window has closed and the dispatcher may already hold it, so it was NOT cancelled. What it did will show on the house's own record.",
      );
    }

    // `.select("id")` so a row the dispatcher claimed between the read above
    // and this update — HOUSE_QUEUED -> HOUSE_SENDING, the same race
    // `dispatchQueued`'s own claim step guards against from the other side —
    // is not silently reported as pulled back. Zero rows means the guard
    // (`status = HOUSE_QUEUED`) matched nothing, which the read above cannot
    // rule out: it is a snapshot, not a lock.
    const { data: cancelled, error: updateError } = await this.db.client
      .from("relay_email_queue")
      .update({ status: RELAY_QUEUE_STATUS.CANCELLED, scheduled_send_at: null })
      .eq("id", params.id)
      .eq("status", RELAY_QUEUE_STATUS.QUEUED)
      .select("id");

    if (updateError) {
      throw new BadRequestException(
        `That send was NOT cancelled (${updateError.message}). It is still queued.`,
      );
    }
    if (!cancelled || (cancelled as unknown[]).length === 0) {
      throw new ConflictException(
        "That send was claimed by the dispatcher the instant before this reached it, so it was NOT cancelled. What it did will show on the house's own record.",
      );
    }

    return {
      id: params.id,
      status: RELAY_QUEUE_STATUS.CANCELLED,
      says: "Pulled back. It was never sent, and the record shows it as cancelled rather than deleted.",
    };
  }

  // ==========================================================================
  // Checks
  // ==========================================================================

  /** The conversation and order must be this house's; the conversation, this vendor's. */
  private async assertConversationAndOrder(p: {
    restaurantId: string;
    providerId: string | null;
    conversationId: string | null;
    orderId: string | null;
  }): Promise<void> {
    if (p.conversationId) {
      const { data, error } = await this.db.client
        .from("procurement_conversations")
        .select("id, restaurant_id, provider_id, order_id")
        .eq("id", p.conversationId)
        .maybeSingle();
      if (error) {
        throw new ServiceUnavailableException(
          `The conversation could not be read (${error.message}), so it could not be shown to be this house's. Nothing was sent.`,
        );
      }
      const row = data as Row | null;
      if (!row || row.restaurant_id !== p.restaurantId) {
        throw new ForbiddenException(
          `Conversation ${p.conversationId} is not one of this house's conversations. Nothing was sent.`,
        );
      }
      if (p.providerId && row.provider_id !== p.providerId) {
        throw new ForbiddenException(
          `Conversation ${p.conversationId} is with a different vendor from the one this mail names. Nothing was sent.`,
        );
      }
      if (p.orderId && row.order_id && row.order_id !== p.orderId) {
        throw new ForbiddenException(
          `Conversation ${p.conversationId} belongs to a different order from the one this mail names. Nothing was sent.`,
        );
      }
    }

    if (p.orderId) {
      const { data, error } = await this.db.client
        .from("procurement_orders")
        .select("id, restaurant_id, provider_id")
        .eq("id", p.orderId)
        .maybeSingle();
      if (error) {
        throw new ServiceUnavailableException(
          `The order could not be read (${error.message}), so it could not be shown to be this house's. Nothing was sent.`,
        );
      }
      const row = data as Row | null;
      if (!row || row.restaurant_id !== p.restaurantId) {
        throw new ForbiddenException(
          `Order ${p.orderId} is not one of this house's orders. Nothing was sent.`,
        );
      }
      // Checked after the house, so another house's order still gets the
      // house's sentence and no hint of whose vendor it is. Without this an
      // order-only send could file its audit row against another vendor's
      // order (procurement_orders.provider_id is NOT NULL, baseline :4519).
      if (p.providerId && row.provider_id !== p.providerId) {
        throw new ForbiddenException(
          `Order ${p.orderId} is with a different vendor from the one this mail names. Nothing was sent.`,
        );
      }
    }
  }

  private async assertLetterTemplate(
    restaurantId: string,
    templateId: string,
  ): Promise<void> {
    const { data, error } = await this.db.client
      .from("communication_templates")
      .select("id")
      .eq("id", templateId)
      .eq("restaurant_id", restaurantId)
      .eq("type", LETTER_TEMPLATE_TYPE)
      .maybeSingle();
    if (error) {
      throw new ServiceUnavailableException(
        `The letter template could not be read (${error.message}). Nothing was sent.`,
      );
    }
    if (!data) {
      throw new ForbiddenException(
        `Template ${templateId} is not one of this house's letter templates. Nothing was sent.`,
      );
    }
  }

  private async readBook(restaurantId: string) {
    try {
      return await this.letters.book(restaurantId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `${message} A recipient cannot be checked against a book that could not be read, so nothing was sent.`,
      );
    }
  }

  private async vendorAddresses(
    restaurantId: string,
    providerId: string,
  ): Promise<string[]> {
    const book = await this.readBook(restaurantId);
    return book.filter((e) => e.providerId === providerId).map((e) => e.email);
  }

  /**
   * The addresses of the people who belong to this house: active
   * `user_restaurant_access` rows, plus the legacy `users.restaurant_id` home
   * that `MembersService.assertMembership` also accepts. A failed read throws —
   * an unreadable roster is not an empty one, and reading it as empty would
   * refuse every member while saying they are not members.
   */
  private async memberAddresses(restaurantId: string): Promise<string[]> {
    const { data: access, error: accessError } = await this.db.client
      .from("user_restaurant_access")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);
    if (accessError) {
      throw new ServiceUnavailableException(
        `This house's members could not be read (${accessError.message}). Nothing was sent.`,
      );
    }
    const ids = Array.from(
      new Set(((access ?? []) as Row[]).map((r) => String(r.user_id))),
    );

    const addresses: string[] = [];
    if (ids.length > 0) {
      const { data: people, error: peopleError } = await this.db.client
        .from("users")
        .select("user_id, email")
        .in("user_id", ids);
      if (peopleError) {
        throw new ServiceUnavailableException(
          `This house's members' addresses could not be read (${peopleError.message}). Nothing was sent.`,
        );
      }
      for (const p of (people ?? []) as Row[]) {
        if (typeof p.email === "string" && p.email) addresses.push(p.email);
      }
    }

    const { data: legacy, error: legacyError } = await this.db.client
      .from("users")
      .select("user_id, email")
      .eq("restaurant_id", restaurantId);
    if (legacyError) {
      throw new ServiceUnavailableException(
        `This house's members' addresses could not be read (${legacyError.message}). Nothing was sent.`,
      );
    }
    for (const p of (legacy ?? []) as Row[]) {
      if (typeof p.email === "string" && p.email) addresses.push(p.email);
    }
    return addresses;
  }

  private recipientsOf(dto: SendEmailDto): string[] {
    return [...(dto.to ?? []), ...(dto.cc ?? []), ...(dto.bcc ?? [])];
  }

  private assertRecipients(
    dto: SendEmailDto,
    allowed: string[],
    allowedWords: string,
  ): void {
    const foreign = this.recipientsOf(dto).filter(
      (r) => !allowed.some((a) => sameAddress(a, r)),
    );
    if (foreign.length > 0) {
      const unique = Array.from(new Set(foreign.map((f) => f.trim().toLowerCase())));
      throw new ForbiddenException(
        `${unique.join(", ")} ${unique.length === 1 ? "is" : "are"} not among ${allowedWords}. This route sends only to addresses the house has on record. Nothing was sent.`,
      );
    }
  }

  /**
   * Reply-To is not a recipient, but it decides where the vendor's answer goes.
   * It may name the deployment's own sender or a member of the house — never an
   * outside address, which would route a vendor's reply (prices, order details)
   * to whoever typed it.
   */
  private async assertReplyTo(
    restaurantId: string,
    replyTo: string | undefined,
    knownMembers?: string[],
  ): Promise<void> {
    if (!replyTo) return;
    const sender = this.gmail.getSenderEmail?.();
    if (sender && sameAddress(sender, replyTo)) return;
    const members = knownMembers ?? (await this.memberAddresses(restaurantId));
    if (members.some((m) => sameAddress(m, replyTo))) return;
    throw new ForbiddenException(
      `Reply-To ${replyTo} is neither this deployment's sender nor a member of this house, so a vendor's answer would go somewhere this house has no record of. Nothing was sent.`,
    );
  }

  // ==========================================================================
  // The paper
  // ==========================================================================

  private addresses(dto: SendEmailDto) {
    return {
      to: dto.to,
      cc: dto.cc ?? [],
      bcc: dto.bcc ?? [],
      replyTo: dto.replyTo ?? null,
    };
  }

  private auditRow(
    plan: Pick<
      SendPlan,
      | "door"
      | "restaurantId"
      | "actorUserId"
      | "providerId"
      | "conversationId"
      | "orderId"
      | "templateId"
      | "to"
      | "cc"
      | "bcc"
      | "replyTo"
      | "subject"
    >,
    action: string,
    correlationId: string | null,
    extra: Record<string, unknown>,
    reason: string | null = null,
    detail: RefusalDetail = "full",
  ): Row {
    if (detail === "status_only") {
      return {
        actor_type: plan.door === "orchestrator" ? "service" : "user",
        actor_id: plan.actorUserId,
        action,
        entity_type: "email",
        entity_id: null,
        restaurant_id: plan.restaurantId,
        correlation_id: correlationId,
        reason,
        changes: {
          door: plan.door,
          actor: plan.door === "orchestrator" ? "orchestrator" : plan.actorUserId,
          ...extra,
        },
      };
    }
    const entity = plan.conversationId
      ? { type: "procurement_conversation", id: plan.conversationId }
      : plan.orderId
        ? { type: "procurement_order", id: plan.orderId }
        : plan.providerId
          ? { type: "provider", id: plan.providerId }
          : { type: "email", id: null };
    return {
      actor_type: plan.door === "orchestrator" ? "service" : "user",
      actor_id: plan.actorUserId,
      action,
      entity_type: entity.type,
      entity_id: entity.id,
      restaurant_id: plan.restaurantId,
      correlation_id: correlationId,
      reason,
      changes: {
        door: plan.door,
        actor: plan.door === "orchestrator" ? "orchestrator" : plan.actorUserId,
        recipients: { to: plan.to, cc: plan.cc, bcc: plan.bcc },
        replyTo: plan.replyTo,
        subject: plan.subject,
        templateId: plan.templateId,
        providerId: plan.providerId,
        conversationId: plan.conversationId,
        orderId: plan.orderId,
        ...extra,
      },
    };
  }

  /**
   * A refusal is filed where a house is known. Never throws, never masks the
   * refusal. A 5xx — or anything thrown that is not an HTTP answer — is an
   * outage, filed as `relay_email_unavailable`, never as a refusal.
   */
  private async recordRefusal(
    base: Pick<
      SendPlan,
      | "door"
      | "restaurantId"
      | "actorUserId"
      | "providerId"
      | "conversationId"
      | "orderId"
      | "templateId"
    >,
    dto: SendEmailDto,
    err: unknown,
    detail: RefusalDetail = "full",
  ): Promise<void> {
    const status = err instanceof HttpException ? err.getStatus() : null;
    const reason =
      err instanceof HttpException
        ? flattenMessage(err.getResponse())
        : err instanceof Error
          ? err.message
          : String(err);
    const unavailable = status === null || status >= 500;
    await this.insertBestEffort(
      this.auditRow(
        { ...base, ...this.addresses(dto), subject: dto.subject },
        unavailable ? RELAY_AUDIT_ACTIONS.UNAVAILABLE : RELAY_AUDIT_ACTIONS.REFUSED,
        null,
        { outcome: unavailable ? "unavailable" : "refused", status },
        reason,
        detail,
      ),
      `a ${status ?? "thrown"} ${unavailable ? "outage" : "refusal"} for house ${base.restaurantId}`,
    );
  }

  private async insertBestEffort(row: Row, what: string): Promise<boolean> {
    try {
      const { error } = await this.db.client.from("system_audit_log").insert(row);
      if (error) {
        this.logger.error(`relay: could not record ${what}: ${error.message}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.error(
        `relay: recording ${what} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}

function flattenMessage(response: unknown): string {
  if (typeof response === "string") return response;
  const message = (response as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join("; ");
  return typeof message === "string" ? message : JSON.stringify(response);
}
