/**
 * McpConnectionsService — the register is real, its failures are loud, and the
 * credential never comes back out.
 *
 * Three load-bearing assertions in this file, each pinning a fault this repo has
 * paid for before:
 *
 *  1. A failed read THROWS. Its neighbour, `integrations-oauth.service.ts:485-488`,
 *     logs the error and returns `[]`, which is why `/profile` had to infer a
 *     broken register from an empty array against a non-empty catalogue (G3).
 *  2. `ROW_COLUMNS` does not name `secret_encrypted`. The credential is not
 *     "filtered out of the response" — it is never fetched, so no future edit to
 *     the mapper can leak it.
 *  3. A probe that failed does not move `last_used_at`. One timestamp for "we
 *     called" and one for "it answered", so a month of failures cannot read as a
 *     month of traffic.
 */

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { McpConnectionsService } from "./mcp-connections.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpSecretService } from "../mcp-runtime/mcp-secret.service";
import type { McpProbeOutcome } from "../mcp-runtime/mcp-runtime.types";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/** Everything the builder was asked to do, so a test can read the query back. */
interface Recorder {
  selects: string[];
  updates: Record<string, unknown>[];
  inserts: Record<string, unknown>[];
  /** Every `.eq(column, value)` in order. The tenant filter is in here. */
  filters: Array<[string, unknown]>;
}

/**
 * A PostgREST-shaped builder. Every filter returns `this`; the call resolves
 * either through a terminator (`single`/`maybeSingle`) or by being awaited
 * directly (the list path ends on `.order()`).
 */
function builder(next: () => Result, rec: Recorder) {
  const self: Record<string, unknown> = {
    select: (cols?: string) => {
      if (cols) rec.selects.push(cols);
      return self;
    },
    insert: (values: Record<string, unknown>) => {
      rec.inserts.push(values);
      return self;
    },
    update: (values: Record<string, unknown>) => {
      rec.updates.push(values);
      return self;
    },
    delete: () => self,
    eq: (column: string, value: unknown) => {
      rec.filters.push([column, value]);
      return self;
    },
    is: () => self,
    in: () => self,
    ilike: () => self,
    order: () => self,
    single: () => Promise.resolve(next()),
    maybeSingle: () => Promise.resolve(next()),
    then: (resolve: (v: Result) => unknown) => resolve(next()),
  };
  return self;
}

function makeService(
  results: Result | Result[],
  opts: {
    probe?: McpProbeOutcome;
    secretKey?: string;
  } = {},
): { service: McpConnectionsService; rec: Recorder; runtime: McpRuntimeService } {
  const queue = Array.isArray(results) ? [...results] : [results];
  const next = () => (queue.length > 1 ? (queue.shift() as Result) : queue[0]);
  const rec: Recorder = { selects: [], updates: [], inserts: [], filters: [] };
  /**
   * Table-aware, because a row is no longer one query.
   *
   * ADR 0114 hung consents and per-tool grants off the connection, so reading a
   * row now touches four tables. The queued results describe the CONNECTION
   * table; the side tables answer with empty sets of their own, which is what a
   * house that has declared a server and granted nothing actually looks like.
   * Feeding the connection fixture to every table would have made these tests
   * pass on a shape no database can produce.
   */
  const SIDE_TABLES = new Set([
    "mcp_connection_consents",
    "mcp_tool_grants",
    "mcp_tool_calls",
    "users",
  ]);
  const db = {
    supabase: {
      from: (table: string) =>
        SIDE_TABLES.has(table)
          ? builder(() => ({ data: [], error: null }), {
              // Side-table filters are not part of the tenancy assertions and
              // would drown them; recorded nowhere on purpose.
              selects: [],
              updates: [],
              inserts: [],
              filters: [],
            })
          : builder(next, rec),
    },
  };

  const config = {
    get: (key: string) =>
      key === "MCP_CONNECTION_SECRET_KEY" ? opts.secretKey : undefined,
  };
  const secrets = new McpSecretService(config as never);
  const runtime = new McpRuntimeService(config as never);
  if (opts.probe) {
    jest.spyOn(runtime, "probe").mockResolvedValue(opts.probe);
  }

  return {
    service: new McpConnectionsService(
      db as unknown as DatabaseService,
      {
        // Only consulted on a WRITE tool call; every method in this file is a
        // read, a declaration or a probe, so a manager check that always passes
        // proves nothing here and hides nothing either. The gate itself is
        // pinned in mcp-connections.tool-gate.spec.ts.
        assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
      } as unknown as OrganizationsService,
      runtime,
      secrets,
      // Nothing in this file grants a tool, so the grant seal is a double.
      { issue: jest.fn(), redeem: jest.fn() } as unknown as SealChallengeService,
    ),
    rec,
    runtime,
  };
}

