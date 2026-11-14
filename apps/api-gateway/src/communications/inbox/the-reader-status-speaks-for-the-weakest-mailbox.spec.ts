/**
 * The reader's status line speaks for the weakest mailbox, and names it
 * (r36 mail audit, gap 3).
 *
 * `statusFor` used to take `rows.find(...)` over an unordered read of the
 * house's reading grants. With two of them the line reported whichever came
 * back first, so a failing mailbox could hide behind a working one, and two
 * polls could name two different mailboxes. Now the grants are read in a
 * fixed order, every cursor is read, and the line speaks for the mailbox that
 * needs a person: a failing read first, then one never read, then the one
 * read longest ago. It names that mailbox by the address its grant recorded.
 *
 * The fake database below filters on eq / in / is and honours order, so a
 * read that drops the house filter, the scope check or the cursor join
 * answers wrongly and fails here.
 */

import { HouseInboxService } from "./house-inbox.service";
import { GMAIL_READ_SCOPE } from "./house-inbox-flag";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, unknown>;
type Table = { rows?: Row[]; error?: { message: string } };

function fakeDb(tables: Record<string, Table>) {
  const from = (table: string) => {
    const spec = tables[table] ?? { rows: [] };
    const filters: Array<(r: Row) => boolean> = [];
    const orders: Array<[string, boolean]> = [];
    const result = () => {
      if (spec.error) return { data: null, error: spec.error };
      let rows = (spec.rows ?? []).filter((r) => filters.every((f) => f(r)));
      for (const [col, asc] of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = String(a[col] ?? "");
          const y = String(b[col] ?? "");
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      return { data: rows, error: null };
    };
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, v: unknown) => {
      filters.push((r) => r[col] === v);
      return q;
    };
    q.is = (col: string, v: unknown) => {
      filters.push((r) => (r[col] ?? null) === v);
      return q;
    };
    q.in = (col: string, vs: unknown[]) => {
      filters.push((r) => vs.includes(r[col]));
      return q;
    };
    q.order = (col: string, o?: { ascending?: boolean }) => {
      orders.push([col, o?.ascending !== false]);
      return q;
    };
    q.maybeSingle = () => {
      const { data, error } = result();
      return Promise.resolve({ data: data?.[0] ?? null, error });
    };
    q.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return q;
  };
  return { client: { from } };
}

const grant = (id: string, at: string, email: string | null, over: Row = {}): Row => ({
  id,
  user_id: `u-${id}`,
  restaurant_id: HOUSE,
  integration_id: "gmail_read",
  scopes: [GMAIL_READ_SCOPE],
  account_email: email,
  connected_at: at,
  revoked_at: null,
  ...over,
});

const cursor = (id: string, lastReadAt: string | null, lastError: string | null = null): Row => ({
  connection_id: id,
  started_at: "2026-11-01T00:00:00Z",
  last_read_at: lastReadAt,
  last_error: lastError,
});

function status(grants: Row[], cursors: Row[] | Table, flagOn = true) {
  const db = fakeDb({
    restaurant_feature_flags: {
      rows: [{ restaurant_id: HOUSE, flag_name: "settings", enable_house_inbox_read: flagOn }],
    },
    integration_oauth_connections: { rows: grants },
    house_inbox_cursors: Array.isArray(cursors) ? { rows: cursors } : cursors,
  });
  const svc = new HouseInboxService(db as any, {} as any, {} as any, {} as any);
  return svc.statusFor(HOUSE);
}

const A = grant("g-a", "2026-11-01T09:00:00Z", "office@house.test");
const B = grant("g-b", "2026-11-02T09:00:00Z", "manager@house.test");

describe("the reader status speaks for the weakest mailbox", () => {
  it("one mailbox: names it and reports its cursor", async () => {
    const s = await status([A], [cursor("g-a", "2026-11-13T09:00:00Z")]);
    expect(s).toMatchObject({
      granted: true,
      mailbox: "office@house.test",
      mailboxes: 1,
      lastReadAt: "2026-11-13T09:00:00Z",
      lastError: null,
      grantOwnerUserId: "u-g-a",
    });
  });

  it("a failing mailbox is never hidden by a working one, whichever comes back first", async () => {
    // Read more recently than the working one: only the error puts it first.
    const failing = cursor("g-b", "2026-11-13T10:00:00Z", "invalid_grant: Token has been expired or revoked.");
    for (const order of [[A, B], [B, A]]) {
      const s = await status(order, [cursor("g-a", "2026-11-13T09:00:00Z"), failing]);
      expect(s.mailbox).toBe("manager@house.test");
      expect(s.lastError).toContain("invalid_grant");
      expect(s.mailboxes).toBe(2);
    }
  });

  it("a mailbox never read speaks before one that is read", async () => {
    const s = await status([A, B], [cursor("g-a", "2026-11-13T09:00:00Z")]);
    expect(s.mailbox).toBe("manager@house.test");
    expect(s.lastReadAt).toBeNull();
    expect(s.lastError).toBeNull();
  });

  it("of two working mailboxes, the one read longest ago speaks", async () => {
    const s = await status([A, B], [cursor("g-a", "2026-11-13T09:00:00Z"), cursor("g-b", "2026-11-12T09:00:00Z")]);
    expect(s.mailbox).toBe("manager@house.test");
    expect(s.lastReadAt).toBe("2026-11-12T09:00:00Z");
  });

  it("a tie goes to the oldest grant, so two polls name the same mailbox", async () => {
    const same = "2026-11-13T09:00:00Z";
    for (const order of [[A, B], [B, A]]) {
      const s = await status(order, [cursor("g-a", same), cursor("g-b", same)]);
      expect(s.mailbox).toBe("office@house.test");
    }
  });

  it("only this house's live reading grants count", async () => {
    const elsewhere = grant("g-x", "2026-10-01T09:00:00Z", "x@other.test", { restaurant_id: OTHER });
    const revoked = grant("g-r", "2026-10-02T09:00:00Z", "old@house.test", { revoked_at: "2026-11-01T00:00:00Z" });
    const noScope = grant("g-n", "2026-10-03T09:00:00Z", "drive@house.test", { scopes: ["https://www.googleapis.com/auth/drive.file"] });
    const s = await status([elsewhere, revoked, noScope, A], [
      cursor("g-x", null, "boom"),
      cursor("g-r", null, "boom"),
      cursor("g-n", null, "boom"),
      cursor("g-a", "2026-11-13T09:00:00Z"),
    ]);
    expect(s).toMatchObject({ mailbox: "office@house.test", mailboxes: 1, lastError: null });
  });

  it("no reading grant: not granted, no mailbox", async () => {
    expect(await status([], [])).toMatchObject({ granted: false, mailbox: null, mailboxes: 0 });
  });

  it("a grant that recorded no address is named as null, never a blank", async () => {
    const s = await status([grant("g-a", "2026-11-01T09:00:00Z", "  ")], [cursor("g-a", "2026-11-13T09:00:00Z")]);
    expect(s.mailbox).toBeNull();
  });

  it("an unreadable cursor table is said, never read as 'never read'", async () => {
    const s = await status([A, B], { error: { message: "timeout" } });
    expect(s.granted).toBe(true);
    expect(s.lastError).toContain("timeout");
    // Two mailboxes and no cursor: which one is weakest is not known.
    expect(s.mailbox).toBeNull();
    expect(s.mailboxes).toBe(2);
  });
});
