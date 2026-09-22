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
import type {
  InboundWhatsAppMessage,
  WhatsAppStatusCallback,
} from "./meta-webhook-payload";

export type InboundDisposition =
  | "threaded"
  | "already_stored"
  | "no_sender_for_number"
  | "sender_ambiguous"
  | "not_in_book"
  /** The number is held by more than one vendor in the house's book. */
  | "book_ambiguous"
  | "book_unreadable"
  | "write_failed";

export type StatusDisposition =
  /** Written onto the house's own outbound row. */
  | "applied"
  /** The row already carries this status or a later one. Nothing written. */
  | "not_newer"
  /** Meta sent a status word this build does not apply (it is logged). */
  | "status_not_applied"
  | "no_sender_for_number"
  | "sender_ambiguous"
  /** No outbound row in that house carries this wamid. */
  | "no_matching_message"
  /** More than one outbound row in that house carries this wamid. */
  | "message_ambiguous"
  | "book_unreadable"
  | "write_failed";

export interface StatusResult {
  wamid: string;
  status: string;
  disposition: StatusDisposition;
  /** The sentence for a log or an operator. Always populated. */
  says: string;
}

/**
 * Which outbound states each Meta status may move a row FROM.
 *
 * Meta does not promise order: a `read` can arrive before its `delivered`,
 * and a retried `sent` can arrive after both. A status therefore only ever
 * moves a row FORWARD, and the rule is enforced in the UPDATE's own WHERE
 * clause (`.in("delivery_status", …)`) rather than by a read followed by a
 * write, so two callbacks landing at once cannot walk a row backwards.
 *
 * Only states that can carry a `wamid` are listed: `WhatsAppSendService`
 * writes `message_id` in the same update that writes `accepted_by_provider`,
 * so an `attempting`, `unknown` or `refused_by_provider` row has no id for a
 * callback to match.
 *
 * `failed` never overwrites `delivered` or `read`: a handset that showed the
 * message has shown it, and a later failure cannot unsay that.
 */
