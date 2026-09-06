/**
 * A vendor's WhatsApp reply, threaded onto the house's own conversation book.
 *
 * ADR 0121 P1: *"Inbound webhook threads onto `procurement_conversations`"*,
 * and *"The mirror is a precondition, not a follow-up. Every inbound and every
 * outbound is written to `procurement_conversations` before it is rendered
 * anywhere. Meta holds the transport; the house's book holds the record."*
 *
 * THE SAME PROVENANCE SHAPE THE MAIL PATH USES
 * --------------------------------------------
 * `RabbitMqBridgeService.handleInboundEmail` (`rabbitmq-bridge.service.ts:745`)
 * writes an inbound vendor reply as: `direction: "inbound"`, a `channel`, the
 * body in `message_text`, `received_at`, `delivery_status: "delivered"`, the
 * provider's own id in `message_id`, and the transport's raw envelope in the
 * `email_headers` jsonb. Every one of those is written here with the same
 * meaning and the same column, so a WhatsApp reply and a mail reply are the
 * same kind of row to every reader downstream — the thread view, the round
 * count, the weekly report. `email_headers` keeps its name because renaming a
 * column on the busiest table in the product to suit a second channel is a
 * migration with no upside; what it holds is the transport envelope, and it
 * says which transport.
 *
 * THREE REFUSALS THAT ARE NOT ERRORS, AND ARE NOT SILENCE EITHER
 * ---------------------------------------------------------------
 *  1. **No sender matches `metadata.phone_number_id`.** The message arrived at
 *     a number this deployment does not hold a credential for. Nothing is
 *     written: there is no house to write it to, and picking one from the body
 *     would let anybody who guessed a WABA id write into a tenant's book.
 *  2. **The number is not in that house's book.** ADR 0118 D3's book-only rule,
 *     read backwards. `procurement_conversations.provider_id` is NOT NULL, so
 *     there is literally no row to write — and inventing a provider from a
 *     stranger's WhatsApp profile name is how a vendor list acquires rows
 *     nobody added.
 *  3. **We have seen this `wamid` before.** Meta retries a webhook it did not
 *     get a 200 for, so a threading path with no idempotency writes the same
 *     vendor sentence into a house's book three times.
 *
 * None of the three is silent. Each returns a counted outcome with a reason,
 * the caller reports them, and the route's response says what happened to every
 * message in the payload. A webhook that returned a bare 200 while storing
 * nothing is [[absence-reported-as-health]] on a path where nobody would ever
 * look.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../database/database.service";
import { WhatsAppBookService, WHATSAPP_CHANNEL } from "./whatsapp-book.service";
import type { InboundWhatsAppMessage } from "./meta-webhook-payload";

export type InboundDisposition =
  | "threaded"
  | "already_stored"
  | "no_sender_for_number"
  | "not_in_book"
  | "book_unreadable"
  | "write_failed";

export interface InboundResult {
  wamid: string;
  disposition: InboundDisposition;
  /** The sentence for a log or an operator. Always populated. */
  says: string;
  conversationId?: string;
  restaurantId?: string;
  providerId?: string;
}

interface SenderMatch {
  senderId: string;
  restaurantId: string;
}

@Injectable()
export class WhatsAppInboundService {
  private readonly logger = new Logger(WhatsAppInboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly book: WhatsAppBookService,
  ) {}

  private get sb() {
    return this.db.client;
  }

