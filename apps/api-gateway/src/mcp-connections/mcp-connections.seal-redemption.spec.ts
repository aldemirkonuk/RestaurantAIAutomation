/**
 * A seal on a tool write is REDEEMED, not asserted.
 *
 * ADR 0114 stated its own limitation in plain words: `sealed: true` was "an
 * assertion by an authenticated manager … not a cryptographic proof of the
 * gesture", so anything holding that session could spend the house's money by
 * setting a boolean. The founder closed it on 2026-09-04 with
 * challenge-and-redeem, and this file asserts each half.
 *
 *   issue     — a token is minted for one manager, one server, one tool and one
 *               set of arguments, and is returned exactly once.
 *   redeem    — the write carries it back and it is spent.
 *   replay    — the same token a second time is refused.
 *   expiry    — a token past its deadline is refused.
 *   mismatch  — a different actor, a different tool, or different arguments is
 *               refused, each in its own words.
 *
 * And one thing that is not a refusal: every one of those refusals is FILED in
 * `mcp_tool_calls` before it throws. A refused seal is exactly the event an
 * incident review is opened for, and a log holding only the calls that went
 * through would omit it.
 */

import { ForbiddenException } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { McpRuntimeService } from "../mcp-runtime/mcp-runtime.service";
import { McpSecretService } from "../mcp-runtime/mcp-secret.service";
import { McpConnectionsService } from "./mcp-connections.service";
import { hashCallArgs, hashSealToken } from "../mcp-runtime/seal-challenge";

const CONNECTION_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const OTHER_CONNECTION = "dddddddd-4444-4444-8444-dddddddddddd";
const RESTAURANT = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const MANAGER = "cccccccc-3333-4333-8333-cccccccccccc";

interface SealRow {
  id: string;
  connection_id: string;
  actor_user_id: string;
  tool_name: string;
  args_hash: string;
  token_hash: string;
  expires_at: string;
  redeemed_at: string | null;
}

interface Fixture {
  seals?: SealRow[];
  grant?: Record<string, unknown> | null;
  consent?: Record<string, unknown> | null;
}

interface Recorder {
  db: DatabaseService;
  calls: Record<string, unknown>[];
  sealInserts: Record<string, unknown>[];
  redeemed: string[];
}

function buildDb(fixture: Fixture): Recorder {
  const calls: Record<string, unknown>[] = [];
  const sealInserts: Record<string, unknown>[] = [];
  const redeemed: string[] = [];
  const seals = fixture.seals ?? [];

  const chain = (result: { data: unknown; error: null }) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "ilike", "in", "order", "update"]) {
      self[m] = () => self;
    }
    self.maybeSingle = () => Promise.resolve(result);
    self.single = () => Promise.resolve(result);
    self.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve);
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
                probe_tools: [
                  {
                    name: "place_order",
                    title: null,
                    description: null,
                    annotations: { readOnlyHint: false },
                  },
                ],
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
            ...chain({ data: [], error: null }),
            insert: (row: Record<string, unknown>) => {
              calls.push(row);
              return Promise.resolve({ data: null, error: null });
            },
          };
        }
        if (table === "mcp_seal_challenges") {
          const api: Record<string, unknown> = {};
          let tokenHash: string | null = null;
          let rowId: string | null = null;
          for (const m of ["select", "is", "ilike", "in", "order"]) {
            api[m] = () => api;
          }
          api.eq = (col: string, value: string) => {
            if (col === "token_hash") tokenHash = value;
            if (col === "id") rowId = value;
            return api;
          };
          api.maybeSingle = () =>
            Promise.resolve({
              data: seals.find((s) => s.token_hash === tokenHash) ?? null,
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
              const row = seals.find((sl) => sl.id === rowId);
              // The whole point of the redeeming UPDATE: `redeemed_at IS NULL`
              // is in its own filter, so a token already spent matches nothing.
              if (!row || (unspentOnly && row.redeemed_at)) {
                return { data: [], error: null };
              }
              row.redeemed_at = String(patch.redeemed_at);
              redeemed.push(row.id);
              return { data: [{ id: row.id }], error: null };
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
        if (table === "users") return chain({ data: [], error: null });
        return chain({ data: null, error: null });
      },
    },
  } as unknown as DatabaseService;

  return { db, calls, sealInserts, redeemed };
}

