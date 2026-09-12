import * as crypto from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import axios from "axios";

/**
 * Microsoft ID token verification — a provider token is only a credential when
 * it was minted for US.
 *
 * WHAT THIS REPLACES, AND WHY
 * ---------------------------
 * `verifyMicrosoftToken` used to take the string in the request body, send it
 * to `https://graph.microsoft.com/v1.0/me` as a Bearer token, and trust
 * `data.mail || data.userPrincipalName`. That is not verification. Graph will
 * answer for ANY valid Microsoft Graph access token, including one minted for
 * an unrelated Azure application by an attacker who controls that application:
 * there is no audience check (the token was not issued to us), no issuer check,
 * no signature check we performed ourselves, and no verified-address check. The
 * address it returned then resolved a Mudavym account by email alone, so a
 * token for an address belonging to one of our users signed the attacker in as
 * that user — including a password-only user who had never touched Microsoft.
 *
 * This is the same hole as the Google self-provision one closed in PR #179,
 * wearing a different provider's name.
 *
 * THE RULE
 * --------
 * We verify an **ID token** ourselves, against Microsoft's published JWKS:
 *
 *   1. `alg` is RS256 and nothing else. `none`, `HS256` and every other value
 *      are refused before a key is even looked up — an algorithm the token
 *      chooses is an algorithm the attacker chooses.
 *   2. The RSA signature verifies against the JWKS key named by `kid`.
 *   3. `aud` equals the configured `MICROSOFT_CLIENT_ID` exactly. This is the
 *      arm that makes "a token minted for someone else's app" useless here.
 *   4. `iss` equals the configured issuer exactly.
 *   5. It is an ID token, not an access token: `ver` is "2.0" and `scp` is
 *      absent. The exact issuer already rules out a v1.0 token; `scp` is what
 *      rules out an access token minted for this same application by an app
 *      registration that exposes an API scope.
 *   6. `exp` / `nbf` hold, with 60s of clock skew.
 *   7. The `email` claim is present and verified — see `xms_edov` below.
 *   8. `oid`, the stable subject identifier, is present.
 *
 * And before any of that, the configuration itself is checked rather than
 * merely read: `MICROSOFT_ISSUER` and `MICROSOFT_JWKS_URI` must both be https,
 * on a known Microsoft identity host, and must name the same host and the same
 * tenant segment as each other.
 *
 * FAIL CLOSED
 * -----------
 * Nothing here has a default that admits anyone. Unconfigured client id,
 * unconfigured issuer, an unreachable JWKS, an unknown `kid` that survives a
 * re-fetch: every one of them REFUSES. That is deliberate and it is the whole
 * point — this repo's standing fault is a system reporting its own ABSENCE as
 * HEALTH, and "we could not check, so come in" is that fault with a login
 * attached.
 *
 * WHY NODE `crypto` AND NOT `jsonwebtoken` OR `JwtService`
 * --------------------------------------------------------
 * No new npm dependency was added, as instructed. Two candidates were checked
 * and both were rejected on measurement, not taste:
 *
 *   - `jsonwebtoken` is a dependency of `@nestjs/jwt` but is NOT importable
 *     from this package: pnpm's strict layout keeps it under
 *     `node_modules/.pnpm/jsonwebtoken@9.0.2/...`, and
 *     `require.resolve("jsonwebtoken", { paths: ["apps/api-gateway"] })` throws
 *     MODULE_NOT_FOUND. Importing it would work on a hoisted install and break
 *     on ours.
 *   - `JwtService.verify(token, { publicKey })` would SILENTLY verify with the
 *     wrong key. `JwtService#getSecretKey` resolves
 *     `options.secret || this.options.secret || ... || options.publicKey`, and
 *     `AuthModule` registers `JwtModule` with a `secret`
 *     (`auth.module.ts:30`). So the module's own HS256 application secret wins
 *     over the RSA public key passed at the call site, and a token signed with
 *     our own JWT secret would verify as a Microsoft identity. That is a worse
 *     hole than the one being closed.
 *
 * Node's own `crypto` has everything needed: `createPublicKey({ key, format:
 * "jwk" })` turns a JWKS entry into a key object, and `crypto.verify(
 * "RSA-SHA256", ...)` is RS256. No dependency, no precedence surprise.
 */

/** A single RSA entry from Microsoft's JWKS document. */
export interface MicrosoftJwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  alg?: string;
  use?: string;
}