  /**
   * Which house owns the number a message arrived at.
   *
   * Resolved from `house_text_sender_credentials.sender_ref`, which is where a
   * Meta business phone number id lives (that table's own column comment). The
   * tenant therefore comes from OUR row, never from the payload.
   */
  private async senderFor(
    phoneNumberId: string,
  ): Promise<SenderMatch | null | undefined> {
    const { data, error } = await this.sb
      .from("house_text_sender_credentials")
      .select("sender_id, restaurant_id")
      .eq("provider", "meta_cloud")
      .eq("sender_ref", phoneNumberId)
      .is("revoked_at", null)
      .limit(1);

    if (error) {
      this.logger.error(`senderFor read failed: ${error.message}`);
      return null;
    }
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      senderId: String(row.sender_id),
      restaurantId: String(row.restaurant_id),
    };
  }

  /** Have we stored this `wamid` already? `null` means we could not tell. */
  private async alreadyStored(wamid: string): Promise<boolean | null> {
    const { data, error } = await this.sb
      .from("procurement_conversations")
      .select("id")
      .eq("channel", WHATSAPP_CHANNEL)
      .eq("message_id", wamid)
      .limit(1);
    if (error) {
      this.logger.error(`alreadyStored read failed: ${error.message}`);
      return null;
    }
    return (data ?? []).length > 0;
  }

  /**
   * Thread one message. Never throws: a webhook that 500s makes Meta retry
   * forever, and the retry would arrive at the same broken state.
   */
  async thread(message: InboundWhatsAppMessage): Promise<InboundResult> {
    const sender = await this.senderFor(message.phoneNumberId);
    if (sender === null) {
      return {
        wamid: message.wamid,
        disposition: "book_unreadable",
        says: "Which house this number belongs to could not be read, so nothing was stored. The message is not lost at Meta; it was not written here.",
      };
    }
    if (sender === undefined) {
      return {
        wamid: message.wamid,
        disposition: "no_sender_for_number",
        says: `No house on this deployment holds a live WhatsApp credential for business phone number id ${message.phoneNumberId}, so there is no conversation book to write this into. Nothing was stored.`,
      };
    }

    const seen = await this.alreadyStored(message.wamid);
    if (seen === null) {
      return {
        wamid: message.wamid,
        disposition: "book_unreadable",
        restaurantId: sender.restaurantId,
        says: "Whether this message was already stored could not be read, so it was not written again. Writing it anyway would risk a duplicate in a house's own conversation.",
      };
    }
    if (seen) {
      return {
        wamid: message.wamid,
        disposition: "already_stored",
        restaurantId: sender.restaurantId,
        says: "This message is already in the house's book. Meta retries a webhook it did not get a 200 for, so this is the expected outcome of a retry and nothing was written twice.",
      };
    }

    const entry = await this.book.providerForWaId(
      sender.restaurantId,
      message.fromWaId,
    );
    if (entry === null) {
      return {
        wamid: message.wamid,
        disposition: "book_unreadable",
        restaurantId: sender.restaurantId,
        says: "This house's vendor book could not be read, so which vendor wrote could not be established and nothing was stored.",
      };
    }
    if (entry === undefined) {
      return {
        wamid: message.wamid,
        disposition: "not_in_book",
        restaurantId: sender.restaurantId,
        says: `A WhatsApp message arrived from a number that is not in this house's vendor book, so it was not threaded onto any conversation. Nothing was stored and no vendor was created from it — add the number to the vendor's contacts to see their messages here.`,
      };
    }

    const receivedAt = message.timestamp
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : new Date().toISOString();

    // A non-text message is recorded as WHAT IT IS. Writing an empty body or a
    // summary we invented would put a sentence in a vendor's mouth, which is
    // the fabrication ADR 0084 removed from the outbound side.
    const body =
      message.text ??
      `[${message.type} message — this build stores WhatsApp text only; open WhatsApp to see it]`;

    const { data: inserted, error } = await this.sb
      .from("procurement_conversations")
      .insert({
        order_id: null,
        restaurant_id: sender.restaurantId,
        provider_id: entry.providerId,
        direction: "inbound",
        channel: WHATSAPP_CHANNEL,
        message_text: body,
        ai_generated: false,
        received_at: receivedAt,
        // Meta delivered it to us. That is what this word means on the mail
        // path too, and it is a fact about OUR receipt, never about a handset.
        delivery_status: "delivered",
        message_id: message.wamid,
        // The transport envelope, same column and same meaning as the mail
        // path's (`rabbitmq-bridge.service.ts:760`). It says which transport,
        // so a reader never has to infer it from the shape of the keys.
        email_headers: {
          transport: "whatsapp_cloud_api",
          waba_id: message.wabaId,
          phone_number_id: message.phoneNumberId,
          display_phone_number: message.displayPhoneNumber,
          from_wa_id: message.fromWaId,
          profile_name: message.profileName,
          message_type: message.type,
          wamid: message.wamid,
          provider_timestamp: message.timestamp,
        },
        // No order is matched here, and the column says so rather than guessing.
        // The mail path's order fallback keys on a Gmail thread; a WhatsApp
        // thread has no order in it, and attaching one on "most recent open
        // order" would put a vendor's sentence on an order they never mentioned.
        confidence_score: null,
      })
      .select("id")
      .single();

    if (error) {
      // READ, not swallowed. Supabase RETURNS `{data, error}` rather than
      // throwing, so a `try/catch` around this would be inert and the row would
      // vanish with nothing saying so (`pos-hub.service.ts:950` is the instance
      // that taught this repo the lesson).
      this.logger.error(
        `WhatsApp inbound insert failed for ${message.wamid}: ${error.message}`,
      );
      return {
        wamid: message.wamid,
        disposition: "write_failed",
        restaurantId: sender.restaurantId,
        providerId: entry.providerId,
        says: `This message could not be written to the house's book (${error.message}), so it is NOT recorded. Meta will retry, and the retry will be stored if the write succeeds then.`,
      };
    }

    return {
      wamid: message.wamid,
      disposition: "threaded",
      conversationId: String(inserted.id),
      restaurantId: sender.restaurantId,
      providerId: entry.providerId,
      says: `Threaded onto ${entry.providerName || "this vendor"}'s conversation. The house's 24-hour window with them is now open.`,
    };
  }
}
