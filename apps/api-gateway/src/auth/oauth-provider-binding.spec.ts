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
 * 3. `unlinkOAuthProvider` left `users.oauth_provider` naming a provider with
 *    ZERO rows, because it asked `getLinkedProviders` what to write and that
 *    path falls back to reading the very column being replaced. An unbound
 *    legacy claim then admitted any identity with the same verified address.
 *
 * WHAT WAS MEASURED AGAINST THE PRE-FIX MODULE, EXACTLY
 * -----------------------------------------------------
 * The original 39 tests in this file were run against the pre-fix
 * `auth.service.ts` (`git show 6e6f2f94:…` copied to a same-depth probe, run,
 * deleted). The result was **15 failed, 24 passed**. Not every test here is
 * failing-first evidence, and the header must not imply it is:
 *
 *   - **15 failing-first.** Every one lives in the two `AuthService` describes
 *     and asserts a refusal the pre-fix code did not make. Those are the
 *     evidence.
 *   - **5 regression tests in those same describes, which PASS pre-fix by
 *     construction and must keep passing:** "signs in an account that is
 *     genuinely linked" (Microsoft), "honours the legacy users.oauth_provider
 *     hint when there are no rows at all", "signs in an account that is
 *     genuinely linked" (Google), "keeps its audience check", "keeps its
 *     email_verified check". They exist to catch a fix that over-refuses.
 *   - **19 unit tests of `microsoft-id-token.ts`**, which is a NEW module with
 *     no pre-fix counterpart, so "fails pre-fix" is not a property they can
 *     have. They pass against the probe because they never touch the service.
 *
 * Tests added after that probe run (the unlink regression, the legacy-subject
 * cases, `ver`/`scp`, the endpoint-override validation, the `email`-claim
 * requirement) are marked in place with what they were measured against.
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
    ver: "2.0",
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

  // Added after the pre-fix probe run; these validate configuration that the
  // first version of this module read without checking, so there is no pre-fix
  // counterpart to fail against. Measured here only.
  describe("the endpoint overrides are checked, not merely read", () => {
    function cfgWith(over: Record<string, string>) {
      return () =>
        resolveMicrosoftOidcConfig(
          (k) =>
            ({
              MICROSOFT_CLIENT_ID: CLIENT_ID,
              MICROSOFT_TENANT_ID: TENANT,
              ...over,
            })[k as string],
        );
    }

    it("refuses an http JWKS uri, which would make key retrieval MITM-able", () => {
      expect(
        cfgWith({
          MICROSOFT_JWKS_URI: `http://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
        }),
      ).toThrow(MICROSOFT_NOT_CONFIGURED);
    });

    it("refuses a JWKS host that is not a Microsoft identity host", () => {
      expect(
        cfgWith({
          MICROSOFT_JWKS_URI: `https://keys.evil.test/${TENANT}/discovery/v2.0/keys`,
        }),
      ).toThrow(MICROSOFT_NOT_CONFIGURED);
    });

    it("refuses an issuer host that is not a Microsoft identity host", () => {
      expect(
        cfgWith({
          MICROSOFT_ISSUER: `https://login.microsoftonline.com.evil.test/${TENANT}/v2.0`,
        }),
      ).toThrow(MICROSOFT_NOT_CONFIGURED);
    });

    it("refuses an issuer from one tenant paired with a JWKS from another", () => {
      // The right issuer string checked against the wrong signing keys.
      expect(
        cfgWith({
          MICROSOFT_ISSUER: `https://login.microsoftonline.com/${TENANT}/v2.0`,
          MICROSOFT_JWKS_URI:
            "https://login.microsoftonline.com/some-other-tenant/discovery/v2.0/keys",
        }),
      ).toThrow(MICROSOFT_NOT_CONFIGURED);
    });

    it("accepts overrides that agree on host and tenant", () => {
      const cfg = cfgWith({
        MICROSOFT_ISSUER: `https://login.microsoftonline.us/${TENANT}/v2.0`,
        MICROSOFT_JWKS_URI: `https://login.microsoftonline.us/${TENANT}/discovery/v2.0/keys`,
      })();
      expect(cfg.issuer).toBe(
        `https://login.microsoftonline.us/${TENANT}/v2.0`,
      );
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

  // Added after the pre-fix probe run. These pin checks the first version of
  // this module did not make; `microsoft-id-token.ts` is new, so none of them
  // has a pre-fix counterpart and none is failing-first evidence.
  it("refuses an access token minted for this same application (scp present)", async () => {
    // An app registration that exposes an API scope issues access tokens with
    // `aud` equal to its own client id. `scp` is what separates them.
    const token = signToken(msPayload({ scp: "Files.Read" }));
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("refuses a token that is not ver 2.0", async () => {
    const token = signToken(msPayload({ ver: "1.0" }));
    await expect(verifier().verify(token, cfg)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const missing = msPayload();
    delete missing.ver;
    await expect(
      verifier().verify(signToken(missing), cfg),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("still accepts an ID token carrying app-role assignments (roles)", async () => {
    // `roles` appears in a legitimate ID token for a tenant using app roles,
    // so it must NOT be treated the way `scp` is.
    const token = signToken(msPayload({ roles: ["Restaurant.Owner"] }));
    await expect(verifier().verify(token, cfg)).resolves.toMatchObject({
      email: VICTIM_EMAIL,
    });
  });

  it("refuses when `email` is absent, even with preferred_username and xms_edov", async () => {
    // `xms_edov` attests the domain of the `email` claim specifically. Using it
    // to bless `preferred_username` borrows a proof for something it does not
    // prove.
    const payload = msPayload({ preferred_username: VICTIM_EMAIL });
    delete payload.email;
    await expect(
      verifier().verify(signToken(payload), cfg),
    ).rejects.toBeInstanceOf(UnauthorizedException);
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
    // column was NULL for 9 of 10 production users on 2026-08-26, so it is a
    // hint consulted only in the absence of rows, never the answer. The pair
    // must be BOUND — `oauth_id` names the account the column's provider
    // refers to.
    const { svc } = makeService({
      userByEmail: {
        ...linkedUser,
        oauth_provider: "microsoft",
        oauth_id: "ms-oid-1",
      },
      oauthRows: [],
    });
    await expect(
      svc.loginWithMicrosoft(signToken(msPayload())),
    ).resolves.toMatchObject({ accessToken: "signed-token" });
  });

  // Added after the pre-fix probe run, closing the unbound-legacy state the
  // correctness angle proved reachable. Both fail against the FIRST version of
  // this fix (which returned `user.oauth_provider === provider` outright), not
  // against 6e6f2f94.
  it("refuses a legacy hint with no oauth_id — a provider named, no account bound", async () => {
    const { svc } = makeService({
      userByEmail: {
        ...linkedUser,
        oauth_provider: "microsoft",
        oauth_id: null,
      },
      oauthRows: [],
    });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(REFUSED_MS);
  });

  it("refuses a legacy hint whose oauth_id names a different Microsoft account", async () => {
    const { svc } = makeService({
      userByEmail: {
        ...linkedUser,
        oauth_provider: "microsoft",
        oauth_id: "ms-oid-SOMEONE-ELSE",
      },
      oauthRows: [],
    });
    expect(
      await refusalFrom(svc.loginWithMicrosoft(signToken(msPayload()))),
    ).toBe(REFUSED_MS);
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

/**
 * The unbound-legacy state, and the unlink that produced it.
 *
 * Proven with a probe by the merge gate's correctness angle: `unlinkOAuthProvider`
 * deleted the link row, then computed the replacement legacy value through
 * `getLinkedProviders` -> `resolveLinkedProviderIds`, whose fallback reads the
 * very column being replaced. With the last row gone it read `oauth_provider =
 * 'google'` and wrote it straight back, leaving rows [] and the column still
 * naming Google. A later Google sign-in for a DIFFERENT `sub` with the same
 * verified address then resolved that account.
 *
 * Both halves are fixed and both are tested here: the write now derives from
 * the rows, and the legacy branch of the link check compares `users.oauth_id`.
 *
 * These tests post-date the 6e6f2f94 probe run. They fail against the FIRST
 * version of this fix, not against main - stated rather than implied.
 */
describe("unlinkOAuthProvider — leaves no unbound legacy claim", () => {
  interface Store {
    rows: { provider: string; provider_user_id: string | null }[];
    user: Record<string, unknown>;
  }

  /**
   * A supabase-js-shaped fake with STATE, so the unlink and the sign-in after
   * it see the same rows. Every chain object is thenable, so `await
   * from(...).delete().eq().eq()` and `await from(...).select().eq()` both
   * resolve at whatever depth the caller stops.
   */
  function makeStatefulService(seed: Store) {
    const state: Store = {
      rows: seed.rows.map((r) => ({ ...r })),
      user: { ...seed.user },
    };

    const from = jest.fn((table: string) => {
      const chain: any = {
        _filters: {} as Record<string, unknown>,
        _op: "select",
        _patch: null as Record<string, unknown> | null,
      };
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        chain._filters[col] = val;
        return chain;
      };
      chain.is = () => chain;
      chain.delete = () => {
        chain._op = "delete";
        return chain;
      };
      chain.update = (patch: Record<string, unknown>) => {
        chain._op = "update";
        chain._patch = patch;
        return chain;
      };

      const settle = () => {
        if (table === "user_oauth_accounts") {
          if (chain._op === "delete") {
            state.rows = state.rows.filter(
              (r) => r.provider !== chain._filters.provider,
            );
            return { data: null, error: null };
          }
          return { data: state.rows.map((r) => ({ ...r })), error: null };
        }
        if (table === "users") {
          if (chain._op === "update") {
            Object.assign(state.user, chain._patch ?? {});
            return { data: null, error: null };
          }
          return { data: { ...state.user }, error: null };
        }
        if (table === "user_roles") return { data: [], error: null };
        if (table === "user_restaurant_access")
          return { data: null, error: null };
        throw new Error(`unexpected table in this fixture: ${table}`);
      };

      chain.maybeSingle = () => Promise.resolve(settle());
      chain.single = () => Promise.resolve(settle());
      chain.then = (onOk: any, onErr: any) =>
        Promise.resolve(settle()).then(onOk, onErr);
      return chain;
    });

    const svc = new AuthService(
      {
        sign: jest.fn().mockReturnValue("signed-token"),
        verify: jest.fn(),
        decode: jest.fn(),
      } as any,
      {
        get: jest.fn(
          (key: string) =>
            ({
              MICROSOFT_CLIENT_ID: CLIENT_ID,
              MICROSOFT_TENANT_ID: TENANT,
              GOOGLE_CLIENT_ID,
            })[key],
        ),
      } as any,
      { supabase: { from } } as any,
      { blacklistToken: jest.fn() } as any,
      { sendEmail: jest.fn() } as any,
    );

    return { svc, state };
  }

  const seededUser = {
    user_id: "u-owner",
    email: VICTIM_EMAIL,
    name: "Owner",
    role: "owner",
    password_hash: "$2b$10$hash",
    oauth_provider: "google",
    oauth_id: "google-sub-1",
  };

  it("clears the legacy pair when the last link is removed", async () => {
    const { svc, state } = makeStatefulService({
      rows: [{ provider: "google", provider_user_id: "google-sub-1" }],
      user: { ...seededUser },
    });

    await svc.unlinkOAuthProvider("u-owner", "google");

    expect(state.rows).toEqual([]);
    // Pre-fix this read "google" with zero rows.
    expect(state.user.oauth_provider).toBeNull();
    expect(state.user.oauth_id).toBeNull();
  });

  it("a Google sign-in for a DIFFERENT sub is refused after the unlink", async () => {
    const { svc } = makeStatefulService({
      rows: [{ provider: "google", provider_user_id: "google-sub-1" }],
      user: { ...seededUser },
    });

    await svc.unlinkOAuthProvider("u-owner", "google");

    // Same verified address, a different Google account.
    googleTokenInfo.sub = "google-sub-SOMEONE-ELSE";
    expect(await refusalFrom(svc.loginWithGoogle("google-id-token"))).toBe(
      REFUSED_GOOGLE,
    );
  });

  it("the original account is refused too — unlinked means unlinked", async () => {
    const { svc } = makeStatefulService({
      rows: [{ provider: "google", provider_user_id: "google-sub-1" }],
      user: { ...seededUser },
    });

    await svc.unlinkOAuthProvider("u-owner", "google");

    expect(await refusalFrom(svc.loginWithGoogle("google-id-token"))).toBe(
      REFUSED_GOOGLE,
    );
  });

  it("rewrites the legacy pair from a surviving row instead of nulling its id", async () => {
    const { svc, state } = makeStatefulService({
      rows: [
        { provider: "google", provider_user_id: "google-sub-1" },
        { provider: "microsoft", provider_user_id: "ms-oid-1" },
      ],
      user: { ...seededUser },
    });

    await svc.unlinkOAuthProvider("u-owner", "google");

    expect(state.rows).toEqual([
      { provider: "microsoft", provider_user_id: "ms-oid-1" },
    ]);
    // The old code wrote `oauth_id: null` even when it kept a provider name,
    // manufacturing the same unbound pair from the other direction.
    expect(state.user.oauth_provider).toBe("microsoft");
    expect(state.user.oauth_id).toBe("ms-oid-1");
  });
});
