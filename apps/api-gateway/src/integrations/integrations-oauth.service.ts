import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "crypto";
import { currentRestaurantRole } from "../auth/current-restaurant-access";
import { digestsMatch, hashSealToken } from "../common/seal/seal-token";
import { PRODUCTION_ORIGINS } from "../cors-origins";
import { DatabaseService } from "../database/database.service";
import { TokenCryptoService } from "../common/crypto/token-crypto.service";
// The SERVICE file, not `retention.module`. Importing the module here would put
// `AuthModule` on this file's require chain twice over; the service itself
// imports only DatabaseService and NotificationsService, so requiring it
// directly adds no module edge. `IntegrationsModule` imports `RetentionModule`
// so the injector has something to supply.
import { RawMailRetentionService } from "../communications/retention/raw-mail-retention.service";
import {
  INTEGRATION_DEFINITIONS,
  IntegrationDefinition,
  IntegrationId,
  IntegrationProvider,
  MIRRORING_INTEGRATION_IDS,
  isIntegrationId,
  scopeStringFor,
} from "./integrations-oauth.constants";

const STATE_TTL_MS = 10 * 60 * 1000;

export interface RedeemedIntegrationConsent {
  sealId: string;
  snapshot: Record<string, unknown>;
  digest: string;
  browserProofHash: string;
  browserRequestId: string;
  frontendOrigin: string;
}

const BROWSER_STATE_COLUMNS =
  "state, user_id, restaurant_id, provider, integration_id, return_path, consent_receipt_id, browser_proof_hash, browser_request_id, browser_delivery_secret_hash, frontend_origin, pkce_verifier_encrypted, callback_payload_encrypted, callback_received_at";

/** A 256-bit base64url state, exactly as `createAuthorizationUrl` mints it. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
/** A sha256 hex digest or a 256-bit hex browser proof. */
const HEX_256_PATTERN = /^[a-f0-9]{64}$/;

/**
 * Why a completed provider round trip still connected nothing, when the cause
 * is the PERSON's standing rather than the provider exchange. A revoked
 * membership is not an exchange failure, and a membership that could not be
 * READ is not a refusal: three causes, three reasons on the return URL.
 */
class ConsentMembershipRefusal extends Error {
  constructor(readonly reason: "membership_refused" | "membership_unreadable") {
    super(reason);
    this.name = "ConsentMembershipRefusal";
  }
}

/** Refresh a little early so a call never races the expiry boundary. */
const EXPIRY_SKEW_MS = 60 * 1000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export interface ConnectionSummary {
  integrationId: IntegrationId;
  provider: IntegrationProvider;
  connected: boolean;
  account: string | null;
  scopes: string[];
  connectedAt: string | null;
  /**
   * The restaurant the grant was recorded against, or null for a grant made
   * before a tenant was on the token. Returned rather than hidden because
   * `/connections` lists a person's grants beside the house's own attachments
   * and has to say which house each one was made in.
   */
  restaurantId: string | null;
}

/** PostgREST `or=` takes a raw filter string; only a UUID may reach it. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ONE personal grant, as the house sees it (`/connections` Register III).
 *
 * "A manager may SEE, not approve, what a member has personally connected"
 * (founder, 2026-09-03). Every field here is a fact about a grant a person
 * made; nothing on it can end that grant. `houseAccess` is the one thing the
 * house controls — whether it uses the grant at all.
 */
export interface HouseGrantSummary {
  connectionId: string;
  integrationId: IntegrationId;
  provider: IntegrationProvider;
  label: string;
  /** Whose it is. The register names a person on every row, never "a member". */
  ownerUserId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  account: string | null;
  scopes: string[];
  connectedAt: string | null;
  /**
   * When the stored access token expires. Read by nothing before this build —
   * §6b's checklist listed "expiry visible" as stored and unread.
   */
  tokenExpiresAt: string | null;
  houseAccess: {
    /** TRUE when this house has stopped using the grant. The person keeps it. */
    revoked: boolean;
    at: string | null;
    by: string | null;
    byName: string | null;
    reason: string | null;
  };
}

/**
 * What the house can see of its members' personal grants.
 *
 * `unattributed` is not decoration. `restaurant_id` is nullable, so a grant
 * made before a tenant reached the token belongs to a person who works here and
 * to no recorded house — it may well be acting here, and dropping it silently
 * would make this list quietly incomplete in exactly the way the surface exists
 * to prevent. It is counted and said.
 */
export interface HouseGrantsResponse {
  grants: HouseGrantSummary[];
  unattributed: number;
}

