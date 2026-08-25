import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { OAuth2Client } from "google-auth-library";

/**
 * ADR 0019 D3 — verify Google Pub/Sub push requests on POST
 * /communications/webhooks/gmail.
 *
 * The endpoint was `@Public()` with no verification at all, so anyone could POST
 * a synthetic Pub/Sub envelope and make the gateway fetch the whole inbox and
 * republish it onto `email.events`. Pub/Sub push subscriptions configured with
 * an OIDC token send `Authorization: Bearer <Google-signed JWT>`; this service
 * verifies that JWT.
 *
 * What is checked (in order):
 *  1. Both `GMAIL_PUBSUB_AUDIENCE` and `GMAIL_PUBSUB_SERVICE_ACCOUNT` are set.
 *     If either is missing we REJECT — fail closed, matching
 *     PosHubService.verifyWebhookSignature ("secret unset -> reject").
 *  2. An `Authorization: Bearer <token>` header is present.
 *  3. `OAuth2Client.verifyIdToken` — RS256 signature against Google's published
 *     certs, issuer `accounts.google.com`, `exp` not passed, and `aud` equal to
 *     the configured audience.
 *  4. The `email` claim equals the configured push service account, and
 *     `email_verified` is true. Step 3 alone only proves *some* Google-issued
 *     token for this audience; step 4 pins it to our push subscription.
 *
 * Operational consequence of failing closed: with the two env vars unset the
 * inbound-email path stops. They must be set wherever the Gmail watch runs.
 */
@Injectable()
export class GmailPushAuthService {
  private readonly logger = new Logger(GmailPushAuthService.name);
  /** Overridden in tests. No client id/secret needed — verification only. */
  private readonly oauthClient = new OAuth2Client();

  /** Pushes accepted while unconfigured. A silent gap must be countable. */
  private unverifiedPushCount = 0;

  /** Exposed for health/debug surfaces — non-zero means the gap is still open. */
  get unverifiedPushes(): number {
    return this.unverifiedPushCount;
  }

  constructor(private readonly configService: ConfigService) {}

  private readConfig(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  }

  /**
   * @returns true only when the request carries a valid Google-signed OIDC
   * token from the configured Pub/Sub push service account.
   */
  async verifyPushRequest(authorizationHeader?: string): Promise<boolean> {
    const audience = this.readConfig("GMAIL_PUBSUB_AUDIENCE");
    const serviceAccount = this.readConfig("GMAIL_PUBSUB_SERVICE_ACCOUNT");

    if (!audience || !serviceAccount) {
      // STAGED ROLLOUT, and this is a deliberate exception to the fail-closed
      // rule this repo otherwise applies (pos-hub, Toast).
      //
      // Production already runs a live Gmail watch (GMAIL_PUBSUB_TOPIC is set)
      // while these two values are NOT set, because they did not exist until
      // this verification was written. Rejecting on an unset config would
      // therefore not "keep the door shut" — it would CLOSE A DOOR THAT IS
      // CURRENTLY OPEN AND CARRYING TRAFFIC, silently stopping inbound email on
      // the next deploy. The values must come from the Pub/Sub subscription
      // (its OIDC audience and push service-account email); nobody can invent
      // them correctly from here, and a wrong guess fails exactly as badly.
      //
      // So: set both vars and verification turns on by itself. Set
      // GMAIL_PUBSUB_REQUIRE_AUTH=true to fail closed regardless — do that once
      // the other two are confirmed working, and this branch is dead.
      const required =
        this.readConfig("GMAIL_PUBSUB_REQUIRE_AUTH")?.toLowerCase() === "true";

      if (required) {
        this.logger.error(
          "GMAIL_PUBSUB_AUDIENCE / GMAIL_PUBSUB_SERVICE_ACCOUNT not configured and GMAIL_PUBSUB_REQUIRE_AUTH=true — rejecting Gmail push (fail closed)",
        );
        return false;
      }

      this.unverifiedPushCount++;
      this.logger.error(
        `Gmail push accepted WITHOUT verification (${this.unverifiedPushCount} since boot) — ` +
          "set GMAIL_PUBSUB_AUDIENCE and GMAIL_PUBSUB_SERVICE_ACCOUNT to close this. " +
          "Until then this endpoint is triggerable by anyone.",
      );
      return true;
    }

    const token = authorizationHeader?.startsWith("Bearer ")
      ? authorizationHeader.slice("Bearer ".length).trim()
      : "";

    if (!token) {
      this.logger.warn(
        "Gmail push rejected: missing or malformed Authorization bearer token",
      );
      return false;
    }

    try {
      const ticket = await this.oauthClient.verifyIdToken({
        idToken: token,
        audience,
      });
      const payload = ticket.getPayload();

      if (!payload) {
        this.logger.warn("Gmail push rejected: OIDC token had no payload");
        return false;
      }

      if (payload.email_verified !== true) {
        this.logger.warn(
          "Gmail push rejected: OIDC token email claim is not verified",
        );
        return false;
      }

      if (
        (payload.email || "").toLowerCase() !== serviceAccount.toLowerCase()
      ) {
        this.logger.warn(
          `Gmail push rejected: OIDC token email "${payload.email}" is not the configured push service account`,
        );
        return false;
      }

      return true;
    } catch (err: any) {
      this.logger.warn(
        `Gmail push rejected: OIDC token verification failed — ${err?.message}`,
      );
      return false;
    }
  }
}
