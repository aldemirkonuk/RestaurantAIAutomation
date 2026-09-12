import * as crypto from "crypto";
import { UnauthorizedException } from "@nestjs/common";
import axios from "axios";
import { AuthService } from "./auth.service";
import {
  MICROSOFT_NOT_CONFIGURED,
  MicrosoftIdTokenVerifier,
  MicrosoftJwk,
  resolveMicrosoftOidcConfig,
} from "./microsoft-id-token";

jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

/**
 * ADR 0139 — an OAuth sign-in binds to a linked account, and a provider token
 * is a credential only when it was minted for us.
 *
 * THE TWO DEFECTS UNDER TEST
 * --------------------------
 * 1. `verifyMicrosoftToken` sent the body string to
 *    `https://graph.microsoft.com/v1.0/me` as a Bearer token and trusted the
 *    address that came back. No audience, no issuer, no signature, no verified
 *    address — so ANY Microsoft Graph access token, including one minted for an
 *    unrelated Azure application, was accepted.
 * 2. `findOrCreateOAuthUser` resolved the account by EMAIL ALONE. It never read
 *    `user_oauth_accounts`, never read `users.oauth_provider`, and never
 *    compared the provider's own subject id. So a token for an address that
 *    matches one of our users signed the holder in AS that user, including a
 *    password-only user who had never touched Microsoft.
 *
 * Every test in the two `AuthService` describes below was run against the
 * pre-fix module (`git show HEAD:apps/api-gateway/src/auth/auth.service.ts`
 * copied to a same-depth probe) and observed to FAIL there. A test that passes
 * against the bug is worse than no test.
 */

const TENANT = "contoso-tenant-id";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const JWKS_URI = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;
const CLIENT_ID = "mudavym-azure-app";
const GOOGLE_CLIENT_ID = "mudavym.apps.googleusercontent.com";

const VICTIM_EMAIL = "owner@example.com";

// Two real RSA key pairs: one Microsoft's, one an attacker's. Generated once —
// 2048-bit keygen is the slowest thing in this file.
const signing = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

function jwkOf(key: crypto.KeyObject, kid: string): MicrosoftJwk {
  return {
    ...(key.export({ format: "jwk" }) as Record<string, string>),
    kid,
    alg: "RS256",
    use: "sig",
  };
}

const KEY_SET: MicrosoftJwk[] = [jwkOf(signing.publicKey, "kid-1")];
const ROTATED_KEY_SET: MicrosoftJwk[] = [
  jwkOf(signing.publicKey, "kid-1"),
  jwkOf(attacker.publicKey, "kid-2"),
];

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signToken(
  payload: Record<string, unknown>,
  opts: {
    kid?: string;
    alg?: string;
    privateKey?: crypto.KeyObject;
    corruptSignature?: boolean;
  } = {},
): string {
  const alg = opts.alg ?? "RS256";
  const header = { alg, typ: "JWT", kid: opts.kid ?? "kid-1" };
  const input = `${b64url(header)}.${b64url(payload)}`;
  if (alg === "none") return `${input}.`;
  const signature = crypto.sign(
    "RSA-SHA256",
    Buffer.from(input, "utf8"),
    opts.privateKey ?? signing.privateKey,
  );
  if (opts.corruptSignature) {
    return `${input}.${Buffer.from("not-a-signature", "utf8").toString("base64url")}`;
  }
  return `${input}.${signature.toString("base64url")}`;
}

function msPayload(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    aud: CLIENT_ID,
    oid: "ms-oid-1",
    tid: TENANT,
    email: VICTIM_EMAIL,
    name: "Owner",
    xms_edov: true,
    iat: now - 30,
    nbf: now - 30,
    exp: now + 3600,
    ...over,
  };
}

/** The one sentence both "unknown address" and "not linked" must produce. */
const REFUSED_MS =
  "We could not sign you in with Microsoft. If you already have an account, sign in another way and link Microsoft from your profile first.";
const REFUSED_GOOGLE =
  "We could not sign you in with Google. If you already have an account, sign in another way and link Google from your profile first.";
const LINK_UNAVAILABLE =
  "We could not check your sign-in methods just now. Please try again.";

interface Fixture {
  /** The `users` row for the address, or null for an unknown address. */
  userByEmail?: Record<string, unknown> | null;
  /** Rows in `user_oauth_accounts` for that user. */
  oauthRows?: { provider: string; provider_user_id: string | null }[];
  /** A FAILED read of the link table — supabase-js resolves this, never throws. */
  oauthError?: { message: string } | null;
  config?: Record<string, string | undefined>;
}

