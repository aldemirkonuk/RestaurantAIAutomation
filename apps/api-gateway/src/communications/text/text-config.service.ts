/**
 * The deployment's own Meta credentials — the ones that are Mudavym's, not a
 * house's.
 *
 * WHICH SECRETS LIVE WHERE, AND WHY THE SPLIT IS NOT ARBITRARY
 * ------------------------------------------------------------
 * ADR 0121's standing: Mudavym registers directly with Meta as a **Tech
 * Provider**, and each house's WhatsApp Business Account sits under Mudavym's
 * app. So there are two different kinds of credential and they belong in two
 * different places:
 *
 *   * **The house's access token** — per sender, per tenant, encrypted at rest
 *     in `house_text_sender_credentials.access_token_encrypted`
 *     (AES-256-GCM through `TokenCryptoService`). Read by
 *     `TextCredentialsService`. Never here.
 *
 *   * **Mudavym's app secret and webhook verify token** — one per DEPLOYMENT,
 *     because every house's WABA is subscribed to the same Mudavym app and Meta
 *     signs every webhook with that one app's secret. A per-tenant column for
 *     these would be one deployment secret copied into fourteen rows, which is
 *     the shape the credentials migration's CHECK exists to prevent.
 *
 * ABSENCE IS REPORTED, NEVER DEFAULTED
 * ------------------------------------
 * Every getter returns `null` when the variable is unset, and no caller may
 * substitute a value. `verifyMetaSignature` refuses on `null` with its own
 * reason (`no-secret`), so an unconfigured deployment REFUSES every inbound
 * webhook rather than accepting anything that reaches the URL. A default here —
 * an empty string, a placeholder — would make the HMAC computable and the door
 * open.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class TextConfigService {
  private readonly logger = new Logger(TextConfigService.name);
  private warned = false;

  constructor(private readonly config: ConfigService) {}

  private read(name: string): string | null {
    const value = this.config.get<string>(name);
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : null;
  }

  /** Mudavym's Meta app secret. Signs every WhatsApp webhook Meta sends us. */
  get appSecret(): string | null {
    return this.read("WHATSAPP_APP_SECRET") ?? this.read("META_APP_SECRET");
  }

  /** The string Meta echoes back during the subscription handshake. */
  get webhookVerifyToken(): string | null {
    return (
      this.read("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ??
      this.read("META_WEBHOOK_VERIFY_TOKEN")
    );
  }

  /**
   * The platform-owned access token, for `owner = 'platform'` credentials.
   *
   * Those rows carry NO token by database CHECK; the adapter reads it from
   * here instead. Null when unset, and the send path refuses rather than
   * building a request with an empty Bearer.
   */
  get platformAccessToken(): string | null {
    return this.read("WHATSAPP_PLATFORM_ACCESS_TOKEN");
  }

  /**
   * Say once, at boot, what is missing.
   *
   * Not an exception: a deployment with no WhatsApp configuration is a valid
   * deployment (this is every house on this deployment today). It is a
   * deployment where the inbound door refuses and the send path refuses, and
   * the log says so rather than leaving it to be discovered.
   */
  warnOnce(): void {
    if (this.warned) return;
    this.warned = true;
    const missing = [
      this.appSecret ? null : "WHATSAPP_APP_SECRET",
      this.webhookVerifyToken ? null : "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    ].filter(Boolean);
    if (missing.length) {
      this.logger.warn(
        `WhatsApp inbound is REFUSING every request: ${missing.join(", ")} not set. This is not a degraded mode — nothing is accepted and nothing is stored.`,
      );
    }
  }
}
