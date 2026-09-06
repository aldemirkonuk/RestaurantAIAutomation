/**
 * The house answering a vendor on WhatsApp — the dispatch ADR 0121 P1 asks for.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * ---------------------------------------------
 * It is **a reply, inside an open 24-hour customer service window, and nothing
 * else.** There is no template, so there is no house-initiated conversation and
 * no Meta charge (*"All non-template messages are free"*, Meta pricing; a
 * non-template message can only be sent inside an open window). ADR 0121 puts
 * templates in P2, behind the seal, and this file has no path to one.
 *
 * A SEND OUTSIDE THE WINDOW IS REFUSED, NOT QUEUED
 * ------------------------------------------------
 * That sentence is the whole point of the ordering below. Nothing here has a
 * retry, a backlog or a scheduled column: a closed window returns a refusal
 * whose words say *"nothing was sent and nothing was queued — it will not go
 * out when they next reply"*. Queuing would be the worse failure, because the
 * message would then leave hours later, out of context, in the house's name.
 *
 * THE ORDER, AND WHY EACH STEP IS WHERE IT IS
 * -------------------------------------------
 *   1. **the book** — ADR 0118 D3: no free-text recipient. The reply is
 *      addressed to the number the vendor actually WROTE FROM, taken off the
 *      mirrored inbound row, which is in the book by construction because
 *      `WhatsAppInboundService` refuses to thread a number that is not.
 *   2. **the composer's guards** — `composerGuardrails`, the same function the
 *      letter path runs, unchanged. A blocking hit refuses before anything else
 *      is read, because a commitment sentence is a commitment sentence whatever
 *      the window says.
 *   3. **the window** — open, closed, or unknown. Three verdicts.
 *   4. **the transport** — a credential must resolve. A house with no provider
 *      account hears that, not "the transport is not built".
 *   5. **the money gate** — AFTER the transport, because a house on its own
 *      keys is not spending Mudavym's allowance and asking the meter first
 *      would refuse a house that owes us nothing. This is the same order
 *      `TextSenderService.send` uses and for the same reason.
 *   6. **the mirror** — the outbound row is written to
 *      `procurement_conversations` BEFORE the provider is asked. ADR 0121: the
 *      mirror is a precondition, not a follow-up. It is also the intent-row
 *      discipline the credits path already uses: a write that happens after a
 *      crash never happens, so the record has to exist before the call that can
 *      crash.
 *   7. **the dispatch**, then the row is updated with what came back, then
 *      **one meter row**, written whatever the outcome was.
 *
 * WHAT A FAILURE AFTER STEP 6 LOOKS LIKE, STATED
 * ----------------------------------------------
 * If the dispatch does not complete, the mirror row stays with
 * `delivery_status = 'unknown'` and the house sees a message it cannot be sure
 * about — which is true. It is NOT reported as sent and it is NOT reported as
 * failed. The same one-sided honesty the purchase-intent reconciler uses: a
 * timed-out POST may have been accepted, and telling a manager it failed is how
 * a vendor gets the same message twice.
 */

import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import {
  composerGuardrails,
  type GuardrailHit,
} from "../letters/composer-guardrails";
import { TextSenderService, SENDABLE_STATE } from "./text-sender.service";
import { TextUsageService } from "./text-usage.service";
import { TextTransportRegistry } from "./providers/text-transport.registry";
import { TextDispatchService } from "./providers/text-dispatch.service";
import { WhatsAppBookService, WHATSAPP_CHANNEL } from "./inbound/whatsapp-book.service";
import type { WindowReadout } from "./inbound/whatsapp-book.service";

export type WhatsAppRefusal =
  | "no_sender"
  | "sender_not_connected"
  | "not_in_book"
  | "guardrail"
  | "window_closed"
  | "window_unknown"
  | "no_provider_account"
  | "allowance_spent"
  | "allowance_unknown"
  | "read_failed"
  | "mirror_failed"
  | "refused_by_provider";

export interface WhatsAppSendOutcome {
  /**
   * True ONLY when the provider accepted it and returned its own message id.
   * `accepted_by_provider` is Meta holding it, never a handset showing it —
   * the same distinction `team_note_deliveries` draws.
   */
  sent: boolean;
  refusal: WhatsAppRefusal | null;
  /** The sentence a manager reads. Always populated, never a bare code. */
  words: string;
  /** Blocking and non-blocking hits, so the surface can show both. */
  guardrails: GuardrailHit[];
  /** The mirrored conversation row, when one was written. */
  conversationId: string | null;
  /** Meta's `wamid`, when it gave one. NEVER a placeholder. */
  providerRef: string | null;
  /** The meter row, when one was written. `false` says the ledger missed it. */
  metered: boolean;
  window: WindowReadout | null;
}

