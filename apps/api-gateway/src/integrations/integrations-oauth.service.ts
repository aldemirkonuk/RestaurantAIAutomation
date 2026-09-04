import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "crypto";
import { DatabaseService } from "../database/database.service";
import { TokenCryptoService } from "../common/crypto/token-crypto.service";
import {
  INTEGRATION_DEFINITIONS,
  IntegrationDefinition,
  IntegrationId,
  IntegrationProvider,
  isIntegrationId,
  scopeStringFor,
} from "./integrations-oauth.constants";

const STATE_TTL_MS = 10 * 60 * 1000;

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

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly crypto: TokenCryptoService,
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

  private webAppUrl(): string {
    const raw =
      this.config.get<string>("FRONTEND_URL") ?? "http://localhost:3000";
    // FRONTEND_URL is a comma-separated CORS allow-list; the first entry is the
    // canonical app origin.
    return raw.split(",")[0].trim().replace(/\/$/, "");
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
  }): Promise<{ authorizationUrl: string }> {
    const definition = INTEGRATION_DEFINITIONS[params.integrationId];
    this.assertAvailable(definition);

    const state = randomBytes(32).toString("base64url");
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
      });

    if (error) {
      this.logger.error(`Failed to persist OAuth state: ${error.message}`);
      throw new ServiceUnavailableException(
        "Could not start the authorization flow. Try again.",
      );
    }

    return {
      authorizationUrl: this.buildProviderUrl(definition, state),
    };
  }

  /** Only same-site paths may be used as a post-callback destination. */
  private safeReturnPath(returnPath?: string): string {
    if (!returnPath) return "/settings";
    if (!returnPath.startsWith("/") || returnPath.startsWith("//")) {
      return "/settings";
    }
    return returnPath;
  }

  private buildProviderUrl(
    definition: IntegrationDefinition,
    state: string,
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
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  // ── callback ────────────────────────────────────────────────────────────

  /**
   * Completes the handshake and returns the browser destination.
   *
   * Never throws for provider-side failures: the user is mid-redirect in a
   * browser, so problems have to come back as a status on the return URL
   * rather than a JSON error they would never see.
   */
  async handleCallback(params: {
    provider: string;
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    const fallback = `${this.webAppUrl()}/settings`;

    if (!params.state) {
      return this.resultUrl(fallback, "error", "missing_state");
    }

    const stateRow = await this.consumeState(params.state);
    if (!stateRow) {
      return this.resultUrl(fallback, "error", "invalid_state");
    }

    const returnBase = `${this.webAppUrl()}${stateRow.return_path ?? "/settings"}`;

    if (params.error) {
      // The user clicking "Deny" lands here; it is a normal outcome.
      const reason = params.error === "access_denied" ? "denied" : params.error;
      return this.resultUrl(
        returnBase,
        "error",
        reason,
        stateRow.integration_id,
      );
    }

    if (!params.code || params.provider !== stateRow.provider) {
      return this.resultUrl(
        returnBase,
        "error",
        "invalid_callback",
        stateRow.integration_id,
      );
    }

    const definition =
      INTEGRATION_DEFINITIONS[stateRow.integration_id as IntegrationId];
    if (!definition) {
      return this.resultUrl(returnBase, "error", "unknown_integration");
    }

    try {
      const tokens = await this.exchangeCode(definition, params.code);

      if (!tokens.access_token) {
        throw new Error(
          tokens.error_description ||
            tokens.error ||
            "No access token returned",
        );
      }

      const account = await this.fetchAccountEmail(
        definition.provider,
        tokens.access_token,
      );

      await this.storeConnection({
        userId: stateRow.user_id,
        restaurantId: stateRow.restaurant_id,
        definition,
        tokens,
        account,
      });

      return this.resultUrl(returnBase, "connected", undefined, definition.id);
    } catch (err) {
      this.logger.error(
        `Integration OAuth callback failed for ${definition.id}: ${(err as Error).message}`,
      );
      return this.resultUrl(
        returnBase,
        "error",
        "exchange_failed",
        definition.id,
      );
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

  /** Atomically claims the state row so a replayed callback finds nothing. */
  private async consumeState(state: string) {
    const { data, error } = await this.db.client
      .from("integration_oauth_states")
      .update({ consumed_at: new Date().toISOString() })
      .eq("state", state)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .select(
        "state, user_id, restaurant_id, provider, integration_id, return_path",
      )
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to consume OAuth state: ${error.message}`);
      return null;
    }
    return data;
  }

  private async exchangeCode(
    definition: IntegrationDefinition,
    code: string,
  ): Promise<TokenResponse> {
    const { clientId, clientSecret } = this.credentialsFor(definition.provider);
    const body = new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: this.redirectUriFor(definition.provider),
      grant_type: "authorization_code",
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
  }) {
    const { tokens, definition } = params;

    const grantedScopes = tokens.scope
      ? tokens.scope.split(" ").filter(Boolean)
      : definition.scopes.map((s) => s.scope);

    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null;

    // Google omits refresh_token when the user already granted these scopes to
    // an earlier connection; keeping the stored one avoids downgrading a
    // working connection to access-token-only.
    const existingRefresh = await this.storedRefreshToken(
      params.userId,
      definition.id,
    );
    const refreshToken = tokens.refresh_token ?? existingRefresh;

    const { error } = await this.db.client
      .from("integration_oauth_connections")
      .upsert(
        {
          user_id: params.userId,
          restaurant_id: params.restaurantId,
          provider: definition.provider,
          integration_id: definition.id,
          account_email: params.account,
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
  ): Promise<string | null> {
    const { data } = await this.db.client
      .from("integration_oauth_connections")
      .select("refresh_token_encrypted")
      .eq("user_id", userId)
      .eq("integration_id", integrationId)
      .maybeSingle();

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
      this.logger.error(`Failed to list connections: ${error.message}`);
      return [];
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
   */
  async disconnect(userId: string, integrationId: IntegrationId) {
    const { data, error } = await this.db.client
      .from("integration_oauth_connections")
      .select("id, provider, refresh_token_encrypted, access_token_encrypted")
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

    return { success: true };
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
