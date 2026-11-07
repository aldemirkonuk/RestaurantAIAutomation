/**
 * Test-only: a small PostgREST stand-in for the mail setup specs, and the
 * grants they share. It really filters, so a read that forgets its tenant
 * filter leaks the other house's rows into the result and fails the spec. It
 * records every write, so a stray one shows.
 */

import { GMAIL_SEND_SCOPE } from "../letters/house-sender.service";

export const HOUSE = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const ME = "aaaaaaaa-0000-4000-8000-000000000001";
export const CHEF = "aaaaaaaa-0000-4000-8000-000000000002";
export const DRIVE = "https://www.googleapis.com/auth/drive.file";

export type Row = Record<string, any>;
export interface TableSpec {
  rows?: Row[];
  error?: { message: string; code?: string };
  writeErrors?: Array<{ message: string; code?: string } | null>;
}

export function fakeDb(tables: Record<string, TableSpec>) {
  const writes: Array<{ table: string; op: string; payload?: any; filters: any[] }> = [];
  const from = (table: string) => {
    const q: {
      op: string;
      payload?: any;
      filters: Array<[string, string, any]>;
      single: boolean;
      limit?: number;
      order?: { key: string; ascending: boolean };
    } = {
      op: "select",
      filters: [],
      single: false,
    };
    const run = () => {
      const t = tables[table] ?? {};
      if (q.op !== "select") {
        writes.push({ table, op: q.op, payload: q.payload, filters: q.filters });
        const err = t.writeErrors?.length ? t.writeErrors.shift() : null;
        if (err) return { data: null, error: err };
        if (q.op === "update") {
          const hit = (t.rows ?? []).filter(match);
          hit.forEach((r) => Object.assign(r, q.payload));
          return { data: hit.map((r) => ({ id: r.id })), error: null };
        }
        return { data: null, error: null };
      }
      if (t.error) return { data: null, error: t.error };
      let rows = (t.rows ?? []).filter(match);
      if (q.order) {
        // Stable; rows missing the key keep their place among themselves.
        const { key, ascending } = q.order;
        rows = [...rows].sort((a, b) => {
          const x = a[key] ?? null;
          const y = b[key] ?? null;
          if (x === y || x === null || y === null) return 0;
          return (String(x) < String(y) ? -1 : 1) * (ascending ? 1 : -1);
        });
      }
      if (q.limit !== undefined) rows = rows.slice(0, q.limit);
      return { data: q.single ? (rows[0] ?? null) : rows, error: null };
    };
    const match = (r: Row) =>
      q.filters.every(([kind, k, v]) =>
        kind === "eq"
          ? String(r[k]) === String(v)
          : kind === "is"
            ? (r[k] ?? null) === v
            : kind === "in"
              ? (v as any[]).map(String).includes(String(r[k]))
              : kind === "lte"
                ? r[k] != null && String(r[k]) <= String(v)
                : kind === "not_is"
                  ? (r[k] ?? null) !== v
                  : true,
      );
    const chain: any = {
      select: () => chain,
      eq: (k: string, v: any) => (q.filters.push(["eq", k, v]), chain),
      is: (k: string, v: any) => (q.filters.push(["is", k, v]), chain),
      in: (k: string, v: any[]) => (q.filters.push(["in", k, v]), chain),
      // ISO timestamps compare correctly as strings.
      lte: (k: string, v: any) => (q.filters.push(["lte", k, v]), chain),
      // Only `not(column, "is", value)`, the one form the services use.
      not: (k: string, op: string, v: any) => {
        if (op !== "is") throw new Error(`fakeDb: not(${op}) is not supported`);
        q.filters.push(["not_is", k, v]);
        return chain;
      },
      order: (key: string, o?: { ascending?: boolean }) => ((q.order = { key, ascending: o?.ascending !== false }), chain),
      limit: (n: number) => ((q.limit = n), chain),
      maybeSingle: () => ((q.single = true), Promise.resolve(run())),
      delete: () => ((q.op = "delete"), chain),
      update: (p: any) => ((q.op = "update"), (q.payload = p), chain),
      upsert: (p: any) => ((q.op = "upsert"), (q.payload = p), Promise.resolve(run())),
      insert: (p: any) => ((q.op = "insert"), (q.payload = p), Promise.resolve(run())),
      then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
    };
    return chain;
  };
  return { client: { from } as any, supabase: { from } as any, writes };
}

export const grant = (id: string, user: string, house: string, scopes: string[], email: string | null, revoked: string | null = null) => ({
  id,
  user_id: user,
  restaurant_id: house,
  provider: "google",
  integration_id: "gmail_send",
  account_email: email,
  scopes,
  revoked_at: revoked,
});

export const G_MINE = "c0000000-0000-4000-8000-000000000001";
export const G_CHEF = "c0000000-0000-4000-8000-000000000002";
export const G_DRIVE = "c0000000-0000-4000-8000-000000000003";
export const G_OTHER = "c0000000-0000-4000-8000-000000000004";
export const G_REVOKED = "c0000000-0000-4000-8000-000000000005";

export function grants(): Row[] {
  return [
    grant(G_MINE, ME, HOUSE, [GMAIL_SEND_SCOPE], "me@house.test"),
    grant(G_CHEF, CHEF, HOUSE, [GMAIL_SEND_SCOPE], "office@house.test"),
    grant(G_DRIVE, CHEF, HOUSE, [DRIVE], "files@house.test"),
    grant(G_OTHER, "x", OTHER, [GMAIL_SEND_SCOPE], "them@other.test"),
    grant(G_REVOKED, CHEF, HOUSE, [GMAIL_SEND_SCOPE], "old@house.test", "2026-11-01T00:00:00Z"),
  ];
}