/** Fetches the key set at `uri`. Rejects (never resolves empty) on failure. */
export type MicrosoftJwksFetcher = (uri: string) => Promise<MicrosoftJwk[]>;

/** Everything the verifier must be told before it will accept anything. */
export interface MicrosoftOidcConfig {
  /** The audience a token must carry. `MICROSOFT_CLIENT_ID`. */
  clientId: string;
  /** The exact `iss` a token must carry. */
  issuer: string;
  /** Where the signing keys live. */
  jwksUri: string;
}

/** The identity a verified token asserts. */
export interface MicrosoftIdentity {
  /** `oid` — the stable per-tenant subject identifier. */
  oid: string;
  email: string;
  name: string;
  /** `tid` — the tenant, for logging. Null when the token omits it. */
  tid: string | null;
}

export const MICROSOFT_JWKS_TTL_MS = 10 * 60 * 1000;
export const MICROSOFT_JWKS_MIN_REFETCH_MS = 30 * 1000;
export const MICROSOFT_CLOCK_SKEW_SECONDS = 60;

/**
 * One sentence for every "this token is not good" outcome.
 *
 * Deliberately uniform: a caller holding a forged token learns that it was
 * rejected, not WHICH check rejected it. Audience, issuer, signature and
 * algorithm failures are all the same shape of answer.
 */
const TOKEN_REFUSED = "Invalid Microsoft token";
const TOKEN_EXPIRED = "Microsoft token has expired";
const ADDRESS_UNVERIFIED = "Your Microsoft email address is not verified";
const KEYS_UNREACHABLE =
  "Could not verify your Microsoft sign-in just now. Please try again.";
export const MICROSOFT_NOT_CONFIGURED =
  "Microsoft sign-in is not configured on this server.";

/**
 * Tenant placeholders that name "any tenant" rather than a tenant.
 *
 * They are refused as an issuer source on purpose. With `common`, Microsoft
 * issues `iss: https://login.microsoftonline.com/{tid}/v2.0` where `{tid}` is
 * whatever tenant the signer belongs to, so "check the issuer" would check
 * nothing — every tenant on earth passes. Supporting multi-tenant sign-in is a
 * real decision about WHICH tenants may sign in, not a default; until it is
 * made, a placeholder tenant means the route refuses.
 */
const TENANT_PLACEHOLDERS = new Set(["common", "organizations", "consumers"]);

/**
 * Hosts a Microsoft identity endpoint may live on.
 *
 * `MICROSOFT_ISSUER` and `MICROSOFT_JWKS_URI` are operator overrides, and an
 * unvalidated override is a hole with a config file in front of it: an
 * `http://` JWKS uri makes key retrieval MITM-able, and a JWKS pointed at a
 * host we do not recognise verifies whatever that host chooses to sign. So both
 * are checked, not merely read.
 */
const MICROSOFT_LOGIN_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoftonline.us",
  "login.partner.microsoftonline.cn",
  "login.microsoftonline.de",
]);

/** First path segment of a Microsoft identity URL: the tenant. */
function tenantSegmentOf(url: URL): string {
  return (url.pathname.split("/").filter(Boolean)[0] ?? "").toLowerCase();
}

function parseMicrosoftEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }
  if (url.protocol !== "https:") {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }
  if (!MICROSOFT_LOGIN_HOSTS.has(url.hostname.toLowerCase())) {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }
  return url;
}

/**
 * Read the Microsoft configuration, or refuse.
 *
 * `read` is `ConfigService#get` narrowed to a function so this stays testable
 * without a Nest container.
 *
 * The two overrides are not independent. An issuer naming one tenant paired
 * with a JWKS naming another would check the right issuer string against the
 * wrong signing keys, so the host AND the tenant segment must agree. The
 * practical consequence: override one and you must override both, with the same
 * tenant segment. That is a loud refusal rather than a silent mismatch, which
 * is the trade this file makes everywhere.
 */