function build(fixture: Fixture, opts: { isManager?: boolean } = {}) {
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

const writeGrant = {
  id: "g-1",
  connection_id: CONNECTION_ID,
  tool_name: "place_order",
  writes: true,
  declared_read: false,
  revoked_at: null,
  needs_reconsent_at: null,
  needs_reconsent_reason: null,
};

const ARGS = { bottles: 6, wine: "Kalecik Karasi" };

function seal(over: Partial<SealRow> & { token: string }): SealRow {
  return {
    id: "seal-1",
    connection_id: CONNECTION_ID,
    actor_user_id: MANAGER,
    tool_name: "place_order",
    args_hash: hashCallArgs(ARGS),
    token_hash: hashSealToken(over.token),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    redeemed_at: null,
    ...over,
  };
}

/* ── issue ──────────────────────────────────────────────────────────────── */

describe("issuing a seal", () => {
  it("mints a token bound to the actor, the server, the tool and the arguments", async () => {
    const { service, recorder } = build({ grant: writeGrant });

    const issued = await service.issueSealChallenge(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "place_order",
      ARGS,
    );

    expect(issued.challenge).toHaveLength(64);
    expect(recorder.sealInserts).toHaveLength(1);
    expect(recorder.sealInserts[0]).toMatchObject({
      connection_id: CONNECTION_ID,
      actor_user_id: MANAGER,
      tool_name: "place_order",
      args_hash: hashCallArgs(ARGS),
      token_hash: hashSealToken(issued.challenge),
    });
    // The token itself is never stored — only its hash.
    expect(JSON.stringify(recorder.sealInserts[0])).not.toContain(
      issued.challenge,
    );
    expect(new Date(issued.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to seal a tool that is not granted", async () => {
    const { service, recorder } = build({ grant: null });
    await expect(
      service.issueSealChallenge(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS),
    ).rejects.toThrow(/nothing to seal/i);
    expect(recorder.sealInserts).toHaveLength(0);
  });

  it("refuses to seal a grant that is suspended pending re-consent", async () => {
    const { service } = build({
      grant: {
        ...writeGrant,
        needs_reconsent_at: "2026-09-04T09:00:00.000Z",
        needs_reconsent_reason: "the server changed readOnlyHint true to false",
      },
    });
    await expect(
      service.issueSealChallenge(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS),
    ).rejects.toThrow(/readOnlyHint true to false/);
  });

  it("refuses a non-manager, at the moment of issue", async () => {
    const { service, recorder } = build({ grant: writeGrant }, { isManager: false });
    await expect(
      service.issueSealChallenge(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS),
    ).rejects.toThrow(/managers and owners/i);
    expect(recorder.sealInserts).toHaveLength(0);
  });
});

/* ── redeem, and every way it does not ──────────────────────────────────── */

describe("redeeming a seal", () => {
  const token = "f".repeat(64);

  it("runs the write and marks the call PROVEN", async () => {
    const { service, runtime, recorder } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [seal({ token })],
    });

    const result = await service.callTool(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "place_order",
      ARGS,
      true,
      token,
    );

    expect(runtime.callTool).toHaveBeenCalled();
    expect(result.sealProof).toBe("proven");
    expect(recorder.redeemed).toEqual(["seal-1"]);
    expect(recorder.calls.at(-1)).toMatchObject({
      sealed: true,
      seal_proof: "proven",
      outcome: "ok",
    });
  });

  it("refuses a write that carries NO challenge, however loudly it claims the seal", async () => {
    const { service, runtime, recorder } = build({
      consent: liveConsent,
      grant: writeGrant,
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, null),
    ).rejects.toThrow(/proven rather than asserted/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
    // Filed, not silent.
    expect(recorder.calls.at(-1)).toMatchObject({
      outcome: "refused",
      seal_proof: "asserted",
    });
  });

  it("refuses a REPLAY of a seal already spent", async () => {
    const spent = seal({ token, redeemed_at: "2026-09-04T09:59:00.000Z" });
    const { service, runtime, recorder } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [spent],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, token),
    ).rejects.toThrow(/already been spent/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
    expect(recorder.calls.at(-1)).toMatchObject({ outcome: "refused" });
  });

  it("refuses an EXPIRED seal", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [seal({ token, expires_at: new Date(Date.now() - 1000).toISOString() })],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, token),
    ).rejects.toThrow(/expired/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a seal issued to a DIFFERENT actor", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [seal({ token, actor_user_id: "somebody-else" })],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, token),
    ).rejects.toThrow(/issued to somebody else/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a seal issued for a DIFFERENT tool, and names both", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [seal({ token, tool_name: "list_checks" })],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, token),
    ).rejects.toThrow(/issued for "list_checks", not for "place_order"/);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a seal issued for a DIFFERENT server", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [seal({ token, connection_id: OTHER_CONNECTION })],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, token),
    ).rejects.toThrow(/different server/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses when the ARGUMENTS changed after the seal was issued", async () => {
    // The substitution the assertion model had no way to see: approve six
    // bottles, send six hundred.
    const { service, runtime } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [seal({ token })],
    });

    await expect(
      service.callTool(
        RESTAURANT,
        MANAGER,
        CONNECTION_ID,
        "place_order",
        { ...ARGS, bottles: 600 },
        true,
        token,
      ),
    ).rejects.toThrow(/arguments changed after the seal was issued/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("refuses a token this house never issued", async () => {
    const { service, runtime } = build({
      consent: liveConsent,
      grant: writeGrant,
      seals: [],
    });

    await expect(
      service.callTool(RESTAURANT, MANAGER, CONNECTION_ID, "place_order", ARGS, true, token),
    ).rejects.toThrow(/not one this house issued/i);
    expect(runtime.callTool).not.toHaveBeenCalled();
  });

  it("does not ask a READ for a seal at all", async () => {
    const { service, runtime, recorder } = build({
      consent: liveConsent,
      grant: {
        ...writeGrant,
        tool_name: "list_checks",
        writes: false,
        declared_read: true,
      },
    });

    const result = await service.callTool(
      RESTAURANT,
      MANAGER,
      CONNECTION_ID,
      "list_checks",
      {},
      false,
      null,
    );

    expect(runtime.callTool).toHaveBeenCalled();
    expect(result.sealProof).toBeNull();
    expect(recorder.calls.at(-1)).toMatchObject({ seal_proof: null });
  });
});
