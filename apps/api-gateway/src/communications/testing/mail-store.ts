/**
 * Test support: a tiny in-memory supabase that runs ILIKE the way PostgREST
 * and Postgres do, and the inbound-mail bridge wired over it. Shared by the
 * inbound-mail specs; no product code imports it.
 */
import { RabbitMqBridgeService } from "../../common/orchestrator/rabbitmq-bridge.service";

/**
 * ILIKE as PostgREST v14 + Postgres 15 run it (QA rounds 24 and 25, measured
 * live): PostgREST first rewrites every `*` to `%`, escaped or not; then `%`
 * matches any run, `_` one character, and a backslash escapes the next
 * character. So `\*` reaches Postgres as `\%`, a literal percent sign.
 */
export function likeToRegExp(pattern: string): RegExp {
  const pg = pattern.replace(/\*/g, "%");
  let out = "";
  for (let i = 0; i < pg.length; i++) {
    const ch = pg[i];
    if (ch === "\\" && i + 1 < pg.length) {
      out += pg[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "is");
}

export type Row = Record<string, any>;

/**
 * `failing` names tables whose every read answers `{ data: null, error }`,
 * the way supabase-js reports a failed read; `refusing` names tables whose
 * inserts are refused the same way (a lost unique-index race).
 */
export function memoryDb(
  tables: Record<string, Row[]>,
  failing: string[] = [],
  refusing: string[] = [],
) {
  const inserts: Array<{ table: string; row: Row }> = [];
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op = "select";
    let payload: any;
    let single = false;
    let lim = Infinity;
    const qb: any = {
      select: () => qb,
      // `a->>b` reads a JSON field as text, as PostgREST does.
      ilike: (c: string, v: string) => {
        const re = likeToRegExp(v);
        const [col, field] = c.split("->>");
        filters.push((r) =>
          re.test(
            String((field === undefined ? r[col] : r[col]?.[field]) ?? ""),
          ),
        );
        return qb;
      },
      // `a->>b` reads a JSON field the way PostgREST does (as text).
      eq: (c: string, v: any) => (
        filters.push((r) => {
          const [col, field] = c.split("->>");
          const got = field === undefined ? r[col] : r[col]?.[field];
          return field === undefined ? got === v : String(got ?? "") === String(v);
        }),
        qb
      ),
      neq: (c: string, v: any) => (
        filters.push((r) => r[c] != null && r[c] !== v),
        qb
      ),
      is: (c: string, v: any) => (
        filters.push((r) => (v === null ? r[c] == null : r[c] === v)),
        qb
      ),
      in: (c: string, v: any[]) => (filters.push((r) => v.includes(r[c])), qb),
      not: (c: string, operator: string, v: any) => {
        if (operator === "is" && v === null) filters.push((r) => r[c] != null);
        return qb;
      },
      order: () => qb,
      limit: (n: number) => ((lim = n), qb),
      single: () => ((single = true), qb),
      maybeSingle: () => ((single = true), qb),
      insert: (p: any) => ((op = "insert"), (payload = p), qb),
      update: () => ((op = "update"), qb),
      then: (res: any, rej: any) => {
        let out: any;
        if (op === "select" && failing.includes(table)) {
          out = { data: null, error: { message: `${table} unreadable` } };
        } else if (op === "insert" && refusing.includes(table)) {
          out = { data: null, error: { message: `${table} insert refused` } };
        } else if (op === "insert") {
          const row = { id: `${table}-${rows.length + 1}`, ...payload };
          rows.push(row);
          inserts.push({ table, row });
          out = { data: single ? { id: row.id } : [row], error: null };
        } else if (op === "update") out = { data: [], error: null };
        else {
          const m = rows
            .filter((r) => filters.every((f) => f(r)))
            .slice(0, lim);
          out = { data: single ? (m[0] ?? null) : m, error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return qb;
  };
  return {
    inserts,
    supabase: {
      from,
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
    },
  };
}

/** The bridge over `memoryDb`; `events` records every outward effect. */
export function bridge(
  tables: Record<string, Row[]>,
  failing: string[] = [],
  refusing: string[] = [],
) {
  const db = memoryDb(tables, failing, refusing);
  const events: any[] = [];
  const ws: any = new Proxy(
    {},
    {
      get:
        (_t, k) =>
        (...a: any[]) =>
          void events.push([String(k), ...a]),
    },
  );
  const responder: any = {
    analyzeAndDraftReply: (...a: any[]) =>
      void events.push(["responder", ...a]),
    persistManagerNotification: async (...a: any[]) =>
      void events.push(["persistManagerNotification", ...a]),
  };
  const noop: any = new Proxy(
    {},
    {
      get:
        (_t, k) =>
        async (...a: any[]) =>
          void events.push([String(k), ...a]),
    },
  );
  const prospects: any = {
    domainOf: (e: string) => e.split("@")[1],
    captureFromColdEmail: async (a: any) => (
      events.push(["prospect", a]),
      { captured: false }
    ),
    holdUnattributed: async (a: any) => (
      events.push(["hold", a]),
      { captured: true, isTriage: true }
    ),
    holdLetter: async (a: any) => (
      events.push(["held", a]),
      { captured: true, isNew: true, isTriage: a.restaurantId === null }
    ),
  };
  const svc: any = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    ws,
    db as any,
    responder,
    noop,
    prospects,
  );
  svc.persistAttachments = async () => undefined;
  svc.persistProspectAttachments = async () => [];
  return { svc, inserts: db.inserts, events };
}

export const inbound = (o: Record<string, any>) => ({
  from: "",
  subject: "Re: order",
  body: "ok",
  attachments: [],
  gmail_thread_id: "",
  gmail_message_id: "",
  message_id_header: "",
  in_reply_to: "",
  references: "",
  headers: {},
  ...o,
});
