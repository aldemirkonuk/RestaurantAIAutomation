import { DatabaseService } from "../../database/database.service";
import { RawMailRetentionService } from "./raw-mail-retention.service";

/**
 * Revoking the wide reading deletes the house's own SENT replies to team
 * members and guests too (r106, DD-r105-7). They are filed under the person
 * (kind team|guest) but were never mirrored, so no grant stamp finds them.
 *
 * An in-memory table that really applies eq / in / is, so a guard removed from
 * the service changes what is left in it.
 */

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

type Row = Record<string, unknown>;

function world(opts: { rows: Row[]; connections?: Row[]; failRepliesRead?: boolean }) {
  const tables: Record<string, Row[]> = {
    procurement_conversations: opts.rows,
    integration_oauth_connections: opts.connections ?? [],
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "delete" = "select";
    let body: Row = {};
    let columns = "";
    const b: any = {};
    b.select = (c: string) => ((columns = c), b);
    b.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b);
    b.is = (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), b);
    b.not = (c: string, _op: string, v: null) => (filters.push((r) => (r[c] ?? null) !== v), b);
    b.limit = () => b;
    b.order = () => b;
    b.insert = () => b;
    b.update = (x: Row) => ((mode = "update"), (body = x), b);
    b.delete = () => ((mode = "delete"), b);
    b.then = (resolve: (v: unknown) => unknown) => {
      const rows = tables[table] ?? [];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (
        opts.failRepliesRead &&
        table === "procurement_conversations" &&
        mode === "select" &&
        columns === "id" &&
        filters.length > 3
      ) {
        return Promise.resolve({ data: null, error: { message: "timeout" } }).then(resolve);
      }
      if (mode === "update") hit.forEach((r) => Object.assign(r, body));
      if (mode === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
      return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }).then(resolve);
    };
    return b;
  };
  const db = {
    supabase: {
      from,
      storage: { from: () => ({ remove: () => Promise.resolve({ data: null, error: null }) }) },
    },
  } as unknown as DatabaseService;
  return { db, tables };
}

const row = (id: string, over: Row): Row => ({
  id,
  restaurant_id: HOUSE,
  kind: "vendor",
  direction: "inbound",
  status: null,
  raw_deleted_at: null,
  mirrored_by_grant_id: null,
  ...over,
});

const rows = () => [
  row("guest-in", { kind: "guest", mirrored_by_grant_id: GRANT }),
  row("guest-reply", { kind: "guest", direction: "outbound", status: "SENT" }),
  row("team-reply", { kind: "team", direction: "outbound", status: "SENT" }),
  row("guest-queued", { kind: "guest", direction: "outbound", status: "HOUSE_QUEUED" }),
  row("vendor-reply", { kind: "vendor", direction: "outbound", status: "SENT" }),
  row("other-house-reply", { kind: "guest", direction: "outbound", status: "SENT", restaurant_id: "other" }),
];
const left = (t: Record<string, Row[]>) => t.procurement_conversations.map((r) => r.id);
const revoke = (db: DatabaseService) =>
  new RawMailRetentionService(db).sweepForRevokedGrant({
    connectionId: GRANT,
    restaurantId: HOUSE,
    ownerUserId: null,
    integrationId: "gmail_read_all",
  });

describe("revoking gmail_read_all and the house's sent replies to people", () => {
  it("deletes a sent reply to a guest or a team member, and keeps a vendor reply, a queued letter and another house's", async () => {
    const { db, tables } = world({ rows: rows() });
    await revoke(db);
    expect(left(tables).sort()).toEqual(["guest-queued", "other-house-reply", "vendor-reply"].sort());
    // a vendor reply is neither deleted nor tombstoned by this rule
    const vendor = tables.procurement_conversations.find((r) => r.id === "vendor-reply")!;
    expect(vendor.raw_deleted_at).toBeNull();
  });

  it("keeps the replies while another wide grant of the house is live", async () => {
    const { db, tables } = world({
      rows: rows(),
      connections: [{ id: "second", restaurant_id: HOUSE, integration_id: "gmail_read_all", revoked_at: null }],
    });
    await revoke(db);
    expect(left(tables)).toContain("guest-reply");
    expect(left(tables)).toContain("team-reply");
    expect(left(tables)).not.toContain("guest-in");
  });

  it("revoking the vendor-only reading does not take the replies", async () => {
    const { db, tables } = world({ rows: rows() });
    await new RawMailRetentionService(db).sweepForRevokedGrant({
      connectionId: GRANT,
      restaurantId: HOUSE,
      ownerUserId: null,
      integrationId: "gmail_read",
    });
    expect(left(tables)).toContain("guest-reply");
    expect(left(tables)).toContain("team-reply");
  });

  it("says when the replies could not be read, and deletes nothing it could not name", async () => {
    const { db, tables } = world({ rows: rows(), failRepliesRead: true });
    const run = await revoke(db);
    expect(run.error).toMatch(/sent replies to team members and guests could NOT be read/);
    expect(left(tables)).toContain("guest-reply");
  });
});
