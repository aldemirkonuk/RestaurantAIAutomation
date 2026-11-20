import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "crypto";
import { Public } from "../../auth/decorators/public.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { InboundAddressService } from "./inbound-address.service";
import { htmlToText } from "../../communications/gmail-mime";

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
 * Security: gated by a shared secret (`INBOUND_WEBHOOK_SECRET`, sent as the `x-inbound-secret`
 * header, or as `?secret=` while `INBOUND_WEBHOOK_ALLOW_QUERY_SECRET` is not `false`). The
 * compare is constant-time (`timingSafeEqual` over SHA-256 digests, so unequal lengths cannot
 * throw or leak a length). Neither secret value is ever logged.
 *
 * Status codes — the door refuses loudly, because an inbound-parse provider only retries a
 * letter it did not get a 2xx for (mail proposal F16, G8):
 *   - 401  wrong or missing secret (header, or query while the query form is allowed).
 *   - 503  `INBOUND_WEBHOOK_SECRET` not configured — the endpoint refuses, so it can never act
 *          as an open relay, and the provider keeps the letter.
 *   - 503  resolving the house or publishing the event failed — the provider retries instead of
 *          treating a lost letter as delivered.
 *   - 200  `{status:'ignored'}` for a payload with no sender (a retry cannot fix it).
 *   - 200  `{status:'ok', restaurant_id}` on success.
 *
 * `INBOUND_WEBHOOK_ALLOW_QUERY_SECRET`: unset (default) keeps `?secret=` working so a deployed
 * provider that cannot send a header does not break; set it to `false` once the provider sends
 * the header, and the query form alone is refused with 401.
 */
@Controller("webhooks")
export class InboundEmailController {
  private readonly logger = new Logger(InboundEmailController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly orchestrator: OrchestratorService,
    private readonly inboundAddress: InboundAddressService,
  ) {}

  @Public()
  @Post("inbound-email")
  @HttpCode(HttpStatus.OK)
  async inbound(
    @Body() body: any,
    @Headers("x-inbound-secret") headerSecret?: string,
    @Query("secret") querySecret?: string,
  ): Promise<{ status: string; restaurant_id?: string | null }> {
    const configured = (
      this.configService.get<string>("INBOUND_WEBHOOK_SECRET") || ""
    ).trim();
    if (!configured) {
      this.logger.warn(
        "inbound-email webhook hit but INBOUND_WEBHOOK_SECRET is not set — refusing.",
      );
      throw new ServiceUnavailableException("inbound-email webhook disabled");
    }
    const allowQuery = this.querySecretAllowed();
    const provided = (
      headerSecret ||
      (allowQuery ? querySecret : undefined) ||
      ""
    ).trim();
    if (!provided || !secretsMatch(provided, configured)) {
      this.logger.warn(
        `inbound-email webhook: bad or missing secret — rejected (header=${headerSecret ? "present" : "absent"}, query=${querySecret ? (allowQuery ? "present" : "present-but-disallowed") : "absent"}).`,
      );
      throw new UnauthorizedException("inbound-email webhook: bad secret");
    }

    try {
      const norm = this.normalizePayload(body || {});
      if (!norm.from) {
        this.logger.warn(
          "inbound-email webhook: payload had no sender — ignored.",
        );
        return { status: "ignored" };
      }
      const restaurantId = await this.inboundAddress.resolveRestaurantId(
        norm.recipients,
      );

      // Publish the exact event shape the Gmail path publishes, plus restaurant_id + source.
      await this.orchestrator.publishEvent(
        "email.events",
        "email.inbound.received",
        {
          restaurant_id: restaurantId, // may be null -> the bridge routes it to triage
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
        },
      );

      this.logger.log(
        `inbound-email: from=${norm.from} to=${norm.recipients[0] ?? "?"} restaurant=${restaurantId ?? "TRIAGE"}`,
      );
      return { status: "ok", restaurant_id: restaurantId };
    } catch (e: any) {
      // A 2xx here tells the provider the letter was delivered and it never
      // retries — the letter would be lost. 503 makes it try again.
      this.logger.error(`inbound-email webhook failed: ${e?.message}`);
      throw new ServiceUnavailableException(
        "inbound-email webhook could not accept the letter; retry",
      );
    }
  }

  /** `?secret=` is accepted unless INBOUND_WEBHOOK_ALLOW_QUERY_SECRET is exactly `false`. */
  private querySecretAllowed(): boolean {
    const raw = this.configService.get<string>(
      "INBOUND_WEBHOOK_ALLOW_QUERY_SECRET",
    );
    return (
      String(raw ?? "")
        .trim()
        .toLowerCase() !== "false"
    );
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
    if (Array.isArray(b.Headers)) {
      for (const h of b.Headers)
        if (h?.Name)
          headerMap[String(h.Name).toLowerCase()] = String(h.Value ?? "");
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
      b.FromFull?.Email || b.From || b.from || headerMap["from"] || "";
    const subject: string =
      b.Subject ?? b.subject ?? headerMap["subject"] ?? "";
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
    };
  }
}

/**
 * Constant-time secret compare. Hashing both sides first gives equal-length
 * buffers, so `timingSafeEqual` never throws on a length mismatch and the
 * time taken does not reveal the configured secret's length.
 */
function secretsMatch(provided: string, configured: string): boolean {
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(a, b);
}