export function resolveMicrosoftOidcConfig(
  read: (key: string) => string | undefined,
): MicrosoftOidcConfig {
  const clientId = (read("MICROSOFT_CLIENT_ID") ?? "").trim();
  if (!clientId) {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }

  const rawTenant = (read("MICROSOFT_TENANT_ID") ?? "").trim();
  const tenant =
    rawTenant && !TENANT_PLACEHOLDERS.has(rawTenant.toLowerCase())
      ? rawTenant
      : "";

  const issuer =
    (read("MICROSOFT_ISSUER") ?? "").trim() ||
    (tenant ? `https://login.microsoftonline.com/${tenant}/v2.0` : "");
  if (!issuer) {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }

  const jwksUri =
    (read("MICROSOFT_JWKS_URI") ?? "").trim() ||
    (tenant
      ? `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`
      : "");
  if (!jwksUri) {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }

  const issuerUrl = parseMicrosoftEndpoint(issuer);
  const jwksUrl = parseMicrosoftEndpoint(jwksUri);
  if (issuerUrl.hostname.toLowerCase() !== jwksUrl.hostname.toLowerCase()) {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }
  if (tenantSegmentOf(issuerUrl) !== tenantSegmentOf(jwksUrl)) {
    throw new UnauthorizedException(MICROSOFT_NOT_CONFIGURED);
  }

  return { clientId, issuer, jwksUri };
}

const defaultFetcher: MicrosoftJwksFetcher = async (uri: string) => {
  const response = await axios.get(uri, { timeout: 5000 });
  const keys = response?.data?.keys;
  if (!Array.isArray(keys)) {
    throw new Error(`JWKS at ${uri} carried no key array`);
  }
  return keys as MicrosoftJwk[];
};