function makeService(fx: Fixture) {
  const config: Record<string, string | undefined> = {
    MICROSOFT_CLIENT_ID: CLIENT_ID,
    MICROSOFT_TENANT_ID: TENANT,
    GOOGLE_CLIENT_ID,
    ...(fx.config ?? {}),
  };

  const from = jest.fn((table: string) => {
    if (table === "user_oauth_accounts") {
      const chain: any = {
        select: () => chain,
        eq: () =>
          Promise.resolve({
            data: fx.oauthError ? null : (fx.oauthRows ?? []),
            error: fx.oauthError ?? null,
          }),
      };
      return chain;
    }

    if (table === "users") {
      const row = fx.userByEmail ?? null;
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: row, error: null }),
        single: () =>
          Promise.resolve(
            row
              ? { data: row, error: null }
              : { data: null, error: { message: "no rows" } },
          ),
      };
      return chain;
    }

    if (table === "user_roles") {
      // generateTokens awaits `.select().eq().is()` directly.
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        is: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    }

    if (table === "user_restaurant_access") {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    }

    throw new Error(`unexpected table in this fixture: ${table}`);
  });

  const svc = new AuthService(
    {
      sign: jest.fn().mockReturnValue("signed-token"),
      verify: jest.fn(),
      decode: jest.fn(),
    } as any,
    { get: jest.fn((key: string) => config[key]) } as any,
    { supabase: { from } } as any,
    { blacklistToken: jest.fn() } as any,
    { sendEmail: jest.fn() } as any,
  );

  // The JWKS comes from a stub rather than the network. The production path
  // through axios is exercised separately, in "the default fetcher reads the
  // key set over axios" below.
  (svc as any).microsoftIdTokens = new MicrosoftIdTokenVerifier(
    async () => KEY_SET,
  );

  return { svc, from };
}

/** Message text out of an UnauthorizedException, whatever shape it carries. */
function messageOf(err: unknown): string {
  expect(err).toBeInstanceOf(UnauthorizedException);
  const body = (err as UnauthorizedException).getResponse();
  if (typeof body === "string") return body;
  return String((body as { message?: unknown }).message ?? "");
}

async function refusalFrom(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return messageOf(err);
  }
  throw new Error("expected a refusal, got a resolved sign-in");
}

let googleTokenInfo: Record<string, unknown>;

beforeEach(() => {
  googleTokenInfo = {
    aud: GOOGLE_CLIENT_ID,
    sub: "google-sub-1",
    email: VICTIM_EMAIL,
    email_verified: "true",
    name: "Owner",
  };

  (axios.get as jest.Mock).mockReset();
  (axios.get as jest.Mock).mockImplementation(async (url: string) => {
    /*
     * Routed on the PARSED host, never on a substring of the URL.
     * `url.includes("graph.microsoft.com")` also matches
     * `https://graph.microsoft.com.example.invalid/`, which is the shape
     * CodeQL calls `js/incomplete-url-substring-sanitization` - and a fixture
     * for a file about refusing tokens that were not minted for us has no
     * business modelling a host check that way, even in a mock.
     */
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`unexpected axios.get in this fixture: ${url}`);
    }
    // The PRE-FIX Microsoft path. Present so the probe run reaches the
    // behaviour under test rather than dying on an unmocked call: pre-fix,
    // Graph answers for any token at all, which is the defect.
    if (parsed.hostname === "graph.microsoft.com") {
      return {
        data: { id: "attacker-oid", mail: VICTIM_EMAIL, displayName: "Owner" },
      };
    }
    if (
      parsed.hostname === "oauth2.googleapis.com" &&
      parsed.pathname.endsWith("/tokeninfo")
    ) {
      return { data: googleTokenInfo };
    }
    if (parsed.pathname.endsWith("/discovery/v2.0/keys")) {
      return { data: { keys: KEY_SET } };
    }
    throw new Error(`unexpected axios.get in this fixture: ${url}`);
  });
});

