/**
 * "Server-declared, manager-confirmed, re-consent on change" — end to end
 * through the service, with a hand-built database.
 *
 * The founder settled on 2026-09-04 who classifies a tool as a write. The rule
 * has three moving parts and each one has a way of failing quietly, so each is
 * asserted here against the service rather than against the pure function that
 * `mcp-runtime/tool-classification.spec.ts` already covers:
 *
 *   grant   — the declaration is READ from the last probe and STORED on the
 *             grant. An unlisted or unannotated tool cannot be granted as a
 *             read; a declared write cannot be granted as a read at all.
 *   gate    — a suspended grant is refused BEFORE the read/write split, and an
 *             unaffirmed read is treated as a write even if the column says
 *             otherwise.
 *   probe   — a changed annotation suspends; a removed tool revokes; a FAILED
 *             probe does neither, because silence is not evidence.
 *
 * The double records every write it is handed, so the assertions are about the
 * rows the service actually produced and not about it having returned without
 * throwing.
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpSecretService } from "../mcp-runtime/mcp-secret.service";
import { McpConnectionsService } from "./mcp-connections.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { hashCallArgs, hashSealToken } from "../common/seal/seal-token";
import { fingerprintToolList } from "../mcp-runtime/tool-classification";
import { fingerprintTool } from "../mcp-runtime/tool-classification";
import type {
  McpToolAnnotations,
  McpToolSummary,
} from "../mcp-runtime/mcp-runtime.types";

const CONNECTION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const RESTAURANT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const MANAGER = "cccccccc-3333-4333-8333-cccccccccccc";

function tool(
  name: string,
  annotations: Partial<McpToolAnnotations> | null,
): McpToolSummary {
  return {
    name,
    title: null,
    description: null,
    annotations: annotations
      ? {
          readOnlyHint: null,
          destructiveHint: null,
          idempotentHint: null,
          openWorldHint: null,
          ...annotations,
        }
      : null,
  };
}

interface SealRow {
  id: string;
  subject_kind: string;
  subject_id: string;
  actor_user_id: string;
  tool_name: string;
  args_hash: string;
  token_hash: string;
  expires_at: string;
  redeemed_at: string | null;
}

interface Fixture {
  /** What the last probe stored on the connection row. */
  probeTools?: McpToolSummary[] | null;
  /** Live grant rows the double hands back. */
  grants?: Record<string, unknown>[];
  consent?: Record<string, unknown> | null;
  /** Seals already issued. The grant path redeems from here. */
  seals?: SealRow[];
}

interface Recorder {
  db: DatabaseService;
  grantInserts: Record<string, unknown>[];
  grantUpdates: Array<{ patch: Record<string, unknown>; id: string | null }>;
  toolCalls: Record<string, unknown>[];
  sealInserts: Record<string, unknown>[];
  sealsRedeemed: string[];
  auditRows: Record<string, unknown>[];
}

/**
 * A Supabase double that is honest about which row an update landed on.
 *
 * The earlier gate spec's double ignores `.eq()`, which is fine when one row
 * exists. Reconciliation writes to a SPECIFIC grant out of several, so the
 * filter has to be remembered or "it suspended the right one" is untestable.
 */