const STATUS_ADVANCES_FROM: Record<string, readonly string[]> = {
  sent: ["accepted_by_provider"],
  delivered: ["accepted_by_provider", "sent"],
  read: ["accepted_by_provider", "sent", "delivered"],
  failed: ["accepted_by_provider", "sent"],
};

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
  ): Promise<SenderMatch | "ambiguous" | null | undefined> {
    // The migration enforces one live credential for a Meta number. Still
    // refuse any duplicate during an incomplete rollout instead of selecting
    // one by row order (including two same-house rows hiding a third house).
    const { data, error } = await this.sb
      .from("house_text_sender_credentials")
      .select("sender_id, restaurant_id")
      .eq("provider", "meta_cloud")
      .eq("sender_ref", phoneNumberId)
      .is("revoked_at", null)
      .limit(2);

    if (error) {
      this.logger.error(`senderFor read failed: ${error.message}`);
      return null;
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    const row = rows[0];
    if (!row) return undefined;
    if (rows.length > 1) {
      this.logger.warn(
        `senderFor: more than one live meta_cloud credential exists for phone number id ${phoneNumberId}; not threading`,
      );
      return "ambiguous";
    }
    // Revoking the sender is effective even if its credential row remains.
    const sender = await this.sb
      .from("house_text_senders")
      .select("id")
      .eq("id", row.sender_id)
      .eq("restaurant_id", row.restaurant_id)
      .is("revoked_at", null)
      .neq("state", "revoked")
      .maybeSingle();
    if (sender.error) {
      // Logged before returning: a null here becomes `book_unreadable` and a
      // 503, and an operator reading that retry needs the database's reason.
      this.logger.error(
        `senderFor house_text_senders read failed: ${sender.error.message}`,
      );
      return null;
    }
    if (!sender.data) return undefined;
    return {
      senderId: String(row.sender_id),
      restaurantId: String(row.restaurant_id),
    };
  }

  /** Have we stored this `wamid` already? `null` means we could not tell. */
  private async alreadyStored(
    restaurantId: string,
    wamid: string,
  ): Promise<boolean | null> {
    const { data, error } = await this.sb
      .from("procurement_conversations")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .eq("channel", WHATSAPP_CHANNEL)
      .eq("direction", "inbound")
      .eq("message_id", wamid)
      .limit(1);
    if (error) {
      this.logger.error(`alreadyStored read failed: ${error.message}`);
      return null;
    }
    return (data ?? []).length > 0;
  }

  /**
   * Thread one message. Transient failures are reported to the controller,
   * which returns a retryable status; permanent routing refusals are counted.
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
    if (sender === "ambiguous") {
      return {
        wamid: message.wamid,
        disposition: "sender_ambiguous",
        says: `More than one live WhatsApp credential exists on this deployment for business phone number id ${message.phoneNumberId}, so which house's book this belongs to cannot be established. Nothing was stored; picking one would put a vendor's message in the wrong house.`,
      };
    }
    if (sender === undefined) {
      return {
        wamid: message.wamid,
        disposition: "no_sender_for_number",
        says: `No house on this deployment holds a live WhatsApp credential for business phone number id ${message.phoneNumberId}, so there is no conversation book to write this into. Nothing was stored.`,
      };
    }

    const seen = await this.alreadyStored(sender.restaurantId, message.wamid);
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
    if (entry === "ambiguous") {
      return {
        wamid: message.wamid,
        disposition: "book_ambiguous",
        restaurantId: sender.restaurantId,
        says: "A WhatsApp message arrived from a number that more than one vendor in this house's book holds, so which vendor wrote cannot be established. Nothing was stored — threading it onto the wrong vendor's conversation would be worse than not threading it. Remove the number from the vendor it does not belong to.",
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

    if (
      error?.code === "23505" &&
      (await this.alreadyStored(sender.restaurantId, message.wamid)) === true
    ) {
      return {
        wamid: message.wamid,
        disposition: "already_stored",
        restaurantId: sender.restaurantId,
        says: "This message was recorded by another delivery. Nothing was written twice.",
      };
    }
    if (error || !inserted?.id) {
      // READ, not swallowed. Supabase RETURNS `{data, error}` rather than
      // throwing, so a `try/catch` around this would be inert and the row would
      // vanish with nothing saying so (`pos-hub.service.ts:950` is the instance
      // that taught this repo the lesson).
      this.logger.error(
        `WhatsApp inbound insert failed for ${message.wamid}: ${error?.message ?? "no receipt returned"}`,
      );
      return {
        wamid: message.wamid,
        disposition: "write_failed",
        restaurantId: sender.restaurantId,
        providerId: entry.providerId,
        says: `This message could not be written to the house's book so recording is NOT confirmed. Meta can retry; a stored copy will be recognized without writing it twice.`,
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

  /**
   * One delivery-status callback, written onto the house's OWN outbound row.
   *
   * Before this, statuses were counted and dropped, so an outbound row stayed
   * `accepted_by_provider` even after Meta reported it `failed` — the house's
   * book never learned of an asynchronous failure, which is the mirror rule
   * (ADR 0121 P1: "the house's book holds the record") with its second half
   * missing.
   *
   * TENANT FROM OUR ROW, AGAIN. The house is resolved from the credential
   * that holds `metadata.phone_number_id`, exactly as for a message, and the
   * row is matched by `wamid` INSIDE that house. A status can never touch a
   * row in a house other than the one that owns the sending number.
   *
   * ONLY FORWARD. See `STATUS_ADVANCES_FROM`.
   */
  async applyStatus(callback: WhatsAppStatusCallback): Promise<StatusResult> {
    const base = { wamid: callback.wamid, status: callback.status };
    const advancesFrom = STATUS_ADVANCES_FROM[callback.status];
    if (!advancesFrom) {
      return {
        ...base,
        disposition: "status_not_applied",
        says: `Meta reported the status "${callback.status}", which this build does not write onto a conversation row. Nothing was changed.`,
      };
    }

    const sender = await this.senderFor(callback.phoneNumberId);
    if (sender === null) {
      return {
        ...base,
        disposition: "book_unreadable",
        says: "Which house this number belongs to could not be read, so the status was not applied.",
      };
    }
    if (sender === "ambiguous") {
      return {
        ...base,
        disposition: "sender_ambiguous",
        says: `More than one live WhatsApp credential exists for business phone number id ${callback.phoneNumberId}, so which house sent this message cannot be established. The status was not applied.`,
      };
    }
    if (sender === undefined) {
      return {
        ...base,
        disposition: "no_sender_for_number",
        says: `No house on this deployment holds a live WhatsApp credential for business phone number id ${callback.phoneNumberId}. The status was not applied.`,
      };
    }

    const { data, error } = await this.sb
      .from("procurement_conversations")
      .select("id, delivery_status, email_headers")
      .eq("restaurant_id", sender.restaurantId)
      .eq("channel", WHATSAPP_CHANNEL)
      .eq("direction", "outbound")
      .eq("message_id", callback.wamid)
      .limit(2);
    if (error) {
      this.logger.error(`applyStatus read failed: ${error.message}`);
      return {
        ...base,
        disposition: "book_unreadable",
        says: "The house's outbound message could not be read, so the status was not applied.",
      };
    }
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) {
      return {
        ...base,
        disposition: "no_matching_message",
        says: "No message this house sent carries this id, so the status describes nothing in its book and was not applied.",
      };
    }
    if (rows.length > 1) {
      this.logger.warn(
        `applyStatus: more than one outbound row in restaurant ${sender.restaurantId} carries wamid ${callback.wamid}; not applying ${callback.status}`,
      );
      return {
        ...base,
        disposition: "message_ambiguous",
        says: "More than one message in this house's book carries this id, so which one the status describes cannot be established. It was not applied.",
      };
    }

    const row = rows[0];
    const current = typeof row.delivery_status === "string" ? row.delivery_status : null;
    if (current === null || !advancesFrom.includes(current)) {
      return {
        ...base,
        disposition: "not_newer",
        says: `The message is already recorded as "${current ?? "no status"}", which "${callback.status}" does not move forward. Nothing was changed.`,
      };
    }

    const headers =
      row.email_headers && typeof row.email_headers === "object"
        ? (row.email_headers as Record<string, unknown>)
        : {};
    const { data: updated, error: updateError } = await this.sb
      .from("procurement_conversations")
      .update({
        // Meta's own word, verbatim. `delivered` and `read` are facts Meta
        // reports about the vendor's handset; `failed` is Meta saying the
        // message it accepted did not arrive.
        delivery_status: callback.status,
        email_headers: {
          ...headers,
          provider_status: callback.status,
          provider_status_at: callback.timestamp
            ? new Date(Number(callback.timestamp) * 1000).toISOString()
            : null,
          provider_status_recipient: callback.recipientId,
          ...(callback.status === "failed"
            ? {
                provider_error_code: callback.errorCode,
                provider_error_title: callback.errorTitle,
              }
            : {}),
        },
      })
      .eq("restaurant_id", sender.restaurantId)
      .eq("id", row.id)
      // The forward-only rule, in the statement itself: if another callback
      // moved the row since the read above, this matches nothing.
      .in("delivery_status", [...advancesFrom])
      .select("id");
    if (updateError) {
      this.logger.error(
        `applyStatus update failed for ${callback.wamid}: ${updateError.message}`,
      );
      return {
        ...base,
        disposition: "write_failed",
        says: "The status could not be written to the house's book. Meta can retry.",
      };
    }
    if (!updated || (updated as unknown[]).length === 0) {
      return {
        ...base,
        disposition: "not_newer",
        says: "Another callback moved this message's status first, and this one does not move it further. Nothing was changed.",
      };
    }
    return {
      ...base,
      disposition: "applied",
      says:
        callback.status === "failed"
          ? `Meta reported that this message FAILED after accepting it${callback.errorCode ? ` (code ${callback.errorCode}${callback.errorTitle ? `, ${callback.errorTitle}` : ""})` : ""}. The house's book now says so.`
          : `Meta reported this message as ${callback.status}. The house's book now says so.`,
    };
  }
}
