import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { IntegrationsOauthService } from "./integrations-oauth.service";
import type { DatabaseService } from "../database/database.service";
import type { TokenCryptoService } from "../common/crypto/token-crypto.service";
import type { ConfigService } from "@nestjs/config";

/**
 * What a test here can and cannot do.
 *
 * The defect that motivated this file was NOT a logic bug: the service was
 * correct and `integration_oauth_connections` / `integration_oauth_states`
 * simply did not exist in production, so every write 404'd after the user had
 * already approved real scopes at Google. A unit test with a faked Supabase
 * client passes identically whether or not the table exists — which is exactly
 * why this shipped broken and stayed broken.
 *
 * So the first block below does not mock the database at all. It asserts the
 * repo-level invariant the outage actually violated: every table this service
 * queries must be created by a migration under `supabase/migrations/`, the
 * directory that is applied, rather than `supabase/migrations_archive/`, which
 * is not. That is the only shape of test that could have caught it.
 *
 * The remaining blocks cover the logic seams that were genuinely untested —
 * the module had no spec file of any kind before this.
 */

/** Walk up from here until the repo root (the dir holding `supabase/`) is found. */
function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "supabase", "migrations"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the repo root from " + __dirname);
}

describe("integration OAuth tables are backed by an applied migration", () => {
  const root = repoRoot();
  const serviceSource = readFileSync(
    resolve(__dirname, "integrations-oauth.service.ts"),
    "utf8",
  );

  /** Every distinct `.from("<table>")` the service talks to. */
  const queriedTables = Array.from(
    new Set(
      Array.from(
        serviceSource.matchAll(/\.from\(\s*["'`]([a-z0-9_]+)["'`]\s*\)/g),
        (m) => m[1],
      ),
    ),
  ).sort();

  /**
   * `--` comments are stripped before any of these assertions run, and that is
   * load-bearing rather than tidiness. These migrations carry long prose
   * headers that quote the very DDL they perform — the header of
   * 20260826170000 contains the literal string "UNIQUE (user_id,
   * integration_id)" while explaining why it must not gain a predicate. Match
   * against the raw file and the explanation satisfies the check, so the test
   * passes while the DDL says something else entirely. Caught by running the
   * revert: making the constraint partial left every assertion green.
   */
  const appliedSql = readdirSync(join(root, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(root, "supabase", "migrations", f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  it("queries the two tables this module owns, and nothing unexpected", () => {
    // Guards the extraction itself: if the regex silently stops matching, the
    // checks below would pass vacuously over an empty list.
    expect(queriedTables).toEqual([
      "integration_oauth_connections",
      "integration_oauth_states",
    ]);
  });

  it.each([
    ["integration_oauth_connections"],
    ["integration_oauth_states"],
  ])(
    "%s is CREATEd by a migration in supabase/migrations, not only in the archive",
    (table) => {
      const created = new RegExp(
        `create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${table}\\b`,
        "i",
      );
      expect(appliedSql).toMatch(created);
    },
  );

  it.each([
    ["integration_oauth_connections"],
    ["integration_oauth_states"],
  ])(
    "%s has RLS enabled and anon/authenticated revoked in the applied migrations",
    (table) => {
      expect(appliedSql).toMatch(
        new RegExp(
          `alter\\s+table\\s+(public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`,
          "i",
        ),
      );
      // A table holding OAuth refresh tokens must never be reachable by the
      // publishable anon key. See OD-72 / OD-73.
      expect(appliedSql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+(public\\.)?${table}\\s+from\\s+anon,\\s*authenticated`,
          "i",
        ),
      );
    },
  );

  /**
   * The body of `CREATE TABLE <name> ( ... );`, comments already stripped.
   *
   * Scoping to the statement is what makes the constraint check real. Matching
   * across the whole concatenated file is vacuous twice over: the migration's
   * prose header quotes the constraint, and so does the RAISE EXCEPTION string
   * inside its own assertion block. Both were found by reverting the DDL and
   * watching the test stay green.
   */
  function createTableBody(table: string): string {
    const start = appliedSql.search(
      new RegExp(
        `create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${table}\\s*\\(`,
        "i",
      ),
    );
    expect(start).toBeGreaterThanOrEqual(0);
    const end = appliedSql.indexOf("\n);", start);
    expect(end).toBeGreaterThan(start);
    return appliedSql.slice(start, end);
  }

  it("keeps UNIQUE (user_id, integration_id) non-partial so the upsert can bind", () => {
    // storeConnection uses `onConflict: "user_id,integration_id"`, which emits
    // ON CONFLICT (user_id, integration_id). Postgres matches that only to a
    // unique index on exactly those columns with no WHERE predicate. Adding
    // `WHERE revoked_at IS NULL` would break reconnect-after-disconnect and
    // silently accumulate duplicate rows per user.
    expect(serviceSource).toContain('onConflict: "user_id,integration_id"');

    const body = createTableBody("integration_oauth_connections");
    expect(body).toMatch(/unique\s*\(\s*user_id\s*,\s*integration_id\s*\)/i);
    expect(body).not.toMatch(
      /unique\s*\(\s*user_id\s*,\s*integration_id\s*\)\s*where/i,
    );
  });

  it("keeps the columns disconnect() NULLs out nullable", () => {
    // disconnect() writes NULL into all three; a NOT NULL here would make
    // revocation fail at runtime with a constraint violation.
    const body = createTableBody("integration_oauth_connections");
    for (const column of [
      "access_token_encrypted",
      "refresh_token_encrypted",
      "token_expires_at",
    ]) {
      expect(body).toMatch(new RegExp(`\\b${column}\\b`, "i"));
      expect(body).not.toMatch(
        new RegExp(`\\b${column}\\b[^,]*not\\s+null`, "i"),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Logic seams. These need a fake client; see the caveat at the top of the file.
// ---------------------------------------------------------------------------

type Captured = { table: string; payload: Record<string, unknown> };

function makeService(opts: {
  captured?: Captured[];
  stateRow?: Record<string, unknown> | null;
  configured?: boolean;
}) {
  const captured = opts.captured ?? [];
  const configured = opts.configured ?? true;

  const chain = {
    update: () => chain,
    eq: () => chain,
    is: () => chain,
    gt: () => chain,
    select: () => chain,
    maybeSingle: async () => ({ data: opts.stateRow ?? null, error: null }),
  };

  const db = {
    client: {
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
          captured.push({ table, payload });
          return { error: null };
        },
        ...chain,
      }),
    },
  } as unknown as DatabaseService;

  const settings: Record<string, string> = {
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    MICROSOFT_CLIENT_ID: "ms-client-id",
    MICROSOFT_CLIENT_SECRET: "ms-client-secret",
    FRONTEND_URL: "https://app.example.test,https://other.example.test",
    API_PUBLIC_URL: "https://api.example.test",
  };

  const config = {
    get: (key: string) => settings[key],
  } as unknown as ConfigService;

  const crypto = {
    isConfigured: configured,
    encrypt: (v: string) => `enc:${v}`,
    tryDecrypt: (v: string | null | undefined) =>
      typeof v === "string" ? v.replace(/^enc:/, "") : null,
  } as unknown as TokenCryptoService;

  return new IntegrationsOauthService(db, config, crypto);
}

describe("createAuthorizationUrl", () => {
  it("refuses a protocol-relative returnPath instead of storing it", async () => {
    // `//evil.test` is a valid URL to a foreign origin. Storing it would make
    // the post-callback redirect an open redirect off the back of a real
    // Google consent screen.
    const captured: Captured[] = [];
    const service = makeService({ captured });

    await service.createAuthorizationUrl({
      userId: "u1",
      integrationId: "google_drive",
      returnPath: "//evil.test/steal",
    });

    expect(captured[0].table).toBe("integration_oauth_states");
    expect(captured[0].payload.return_path).toBe("/settings");
  });

  it.each([
    ["https://evil.test", "/settings"],
    ["", "/settings"],
    ["/settings/integrations", "/settings/integrations"],
  ])("normalises returnPath %p to %p", async (input, expected) => {
    const captured: Captured[] = [];
    const service = makeService({ captured });

    await service.createAuthorizationUrl({
      userId: "u1",
      integrationId: "google_drive",
      returnPath: input as string,
    });

    expect(captured[0].payload.return_path).toBe(expected);
  });

  it("persists a state row whose columns match the migration", async () => {
    const captured: Captured[] = [];
    const service = makeService({ captured });

    const { authorizationUrl } = await service.createAuthorizationUrl({
      userId: "u1",
      restaurantId: "r1",
      integrationId: "google_drive",
    });

    // Column names here are the contract the migration has to satisfy; a
    // rename on either side should fail loudly rather than 400 at runtime.
    expect(Object.keys(captured[0].payload).sort()).toEqual([
      "expires_at",
      "integration_id",
      "provider",
      "restaurant_id",
      "return_path",
      "state",
      "user_id",
    ]);
    expect(captured[0].payload.provider).toBe("google");
    expect(captured[0].payload.integration_id).toBe("google_drive");

    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    // Google only returns a refresh token with both of these set.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe(captured[0].payload.state);
  });

  it("refuses to start the flow when token encryption is unconfigured", async () => {
    const service = makeService({ configured: false });
    await expect(
      service.createAuthorizationUrl({
        userId: "u1",
        integrationId: "google_drive",
      }),
    ).rejects.toThrow(/encryption/i);
  });
});

describe("handleCallback", () => {
  // The user is mid-redirect in a browser here, so every failure has to come
  // back as a status on the return URL. A thrown JSON error is one they would
  // never see.
  it("redirects rather than throwing when state is missing", async () => {
    const service = makeService({});
    const destination = await service.handleCallback({ provider: "google" });
    const url = new URL(destination);

    expect(url.origin).toBe("https://app.example.test");
    expect(url.searchParams.get("integration_status")).toBe("error");
    expect(url.searchParams.get("integration_reason")).toBe("missing_state");
  });

  it("rejects a replayed or expired state", async () => {
    // consumeState finds nothing: already consumed, or past expires_at.
    const service = makeService({ stateRow: null });
    const url = new URL(
      await service.handleCallback({
        provider: "google",
        code: "abc",
        state: "already-used",
      }),
    );
    expect(url.searchParams.get("integration_reason")).toBe("invalid_state");
  });

  it("reports a denied consent as a normal outcome on the stored return path", async () => {
    const service = makeService({
      stateRow: {
        state: "s1",
        user_id: "u1",
        restaurant_id: null,
        provider: "google",
        integration_id: "google_drive",
        return_path: "/settings/integrations",
      },
    });

    const url = new URL(
      await service.handleCallback({
        provider: "google",
        state: "s1",
        error: "access_denied",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://app.example.test/settings/integrations",
    );
    expect(url.searchParams.get("integration_status")).toBe("error");
    expect(url.searchParams.get("integration_reason")).toBe("denied");
    expect(url.searchParams.get("integration")).toBe("google_drive");
  });

  it("rejects a callback whose provider does not match the state row", async () => {
    const service = makeService({
      stateRow: {
        state: "s1",
        user_id: "u1",
        restaurant_id: null,
        provider: "google",
        integration_id: "google_drive",
        return_path: "/settings",
      },
    });

    const url = new URL(
      await service.handleCallback({
        provider: "microsoft",
        code: "abc",
        state: "s1",
      }),
    );
    expect(url.searchParams.get("integration_reason")).toBe("invalid_callback");
  });
});