function buildDb(fixture: Fixture): Recorder {
  const grantInserts: Record<string, unknown>[] = [];
  const grantUpdates: Array<{ patch: Record<string, unknown>; id: string | null }> = [];
  const toolCalls: Record<string, unknown>[] = [];
  const sealInserts: Record<string, unknown>[] = [];
  const sealsRedeemed: string[] = [];
  const auditRows: Record<string, unknown>[] = [];
  const seals = fixture.seals ?? [];

  const chain = (result: { data: unknown; error: null }) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "ilike", "in", "order"]) {
      self[m] = () => self;
    }
    self.maybeSingle = () => Promise.resolve(result);
    self.single = () => Promise.resolve(result);
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
    return self;
  };

  const connectionRow = {
    id: CONNECTION_ID,
    name: "Toast bridge",
    url: "https://mcp.example.test/toast",
    scopes: [],
    created_at: "2026-09-01T00:00:00.000Z",
    last_used_at: null,
    last_probe_at: null,
    revoked_at: null,
    declared_by: MANAGER,
    secret_set_at: null,
    secret_encrypted: null,
    probe_status: "ok",
    probe_detail: "Connected.",
    probe_tools: fixture.probeTools ?? null,
    probe_tool_count: (fixture.probeTools ?? []).length,
    probe_server_name: "toast",
    probe_server_version: "1",
    probe_protocol_version: "2025-06-18",
  };

  const db = {
    supabase: {
      from(table: string) {
        if (table === "restaurant_mcp_connections") {
          return {
            ...chain({ data: connectionRow, error: null }),
            update: () => chain({ data: connectionRow, error: null }),
          };
        }
        if (table === "mcp_connection_consents") {
          return chain({ data: fixture.consent ?? null, error: null });
        }
        if (table === "mcp_tool_grants") {
          const live = fixture.grants ?? [];
          const api: Record<string, unknown> = {};
          let filterId: string | null = null;
          for (const m of ["select", "is", "ilike", "in", "order"]) {
            api[m] = () => api;
          }
          api.eq = (col: string, value: string) => {
            if (col === "id") filterId = value;
            return api;
          };
          api.maybeSingle = () => Promise.resolve({ data: live[0] ?? null, error: null });
          api.single = () => Promise.resolve({ data: live[0] ?? null, error: null });
          api.then = (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: live, error: null }).then(resolve);
          api.insert = (row: Record<string, unknown>) => {
            grantInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          };
          api.update = (patch: Record<string, unknown>) => {
            const upd: Record<string, unknown> = {};
            for (const m of ["is", "ilike", "in", "order"]) upd[m] = () => upd;
            upd.eq = (col: string, value: string) => {
              if (col === "id") filterId = value;
              return upd;
            };
            const settle = () => {
              grantUpdates.push({ patch, id: filterId });
              return { data: live.map((g) => ({ id: g.id })), error: null };
            };
            upd.select = () => ({
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(settle()).then(resolve),
            });
            upd.then = (resolve: (v: unknown) => unknown) =>
              Promise.resolve(settle()).then(resolve);
            return upd;
          };
          return api;
        }
        if (table === "mcp_tool_calls") {
          return {
            // The register reads this table too, for the seal history the row
            // shows; the double answers both shapes.
            ...chain({ data: [], error: null }),
            insert: (row: Record<string, unknown>) => {
              toolCalls.push(row);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        if (table === "mcp_seal_challenges") {
          // The REAL SealChallengeService runs against this, so the grant path
          // is proven end to end rather than against a stub that always says
          // yes — which is exactly the shape of the bug this pass is fixing.
          const api: Record<string, unknown> = {};
          let tokenHash: string | null = null;
          let rowId: string | null = null;
          for (const m of ["select", "is", "ilike", "in", "order"]) api[m] = () => api;
          api.eq = (col: string, value: string) => {
            if (col === "token_hash") tokenHash = value;
            if (col === "id") rowId = value;
            return api;
          };
          api.maybeSingle = () =>
            Promise.resolve({
              data: seals.find((sl) => sl.token_hash === tokenHash) ?? null,
              error: null,
            });
          api.insert = (row: Record<string, unknown>) => {
            sealInserts.push(row);
            return Promise.resolve({ data: null, error: null });
          };
          api.update = (patch: Record<string, unknown>) => {
            const upd: Record<string, unknown> = {};
            let unspentOnly = false;
            for (const m of ["ilike", "in", "order"]) upd[m] = () => upd;
            upd.eq = (col: string, value: string) => {
              if (col === "id") rowId = value;
              return upd;
            };
            upd.is = (col: string, value: unknown) => {
              if (col === "redeemed_at" && value === null) unspentOnly = true;
              return upd;
            };
            const settle = () => {
              const r = seals.find((sl) => sl.id === rowId);
              if (!r || (unspentOnly && r.redeemed_at)) return { data: [], error: null };
              r.redeemed_at = String(patch.redeemed_at);
              sealsRedeemed.push(r.id);
              return { data: [{ id: r.id }], error: null };
            };
            upd.select = () => ({
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(settle()).then(resolve),
            });
            upd.then = (resolve: (v: unknown) => unknown) =>
              Promise.resolve(settle()).then(resolve);
            return upd;
          };
          return api;
        }
        if (table === "system_audit_log") {
          return {
            insert: (row: Record<string, unknown>) => {
              auditRows.push(row);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        if (table === "users") {
          return chain({ data: [], error: null });
        }
        return chain({ data: null, error: null });
      },
    },
  } as unknown as DatabaseService;

  return { db, grantInserts, grantUpdates, toolCalls, sealInserts, sealsRedeemed, auditRows };
}

function build(
  fixture: Fixture,
  opts: { isManager?: boolean; probe?: Partial<McpToolSummary[]> | null } = {},
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
    probe: jest.fn(),
    callTool: jest.fn(async () => ({
      status: "ok" as const,
      detail: "ran and answered.",
      calledAt: "2026-09-04T10:00:00.000Z",
      answeredAt: "2026-09-04T10:00:01.000Z",
      content: "done",
      isError: false,
    })),
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
    new SealChallengeService(recorder.db),
  );
  return { service, runtime, organizations, recorder };
}

const liveConsent = {
  connection_id: CONNECTION_ID,
  user_id: MANAGER,
  consented_at: "2026-09-01T00:00:00.000Z",
  withdrawn_at: null,
  house_revoked_at: null,
  house_revoked_by: null,
};

/* ── 1. granting against the server's declaration ───────────────────────── */

describe("granting a tool against what the server declared", () => {
  it("stores the declaration when the server says readOnlyHint: true", async () => {
    const listed = tool("list_checks", { readOnlyHint: true });
    const { service, recorder } = build({ probeTools: [listed] });

    // A declared read needs NO seal: this grant takes a permission away rather
    // than giving one, and a ceremony to narrow something teaches people to
    // skip the ceremony.
    await service.grantTool(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "list_checks",
      false,
      null,
    );

    expect(recorder.grantInserts).toHaveLength(1);
    expect(recorder.grantInserts[0]).toMatchObject({
      tool_name: "list_checks",
      writes: false,
      declared_read: true,
      classification_source: "declared",
      tool_fingerprint: fingerprintTool(listed),
      needs_reconsent_at: null,
    });
    expect(recorder.grantInserts[0].tool_list_hash).toEqual(expect.any(String));
  });

  it("REFUSES to grant a declared write as a read", async () => {
    const { service, recorder } = build({
      probeTools: [tool("place_order", { readOnlyHint: false })],
    });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", false, null),
    ).rejects.toThrow(BadRequestException);
    expect(recorder.grantInserts).toHaveLength(0);
  });

  it("REFUSES to grant an UNANNOTATED tool as a read", async () => {
    const { service, recorder } = build({ probeTools: [tool("mystery", null)] });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "mystery", false, null),
    ).rejects.toThrow(/write/i);
    expect(recorder.grantInserts).toHaveLength(0);
  });

  it("REFUSES to grant a tool the server has never listed as a read", async () => {
    const { service } = build({ probeTools: null });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "anything", false, null),
    ).rejects.toThrow(/has not listed/i);
  });
});