@Injectable()
export class IntegrationsOauthService {
  private readonly logger = new Logger(IntegrationsOauthService.name);
  /** FRONTEND_URL entries already reported as unparseable, so each warns once. */
  private readonly reportedFrontendEntries = new Set<string>();

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
    /**
     * ADR 0118 (retention, 2026-09-05) — revoking a reading grant deletes the
     * raw mail it mirrored, immediately.
     *
     * `@Optional` because this class is ALSO provided bare from its file inside
     * `CommunicationsModule` (see the long note there), where no injector can
     * supply this. It is not a silent fallback: `disconnect` REFUSES to report
     * success for a mirroring grant when it is absent, because a revocation
     * that quietly deleted nothing is exactly the promise the consent screen
     * makes and does not keep.
     */
    @Optional() private readonly rawMailRetention?: RawMailRetentionService,
  ) {}

  // ── configuration ────────────────────────────────────────────────────────

  private credentialsFor(provider: IntegrationProvider) {
    const prefix = provider === "google" ? "GOOGLE" : "MICROSOFT";
    const clientId = this.config.get<string>(`${prefix}_CLIENT_ID`);
    const clientSecret = this.config.get<string>(`${prefix}_CLIENT_SECRET`);
    return { clientId, clientSecret };
  }

  private redirectUriFor(provider: IntegrationProvider): string {
    const explicit = this.config.get<string>(
      provider === "google"
        ? "GOOGLE_INTEGRATION_CALLBACK_URL"
        : "MICROSOFT_INTEGRATION_CALLBACK_URL",
    );
    if (explicit) return explicit;

    const base = (
      this.config.get<string>("API_PUBLIC_URL") ?? "http://localhost:4000"
    ).replace(/\/$/, "");
    return `${base}/api/v1/integrations/oauth/${provider}/callback`;
  }

  /**
   * FRONTEND_URL entries that parse as http(s) URLs, in order.
   *
   * FRONTEND_URL is a hand-edited, comma-separated CORS allow-list. One entry
   * written as `mudavym.com`, a trailing comma, or a space-separated second
   * host used to reach `new URL()` unguarded and turn every consent call into a
   * 500 (KL audit J2). An unparseable entry is skipped and named in the log
   * once; it never decides whether the product works.
   */
  private configuredFrontendUrls(): URL[] {
    const raw = this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
    const parsed: URL[] = [];
    for (const entry of raw.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      let url: URL | null = null;
      try {
        url = new URL(trimmed);
      } catch {
        url = null;
      }
      if (url && (url.protocol === "https:" || url.protocol === "http:")) {
        parsed.push(url);
      } else if (!this.reportedFrontendEntries.has(trimmed)) {
        this.reportedFrontendEntries.add(trimmed);
        this.logger.warn(`FRONTEND_URL entry is not an http(s) URL and is ignored: "${trimmed.slice(0, 120)}"`);
      }
    }
    return parsed;
  }

  private webAppUrl(): string {
    // The first PARSEABLE entry is the canonical app origin. With none, the
    // customer-facing domain (which cors-origins.ts keeps out of env's reach
    // for the same reason) is the honest fallback, not a crash.
    const first = this.configuredFrontendUrls()[0];
    if (!first) return PRODUCTION_ORIGINS[0];
    return `${first.origin}${first.pathname}`.replace(/\/$/, "");
  }

  /**
   * Whether a given integration can be offered at all. Surfacing this lets the
   * UI hide connect buttons instead of failing at the end of a consent flow.
   */
  availability(): Record<
    IntegrationId,
    { available: boolean; reason?: string }
  > {
    const result = {} as Record<
      IntegrationId,
      { available: boolean; reason?: string }
    >;

    for (const definition of Object.values(INTEGRATION_DEFINITIONS)) {
      const { clientId, clientSecret } = this.credentialsFor(
        definition.provider,
      );
      if (!clientId || !clientSecret) {
        result[definition.id] = {
          available: false,
          reason: `${definition.providerLabel} OAuth is not configured on this deployment.`,
        };
      } else if (!this.crypto.isConfigured) {
        result[definition.id] = {
          available: false,
          reason:
            "Token encryption is not configured, so connections are disabled.",
        };
      } else {
        result[definition.id] = { available: true };
      }
    }

    return result;
  }

  private assertAvailable(definition: IntegrationDefinition) {
    const status = this.availability()[definition.id];
    if (!status.available) {
      throw new ServiceUnavailableException(status.reason);
    }
  }

  // ── authorization redirect ───────────────────────────────────────────────

  /**
   * Mints a single-use state row and returns the provider consent URL.
   *
   * The state is stored server-side rather than signed into the URL so a
   * replayed callback can be rejected by marking the row consumed.
   */
  async createAuthorizationUrl(params: {
    userId: string;
    restaurantId?: string | null;
    integrationId: IntegrationId;
    returnPath?: string;
    consent: RedeemedIntegrationConsent;
  }): Promise<{ authorizationUrl: string }> {
    const definition = INTEGRATION_DEFINITIONS[params.integrationId];
    this.assertAvailable(definition);

    // ADR 0144: no provider flow opens without a redeemed seal, a house, and a
    // browser proof hash the initiating tab holds the preimage of.
    const consent = params.consent;
    if (
      !consent?.sealId ||
      !params.restaurantId ||
      !HEX_256_PATTERN.test(consent.browserProofHash)
    ) {
      throw new ForbiddenException(
        "Read and seal the integration permission in this browser first.",
      );
    }
    const frontendOrigin = this.consentFrontendOrigin(consent.frontendOrigin);

    // The receipt is filed BEFORE the state row: a provider flow must never be
    // open for a consent the house has no record of.
    const { error: receiptError } = await this.db.client
      .from("integration_consent_receipts")
      .insert({
        seal_id: consent.sealId,
        user_id: params.userId,
        restaurant_id: params.restaurantId,
        integration_id: params.integrationId,
        disclosure_digest: consent.digest,
        disclosure_snapshot: consent.snapshot,
      });
    if (receiptError) {
      throw new ServiceUnavailableException(
        "The consent receipt could not be filed. No provider flow was opened; read and hold again.",
      );
    }

    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const { error } = await this.db.client
      .from("integration_oauth_states")
      .insert({
        state,
        user_id: params.userId,
        restaurant_id: params.restaurantId ?? null,
        provider: definition.provider,
        integration_id: definition.id,
        return_path: this.safeReturnPath(params.returnPath),
        expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
        consent_receipt_id: consent.sealId,
        browser_proof_hash: consent.browserProofHash,
        browser_request_id: consent.browserRequestId,
        frontend_origin: frontendOrigin,
        pkce_verifier_encrypted: this.crypto.encrypt(verifier),
      });

    if (error) {
      this.logger.error(`Failed to persist OAuth state: ${error.message}`);
      throw new ServiceUnavailableException(
        "Could not start the authorization flow. Try again.",
      );
    }

    return {
      authorizationUrl: this.buildProviderUrl(definition, state, verifier),
    };
  }

  /**
   * Only same-site paths may be used as a post-callback destination.
   *
   * The check is purely syntactic, so it resolves against a fixed placeholder
   * origin rather than FRONTEND_URL: whether `/x` stays on the base it was
   * resolved against does not depend on which base that is, and a malformed
   * FRONTEND_URL must not turn a path check into a 500 (KL audit J2).
   */
  safeReturnPath(returnPath?: string): string {
    const fallback = "/settings";
    if (!returnPath || !returnPath.startsWith("/") || returnPath.startsWith("//")) {
      return fallback;
    }
    // Control characters and backslashes are the point of the check: browsers
    // normalise `/\evil.test` to a protocol-relative URL.
    // eslint-disable-next-line no-control-regex
    if (/[\\\x00-\x20\x7f]/.test(returnPath)) return fallback;
    const base = "https://return-path.invalid";
    try {
      const parsed = new URL(returnPath, base);
      if (parsed.origin !== base) return fallback;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return fallback;
    }
  }

  /**
   * The browser origin a consent flow may return to, or a 403.
   *
   * The allow-list is the production domain from `cors-origins.ts` (kept in
   * code because an env-only list broke production on 2026-09-01) plus every
   * FRONTEND_URL entry that parses. An entry that does not parse is skipped,
   * never thrown on (KL audit J2). Regex CORS entries such as `*.vercel.app`
   * are deliberately NOT admitted: this origin is where the completion page
   * receives its state, so it is an exact list, not a pattern.
   */
  consentFrontendOrigin(origin: string | undefined): string {
    const allowed = new Set<string>(PRODUCTION_ORIGINS);
    for (const url of this.configuredFrontendUrls()) allowed.add(url.origin);
    if (!origin || !allowed.has(origin)) {
      throw new ForbiddenException(
        "Open this permission in a configured Mudavym browser origin.",
      );
    }
    return origin;
  }

  authorizationTarget(integrationId: IntegrationId): string {
    const url = new URL(this.buildProviderUrl(INTEGRATION_DEFINITIONS[integrationId], ""));
    url.searchParams.delete("state");
    return url.toString();
  }

  private buildProviderUrl(
    definition: IntegrationDefinition,
    state: string,
    verifier?: string,
  ): string {
    const { clientId } = this.credentialsFor(definition.provider);
    const redirectUri = this.redirectUriFor(definition.provider);
    const scope = scopeStringFor(definition);

    if (definition.provider === "google") {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", clientId!);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", scope);
      url.searchParams.set("state", state);
      if (verifier) {
        url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
        url.searchParams.set("code_challenge_method", "S256");
      }
      // access_type=offline is the only way to get a refresh token from Google,
      // and it only returns one when prompt=consent forces the consent screen.
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      return url.toString();
    }

    const tenant = this.config.get<string>("MICROSOFT_TENANT_ID") ?? "common";
    const url = new URL(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    );
    url.searchParams.set("client_id", clientId!);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", scope);
    url.searchParams.set("state", state);
    if (verifier) {
      url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
      url.searchParams.set("code_challenge_method", "S256");
    }
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  // ── callback ────────────────────────────────────────────────────────────

  /**
   * The provider redirect target. It only PARKS an encrypted result and never
   * exchanges a code: the initiating tab supplies its separately held proof on
   * the completion POST. No cross-site cookie assumption, and no provider code
   * in the frontend URL.
   *
   * Never throws for provider-side failures: the person is mid-redirect in a
   * browser, so problems come back as a status on the return URL.
   */
  async handleCallback(params: {
    provider: string;
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    const fallback = `${this.webAppUrl()}/settings`;
    if (!params.state) return this.resultUrl(fallback, "error", "missing_state");
    if (!STATE_PATTERN.test(params.state)) {
      return this.resultUrl(fallback, "error", "invalid_state");
    }

    const { data: stateRow, error } = await this.db.client
      .from("integration_oauth_states")
      .select(BROWSER_STATE_COLUMNS)
      .eq("state", params.state)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    // A legacy state minted before ADR 0144 carries no receipt and no proof
    // hash, so nothing could ever complete it; refuse it here.
    if (error || !stateRow?.consent_receipt_id || !stateRow.browser_proof_hash) {
      return this.resultUrl(fallback, "error", "invalid_state");
    }
    if (params.provider !== stateRow.provider || (!params.code && !params.error)) {
      return this.resultUrl(fallback, "error", "invalid_callback");
    }

    let frontendOrigin: string;
    try {
      frontendOrigin = this.consentFrontendOrigin(stateRow.frontend_origin);
    } catch {
      return this.resultUrl(fallback, "error", "invalid_browser_origin");
    }

    // Provider prose is untrusted and may contain tokens. Keep only the code
    // and a fixed denial/failure code, encrypted until the sealing tab claims it.
    const payload = this.crypto.encrypt(
      JSON.stringify({
        code: params.error ? null : params.code,
        error: params.error
          ? params.error === "access_denied"
            ? "denied"
            : "provider_error"
          : null,
      }),
    );
    // Minted fresh for THIS callback, never earlier: unlike browser_proof_hash
    // (chosen by the sealer before the provider redirect even exists),
    // deliverySecret exists only from here on, and only this response ever
    // carries the raw value. A sealer who leaks the provider URL to someone
    // else, without leaking this redirect back, can never learn it (KL audit
    // D1 — see completeCallback/consumeBrowserState for the other half).
    const deliverySecret = randomBytes(32).toString("hex");
    const { data: parked, error: parkError } = await this.db.client
      .from("integration_oauth_states")
      .update({
        callback_payload_encrypted: payload,
        callback_received_at: new Date().toISOString(),
        browser_delivery_secret_hash: hashSealToken(deliverySecret),
      })
      .eq("state", params.state)
      .is("consumed_at", null)
      .is("callback_received_at", null)
      .gt("expires_at", new Date().toISOString())
      .select("state");
    if (parkError) return this.resultUrl(fallback, "error", "invalid_state");

    if (!parked?.length) {
      // A SECOND provider callback for a state that was live a moment ago: the
      // provider URL is in someone else's hands too. Whichever callback arrived
      // first, nobody can tell whose account its code names, and PKCE cannot
      // either, because a leaked URL carries the same code_challenge. So the
      // grant dies: consume the state and erase the parked code and verifier,
      // so the sealing tab cannot complete with an attacker's code (KL audit
      // J1). A state that was consumed or expired in the meantime matches
      // nothing here, which is also correct.
      await this.poisonState(params.state);
      return this.resultUrl(fallback, "error", "invalid_state");
    }

    const destination = new URL("/authorize/complete", frontendOrigin);
    destination.hash = new URLSearchParams({
      state: params.state,
      request: stateRow.browser_request_id,
      delivery: deliverySecret,
    }).toString();
    return destination.toString();
  }

  /** Kill a live state: nothing parked in it can ever be exchanged. */
  private async poisonState(state: string, reason = "A second provider callback arrived for one state; the grant was voided."): Promise<void> {
    const { error } = await this.db.client
      .from("integration_oauth_states")
      .update({
        consumed_at: new Date().toISOString(),
        callback_payload_encrypted: null,
        pkce_verifier_encrypted: null,
        browser_delivery_secret_hash: null,
      })
      .eq("state", state)
      .is("consumed_at", null);
    if (error) {
      // Logged as an error, not swallowed quietly: a parked code from a
      // duplicated callback survives until the state expires (10 minutes).
      this.logger.error(`A live state could not be poisoned: ${error.message}`);
    } else {
      this.logger.warn(reason);
    }
  }

  async completeCallback(params: {
    state: string;
    browserProof: string;
    deliverySecret: string;
  }): Promise<{ destination: string }> {
    const stateRow = await this.consumeBrowserState(
      params.state,
      params.browserProof,
      params.deliverySecret,
    );
    if (!stateRow) {
      throw new ForbiddenException(
        "This permission must finish in the tab that sealed it, before it expires. Start again from your profile.",
      );
    }
    const returnBase = `${stateRow.frontend_origin}${this.safeReturnPath(stateRow.return_path)}`;
    const refused = (reason: string) => ({
      destination: this.resultUrl(returnBase, "error", reason, stateRow.integration_id),
    });

    try {
      const payload = JSON.parse(this.crypto.decrypt(stateRow.callback_payload_encrypted));
      if (payload.error) return refused(payload.error);

      const definition = INTEGRATION_DEFINITIONS[stateRow.integration_id as IntegrationId];
      if (!definition || !payload.code) throw new Error("Invalid callback payload");

      // Membership is checked on BOTH sides of the exchange: the provider round
      // trip can outlast a revocation, and nothing is stored for a person who
      // no longer works in the house.
      await this.assertConsentMembership(stateRow.user_id, stateRow.restaurant_id);
      const verifier = this.crypto.decrypt(stateRow.pkce_verifier_encrypted);
      const tokens = await this.exchangeCode(definition, payload.code, verifier);
      if (!tokens.access_token) throw new Error("No access token returned");

      const namesAccount = definition.scopes.some(({ scope }) =>
        ["email", "https://www.googleapis.com/auth/userinfo.email", "User.Read"].includes(scope),
      );
      const account = namesAccount
        ? await this.fetchAccountEmail(definition.provider, tokens.access_token)
        : null;

      await this.assertConsentMembership(stateRow.user_id, stateRow.restaurant_id);
      await this.storeConnection({
        userId: stateRow.user_id,
        restaurantId: stateRow.restaurant_id,
        definition,
        tokens,
        account,
        consentReceiptId: stateRow.consent_receipt_id,
      });
      return { destination: this.resultUrl(returnBase, "connected", undefined, definition.id) };
    } catch (err) {
      if (err instanceof ConsentMembershipRefusal) {
        this.logger.warn(
          `Integration grant for ${stateRow.integration_id} stopped: ${err.reason}`,
        );
        return refused(err.reason);
      }
      // The error CLASS and the provider's own code/description (postToken
      // throws only payload.error_description / payload.error / the HTTP
      // status — never a token or a client secret) are logged so a real
      // exchange failure stays diagnosable in production (KL audit D11);
      // main previously logged only the integration id.
      const errorClass = err instanceof Error ? err.constructor.name : typeof err;
      const errorDetail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Integration exchange could not be completed for ${stateRow.integration_id}: ${errorClass}: ${errorDetail}`,
      );
      return refused("exchange_failed");
    }
  }

  /**
   * The person must still be verified and still hold a membership in the house
   * the grant was sealed in. Throws `ConsentMembershipRefusal` with the cause.
   */
  private async assertConsentMembership(userId: string, restaurantId: string) {
    const { data: user, error } = await this.db.client
      .from("users")
      .select("user_id, restaurant_id, email_verified")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new ConsentMembershipRefusal("membership_unreadable");
    if (!user || user.email_verified !== true || !restaurantId) {
      throw new ConsentMembershipRefusal("membership_refused");
    }
    try {
      await currentRestaurantRole(this.db.client, user, restaurantId);
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw new ConsentMembershipRefusal("membership_refused");
      }
      // ServiceUnavailableException (the access row could not be read) and
      // anything unexpected: the standing is UNKNOWN, which is not a refusal.
      throw new ConsentMembershipRefusal("membership_unreadable");
    }
  }

  private resultUrl(
    base: string,
    status: "connected" | "error",
    reason?: string,
    integrationId?: string,
  ): string {
    const url = new URL(base);
    url.searchParams.set("integration_status", status);
    if (integrationId) url.searchParams.set("integration", integrationId);
    if (reason) url.searchParams.set("integration_reason", reason);
    return url.toString();
  }

  /**
   * Read the parked payload, then atomically claim and erase it.
   *
   * Racing completions can both READ the row, but the claim is a conditional
   * update on `consumed_at is null`, so exactly one of them may exchange.
   *
   * Two independent secrets must both match (KL audit D1). `browserProof` is
   * chosen by the SEALER, before the provider redirect exists — a dishonest
   * sealer who forwards the provider URL to someone else keeps holding it, so
   * it alone cannot tell the sealer's own tab apart from an attacker's. The
   * `deliverySecret` is minted only once a provider callback actually parks a
   * result (`handleCallback`) and travels only in that redirect's fragment —
   * only the browser that returned from the provider ever sees it. A sealer
   * who never completes the provider flow herself has the first secret and
   * not the second; whoever's browser did complete it has the second and not
   * the first (unless they are the same browser, which is the honest case).
   * The row is READ by state alone, not filtered by either secret, precisely
   * so a wrong secret can be told apart from "no such live state" and the
   * state poisoned rather than left live for a retry.
   */
  private async consumeBrowserState(state: string, browserProof: string, deliverySecret: string) {
    if (
      !STATE_PATTERN.test(state) ||
      !HEX_256_PATTERN.test(browserProof) ||
      !HEX_256_PATTERN.test(deliverySecret)
    ) {
      return null;
    }
    const proofHash = hashSealToken(browserProof);
    const deliveryHash = hashSealToken(deliverySecret);
    const now = new Date().toISOString();

    const { data, error } = await this.db.client
      .from("integration_oauth_states")
      .select(BROWSER_STATE_COLUMNS)
      .eq("state", state)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .maybeSingle();
    if (
      error ||
      !data?.consent_receipt_id ||
      !data.callback_payload_encrypted ||
      !data.pkce_verifier_encrypted ||
      !data.browser_delivery_secret_hash
    ) {
      // Not sealed, not yet parked by a provider callback, expired, or already
      // consumed: nothing live to poison, and nothing to complete.
      return null;
    }

    const proofOk = digestsMatch(data.browser_proof_hash ?? "", proofHash);
    const deliveryOk = digestsMatch(data.browser_delivery_secret_hash ?? "", deliveryHash);
    if (!proofOk || !deliveryOk) {
      // A live, parked state that this attempt could not correctly claim.
      // Poison it immediately so a later attempt — the sealer retrying with
      // her real proof but no delivery secret, or the reverse — can never
      // complete it either (KL audit D1: this is what closes the account-
      // injection path, not merely a courtesy for a mistyped value).
      await this.poisonState(
        state,
        proofOk
          ? "A completion attempt held the sealing proof but not the delivery secret from the provider redirect; the grant was voided."
          : "A completion attempt did not hold the sealing browser's proof; the grant was voided.",
      );
      return null;
    }

    try {
      this.consentFrontendOrigin(data.frontend_origin);
    } catch {
      return null;
    }

    const { data: claimed, error: claimError } = await this.db.client
      .from("integration_oauth_states")
      .update({
        consumed_at: new Date().toISOString(),
        callback_payload_encrypted: null,
        pkce_verifier_encrypted: null,
      })
      .eq("state", state)
      .eq("browser_proof_hash", proofHash)
      .eq("browser_delivery_secret_hash", deliveryHash)
      .is("consumed_at", null)
      .gt("expires_at", now)
      .select("state");
    return !claimError && claimed?.length === 1 ? data : null;
  }

  private async exchangeCode(
    definition: IntegrationDefinition,
    code: string,
    verifier: string,
  ): Promise<TokenResponse> {
    const { clientId, clientSecret } = this.credentialsFor(definition.provider);
    const body = new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: this.redirectUriFor(definition.provider),
      grant_type: "authorization_code",
      code_verifier: verifier,
    });

    return this.postToken(definition.provider, body);
  }

  private async postToken(
    provider: IntegrationProvider,
    body: URLSearchParams,
  ): Promise<TokenResponse> {
    const tenant = this.config.get<string>("MICROSOFT_TENANT_ID") ?? "common";
    const url =
      provider === "google"
        ? "https://oauth2.googleapis.com/token"
        : `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

    const response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    const payload = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok) {
      throw new Error(
        payload.error_description ||
          payload.error ||
          `Token endpoint returned ${response.status}`,
      );
    }
    return payload;
  }

  private async fetchAccountEmail(
    provider: IntegrationProvider,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const url =
        provider === "google"
          ? "https://www.googleapis.com/oauth2/v3/userinfo"
          : "https://graph.microsoft.com/v1.0/me";

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) return null;

      const data = (await response.json()) as Record<string, unknown>;
      const email =
        data.email ?? data.mail ?? data.userPrincipalName ?? data.name;
      return typeof email === "string" ? email : null;
    } catch {
      // A missing display name must not fail an otherwise valid connection.
      return null;
    }
  }

  private async storeConnection(params: {
    userId: string;
    restaurantId: string | null;
    definition: IntegrationDefinition;
    tokens: TokenResponse;
    account: string | null;
    consentReceiptId: string;
  }) {
    const { tokens, definition } = params;

    // Google's authorize call sets include_granted_scopes=true (needed so a
    // second integration on the same Google account does not re-prompt for
    // scopes the person already granted the first one). That means
    // tokens.scope can legitimately carry scopes from an EARLIER, DIFFERENT
    // integration's consent. The stored receipt promises the digest of what
    // THIS integration disclosed, so only scopes this integration's own
    // definition names are ever kept; anything else the token carries is
    // dropped here, never stored (KL audit D3).
    const definedScopes = new Set(definition.scopes.map((s) => s.scope));
    const grantedScopes = tokens.scope
      ? tokens.scope.split(" ").filter((scope) => definedScopes.has(scope))
      : definition.scopes.map((s) => s.scope);

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Google omits refresh_token when the user already granted these scopes to
    // an earlier connection; keeping the stored one avoids downgrading a
    // working connection to access-token-only.
    const refreshToken = tokens.refresh_token ?? await this.storedRefreshToken(
      params.userId,
      definition.id,
      params.restaurantId,
      params.account,
    );

    const { error } = await this.db.client
      .from("integration_oauth_connections")
      .upsert(
        {
          user_id: params.userId,
          restaurant_id: params.restaurantId,
          provider: definition.provider,
          integration_id: definition.id,
          account_email: params.account,
          consent_receipt_id: params.consentReceiptId,
          scopes: grantedScopes,
          access_token_encrypted: this.crypto.encrypt(tokens.access_token!),
          refresh_token_encrypted: refreshToken
            ? this.crypto.encrypt(refreshToken)
            : null,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: "user_id,integration_id" },
      );

    if (error) {
      throw new Error(`Failed to store connection: ${error.message}`);
    }
  }

  private async storedRefreshToken(
    userId: string,
    integrationId: IntegrationId,
    restaurantId: string | null,
    account: string | null,
  ): Promise<string | null> {
    if (!restaurantId || !account) return null;
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("refresh_token_encrypted")
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .eq("restaurant_id", restaurantId)
      .eq("account_email", account)
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw new ServiceUnavailableException("The prior connection could not be read.");

    return this.crypto.tryDecrypt(data?.refresh_token_encrypted);
  }

  // ── reads and revocation ────────────────────────────────────────────────

  /**
   * A person's grants, in ONE restaurant (G21, fixed 2026-09-03).
   *
   * This filtered on `user_id` alone while `restaurant_id` was written on every
   * grant (`:150` on the state row, `:439` on the connection), so a Drive grant
   * made while standing in restaurant A was listed while standing in restaurant
   * B. `settings/next/st-format.ts:103` even labels the tab `'account'` scope
   * for exactly that reason — the label was on the tab because the filter was
   * not on the row.
   *
   * `restaurant_id` is NULLABLE (`20260826170000:126`) and a null is NOT
   * treated as "belongs to no one, hide it": a grant recorded before a tenant
   * was on the token is a live grant, and dropping it here would turn a real
   * attachment into an absence — the one thing this codebase refuses to do. It
   * is listed in every restaurant, carrying `restaurantId: null`, so the
   * surface can say that its house was never recorded rather than imply one.
   *
   * `restaurantId: null` from the caller means "this session has no tenant", and
   * then no restaurant filter is applied at all — the caller is asking about a
   * person, not about a house.
   */
  async listConnections(
    userId: string,
    restaurantId: string | null = null,
  ): Promise<ConnectionSummary[]> {
    let query = this.db.client
      .from("integration_oauth_connections")
      .select(
        "integration_id, provider, account_email, scopes, connected_at, revoked_at, restaurant_id",
      )
      .eq("user_id", userId)
      .is("revoked_at", null);

    if (restaurantId) {
      if (!UUID_RE.test(restaurantId)) {
        // The value comes from the signed token, so this is belt and braces —
        // but an `or=` filter is a raw string, and a raw string built from an
        // unvalidated id is how a scope filter becomes a scope bypass.
        throw new Error(
          "listConnections was given a restaurant id that is not a UUID",
        );
      }
      query = query.or(
        `restaurant_id.eq.${restaurantId},restaurant_id.is.null`,
      );
    }

    const { data, error } = await query;

    if (error) {
      // A failed read REFUSES. Until 2026-09-12 this returned `[]`, which the
      // map below turned into `connected: false` for every integration, so a
      // database failure was served as "nothing connected". The rule
      // `listHouseGrants` already states: an empty list on failure is the most
      // confident possible lie about it.
      this.logger.error(`Failed to list connections: ${error.message}`);
      throw new ServiceUnavailableException(
        "Your connections could not be read, so whether anything is connected is unknown. Try again.",
      );
    }

    const byId = new Map(data?.map((row) => [row.integration_id, row]) ?? []);

    return Object.values(INTEGRATION_DEFINITIONS).map((definition) => {
      const row = byId.get(definition.id);
      return {
        integrationId: definition.id,
        provider: definition.provider,
        connected: Boolean(row),
        account: row?.account_email ?? null,
        scopes: row?.scopes ?? [],
        connectedAt: row?.connected_at ?? null,
        restaurantId: (row?.restaurant_id as string | null) ?? null,
      };
    });
  }

  /**
   * Every personal grant recorded against THIS restaurant, with its owner.
   *
   * Manager-gated at the controller. The reciprocal obligation from
   * `.planning/06-pages/profile.md` §13a: moving the house's registers off
   * `/profile` only works if `/connections` can name every personal grant that
   * acts inside the house — otherwise the split produces a second incomplete
   * list, which is the fault it exists to fix.
   *
   * A read error THROWS. This list's whole job is to be complete, and an empty
   * array on failure would be the most confident possible lie about it.
   */
  async listHouseGrants(restaurantId: string): Promise<HouseGrantsResponse> {
    if (!UUID_RE.test(restaurantId)) {
      throw new BadRequestException("That is not a restaurant id.");
    }

    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select(
        "id, user_id, integration_id, provider, account_email, scopes, connected_at, token_expires_at",
      )
      .eq("restaurant_id", restaurantId)
      .is("revoked_at", null);

    if (error) {
      throw new InternalServerErrorException(
        `The house's list of personal grants could not be read: ${error.message}`,
      );
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    const [people, revocations, unattributed] = await Promise.all([
      this.peopleFor(rows.map((r) => String(r.user_id))),
      this.houseRevocations(restaurantId),
      this.countUnattributed(restaurantId),
    ]);

    const grants = rows
      .filter((r) => isIntegrationId(String(r.integration_id)))
      .map((r) => {
        const id = String(r.integration_id) as IntegrationId;
        const definition = INTEGRATION_DEFINITIONS[id];
        const owner = people.get(String(r.user_id));
        const cut = revocations.get(String(r.id));
        return {
          connectionId: String(r.id),
          integrationId: id,
          provider: definition.provider,
          label: definition.label,
          ownerUserId: String(r.user_id),
          ownerName: owner?.name ?? null,
          ownerEmail: owner?.email ?? null,
          account: (r.account_email as string | null) ?? null,
          scopes: Array.isArray(r.scopes) ? (r.scopes as string[]) : [],
          connectedAt: (r.connected_at as string | null) ?? null,
          tokenExpiresAt: (r.token_expires_at as string | null) ?? null,
          houseAccess: {
            revoked: Boolean(cut),
            at: cut?.at ?? null,
            by: cut?.by ?? null,
            byName: cut?.by ? (people.get(cut.by)?.name ?? null) : null,
            reason: cut?.reason ?? null,
          },
        };
      });

    return { grants, unattributed };
  }

  /**
   * Stop, or resume, this house's use of one person's grant.
   *
   * It does NOT revoke the grant. That belongs to the person whose Google
   * account it is, and there is no code path here that could take it — the
   * house adds itself to a revocation list and stops asking for a token.
   */
  async setHouseGrantAccess(params: {
    restaurantId: string;
    connectionId: string;
    managerUserId: string;
    houseUses: boolean;
    reason?: string | null;
  }): Promise<HouseGrantsResponse> {
    const { data: row, error: readError } = await this.db.client
      .from("integration_oauth_connections")
      .select("id, restaurant_id")
      .eq("id", params.connectionId)
      .eq("restaurant_id", params.restaurantId)
      .maybeSingle();

    if (readError) {
      throw new InternalServerErrorException(
        `That grant could not be read: ${readError.message}`,
      );
    }
    if (!row) {
      throw new NotFoundException(
        "No personal grant with that id is recorded against this restaurant.",
      );
    }

    if (params.houseUses) {
      const { error } = await this.db.client
        .from("restaurant_personal_grant_access")
        .delete()
        .eq("restaurant_id", params.restaurantId)
        .eq("connection_id", params.connectionId);
      if (error) {
        throw new InternalServerErrorException(
          `The house's access was not restored: ${error.message}`,
        );
      }
    } else {
      const { error } = await this.db.client
        .from("restaurant_personal_grant_access")
        .upsert(
          {
            restaurant_id: params.restaurantId,
            connection_id: params.connectionId,
            revoked_at: new Date().toISOString(),
            revoked_by: params.managerUserId,
            reason: params.reason ?? null,
          },
          { onConflict: "restaurant_id,connection_id" },
        );
      if (error) {
        throw new InternalServerErrorException(
          `The house's access was not withdrawn: ${error.message}`,
        );
      }
    }

    return this.listHouseGrants(params.restaurantId);
  }

  private async peopleFor(
    ids: string[],
  ): Promise<Map<string, { name: string | null; email: string | null }>> {
    const out = new Map<string, { name: string | null; email: string | null }>();
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return out;

    const { data, error } = await this.db.client
      .from("users")
      .select("user_id, name, email")
      .in("user_id", unique);

    if (error) {
      // Not fatal and not filled in: the row carries nulls and the page says
      // the account could not be named, rather than showing a plausible one.
      this.logger.error(`Failed to name grant owners: ${error.message}`);
      return out;
    }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.set(String(r.user_id), {
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
      });
    }
    return out;
  }

  private async houseRevocations(
    restaurantId: string,
  ): Promise<
    Map<string, { at: string; by: string | null; reason: string | null }>
  > {
    const out = new Map<
      string,
      { at: string; by: string | null; reason: string | null }
    >();
    const { data, error } = await this.db.client
      .from("restaurant_personal_grant_access")
      .select("connection_id, revoked_at, revoked_by, reason")
      .eq("restaurant_id", restaurantId);

    if (error) {
      // Fatal here, unlike the name lookup: not knowing which grants the house
      // has cut off would render every one of them as live.
      throw new InternalServerErrorException(
        `Which grants this house still uses could not be read: ${error.message}`,
      );
    }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.set(String(r.connection_id), {
        at: String(r.revoked_at),
        by: (r.revoked_by as string | null) ?? null,
        reason: (r.reason as string | null) ?? null,
      });
    }
    return out;
  }

  /**
   * Live grants belonging to people who work here but recorded against no
   * restaurant. Counted, never guessed at: they are listed on nobody's house
   * page and they still work.
   */
  private async countUnattributed(restaurantId: string): Promise<number> {
    const { data: members, error: memberError } = await this.db.client
      .from("user_restaurant_access")
      .select("user_id")
      .eq("restaurant_id", restaurantId)
      .eq("is_active", true);

    if (memberError || !members || members.length === 0) return 0;

    const { count, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("id", { count: "exact", head: true })
      .in(
        "user_id",
        members.map((m) => String((m as Record<string, unknown>).user_id)),
      )
      .is("restaurant_id", null)
      .is("revoked_at", null);

    if (error) return 0;
    return count ?? 0;
  }

  /**
   * Revokes at the provider first, then locally. Doing it in that order means a
   * provider outage leaves the row intact so the user can retry, instead of us
   * forgetting about a grant that is still live on Google's side.
   *
   * TENANT (fixed 2026-09-12). `restaurantId` is the house on the caller's
   * token, REQUIRED for the reason it is at `getAccessToken`: a caller cannot
   * skip the check by omitting it. The row is keyed per person
   * (UNIQUE(user_id, integration_id)) but recorded against one house, and
   * revoking it reaches that house — for a mirroring grant it sweeps that
   * house's raw mail. The lookup used to ignore the tenant, so a token scoped
   * to house B revoked the grant recorded against house A. The refusal sits
   * BEFORE the provider revoke, which cannot be undone.
   *
   * A grant with no recorded house (`restaurant_id IS NULL`) stays revocable
   * from any session: `listConnections` lists it in every house, so the page
   * offers Disconnect for it there, and refusing would strand a live grant.
   */
  async disconnect(
    userId: string,
    integrationId: IntegrationId,
    restaurantId: string | null,
  ) {
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select(
        "id, provider, restaurant_id, refresh_token_encrypted, access_token_encrypted",
      )
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to load connection: ${error.message}`);
      throw new ServiceUnavailableException("Could not read the connection.");
    }
    if (!data) {
      throw new NotFoundException("That integration is not connected.");
    }

    const recordedIn = (data.restaurant_id as string | null) ?? null;
    if (
      recordedIn &&
      recordedIn.toLowerCase() !== (restaurantId ?? "").toLowerCase()
    ) {
      throw new ForbiddenException(
        "That grant was made in a different restaurant, so it cannot be disconnected from this one. Switch to that restaurant to disconnect it. Nothing was revoked.",
      );
    }

    const token =
      this.crypto.tryDecrypt(data.refresh_token_encrypted) ??
      this.crypto.tryDecrypt(data.access_token_encrypted);

    if (token) await this.revokeAtProvider(data.provider, token);

    const { error: updateError } = await this.db.client
      .from("integration_oauth_connections")
      .update({
        revoked_at: new Date().toISOString(),
        access_token_encrypted: null,
        refresh_token_encrypted: null,
        token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    if (updateError) {
      throw new ServiceUnavailableException(
        "Revoked upstream but failed to update the local record.",
      );
    }

    // ADR 0118 (retention) — "stop reads AND delete the raw mail" is one
    // promise, made on the consent screen before the grant. The stopping is
    // above (no token, `revoked_at` set, and `getAccessToken` is the single
    // door the reader uses). The deleting is here, and it happens for every
    // grant that can mirror mail into the house's book.
    //
    // It runs AFTER the local record is revoked, not before: if the deletion
    // fails, the grant is already dead and no further mail arrives, whereas
    // deleting first and failing to revoke would leave a live reader refilling
    // what was just deleted.
    const mirrors = MIRRORING_INTEGRATION_IDS.includes(integrationId);
    if (mirrors) {
      if (!this.rawMailRetention) {
        // Loud, not silent. The grant IS revoked; what did not happen is the
        // deletion, and the person is told that rather than shown a success
        // that did not include the half they care about.
        throw new InternalServerErrorException(
          "The grant was revoked and nothing more will be read, but the raw mail it mirrored was NOT deleted: the retention service is not available here. The mail is still in this restaurant's conversation book.",
        );
      }
      const run = await this.rawMailRetention.sweepForRevokedGrant({
        connectionId: String(data.id),
        restaurantId: String(data.restaurant_id ?? ""),
        ownerUserId: userId,
      });
      this.logger.log(`disconnect ${integrationId}: ${run.says}`);
      return { success: true, retention: run };
    }

    return { success: true, retention: null };
  }

  private async revokeAtProvider(provider: string, token: string) {
    try {
      if (provider === "google") {
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        });
      }
      // Microsoft has no per-token revoke endpoint for delegated app grants;
      // consent is withdrawn from the account's app-permissions page. Dropping
      // our stored tokens is the most we can do from here.
    } catch (err) {
      this.logger.warn(
        `Provider revoke failed for ${provider}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Returns a usable access token, refreshing when it has expired.
   *
   * This is the entry point for feature code (exports, menu-scan uploads) that
   * needs to call Drive/Graph; nothing else should touch the token columns.
   */
  async getAccessToken(
    userId: string,
    restaurantId: string,
    integrationId: IntegrationId,
  ): Promise<string> {
    const definition = INTEGRATION_DEFINITIONS[integrationId];
    if (!definition) throw new BadRequestException("Unknown integration");

    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select(
        "id, access_token_encrypted, refresh_token_encrypted, token_expires_at",
      )
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .is("revoked_at", null)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException(`${definition.label} is not connected.`);
    }

    // The house's own switch, checked at the ONE door feature code uses. A
    // manager may cut the house off from a member's grant without touching the
    // member's credential (ADR 0114); this is where that stops being a row and
    // becomes a refusal. `restaurantId` is REQUIRED rather than optional
    // precisely so a caller cannot skip the check by omitting it.
    const cut = await this.houseRevocations(restaurantId);
    if (cut.has(String(data.id))) {
      const record = cut.get(String(data.id))!;
      throw new ForbiddenException(
        `This house has stopped using that ${definition.label} grant${record.reason ? `: ${record.reason}` : "."} The grant itself is untouched and still belongs to the person who made it.`,
      );
    }

    const expiresAt = data.token_expires_at
      ? new Date(data.token_expires_at).getTime()
      : 0;
    const stillValid = expiresAt - EXPIRY_SKEW_MS > Date.now();
    const accessToken = this.crypto.tryDecrypt(data.access_token_encrypted);

    if (stillValid && accessToken) return accessToken;

    const refreshToken = this.crypto.tryDecrypt(data.refresh_token_encrypted);
    if (!refreshToken) {
      throw new BadRequestException(
        `${definition.label} needs to be reconnected.`,
      );
    }

    const { clientId, clientSecret } = this.credentialsFor(definition.provider);
    const refreshed = await this.postToken(
      definition.provider,
      new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId!,
        client_secret: clientSecret!,
        grant_type: "refresh_token",
      }),
    );

    if (!refreshed.access_token) {
      throw new BadRequestException(
        `${definition.label} needs to be reconnected.`,
      );
    }

    await this.db.client
      .from("integration_oauth_connections")
      .update({
        access_token_encrypted: this.crypto.encrypt(refreshed.access_token),
        refresh_token_encrypted: refreshed.refresh_token
          ? this.crypto.encrypt(refreshed.refresh_token)
          : data.refresh_token_encrypted,
        token_expires_at: refreshed.expires_in
          ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    return refreshed.access_token;
  }

  /** Housekeeping for the state table; safe to call from a cron. */
  async purgeExpiredStates() {
    await this.db.client
      .from("integration_oauth_states")
      .delete()
      .lt("expires_at", new Date(Date.now() - STATE_TTL_MS).toISOString());
  }
}
