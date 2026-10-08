/**
 * The house's own letters — queued, cancellable, dispatched, and never claimed
 * until they have actually left (ADR 0118, ADR 0083, ADR 0020).
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not the vendor-reply AI. That path drafts, guards and (only when a
 * literal stored `true` says so) auto-sends, and nothing here changes any of
 * it. This is a manager writing a letter by hand, and every step is a human's.
 *
 * It is not `POST /communications/email` either. That route is `@Public()`
 * behind a `ServiceKeyGuard`, carries no tenant and writes no conversation row
 * (communications.controller.ts:207-228, and its own header says so). A browser
 * must never reach it.
 *
 * THE REFUSALS, IN THIS ORDER
 * ---------------------------
 * The order is load-bearing, not incidental: each refusal must be reachable on
 * its own, so a caller can be told the one true reason rather than the first
 * reason that happens to be checkable.
 *
 *   0. the letter names no writer              → 401, before anything is read
 *      (`email_headers.written_by` is how the dispatcher finds the writer's
 *      own mailbox; a row without it names nobody)
 *   1. the recipient is not in the book        → 422
 *   2. the draft trips a guardrail             → 422, with the sentence
 *   3. this house has no sending identity      → 409
 *   4. the house has cut itself off from the
 *      grant that identity rests on (ADR 0114) → 403, from the token path
 *
 * (1) and (2) come before (3) deliberately. When this was written no house
 * could have a sending identity at all, so checking (3) first would have made
 * (1) and (2) unreachable and untestable — the shape of a system that reports
 * absence as health. As of 2026-09-04 a house CAN have one (the `gmail_send`
 * integration; ADR 0118), and the order still stands for the same reason: most
 * houses will not have consented yet, and the ones that have deserve to be told
 * their letter is off-book or trips a guardrail rather than being handed the
 * one refusal that happens to be checkable first.
 *
 * WHAT IS RECORDED
 * ----------------
 * One `procurement_conversations` row per letter: `ai_generated: false`,
 * `outbound_email_type: 'HOUSE_LETTER'` (the value migration
 * 20260904150000 adds), the subject and recipient in `email_headers`, and —
 * new — `inserted_insights`, the rule key and computed-at of every engine
 * sentence the letter carried. That row is in the same table the AI path reads,
 * so a letter written by hand against an ORDER is counted by that path's
 * `max_rounds` guardrail (`inbound-responder.service.ts:248` counts outbound
 * rows for `order_id`) instead of being invisible to it. A letter with no order
 * is not counted there, because there is no thread for it to be a round of.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import {
  VendorSendAuthorityService,
  type SendOrAsk,
} from "../../organizations/vendor-send-authority.service";
import {
  VendorSendRequestsService,
  type VendorSendRequestView,
} from "../../organizations/vendor-send-requests.service";
import { assertNamedActor } from "./house-letters.actor";
import { composerGuardrails, type GuardrailHit } from "./composer-guardrails";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import type { IntegrationId } from "../../integrations/integrations-oauth.constants";
import { HouseSenderService } from "./house-sender.service";
import { composeCreditLetter } from "./credit-letter";
import {
  addressListHeader,
  base64Body,
  threadingHeader,
  unstructuredHeader,
} from "../mime-headers";
import type {
  InsertedInsightDto,
  QueueLetterDto,
  UpsertLetterTemplateDto,
} from "./house-letters.dto";
import { createHash } from "node:crypto";
import {
  DEFAULT_ORDER_REQUEST_TEMPLATES,
  ORDER_REQUEST_TEMPLATE_KEY,
  ORDER_REQUEST_TOKENS,
  RENDERER_VERSION,
  houseLocale,
  orderRequestProseRefusals,
  renderOrderRequest,
  type OrderRequestFacts,
  type OrderRequestLocale,
  type ProseRefusal,
} from "./order-request-letter";

/**
 * The act a composer letter is sealed as (ADR 0175 D9; 2026-09-21). Its own
 * act, over its own subject kind (`house_letter`, keyed on the VENDOR it is
 * written to — there is no letter row until the seal is redeemed), so a seal
 * minted for any other send can never queue a composer letter.
 */
export const HOUSE_LETTER_ACT = "queue_house_letter";

/** What the hold was over: the recipient, the vendor, the subject and the words. */
export function houseLetterSealArgs(dto: {
  providerId: string;
  to: string;
  subject: string;
  body: string;
  orderId?: string | null;
}): Record<string, unknown> {
  return {
    providerId: dto.providerId,
    to: (dto.to ?? "").trim().toLowerCase(),
    subject: (dto.subject ?? "").replace(/\s+/g, " ").trim(),
    body: (dto.body ?? "").replace(/\s+/g, " ").trim(),
    orderId: dto.orderId ?? null,
  };
}

/** The lifecycle words this path owns. Chosen so no other cron can claim them. */
export const LETTER_STATUS = {
  /**
   * Written by Mudavym, decided by nobody yet (ADR 0230). A credit claim moved
   * to `requested` leaves one of these; it becomes QUEUED only when a person
   * sends it from the composer. No cron selects this word — the dispatcher
   * reads QUEUED alone — so a draft cannot leave on its own.
   */
  DRAFT: "HOUSE_DRAFT",
  QUEUED: "HOUSE_QUEUED",
  CANCELLED: "HOUSE_CANCELLED",
  FAILED: "HOUSE_FAILED",
  SENT: "SENT",
} as const;

const OWNER_MANAGER_ROLES = new Set(["owner", "manager"]);

/** The role ADR 0167 already admits to a credit claim's own figures. */
function isOwnerOrManager(role: string | null | undefined): boolean {
  return (
    typeof role === "string" && OWNER_MANAGER_ROLES.has(role.toLowerCase())
  );
}

/**
 * `processScheduledAutoSends` in `procurement.service.ts` selects on the literal
 * `status = 'AUTO_SEND_SCHEDULED'`. A house letter must never wear that word, or
 * the AI's cron would dispatch a human's letter through the deployment mailbox —
 * precisely what this build exists to stop.
 *
 * CITED BY STRING, NOT BY LINE (corrected 2026-09-04). The header used to name
 * `procurement.service.ts:3739,3755,3951`; on this tree the string is at 269,
 * 4221, 4237, 4433, 4544 and 5006, and it moved again while this note was being
 * written. `grep -n "AUTO_SEND_SCHEDULED" apps/api-gateway/src/procurement/
 * procurement.service.ts` is the citation, because a line number in a file two
 * other builders are editing is a claim with a shelf life of hours.
 */
export const AI_ONLY_STATUS = "AUTO_SEND_SCHEDULED";

/**
 * The vendor purposes. A staff broadcast is deliberately not one.
 *
 * `order_request` is the sixth (ADR 0266 F5, ADR 0313): the house's one order
 * letter, rendered around fact blocks by order-request-letter.ts. Unlike the
 * five composer purposes it is owner or manager only, checked against the
 * STORED purpose of an edited row, and its words reach a vendor only once
 * previewed and published as a version (letter_template_versions). The five
 * keep their roles (ADR 0313, guard scope R2).
 */
export const LETTER_CATEGORIES = [
  "order_confirmation",
  "price_query",
  "delivery_dispute",
  "invoice_mismatch",
  "promotion_reply",
  "order_request",
] as const;

/**
 * The purposes the composer and the template library offer: the five, never
 * the order letter. The order letter is written by Mudavym around the house's
 * published prose (ADR 0313), so a person never picks it for a hand-written
 * letter, and its row is edited only through its own panel
 * (GET templates/order-request), where the draft, versions and publish live.
 */
export const COMPOSER_LETTER_CATEGORIES = LETTER_CATEGORIES.filter(
  (c) => c !== "order_request",
);

/** Who may change the order letter (ADR 0313 R2; 0173 D4's editors). */
export const ORDER_LETTER_EDITORS = ["owner", "manager"] as const;

/**
 * Refuses anyone but an owner or a manager. `role` is the role in the house
 * the token names (ADR 0162); null, absent and anything else are refused.
 */
export function assertOrderLetterEditor(role: string | null | undefined): void {
  if (!(ORDER_LETTER_EDITORS as readonly string[]).includes(String(role ?? ""))) {
    throw new ForbiddenException(
      "Only an owner or a manager may change the house's order letter (ADR 0313). Nothing was saved.",
    );
  }
}