/* ── 1b. the seal on the GRANT itself ───────────────────────────────────── */

/**
 * The audit's BLOCKER, as tests.
 *
 * The first build gated re-consent on `sealed: true` — a boolean the CLIENT
 * set, in the same request that asked for the change. That is the exact
 * assertion-in-its-own-request flaw ADR 0114 named and the CALL path had
 * already closed, reintroduced one route over. So: a grant that turns a call ON
 * is redeemed, never asserted, and there is no boolean left to send.
 */
describe("the seal on a grant", () => {
  const seal = (over: Partial<SealRow> & { token: string; args: Record<string, unknown> }): SealRow => ({
    id: "seal-g1",
    subject_kind: "mcp_tool_grant",
    subject_id: CONNECTION_ID,
    actor_user_id: MANAGER,
    tool_name: `grant:${over.tool_name ?? "list_checks"}`,
    args_hash: hashCallArgs(over.args),
    token_hash: hashSealToken(over.token),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    ...over,
  });

  const argsFor = (name: string, tools: McpToolSummary[]) => ({
    toolName: name.toLowerCase(),
    toolListHash: fingerprintToolList(tools),
  });

  it("issues a seal bound to the connection, the act and the tool list", async () => {
    const tools = [tool("list_checks", { readOnlyHint: true })];
    const { service, recorder } = build({ probeTools: tools });

    const issued = await service.issueGrantSeal(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "list_checks",
      true,
    );

    expect(issued.challenge).toHaveLength(64);
    expect(recorder.sealInserts[0]).toMatchObject({
      subject_kind: "mcp_tool_grant",
      subject_id: CONNECTION_ID,
      actor_user_id: MANAGER,
      tool_name: "grant:list_checks",
      args_hash: hashCallArgs(argsFor("list_checks", tools)),
      token_hash: hashSealToken(issued.challenge),
    });
    // Never the token itself.
    expect(JSON.stringify(recorder.sealInserts[0])).not.toContain(issued.challenge);
  });

  it("REFUSES a click without a hold — no challenge, no write grant", async () => {
    const tools = [tool("list_checks", { readOnlyHint: true })];
    const { service, recorder } = build({ probeTools: tools });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "list_checks", true, null),
    ).rejects.toThrow(/proven rather than asserted/i);
    expect(recorder.grantInserts).toHaveLength(0);
    // And the refusal is filed, not silent.
    expect(recorder.auditRows.at(-1)).toMatchObject({ action: "seal_refused" });
  });

  it("records a manager TIGHTENING a declared read into a write, behind a redeemed seal", async () => {
    const tools = [tool("list_checks", { readOnlyHint: true })];
    const token = "a".repeat(64);
    const { service, recorder } = build({
      probeTools: tools,
      seals: [seal({ token, args: argsFor("list_checks", tools) })],
    });

    await service.grantTool(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "list_checks",
      true,
      token,
    );

    expect(recorder.sealsRedeemed).toEqual(["seal-g1"]);
    expect(recorder.grantInserts[0]).toMatchObject({
      writes: true,
      declared_read: true,
      classification_source: "manager_override",
      granted_by: MANAGER,
    });
  });

  it("REFUSES a re-consent without a hold, and completes one with a redeemed seal", async () => {
    const tools = [tool("place_order", { readOnlyHint: false })];
    const suspended = {
      id: "g-1",
      connection_id: CONNECTION_ID,
      tool_name: "place_order",
      writes: true,
      revoked_at: null,
      declared_read: true,
      needs_reconsent_at: "2026-09-04T09:00:00.000Z",
      needs_reconsent_reason: "the server changed readOnlyHint true to false",
    };
    const token = "b".repeat(64);

    const unsealed = build({ probeTools: tools, grants: [suspended] });
    await expect(
      unsealed.service.grantTool(
        RESTAURANT,
        MANAGER,
        CONNECTION_ID,
        "place_order",
        true,
        null,
      ),
    ).rejects.toThrow(/proven rather than asserted/i);
    expect(unsealed.recorder.grantInserts).toHaveLength(0);

    const sealed = build({
      probeTools: tools,
      grants: [suspended],
      seals: [
        seal({
          token,
          tool_name: "grant:place_order",
          args: argsFor("place_order", tools),
        }),
      ],
    });
    await sealed.service.grantTool(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "place_order",
      true,
      token,
    );
    expect(sealed.recorder.grantInserts[0]).toMatchObject({
      writes: true,
      declared_read: false,
      needs_reconsent_at: null,
    });
  });

  it("REFUSES a REPLAY of a spent grant seal", async () => {
    const tools = [tool("list_checks", { readOnlyHint: true })];
    const token = "c".repeat(64);
    const { service, recorder } = build({
      probeTools: tools,
      seals: [
        seal({
          token,
          args: argsFor("list_checks", tools),
          redeemed_at: "2026-09-04T09:59:00.000Z",
        }),
      ],
    });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "list_checks", true, token),
    ).rejects.toThrow(/already been spent/i);
    expect(recorder.grantInserts).toHaveLength(0);
  });

  it("REFUSES a seal minted over a DIFFERENT tool list", async () => {
    // The seal is held while the server changes what it offers. That is the
    // very race the suspension exists to catch, so the seal must not survive it.
    const before = [tool("list_checks", { readOnlyHint: true })];
    const after = [
      tool("list_checks", { readOnlyHint: true }),
      tool("place_order", { readOnlyHint: false }),
    ];
    const token = "d".repeat(64);
    const { service, recorder } = build({
      probeTools: after,
      seals: [seal({ token, args: argsFor("list_checks", before) })],
    });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "list_checks", true, token),
    ).rejects.toThrow(/changed after the seal was issued/i);
    expect(recorder.grantInserts).toHaveLength(0);
  });

  it("REFUSES a seal issued for a different tool on the same server", async () => {
    const tools = [
      tool("list_checks", { readOnlyHint: true }),
      tool("place_order", { readOnlyHint: false }),
    ];
    const token = "e".repeat(64);
    const { service } = build({
      probeTools: tools,
      seals: [
        seal({
          token,
          tool_name: "grant:list_checks",
          args: argsFor("place_order", tools),
        }),
      ],
    });

    await expect(
      service.grantTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", true, token),
    ).rejects.toThrow(/different act on this grant/i);
  });
});