function decodeSegment(segment: string): Record<string, unknown> {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new UnauthorizedException(TOKEN_REFUSED);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new UnauthorizedException(TOKEN_REFUSED);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnauthorizedException(TOKEN_REFUSED);
  }
  return parsed as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Is the address one Microsoft says the tenant actually owns?
 *
 * Google answers this with `email_verified`. Microsoft's v2.0 ID token does
 * not carry that claim; its analogue is `xms_edov` ("email domain owner
 * verified"), an optional claim the Azure app registration must be configured
 * to emit. Absent it, the `email` claim is documented as mutable and
 * unverified, which is exactly the property that makes matching an account by
 * address unsafe.
 *
 * Absent claim means REFUSE, not "probably fine". Turning the optional claim on
 * is a one-field change in the Azure app registration; guessing is not.
 */
function addressIsVerified(payload: Record<string, unknown>): boolean {
  const edov = payload.xms_edov;
  if (edov === true) return true;
  if (typeof edov === "string") {
    const v = edov.trim().toLowerCase();
    return v === "true" || v === "1";
  }
  return false;
}

interface CacheEntry {
  keys: MicrosoftJwk[];
  /** When these keys were fetched; drives the TTL. */
  fetchedAt: number;
  /** When we last called out for this uri; rate-limits rotation re-fetches. */
  lastFetchAt: number;
}

export class MicrosoftIdTokenVerifier {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchJwks: MicrosoftJwksFetcher = defaultFetcher,
    private readonly options: {
      ttlMs?: number;
      minRefetchMs?: number;
      now?: () => number;
    } = {},
  ) {}

  private get ttlMs(): number {
    return this.options.ttlMs ?? MICROSOFT_JWKS_TTL_MS;
  }

  private get minRefetchMs(): number {
    return this.options.minRefetchMs ?? MICROSOFT_JWKS_MIN_REFETCH_MS;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Test seam: how many times the network was actually touched. */
  private fetchCount = 0;

  fetchesMade(): number {
    return this.fetchCount;
  }

  private async refresh(uri: string, now: number): Promise<CacheEntry> {
    let keys: MicrosoftJwk[];
    this.fetchCount += 1;
    try {
      keys = await this.fetchJwks(uri);
    } catch {
      // A fetch failure is a REFUSAL, never a pass. Drop the cache so the next
      // attempt re-reads rather than trusting a set we now know we cannot
      // confirm.
      this.cache.delete(uri);
      throw new UnauthorizedException(KEYS_UNREACHABLE);
    }
    if (!Array.isArray(keys) || keys.length === 0) {
      this.cache.delete(uri);
      throw new UnauthorizedException(KEYS_UNREACHABLE);
    }
    const entry: CacheEntry = { keys, fetchedAt: now, lastFetchAt: now };
    this.cache.set(uri, entry);
    return entry;
  }

  /**
   * The key for `kid`, re-fetching once if the cached set does not name it.
   *
   * Key rotation is the reason for the second attempt: Microsoft publishes a
   * new signing key before it starts using it, but a cache filled a minute
   * earlier will not have it. `minRefetchMs` keeps a stream of forged tokens
   * carrying random `kid`s from turning into a stream of outbound requests.
   */
  private async keyFor(uri: string, kid: string): Promise<MicrosoftJwk> {
    const now = this.now();
    let entry = this.cache.get(uri);
    if (!entry || now - entry.fetchedAt >= this.ttlMs) {
      entry = await this.refresh(uri, now);
    }

    let key = entry.keys.find((k) => k.kid === kid);
    if (!key && now - entry.lastFetchAt >= this.minRefetchMs) {
      entry = await this.refresh(uri, now);
      key = entry.keys.find((k) => k.kid === kid);
    }

    if (!key) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    return key;
  }

  async verify(
    token: string,
    config: MicrosoftOidcConfig,
  ): Promise<MicrosoftIdentity> {
    if (typeof token !== "string" || token.length === 0) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    const [headerSegment, payloadSegment, signatureSegment] = parts;

    const header = decodeSegment(headerSegment);
    // RS256 or nothing. An `alg` the token names is an `alg` the attacker
    // names, so `none` and every symmetric algorithm are refused here rather
    // than handled below.
    if (header.alg !== "RS256") {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    const kid = asString(header.kid);
    if (!kid) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    const jwk = await this.keyFor(config.jwksUri, kid);
    if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    if (jwk.alg && jwk.alg !== "RS256") {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    let publicKey: crypto.KeyObject;
    try {
      publicKey = crypto.createPublicKey({
        key: {
          kty: "RSA",
          n: jwk.n,
          e: jwk.e,
        } as crypto.JsonWebKeyInput["key"],
        format: "jwk",
      });
    } catch {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    if (!/^[A-Za-z0-9_-]+$/.test(signatureSegment)) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    const signatureOk = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${headerSegment}.${payloadSegment}`, "utf8"),
      publicKey,
      Buffer.from(signatureSegment, "base64url"),
    );
    if (!signatureOk) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    const payload = decodeSegment(payloadSegment);

    // Audience. The one check that separates "a Microsoft token" from "a
    // Microsoft token for us".
    const aud = payload.aud;
    const audMatches = Array.isArray(aud)
      ? aud.includes(config.clientId)
      : aud === config.clientId;
    if (!audMatches) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    if (payload.iss !== config.issuer) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    // This must be an ID TOKEN, not an access token.
    //
    // The exact v2.0 issuer above already rules out a v1.0 token, but it does
    // NOT rule out an access token minted for this same application — an app
    // registration that exposes an API scope issues those with `aud` equal to
    // its own client id. Two claims separate them:
    //
    //   `ver` must be "2.0". Belt to the issuer's braces, and the one claim
    //   that is present on every Microsoft token of either version.
    //
    //   `scp` must be ABSENT. A delegated-permission scope claim is an
    //   access-token claim; an ID token does not carry one.
    //
    // `roles` is deliberately NOT refused: Azure app-role assignments appear in
    // a legitimate ID token as `roles`, so refusing it would reject a real
    // sign-in from any tenant that uses app roles. `scp` has no such ambiguity.
    if (payload.ver !== "2.0") {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    if (payload.scp !== undefined) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    const nowSeconds = Math.floor(this.now() / 1000);
    const exp = payload.exp;
    if (
      typeof exp !== "number" ||
      nowSeconds >= exp + MICROSOFT_CLOCK_SKEW_SECONDS
    ) {
      throw new UnauthorizedException(TOKEN_EXPIRED);
    }
    const nbf = payload.nbf;
    if (
      typeof nbf === "number" &&
      nowSeconds + MICROSOFT_CLOCK_SKEW_SECONDS < nbf
    ) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    // The `email` claim, and only it.
    //
    // This used to fall back to `preferred_username` when `email` was absent,
    // and then accept it on the strength of `xms_edov` — but `xms_edov` attests
    // the domain of the `email` claim specifically. Using it to bless a
    // different claim is borrowing a proof for something it does not prove,
    // which is the same move as reading absence as health. The fallback is
    // gone: if the token does not carry `email`, there is nothing `xms_edov`
    // can vouch for and the sign-in refuses.
    const email = asString(payload.email);
    if (!email) {
      throw new UnauthorizedException(TOKEN_REFUSED);
    }
    if (!addressIsVerified(payload)) {
      throw new UnauthorizedException(ADDRESS_UNVERIFIED);
    }

    const oid = asString(payload.oid);
    if (!oid) {
      // `oid` is what binds the token to a row in `user_oauth_accounts`.
      // Without it the sign-in can only be matched by address, which is the
      // defect this file exists to close.
      throw new UnauthorizedException(TOKEN_REFUSED);
    }

    return {
      oid,
      email,
      name: asString(payload.name) ?? email,
      tid: asString(payload.tid),
    };
  }
}