/** sha256 hex of a letter body, as letter_template_versions.body_hash holds it. */
export function letterBodyHash(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * The hash a preview answers and a publish must bring back: the renderer, the
 * language and the words. A draft saved after the preview, a preview in the
 * other language, or a renderer bumped in between all fail to match.
 */
export function orderLetterPreviewHash(body: string, locale: OrderRequestLocale): string {
  return createHash("sha256")
    .update(JSON.stringify([RENDERER_VERSION, locale, body]), "utf8")
    .digest("hex");
}

/** The example order a preview renders: a priced owner order and an unpriced one. */
function previewFacts(
  houseName: string,
  locale: OrderRequestLocale,
  priced: boolean,
): OrderRequestFacts {
  return {
    orderId: "preview",
    orderNumber: "PO-1042",
    houseName,
    vendorFirstName: locale === "tr" ? "Ayşe" : "Sam",
    lines: [
      {
        name: locale === "tr" ? "Örnek şarap" : "Example wine",
        vendorSku: "EX-75",
        quantity: 3,
        unit: "case",
        bottlesPerUnit: 6,
        price: priced
          ? { amount: 25, currency: locale === "tr" ? "TRY" : "USD", uom: "bottle", packSize: null }
          : null,
      },
    ],
    placer: priced
      ? { userId: "preview", name: locale === "tr" ? "Deniz" : "Alex", role: "owner" }
      : { userId: null, name: null, role: null },
    deliverTo: null,
    neededBy: null,
    paymentTerms: null,
    locale,
  };
}

function refusalSentence(refusals: ProseRefusal[]): string {
  return refusals.map((r) => r.says).join(" ");
}

export type LetterCategory = (typeof LETTER_CATEGORIES)[number];

/** `type` on `communication_templates`, so a letter template never collides
 *  with the legacy email/sms workshop rows or with `sender_identity`
 *  (procurement.service.ts:2697-2703 filters on that last one). */
export const LETTER_TEMPLATE_TYPE = "letter";

export type { GuardrailHit } from "./composer-guardrails";

/** A claim's letter, as the credits lane shows it (ADR 0230). */
export interface CreditLetterRef {
  id: string;
  status: string;
  to: string | null;
  sentAt: string | null;
  createdAt: string | null;
}

/** What asking a vendor for a credit did to the letter book (ADR 0230). */
export interface CreditLetter {
  state: "drafted" | "drafted_no_address" | "no_vendor" | "existing" | "failed";
  id: string | null;
  to: string | null;
  says: string;
}

export interface BookEntry {
  providerId: string;
  providerName: string;
  contactName: string | null;
  email: string;
  source: "provider" | "contact";
}

@Injectable()
export class HouseLettersService {
  private readonly logger = new Logger(HouseLettersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly sender: HouseSenderService,
    private readonly oauth: IntegrationsOauthService,
    // The composer's two gates (ADR 0175 D9/D10, 2026-09-21). Last and
    // @Optional for the positional specs; CommunicationsModule supplies both,
    // and `queue` REFUSES when either is missing.
    @Optional() private readonly authority?: VendorSendAuthorityService,
    @Optional() private readonly seal?: SealChallengeService,
    // Staff ask a manager to send a letter (founder answer 3, 2026-09-21).
    // Supplied by VendorSendAuthorityModule; the ask route refuses without it.
    @Optional() private readonly requests?: VendorSendRequestsService,
  ) {}

  private requireGates(): { authority: VendorSendAuthorityService; seal: SealChallengeService } {
    if (!this.authority || !this.seal) {
      throw new InternalServerErrorException(
        "Who may send, or the seal, could not be checked (not wired into the composer), so nothing was queued and nothing was sent. This is a gateway fault, not a decision about this letter.",
      );
    }
    return { authority: this.authority, seal: this.seal };
  }

  /**
   * Whether this person's hold on the composer sends — the readout the sheet
   * shows BEFORE the click. Since the founder's answer (3) of 2026-09-21 a
   * staff member may ASK a manager to send a composer letter, so "ask" says
   * the letter will be kept and a manager asked (`ask`, below).
   */
  async sendOrAsk(userId: string, restaurantId: string): Promise<SendOrAsk> {
    if (!this.authority) {
      return {
        readable: false,
        maySend: false,
        mode: null,
        basis: null,
        grant: null,
        sentence: "Whether your hold sends could not be read (not wired into the composer). Nothing will be sent until it can.",
      };
    }
    return this.authority.readout(userId, restaurantId, { canAsk: true });
  }

  /**
   * A staff member asks a manager to send this letter (founder answer 3,
   * 2026-09-21: *"the same request flow as drafted replies (request state,
   * exact text/terms saved, manager releases with one hold)"*).
   *
   * The letter is checked the way a send would check it — the recipient must
   * be in the book and no guardrail may block — so a manager is never asked to
   * release a letter the queue would refuse. Nothing is queued and nothing is
   * sent: the exact letter is saved (`vendor_send_requests`), the owners and
   * managers are told on the bell, and the release is the ordinary sealed
   * queue with this request's id (`queue`, `dto.requestId`), which keeps the
   * composer's undo window.
   */
  async ask(params: {
    restaurantId: string;
    userId: string;
    dto: QueueLetterDto;
  }): Promise<{ requestId: string; requestedAt: string; told: number; says: string; notices: GuardrailHit[] }> {
    const { restaurantId, dto } = params;
    const userId = assertNamedActor(params.userId, "asked and nothing was sent");
    if (!this.requests) {
      throw new InternalServerErrorException(
        "Requests could not be recorded (not wired into the composer), so nothing was asked and nothing was sent.",
      );
    }
    if (dto.requestId) {
      throw new BadRequestException("A request cannot name another request. Nothing was asked.");
    }
    const { match, hits } = await this.checkLetter(restaurantId, dto);
    const letter = {
      providerId: dto.providerId,
      to: match.email,
      subject: dto.subject,
      body: dto.body,
      orderId: dto.orderId ?? null,
      templateId: dto.templateId ?? null,
    };
    const row = await this.requests.ask({
      userId,
      restaurantId,
      kind: "house_letter",
      orderId: dto.orderId ?? null,
      providerId: dto.providerId,
      payload: letter,
      sealArgs: houseLetterSealArgs({ ...dto, to: match.email }),
      act: "send this letter",
    });
    const told = await this.requests.tellManagers({
      restaurantId,
      requesterId: userId,
      kind: "house_letter",
      vendorName: match.providerName,
      requestId: row.id,
      orderId: dto.orderId ?? null,
    });
    return {
      requestId: row.id,
      requestedAt: row.requested_at,
      told,
      notices: hits.filter((h) => !h.blocking),
      says:
        told > 0
          ? `Asked. Your letter is saved exactly as you wrote it, and ${told} ${told === 1 ? "owner or manager was" : "owners and managers were"} told. Nothing has been sent; you will see who sends it.`
          : "Asked. Your letter is saved exactly as you wrote it, but no owner or manager could be told; tell one yourself. Nothing has been sent.",
    };
  }

  /**
   * The letters waiting for a manager. An owner or a manager sees every one
   * waiting in the house (they release them); anyone else sees only their own.
   */
  async requestsFor(
    userId: string,
    restaurantId: string,
  ): Promise<{
    requests: VendorSendRequestView[];
    /** Who is reading: an owner or a manager may decline; anyone may withdraw their own (founder, 2026-09-21). */
    viewer: { userId: string; mayDecline: boolean };
  }> {
    if (!this.requests || !this.authority) {
      throw new InternalServerErrorException("The waiting letters could not be read (not wired into the composer).");
    }
    const reading = await this.authority.standing(userId, restaurantId);
    const role = (reading.role ?? "").trim().toLowerCase();
    const releaser = role === "owner" || role === "manager";
    return {
      requests: await this.requests.waiting(restaurantId, "house_letter", releaser ? {} : { requestedBy: userId }),
      viewer: { userId, mayDecline: releaser },
    };
  }

  /**
   * An owner or a manager declines a waiting letter request, saying why; the
   * person who asked is told (founder, 2026-09-21: *"Decline/withdraw; undo
   * re-waits"*). Nothing is sent.
   */
  async declineRequest(params: {
    restaurantId: string;
    userId: string;
    requestId: string;
    reason: string;
  }): Promise<{ id: string; state: string; says: string }> {
    const userId = assertNamedActor(params.userId, "declined");
    if (!this.requests) {
      throw new InternalServerErrorException("Requests could not be changed (not wired into the composer). Nothing was changed.");
    }
    const row = await this.requests.decline({
      restaurantId: params.restaurantId,
      requestId: params.requestId,
      kind: "house_letter",
      userId,
      reason: params.reason,
    });
    return {
      id: row.id,
      state: row.state,
      says: "Declined. The person who asked was told why, and nothing was sent.",
    };
  }

  /** The person who asked withdraws their own waiting letter request; the owners and managers are told. */
  async withdrawRequest(params: {
    restaurantId: string;
    userId: string;
    requestId: string;
  }): Promise<{ id: string; state: string; says: string }> {
    const userId = assertNamedActor(params.userId, "withdrawn");
    if (!this.requests) {
      throw new InternalServerErrorException("Requests could not be changed (not wired into the composer). Nothing was changed.");
    }
    const row = await this.requests.withdraw({
      restaurantId: params.restaurantId,
      requestId: params.requestId,
      kind: "house_letter",
      userId,
    });
    return {
      id: row.id,
      state: row.state,
      says: "Withdrawn. It no longer waits for a manager, and nothing was sent.",
    };
  }

  /**
   * The two checks a letter must pass before anyone holds on it: its
   * recipient is in the book for its vendor, and no guardrail blocks it.
   * Shared by the send and the ask, so the two cannot disagree.
   */
  private async checkLetter(
    restaurantId: string,
    dto: QueueLetterDto,
  ): Promise<{ match: BookEntry; hits: GuardrailHit[]; priorOutbound: number | null }> {
    const book = await this.book(restaurantId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `${message} Nothing was queued and nothing was sent — a recipient cannot be checked against a book that could not be read.`,
      );
    });
    const forProvider = book.filter((e) => e.providerId === dto.providerId);
    if (forProvider.length === 0) {
      throw new UnprocessableEntityException(
        `That vendor has no address in this house's book, so there is nowhere to send. Add the contact to the vendor first (POST /providers/${dto.providerId}/contacts) — an address typed into a letter is not a vendor record, and the guardrails, the round count and the conversation book all key on the record.`,
      );
    }
    const match = forProvider.find((e) => sameAddress(e.email, dto.to));
    if (!match) {
      throw new UnprocessableEntityException(
        `${dto.to} is not in this house's book for that vendor. The addresses on record are: ${forProvider.map((e) => e.email).join(", ")}. Add it to the book first — Mudavym does not write to an address it has no record of.`,
      );
    }
    const priorOutbound = dto.orderId ? await this.countOutboundOnOrder(dto.orderId) : null;
    const hits = this.guardrails({
      body: dto.body,
      subject: dto.subject,
      priorOutboundOnOrder: priorOutbound,
    });
    const blocking = hits.filter((h) => h.blocking);
    if (blocking.length > 0) {
      throw new UnprocessableEntityException({
        message: blocking.map((h) => h.says).join(" "),
        guardrails: blocking,
      });
    }
    return { match, hits, priorOutbound };
  }

  /**
   * Mint the seal a composer letter must carry back (the house composer door,
   * sealed 2026-09-21 on the judge's finding that every composer recipient is
   * a vendor in the book). WHO first; then a seal over the letter as it stands.
   */
  async issueQueueSeal(params: {
    restaurantId: string;
    userId: string;
    dto: QueueLetterDto;
  }): Promise<{ challenge: string; expiresAt: string; act: string }> {
    const userId = assertNamedActor(params.userId, "sealed and nothing was sent");
    const { authority, seal } = this.requireGates();
    await authority.assertMaySend(userId, params.restaurantId, "send this letter", { canAsk: true });
    const issued = await seal.issue({
      restaurantId: params.restaurantId,
      actorUserId: userId,
      subjectKind: "house_letter",
      subjectId: params.dto.providerId,
      action: HOUSE_LETTER_ACT,
      args: houseLetterSealArgs(params.dto),
    });
    return { challenge: issued.challenge, expiresAt: issued.expiresAt, act: issued.action };
  }

  // ==========================================================================
  // The book
  // ==========================================================================

  /**
   * Every address this house may write to, and who it belongs to.
   *
   * A failed read THROWS rather than returning an empty book: an empty book and
   * an unreadable one look identical to a composer, and the second one silently
   * refuses every address the house actually has.
   */
  async book(restaurantId: string): Promise<BookEntry[]> {
    const { data: providers, error } = await this.db.client
      .from("providers")
      .select("id, name, contact_email, primary_contact")
      .eq("restaurant_id", restaurantId)
      .is("deleted_at", null);

    if (error) {
      throw new BadRequestException(
        // ONE clause. Each surface adds its own consequence — a message that
        // carries the page's sentence too gets printed twice, nested, which is
        // exactly what the first browser capture of this sheet showed.
        `The vendor book could not be read (${error.message}).`,
      );
    }

    const rows = (providers ?? []) as unknown as Record<string, unknown>[];
    const ids = rows.map((r) => String(r.id));
    const out: BookEntry[] = [];

    for (const r of rows) {
      const name = String(r.name ?? "");
      const direct = (r.contact_email as string | null) ?? null;
      const primary = r.primary_contact as Record<string, unknown> | null;
      const primaryEmail =
        primary && typeof primary.email === "string" ? primary.email : null;
      for (const email of [direct, primaryEmail]) {
        if (!email) continue;
        if (
          out.some(
            (e) => e.providerId === String(r.id) && sameAddress(e.email, email),
          )
        )
          continue;
        out.push({
          providerId: String(r.id),
          providerName: name,
          contactName:
            primary && typeof primary.name === "string" ? primary.name : null,
          email,
          source: "provider",
        });
      }
    }

    if (ids.length > 0) {
      const { data: contacts, error: contactError } = await this.db.client
        .from("provider_contacts")
        .select("provider_id, name, email")
        .in("provider_id", ids);
      if (contactError) {
        throw new BadRequestException(
          `The vendor book's contact list could not be read (${contactError.message}).`,
        );
      }
      for (const c of (contacts ?? []) as unknown as Record<
        string,
        unknown
      >[]) {
        const email = (c.email as string | null) ?? null;
        if (!email) continue;
        const providerId = String(c.provider_id);
        if (
          out.some(
            (e) => e.providerId === providerId && sameAddress(e.email, email),
          )
        )
          continue;
        out.push({
          providerId,
          providerName:
            rows.find((r) => String(r.id) === providerId)?.name?.toString() ??
            "",
          contactName: (c.name as string | null) ?? null,
          email,
          source: "contact",
        });
      }
    }

    return out;
  }

  // ==========================================================================
  // Guardrails, over a HUMAN draft
  // ==========================================================================

  /**
   * The AI path runs five guardrails (`inbound-responder.service.ts:871-930`).
   * Exactly two of them mean anything over a human's own words, and pretending
   * otherwise would be theatre:
   *
   *   commitment_language  TRANSFERS, and blocks. It is a pure text test over
   *                        the body, and the reason it exists — a sentence that
   *                        could form a binding purchase commitment must never
   *                        leave without a person's deliberate act — is exactly
   *                        as true when the person typed it. Blocking rather
   *                        than warning is the difference: the AI's version
   *                        routes to a human, and here the human IS the author,
   *                        so the only remaining move is to make them rewrite
   *                        it or take it to a purchase order.
   *   max_rounds           TRANSFERS AS A FACT, not a block. It counts outbound
   *                        rows on the order; a manager writing a fourth letter
   *                        is doing something they are entitled to do, and the
   *                        composer says how many have gone rather than
   *                        refusing.
   *   price_above_target   DOES NOT TRANSFER. They read `analysis.vendor_offers`
   *   qty_or_budget_change — a structured extraction of what the VENDOR offered.
   *                        A blank letter has no offers to compare.
   *   sender_unverified    DOES NOT TRANSFER. It is about the DKIM/DMARC status
   *                        of an inbound message. There is no inbound message.
   *
   * One guardrail is added that the AI path does not need: an unresolved merge
   * token. The AI writes prose; the composer merges. A letter that ships
   * `{{last_price}}` has substituted a plausible-looking blank for a figure it
   * did not have, which is this repo's named cardinal fault written into
   * something a vendor keeps.
   */
  guardrails(params: {
    body: string;
    subject: string;
    priorOutboundOnOrder: number | null;
  }): GuardrailHit[] {
    return composerGuardrails(params);
  }

  // ==========================================================================
  // Queue
  // ==========================================================================

  async queue(params: {
    restaurantId: string;
    userId: string;
    dto: QueueLetterDto;
    /** The seal minted by `issueQueueSeal` at the start of the hold. */
    challenge?: string | null;
    /** The caller's role in this house (ADR 0162). See the R1b check below. */
    role?: string | null;
  }): Promise<{
    id: string;
    status: string;
    dispatchAt: string;
    undoMs: number | null;
    sender: string | null;
    says: string;
    notices: GuardrailHit[];
    insightsRecorded: number;
  }> {
    const { restaurantId, dto } = params;
    const userId = assertNamedActor(
      params.userId,
      "queued and nothing was sent",
    );

    // ── 0. WHO (ADR 0175 D10, 2026-09-21) ────────────────────────────────────
    // An owner, a manager or a grantee. First, so a person whose hold cannot
    // send is told so before the book, the guardrails or the mailbox are read.
    const gates = this.requireGates();
    // canAsk: a staff member is told to hold (click) again to ASK a manager
    // instead (founder answer 3, 2026-09-21; `ask`).
    const standing = await gates.authority.assertMaySend(userId, restaurantId, "send this letter", {
      canAsk: true,
    });

    // ── 0a. a letter sent FROM a draft must still be that house's draft ────
    // Sending a draft is the approval (ADR 0230). It is refused when the row is
    // not a draft any more (already sent, discarded, or another tab sent it),
    // so one draft can never leave twice.
    const draft = dto.draftId
      ? await this.readDraft(restaurantId, dto.draftId)
      : null;

    // ── 0b. a credit claim's draft is owner/manager territory ──────────────
    // ADR 0167 already refuses staff `POST /procurement/credits/:id/transition`
    // — the move that drafts this letter in the first place — the same
    // claimed dollar amount, reason and invoice/order numbers this draft's
    // body carries. Completing that same claim by sending its letter through
    // THIS route is the same act with a different door, and must answer the
    // same way (PR #476 audit round 2, R1b: staff could read a manager's
    // draft id via the ungated `/conversations` routes, then `queue()` it
    // under their own subject/body to hijack and send a credit letter as the
    // house). A letter with no `draftId`, or one that answers no claim, is
    // unaffected — "writing and sending a letter by hand" stays open to every
    // role, exactly as ADR 0230's reconciliation with ADR 0167 intended.
    // [#436 merging main ef8ecdf30, 2026-09-27: on #436 "every role" reads
    // "everyone step 0 admits" — an owner, a manager or a grantee (ADR 0175
    // D10); a staff member without a grant asks instead. This check runs after
    // WHO, so a grant to send never opens a credit claim's letter to staff.]
    if (draft?.creditId && !isOwnerOrManager(params.role)) {
      throw new ForbiddenException(
        "This draft answers a credit claim. Only an owner or manager may send it, the same rule the claim's own ledger already enforces. Nothing was queued and nothing was sent.",
      );
    }
    if (draft && draft.providerId !== dto.providerId) {
      throw new UnprocessableEntityException(
        "That draft was written to a different vendor. Nothing was queued and nothing was sent.",
      );
    }

    // A release of a staff member's request names it (founder answer 3). The
    // request must be this house's, waiting, and to the same vendor: a
    // manager may change the words (a new version under their own seal) but
    // not write to someone else under the staffer's request.
    if (dto.requestId) {
      if (!this.requests) {
        throw new InternalServerErrorException(
          "The request could not be checked (not wired into the composer), so nothing was queued and nothing was sent.",
        );
      }
      const request = await this.requests.one(restaurantId, dto.requestId, "house_letter");
      if (request.state !== "waiting") {
        throw new ConflictException(
          request.state === "released"
            ? "That letter was already released by someone else. Nothing more was sent."
            : "That request was closed. Nothing was sent.",
        );
      }
      if (request.provider_id !== dto.providerId) {
        throw new UnprocessableEntityException(
          "That request is a letter to a different vendor. A release sends the letter that was asked for; write a new letter to write to someone else. Nothing was sent.",
        );
      }
    }

    // ── 1. the recipient must be in the book; 2. the guardrails ─────────────
    // (`checkLetter`, shared with `ask` so the two cannot disagree.)
    const { match, hits, priorOutbound } = await this.checkLetter(restaurantId, dto);

    // ── 3. the house must have a sending identity ───────────────────────────
    const identity = await this.sender.resolve(restaurantId, userId);
    if (!identity.sendable) {
      throw new ConflictException(
        `${identity.words} Nothing was queued and nothing was sent.`,
      );
    }

    // ── 4. the house must still be using the grant that identity rests on ───
    // ADR 0114: a manager may cut the house off from a member's grant without
    // touching the member's own credential. `getAccessToken` is the one door
    // feature code uses and it is where that row becomes a refusal
    // (integrations-oauth.service.ts:926-938). Calling it HERE, at queue time,
    // is deliberate: a letter that queues and then cannot be sent is worse than
    // one that is refused while its author is still looking at it.
    if (identity.grant) {
      try {
        await this.oauth.getAccessToken(
          identity.grant.personUserId,
          restaurantId,
          identity.grant.integrationId as IntegrationId,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof ForbiddenException) throw err;
        throw new ConflictException(
          `The mailbox this house sends from could not be used: ${message} Nothing was queued and nothing was sent.`,
        );
      }
    }

    // ── the insertions are re-read, never trusted ───────────────────────────
    const verified = await this.verifyInsertions(
      restaurantId,
      dto.insights ?? [],
    );

    // ── THE SEAL (ADR 0175 D9, 2026-09-21) ──────────────────────────────────
    // Redeemed over exactly what is about to be written — the vendor, the
    // address, the subject and the words — immediately before the row exists.
    // A refused seal means nothing was queued; an edit after the hold is
    // refused by the args hash, so an edited letter needs a new hold.
    await gates.seal.redeem({
      restaurantId,
      actorUserId: userId,
      subjectKind: "house_letter",
      subjectId: dto.providerId,
      action: HOUSE_LETTER_ACT,
      args: houseLetterSealArgs(dto),
      challenge: params.challenge,
    });
    // A letter queued under a grant is on the security ledger before the row
    // exists (ADR 0112 F12; founder answer 4, 2026-09-21).
    await gates.authority.witnessGrantUse(standing.basis === "grant" ? standing.grant.id : null, {
      userId,
      restaurantId,
      act: HOUSE_LETTER_ACT,
      subject: `house_letter:${dto.providerId}`,
    });

    // The release takes the request ONCE (two managers releasing together:
    // the loser sends nothing). After the seal, so a refused seal never takes
    // a request; given back if the letter then fails to queue.
    const claimed =
      dto.requestId && this.requests
        ? await this.requests.claim({
            restaurantId,
            requestId: dto.requestId,
            kind: "house_letter",
            releasedBy: userId,
            releaseSealArgs: houseLetterSealArgs({ ...dto, to: match.email }),
          })
        : null;

    const now = Date.now();
    const dispatchAt = new Date(now + (identity.undoMs ?? 0)).toISOString();

    const letter = {
      order_id: dto.orderId ?? draft?.orderId ?? null,
      restaurant_id: restaurantId,
      provider_id: dto.providerId,
      direction: "outbound",
      channel: "email",
      content: dto.body,
      message_text: dto.body,
      ai_generated: false,
      status: LETTER_STATUS.QUEUED,
      scheduled_send_at: dispatchAt,
      outbound_email_type: "HOUSE_LETTER",
      round_count: (priorOutbound ?? 0) + 1,
      inserted_insights: verified.length > 0 ? verified : null,
      // Who released it, and under which grant (ADR 0175 D9/D10).
      sent_by_user_id: userId,
      sent_under_grant_id: standing.basis === "grant" ? standing.grant.id : null,
      email_headers: {
        subject: dto.subject,
        to: match.email,
        sender_address: identity.address,
        sender_kind: identity.kind,
        written_by: userId,
        template_id: dto.templateId ?? null,
        // The staff request this release took, by its id, on the letter
        // itself: a pull-back finds the request from here even when the
        // best-effort `linkConversation` below did not land (founder,
        // 2026-09-21: "undo re-waits"). [Last call, 2026-09-21: that request
        // was found only through the link, so a failed link left it
        // released, silently, after its letter was pulled back.]
        request_id: claimed && dto.requestId ? dto.requestId : null,
        // The claim this letter asks about stays on the row once it is sent,
        // so the credit can still name its letter (ADR 0230).
        ...(draft?.creditId ? { credit_id: draft.creditId } : {}),
        ...(draft ? { drafted_by: draft.draftedBy } : {}),
      },
    };

    // From a draft, the draft row BECOMES the letter — conditional on it still
    // being a draft, so a second send of the same draft finds nothing to claim.
    const { data, error } = draft
      ? await this.db.client
          .from("procurement_conversations")
          .update(letter)
          .eq("id", draft.id)
          .eq("restaurant_id", restaurantId)
          .eq("status", LETTER_STATUS.DRAFT)
          .select("id")
          .maybeSingle()
      : await this.db.client
          .from("procurement_conversations")
          .insert(letter)
          .select("id")
          .single();

    if (draft && !error && !data) {
      // A release that took a staff request gives it back here too: no letter
      // was queued, so the request is still asking (#436 merging main, 2026-09-27).
      if (claimed && dto.requestId && this.requests) {
        await this.requests.unclaim(restaurantId, dto.requestId, userId);
      }
      throw new ConflictException(
        "That draft is no longer a draft — it was sent or discarded while this letter was open. Nothing was queued and nothing was sent.",
      );
    }
    if (error || !data) {
      if (claimed && dto.requestId && this.requests) {
        await this.requests.unclaim(restaurantId, dto.requestId, userId);
      }
      throw new BadRequestException(
        `The letter was NOT queued and NOT sent — the conversation book refused the row (${error?.message ?? "no row returned"}).`,
      );
    }

    if (claimed && dto.requestId && this.requests) {
      const conversationId = String((data as Record<string, unknown>).id);
      await this.requests.linkConversation(restaurantId, dto.requestId, conversationId);
      await this.requests.tellRequester({
        restaurantId,
        row: claimed.row,
        releasedBy: userId,
        asWritten: claimed.asWritten,
        vendorName: match.providerName,
      });
    }

    if (dto.templateId)
      await this.stampTemplateUse(restaurantId, dto.templateId);

    return {
      id: String((data as Record<string, unknown>).id),
      status: LETTER_STATUS.QUEUED,
      dispatchAt,
      undoMs: identity.undoMs,
      sender: identity.address,
      says:
        identity.ceremony === "undo"
          ? `Queued to leave from ${identity.address} at ${dispatchAt}. It has not been sent. Until then it can be pulled back, and the conversation book shows it as queued, never as sent.`
          : `Queued to leave from ${identity.address}. It has not been sent yet; the book will say so when it has.`,
      notices: hits.filter((h) => !h.blocking),
      insightsRecorded: verified.length,
    };
  }

  /**
   * Pull a queued letter back before it leaves.
   *
   * Only a row that is still QUEUED and still inside its window may be
   * cancelled; a row past its window is refused rather than marked cancelled,
   * because the dispatcher may already hold it and "cancelled" would then be a
   * claim about a letter that went.
   *
   * Author-only (founder, 2026-09-18, ADR 0149 row 43 — "only author is the
   * best option"; answers this ADR's own open question 4, "should a queued
   * letter be visible to the whole house, or only its author?"): the row's
   * own `email_headers.written_by` is who queued it, and only that person may
   * pull it back. A pooled inbox other owners could also cancel from was
   * raised in the same answer and recorded as a direction, not built — see
   * `.planning/06-pages/communications.md`'s relay section.
   */
  async cancel(params: {
    restaurantId: string;
    /** Who pulled it back — named on the staff request it re-opens, if any. */
    userId: string;
    id: string;
    /** The caller's role in this house (ADR 0162). See the R1b check below. */
    role?: string | null;
  }): Promise<{ id: string; status: string; says: string; requestWaitsAgain?: boolean }> {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select("id, status, scheduled_send_at, restaurant_id, provider_id, email_headers")
      .eq("id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .maybeSingle();

    if (error) {
      throw new BadRequestException(
        `The letter could not be read (${error.message}), so it was NOT cancelled. Check the conversation book before assuming it was stopped.`,
      );
    }
    if (!data) throw new NotFoundException("No such letter in this house.");

    const row = data as unknown as Record<string, unknown>;
    const headers = (row.email_headers ?? {}) as Record<string, unknown>;

    // Same ADR 0167 reconciliation as `queue()` above: a queued letter that
    // answers a credit claim (`email_headers.credit_id`) is owner/manager
    // territory, pulling it back included. A letter with no claim behind it
    // is unaffected (PR #476 audit round 2, R1b).
    if (headers.credit_id && !isOwnerOrManager(params.role)) {
      throw new ForbiddenException(
        "This letter answers a credit claim. Only an owner or manager may pull it back, the same rule the claim's own ledger already enforces. It is still queued.",
      );
    }
    const writtenBy = (headers.written_by as string | null) ?? null;
    if (writtenBy !== params.userId) {
      throw new ForbiddenException(
        "Only the person who wrote this letter can pull it back. Ask them to cancel it, or let it go and follow up once it has left.",
      );
    }
    if (String(row.status) !== LETTER_STATUS.QUEUED) {
      throw new ConflictException(
        `That letter is "${String(row.status)}", not queued, so it was not cancelled. Only a letter still inside its window can be pulled back.`,
      );
    }
    const due = row.scheduled_send_at
      ? new Date(String(row.scheduled_send_at)).getTime()
      : 0;
    if (due <= Date.now()) {
      throw new ConflictException(
        "That letter's window has closed and the dispatcher may already hold it, so it was NOT cancelled. The conversation book will say what happened to it.",
      );
    }

    // `.select("id")` so a letter `dispatchDue` claimed between the read
    // above and this update — QUEUED -> SENDING, the same race
    // `RelayEmailService.cancelQueued` guards against on its own queue — is
    // not silently reported as pulled back. Zero rows means the guard
    // (`status = QUEUED`) matched nothing, which the read above cannot rule
    // out: it is a snapshot, not a lock. (Wave5 confirmer residual: this
    // mirrors relay's own B1 fix one-for-one.)
    const { data: cancelled, error: updateError } = await this.db.client
      .from("procurement_conversations")
      .update({ status: LETTER_STATUS.CANCELLED, scheduled_send_at: null })
      .eq("id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .eq("status", LETTER_STATUS.QUEUED)
      .select("id");

    if (updateError) {
      throw new BadRequestException(
        `The letter was NOT cancelled (${updateError.message}). It is still queued.`,
      );
    }
    // Conditional on QUEUED: when the dispatcher took the row between the read
    // above and this write, nothing matched and nothing was cancelled. Saying
    // "pulled back" then would be a claim about a letter that may have gone.
    if (!Array.isArray(cancelled) || cancelled.length === 0) {
      throw new ConflictException(
        "That letter was claimed by the dispatcher the instant before this reached it, so it was NOT cancelled. The conversation book will say what happened to it.",
      );
    }

    // UNDO RE-WAITS (founder, 2026-09-21, verbatim: "Decline/withdraw; undo
    // re-waits"). A letter a manager released from a staff member's request
    // and then pulled back inside the undo window puts that request back to
    // waiting, and the person who asked is told. After the cancel, never
    // before: a request re-opened while its letter could still leave could be
    // released twice. The letter is cancelled whatever happens here; a
    // failure is said in the answer, not swallowed.
    let requestWaitsAgain = false;
    let requestNote = "";
    // The request this letter's release took, as the letter records it (null
    // for a letter queued before the id was stamped, or one no request asked for);
    // `headers` is the row's, read above for the credit-claim check.
    const stampedRequestId =
      typeof headers.request_id === "string" && headers.request_id.trim() ? headers.request_id.trim() : null;
    if (this.requests) {
      try {
        const vendorName = await this.vendorNameOf(params.restaurantId, (row.provider_id as string | null) ?? null);
        const rewaited = await this.requests.rewaitAfterUndo({
          restaurantId: params.restaurantId,
          conversationId: params.id,
          requestId: stampedRequestId,
          undoneBy: params.userId ?? null,
          vendorName,
        });
        if (rewaited) {
          requestWaitsAgain = true;
          requestNote = " The staff request it released is waiting for an owner or a manager again, and the person who asked was told.";
        } else if (stampedRequestId) {
          // The letter says a request released it, and that request no longer
          // reads as released by this letter: said, never a quiet "pulled back".
          this.logger.error(
            `Letter ${params.id} was pulled back, but its staff request ${stampedRequestId} no longer reads as released by it, so it was not put back to waiting.`,
          );
          requestNote =
            " The staff request it released could not be put back to waiting (it no longer reads as released by this letter); ask the person who asked to send it again.";
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Letter ${params.id} was pulled back, but its staff request was not put back to waiting: ${message}`);
        requestNote = ` If this letter came from a staff member's request, that request could not be put back to waiting (${message}); ask them to send it again.`;
      }
    }

    return {
      id: params.id,
      status: LETTER_STATUS.CANCELLED,
      says: `Pulled back. It was never sent, and the book records it as cancelled rather than deleting it.${requestNote}`,
      requestWaitsAgain,
    };
  }

  /** A vendor's name for a notice; null (never a guess) when it cannot be read. */
  private async vendorNameOf(restaurantId: string, providerId: string | null): Promise<string | null> {
    if (!providerId) return null;
    const { data, error } = await this.db.client
      .from("providers")
      .select("name")
      .eq("restaurant_id", restaurantId)
      .eq("id", providerId)
      .maybeSingle();
    if (error) {
      // Words only: the notice says "the vendor" instead. Logged, not hidden.
      this.logger.warn(`The vendor's name for a notice could not be read (${error.message}).`);
      return null;
    }
    return ((data as Record<string, unknown> | null)?.name as string | null) ?? null;
  }

  /** What is still inside its undo window for this house, newest first. */
  async queued(restaurantId: string) {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select("id, provider_id, scheduled_send_at, email_headers, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("status", LETTER_STATUS.QUEUED)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      throw new BadRequestException(
        `What is queued could not be read (${error.message}).`,
      );
    }
    return (data ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      const headers = (row.email_headers ?? {}) as Record<string, unknown>;
      return {
        id: String(row.id),
        providerId: String(row.provider_id),
        subject: (headers.subject as string | null) ?? null,
        to: (headers.to as string | null) ?? null,
        dispatchAt: (row.scheduled_send_at as string | null) ?? null,
      };
    });
  }

  // ==========================================================================
  // Drafts — letters Mudavym wrote and nobody has sent (ADR 0230)
  // ==========================================================================

  /** One draft of this house, or a refusal that says why it is not one. */
  private async readDraft(
    restaurantId: string,
    id: string,
  ): Promise<{
    id: string;
    providerId: string;
    orderId: string | null;
    creditId: string | null;
    draftedBy: string | null;
  }> {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select("id, status, provider_id, order_id, email_headers")
      .eq("id", id)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        `The draft could not be read (${error.message}). Nothing was queued and nothing was sent.`,
      );
    }
    if (!data) throw new NotFoundException("No such draft in this house.");
    const row = data as unknown as Record<string, unknown>;
    if (String(row.status) !== LETTER_STATUS.DRAFT) {
      throw new ConflictException(
        `That letter is "${String(row.status)}", not a draft, so it was not sent again. Nothing was queued.`,
      );
    }
    const headers = (row.email_headers ?? {}) as Record<string, unknown>;
    return {
      id: String(row.id),
      providerId: String(row.provider_id),
      orderId: (row.order_id as string | null) ?? null,
      creditId: (headers.credit_id as string | null) ?? null,
      draftedBy: (headers.drafted_by as string | null) ?? null,
    };
  }

  /** Every unsent draft of this house, newest first. */
  async drafts(restaurantId: string) {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select(
        "id, provider_id, order_id, email_headers, message_text, created_at, providers!left(name)",
      )
      .eq("restaurant_id", restaurantId)
      .eq("status", LETTER_STATUS.DRAFT)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      throw new BadRequestException(
        `The drafts could not be read (${error.message}).`,
      );
    }
    return (data ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      const headers = (row.email_headers ?? {}) as Record<string, unknown>;
      const provider = row.providers as { name?: string } | null;
      return {
        id: String(row.id),
        providerId: String(row.provider_id),
        providerName: provider?.name ?? null,
        orderId: (row.order_id as string | null) ?? null,
        subject: (headers.subject as string | null) ?? null,
        to: (headers.to as string | null) ?? null,
        category: (headers.category as string | null) ?? null,
        creditId: (headers.credit_id as string | null) ?? null,
        body: String(row.message_text ?? ""),
        createdAt: (row.created_at as string | null) ?? null,
      };
    });
  }

  /**
   * Throw a draft away. The row stays, as HOUSE_CANCELLED — "we drafted this
   * and killed it" is part of the record with a vendor, the same as a queued
   * letter pulled back.
   */
  async discardDraft(params: {
    restaurantId: string;
    id: string;
  }): Promise<{ id: string; status: string; says: string }> {
    await this.readDraft(params.restaurantId, params.id);
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .update({ status: LETTER_STATUS.CANCELLED })
      .eq("id", params.id)
      .eq("restaurant_id", params.restaurantId)
      .eq("status", LETTER_STATUS.DRAFT)
      .select("id")
      .maybeSingle();
    if (error) {
      throw new BadRequestException(
        `The draft was NOT discarded (${error.message}). It is still a draft.`,
      );
    }
    if (!data) {
      throw new ConflictException(
        "That draft stopped being a draft before it could be discarded — it may have been sent. The conversation book says what happened to it.",
      );
    }
    return {
      id: params.id,
      status: LETTER_STATUS.CANCELLED,
      says: "Discarded. It was never sent, and the book keeps it as cancelled rather than deleting it.",
    };
  }

  /**
   * Draft the letter that asks a vendor for a credit (founder, 2026-09-25,
   * round 5; ADR 0230). Called when a claim moves to `requested`.
   *
   * It DRAFTS. It never queues and never sends: the row is HOUSE_DRAFT, which
   * no cron reads, and it leaves only when a person sends it from the composer
   * through `queue()` — every refusal there (book, guardrails, sender, grant,
   * undo window) applies to it exactly as to a letter typed by hand.
   *
   * The honest outcomes, each its own state rather than one "failed":
   *   drafted             — a draft addressed to the vendor's booked address
   *   drafted_no_address  — a draft kept, but the vendor has no address in the
   *                         book (or the book could not be read), so it cannot
   *                         go until one is added
   *   no_vendor           — the claim names no vendor; there is nobody to write
   *                         to, and no row is written
   *   existing            — this claim already has an unsent draft; that one is
   *                         returned, so asking twice never makes two
   */
  async draftForCredit(params: {
    restaurantId: string;
    userId: string;
    creditId: string;
  }): Promise<CreditLetter> {
    const { restaurantId, creditId } = params;
    const userId = assertNamedActor(params.userId, "drafted");

    const { data: credit, error: creditError } = await this.db.client
      .from("procurement_credits")
      .select(
        "id, provider_id, order_id, document_id, reason, summary, claimed_amount, claimed_qty, currency, opened_at",
      )
      .eq("id", creditId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (creditError) {
      throw new BadRequestException(
        `The claim could not be read (${creditError.message}), so no letter was drafted.`,
      );
    }
    if (!credit) throw new NotFoundException("No such claim in this house.");
    const c = credit as unknown as Record<string, unknown>;

    const providerId = (c.provider_id as string | null) ?? null;
    if (!providerId) {
      return {
        state: "no_vendor",
        id: null,
        to: null,
        says: "This claim names no vendor, so there is nobody to write to and no letter was drafted. Ask the vendor yourself; the claim still records that it was asked for.",
      };
    }

    const existing = await this.lettersForCredits(restaurantId, [creditId]);
    const open = existing.byCredit[creditId]?.find(
      (l) => l.status === LETTER_STATUS.DRAFT,
    );
    if (open) {
      return {
        state: "existing",
        id: open.id,
        to: open.to,
        says: "This claim already has a drafted letter that has not been sent. That draft is the one to open — no second one was made.",
      };
    }

    const [vendor, order, invoice] = await Promise.all([
      this.db.client
        .from("providers")
        .select("name")
        .eq("id", providerId)
        .eq("restaurant_id", restaurantId)
        .maybeSingle(),
      c.order_id
        ? this.db.client
            .from("procurement_orders")
            .select("order_number")
            .eq("id", String(c.order_id))
            .eq("restaurant_id", restaurantId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      c.document_id
        ? this.db.client
            .from("procurement_documents")
            .select("doc_number")
            .eq("id", String(c.document_id))
            .eq("restaurant_id", restaurantId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    let to: string | null = null;
    let bookRead = true;
    try {
      const book = await this.book(restaurantId);
      to = book.find((e) => e.providerId === providerId)?.email ?? null;
    } catch {
      bookRead = false;
    }

    const letter = composeCreditLetter({
      reason: (c.reason as string | null) ?? null,
      summary: (c.summary as string | null) ?? null,
      claimedAmount: Number(c.claimed_amount ?? 0),
      currency: (c.currency as string | null) ?? null,
      claimedQty: c.claimed_qty == null ? null : Number(c.claimed_qty),
      openedAt: (c.opened_at as string | null) ?? null,
      vendorName:
        ((vendor.data as Record<string, unknown> | null)?.name as
          | string
          | null) ?? null,
      orderNumber:
        ((order.data as Record<string, unknown> | null)?.order_number as
          | string
          | null) ?? null,
      invoiceNumber:
        ((invoice.data as Record<string, unknown> | null)?.doc_number as
          | string
          | null) ?? null,
    });

    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .insert({
        order_id: (c.order_id as string | null) ?? null,
        restaurant_id: restaurantId,
        provider_id: providerId,
        direction: "outbound",
        channel: "email",
        content: letter.body,
        message_text: letter.body,
        ai_generated: false,
        status: LETTER_STATUS.DRAFT,
        scheduled_send_at: null,
        outbound_email_type: "HOUSE_LETTER",
        email_headers: {
          subject: letter.subject,
          to,
          category: letter.category,
          credit_id: creditId,
          drafted_by: userId,
        },
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new BadRequestException(
        `The letter was NOT drafted — the conversation book refused the row (${error?.message ?? "no row returned"}). The claim still records that it was asked for.`,
      );
    }
    const id = String((data as Record<string, unknown>).id);

    // ── close the TOCTOU race, after the fact (audit round 1, R5, low severity) ──
    // The "no open draft" check above and this insert are two round trips, so
    // two concurrent `→ requested` (or `request-letter`) calls on the same
    // claim can both pass the check and both insert — there is no unique
    // constraint on (restaurant, credit_id, DRAFT) to stop it. Rather than add
    // one (a migration, on a table many lanes touch, for a low-severity race),
    // this re-reads every open draft for the claim right after inserting and
    // keeps exactly one: the OLDEST by created_at (ties broken by id, so the
    // order is total and every racer agrees on the same winner without
    // coordinating). Every other one — including this call's own row, if it
    // lost — is cancelled immediately, before it is ever shown to anyone.
    // Double-SEND is a separate, already-closed door: `queue()`'s
    // status-guarded UPDATE only ever promotes one draft, whichever survives
    // here.
    const afterInsert = await this.lettersForCredits(restaurantId, [creditId]);
    const openAfterInsert = (afterInsert.byCredit[creditId] ?? []).filter(
      (l) => l.status === LETTER_STATUS.DRAFT,
    );
    if (openAfterInsert.length > 1) {
      const [canonical] = [...openAfterInsert].sort(
        (a, b) =>
          (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
          a.id.localeCompare(b.id),
      );
      for (const dup of openAfterInsert) {
        if (dup.id === canonical.id) continue;
        await this.db.client
          .from("procurement_conversations")
          .update({ status: LETTER_STATUS.CANCELLED })
          .eq("id", dup.id)
          .eq("restaurant_id", restaurantId)
          .eq("status", LETTER_STATUS.DRAFT);
      }
      if (canonical.id !== id) {
        return {
          state: "existing",
          id: canonical.id,
          to: canonical.to,
          says: "This claim already has a drafted letter that has not been sent (a concurrent request drafted it first). That draft is the one to open — no second one was kept.",
        };
      }
    }

    if (!to) {
      return {
        state: "drafted_no_address",
        id,
        to: null,
        says: bookRead
          ? "Drafted, not sent. This vendor has no address in the house's book, so the letter cannot go until one is added to the vendor."
          : "Drafted, not sent. The vendor book could not be read, so the letter has no recipient yet — open it in Communications to choose one.",
      };
    }
    return {
      state: "drafted",
      id,
      to,
      says: `Drafted to ${to}, not sent. It waits in Communications until someone here sends it.`,
    };
  }

  /**
   * The house letters that belong to each claim, newest first — the credit's
   * link to its draft, and what became of it after. A failed read throws: a
   * claim shown with no letter because the read failed would say "nothing was
   * drafted" about a draft that exists.
   *
   * `capped` (PR #476 audit round 1, R4): the read stops at 500 rows across
   * the WHOLE batch of `creditIds`, not per claim, and the window is not
   * registered anywhere else. Once a house's letters for these claims exceed
   * it, the oldest ones fall out of `data`, and a claim whose only letter fell
   * out would otherwise get `[]` here — indistinguishable from a claim that
   * was never asked for. The caller (`credits.controller.ts`) reads `capped`
   * and renders a claim ABSENT from `byCredit` as unknown, never as none,
   * whenever this is true; a claim present in `byCredit` is unaffected — its
   * letter survived the window, so it is known regardless. Registered as
   * `RECEIPTS_SERVER_WINDOWS.CREDIT_LETTERS` in `useReceiptsNextData.ts`, so
   * `scripts/check_windowed_figures.py` proves the 500 below still matches.
   */
  async lettersForCredits(
    restaurantId: string,
    creditIds: string[],
  ): Promise<{ byCredit: Record<string, CreditLetterRef[]>; capped: boolean }> {
    const byCredit: Record<string, CreditLetterRef[]> = {};
    if (creditIds.length === 0) return { byCredit, capped: false };
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select("id, status, email_headers, sent_at, created_at")
      .eq("restaurant_id", restaurantId)
      .eq("outbound_email_type", "HOUSE_LETTER")
      .in("email_headers->>credit_id", creditIds)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      throw new BadRequestException(
        `The claims' letters could not be read (${error.message}).`,
      );
    }
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    for (const r of rows) {
      const headers = (r.email_headers ?? {}) as Record<string, unknown>;
      const creditId = headers.credit_id as string | undefined;
      if (!creditId) continue;
      (byCredit[creditId] ??= []).push({
        id: String(r.id),
        status: String(r.status ?? ""),
        to: (headers.to as string | null) ?? null,
        sentAt: (r.sent_at as string | null) ?? null,
        createdAt: (r.created_at as string | null) ?? null,
      });
    }
    return { byCredit, capped: rows.length >= 500 };
  }

  // ==========================================================================
  // Templates — house-owned, per vendor purpose
  // ==========================================================================

  async listTemplates(restaurantId: string) {
    const { data, error } = await this.db.client
      .from("communication_templates")
      .select(
        "id, name, subject, body, category, merge_fields, updated_by, last_used_at, updated_at, is_active",
      )
      .eq("restaurant_id", restaurantId)
      .eq("type", LETTER_TEMPLATE_TYPE)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new BadRequestException(
        `The house's letter templates could not be read (${error.message}).`,
      );
    }

    // The order letter has its own panel and is never a composer template
    // (ADR 0313): leaving it here would offer it in the composer's picker and
    // open it in the five purposes' editor, which publishes nothing.
    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).filter(
      (r) => r.category !== ORDER_REQUEST_TEMPLATE_KEY,
    );
    const editorIds = Array.from(
      new Set(
        rows
          .map((r) => r.updated_by)
          .filter(Boolean)
          .map(String),
      ),
    );
    const names = new Map<string, string>();
    // A failed lookup here is NOT "these templates have no author": the rows
    // carry `updated_by`, and rendering them as unauthored would state that the
    // column was null when it was the join that failed. supabase-js resolves
    // with { data, error } rather than throwing, so a discarded `error` makes
    // the two indistinguishable. Logged and left as an empty map — every id
    // then renders through the same "unknown" path the pre-migration rows use.
    if (editorIds.length > 0) {
      const { data: people, error: peopleError } = await this.db.client
        .from("users")
        .select("user_id, name")
        .in("user_id", editorIds);
      if (peopleError) {
        this.logger.error(
          `letter templates: who last edited them could not be read (${peopleError.message}); every author renders as unknown.`,
        );
      }
      for (const p of (people ?? []) as unknown as Record<string, unknown>[]) {
        if (p.name) names.set(String(p.user_id), String(p.name));
      }
    }

    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      subject: (r.subject as string | null) ?? null,
      body: String(r.body ?? ""),
      category: (r.category as string | null) ?? null,
      mergeFields: (r.merge_fields as unknown[] | null) ?? null,
      // NULL is unknown, never "nobody": rows written before migration
      // 20260904150000 have no author recorded and never will.
      lastEditedBy: r.updated_by
        ? (names.get(String(r.updated_by)) ?? null)
        : null,
      lastEditedAt: (r.updated_at as string | null) ?? null,
      lastUsedAt: (r.last_used_at as string | null) ?? null,
    }));
  }

  async upsertTemplate(params: {
    restaurantId: string;
    userId: string;
    dto: UpsertLetterTemplateDto;
    /** The caller's role in this house (ADR 0162); read only for the order letter. */
    role?: string | null;
  }) {
    const { restaurantId, dto } = params;
    // An absent key is not written at all, so an edit naming no editor would
    // leave the PREVIOUS editor's name on the template, not a blank.
    const userId = assertNamedActor(params.userId, "saved");
    if (!(LETTER_CATEGORIES as readonly string[]).includes(dto.category)) {
      throw new UnprocessableEntityException(
        `"${dto.category}" is not one of the house's letter purposes (${LETTER_CATEGORIES.join(", ")}). A staff broadcast is deliberately not one of them: the composer writes to the vendor book, and crew messages stay on /team.`,
      );
    }

    // The order letter's guard reads the STORED purpose of an edited row, not
    // the one the request names (ADR 0313): otherwise a staff member could
    // send `price_query` for the order letter's id and write over it.
    let storedCategory: string | null = null;
    if (dto.id) {
      const { data: stored, error: storedError } = await this.db.client
        .from("communication_templates")
        .select("id, category")
        .eq("id", dto.id)
        .eq("restaurant_id", restaurantId)
        .eq("type", LETTER_TEMPLATE_TYPE)
        .maybeSingle();
      if (storedError) {
        throw new BadRequestException(
          `The template was NOT saved: the one being edited could not be read (${storedError.message}). Nothing was stored.`,
        );
      }
      if (!stored) {
        throw new NotFoundException(
          "This house has no such letter template. Nothing was saved.",
        );
      }
      storedCategory = ((stored as Record<string, unknown>).category as string | null) ?? null;
    }

    const isOrderLetter =
      dto.category === ORDER_REQUEST_TEMPLATE_KEY ||
      storedCategory === ORDER_REQUEST_TEMPLATE_KEY;
    if (isOrderLetter) {
      assertOrderLetterEditor(params.role);
      if (dto.id && storedCategory !== dto.category) {
        throw new UnprocessableEntityException(
          storedCategory === ORDER_REQUEST_TEMPLATE_KEY
            ? "The order letter keeps its purpose. Write a new template for another purpose. Nothing was saved."
            : "Another template cannot become the order letter. Open the order letter and edit it. Nothing was saved.",
        );
      }
      if (dto.subject && dto.subject.trim()) {
        throw new UnprocessableEntityException(
          "Mudavym writes an order letter's subject (the order number and the house), so the vendor's reply finds the order. Leave the subject empty. Nothing was saved.",
        );
      }
      const refusals = orderRequestProseRefusals(dto.body);
      if (refusals.length > 0) {
        throw new UnprocessableEntityException({
          statusCode: 422,
          message: `${refusalSentence(refusals)} Nothing was saved.`,
          refusals,
        });
      }
      if (!dto.id) {
        const { data: existing, error: existingError } = await this.db.client
          .from("communication_templates")
          .select("id, name")
          .eq("restaurant_id", restaurantId)
          .eq("type", LETTER_TEMPLATE_TYPE)
          .eq("category", ORDER_REQUEST_TEMPLATE_KEY)
          .maybeSingle();
        if (existingError) {
          throw new BadRequestException(
            `The order letter was NOT saved: whether the house already has one could not be read (${existingError.message}). Nothing was stored.`,
          );
        }
        if (existing) {
          throw new ConflictException(
            `This house already has its order letter, "${String((existing as Record<string, unknown>).name ?? "")}". Open that one and edit it: a house has one order letter. Nothing was saved.`,
          );
        }
      }
    }

    // The order letter's `body` is its DRAFT. A save never publishes it, and
    // `published_version_id` is not in this payload: a vendor keeps getting
    // the published words (or Mudavym's default) until a preview and a
    // publish (ADR 0313).
    const payload = {
      restaurant_id: restaurantId,
      name: dto.name,
      subject: isOrderLetter ? null : (dto.subject ?? null),
      body: dto.body,
      type: LETTER_TEMPLATE_TYPE,
      category: dto.category,
      merge_fields: mergeFieldsIn(dto.body, isOrderLetter ? "" : (dto.subject ?? "")),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    };

    const query = dto.id
      ? this.db.client
          .from("communication_templates")
          .update(payload)
          .eq("id", dto.id)
          .eq("restaurant_id", restaurantId)
          .select("id")
          .maybeSingle()
      : this.db.client
          .from("communication_templates")
          .insert(payload)
          .select("id")
          .single();

    const { data, error } = await query;
    if (error || !data) {
      // The one-order-letter index answers a race between two first saves.
      if ((error as { code?: string } | null)?.code === "23505" && isOrderLetter) {
        throw new ConflictException(
          "This house already has its order letter: someone saved one at the same moment. Open that one and edit it. Nothing was saved.",
        );
      }
      throw new BadRequestException(
        `The template was NOT saved (${error?.message ?? "no row returned"}). Nothing was stored.`,
      );
    }
    return {
      id: String((data as Record<string, unknown>).id),
      saved: true,
      ...(isOrderLetter ? { published: false as const } : {}),
    };
  }

  // ==========================================================================
  // The order letter: draft, preview, publish, reset, restore (ADR 0313;
  // ADR 0173 D2). The template row's `body` is the draft; a vendor letter is
  // rendered only from a version (letter_template_versions) the row's
  // `published_version_id` names, or from Mudavym's default when it names none.
  // ==========================================================================

  /** The house's name and its letters' language (restaurants.country, ADR 0313). */
  private async orderLetterHouse(
    restaurantId: string,
  ): Promise<{ name: string; locale: OrderRequestLocale }> {
    const { data, error } = await this.db.client
      .from("restaurants")
      .select("name, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error || !data) {
      throw new InternalServerErrorException(
        `The house could not be read (${error?.message ?? "no row"}); its order letter is not shown as if it had none.`,
      );
    }
    const h = data as Record<string, unknown>;
    return {
      name: String(h.name ?? ""),
      locale: houseLocale(typeof h.country === "string" ? h.country : null),
    };
  }

  /** The house's order letter row, or null when it has never saved one. */
  private async orderLetterRow(restaurantId: string): Promise<{
    id: string;
    name: string;
    body: string;
    publishedVersionId: string | null;
    updatedBy: string | null;
    updatedAt: string | null;
  } | null> {
    const { data, error } = await this.db.client
      .from("communication_templates")
      .select("id, name, body, published_version_id, updated_by, updated_at")
      .eq("restaurant_id", restaurantId)
      .eq("type", LETTER_TEMPLATE_TYPE)
      .eq("category", ORDER_REQUEST_TEMPLATE_KEY)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `The house's order letter could not be read (${error.message}). That does not mean it has none.`,
      );
    }
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      id: String(r.id),
      name: String(r.name ?? ""),
      body: String(r.body ?? ""),
      publishedVersionId: (r.published_version_id as string | null) ?? null,
      updatedBy: (r.updated_by as string | null) ?? null,
      updatedAt: (r.updated_at as string | null) ?? null,
    };
  }

  /**
   * Everything the order letter's sheet shows: the draft, what is published,
   * every version, the defaults, the blocks, and whether THIS caller may
   * change any of it. Any member of the house may read it (staff see it
   * read-only); only the writes are owner or manager.
   */
  async orderLetter(restaurantId: string, role: string | null | undefined) {
    const [house, row] = await Promise.all([
      this.orderLetterHouse(restaurantId),
      this.orderLetterRow(restaurantId),
    ]);
    let versions: Record<string, unknown>[] = [];
    if (row) {
      const { data, error } = await this.db.client
        .from("letter_template_versions")
        .select("id, version, locale, kind, body, body_hash, author, created_at")
        .eq("restaurant_id", restaurantId)
        .eq("template_id", row.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) {
        throw new InternalServerErrorException(
          `The order letter's history could not be read (${error.message}). That does not mean it has none.`,
        );
      }
      versions = (data ?? []) as Record<string, unknown>[];
    }
    const people = new Map<string, string>();
    const ids = Array.from(
      new Set(
        [row?.updatedBy, ...versions.map((v) => v.author)].filter(Boolean).map(String),
      ),
    );
    if (ids.length > 0) {
      const { data: users, error: usersError } = await this.db.client
        .from("users")
        .select("user_id, name")
        .in("user_id", ids);
      if (usersError) {
        this.logger.error(
          `order letter: who wrote it could not be read (${usersError.message}); every author renders as unknown.`,
        );
      }
      for (const u of (users ?? []) as Record<string, unknown>[]) {
        if (u.name) people.set(String(u.user_id), String(u.name));
      }
    }
    const view = versions.map((v) => ({
      id: String(v.id),
      version: Number(v.version),
      locale: String(v.locale),
      kind: String(v.kind) as "publish" | "reset",
      body: String(v.body ?? ""),
      bodyHash: String(v.body_hash ?? ""),
      by: v.author ? (people.get(String(v.author)) ?? null) : null,
      at: (v.created_at as string | null) ?? null,
    }));
    const published = row?.publishedVersionId
      ? (view.find((v) => v.id === row.publishedVersionId) ?? null)
      : null;
    return {
      key: ORDER_REQUEST_TEMPLATE_KEY,
      locale: house.locale,
      mayEdit: (ORDER_LETTER_EDITORS as readonly string[]).includes(String(role ?? "")),
      template: row
        ? {
            id: row.id,
            name: row.name,
            draft: row.body,
            lastEditedBy: row.updatedBy ? (people.get(row.updatedBy) ?? null) : null,
            lastEditedAt: row.updatedAt,
          }
        : null,
      // A published version in the other language is not what this house's
      // letters render from; the sheet says so rather than showing it as live.
      published,
      rendersFrom:
        published && published.locale === house.locale ? ("house" as const) : ("default" as const),
      draftRefusals: row ? orderRequestProseRefusals(row.body) : [],
      versions: view,
      defaults: DEFAULT_ORDER_REQUEST_TEMPLATES,
      tokens: (Object.keys(ORDER_REQUEST_TOKENS) as (keyof typeof ORDER_REQUEST_TOKENS)[]).map(
        (k) => ({ key: k, required: ORDER_REQUEST_TOKENS[k].required, says: ORDER_REQUEST_TOKENS[k].says }),
      ),
    };
  }

  /**
   * Render the words over an example order, once priced (an owner placed it)
   * and once without a price, so the house sees both asks. Returns the
   * refusals instead of a render when the words may not be used.
   */
  async previewOrderLetter(params: {
    restaurantId: string;
    body?: string;
    locale?: OrderRequestLocale;
  }) {
    const house = await this.orderLetterHouse(params.restaurantId);
    const locale = params.locale ?? house.locale;
    let body = params.body;
    if (body === undefined) {
      const row = await this.orderLetterRow(params.restaurantId);
      body = row?.body ?? DEFAULT_ORDER_REQUEST_TEMPLATES[locale];
    }
    const refusals = orderRequestProseRefusals(body);
    if (refusals.length > 0) {
      return { locale, previewHash: null, refusals, samples: [] };
    }
    const samples = ([true, false] as const).map((priced) => {
      const r = renderOrderRequest(previewFacts(house.name, locale, priced), { template: body });
      return {
        label: priced ? ("an owner's order with a price" as const) : ("an order with no price on file" as const),
        subject: r.subject,
        body: r.body,
      };
    });
    return { locale, previewHash: orderLetterPreviewHash(body, locale), refusals, samples };
  }

  /** The next version number of this template in this language. */
  private async nextOrderLetterVersion(
    restaurantId: string,
    templateId: string,
    locale: OrderRequestLocale,
  ): Promise<number> {
    const { data, error } = await this.db.client
      .from("letter_template_versions")
      .select("version")
      .eq("restaurant_id", restaurantId)
      .eq("template_id", templateId)
      .eq("locale", locale)
      .order("version", { ascending: false })
      .limit(1);
    if (error) {
      throw new InternalServerErrorException(
        `The order letter's versions could not be read (${error.message}); nothing was published.`,
      );
    }
    const top = ((data ?? []) as Record<string, unknown>[])[0];
    return top ? Number(top.version) + 1 : 1;
  }

  /** Write one version and point the template at it. Two writes, said as two. */
  private async writeOrderLetterVersion(params: {
    restaurantId: string;
    templateId: string;
    userId: string;
    locale: OrderRequestLocale;
    kind: "publish" | "reset";
    body: string;
  }) {
    const version = await this.nextOrderLetterVersion(
      params.restaurantId,
      params.templateId,
      params.locale,
    );
    const { data: inserted, error: insertError } = await this.db.client
      .from("letter_template_versions")
      .insert({
        template_id: params.templateId,
        restaurant_id: params.restaurantId,
        locale: params.locale,
        version,
        kind: params.kind,
        body: params.body,
        body_hash: letterBodyHash(params.body),
        author: params.userId,
      })
      .select("id, version, locale, kind, created_at")
      .single();
    if (insertError || !inserted) {
      if ((insertError as { code?: string } | null)?.code === "23505") {
        throw new ConflictException(
          "Someone published the order letter at the same moment. Read it again, then publish. Nothing was published.",
        );
      }
      throw new BadRequestException(
        `The order letter was NOT published (${insertError?.message ?? "no row returned"}). Nothing was recorded.`,
      );
    }
    const v = inserted as Record<string, unknown>;
    const update: Record<string, unknown> = {
      published_version_id: String(v.id),
      updated_by: params.userId,
      updated_at: new Date().toISOString(),
    };
    if (params.kind === "reset") {
      // A reset puts the default in the draft too, so the sheet shows the
      // words that are now live.
      update.body = params.body;
      update.merge_fields = mergeFieldsIn(params.body, "");
    }
    const { data: pointed, error: pointError } = await this.db.client
      .from("communication_templates")
      .update(update)
      .eq("id", params.templateId)
      .eq("restaurant_id", params.restaurantId)
      .select("id")
      .maybeSingle();
    if (pointError || !pointed) {
      throw new InternalServerErrorException(
        `Version ${String(v.version)} was recorded but is NOT published (${pointError?.message ?? "no row returned"}): vendor letters still use the words they used before.`,
      );
    }
    return {
      published: true as const,
      versionId: String(v.id),
      version: Number(v.version),
      locale: String(v.locale),
      kind: params.kind,
    };
  }

  /**
   * Publish the saved draft. Refused unless `previewHash` is the hash the
   * saved draft previews to in that language (0173 D2: no publish without a
   * preview of exactly these words), and unless the draft passes the prose
   * rules today.
   */
  async publishOrderLetter(params: {
    restaurantId: string;
    userId: string;
    role: string | null | undefined;
    previewHash: string;
    locale?: OrderRequestLocale;
  }) {
    const userId = assertNamedActor(params.userId, "published");
    assertOrderLetterEditor(params.role);
    const [house, row] = await Promise.all([
      this.orderLetterHouse(params.restaurantId),
      this.orderLetterRow(params.restaurantId),
    ]);
    if (!row) {
      throw new NotFoundException(
        "The house has no order letter saved, so there is nothing to publish. Save the words first. Vendor letters use Mudavym's default until then.",
      );
    }
    const locale = params.locale ?? house.locale;
    const refusals = orderRequestProseRefusals(row.body);
    if (refusals.length > 0) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: `${refusalSentence(refusals)} Nothing was published.`,
        refusals,
      });
    }
    if (params.previewHash !== orderLetterPreviewHash(row.body, locale)) {
      throw new ConflictException(
        "The preview you saw is not of the words saved now (or not in this language). Preview the saved letter again, then publish. Nothing was published.",
      );
    }
    return this.writeOrderLetterVersion({
      restaurantId: params.restaurantId,
      templateId: row.id,
      userId,
      locale,
      kind: "publish",
      body: row.body,
    });
  }

  /** Publish Mudavym's default words as a new version (0173 D2: a reset is a version). */
  async resetOrderLetter(params: {
    restaurantId: string;
    userId: string;
    role: string | null | undefined;
    locale?: OrderRequestLocale;
  }) {
    const userId = assertNamedActor(params.userId, "reset");
    assertOrderLetterEditor(params.role);
    const [house, row] = await Promise.all([
      this.orderLetterHouse(params.restaurantId),
      this.orderLetterRow(params.restaurantId),
    ]);
    if (!row) {
      throw new ConflictException(
        "The house has never saved its own order letter: vendor letters already use Mudavym's default. Nothing was changed.",
      );
    }
    const locale = params.locale ?? house.locale;
    return this.writeOrderLetterVersion({
      restaurantId: params.restaurantId,
      templateId: row.id,
      userId,
      locale,
      kind: "reset",
      body: DEFAULT_ORDER_REQUEST_TEMPLATES[locale],
    });
  }

  /** Copy an earlier version's words into the draft. Nothing is published. */
  async restoreOrderLetter(params: {
    restaurantId: string;
    userId: string;
    role: string | null | undefined;
    versionId: string;
  }) {
    const userId = assertNamedActor(params.userId, "restored");
    assertOrderLetterEditor(params.role);
    const row = await this.orderLetterRow(params.restaurantId);
    if (!row) {
      throw new NotFoundException("The house has no order letter, so it has no earlier version.");
    }
    const { data: v, error } = await this.db.client
      .from("letter_template_versions")
      .select("id, version, locale, body")
      .eq("id", params.versionId)
      .eq("restaurant_id", params.restaurantId)
      .eq("template_id", row.id)
      .maybeSingle();
    if (error) {
      throw new InternalServerErrorException(
        `That version could not be read (${error.message}); the draft is unchanged.`,
      );
    }
    if (!v) {
      throw new NotFoundException("The house's order letter has no such version. The draft is unchanged.");
    }
    const version = v as Record<string, unknown>;
    const body = String(version.body ?? "");
    const { data: saved, error: saveError } = await this.db.client
      .from("communication_templates")
      .update({
        body,
        merge_fields: mergeFieldsIn(body, ""),
        updated_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("restaurant_id", params.restaurantId)
      .select("id")
      .maybeSingle();
    if (saveError || !saved) {
      throw new BadRequestException(
        `The draft was NOT restored (${saveError?.message ?? "no row returned"}). Nothing was changed.`,
      );
    }
    return {
      restored: true as const,
      published: false as const,
      fromVersion: Number(version.version),
      locale: String(version.locale),
      draft: body,
    };
  }

  private async stampTemplateUse(restaurantId: string, templateId: string) {
    const { error } = await this.db.client
      .from("communication_templates")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", templateId)
      .eq("restaurant_id", restaurantId);
    // Not fatal, and not silent: the letter is queued either way, and the
    // library will say "unknown" rather than a wrong date.
    if (error) {
      this.logger.warn(
        `letter queued but template ${templateId} last-used not stamped: ${error.message}`,
      );
    }
  }

  // ==========================================================================
  // Dispatch
  // ==========================================================================

  /**
   * Send everything whose window has closed.
   *
   * Called by the letters cron. It sends through the HOUSE's grant, never
   * through `GmailService` — that service holds the deployment's own refresh
   * token and one shared sender address, which is the thing this build retires.
   *
   * A send that fails is recorded as failed, in words. It is never left as
   * QUEUED (the next run would try again forever and the page would show a
   * letter perpetually about to leave) and never marked SENT.
   *
   * A queue that cannot be READ throws. It does not return the zero-shape:
   * `{ considered: 0, sent: 0, ... }` is what a quiet minute looks like, and a
   * database outage that reported it would read as "nothing was due" for as
   * long as the outage lasted, on the one surface (`lastRun`) that exists to
   * say whether letters can still leave. ADR 0161.
   */
  async dispatchDue(nowMs = Date.now()): Promise<{
    considered: number;
    sent: number;
    failed: number;
    skipped: number;
    /** Staff requests put back to waiting because their letter was not sent. */
    rewaited: number;
  }> {
    // A re-wait that did not land on an earlier run is retried first, so
    // `released` never stands on an unsent letter for longer than one run
    // (founder, 2026-09-22: "Back to waiting").
    let rewaited = await this.rewaitRequestsOfFailedLetters();

    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select(
        "id, restaurant_id, provider_id, email_headers, message_text, scheduled_send_at",
      )
      .eq("status", LETTER_STATUS.QUEUED)
      .lte("scheduled_send_at", new Date(nowMs).toISOString())
      .limit(50);

    if (error) {
      // The cron logs this and records it as `lastRun().error`.
      throw new Error(
        `letter dispatch could not read the queue: ${error.message}`,
      );
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of rows) {
      const id = String(row.id);
      const restaurantId = String(row.restaurant_id);
      const headers = (row.email_headers ?? {}) as Record<string, unknown>;
      const to = (headers.to as string | null) ?? null;
      const subject = (headers.subject as string | null) ?? "";
      const writer = (headers.written_by as string | null) ?? "";

      // Claim the row first. Two dispatchers must never both send it.
      const { data: claimed, error: claimError } = await this.db.client
        .from("procurement_conversations")
        .update({ status: "SENDING" })
        .eq("id", id)
        .eq("status", LETTER_STATUS.QUEUED)
        .select("id");
      if (claimError || !claimed || (claimed as unknown[]).length === 0) {
        skipped += 1;
        continue;
      }

      // Set the moment the provider accepted the letter. After that, nothing
      // here may call it failed or put its request back to waiting: that would
      // let a manager release the same letter again.
      let leftTheHouse = false;
      try {
        const identity = await this.sender.resolve(restaurantId, writer);
        // Each failure in its own words: the reason is now shown to the
        // manager and to the person who asked (founder, 2026-09-22).
        if (!identity.sendable) throw new Error(identity.words || "the house's mailbox cannot send");
        if (!identity.grant) throw new Error("the house's mailbox holds no grant to send with");
        if (!to) throw new Error("the queued letter has no recipient recorded");
        const token = await this.oauth.getAccessToken(
          identity.grant.personUserId,
          restaurantId,
          identity.grant.integrationId as IntegrationId,
        );
        const messageId = await sendThroughGrant({
          token,
          from: identity.address ?? identity.grant.accountEmail ?? "",
          to,
          subject,
          text: String(row.message_text ?? ""),
        });
        leftTheHouse = true;
        const { error: sentWriteError } = await this.db.client
          .from("procurement_conversations")
          .update({
            status: LETTER_STATUS.SENT,
            sent_at: new Date().toISOString(),
            delivery_status: "sent",
            gmail_message_id: messageId,
            scheduled_send_at: null,
          })
          .eq("id", id);
        if (sentWriteError) {
          this.logger.error(`house letter ${id} was SENT, but the book could not record it (${sentWriteError.message}).`);
        }
        sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (leftTheHouse) {
          // The provider took it: the letter is sent, whatever failed after.
          this.logger.error(`house letter ${id} was sent, but recording it failed: ${message}`);
          sent += 1;
          continue;
        }
        const { error: failWriteError } = await this.db.client
          .from("procurement_conversations")
          .update({
            status: LETTER_STATUS.FAILED,
            delivery_status: "failed",
            scheduled_send_at: null,
            constraint_flags: { house_letter_failure: message },
          })
          .eq("id", id);
        if (failWriteError) {
          this.logger.error(`house letter ${id} was not sent, and the book could not record the failure (${failWriteError.message}).`);
        }
        this.logger.error(`house letter ${id} was not sent: ${message}`);
        failed += 1;
        // BACK TO WAITING (founder, 2026-09-22, verbatim pick: "Back to
        // waiting (Recommended)"): the staff request this letter was
        // released from goes back to the managers' queue, with the reason
        // shown to the manager and the person who asked.
        if (await this.rewaitAfterFailedSend(restaurantId, id, headers, (row.provider_id as string | null) ?? null, message)) {
          rewaited += 1;
        }
      }
    }

    return { considered: rows.length, sent, failed, skipped, rewaited };
  }

  /**
   * Put the staff request a failed letter was released from back to waiting.
   * Found by the request id the letter carries (stamped at release) or by the
   * letter's own id. Never throws: the letter is already recorded as failed;
   * a re-wait that could not land is logged, and the next run retries it
   * (`rewaitRequestsOfFailedLetters`).
   */
  private async rewaitAfterFailedSend(
    restaurantId: string,
    letterId: string,
    headers: Record<string, unknown>,
    providerId: string | null,
    reason: string,
  ): Promise<boolean> {
    if (!this.requests) return false;
    const stampedRequestId =
      typeof headers.request_id === "string" && headers.request_id.trim() ? headers.request_id.trim() : null;
    try {
      const vendorName = await this.vendorNameOf(restaurantId, providerId);
      const back = await this.requests.rewaitAfterFailedSend({
        restaurantId,
        conversationId: letterId,
        requestId: stampedRequestId,
        reason,
        vendorName,
      });
      if (!back && stampedRequestId) {
        this.logger.error(
          `house letter ${letterId} was not sent, and its staff request ${stampedRequestId} no longer reads as released by it, so it was not put back to waiting.`,
        );
      }
      return back != null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`house letter ${letterId} was not sent, and its staff request was not put back to waiting: ${message}`);
      return false;
    }
  }

  /**
   * The retry: released requests whose linked letter reads FAILED go back to
   * waiting. Never throws; a failed read is logged and retried next run.
   */
  private async rewaitRequestsOfFailedLetters(): Promise<number> {
    if (!this.requests) return 0;
    let stuck: Array<{ row: { id: string; restaurant_id: string; conversation_id: string | null; provider_id: string | null }; reason: string }>;
    try {
      stuck = await this.requests.releasedOnFailedLetters();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`letter dispatch could not read which released requests have a failed letter: ${message}`);
      return 0;
    }
    let n = 0;
    for (const { row, reason } of stuck) {
      if (!row.conversation_id) continue;
      if (
        await this.rewaitAfterFailedSend(
          row.restaurant_id,
          row.conversation_id,
          { request_id: row.id },
          row.provider_id,
          reason,
        )
      ) {
        n += 1;
      }
    }
    return n;
  }

  // ==========================================================================
  // helpers
  // ==========================================================================

  /**
   * How many outbound messages this order has already had — the round count
   * the composer's guardrail and `round_count` read.
   *
   * A `HOUSE_DRAFT` nobody has decided has not reached the vendor, and a
   * `HOUSE_CANCELLED` one never will (PR #476 audit round 1, R2): before this
   * fix, discarding a draft still left it counted, so the composer told a
   * human "this is message 4 on this order" about a conversation that had
   * only had three. Both statuses are excluded here; every other status this
   * table holds — `HOUSE_QUEUED`, `SENT`, `HOUSE_FAILED`, and every AI-path
   * value outside the `LETTER_STATUS` enum — is a round that did, or at least
   * tried to, leave, and still counts.
   */
  private async countOutboundOnOrder(orderId: string): Promise<number> {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select("id, status")
      .eq("order_id", orderId)
      .eq("direction", "outbound");
    if (error) return 0;
    return (data ?? []).filter((r) => {
      const status = String((r as Record<string, unknown>).status ?? "");
      return (
        status !== LETTER_STATUS.DRAFT && status !== LETTER_STATUS.CANCELLED
      );
    }).length;
  }

  /**
   * Re-read every sentence the client says it inserted.
   *
   * The provenance chip is only worth the row it is written from. A sentence
   * the client made up, or one whose row has since been retracted (the
   * generator-version rule, `getStored()` in `insight-generator.service.ts`), is
   * dropped here rather than recorded as if the engine had said it — and the
   * caller is told how many survived.
   */
  private async verifyInsertions(
    restaurantId: string,
    claimed: InsertedInsightDto[],
  ): Promise<Record<string, unknown>[]> {
    if (claimed.length === 0) return [];
    const keys = Array.from(new Set(claimed.map((c) => c.candidateKey)));
    const { data, error } = await this.db.client
      .from("analytics_insights")
      .select(
        "candidate_key, category, sentence, period_start, period_end, computed_at",
      )
      .eq("restaurant_id", restaurantId)
      .in("candidate_key", keys);

    if (error) {
      this.logger.warn(
        `insight provenance could not be re-read (${error.message}) — the letter is queued with NO recorded provenance rather than with an unverified one.`,
      );
      return [];
    }

    const byKey = new Map<string, Record<string, unknown>>();
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      byKey.set(String(r.candidate_key), r);
    }

    const out: Record<string, unknown>[] = [];
    for (const c of claimed) {
      const row = byKey.get(c.candidateKey);
      if (!row) continue;
      if (String(row.sentence ?? "").trim() !== c.sentence.trim()) continue;
      out.push({
        candidate_key: c.candidateKey,
        category: row.category ?? null,
        sentence: row.sentence,
        period_start: row.period_start ?? null,
        period_end: row.period_end ?? null,
        computed_at: row.computed_at ?? null,
      });
    }
    return out;
  }
}