/* ── 2. the gate ────────────────────────────────────────────────────────── */

describe("the gate, with the declaration on the grant", () => {
  it("runs a DECLARED read with no seal", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grants: [
        {
          id: "g-1",
          tool_name: "list_checks",
          writes: false,
          declared_read: true,
          needs_reconsent_at: null,
        },
      ],
    });

    await service.callTool(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "list_checks",
      {},
      false,
    );
    expect(runtime.callTool).toHaveBeenCalled();
  });

  it("demands the seal for a DECLARED write", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grants: [
        {
          id: "g-1",
          tool_name: "place_order",
          writes: true,
          declared_read: false,
          needs_reconsent_at: null,
        },
      ],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", {}, false),
    ).rejects.toThrow(/behind the seal/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("demands the seal for an UNKNOWN declaration even if the row says read", async () => {
    // A row the table's CHECK would refuse. If one ever exists — a hand-edit, a
    // restored backup, a migration run out of order — it must not be the thing
    // that lets an unclassified tool run unattended.
    const { service, runtime } = build({
      consent: liveConsent,
      grants: [
        {
          id: "g-1",
          tool_name: "mystery",
          writes: false,
          declared_read: null,
          needs_reconsent_at: null,
        },
      ],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "mystery", {}, false),
    ).rejects.toThrow(/behind the seal/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("REFUSES a suspended grant and names what changed", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grants: [
        {
          id: "g-1",
          tool_name: "list_checks",
          writes: false,
          declared_read: true,
          needs_reconsent_at: "2026-09-04T09:00:00.000Z",
          needs_reconsent_reason: "the server changed readOnlyHint true to false",
        },
      ],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "list_checks", {}, true),
    ).rejects.toThrow(/readOnlyHint true to false/);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });
});