@Injectable()
export class WhatsAppSendService {
  private readonly logger = new Logger(WhatsAppSendService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly senders: TextSenderService,
    private readonly book: WhatsAppBookService,
    private readonly transports: TextTransportRegistry,
    private readonly usage: TextUsageService,
    private readonly dispatch: TextDispatchService,
  ) {}

  private get sb() {
    return this.db.client;
  }

  private refuse(
    refusal: WhatsAppRefusal,
    words: string,
    extra: Partial<WhatsAppSendOutcome> = {},
  ): WhatsAppSendOutcome {
    return {
      sent: false,
      refusal,
      words,
      guardrails: [],
      conversationId: null,
      providerRef: null,
      metered: false,
      window: null,
      ...extra,
    };
  }

  /**
   * The number this vendor last wrote from, off the mirrored inbound row.
   *
   * NOT off the book directly, and that is the book-only rule tightened rather
   * than loosened: this number is in the book (the inbound path refused to
   * thread it otherwise) AND it is demonstrably a number that reaches this
   * vendor on WhatsApp. A number picked out of the book instead might be a
   * landline the vendor never used — which is the P0 item-2 failure, one table
   * over.
   */
  private async replyAddress(
    restaurantId: string,
    providerId: string,
  ): Promise<{ waId: string | null; readable: boolean; reason: string | null }> {
    const { data, error } = await this.sb
      .from("procurement_conversations")
      .select("email_headers")
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .eq("channel", WHATSAPP_CHANNEL)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      this.logger.error(`replyAddress read failed: ${error.message}`);
      return { waId: null, readable: false, reason: error.message };
    }
    const headers = ((data ?? [])[0] as Record<string, unknown> | undefined)
      ?.email_headers as Record<string, unknown> | undefined;
    const waId = headers && typeof headers.from_wa_id === "string" ? headers.from_wa_id : null;
    return { waId, readable: true, reason: null };
  }

  /** How many messages the house has already sent this vendor on this channel. */
  private async priorOutbound(
    restaurantId: string,
    providerId: string,
  ): Promise<number | null> {
    const { count, error } = await this.sb
      .from("procurement_conversations")
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("provider_id", providerId)
      .eq("channel", WHATSAPP_CHANNEL)
      .eq("direction", "outbound");
    if (error) {
      // NULL, not 0. `composerGuardrails` treats null as "not counted" and
      // omits the round-count notice rather than printing "this is message 1"
      // for a thread it could not read.
      this.logger.error(`priorOutbound count failed: ${error.message}`);
      return null;
    }
    return typeof count === "number" ? count : null;
  }

  async reply(params: {
    restaurantId: string;
    userId: string;
    providerId: string;
    body: string;
    now?: number;
  }): Promise<WhatsAppSendOutcome> {
    const nowMs = params.now ?? Date.now();

    // ── 1. the sender ────────────────────────────────────────────────────
    const readout = await this.senders.readout(params.restaurantId);
    if (!readout.readable) {
      return this.refuse(
        "read_failed",
        `This house's senders could not be read, so nothing was attempted: ${readout.reason}. That is not the same as this house having no sender.`,
      );
    }
    const sender = readout.whatsapp;
    if (!sender) {
      return this.refuse(
        "no_sender",
        "This house has no WhatsApp sender, so nothing was sent. A sender is declared on the Connections page.",
      );
    }
    if (sender.state !== SENDABLE_STATE) {
      return this.refuse(
        "sender_not_connected",
        `This house's WhatsApp sender is ${sender.state} rather than connected, so nothing was sent. A declared sender is a record of a registration, not a reachable number.`,
      );
    }

    // ── 2. the book ──────────────────────────────────────────────────────
    const address = await this.replyAddress(params.restaurantId, params.providerId);
    if (!address.readable) {
      return this.refuse(
        "read_failed",
        `This vendor's WhatsApp conversation could not be read, so nothing was attempted (${address.reason}).`,
      );
    }
    if (!address.waId) {
      return this.refuse(
        "not_in_book",
        "This vendor has never written to this house on WhatsApp, so there is no conversation to reply inside and no number to reply to. Nothing was sent and nothing was queued.",
      );
    }

    // ── 3. the composer's guards, unchanged ──────────────────────────────
    const prior = await this.priorOutbound(params.restaurantId, params.providerId);
    const hits = composerGuardrails({
      body: params.body,
      // No subject on this channel. Joining an empty one changes nothing about
      // what the commitment scan finds in the body.
      subject: "",
      priorOutboundOnOrder: prior,
    });
    const blocking = hits.filter((h) => h.blocking);
    if (blocking.length > 0) {
      return {
        ...this.refuse("guardrail", blocking.map((h) => h.says).join(" ")),
        guardrails: hits,
      };
    }

    // ── 4. the window ────────────────────────────────────────────────────
    const window = await this.book.windowFor(
      params.restaurantId,
      params.providerId,
      nowMs,
    );
    if (window.state !== "open") {
      // TWO refusals, not one. A closed window is something the house can act
      // on; an unread window is ours. Collapsing them tells a manager to "start
      // with a template" for our own failed read.
      return {
        ...this.refuse(
          window.state === "closed" ? "window_closed" : "window_unknown",
          window.says,
        ),
        guardrails: hits,
        window,
      };
    }

    // ── 5. the transport ─────────────────────────────────────────────────
    const transport = await this.transports.resolve(
      params.restaurantId,
      sender.id,
    );
    if (transport.state !== "ready") {
      return {
        ...this.refuse(
          transport.state === "unreadable" ? "read_failed" : "no_provider_account",
          transport.words,
        ),
        guardrails: hits,
        window,
      };
    }

    // ── 6. the money gate ────────────────────────────────────────────────
    const gate = await this.usage.gate({
      restaurantId: params.restaurantId,
      ownKeys: transport.ownKeys,
    });
    if (gate.verdict !== "allowed") {
      return {
        ...this.refuse(
          gate.verdict === "refused" ? "allowance_spent" : "allowance_unknown",
          gate.words,
        ),
        guardrails: hits,
        window,
      };
    }

    // ── 7. the request, built under the provider's own rules ─────────────
    let request;
    try {
      request = transport.transport.buildRequest(transport.credential, {
        toE164: address.waId,
        body: params.body,
        windowOpen: true,
      });
    } catch (err) {
      // The adapter's own refusal — an over-long body, a missing sender ref, a
      // Türkiye sender with no opt-out. Better refused here, in the house's
      // language, than reported as sent and refused by the provider.
      return {
        ...this.refuse("refused_by_provider", (err as Error).message),
        guardrails: hits,
        window,
      };
    }

    // ── 8. THE MIRROR, BEFORE THE PROVIDER IS ASKED ──────────────────────
    const { data: mirrored, error: mirrorError } = await this.sb
      .from("procurement_conversations")
      .insert({
        order_id: null,
        restaurant_id: params.restaurantId,
        provider_id: params.providerId,
        direction: "outbound",
        channel: WHATSAPP_CHANNEL,
        message_text: params.body,
        ai_generated: false,
        sent_at: new Date(nowMs).toISOString(),
        // NOT 'sent'. Nothing has been asked yet, and a status set before the
        // call cannot describe the call. `attempting` is the state that makes a
        // crash between here and step 9 readable rather than invisible.
        delivery_status: "attempting",
        round_count: (prior ?? 0) + 1,
        email_headers: {
          transport: "whatsapp_cloud_api",
          to_wa_id: address.waId,
          sender_id: sender.id,
          sent_by: params.userId,
        },
      })
      .select("id")
      .single();

    if (mirrorError) {
      // REFUSED, not sent-anyway. ADR 0121: without the mirror, P1 must not
      // ship — a message Meta holds and the house's book does not is exactly
      // the custody problem the mirror rule exists to answer.
      this.logger.error(`WhatsApp mirror insert failed: ${mirrorError.message}`);
      return {
        ...this.refuse(
          "mirror_failed",
          `This message was NOT sent, because it could not first be written to this house's own conversation book (${mirrorError.message}). Nothing was queued. The book holds the record and the provider only carries it, so a message that cannot be recorded is not sent.`,
        ),
        guardrails: hits,
        window,
      };
    }
    const conversationId = String(mirrored.id);

    // ── 9. the dispatch ──────────────────────────────────────────────────
    const performed = await this.dispatch.perform(request);

    if (performed.kind !== "answered") {
      await this.settle(conversationId, {
        delivery_status: "unknown",
        email_headers_patch: { dispatch: performed.kind, detail: performed.detail },
      });
      const metered = await this.usage.recordSend({
        restaurantId: params.restaurantId,
        senderId: sender.id,
        channel: "whatsapp",
        provider: transport.credential.provider,
        // NOT counted. Charging a house for a message we cannot show was
        // accepted is a bill built on a guess; an uncounted message is
        // recoverable, a wrongly counted one is money.
        countsAgainstAllowance: false,
        billableReason:
          "The provider could not be asked or could not be read, so whether this message was accepted is unknown. It is recorded and not counted: an uncounted message is recoverable and a wrongly counted one is a bill.",
        providerMessageRef: null,
        costState: "unavailable",
      });
      return {
        sent: false,
        refusal: "refused_by_provider",
        words: performed.detail,
        guardrails: hits,
        conversationId,
        providerRef: null,
        metered: metered.recorded,
        window,
      };
    }

    const outcome = transport.transport.parseResponse(
      performed.status ?? 0,
      performed.body,
    );

    await this.settle(conversationId, {
      delivery_status:
        outcome.kind === "accepted_by_provider"
          ? "accepted_by_provider"
          : outcome.kind === "refused_by_provider"
            ? "refused_by_provider"
            : "unknown",
      message_id: outcome.providerRef,
      email_headers_patch: {
        provider_status: outcome.providerStatus,
        provider_error_code: outcome.errorCode,
        detail: outcome.detail,
      },
    });

    // ── 10. ONE METER ROW, WHATEVER HAPPENED ─────────────────────────────
    const metered = await this.usage.recordSend({
      restaurantId: params.restaurantId,
      senderId: sender.id,
      channel: "whatsapp",
      provider: transport.credential.provider,
      countsAgainstAllowance: outcome.chargeable,
      billableReason: outcome.chargeableReason,
      providerMessageRef: outcome.providerRef,
      costState: outcome.cost.state,
      costMinor: outcome.cost.minor,
      costCurrency: outcome.cost.currency,
    });

    return {
      sent: outcome.kind === "accepted_by_provider",
      refusal: outcome.kind === "accepted_by_provider" ? null : "refused_by_provider",
      words: metered.recorded
        ? outcome.detail
        : `${outcome.detail} This message was NOT recorded on the house's message meter (${metered.reason}), so this month's count is short by one and the figure on the Connections page understates what was sent.`,
      guardrails: hits,
      conversationId,
      providerRef: outcome.providerRef,
      metered: metered.recorded,
      window,
    };
  }

  /**
   * Update the mirrored row with what the provider said.
   *
   * A failure here is LOGGED and does not change the caller's answer: the
   * message was already sent or already refused, and reporting a different
   * outcome because a second write failed would be reporting the wrong fact.
   * What it costs is a row left at `attempting`, which is why `attempting` is a
   * state a reader can see rather than a blank.
   */
  private async settle(
    conversationId: string,
    patch: {
      delivery_status: string;
      message_id?: string | null;
      email_headers_patch: Record<string, unknown>;
    },
  ): Promise<void> {
    const { data: existing, error: readError } = await this.sb
      .from("procurement_conversations")
      .select("email_headers")
      .eq("id", conversationId)
      .maybeSingle();

    const update: Record<string, unknown> = {
      delivery_status: patch.delivery_status,
    };
    if (patch.message_id) update.message_id = patch.message_id;

    if (readError) {
      // THE ENVELOPE IS NOT OVERWRITTEN WHEN IT COULD NOT BE READ. Merging into
      // `{}` would replace the pre-dispatch envelope — who sent it, which
      // sender, which number — with only the provider's answer, destroying the
      // half of the record that says what the house did. The status still
      // lands, because that is the fact the reader most needs.
      this.logger.error(
        `WhatsApp mirror settle: the prior envelope on ${conversationId} could not be read (${readError.message}); the delivery status was written and the envelope was left as it was rather than being replaced.`,
      );
    } else {
      update.email_headers = {
        ...(((existing as Record<string, unknown> | null)?.email_headers as
          | Record<string, unknown>
          | undefined) ?? {}),
        ...patch.email_headers_patch,
      };
    }

    const { error } = await this.sb
      .from("procurement_conversations")
      .update(update)
      .eq("id", conversationId);
    if (error) {
      this.logger.error(
        `WhatsApp mirror settle failed for ${conversationId}: ${error.message}. The row stays at 'attempting', which is readable; it is not silently left looking sent.`,
      );
    }
  }
}