/** Case- and whitespace-insensitive address comparison. */
export function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The merge fields a template body actually declares, in order of appearance. */
export function mergeFieldsIn(
  body: string,
  subject: string,
): { key: string }[] {
  const seen = new Set<string>();
  const out: { key: string }[] = [];
  // Linear for the same reason as UNRESOLVED_TOKEN_RE; the surrounding
  // whitespace the old pattern stripped is stripped below instead.
  const re = /\{\{([^{}]+)\}\}/g;
  for (const source of [subject, body]) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(source)) !== null) {
      const key = m[1].trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key });
    }
  }
  return out;
}

/**
 * Send one letter through the granting account's own Gmail mailbox.
 *
 * Deliberately NOT `GmailService`: that service is built on the deployment's
 * `GMAIL_CLIENT_ID`/`GMAIL_REFRESH_TOKEN` and one shared `senderEmail`
 * (gmail.service.ts:74-80), so every letter it sends leaves from the address
 * shared with every other house. A bearer token from the house's own grant is
 * the whole point.
 *
 * `to` stays a single string for the composer's own caller (`dispatchDue`,
 * above); `cc`/`bcc`/`replyTo`/`threadId`/`inReplyTo`/`references` are new
 * (ADR 0149 #19's person door, relay-email.service.ts) and all optional, so
 * the composer's call is unchanged.
 *
 * NO HEADER VALUE CAN START A NEW HEADER. This function has no DTO in front
 * of it the way `GmailService.createMimeMessage` has (`SINGLE_HEADER_LINE`,
 * communication.dto.ts): a letter's `subject` comes from
 * `email_headers.subject` on a queued row, and `to`/`cc`/`bcc`/`replyTo`/
 * `inReplyTo`/`references` reach it from the relay's person door. A subject
 * of `"hi\r\nBcc: someone@elsewhere"` once added a header nothing here checked
 * (found 2026-09-17, adversarial review of the relay lane). Every header now
 * goes through mime-headers.ts (ADR 0172), the same encoder GmailService
 * uses: free text collapses CR/LF and is RFC 2047 encoded, an address with a
 * control character inside it is REFUSED (throws `MimeHeaderError` before any
 * fetch, so nothing is sent), and the threading values are rebuilt from their
 * `<msg-id>` tokens. The relay lane's own CR/LF stripper was retired for it
 * when main's encoder landed (2026-09-21), so there is one rule, not two.
 *
 * Exported so the spec can prove the request shape without a network.
 */
