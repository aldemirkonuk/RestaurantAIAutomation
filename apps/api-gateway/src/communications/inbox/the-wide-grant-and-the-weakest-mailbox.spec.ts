/**
 * The wider grant and the weakest-mailbox status line, on the tree where #2003
 * (newsletter bound) and #2007 (#1917 into #1760) have met (r104 mail-6).
 *
 * The r103 walk checked both by unit test only and never together. Here the
 * status line speaks for a `gmail_read_all` grant exactly as it does for a
 * `gmail_read` one: a failing wide mailbox is not hidden by a working narrow
 * one, a wide grant alone is named, and a revoked wide grant is not counted.
 * The reader's wide query itself (newsletters bounded out, a vendor in
 * Promotions still read) is pinned in house-inbox-reads-all.spec.ts, which runs
 * on this same tree.
 */

import { HouseInboxService } from "./house-inbox.service";
import { GMAIL_READ_SCOPE } from "./house-inbox-flag";

const HOUSE = "11111111-1111-4111-8111-111111111111";

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


const NARROW = grant("g-narrow", "2026-11-01T09:00:00Z", "office@house.test");
const WIDE = grant("g-wide", "2026-11-02T09:00:00Z", "owner@house.test", { integration_id: "gmail_read_all" });

describe("the status line and the wider grant (r104 mail-6)", () => {
  it("a wide grant alone is the house's reading mailbox and is named", async () => {
    const s = await status([WIDE], [cursor("g-wide", "2026-11-13T09:00:00Z")]);
    expect(s).toMatchObject({ granted: true, mailbox: "owner@house.test", mailboxes: 1, grantOwnerUserId: "u-g-wide" });
  });

  it("a failing wide mailbox is not hidden by a working narrow one", async () => {
    const s = await status(
      [NARROW, WIDE],
      [cursor("g-narrow", "2026-11-13T09:00:00Z"), cursor("g-wide", "2026-11-12T09:00:00Z", "Gmail said 401")],
    );
    expect(s).toMatchObject({ mailbox: "owner@house.test", mailboxes: 2, lastError: "Gmail said 401" });
  });

  it("a revoked wide grant no longer speaks for the house", async () => {
    const revoked = { ...WIDE, revoked_at: "2026-11-14T00:00:00Z" };
    const s = await status([NARROW, revoked], [cursor("g-narrow", "2026-11-13T09:00:00Z")]);
    expect(s).toMatchObject({ mailbox: "office@house.test", mailboxes: 1 });
  });
});
