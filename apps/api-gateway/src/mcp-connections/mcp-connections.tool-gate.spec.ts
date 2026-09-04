/**
 * The gate on a model-context tool call, refusal by refusal.
 *
 * ADR 0107 shipped with NO invocation path and said so on the wire
 * (`invocation.enabled: false`), because "calling a tool can bind the house,
 * which is ADR 0013's subject, and that decision comes before the code". The
 * founder made the decision on 2026-09-03 (ADR 0114, and the addendum to 0107):
 *
 *     "Per-tool grant plus the seal on every write. A manager grants each tool
 *      once, by name; a tool that changes the world outside the app runs only
 *      behind HoldToApprove, reads run freely."
 *
 * So there is a gate, and a gate is only worth what its refusals are worth.
 * Five of them are asserted here, plus the two paths that pass:
 *
 *   1. no consent from this person                         → 403
 *   2. this person's consent, cut off by a manager         → 403, DIFFERENT words
 *   3. the tool is not granted at all                      → 403
 *   4. granted as a write, caller is not a manager         → 403 (the shared rule)
 *   5. granted as a write, no seal on the request          → 403
 *   6. granted as a read, consent given                    → the call is made
 *   7. granted as a write, manager, sealed                 → the call is made
 *
 * And one thing that is not a refusal: every call is recorded, including the
 * ones that fail. A log that holds only successes omits exactly the call
 * someone will one day be reading it for.
 *
 * The database is a hand-built double rather than a live Postgres: what is
 * under test is the DECISION, and a decision test that needs a container is a
 * decision test that stops being run.
 */

import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpSecretService } from "../mcp-runtime/mcp-secret.service";
import { McpConnectionsService } from "./mcp-connections.service";

const CONNECTION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const RESTAURANT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

interface Fixture {
  consent?: Record<string, unknown> | null;
  grant?: Record<string, unknown> | null;
}

/** Rows the double hands back, and every insert it saw. */
interface Recorder {
  calls: Record<string, unknown>[];
  db: DatabaseService;
}