export async function sendThroughGrant(params: {
  token: string;
  from: string;
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  replyTo?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  fetchImpl?: typeof fetch;
}): Promise<string | null> {
  // `From` is emitted only when we actually know the address. The `gmail_send`
  // grant asks for the send scope and nothing else, so it carries no
  // `openid`/`email` and no address was ever read for it — and `From: ` with
  // nothing after it is a malformed header, which Gmail either rejects or
  // silently repairs. Omitting it lets Gmail stamp the authenticated mailbox,
  // which is the true answer and the one we could not have written ourselves.
  //
  // Headers go through mime-headers.ts (ADR 0172): a Turkish subject is RFC
  // 2047 encoded rather than sent as raw bytes, a line break in the subject
  // cannot start a new header, and the body is base64 under its UTF-8 charset.
  // The person door's cc/bcc/reply-to and threading go through the same
  // encoder (see the doc comment above); a threading value with no usable
  // <msg-id> writes no header, and the reply is still sent.
  const from = params.from.trim();
  const to = Array.isArray(params.to) ? params.to : [params.to];
  const inReplyTo = threadingHeader("In-Reply-To", params.inReplyTo);
  const references = threadingHeader("References", params.references);
  const mime = [
    ...(from ? [addressListHeader("From", [from])] : []),
    addressListHeader("To", to),
    ...(params.cc?.length ? [addressListHeader("Cc", params.cc)] : []),
    ...(params.bcc?.length ? [addressListHeader("Bcc", params.bcc)] : []),
    unstructuredHeader("Subject", params.subject),
    ...(params.replyTo
      ? [addressListHeader("Reply-To", [params.replyTo])]
      : []),
    ...(inReplyTo ? [inReplyTo] : []),
    ...(references ? [references] : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(params.text),
  ].join("\r\n");

  const doFetch = params.fetchImpl ?? fetch;
  const response = await doFetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw: Buffer.from(mime).toString("base64url"),
        ...(params.threadId ? { threadId: params.threadId } : {}),
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // The one failure worth naming precisely: the grant exists but does not
    // permit sending. Widening the scope silently is the thing ADR 0118 refuses.
    if (response.status === 403) {
      throw new Error(
        `Google refused the send (403). The connected account's grant does not include ${"https://www.googleapis.com/auth/gmail.send"}; that consent has to be asked for by name, not added behind the account holder's back. ${detail.slice(0, 300)}`,
      );
    }
    throw new Error(
      `Google refused the send (${response.status}). ${detail.slice(0, 300)}`,
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    id?: string;
  } | null;
  return payload?.id ?? null;
}
