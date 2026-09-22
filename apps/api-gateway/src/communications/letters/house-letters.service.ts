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
import {
  addressListHeader,
  base64Body,
  unstructuredHeader,
} from "../mime-headers";
import type {
  InsertedInsightDto,
  QueueLetterDto,
  UpsertLetterTemplateDto,
} from "./house-letters.dto";

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
  QUEUED: "HOUSE_QUEUED",
  CANCELLED: "HOUSE_CANCELLED",
  FAILED: "HOUSE_FAILED",
  SENT: "SENT",
} as const;

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

/** The five vendor purposes. A staff broadcast is deliberately not one. */
export const LETTER_CATEGORIES = [
  "order_confirmation",
  "price_query",
  "delivery_dispute",
  "invoice_mismatch",
  "promotion_reply",
] as const;

export type LetterCategory = (typeof LETTER_CATEGORIES)[number];

/** `type` on `communication_templates`, so a letter template never collides
 *  with the legacy email/sms workshop rows or with `sender_identity`
 *  (procurement.service.ts:2697-2703 filters on that last one). */
export const LETTER_TEMPLATE_TYPE = "letter";

export type { GuardrailHit } from "./composer-guardrails";

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

    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .insert({
        order_id: dto.orderId ?? null,
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
        },
      })
      .select("id")
      .single();

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
   */
  async cancel(params: {
    restaurantId: string;
    id: string;
    /** Who pulled it back — named on the staff request it re-opens, if any. */
    userId?: string | null;
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
        "That letter left the queue a moment ago (the dispatcher may hold it), so it was NOT cancelled. The conversation book will say what happened to it.",
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
    // for a letter queued before the id was stamped, or one no request asked for).
    const headers = (row.email_headers ?? {}) as Record<string, unknown>;
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

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
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

    const payload = {
      restaurant_id: restaurantId,
      name: dto.name,
      subject: dto.subject ?? null,
      body: dto.body,
      type: LETTER_TEMPLATE_TYPE,
      category: dto.category,
      merge_fields: mergeFieldsIn(dto.body, dto.subject ?? ""),
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
      throw new BadRequestException(
        `The template was NOT saved (${error?.message ?? "no row returned"}). Nothing was stored.`,
      );
    }
    return { id: String((data as Record<string, unknown>).id), saved: true };
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
   */
  async dispatchDue(nowMs = Date.now()): Promise<{
    considered: number;
    sent: number;
    failed: number;
    skipped: number;
  }> {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select(
        "id, restaurant_id, provider_id, email_headers, message_text, scheduled_send_at",
      )
      .eq("status", LETTER_STATUS.QUEUED)
      .lte("scheduled_send_at", new Date(nowMs).toISOString())
      .limit(50);

    if (error) {
      this.logger.error(
        `letter dispatch could not read the queue: ${error.message}`,
      );
      return { considered: 0, sent: 0, failed: 0, skipped: 0 };
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

      try {
        const identity = await this.sender.resolve(restaurantId, writer);
        if (!identity.sendable || !identity.grant || !to) {
          throw new Error(
            identity.sendable
              ? "the queued letter has no recipient recorded"
              : identity.words,
          );
        }
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
        await this.db.client
          .from("procurement_conversations")
          .update({
            status: LETTER_STATUS.SENT,
            sent_at: new Date().toISOString(),
            delivery_status: "sent",
            gmail_message_id: messageId,
            scheduled_send_at: null,
          })
          .eq("id", id);
        sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await this.db.client
          .from("procurement_conversations")
          .update({
            status: LETTER_STATUS.FAILED,
            delivery_status: "failed",
            scheduled_send_at: null,
            constraint_flags: { house_letter_failure: message },
          })
          .eq("id", id);
        this.logger.error(`house letter ${id} was not sent: ${message}`);
        failed += 1;
      }
    }

    return { considered: rows.length, sent, failed, skipped };
  }

  // ==========================================================================
  // helpers
  // ==========================================================================

  private async countOutboundOnOrder(orderId: string): Promise<number> {
    const { data, error } = await this.db.client
      .from("procurement_conversations")
      .select("id")
      .eq("order_id", orderId)
      .eq("direction", "outbound");
    if (error) return 0;
    return (data ?? []).length;
  }

  /**
   * Re-read every sentence the client says it inserted.
   *
   * The provenance chip is only worth the row it is written from. A sentence
   * the client made up, or one whose row has since been retracted (the
   * generator-version rule in `insight-generator.service.ts:283-296`), is
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
 * Exported so the spec can prove the request shape without a network.
 */
export async function sendThroughGrant(params: {
  token: string;
  from: string;
  to: string;
  subject: string;
  text: string;
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
  const from = params.from.trim();
  const mime = [
    ...(from ? [addressListHeader("From", [from])] : []),
    addressListHeader("To", [params.to]),
    unstructuredHeader("Subject", params.subject),
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
      body: JSON.stringify({ raw: Buffer.from(mime).toString("base64url") }),
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
