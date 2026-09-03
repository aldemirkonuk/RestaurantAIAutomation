/**
 * McpConnectionsService — the register is real, and its failures are loud.
 *
 * The load-bearing assertion in this file is the FIRST one: a failed read
 * THROWS. Its neighbour, `integrations-oauth.service.ts:485-488`, logs the error
 * and returns `[]`, which is why `/profile` had to infer a broken register from
 * an empty array against a non-empty catalogue (gap G3). This module must never
 * acquire that shape, so the test is written against the behaviour rather than
 * the implementation: an errored query must not resolve to a list.
 */

import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { McpConnectionsService } from "./mcp-connections.service";
import { DatabaseService } from "../database/database.service";

type Result = { data: unknown; error: { message: string; code?: string } | null };

/**
 * A PostgREST-shaped builder. Every filter returns `this`; the call resolves
 * either through a terminator (`single`/`maybeSingle`) or by being awaited
 * directly (the list path ends on `.order()`).
 */
function builder(result: Result) {
  const self: Record<string, unknown> = {
    select: () => self,
    insert: () => self,
    update: () => self,
    delete: () => self,
    eq: () => self,
    is: () => self,
    order: () => self,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: Result) => unknown) => resolve(result),
  };
  return self;
}

function makeService(result: Result): McpConnectionsService {
  const db = { supabase: { from: () => builder(result) } };
  return new McpConnectionsService(db as unknown as DatabaseService);
}

const ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "House POS bridge",
  url: "https://mcp.house.example",
  scopes: ["inventory:read", "orders:read"],
  created_at: "2026-09-03T09:00:00.000Z",
  last_used_at: null,
  revoked_at: null,
};

describe("McpConnectionsService.list", () => {
  it("throws on a query error instead of returning an empty register", async () => {
    const service = makeService({
      data: null,
      error: { message: "connection reset" },
    });

    await expect(service.list("u1", "r1")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(service.list("u1", "r1")).rejects.toThrow(
      "The model-context register could not be read: connection reset",
    );
  });

  it("returns a genuinely empty register as an empty list", async () => {
    const service = makeService({ data: [], error: null });
    await expect(service.list("u1", "r1")).resolves.toEqual([]);
  });

  it("reports a never-called server's last call as null, not as its creation time", async () => {
    const service = makeService({ data: [ROW], error: null });
    const [row] = await service.list("u1", "r1");

    expect(row.lastUsedAt).toBeNull();
    expect(row.createdAt).toBe("2026-09-03T09:00:00.000Z");
    expect(row.status).toBe("active");
    expect(row.scopes).toEqual(["inventory:read", "orders:read"]);
  });

  it("marks a revoked server revoked rather than dropping it from the register", async () => {
    const service = makeService({
      data: [{ ...ROW, revoked_at: "2026-09-03T10:00:00.000Z" }],
      error: null,
    });
    const [row] = await service.list("u1", "r1");

    expect(row.status).toBe("revoked");
    expect(row.revokedAt).toBe("2026-09-03T10:00:00.000Z");
  });
});

describe("McpConnectionsService.create", () => {
  it("stores the declaration and hands back the row", async () => {
    const service = makeService({ data: ROW, error: null });
    const row = await service.create("u1", "r1", {
      name: "House POS bridge",
      url: "https://mcp.house.example",
      scopes: ["inventory:read", "orders:read"],
    });

    expect(row.id).toBe(ROW.id);
    expect(row.lastUsedAt).toBeNull();
  });

  it("turns the duplicate-name index into a conflict the operator can act on", async () => {
    const service = makeService({
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
    const service = makeService({ data: ROW, error: null });
    await expect(
      service.create("u1", "r1", { name: "   ", url: "https://x.example" }),
    ).rejects.toThrow("A server needs a name");
  });
});

describe("McpConnectionsService.revoke", () => {
  it("revokes a live server and returns it revoked", async () => {
    const service = makeService({
      data: { ...ROW, revoked_at: "2026-09-03T10:00:00.000Z" },
      error: null,
    });

    await expect(service.revoke("u1", "r1", ROW.id)).resolves.toMatchObject({
      status: "revoked",
    });
  });

  it("404s rather than reporting success when nothing matched", async () => {
    // The update is scoped by user AND restaurant AND `revoked_at is null`, so
    // "already revoked", "someone else's" and "does not exist" all arrive here
    // as no row. Reporting success would be the absence-as-health inversion:
    // the caller would be told a revoke happened that did not.
    const service = makeService({ data: null, error: null });

    await expect(service.revoke("u1", "r1", ROW.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws on a write error rather than swallowing it", async () => {
    const service = makeService({
      data: null,
      error: { message: "deadlock detected" },
    });

    await expect(service.revoke("u1", "r1", ROW.id)).rejects.toThrow(
      "The model-context server was not revoked: deadlock detected",
    );
  });
});
