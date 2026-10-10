import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "crypto";
import { Public } from "../../auth/decorators/public.decorator";
import { OrchestratorService } from "./orchestrator.service";
import { InboundAddressService } from "./inbound-address.service";
import { htmlToText } from "../../communications/gmail-mime";
import { maskEmail } from "../log-mask";

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
 * Security: gated by a shared secret (`INBOUND_WEBHOOK_SECRET`, sent as `x-inbound-secret`
 * header or `?secret=` query). With no secret configured the endpoint refuses, so it can never
 * act as an open relay.
 *
 * F-476 (2026-10-09): the secret is compared in constant time (`secretMatches`). The header
 * wins whenever it is sent. The `?secret=` form is KEPT, on purpose: `.railway/railway.ts`
 * preserves `INBOUND_WEBHOOK_SECRET` and `INBOUND_EMAIL_PROVIDER` on the gateway, and nothing
 * in the repo says which provider is pointed here or whether it can send a custom header
 * (perimeter-ingress-integrity agenda, open question 3). Removing the query form blind would
 * turn a live inbound feed into silent 200 "unauthorized" replies. Instead every query-form
 * hit logs a warning naming the fix, so whoever moves the provider to the header can then
 * delete the fallback.
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
      return { status: "disabled" };
    }
    const header = (headerSecret || "").trim();
    const provided = header || (querySecret || "").trim();
    if (!secretMatches(provided, configured)) {
      this.logger.warn(
        "inbound-email webhook: bad or missing secret — rejected.",
      );
      return { status: "unauthorized" };
    }
    if (!header) {
      this.logger.warn(
        "inbound-email webhook: secret arrived in the ?secret= query, which lands in access logs. Point the provider at the x-inbound-secret header instead.",
      );
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
        `inbound-email: from=${maskEmail(norm.from)} to=${norm.recipients[0] ? maskEmail(norm.recipients[0]) : "?"} restaurant=${restaurantId ?? "TRIAGE"}`,
      );
      return { status: "ok", restaurant_id: restaurantId };
    } catch (e: any) {
      this.logger.error(`inbound-email webhook failed: ${e?.message}`);
      return { status: "error" };
    }
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
 * Constant-time secret check (F-476). Both sides are hashed first so the buffers
 * handed to `timingSafeEqual` are always the same length, and neither the
 * secret's length nor its prefix leaks through response timing.
 */
export function secretMatches(provided: string, configured: string): boolean {
  if (!provided || !configured) return false;
  const a = createHash("sha256").update(provided, "utf8").digest();
  const b = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(a, b);
}
