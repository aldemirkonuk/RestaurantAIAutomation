import { DatabaseService } from "../../database/database.service";
import { RawMailRetentionService } from "./raw-mail-retention.service";
import type { HouseMailArchiveService } from "../archive/house-mail-archive.service";

/**
 * REVOKING A GRANT DELETES EVERY ROW IT FILED (ADR 0118; `gmail_read_all`).
 *
 * A vendor row stays as a tombstone, because the order it answered keeps the
 * facts. A team or guest row has no order and no vendor: it is deleted whole,
 * with its attachment rows (ON DELETE CASCADE). Both kinds are found by the
 * same `mirrored_by_grant_id = <this grant>` scope, and a row whose kind could
 * not be read is not deleted by guessing.
 */

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

function build(
  kinds: Array<{ id: string; kind: string }> | { error: { message: string } },
  vendorOnlyReader: boolean | "unreadable" = false,
) {
  const updates: Array<{ table: string; body: Record<string, unknown>; ids: string[] }> = [];
  const deletes: Array<{ table: string; ids: string[] }> = [];
  const from = (table: string) => {
    let mode: "select" | "update" | "delete" = "select";
    let body: Record<string, unknown> = {};
    let ids: string[] = [];
    let columns = "";
    const b: any = {};
    for (const m of ["eq", "is", "not", "order", "limit"]) b[m] = () => b;
    b.select = (c: string) => {
      columns = c;
      return b;
    };
    b.in = (_col: string, v: string[]) => {
      ids = v;
      return b;
    };
    b.update = (x: Record<string, unknown>) => {
      mode = "update";
      body = x;
      return b;
    };
    b.insert = () => b;
    b.delete = () => {
      mode = "delete";
      return b;
    };
    b.then = (resolve: (v: unknown) => unknown) => {
      if (table === "procurement_conversations") {
        if (mode === "update") updates.push({ table, body, ids });
        if (mode === "delete") deletes.push({ table, ids });
        if (mode === "select" && columns.includes("restaurant_id")) {
          return Promise.resolve({
            data: [{ id: "v1", restaurant_id: HOUSE }, { id: "g1", restaurant_id: HOUSE }, { id: "t1", restaurant_id: HOUSE }],
            error: null,
          }).then(resolve);
        }
        if (mode === "select") {
          return Promise.resolve(
            Array.isArray(kinds) ? { data: kinds, error: null } : { data: null, error: kinds.error },
          ).then(resolve);
        }
        return Promise.resolve({ data: ids.map((id) => ({ id })), error: null }).then(resolve);
      }
      if (table === "integration_oauth_connections") {
        if (vendorOnlyReader === "unreadable") {
          return Promise.resolve({ data: null, error: { message: "timeout" } }).then(resolve);
        }
        return Promise.resolve({ data: vendorOnlyReader ? [{ id: "ro" }] : [], error: null }).then(resolve);
      }
      return Promise.resolve({ data: [], error: null }).then(resolve);
    };
    return b;
  };
  const db = {
    supabase: {
      from,
      storage: { from: () => ({ remove: () => Promise.resolve({ data: null, error: null }) }) },
    },
  } as unknown as DatabaseService;
  return { db, updates, deletes };
}

const noArchive = {
  settingsFor: async () => ({ armed: false, mode: "off" }),
  runExport: async () => ({ exported: 0, failed: 0, considered: 0 }),
} as unknown as HouseMailArchiveService;

describe("sweepForRevokedGrant with the wider grant's rows", () => {
  it("with ALL mail reading revoked, tombstones the vendor row and deletes the team and guest rows whole", async () => {
    const { db, updates, deletes } = build([
      { id: "v1", kind: "vendor" },
      { id: "g1", kind: "guest" },
      { id: "t1", kind: "team" },
    ]);
    const service = new RawMailRetentionService(db, undefined, noArchive);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: null,
      integrationId: "gmail_read_all",
    });

    expect(deletes).toEqual([{ table: "procurement_conversations", ids: ["g1", "t1"] }]);
    const tomb = updates.find((u) => u.table === "procurement_conversations")!;
    expect(tomb.ids).toEqual(["v1"]);
    expect(String(tomb.body.message_text)).toMatch(/was deleted on/);
    expect(run.deleted).toBe(3);
  });

  it("deletes nothing by guessing when the kinds cannot be read, and says so", async () => {
    const { db, updates, deletes } = build({ error: { message: "timeout" } });
    const service = new RawMailRetentionService(db, undefined, noArchive);

    const run = await service.sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: null,
    });

    expect(deletes).toHaveLength(0);
    expect(updates.filter((u) => u.table === "procurement_conversations")).toHaveLength(0);
    expect(run.deleted).toBe(0);
    expect(run.error).toMatch(/NOT deleted/);
  });
});

describe("revoking the wide reading while the vendor-only reading stays consented", () => {
  const kinds = [
    { id: "v1", kind: "vendor" },
    { id: "g1", kind: "guest" },
    { id: "t1", kind: "team" },
  ];
  const run = (service: RawMailRetentionService, integrationId?: string) =>
    service.sweepForRevokedGrant({ connectionId: GRANT, restaurantId: HOUSE, ownerUserId: null, integrationId });

  it("deletes team and guest rows whole and leaves the vendor row untouched", async () => {
    const { db, updates, deletes } = build(kinds, true);
    const out = await run(new RawMailRetentionService(db, undefined, noArchive), "gmail_read_all");
    expect(deletes).toEqual([{ table: "procurement_conversations", ids: ["g1", "t1"] }]);
    expect(updates.filter((u) => u.table === "procurement_conversations")).toHaveLength(0);
    expect(out.deleted).toBe(2);
    expect(out.says).toMatch(/1 vendor reply was kept/);
  });

  it("falls back to tombstoning vendor rows when the vendor-only standing cannot be read", async () => {
    const { db, updates } = build(kinds, "unreadable");
    await run(new RawMailRetentionService(db, undefined, noArchive), "gmail_read_all");
    expect(updates.find((u) => u.table === "procurement_conversations")!.ids).toEqual(["v1"]);
  });

  it("revoking the vendor-only reading itself is unchanged: its vendor rows are tombstoned", async () => {
    const { db, updates } = build(kinds, true);
    await run(new RawMailRetentionService(db, undefined, noArchive), "gmail_read");
    expect(updates.find((u) => u.table === "procurement_conversations")!.ids).toEqual(["v1"]);
  });
});
