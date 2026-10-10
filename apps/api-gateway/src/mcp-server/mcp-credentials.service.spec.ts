import { UnauthorizedException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { McpCredentialAuthGuard } from "./mcp-credential-auth.guard";
import {
  McpCredentialsService,
  RATE_LIMIT_PER_MINUTE,
  SECRET_PREFIX,
} from "./mcp-credentials.service";

/**
 * The credential half.
 *
 * Every case here is one a wrong implementation passes silently: a revoked key
 * that still works, a database outage reported to the client as "your key is
 * invalid", a rate limiter that counts the IP instead of the key. The specs are
 * written so that the WRONG behaviour is the one that fails.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";

type Answer = { data: unknown; error: { message: string } | null };

/** The minter's row in the house: an active manager unless a case says otherwise. */
const MINTER = "33333333-3333-4333-8333-333333333333";
const ACTIVE_MANAGER: Answer = { data: { role: "manager", is_active: true }, error: null };

/**
 * A Supabase double whose `maybeSingle` is programmable per table: `answer`
 * for the key register, `access` for the minter's `user_restaurant_access`.
 */
function db(answer: Answer, access: Answer = ACTIVE_MANAGER) {
  const make = (a: Answer) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = jest.fn(self);
    chain.eq = jest.fn(self);
    chain.is = jest.fn(self);
    chain.order = jest.fn(self);
    chain.update = jest.fn(self);
    chain.insert = jest.fn(self);
    chain.maybeSingle = jest.fn().mockResolvedValue(a);
    chain.single = jest.fn().mockResolvedValue(a);
    chain.then = undefined;
    return chain;
  };
  const chain = make(answer);
  const accessChain = make(access);
  const from = jest.fn((table: string) =>
    table === "user_restaurant_access" ? accessChain : chain,
  );
  return {
    service: { supabase: { from } } as unknown as DatabaseService,
    from,
    chain,
  };
}

describe("McpCredentialsService.verify", () => {
  it("refuses a gateway JWT by shape, before it ever reaches the table", async () => {
    const { service: database, from } = db({ data: null, error: null });
    const credentials = new McpCredentialsService(database);

    const outcome = await credentials.verify(
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.body.sig",
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain(
      "not a Mudavym MCP key",
    );
    // The point of the shape check: a JWT never becomes a database round-trip,
    // and never becomes a credential no matter what the table holds.
    expect(from).not.toHaveBeenCalled();
  });

  it("refuses a revoked key and says when it was revoked", async () => {
    const secret = `${SECRET_PREFIX}abc`;
    const { service: database } = db({
      data: {
        id: "cred-1",
        restaurant_id: HOUSE,
        label: "Old assistant",
        scopes: ["inventory:read"],
        token_hash: McpCredentialsService.hash(secret),
        revoked_at: "2026-09-05T12:00:00.000Z",
      },
      error: null,
    });
    const credentials = new McpCredentialsService(database);

    const outcome = await credentials.verify(secret);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toContain(
      "revoked on 2026-09-05T12:00:00.000Z",
    );
  });

  it("accepts a live key and carries the house from the ROW, not from the caller", async () => {
    const secret = `${SECRET_PREFIX}live`;
    const { service: database } = db({
      data: {
        id: "cred-2",
        restaurant_id: HOUSE,
        label: "Assistant",
        scopes: ["inventory:read", "orders:read"],
        token_hash: McpCredentialsService.hash(secret),
        revoked_at: null,
        created_by: MINTER,
      },
      error: null,
    });
    const credentials = new McpCredentialsService(database);

    const outcome = await credentials.verify(secret);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok === true && outcome.credential.restaurantId).toBe(HOUSE);
    expect(outcome.ok === true && outcome.credential.scopes).toEqual([
      "inventory:read",
      "orders:read",
    ]);
  });

  describe("a key stops working when its minter leaves the role (F-388)", () => {
    const secret = `${SECRET_PREFIX}minted-by-a-manager`;
    const liveKey: Answer = {
      data: {
        id: "cred-3",
        restaurant_id: HOUSE,
        label: "Assistant",
        scopes: ["inventory:read"],
        token_hash: McpCredentialsService.hash(secret),
        revoked_at: null,
        created_by: MINTER,
      },
      error: null,
    };
    const refusedFor = async (access: Answer, key: Answer = liveKey) => {
      const outcome = await new McpCredentialsService(db(key, access).service).verify(secret);
      expect(outcome.ok).toBe(false);
      return outcome.ok === false ? outcome.reason : "";
    };

    it("refuses once the minter is removed from the house", async () => {
      expect(await refusedFor({ data: null, error: null })).toContain(
        "no longer runs this house as an owner or manager",
      );
    });

    it("refuses once the minter's access is switched off", async () => {
      expect(await refusedFor({ data: { role: "manager", is_active: false }, error: null })).toContain(
        "stopped working with them",
      );
    });

    it("refuses once the minter is moved down to staff", async () => {
      expect(await refusedFor({ data: { role: "staff", is_active: true }, error: null })).toContain(
        "no longer runs this house",
      );
    });

    it("refuses a key whose minter's account is gone", async () => {
      const orphan: Answer = { data: { ...(liveKey.data as object), created_by: null }, error: null };
      expect(await refusedFor(ACTIVE_MANAGER, orphan)).toContain("no longer runs this house");
    });

    it("an owner's key keeps working", async () => {
      const outcome = await new McpCredentialsService(
        db(liveKey, { data: { role: "owner", is_active: true }, error: null }).service,
      ).verify(secret);
      expect(outcome.ok).toBe(true);
    });

    it("a member list that does not answer is not reported as a dead key", async () => {
      expect(await refusedFor({ data: null, error: { message: "timeout" } })).toContain(
        "not a statement about the key",
      );
    });
  });

  it("does not report a failed lookup as an invalid key", async () => {
    const { service: database } = db({
      data: null,
      error: { message: "connection reset" },
    });
    const credentials = new McpCredentialsService(database);

    const outcome = await credentials.verify(`${SECRET_PREFIX}whatever`);
    expect(outcome.ok).toBe(false);
    // The distinction that matters operationally: "we could not check" sends
    // nobody to rotate a key that was never the problem.
    expect(outcome.ok === false && outcome.reason).toContain("Could not check");
    expect(outcome.ok === false && outcome.reason).toContain(
      "not a statement about the key",
    );
  });

  it("stores no secret — only its SHA-256, and the prefix is not enough to rebuild one", () => {
    const secret = `${SECRET_PREFIX}${"z".repeat(43)}`;
    const digest = McpCredentialsService.hash(secret);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(secret);
    expect(secret.slice(0, 16).length).toBeLessThan(secret.length / 2);
  });
});