const KEY_HEX = "b".repeat(64);

const ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "House POS bridge",
  url: "https://mcp.house.example",
  scopes: ["inventory:read", "orders:read"],
  created_at: "2026-09-03T09:00:00.000Z",
  last_used_at: null,
  last_probe_at: null,
  revoked_at: null,
  secret_set_at: null,
  probe_status: null,
  probe_detail: null,
  probe_tools: null,
  probe_tool_count: null,
  probe_server_name: null,
  probe_server_version: null,
  probe_protocol_version: null,
};

const OK_PROBE: McpProbeOutcome = {
  status: "ok",
  detail: "Connected. 2 tools listed.",
  calledAt: "2026-09-03T11:00:00.000Z",
  answeredAt: "2026-09-03T11:00:01.000Z",
  serverName: "House POS bridge",
  serverVersion: "3.1.0",
  protocolVersion: "2025-06-18",
  tools: [{ name: "stock_on_hand", title: null, description: null, annotations: null }],
  toolCount: 1,
  truncated: false,
};

describe("McpConnectionsService.list", () => {
  it("throws on a query error instead of returning an empty register", async () => {
    const { service } = makeService({
      data: null,
      error: { message: "connection reset" },
    });

    await expect(service.list("r1", "u1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(service.list("r1", "u1")).rejects.toThrow(
      "The model-context register could not be read: connection reset",
    );
  });

  it("returns a genuinely empty register as an empty list", async () => {
    const { service } = makeService({ data: [], error: null });
    await expect(service.list("r1", "u1")).resolves.toEqual([]);
  });

  it("reports a never-called server's last call as null, not as its creation time", async () => {
    const { service } = makeService({ data: [ROW], error: null });
    const [row] = await service.list("r1", "u1");

    expect(row.lastUsedAt).toBeNull();
    expect(row.lastProbeAt).toBeNull();
    expect(row.createdAt).toBe("2026-09-03T09:00:00.000Z");
    expect(row.status).toBe("active");
    expect(row.scopes).toEqual(["inventory:read", "orders:read"]);
  });

  it("reports a never-probed server's health as null, not as ok", async () => {
    const { service } = makeService({ data: [ROW], error: null });
    const [row] = await service.list("r1", "u1");
    expect(row.probe).toBeNull();
  });

  it("marks a revoked server revoked rather than dropping it from the register", async () => {
    const { service } = makeService({
      data: [{ ...ROW, revoked_at: "2026-09-03T10:00:00.000Z" }],
      error: null,
    });
    const [row] = await service.list("r1", "u1");

    expect(row.status).toBe("revoked");
    expect(row.revokedAt).toBe("2026-09-03T10:00:00.000Z");
  });

  it("NEVER fetches the encrypted secret on a read path", async () => {
    // The protection is the absence of the column from the query, not a filter
    // applied afterwards: a value that was never selected cannot be serialised
    // by a careless change to the mapper.
    expect(McpConnectionsService.ROW_COLUMNS).not.toContain("secret_encrypted");
    expect(McpConnectionsService.ROW_COLUMNS).toContain("secret_set_at");

    const { service, rec } = makeService({ data: [ROW], error: null });
    await service.list("r1", "u1");
    expect(rec.selects.join(" ")).not.toContain("secret_encrypted");

    // The list is a module-level const so `check_read_columns_exist.py` can
    // resolve it and check all sixteen names against supabase/migrations; the
    // class static exists only so this file can assert what it omits. Pin them
    // together, or the guard would end up checking a string the code no longer
    // selects.
    expect(rec.selects[0]).toBe(McpConnectionsService.ROW_COLUMNS);
  });

  it("says a secret is stored from its DATE, never from its value", async () => {
    const { service } = makeService({
      data: [{ ...ROW, secret_set_at: "2026-09-03T09:30:00.000Z" }],
      error: null,
    });
    const [row] = await service.list("r1", "u1");

    expect(row.hasSecret).toBe(true);
    expect(row.secretSetAt).toBe("2026-09-03T09:30:00.000Z");
    expect(JSON.stringify(row)).not.toContain("secret_encrypted");
  });
});

describe("McpConnectionsService.create", () => {
  it("stores the declaration and hands back the row", async () => {
    const { service } = makeService({ data: ROW, error: null });
    const row = await service.create("u1", "r1", {
      name: "House POS bridge",
      url: "https://mcp.house.example",
      scopes: ["inventory:read", "orders:read"],
    });

    expect(row.id).toBe(ROW.id);
    expect(row.lastUsedAt).toBeNull();
  });

  it("turns the duplicate-name index into a conflict the operator can act on", async () => {
    const { service } = makeService({
      data: null,
      error: { message: "duplicate key value", code: "23505" },
    });

    await expect(
      service.create("u1", "r1", {
        name: "House POS bridge",
        url: "https://mcp.house.example",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses a whitespace-only name before it reaches the database", async () => {
    const { service } = makeService({ data: ROW, error: null });
    await expect(
      service.create("u1", "r1", { name: "   ", url: "https://x.example" }),
    ).rejects.toThrow("A server needs a name");
  });

  it("encrypts a supplied secret and writes the envelope, never the value", async () => {
    const { service, rec } = makeService(
      { data: { ...ROW, secret_set_at: "2026-09-03T09:30:00.000Z" }, error: null },
      { secretKey: KEY_HEX },
    );

    await service.create("u1", "r1", {
      name: "House POS bridge",
      url: "https://mcp.house.example",
      secret: "the-house-token",
    });

    const written = rec.inserts[0];
    expect(String(written.secret_encrypted)).toMatch(/^v1\./);
    expect(JSON.stringify(written)).not.toContain("the-house-token");
    expect(written.secret_set_at).toBeTruthy();
  });

  it("REFUSES the whole write when no key is configured, rather than storing plaintext", async () => {
    const { service, rec } = makeService({ data: ROW, error: null });

    await expect(
      service.create("u1", "r1", {
        name: "House POS bridge",
        url: "https://mcp.house.example",
        secret: "the-house-token",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    // Nothing was written at all: a row declared without the credential the
    // operator believed they had supplied is worse than no row.
    expect(rec.inserts).toHaveLength(0);
  });

  it("still stores a server with no secret when no key is configured", async () => {
    const { service } = makeService({ data: ROW, error: null });
    await expect(
      service.create("u1", "r1", {
        name: "House POS bridge",
        url: "https://mcp.house.example",
      }),
    ).resolves.toMatchObject({ hasSecret: false });
  });
});

describe("McpConnectionsService.setSecret", () => {
  it("clears the credential when sent null, without needing a key", async () => {
    const { service, rec } = makeService({ data: ROW, error: null });
    await service.setSecret("r1", "u1", ROW.id, null);

    expect(rec.updates[0]).toMatchObject({
      secret_encrypted: null,
      secret_set_at: null,
    });
  });

  it("refuses to store one when the key is absent, naming the variable", async () => {
    const { service } = makeService({ data: ROW, error: null });
    await expect(
      service.setSecret("r1", "u1", ROW.id, "tok"),
    ).rejects.toThrow(/MCP_CONNECTION_SECRET_KEY/);
  });

  it("404s rather than reporting success when nothing matched", async () => {
    const { service } = makeService({ data: null, error: null }, { secretKey: KEY_HEX });
    await expect(
      service.setSecret("r1", "u1", ROW.id, "tok"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("McpConnectionsService.revoke", () => {
  it("revokes a live server and returns it revoked", async () => {
    const { service } = makeService({
      data: { ...ROW, revoked_at: "2026-09-03T10:00:00.000Z" },
      error: null,
    });

    await expect(service.revoke("r1", "u1", ROW.id)).resolves.toMatchObject({
      status: "revoked",
    });
  });

  it("destroys the credential rather than orphaning it", async () => {
    const { service, rec } = makeService({
      data: { ...ROW, revoked_at: "2026-09-03T10:00:00.000Z" },
      error: null,
    });
    await service.revoke("r1", "u1", ROW.id);

    expect(rec.updates[0]).toMatchObject({
      secret_encrypted: null,
      secret_set_at: null,
    });
  });

  it("404s rather than reporting success when nothing matched", async () => {
    // The update is scoped by user AND restaurant AND `revoked_at is null`, so
    // "already revoked", "someone else's" and "does not exist" all arrive here
    // as no row. Reporting success would be the absence-as-health inversion:
    // the caller would be told a revoke happened that did not.
    const { service } = makeService({ data: null, error: null });

    await expect(service.revoke("r1", "u1", ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws on a write error rather than swallowing it", async () => {
    const { service } = makeService({
      data: null,
      error: { message: "deadlock detected" },
    });

    await expect(service.revoke("r1", "u1", ROW.id)).rejects.toThrow(
      "The model-context server was not revoked: deadlock detected",
    );
  });
});

describe("McpConnectionsService.probe", () => {
  it("records a successful handshake, stamping BOTH timestamps", async () => {
    const { service, rec } = makeService(
      [
        { data: { id: ROW.id, url: ROW.url, revoked_at: null, secret_encrypted: null }, error: null },
        {
          data: {
            ...ROW,
            last_probe_at: OK_PROBE.calledAt,
            last_used_at: OK_PROBE.answeredAt,
            probe_status: "ok",
            probe_detail: OK_PROBE.detail,
            probe_tools: OK_PROBE.tools,
            probe_tool_count: 1,
            probe_server_name: "House POS bridge",
          },
          error: null,
        },
      ],
      { probe: OK_PROBE },
    );

    const row = await service.probe("r1", "u1", ROW.id);

    expect(rec.updates[0]).toMatchObject({
      last_probe_at: OK_PROBE.calledAt,
      last_used_at: OK_PROBE.answeredAt,
      probe_status: "ok",
    });
    expect(row.probe?.status).toBe("ok");
    expect(row.probe?.tools?.map((t) => t.name)).toEqual(["stock_on_hand"]);
  });

  it("does NOT move last_used_at when the server did not answer", async () => {
    const failed: McpProbeOutcome = {
      ...OK_PROBE,
      status: "unreachable",
      detail: "nothing answered.",
      answeredAt: null,
      tools: null,
      toolCount: null,
    };
    const { service, rec } = makeService(
      [
        { data: { id: ROW.id, url: ROW.url, revoked_at: null, secret_encrypted: null }, error: null },
        { data: { ...ROW, probe_status: "unreachable" }, error: null },
      ],
      { probe: failed },
    );

    await service.probe("r1", "u1", ROW.id);

    expect(rec.updates[0]).toHaveProperty("last_probe_at");
    // The whole reason there are two columns.
    expect(rec.updates[0]).not.toHaveProperty("last_used_at");
  });

  it("returns a 200-shaped row for a failed handshake, not an exception", async () => {
    const refused: McpProbeOutcome = {
      ...OK_PROBE,
      status: "refused",
      detail: "HTTP 500.",
      answeredAt: null,
      tools: null,
      toolCount: null,
    };
    const { service } = makeService(
      [
        { data: { id: ROW.id, url: ROW.url, revoked_at: null, secret_encrypted: null }, error: null },
        { data: { ...ROW, probe_status: "refused", probe_detail: "HTTP 500." }, error: null },
      ],
      { probe: refused },
    );

    // A broken third-party server must not read as a broken Mudavym.
    await expect(service.probe("r1", "u1", ROW.id)).resolves.toMatchObject({
      probe: { status: "refused", detail: "HTTP 500." },
    });
  });

  it("does not call the server anonymously when its stored secret cannot be read", async () => {
    const { service, rec, runtime } = makeService([
      {
        data: {
          id: ROW.id,
          url: ROW.url,
          revoked_at: null,
          secret_encrypted: "v1.aa.bb.cc",
        },
        error: null,
      },
      { data: { ...ROW, probe_status: "unconfigured" }, error: null },
    ]);
    const spy = jest.spyOn(runtime, "probe");

    const row = await service.probe("r1", "u1", ROW.id);

    // The fault this prevents: an anonymous call succeeding, and the operator
    // reading "connected" as proof the credential works.
    expect(spy).not.toHaveBeenCalled();
    expect(rec.updates[0]).toMatchObject({ probe_status: "unconfigured" });
    expect(String(rec.updates[0].probe_detail)).toContain(
      "MCP_CONNECTION_SECRET_KEY",
    );
    expect(row.probe?.status).toBe("unconfigured");
  });

  it("refuses to call a revoked server", async () => {
    const { service, runtime } = makeService({
      data: { id: ROW.id, url: ROW.url, revoked_at: "2026-09-03T10:00:00.000Z", secret_encrypted: null },
      error: null,
    });
    const spy = jest.spyOn(runtime, "probe");

    await expect(service.probe("r1", "u1", ROW.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("404s on an id that is not this user's in this restaurant", async () => {
    const { service } = makeService({ data: null, error: null });
    await expect(service.probe("r1", "u1", ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("McpConnectionsService.runtimeState", () => {
  /**
   * This test used to assert `enabled: false` "because that decision comes
   * before the code". The founder made the decision on 2026-09-03 (ADR 0107
   * addendum): a per-tool grant, and the seal on every write. So the flag is
   * true and the sentence states the terms — which is the thing the page
   * prints, and therefore the thing worth pinning.
   */
  it("says invocation is on, and states the terms it runs under", async () => {
    const { service } = makeService({ data: [], error: null });
    const state = service.runtimeState();

    expect(state.invocation.enabled).toBe(true);
    expect(state.invocation.reason).toMatch(/granted it by name/i);
    expect(state.invocation.reason).toMatch(/seal/i);
    expect(state.probeTimeoutMs).toBeGreaterThan(0);
  });

  it("reports secret storage as unconfigured, naming the variable", async () => {
    const { service } = makeService({ data: [], error: null });
    expect(service.runtimeState().secretStorage).toMatchObject({
      configured: false,
    });
    expect(service.runtimeState().secretStorage.reason).toContain(
      "MCP_CONNECTION_SECRET_KEY",
    );
  });

  it("reports it configured, with no reason, once a key is present", async () => {
    const { service } = makeService({ data: [], error: null }, { secretKey: KEY_HEX });
    expect(service.runtimeState().secretStorage).toEqual({
      configured: true,
      reason: null,
    });
  });
});


/**
 * TENANCY, PINNED AT THE QUERY.
 *
 * The controller test proves the restaurant id comes from the token; nothing
 * proved it then reaches the DATABASE. The audit demonstrated the gap by
 * deleting `.eq("restaurant_id", restaurantId)` from `list()` and watching all
 * 37 tests stay green — a dropped tenant filter would have shipped behind a
 * clean suite, which is the fault class this repo keeps a memory file about.
 *
 * WHAT CHANGED ON 2026-09-03 (ADR 0114)
 * -------------------------------------
 * These tests asserted the scope was `user_id` AND `restaurant_id`. The founder
 * settled the fork the other way — "house declares, each person consents" — so
 * the scope is the RESTAURANT alone, and asserting a `user_id` filter now would
 * pin the rejected answer. What replaces it is stronger, not weaker: the house
 * filter is still asserted on every statement, and `user_id` is asserted to be
 * ABSENT, because a per-user filter creeping back is exactly how one manager's
 * server became invisible to the owner of the house.
 */
describe("every read and write is scoped to the restaurant, and to nobody's account", () => {
  const houses = (rec: { filters: Array<[string, unknown]> }) =>
    rec.filters.filter(([c]) => c === "restaurant_id").map(([, v]) => v);
  const users = (rec: { filters: Array<[string, unknown]> }) =>
    rec.filters.filter(([c]) => c === "user_id").map(([, v]) => v);

  it("list() reads the house, not the reader", async () => {
    const { service, rec } = makeService({ data: [ROW], error: null });
    await service.list("r-mine", "u-mine");

    expect(houses(rec)).toContain("r-mine");
    // The reader's id reaches the CONSENT lookup, never the connection filter.
    // A `user_id` on the connections query is the rejected design returning.
    expect(users(rec)).not.toContain("u-mine");
  });

  it("create() records the house that owns it and the person who declared it", async () => {
    const { service, rec } = makeService({ data: ROW, error: null });
    await service.create("u-mine", "r-mine", {
      name: "n",
      url: "https://x.example",
    });

    expect(rec.inserts[0]).toMatchObject({
      restaurant_id: "r-mine",
      declared_by: "u-mine",
    });
    // `user_id` is gone from this table: it was the column that made deleting a
    // manager delete the house's Toast bridge.
    expect(rec.inserts[0]).not.toHaveProperty("user_id");
  });

  it("revoke() is scoped by the house and the id", async () => {
    const { service, rec } = makeService({
      data: { ...ROW, revoked_at: "2026-09-03T10:00:00.000Z" },
      error: null,
    });
    await service.revoke("r-mine", "u-mine", ROW.id);

    expect(houses(rec)).toContain("r-mine");
    expect(rec.filters).toContainEqual(["id", ROW.id]);
  });

  it("setSecret() is scoped by the house", async () => {
    const { service, rec } = makeService({ data: ROW, error: null });
    await service.setSecret("r-mine", "u-mine", ROW.id, null);
    expect(houses(rec)).toContain("r-mine");
  });

  it("probe() scopes the row it READS and the row it writes back", async () => {
    const { service, rec } = makeService(
      [
        {
          data: { id: ROW.id, url: ROW.url, revoked_at: null, secret_encrypted: null },
          error: null,
        },
        { data: { ...ROW, probe_status: "ok" }, error: null },
      ],
      { probe: OK_PROBE },
    );
    await service.probe("r-mine", "u-mine", ROW.id);

    // Two statements, two scopes: reading a row from another house and then
    // stamping a probe onto it are separate holes, so both are asserted.
    expect(houses(rec).filter((h) => h === "r-mine").length).toBeGreaterThanOrEqual(2);
  });

  it("never filters by a restaurant the caller supplied instead of the token's", async () => {
    const { service, rec } = makeService({ data: [ROW], error: null });
    await service.list("r-from-token", "u-mine");
    expect(houses(rec)).toEqual(["r-from-token"]);
  });
});
