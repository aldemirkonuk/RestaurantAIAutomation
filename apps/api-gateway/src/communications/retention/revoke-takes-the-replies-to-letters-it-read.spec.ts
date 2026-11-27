import { DatabaseService } from "../../database/database.service";
import { RawMailRetentionService } from "./raw-mail-retention.service";

/**
 * Revoking the wide reading deletes the house's own replies to the letters that
 * grant read (r107, DD-r106-6 / DD-r107-9). A reply is filed under the person it
 * answered but was never mirrored, so no grant stamp finds it. It goes by
 * PROVENANCE: its `email_headers.answers` (or `in_reply_to`) names a letter whose
 * `mirrored_by_grant_id` is the revoked grant. Never by thread kind: a
 * mislabelled vendor thread must survive.
 *
 * An in-memory table that really applies eq / in / is / range, including the
 * `column->>key` paths, so a guard removed from the service changes what is
 * left in it.
 */

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";

type Row = Record<string, any>;

function world(opts: { rows: Row[]; connections?: Row[]; failRepliesRead?: boolean }) {
  const tables: Record<string, Row[]> = {
    procurement_conversations: opts.rows,
    integration_oauth_connections: opts.connections ?? [],
  };
  const val = (r: Row, c: string) => {
    const [head, key] = c.split("->>");
    return key ? (r[head] ?? {})[key] : r[c];
  };
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: "select" | "update" | "delete" = "select";
    let body: Row = {};
    let range: [number, number] | null = null;
    let jsonIn = false;
    let ordered = false;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => (filters.push((r) => val(r, c) === v), b);
    b.in = (c: string, v: unknown[]) => {
      if (c.includes("->>")) jsonIn = true;
      filters.push((r) => v.includes(val(r, c)));
      return b;
    };
    b.is = (c: string, v: null) => (filters.push((r) => (val(r, c) ?? null) === v), b);
    b.not = (c: string, _op: string, v: null) => (filters.push((r) => (val(r, c) ?? null) !== v), b);
    b.limit = () => b;
    b.order = () => ((ordered = true), b);
    b.range = (a: number, z: number) => ((range = [a, z]), b);
    b.insert = () => b;
    b.update = (x: Row) => ((mode = "update"), (body = x), b);
    b.delete = () => ((mode = "delete"), b);
    b.then = (resolve: (v: unknown) => unknown) => {
      const rows = tables[table] ?? [];
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (opts.failRepliesRead && table === "procurement_conversations" && mode === "select" && jsonIn) {
        return Promise.resolve({ data: null, error: { message: "timeout" } }).then(resolve);
      }
      if (mode === "update") hit.forEach((r) => Object.assign(r, body));
      if (mode === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
      if (ordered) hit = [...hit].sort((x, y) => String(x.id).localeCompare(String(y.id)));
      if (range) hit = hit.slice(range[0], range[1] + 1);
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
  message_id: null,
  email_headers: {},
  ...over,
});
const reply = (id: string, answers: string | null, over: Row = {}): Row =>
  row(id, {
    kind: "guest",
    direction: "outbound",
    status: "SENT",
    email_headers: answers ? { answers } : {},
    ...over,
  });

const rows = () => [
  row("guest-in", { kind: "guest", mirrored_by_grant_id: GRANT, message_id: "<g1@mail>" }),
  row("vendor-in", { kind: "vendor" }),
  reply("guest-reply", "guest-in"),
  reply("guest-reply-by-header", null, { email_headers: { in_reply_to: "<g1@mail>" } }),
  reply("guest-queued", "guest-in", { status: "HOUSE_QUEUED" }),
  // A vendor thread a mislabel filed as guest: it answers a letter this grant never read.
  reply("mislabelled-vendor-reply", "vendor-in"),
  reply("vendor-reply", "vendor-in", { kind: "vendor" }),
  reply("unlinked-reply", null),
  reply("other-house-reply", "guest-in", { restaurant_id: "other" }),
];
const left = (t: Record<string, Row[]>) => t.procurement_conversations.map((r) => r.id);
const revoke = (db: DatabaseService, integrationId = "gmail_read_all") =>
  new RawMailRetentionService(db).sweepForRevokedGrant({
    connectionId: GRANT,
    restaurantId: HOUSE,
    ownerUserId: null,
    integrationId,
  });

describe("revoking gmail_read_all and the replies to the letters it read", () => {
  it("deletes a reply to a letter the grant read, by id and by Message-ID, whatever its status", async () => {
    const { db, tables } = world({ rows: rows() });
    await revoke(db);
    const kept = left(tables);
    for (const gone of ["guest-in", "guest-reply", "guest-reply-by-header", "guest-queued"]) {
      expect(kept).not.toContain(gone);
    }
  });

  it("keeps a vendor thread a mislabel filed as guest, a vendor reply, an unlinked reply and another house's", async () => {
    const { db, tables } = world({ rows: rows() });
    await revoke(db);
    expect(left(tables).sort()).toEqual(
      ["mislabelled-vendor-reply", "other-house-reply", "unlinked-reply", "vendor-in", "vendor-reply"].sort(),
    );
    const mislabelled = tables.procurement_conversations.find((r) => r.id === "mislabelled-vendor-reply")!;
    expect(mislabelled.raw_deleted_at).toBeNull();
  });

  it("says how many replies named no letter and were kept", async () => {
    const { db } = world({ rows: rows() });
    const run = await revoke(db);
    expect(run.says).toMatch(/1 sent reply to a team member or a guest name no letter they answer, so it was kept/);
  });

  it("a second live wide grant does not save a reply to a letter the revoked grant read", async () => {
    const { db, tables } = world({
      rows: rows(),
      connections: [{ id: "second", restaurant_id: HOUSE, integration_id: "gmail_read_all", revoked_at: null }],
    });
    await revoke(db);
    expect(left(tables)).not.toContain("guest-reply");
    expect(left(tables)).not.toContain("guest-in");
  });

  it("deletes all of 1,001 replies, past the 1,000-row read cap", async () => {
    const many = Array.from({ length: 1001 }, (_, i) => reply(`bulk-${String(i).padStart(4, "0")}`, "guest-in"));
    const { db, tables } = world({ rows: [row("guest-in", { kind: "guest", mirrored_by_grant_id: GRANT }), ...many] });
    await revoke(db);
    expect(left(tables).filter((id) => id.startsWith("bulk-"))).toEqual([]);
  });

  it("revoking the vendor-only reading does not take the replies", async () => {
    const { db, tables } = world({ rows: rows() });
    await revoke(db, "gmail_read");
    expect(left(tables)).toContain("guest-reply");
  });

  it("says when the replies could not be read, and deletes nothing it could not name", async () => {
    const { db, tables } = world({ rows: rows(), failRepliesRead: true });
    const run = await revoke(db);
    expect(run.error).toMatch(/replies to the letters this connection read could NOT be read/);
    expect(left(tables)).toContain("guest-reply");
  });

  describe("the house's reply to a VENDOR letter the wide grant also read", () => {
    const vendorWorld = () => [
      row("vendor-v", { kind: "vendor", mirrored_by_grant_id: GRANT, message_id: "<v1@mail>" }),
      row("reply-r", {
        kind: "vendor",
        direction: "outbound",
        status: "SENT",
        message_text: "the house's own words to the vendor",
        email_headers: { answers: "vendor-v" },
      }),
    ];
    const standing = [{ id: "vendor-only", restaurant_id: HOUSE, integration_id: "gmail_read", revoked_at: null }];

    it("is left untouched and unstamped while the vendor-only reading is live", async () => {
      const { db, tables } = world({ rows: vendorWorld(), connections: standing });
      const run = await revoke(db);
      const r = tables.procurement_conversations.find((x) => x.id === "reply-r")!;
      expect(r.mirrored_by_grant_id).toBeNull();
      expect(r.raw_deleted_at).toBeNull();
      expect(r.message_text).toBe("the house's own words to the vendor");
      expect(run.says).toMatch(/\b1 vendor reply was kept/);
    });

    it("is left untouched when no vendor-only reading is live", async () => {
      const { db, tables } = world({ rows: vendorWorld() });
      await revoke(db);
      const r = tables.procurement_conversations.find((x) => x.id === "reply-r")!;
      expect(r.raw_deleted_at).toBeNull();
      expect(r.message_text).toBe("the house's own words to the vendor");
      expect(r.email_headers).toEqual({ answers: "vendor-v" });
    });
  });
});