describe("resolveMicrosoftOidcConfig — unset configuration refuses", () => {
  it("refuses when MICROSOFT_CLIENT_ID is unset", () => {
    expect(() =>
      resolveMicrosoftOidcConfig(
        (k) => ({ MICROSOFT_TENANT_ID: TENANT })[k as string],
      ),
    ).toThrow(MICROSOFT_NOT_CONFIGURED);
  });

  it("refuses a placeholder tenant, because `common` constrains no issuer", () => {
    // With `common`, Microsoft signs `iss: .../{whatever tenant}/v2.0`, so an
    // issuer check would admit every tenant on earth. Multi-tenant sign-in is a
    // decision about WHICH tenants, not a default.
    for (const placeholder of ["common", "organizations", "CONSUMERS"]) {
      expect(() =>
        resolveMicrosoftOidcConfig(
          (k) =>
            ({
              MICROSOFT_CLIENT_ID: CLIENT_ID,
              MICROSOFT_TENANT_ID: placeholder,
            })[k as string],
        ),
      ).toThrow(MICROSOFT_NOT_CONFIGURED);
    }
  });

  it("derives issuer and JWKS uri from a concrete tenant", () => {
    const cfg = resolveMicrosoftOidcConfig(
      (k) =>
        ({ MICROSOFT_CLIENT_ID: CLIENT_ID, MICROSOFT_TENANT_ID: TENANT })[
          k as string
        ],
    );
    expect(cfg).toEqual({
      clientId: CLIENT_ID,
      issuer: ISSUER,
      jwksUri: JWKS_URI,
    });
  });
});

