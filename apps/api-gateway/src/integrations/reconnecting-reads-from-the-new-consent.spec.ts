/**
 * F-762 — reconnecting Gmail reading must not read backwards.
 *
 * The consent says reading "starts from the moment you consent and never looks
 * backwards". The reader's cursor is keyed on the connection row's id, and the
 * connect upsert keeps that id across disconnect and reconnect, so the old
 * cursor used to survive and the first run after a reconnect read everything
 * since the day the reader was switched off.
 */
import { IntegrationsOauthService } from "./integrations-oauth.service";
import { INTEGRATION_DEFINITIONS } from "./integrations-oauth.constants";

const USER = "11111111-1111-4111-8111-111111111111";
const HOUSE = "22222222-2222-4222-8222-222222222222";
const CONN = "55555555-5555-4555-8555-555555555555";

function fixture(prior: Record<string, unknown> | null, faults: string[] = []) {
  const tables: Record<string, any[]> = {
    integration_oauth_connections: prior ? [{ ...prior }] : [],
    house_inbox_cursors: prior
      ? [{ connection_id: CONN, last_internal_date: Date.parse("2026-08-01T00:00:00Z") }]
      : [],
  };
  const db = {
    client: {
      from(table: string) {
        let action = "select";
        let payload: any;
        const filters: ((row: any) => boolean)[] = [];
        const run = () => {
          if (faults.includes(`${table}:${action}`)) {
            return { data: null, error: { message: "database unavailable" } };
          }
          const rows = tables[table] ?? (tables[table] = []);
          if (action === "upsert") {
            const at = rows.findIndex(
              (r) => r.user_id === payload.user_id && r.integration_id === payload.integration_id,
            );
            if (at >= 0) Object.assign(rows[at], payload);
            else rows.push({ id: CONN, ...payload });
            return { data: null, error: null };
          }
          const found = rows.filter((row) => filters.every((m) => m(row)));
          if (action === "delete") tables[table] = rows.filter((r) => !found.includes(r));
          return { data: found, error: null };
        };
        const query: any = {
          select: () => query,
          delete: () => { action = "delete"; return query; },
          upsert: (value: any) => { action = "upsert"; payload = value; return query; },
          eq: (key: string, value: any) => { filters.push((row) => row[key] === value); return query; },
          is: (key: string, value: any) => { filters.push((row) => (row[key] ?? null) === value); return query; },
          maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
          then: (resolve: any, reject: any) => Promise.resolve().then(run).then(resolve, reject),
        };
        return query;
      },
    },
  };
  const crypto = {
    isConfigured: true,
    encrypt: (t: string) => `enc:${t}`,
    decrypt: (t: string) => t.slice(4),
    tryDecrypt: () => null,
  };
  const oauth = new IntegrationsOauthService(db as never, { get: () => undefined } as never, crypto as never);
  const store = (account: string | null) =>
    (oauth as any).storeConnection({
      userId: USER,
      restaurantId: HOUSE,
      definition: INTEGRATION_DEFINITIONS.gmail_read,
      tokens: { access_token: "a", refresh_token: "r", scope: "https://www.googleapis.com/auth/gmail.readonly" },
      account,
      consentReceiptId: "seal",
    });
  return { tables, store };
}

const grant = (over: Record<string, unknown>) => ({
  id: CONN,
  user_id: USER,
  restaurant_id: HOUSE,
  integration_id: "gmail_read",
  account_email: "owner@house.test",
  revoked_at: null,
  ...over,
});

describe("reconnecting Gmail reading starts from the new consent (F-762)", () => {
  it("drops the old cursor when the reader is switched back on after a disconnect", async () => {
    const f = fixture(grant({ revoked_at: "2026-08-01T00:00:00Z" }));
    await f.store("owner@house.test");
    expect(f.tables.house_inbox_cursors).toEqual([]);
    expect(f.tables.integration_oauth_connections[0].revoked_at).toBeNull();
  });

  it("drops the old cursor when a different mailbox takes over the same grant", async () => {
    const f = fixture(grant({}));
    await f.store("someone-else@house.test");
    expect(f.tables.house_inbox_cursors).toEqual([]);
  });

  it("keeps the cursor when a live grant on the same mailbox is consented again", async () => {
    const f = fixture(grant({}));
    await f.store("Owner@House.test");
    expect(f.tables.house_inbox_cursors).toHaveLength(1);
  });

  it("does not switch the grant back on when the old cursor cannot be cleared", async () => {
    const f = fixture(grant({ revoked_at: "2026-08-01T00:00:00Z" }), ["house_inbox_cursors:delete"]);
    await expect(f.store("owner@house.test")).rejects.toThrow(/reading point/);
    expect(f.tables.integration_oauth_connections[0].revoked_at).toBe("2026-08-01T00:00:00Z");
    expect(f.tables.house_inbox_cursors).toHaveLength(1);
  });

  it("does nothing to cursors on a first-ever connection", async () => {
    const f = fixture(null);
    await f.store("owner@house.test");
    expect(f.tables.house_inbox_cursors).toEqual([]);
    expect(f.tables.integration_oauth_connections).toHaveLength(1);
  });
});