function buildDb(fixture: Fixture): Recorder {
  const calls: Record<string, unknown>[] = [];

  const chain = (result: { data: unknown; error: null }) => {
    const self: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "is",
      "ilike",
      "in",
      "order",
      "update",
      "delete",
    ]) {
      self[method] = () => self;
    }
    self.maybeSingle = () => Promise.resolve(result);
    self.single = () => Promise.resolve(result);
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return self;
  };

  const db = {
    supabase: {
      from(table: string) {
        if (table === "restaurant_mcp_connections") {
          return {
            ...chain({
              data: {
                id: CONNECTION_ID,
                url: "https://mcp.example.test/toast",
                revoked_at: null,
                secret_encrypted: null,
              },
              error: null,
            }),
            update: () => chain({ data: null, error: null }),
          };
        }
        if (table === "mcp_connection_consents") {
          return chain({ data: fixture.consent ?? null, error: null });
        }
        if (table === "mcp_tool_grants") {
          return chain({ data: fixture.grant ?? null, error: null });
        }
        if (table === "mcp_tool_calls") {
          return {
            insert: (row: Record<string, unknown>) => {
              calls.push(row);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        return chain({ data: null, error: null });
      },
    },
  } as unknown as DatabaseService;

  return { calls, db };
}

function build(
  fixture: Fixture,
  opts: { isManager?: boolean; runtime?: Partial<McpRuntimeService> } = {},
) {
  const recorder = buildDb(fixture);
  const organizations = {
    assertCanManageRestaurant: jest.fn(async () => {
      if (opts.isManager === false) {
        throw new ForbiddenException("Only managers and owners can do that");
      }
    }),
  } as unknown as OrganizationsService;

  const runtime = {
    limits: { timeoutMs: 8000, maxBytes: 1024, maxTools: 64, allowPrivateEndpoints: false },
    callTool: jest.fn(async () => ({
      status: "ok" as const,
      detail: "ran and answered.",
      calledAt: "2026-09-03T10:00:00.000Z",
      answeredAt: "2026-09-03T10:00:01.000Z",
      content: "done",
      isError: false,
    })),
    ...(opts.runtime ?? {}),
  } as unknown as McpRuntimeService;

  const secrets = {
    isConfigured: true,
    unavailableReason: null,
    open: () => ({ secret: null, reason: null }),
  } as unknown as McpSecretService;

  const service = new McpConnectionsService(
    recorder.db,
    organizations,
    runtime,
    secrets,
  );
  return { service, runtime, organizations, recorder };
}

const liveConsent = {
  connection_id: CONNECTION_ID,
  user_id: "u-me",
  consented_at: "2026-09-01T00:00:00.000Z",
  withdrawn_at: null,
  house_revoked_at: null,
  house_revoked_by: null,
};

describe("calling a model-context tool", () => {
  it("refuses when this person has never consented", async () => {
    const { service, runtime } = build({ consent: null });

    await expect(
      service.callTool(RESTAURANT, "u-me", CONNECTION_ID, "list_checks", {}, false),
    ).rejects.toThrow(/consent/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses in DIFFERENT words when a manager cut the house off", async () => {
    const { service, runtime } = build({
      consent: { ...liveConsent, house_revoked_at: "2026-09-02T00:00:00.000Z" },
    });

    // Not "consent on the row first". Telling someone to consent again when a
    // manager has withdrawn the house's use of it sends them round a loop they
    // cannot finish.
    await expect(
      service.callTool(RESTAURANT, "u-me", CONNECTION_ID, "list_checks", {}, false),
    ).rejects.toThrow(/manager has withdrawn this house's use/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a tool that is listed but not granted", async () => {
    const { service, runtime } = build({ consent: liveConsent, grant: null });

    await expect(
      service.callTool(RESTAURANT, "u-me", CONNECTION_ID, "place_order", {}, true),
    ).rejects.toThrow(/not granted/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a write to a caller who is not a manager", async () => {
    const { service, runtime } = build(
      {
        consent: liveConsent,
        grant: { connection_id: CONNECTION_ID, tool_name: "place_order", writes: true },
      },
      { isManager: false },
    );

    await expect(
      service.callTool(RESTAURANT, "u-me", CONNECTION_ID, "place_order", {}, true),
    ).rejects.toThrow(/managers and owners/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a write that did not arrive sealed", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: { connection_id: CONNECTION_ID, tool_name: "place_order", writes: true },
    });

    await expect(
      service.callTool(RESTAURANT, "u-me", CONNECTION_ID, "place_order", {}, false),
    ).rejects.toThrow(/behind the seal/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("runs a granted READ without a seal, for anyone who consented", async () => {
    const { service, runtime, organizations } = build({
      consent: liveConsent,
      grant: { connection_id: CONNECTION_ID, tool_name: "list_checks", writes: false },
    });

    const result = await service.callTool(
      RESTAURANT,
      "u-me",
      CONNECTION_ID,
      "list_checks",
      { limit: 5 },
      false,
    );

    expect(runtime.callTool).toHaveBeenCalledWith(
      "https://mcp.example.test/toast",
      null,
      "list_checks",
      { limit: 5 },
    );
    expect(result.status).toBe("ok");
    expect(result.writes).toBe(false);
    // A read is not a manager's act. The role check must not be consulted at
    // all, or "reads run freely" would be false for every staff member.
    expect(organizations.assertCanManageRestaurant).not.toHaveBeenCalled();
  });

  it("runs a granted WRITE for a manager holding the seal", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: { connection_id: CONNECTION_ID, tool_name: "place_order", writes: true },
    });

    const result = await service.callTool(
      RESTAURANT,
      "u-me",
      CONNECTION_ID,
      "place_order",
      { sku: "KV-1" },
      true,
    );

    expect(runtime.callTool).toHaveBeenCalled();
    expect(result.writes).toBe(true);
    expect(result.sealed).toBe(true);
  });

  it("records the call, and records it when the server refused too", async () => {
    const { service, recorder } = build(
      {
        consent: liveConsent,
        grant: { connection_id: CONNECTION_ID, tool_name: "list_checks", writes: false },
      },
      {
        runtime: {
          callTool: jest.fn(async () => ({
            status: "unreachable" as const,
            detail: "nothing answered.",
            calledAt: "2026-09-03T10:00:00.000Z",
            answeredAt: null,
            content: null,
            isError: null,
          })),
        } as unknown as Partial<McpRuntimeService>,
      },
    );

    const result = await service.callTool(
      RESTAURANT,
      "u-me",
      CONNECTION_ID,
      "list_checks",
      {},
      false,
    );

    expect(result.status).toBe("unreachable");
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      connection_id: CONNECTION_ID,
      called_by: "u-me",
      tool_name: "list_checks",
      writes: false,
      sealed: false,
      outcome: "unreachable",
    });
  });
});

describe("withdrawing a consent", () => {
  it("does not rewrite when the consent was given", async () => {
    const updates: Record<string, unknown>[] = [];
    const recorder = buildDb({ consent: liveConsent });
    // Re-wrap the consents table so the update payload can be read back.
    const supabase = (recorder.db as unknown as { supabase: { from: (t: string) => unknown } })
      .supabase;
    const original = supabase.from.bind(supabase);
    supabase.from = (table: string) => {
      if (table !== "mcp_connection_consents") return original(table);
      const self: Record<string, unknown> = {};
      self.update = (v: Record<string, unknown>) => {
        updates.push(v);
        return self;
      };
      self.upsert = (v: Record<string, unknown>) => {
        updates.push(v);
        return Promise.resolve({ data: null, error: null });
      };
      for (const m of ["select", "eq", "is", "in", "ilike"]) self[m] = () => self;
      self.maybeSingle = () => Promise.resolve({ data: liveConsent, error: null });
      self.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: "x" }], error: null }).then(r);
      return self;
    };

    const service = new McpConnectionsService(
      recorder.db,
      { assertCanManageRestaurant: jest.fn() } as unknown as OrganizationsService,
      { limits: { timeoutMs: 1 } } as unknown as McpRuntimeService,
      {
        isConfigured: true,
        unavailableReason: null,
        open: () => ({ secret: null, reason: null }),
      } as unknown as McpSecretService,
    );

    await service.setConsent(RESTAURANT, "u-me", CONNECTION_ID, false);

    expect(updates).toHaveLength(1);
    // The whole point: a withdrawal that rewrote `consented_at` would date a
    // consent that stood for months to the moment it ended.
    expect(updates[0]).toHaveProperty("withdrawn_at");
    expect(updates[0]).not.toHaveProperty("consented_at");
  });
});

describe("the runtime state the page reads", () => {
  it("says invocation is on, and says on what terms", () => {
    const { service } = build({});
    const state = service.runtimeState();

    expect(state.invocation.enabled).toBe(true);
    // The sentence is the contract the page prints. If invocation is ever
    // turned off again, this reason has to change with it — a boolean flipping
    // while the prose still described the old world is how ADR 0107's own
    // `false` outlived its decision.
    expect(state.invocation.reason).toMatch(/granted it by name/i);
    expect(state.invocation.reason).toMatch(/seal/i);
  });
});