describe("MicrosoftIdTokenVerifier — the token must have been minted for us", () => {
  const cfg = { clientId: CLIENT_ID, issuer: ISSUER, jwksUri: JWKS_URI };

  function verifier(
    fetchJwks: () => Promise<MicrosoftJwk[]> = async () => KEY_SET,
    options: { ttlMs?: number; minRefetchMs?: number; now?: () => number } = {},
  ) {
    return new MicrosoftIdTokenVerifier(fetchJwks, options);
  }

  it("accepts a correctly signed token for this application", async () => {
    await expect(
      verifier().verify(signToken(msPayload()), cfg),
    ).resolves.toEqual({
      oid: "ms-oid-1",
      email: VICTIM_EMAIL,
      name: "Owner",
      tid: TENANT,
    });
  });

  it("refuses a token minted for another application (wrong aud)", async () => {
    const token = signToken(msPayload({ aud: "someone-elses-azure-app" }));
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses an unsigned token (alg none)", async () => {
    const token = signToken(msPayload(), { alg: "none" });
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a token signed with a key that is not Microsoft's", async () => {
    const token = signToken(msPayload(), { privateKey: attacker.privateKey });
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a token whose signature is garbage", async () => {
    const token = signToken(msPayload(), { corruptSignature: true });
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a payload tampered with after signing", async () => {
    const token = signToken(msPayload());
    const [h, , s] = token.split(".");
    const forged = `${h}.${b64url(msPayload({ email: "attacker@evil.test" }))}.${s}`;
    await expect(verifier().verify(forged, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a token from another issuer", async () => {
    const token = signToken(
      msPayload({ iss: "https://login.microsoftonline.com/other/v2.0" }),
    );
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = signToken(msPayload({ exp: past, nbf: past - 60 }));
    await expect(verifier().verify(token, cfg)).rejects.toThrow(
      "Microsoft token has expired",
    );
  });

  it("refuses an address the tenant has not verified (no xms_edov)", async () => {
    const payload = msPayload();
    delete payload.xms_edov;
    await expect(verifier().verify(signToken(payload), cfg)).rejects.toThrow(
      "Your Microsoft email address is not verified",
    );
  });

  it("refuses a token with no oid, since nothing could bind it to a link row", async () => {
    const payload = msPayload();
    delete payload.oid;
    await expect(
      verifier().verify(signToken(payload), cfg),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("re-fetches the key set on an unknown kid, and accepts the rotated key", async () => {
    let calls = 0;
    const v = verifier(
      async () => {
        calls += 1;
        return calls === 1 ? KEY_SET : ROTATED_KEY_SET;
      },
      { minRefetchMs: 0 },
    );

    // Fill the cache with the pre-rotation set.
    await v.verify(signToken(msPayload()), cfg);
    expect(calls).toBe(1);

    const rotated = signToken(msPayload(), {
      kid: "kid-2",
      privateKey: attacker.privateKey,
    });
    await expect(v.verify(rotated, cfg)).resolves.toMatchObject({
      oid: "ms-oid-1",
    });
    expect(calls).toBe(2);
  });

  it("refuses, rather than re-fetching forever, when the kid stays unknown", async () => {
    let calls = 0;
    const v = verifier(
      async () => {
        calls += 1;
        return KEY_SET;
      },
      { minRefetchMs: 0 },
    );
    const token = signToken(msPayload(), { kid: "kid-unknown" });
    await expect(v.verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // One fill plus exactly one rotation re-fetch. Not a loop.
    expect(calls).toBe(2);
  });

  it("a JWKS fetch failure REFUSES; it never admits and never denies silently", async () => {
    const v = verifier(async () => {
      throw new Error("getaddrinfo ENOTFOUND login.microsoftonline.com");
    });
    await expect(v.verify(signToken(msPayload()), cfg)).rejects.toThrow(
      "Could not verify your Microsoft sign-in just now. Please try again.",
    );
  });

  it("an empty key set is a failure, not an empty answer", async () => {
    const v = verifier(async () => []);
    await expect(v.verify(signToken(msPayload()), cfg)).rejects.toThrow(
      "Could not verify your Microsoft sign-in just now. Please try again.",
    );
  });

  it("caches within the TTL and re-fetches after it", async () => {
    let calls = 0;
    // Starts at the real clock: the payload's `nbf`/`exp` are real timestamps,
    // and the injected clock has to live in the same second, not in 1970.
    let clock = Date.now();
    const v = verifier(
      async () => {
        calls += 1;
        return KEY_SET;
      },
      { ttlMs: 60_000, now: () => clock },
    );
    const token = () => signToken(msPayload());

    await v.verify(token(), cfg);
    await v.verify(token(), cfg);
    expect(calls).toBe(1);

    clock += 60_001;
    await v.verify(token(), cfg);
    expect(calls).toBe(2);
  });

  it("the default fetcher reads the key set over axios", async () => {
    // The one test that exercises the production fetch path rather than a stub.
    const v = new MicrosoftIdTokenVerifier();
    await expect(v.verify(signToken(msPayload()), cfg)).resolves.toMatchObject({
      email: VICTIM_EMAIL,
    });
    expect(axios.get as jest.Mock).toHaveBeenCalledWith(
      JWKS_URI,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });
});

describe("loginWithMicrosoft — the account must actually use Microsoft", () => {
  const linkedUser = {
    user_id: "u-owner",
    email: VICTIM_EMAIL,
    name: "Owner",
    role: "owner",
    password_hash: "$2b$10$hash",
    oauth_provider: null,
  };

  it("refuses a valid token whose account has no Microsoft link", async () => {
    // The core defect. This account exists, has a password, and has never used
    // Microsoft. Pre-fix it signed the token holder in as this user.
    const { svc } = makeService({ userByEmail: linkedUser, oauthRows: [] });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(REFUSED_MS);
  });

  it("signs in an account that is genuinely linked", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-1" }],
    });
    await expect(
      svc.loginWithMicrosoft(signToken(msPayload())),
    ).resolves.toMatchObject({ accessToken: "signed-token" });
  });

  it("refuses when the link row names a different Microsoft account", async () => {
    // Same address, different `oid`. The address is not the identity.
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-OTHER" }],
    });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(REFUSED_MS);
  });

  it("refuses when only a Google link exists", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "google", provider_user_id: "google-sub-1" }],
    });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(REFUSED_MS);
  });

  it("honours the legacy users.oauth_provider hint when there are no rows at all", async () => {
    // The deliberate fallback `resolveLinkedProviderIds` already carries: the
    // column is NULL for 9 of 10 production users, so it is a hint consulted
    // only in the absence of rows, never the answer.
    const { svc } = makeService({
      userByEmail: { ...linkedUser, oauth_provider: "microsoft" },
      oauthRows: [],
    });
    await expect(
      svc.loginWithMicrosoft(signToken(msPayload())),
    ).resolves.toMatchObject({ accessToken: "signed-token" });
  });

  it("refuses a token minted for another Azure application", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-1" }],
    });
    const token = signToken(msPayload({ aud: "someone-elses-azure-app" }));
    await expect(svc.loginWithMicrosoft(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses an unsigned token", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-1" }],
    });
    const token = signToken(msPayload(), { alg: "none" });
    await expect(svc.loginWithMicrosoft(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a token signed by anyone but Microsoft", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-1" }],
    });
    const token = signToken(msPayload(), { privateKey: attacker.privateKey });
    await expect(svc.loginWithMicrosoft(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses outright when MICROSOFT_CLIENT_ID is unset", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-1" }],
      config: { MICROSOFT_CLIENT_ID: undefined },
    });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(MICROSOFT_NOT_CONFIGURED);
  });

  it("refuses outright when the issuer configuration is unset", async () => {
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthRows: [{ provider: "microsoft", provider_user_id: "ms-oid-1" }],
      config: { MICROSOFT_TENANT_ID: undefined },
    });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(MICROSOFT_NOT_CONFIGURED);
  });

  it("says the same sentence for an unknown address as for an unlinked one", async () => {
    // A public route that answers differently is an address oracle.
    const unknown = makeService({ userByEmail: null });
    const unlinked = makeService({ userByEmail: linkedUser, oauthRows: [] });

    const a = await refusalFrom(
      unknown.svc.loginWithMicrosoft(signToken(msPayload())),
    );
    const b = await refusalFrom(
      unlinked.svc.loginWithMicrosoft(signToken(msPayload())),
    );

    expect(a).toBe(b);
    expect(a).toBe(REFUSED_MS);
    expect(a).not.toMatch(/no .*account/i);
  });

  it("a failed read of the link table REFUSES, and says so — it never reads as `not linked`", async () => {
    // supabase-js resolves `{ data, error }`; it does not throw. Without an
    // explicit branch an unreachable table arrives as `rows: null`, reads as
    // "no links", and is reported as "not linked" — absence as health.
    const { svc } = makeService({
      userByEmail: linkedUser,
      oauthError: { message: "could not connect to the database" },
    });
    const message = await refusalFrom(
      svc.loginWithMicrosoft(signToken(msPayload())),
    );
    expect(message).toBe(LINK_UNAVAILABLE);
    expect(message).not.toBe(REFUSED_MS);
  });
});