/* ── 3. reconciliation on a fresh probe ─────────────────────────────────── */

describe("what a fresh tool list does to existing grants", () => {
  const grantOf = (
    name: string,
    declaration: McpToolSummary,
    overrides: Record<string, unknown> = {},
  ) => ({
    id: `g-${name}`,
    connection_id: CONNECTION_ID,
    tool_name: name,
    writes: declaration.annotations?.readOnlyHint === true ? false : true,
    revoked_at: null,
    declared_read: declaration.annotations?.readOnlyHint === true,
    declared_annotations: declaration.annotations,
    tool_fingerprint: fingerprintTool(declaration),
    needs_reconsent_at: null,
    needs_reconsent_reason: null,
    ...overrides,
  });

  const probeOutcome = (tools: McpToolSummary[] | null, status = "ok") => ({
    status,
    detail: "probed.",
    calledAt: "2026-09-04T12:00:00.000Z",
    answeredAt: status === "ok" ? "2026-09-04T12:00:01.000Z" : null,
    serverName: "toast",
    serverVersion: "1",
    protocolVersion: "2025-06-18",
    tools,
    toolCount: tools?.length ?? null,
    truncated: false,
  });

  it("SUSPENDS a grant whose annotation changed, with the change in words", async () => {
    const granted = tool("list_checks", { readOnlyHint: true });
    const { service, runtime, recorder } = build({
      grants: [grantOf("list_checks", granted)],
    });
    (runtime.probe as jest.Mock).mockResolvedValue(
      probeOutcome([tool("list_checks", { readOnlyHint: false })]),
    );

    await service.probe(RESTAURANT, MANAGER, CONNECTION_ID);

    const suspend = recorder.grantUpdates.find(
      (u) => u.patch.needs_reconsent_at && !u.patch.revoked_at,
    );
    expect(suspend).toBeDefined();
    expect(suspend?.id).toBe("g-list_checks");
    expect(suspend?.patch.needs_reconsent_reason).toBe(
      "the server changed readOnlyHint true to false",
    );
  });

  it("REVOKES a grant whose tool the server no longer lists", async () => {
    const granted = tool("list_checks", { readOnlyHint: true });
    const { service, runtime, recorder } = build({
      grants: [grantOf("list_checks", granted)],
    });
    (runtime.probe as jest.Mock).mockResolvedValue(
      probeOutcome([tool("something_else", { readOnlyHint: true })]),
    );

    await service.probe(RESTAURANT, MANAGER, CONNECTION_ID);

    const revoke = recorder.grantUpdates.find((u) => u.patch.revoked_at);
    expect(revoke?.id).toBe("g-list_checks");
    expect(String(revoke?.patch.needs_reconsent_reason)).toContain(
      "no longer lists",
    );
  });

  it("leaves an UNCHANGED grant alone when another tool is added", async () => {
    const granted = tool("list_checks", { readOnlyHint: true });
    const { service, runtime, recorder } = build({
      grants: [grantOf("list_checks", granted)],
    });
    (runtime.probe as jest.Mock).mockResolvedValue(
      probeOutcome([granted, tool("brand_new", null)]),
    );

    await service.probe(RESTAURANT, MANAGER, CONNECTION_ID);

    expect(recorder.grantUpdates).toHaveLength(0);
  });

  it("does NOTHING to any grant when the probe FAILED", async () => {
    // The whole point. An unreachable server has told us nothing about its
    // tools, and converting an outage into a revocation would read afterwards
    // as though the server had withdrawn them.
    const granted = tool("list_checks", { readOnlyHint: true });
    const { service, runtime, recorder } = build({
      grants: [grantOf("list_checks", granted)],
    });
    (runtime.probe as jest.Mock).mockResolvedValue(
      probeOutcome(null, "unreachable"),
    );

    await service.probe(RESTAURANT, MANAGER, CONNECTION_ID);

    expect(recorder.grantUpdates).toHaveLength(0);
  });

  it("does not let a server clear its own suspension by reverting", async () => {
    const granted = tool("list_checks", { readOnlyHint: true });
    const { service, runtime, recorder } = build({
      grants: [
        grantOf("list_checks", granted, {
          needs_reconsent_at: "2026-09-04T09:00:00.000Z",
          needs_reconsent_reason: "the server changed readOnlyHint true to false",
        }),
      ],
    });
    (runtime.probe as jest.Mock).mockResolvedValue(probeOutcome([granted]));

    await service.probe(RESTAURANT, MANAGER, CONNECTION_ID);

    expect(recorder.grantUpdates).toHaveLength(0);
  });
});
