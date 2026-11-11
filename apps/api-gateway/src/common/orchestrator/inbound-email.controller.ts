import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Optional,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "crypto";
import { ConfigService } from "@nestjs/config";
import { Public } from "../../auth/decorators/public.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { InboundAddressService } from "./inbound-address.service";
import { htmlToText } from "../../communications/gmail-mime";
import { decodeEncodedWords } from "../../communications/inbound-headers";
import { contentKey, MailIntakeService } from "./mail-intake.service";

interface NormalizedInbound {
  from: string;
  subject: string;
  body: string;
  recipients: string[];
  attachments: Array<{ filename: string; mime_type: string; data: string }>;
  messageId: string;
  inReplyTo: string;
  references: string;
  headers: Record<string, string>;
  /** The provider's own id for this delivery (Postmark `MessageID`), when it sends one. */
  providerMessageId: string;
}

/** Constant-time comparison; a length mismatch is a mismatch. */
function secretsMatch(provided: string, configured: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * InboundEmailController — Phase 1/2 provider-agnostic inbound-email webhook for the
 * dedicated inbound domain (see .planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md).
 *
 * An inbound-parse provider (Postmark / SES / Mailgun / Cloudflare) POSTs a parsed message
 * here. We resolve the recipient address -> restaurant_id (transport-derived attribution) and
 * publish the SAME `email.inbound.received` event the Gmail path uses — now stamped with
 * restaurant_id — so the existing bridge/prospects/responder pipeline handles it unchanged.
 * Runs ALONGSIDE the Gmail ingest (dual-run); nothing here disables the legacy path.
 *
 * Security: gated by a shared secret (`INBOUND_WEBHOOK_SECRET`) sent in the `x-inbound-secret`
 * header, compared in constant time. With no secret configured the endpoint refuses, so it can
 * never act as an open relay.
 *
 * Gap G8 (2026-11-11), the session's call under the 2026-11-07 /goal:
 *  - the `?secret=` query is no longer read: a secret in a URL lands in every proxy and access
 *    log on the way. Rejected: keeping it as a fallback (one logged URL leaks it for good);
 *  - a wrong secret is 401 and an unset one 503, never `200 {status:"unauthorized"}`: a 200 told
 *    the provider the letter was delivered, so a misconfigured deploy dropped mail in silence;
 *  - the letter is recorded in `mail_intake` (gap G2) before the 200. A failed record is 503,
 *    so the provider sends it again (Postmark retries a non-2xx inbound webhook); a repeat
 *    delivery is one intake row, keyed on the provider's message id;
 *  - a letter with no readable sender is recorded and published too: the bridge holds it as
 *    one whose sender could not be read (QA round 24), where it used to be "ignored".
 */
@Controller("webhooks")
export class InboundEmailController {
  private readonly logger = new Logger(InboundEmailController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly orchestrator: OrchestratorService,
    private readonly inboundAddress: InboundAddressService,
    // Optional only for the specs that build the controller by hand.
    @Optional() private readonly intake?: MailIntakeService,
  ) {}

  @Public()
  @Post("inbound-email")
  @HttpCode(HttpStatus.OK)
  async inbound(
    @Body() body: any,
    @Headers("x-inbound-secret") headerSecret?: string,
  ): Promise<{ status: string; restaurant_id?: string | null }> {
    const configured = (
      this.configService.get<string>("INBOUND_WEBHOOK_SECRET") || ""
    ).trim();
    if (!configured) {
      this.logger.warn(
        "inbound-email webhook hit but INBOUND_WEBHOOK_SECRET is not set — refusing.",
      );
      throw new ServiceUnavailableException("Inbound mail is not set up.");
    }
    if (!secretsMatch((headerSecret || "").trim(), configured)) {
      this.logger.warn(
        "inbound-email webhook: bad or missing secret — rejected.",
      );
      throw new UnauthorizedException();
    }

    const norm = this.normalizePayload(body || {});
    let restaurantId: string | null;
    try {
      restaurantId = await this.inboundAddress.resolveRestaurantId(
        norm.recipients,
      );
    } catch (e: any) {
      this.logger.error(
        `inbound-email: the recipient could not be resolved (${e?.message}); asking the provider to send it again`,
      );
      throw new ServiceUnavailableException();
    }

    // Publish the exact event shape the Gmail path publishes, plus restaurant_id + source.
    const event = {
      restaurant_id: restaurantId, // may be null -> the bridge holds it unattributed
      from: norm.from,
      subject: norm.subject,
      body: norm.body,
      attachments: norm.attachments,
      message_id_header: norm.messageId,
      gmail_message_id: null,
      gmail_thread_id: null,
      in_reply_to: norm.inReplyTo,
      references: norm.references,
      received_at: new Date().toISOString(),
      headers: norm.headers,
      source: "inbound-domain",
    };
    try {
      if (this.intake) {
        await this.intake.recordAndPublish({
          door: "inbound_address",
          providerKey:
            norm.providerMessageId ||
            norm.messageId ||
            contentKey([norm.from, norm.subject, norm.body, ...norm.recipients]),
          restaurantId,
          event,
        });
      } else {
        await this.orchestrator.publishEvent(
          "email.events",
          "email.inbound.received",
          event,
        );
      }
    } catch (e: any) {
      this.logger.error(`inbound-email webhook failed: ${e?.message}`);
      throw new ServiceUnavailableException();
    }

    this.logger.log(
      `inbound-email: from=${norm.from || "?"} to=${norm.recipients[0] ?? "?"} restaurant=${restaurantId ?? "TRIAGE"}`,
    );
    return { status: "ok", restaurant_id: restaurantId };
  }

  /**
   * Normalize a Postmark inbound JSON payload OR a generic normalized shape into our internal
   * `email.inbound.received` fields. Kept provider-agnostic so switching providers is a config
   * change, not a code change.
   */
  private normalizePayload(b: any): NormalizedInbound {
    // Null prototype: header names come from the inbound email, so a message
    // with a header literally named `constructor` or `toString` would
    // otherwise make `headerMap[name]` read an inherited function for a header
    // we never received. Reads below (`headerMap["from"]` etc.) then treat
    // that as a present value.
    const headerMap: Record<string, string> = Object.create(null);
    // Every From in the Headers array, not the last one (QA round 22, N-1):
    // two From headers become a two-mailbox list that names nobody.
    const fromHeaders: string[] = [];
    if (Array.isArray(b.Headers)) {
      for (const h of b.Headers)
        if (h?.Name) {
          const name = String(h.Name).toLowerCase();
          headerMap[name] = String(h.Value ?? "");
          if (name === "from") fromHeaders.push(String(h.Value ?? ""));
        }
    }
    if (
      b.headers &&
      typeof b.headers === "object" &&
      !Array.isArray(b.headers)
    ) {
      for (const [k, v] of Object.entries(b.headers))
        headerMap[k.toLowerCase()] = String(v ?? "");
    }

    const from: string =
      b.FromFull?.Email ||
      b.From ||
      b.from ||
      (fromHeaders.length > 1 ? fromHeaders.join(", ") : headerMap["from"]) ||
      "";
    // RFC 2047 words decoded (QA round 6 N-2) — Postmark's `Subject` arrives
    // decoded, a raw `headers.subject` does not; decoding plain text is a no-op.
    const subject: string = decodeEncodedWords(
      b.Subject ?? b.subject ?? headerMap["subject"] ?? "",
    );
    // [Audit of PR #435 at a229848f3, 2026-09-26: this used to fall back to
    // raw HTML (`b.HtmlBody || b.html`) with no text conversion at all, one
    // flattening step worse than gmail-mime.ts's own bug (see that file's
    // `htmlToText` docstring). A provider that sends no plain-text part
    // (Postmark, SES, Mailgun, Cloudflare all support HTML-only inbound)
    // would push raw markup — no newlines a quoted-thread cut could match —
    // into the same `email.inbound.received` event the Gmail path feeds, so
    // it hits the same downstream Jev egress unprotected. Convert with the
    // SAME function so a message from either ingest path gets the same
    // newline-delimited shape `vendor-tone/tone-scale.ts` `latestPart()`
    // already knows how to cut.]
    const htmlBody: string = b.HtmlBody || b.html || "";
    const body: string =
      b.TextBody ||
      b.text ||
      b.StrippedTextReply ||
      (htmlBody ? htmlToText(htmlBody) : "") ||
      b.body ||
      "";

    // Recipient candidates — the address the vendor emailed is our attribution key.
    const recipients: string[] = [];
    const push = (v: any) => {
      if (typeof v === "string" && v.trim()) recipients.push(v);
    };
    push(b.OriginalRecipient);
    if (Array.isArray(b.ToFull)) for (const t of b.ToFull) push(t?.Email);
    if (Array.isArray(b.to))
      for (const t of b.to) push(typeof t === "string" ? t : t?.email);
    else push(b.to);
    push(b.To);
    push(headerMap["delivered-to"]);
    push(headerMap["x-original-to"]);
    push(headerMap["to"]);

    const rawAtt: any[] = Array.isArray(b.Attachments)
      ? b.Attachments
      : Array.isArray(b.attachments)
        ? b.attachments
        : [];
    const attachments = rawAtt
      .map((a) => ({
        filename: a?.Name || a?.filename || a?.name || "attachment",
        mime_type:
          a?.ContentType ||
          a?.contentType ||
          a?.mime_type ||
          "application/octet-stream",
        data: a?.Content || a?.content || a?.data || "",
      }))
      .filter((a) => a.data);

    // Postmark's `MessageID` is ITS id for the delivery, the intake key
    // (gap G2). Which id `message_id_header` carries is left as it was: the
    // message-id lane (fix/mail-message-id-one-shape) owns that.
    const providerMessageId: string = String(b.MessageID || "").trim();
    const messageId: string =
      b.MessageID || b.messageId || headerMap["message-id"] || "";
    const inReplyTo: string = headerMap["in-reply-to"] || b.inReplyTo || "";
    const references: string = headerMap["references"] || b.references || "";

    return {
      from,
      subject,
      body,
      recipients,
      attachments,
      messageId,
      inReplyTo,
      references,
      headers: headerMap,
      providerMessageId,
    };
  }
}
