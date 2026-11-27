import { DatabaseService } from "../../database/database.service";
import { HouseMailArchiveService } from "../archive/house-mail-archive.service";
import { RawMailRetentionService } from "./raw-mail-retention.service";

/**
 * Revoking the wide reading deletes the house's own SENT replies to team
 * members and guests too (r106, DD-r105-7). They are filed under the person
 * (kind team|guest) but were never mirrored, so no grant stamp finds them.
 *
 * Every state goes (queued, sending, failed, draft, sent): a letter still queued
 * would be sent after the reading was withdrawn, the dispatcher never checks the
 * grant. The window sweep takes them too, on the letter's own clock.
 *
 * An in-memory table that really applies eq / in / is / range and the API's own
 * limits (a response caps at 1000 rows, a long `.in()` list is refused), so a
 * guard removed from the service changes what is left in it.
 */

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

type Row = Record<string, unknown>;

const MAX_ROWS = 1000; // supabase/config.toml max_rows
const MAX_IN = 500; // a longer list makes a request URL the API refuses

function world(opts: {
  rows: Row[];
  connections?: Row[];
  failRepliesRead?: boolean;
  windows?: Row[];
}) {
  const tables: Record<string, Row[]> = {
    procurement_conversations: opts.rows,
    integration_oauth_connections: opts.connections ?? [],
    house_mail_retention_windows: opts.windows ?? [],
    house_mail_retention_sweeps: [],
    conversation_attachments: [],
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "delete" = "select";
    let body: Row = {};
    let columns = "";
    let tooLong = false;
    let page: [number, number] | null = null;
    const b: any = {};
    b.select = (c: string) => ((columns = c), b);
    b.eq = (c: string, v: unknown) => (filters.push((r) => r[c] === v), b);
    b.in = (c: string, v: unknown[]) => {
      if (v.length > MAX_IN) tooLong = true;
      filters.push((r) => v.includes(r[c]));
      return b;
    };
    b.is = (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), b);
    b.not = (c: string, _op: string, v: null) => (filters.push((r) => (r[c] ?? null) !== v), b);
    b.limit = () => b;
    b.order = () => b;
    b.range = (a: number, z: number) => ((page = [a, z]), b);
    b.insert = (x: Row) => {
      tables[table] = [...(tables[table] ?? []), x];
      return b;
    };
    b.update = (x: Row) => ((mode = "update"), (body = x), b);
    b.delete = () => ((mode = "delete"), b);
    b.then = (resolve: (v: unknown) => unknown) => {
      const rows = tables[table] ?? [];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (
        opts.failRepliesRead &&
        table === "procurement_conversations" &&
        mode === "select" &&
        columns.startsWith("id, sent_at")
      ) {
        return Promise.resolve({ data: null, error: { message: "timeout" } }).then(resolve);
      }
      if (tooLong) {
        return Promise.resolve({ data: null, error: { message: "URI too long" } }).then(resolve);
      }
      if (mode === "update") hit.forEach((r) => Object.assign(r, body));
      if (mode === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
      let out = hit;
      if (mode === "select") {
        const [a, z] = page ?? [0, MAX_ROWS - 1];
        out = hit.slice(a, Math.min(z + 1, a + MAX_ROWS));
      }
      return Promise.resolve({ data: out.map((r) => ({ ...r })), error: null }).then(resolve);
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
  sent_at: null,
  created_at: "2026-11-01T00:00:00.000Z",
  raw_deleted_at: null,
  mirrored_by_grant_id: null,
  ...over,
});

const rows = () => [
  row("guest-in", { kind: "guest", mirrored_by_grant_id: GRANT }),
  row("guest-reply", { kind: "guest", direction: "outbound", status: "SENT" }),
  row("team-reply", { kind: "team", direction: "outbound", status: "SENT" }),
  row("guest-queued", { kind: "guest", direction: "outbound", status: "HOUSE_QUEUED" }),
  row("guest-sending", { kind: "guest", direction: "outbound", status: "HOUSE_SENDING" }),
  row("team-failed", { kind: "team", direction: "outbound", status: "HOUSE_FAILED" }),
  row("guest-draft", { kind: "guest", direction: "outbound", status: "HOUSE_DRAFT" }),
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
  it("deletes a reply to a guest or a team member in every state, and keeps a vendor reply and another house's", async () => {
    const { db, tables } = world({ rows: rows() });
    await revoke(db);
    // a queued or sending letter goes too: it would otherwise be sent after the
    // reading was withdrawn, and deleting the row is what cancels it
    expect(left(tables).sort()).toEqual(["other-house-reply", "vendor-reply"].sort());
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
    expect(run.error).toMatch(/replies to team members and guests could NOT be read/);
    expect(left(tables)).toContain("guest-reply");
  });
});

describe("a house with more replies than one response holds", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      row(`guest-${i}`, { kind: "guest", direction: "outbound", status: "SENT" }),
    );

  it("deletes all of 1,201 replies, none left and none tombstoned as a vendor's", async () => {
    const { db, tables } = world({ rows: [...many(1201), row("vendor-reply", { direction: "outbound", status: "SENT" })] });
    const run = await revoke(db);
    expect(run.error).toBeNull();
    expect(left(tables)).toEqual(["vendor-reply"]);
    expect(tables.procurement_conversations[0].raw_deleted_at).toBeNull();
  });
});

describe("the window sweep and the house's replies to people", () => {
  const archive = {
    settingsFor: async () => ({ mode: "none", armed: false, says: "" }),
    exportedAmong: async () => new Set<string>(),
  } as unknown as HouseMailArchiveService;
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const sweep = (db: DatabaseService) => new RawMailRetentionService(db, undefined, archive).sweepHouse(HOUSE);
  const wide = [{ id: "live", restaurant_id: HOUSE, integration_id: "gmail_read_all", revoked_at: null }];
  const windows = [{ restaurant_id: HOUSE, figure_days: 100, derived_at: days(0) }];

  it("deletes an expired reply to a guest and keeps a recent one, while a wide reading is on", async () => {
    const { db, tables } = world({
      windows,
      connections: wide,
      rows: [
        row("guest-old", { kind: "guest", direction: "outbound", status: "SENT", sent_at: days(200), created_at: days(200) }),
        row("team-old-unsent", { kind: "team", direction: "outbound", status: "HOUSE_FAILED", created_at: days(150) }),
        row("guest-recent", { kind: "guest", direction: "outbound", status: "SENT", sent_at: days(5), created_at: days(5) }),
        row("vendor-reply", { kind: "vendor", direction: "outbound", status: "SENT", sent_at: days(200), created_at: days(200) }),
      ],
    });
    const run = await sweep(db);
    expect(run.error).toBeNull();
    expect(left(tables).sort()).toEqual(["guest-recent", "vendor-reply"]);
  });

  it("leaves the replies alone when the house has no wide reading on", async () => {
    const { db, tables } = world({
      windows,
      rows: [row("guest-old", { kind: "guest", direction: "outbound", status: "SENT", sent_at: days(200), created_at: days(200) })],
    });
    await sweep(db);
    expect(left(tables)).toEqual(["guest-old"]);
  });
});
