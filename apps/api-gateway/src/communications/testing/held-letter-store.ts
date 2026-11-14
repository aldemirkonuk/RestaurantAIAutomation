/**
 * Test support for the held-letter specs (r35 mail, gap 9): an in-memory
 * store that keeps rows and applies filters, column lists, updates and
 * deletes the way PostgREST does for the calls `ProspectsService` makes, so a
 * test reads what the tables hold afterwards rather than which calls were
 * made. No product code imports it.
 */
import { ProspectsService } from "../../common/orchestrator/prospects.service";
import { likeToRegExp } from "./mail-store";

export const HOUSE = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const HELD = "33333333-3333-4333-8333-333333333333";
export const VENDOR = "44444444-4444-4444-8444-444444444444";
export const USER = "55555555-5555-4555-8555-555555555555";

export type Row = Record<string, any>;
type Op = "select" | "insert" | "update" | "delete";

/**
 * `fail` names `table:op` pairs whose next call answers `{ data: null, error }`.
 * `before` runs before a `table:op` call is answered (to race a write).
 */
export function store(
  tables: Record<string, Row[]>,
  fail: string[] = [],
  before: Record<string, () => void> = {},
) {
  let n = 0;
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: Op = "select";
    let payload: any;
    let single = false;
    let returning = false;
    let lim = Infinity;
    let columns: string[] | null = null;
    const field = (r: Row, c: string) => {
      const [col, f] = c.split("->>");
      return f === undefined ? r[col] : r[col]?.[f];
    };
    const qb: any = {
      // A read returns only the columns it names, as PostgREST does.
      select: (cols?: string) => {
        if (op !== "select") returning = true;
        else if (cols && cols !== "*") columns = cols.split(",").map((c) => c.trim());
        return qb;
      },
      eq: (c: string, v: any) => (filters.push((r) => field(r, c) === v), qb),
      is: (c: string, v: any) => (
        filters.push((r) => (v === null ? field(r, c) == null : field(r, c) === v)),
        qb
      ),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(field(r, c))), qb),
      ilike: (c: string, v: string) => {
        const re = likeToRegExp(v);
        filters.push((r) => re.test(String(field(r, c) ?? "")));
        return qb;
      },
      order: () => qb,
      limit: (k: number) => ((lim = k), qb),
      single: () => ((single = true), qb),
      maybeSingle: () => ((single = true), qb),
      insert: (p: any) => ((op = "insert"), (payload = p), qb),
      update: (p: any) => ((op = "update"), (payload = p), qb),
      delete: () => ((op = "delete"), qb),
      then: (res: any, rej: any) => {
        const key = `${table}:${op}`;
        before[key]?.();
        let out: any;
        const at = fail.indexOf(key);
        if (at >= 0) {
          fail.splice(at, 1);
          out = { data: null, error: { message: `${key} refused` } };
        } else if (op === "insert") {
          const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
            id: `${table}-${++n}`,
            ...(table === "procurement_conversations"
              ? { thread_key: p.gmail_thread_id ? `gm:${p.gmail_thread_id}` : `msg:${table}-${n}` }
              : {}),
            ...p,
          }));
          rows.push(...list);
          out = { data: single ? list[0] : list, error: null };
        } else {
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === "update") {
            for (const r of hit) Object.assign(r, payload);
            out = { data: returning ? hit.map((r) => ({ id: r.id })) : null, error: null };
          } else if (op === "delete") {
            for (const r of hit) rows.splice(rows.indexOf(r), 1);
            out = { data: null, error: null };
          } else {
            const m = hit
              .slice(0, lim)
              .map((r) =>
                columns ? Object.fromEntries(columns.filter((c) => c in r).map((c) => [c, r[c]])) : { ...r },
              );
            out = { data: single ? (m[0] ?? null) : m, error: null };
          }
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return qb;
  };
  return { supabase: { from } };
}

export const heldRow = (o: Row = {}): Row => ({
  id: HELD,
  restaurant_id: HOUSE,
  domain: "dairy.example",
  sender_email: "orders@dairy.example",
  sender_name: "Dairy Orders",
  subject: "Invoice 2211",
  body_preview: "Please find the invoice for last week attached.",
  snippet: "Please find the invoice",
  capture_reason: "sender_unconfirmed",
  held_reason: "sender_unconfirmed",
  attachments: [
    {
      filename: "invoice-2211.pdf",
      mime_type: "application/pdf",
      size_bytes: 1234,
      storage_path: "prospects/dairy.example/abc-invoice-2211.pdf",
      sha256: "abc",
    },
  ],
  has_attachments: true,
  message_count: 1,
  status: "new",
  gmail_message_id: "gm-msg-1",
  gmail_thread_id: "gm-thread-1",
  first_seen_at: "2026-11-12T09:30:00.000Z",
  last_seen_at: "2026-11-12T09:30:00.000Z",
  ...o,
});

export const vendorRow = (o: Row = {}): Row => ({
  id: VENDOR,
  restaurant_id: HOUSE,
  name: "Quiet Dairy",
  contact_email: "orders@dairy.example",
  primary_contact: {},
  deleted_at: null,
  ...o,
});

export function world(o: { held?: Row[]; providers?: Row[]; contacts?: Row[]; conversations?: Row[] } = {}) {
  return {
    email_prospects: o.held ?? [heldRow()],
    providers: o.providers ?? [vendorRow()],
    provider_contacts: o.contacts ?? [],
    procurement_conversations: o.conversations ?? [],
    conversation_attachments: [] as Row[],
  };
}

export const svc = (db: unknown) =>
  new ProspectsService(db as any, { get: () => undefined } as any);