describe("loginWithGoogle — the same link requirement", () => {
  const user = {
    user_id: "u-owner",
    email: VICTIM_EMAIL,
    name: "Owner",
    role: "owner",
    password_hash: "$2b$10$hash",
    oauth_provider: null,
  };

  it("refuses a verified Google token whose account has no Google link", async () => {
    const { svc } = makeService({ userByEmail: user, oauthRows: [] });
    expect(await refusalFrom(svc.loginWithGoogle("google-id-token"))).toBe(
      REFUSED_GOOGLE,
    );
  });

  it("signs in an account that is genuinely linked", async () => {
    const { svc } = makeService({
      userByEmail: user,
      oauthRows: [{ provider: "google", provider_user_id: "google-sub-1" }],
    });
    await expect(svc.loginWithGoogle("google-id-token")).resolves.toMatchObject(
      {
        accessToken: "signed-token",
      },
    );
  });

  it("refuses when the link row names a different Google account", async () => {
    const { svc } = makeService({
      userByEmail: user,
      oauthRows: [{ provider: "google", provider_user_id: "google-sub-OTHER" }],
    });
    expect(await refusalFrom(svc.loginWithGoogle("google-id-token"))).toBe(
      REFUSED_GOOGLE,
    );
  });

  it("keeps its audience check", async () => {
    googleTokenInfo.aud = "someone-elses-google-app";
    const { svc } = makeService({
      userByEmail: user,
      oauthRows: [{ provider: "google", provider_user_id: "google-sub-1" }],
    });
    await expect(svc.loginWithGoogle("google-id-token")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("keeps its email_verified check", async () => {
    googleTokenInfo.email_verified = "false";
    const { svc } = makeService({
      userByEmail: user,
      oauthRows: [{ provider: "google", provider_user_id: "google-sub-1" }],
    });
    await expect(svc.loginWithGoogle("google-id-token")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses when GOOGLE_CLIENT_ID is unset instead of skipping the audience check", async () => {
    // This used to read `if (expectedClientId && data.aud !== expectedClientId)`
    // — an unset variable removed the check entirely.
    const { svc } = makeService({
      userByEmail: user,
      oauthRows: [{ provider: "google", provider_user_id: "google-sub-1" }],
      config: { GOOGLE_CLIENT_ID: undefined },
    });
    await expect(svc.loginWithGoogle("google-id-token")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("a failed read of the link table REFUSES rather than answering", async () => {
    const { svc } = makeService({
      userByEmail: user,
      oauthError: { message: "could not connect to the database" },
    });
    expect(await refusalFrom(svc.loginWithGoogle("google-id-token"))).toBe(
      LINK_UNAVAILABLE,
    );
  });

  it("says the same sentence for an unknown address as for an unlinked one", async () => {
    const unknown = makeService({ userByEmail: null });
    const unlinked = makeService({ userByEmail: user, oauthRows: [] });
    const a = await refusalFrom(unknown.svc.loginWithGoogle("google-id-token"));
    const b = await refusalFrom(
      unlinked.svc.loginWithGoogle("google-id-token"),
    );
    expect(a).toBe(b);
  });
});
