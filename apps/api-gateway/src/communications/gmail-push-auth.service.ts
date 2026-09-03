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
 * ─────────────────────────────────────────────────────────────────────────────
 * ADR 0094 — 2026-09-02. STEP 1 ABOVE DID NOT DO WHAT IT SAID.
 *
 * From the day it was written until this commit, the unset-config branch
 * incremented a counter, logged an error, and `return true` — it ACCEPTED the
 * push. Refusal required a *second* env var, `GMAIL_PUBSUB_REQUIRE_AUTH=true`,
 * to also be remembered. So the sentence "If either is missing we REJECT —
 * fail closed" described an intention while the code twenty lines below it did
 * the reverse, and three other places in the repo repeated the false claim,
 * including the Swagger description shipped to API consumers
 * (`communications.controller.ts`).
 *
 * That is this repo's `absence-reported-as-health` fault in its purest form: a
 * verifier that cannot verify reported itself as a verifier.
 *
 * The staged-rollout argument for accepting was that production might be
 * running a live Gmail watch on unset config, so refusing would close a door
 * that is open and carrying traffic. That argument is now retired, because the
 * repo cannot agree on whether the vars are set:
 * `.planning/04-specs/REGISTER-AUDIT-2026-08-26.md:106-107` says production
 * `.env` carries all three; `.planning/STATE.md` says they still need setting.
 * Nobody can read Railway's env from here to settle it.
 *
 * **That ambiguity is the argument FOR failing closed, not against it.** Once
 * missing config refuses, which document is right stops being a security
 * question and becomes a functional one: it decides whether inbound email is
 * flowing, not whether an unauthenticated caller can drive the inbox.
 *
 * `GMAIL_PUBSUB_REQUIRE_AUTH` is DELETED rather than kept. With missing config
 * refusing on its own, the flag's only remaining power would have been to
 * *weaken* the guard, and a fail-closed posture that depends on a second flag
 * being remembered is not fail-closed.
 *
 * OPERATIONAL CONSEQUENCE, STATED PLAINLY: with `GMAIL_PUBSUB_AUDIENCE` and
 * `GMAIL_PUBSUB_SERVICE_ACCOUNT` unset, every Gmail push is now refused and
 * inbound vendor email stops arriving until both are set. Both values come from
 * the Pub/Sub push subscription (its OIDC audience, and its push service
 * account email); they cannot be invented here, and a wrong guess fails exactly
 * as badly as no guess. A paused inbox is the correct trade against a webhook
 * that ingests mail for anyone who posts to it.
 */
@Injectable()
export class GmailPushAuthService {
  private readonly logger = new Logger(GmailPushAuthService.name);
  /** Overridden in tests. No client id/secret needed — verification only. */
  private readonly oauthClient = new OAuth2Client();

  /**
   * Pushes REFUSED because the service is not configured to verify anything.
   *
   * Before ADR 0094 this counted pushes *accepted* while unconfigured — the
   * size of an open hole. It now counts the operational cost of the closed
   * one: a non-zero value means real inbound mail is being turned away and the
   * two env vars still need setting.
   */
  private unconfiguredRefusalCount = 0;

  /** Exposed for health/debug surfaces — non-zero means inbound email is paused. */
  get refusedWhileUnconfigured(): number {
    return this.unconfiguredRefusalCount;
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

    // Half-configured is unconfigured. An audience alone proves nothing about
    // WHO sent the token, and a service account alone proves nothing about who
    // it was issued FOR.
    if (!audience || !serviceAccount) {
      this.unconfiguredRefusalCount++;
      this.logger.error(
        `Gmail push REFUSED — not configured to verify it ` +
          `(${this.unconfiguredRefusalCount} refused since boot). ` +
          "Set GMAIL_PUBSUB_AUDIENCE and GMAIL_PUBSUB_SERVICE_ACCOUNT from the " +
          "Pub/Sub push subscription to resume inbound email. Until then this " +
          "endpoint admits nobody, which is deliberate: a verifier that cannot " +
          "verify must not admit.",
      );
      return false;
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