describe("McpCredentialsService — the per-credential limiter", () => {
  it("counts the KEY, so one key cannot spend another key's allowance", () => {
    const { service: database } = db({ data: null, error: null });
    const credentials = new McpCredentialsService(database);

    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i += 1) {
      expect(credentials.consume("key-a").allowed).toBe(true);
    }
    expect(credentials.consume("key-a").allowed).toBe(false);
    // A second key is untouched — which is the whole reason this is not the
    // global IP-keyed guard.
    expect(credentials.consume("key-b").allowed).toBe(true);
  });

  it("says out loud that the count is per process, not per cluster", () => {
    expect(McpCredentialsService.describeLimiter()).toContain("in this");
    expect(McpCredentialsService.describeLimiter()).toContain("replicas");
  });
});

describe("McpCredentialAuthGuard", () => {
  function context(authorization?: string) {
    const request: Record<string, unknown> = { headers: { authorization } };
    return {
      request,
      ctx: {
        switchToHttp: () => ({ getRequest: () => request }),
      } as never,
    };
  }

  it("401s a revoked credential, with the reason on the wire", async () => {
    const credentials = {
      verify: jest.fn().mockResolvedValue({
        ok: false,
        reason: "That key was revoked on 2026-09-05T12:00:00.000Z. Mint a new one on /connections.",
      }),
    } as unknown as McpCredentialsService;
    const guard = new McpCredentialAuthGuard(credentials);
    const { ctx } = context(`Bearer ${SECRET_PREFIX}revoked`);

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow("was revoked on");
  });

  it("401s a request with no Authorization header at all", async () => {
    const credentials = {
      verify: jest
        .fn()
        .mockResolvedValue({ ok: false, reason: "No credential presented." }),
    } as unknown as McpCredentialsService;
    const guard = new McpCredentialAuthGuard(credentials);
    const { ctx } = context(undefined);

    await expect(guard.canActivate(ctx)).rejects.toThrow("No credential");
    expect(credentials.verify).toHaveBeenCalledWith(null);
  });

  it("attaches the resolved credential so the controller never re-derives a house", async () => {
    const credential = {
      id: "cred-9",
      restaurantId: HOUSE,
      label: "A",
      scopes: [],
    };
    const credentials = {
      verify: jest.fn().mockResolvedValue({ ok: true, credential }),
    } as unknown as McpCredentialsService;
    const guard = new McpCredentialAuthGuard(credentials);
    const { ctx, request } = context(`Bearer ${SECRET_PREFIX}ok`);

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.mcpCredential).toBe(credential);
  });
});
