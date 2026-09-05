/**
 * An in-memory, Postgres-shaped store for the producer specs.
 *
 * WHY A REAL STORE AND NOT A CHAIN OF `() => chain` STUBS.
 * The whole producer design rests on one thing a stub cannot model: the UNIQUE
 * `(restaurant_id, producer, dedupe_key, user_id)` index on
 * `notification_producer_claims`. A mock that returned "inserted" for every
 * upsert would let a double-writing producer pass its own idempotency test —
 * the test would be measuring the mock. So this fake ENFORCES the constraint,
 * and every "second sweep writes nothing" case below is proven by running the
 * sweep twice against the same rows and counting the writes.
 *
 * It lives in `src/` rather than beside one spec because five spec files share
 * it; it carries no Nest decorators and no side effects, so compiling into
 * `dist` costs nothing but a few unused bytes. Modelled on the same harness
 * `calendar/calendar-reminders.service.spec.ts:17-180` uses, extended with the
 * operators these producers actually call (`or`, `not`, `lt`, `maybeSingle`).
 */

import { fixedClock, type ProducerClock } from "../producer-clock";

/**
 * Re-exported so a spec wires its store, its doubles and its clock from ONE
 * import and cannot accidentally leave the clock on the wall while it fixes
 * everything else — which is precisely the shape of the 2026-09-04 defect.
 */
export { fixedClock };
export type { ProducerClock };

export type Row = Record<string, any>;

export class FakeDb {
  tables: Record<string, Row[]> = {
    analytics_goals: [],
    mcp_tool_grants: [],
    notification_preferences: [],
    notification_producer_claims: [],
    notification_producer_runs: [],
    pos_checks: [],
    procurement_documents: [],
    procurement_order_items: [],
    procurement_orders: [],
    procurement_receipt_events: [],
    providers: [],
    restaurant_mcp_connections: [],
    restaurants: [],
    shifts: [],
    team_members: [],
    user_restaurant_access: [],
    wine_consumption_log: [],
  };

  /** Tables the caller wants to fail, and with what message. */
  failures: Record<string, string> = {};

  private seq = 0;

  id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

/** The unique indexes this fake actually enforces, by table. */
const UNIQUE_KEYS: Record<string, string[]> = {
  notification_producer_claims: [
    "restaurant_id",
    "producer",
    "dedupe_key",
    "user_id",
  ],
};

/**
 * PARTIAL unique indexes: the key applies only to rows the predicate admits.
 *
 * `uq_notification_mcp_tool_open_run` is `(connection_id, tool_name) WHERE
 * gone_at IS NULL` — the CLOSED runs of a tool that came and went and came back
 * must coexist, which is the whole mechanism behind "a removed-then-re-added
 * tool is said again". A fake enforcing it as a TOTAL unique index would make
 * that behaviour untestable by forbidding it, so the predicate is modelled too.
 */
const PARTIAL_UNIQUE_KEYS: Record<
  string,
  { key: string[]; where: (r: Row) => boolean }
> = {
  notification_mcp_tool_sightings: {
    key: ["connection_id", "tool_name"],
    where: (r) => (r.gone_at ?? null) === null,
  },
};

type Predicate = (r: Row) => boolean;

export class FakeQuery {
  private filters: Predicate[] = [];
  private mode: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private limitN: number | null = null;
  private headCount = false;
  private orderKey: string | null = null;
  private orderAsc = true;
  private ignoreDuplicates = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.headCount = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.mode = "upsert";
    this.payload = rows;
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(col: string, value: any) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  neq(col: string, value: any) {
    this.filters.push((r) => r[col] !== value);
    return this;
  }
  is(col: string, value: any) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  not(col: string, op: string, value: any) {
    if (op === "is") {
      this.filters.push((r) => (r[col] ?? null) !== value);
    } else {
      this.filters.push((r) => r[col] !== value);
    }
    return this;
  }
  in(col: string, values: any[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  gte(col: string, value: any) {
    this.filters.push((r) => String(r[col]) >= String(value));
    return this;
  }
  gt(col: string, value: any) {
    this.filters.push((r) => String(r[col]) > String(value));
    return this;
  }
  lte(col: string, value: any) {
    this.filters.push((r) => String(r[col]) <= String(value));
    return this;
  }
  lt(col: string, value: any) {
    this.filters.push((r) => String(r[col]) < String(value));
    return this;
  }
  /**
   * PostgREST's `or=(a.eq.1,b.is.null)`. Only the two forms the producers use
   * are parsed — `<col>.is.null` and `<col>.eq.<value>` — and anything else
   * THROWS rather than passing silently, so a filter this fake cannot model
   * fails the test instead of quietly matching every row.
   */
  or(expr: string) {
    const clauses = expr.split(",").map((c) => c.trim()).filter(Boolean);
    const preds: Predicate[] = clauses.map((clause) => {
      const isNull = /^([\w.]+)\.is\.null$/.exec(clause);
      if (isNull) return (r: Row) => (r[isNull[1]] ?? null) === null;
      const eq = /^([\w.]+)\.eq\.(.*)$/.exec(clause);
      if (eq) return (r: Row) => String(r[eq[1]] ?? "") === eq[2];
      throw new Error(`FakeQuery.or cannot model the clause "${clause}"`);
    });
    this.filters.push((r) => preds.some((p) => p(r)));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderKey = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  single() {
    return this.run(true);
  }
  maybeSingle() {
    return this.run(true);
  }
  then<TResult1 = any, TResult2 = never>(
    resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run(false).then(resolve, reject);
  }

  private matching(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
  }

  private async run(single: boolean): Promise<any> {
    const failure = this.db.failures[this.table];
    if (failure) return { data: null, error: { message: failure }, count: null };
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);

    if (this.mode === "insert" || this.mode === "upsert") {
      const written: Row[] = [];
      const key = UNIQUE_KEYS[this.table];
      const partial = PARTIAL_UNIQUE_KEYS[this.table];
      for (const row of this.payload) {
        if (partial && partial.where(row)) {
          const clash = rows.some(
            (r) => partial.where(r) && partial.key.every((k) => r[k] === row[k]),
          );
          if (clash) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value" },
            };
          }
        }
        if (key) {
          const clash = rows.some((r) => key.every((k) => r[k] === row[k]));
          if (clash) {
            // THE UNIQUE INDEX. Without it every idempotency test below is
            // measuring the mock rather than the producer.
            if (this.mode === "upsert" && this.ignoreDuplicates) continue;
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value" },
            };
          }
        }
        const stored = { id: this.db.id(this.table), ...row };
        rows.push(stored);
        written.push(stored);
      }
      return { data: single ? (written[0] ?? null) : written, error: null };
    }

    if (this.mode === "update") {
      const hit = this.matching();
      for (const row of hit) Object.assign(row, this.patch);
      return { data: single ? (hit[0] ?? null) : hit, error: null };
    }

    if (this.mode === "delete") {
      const hit = new Set(this.matching());
      this.db.tables[this.table] = rows.filter((r) => !hit.has(r));
      return { data: null, error: null };
    }

    let hit = this.matching();
    if (this.orderKey) {
      const key = this.orderKey;
      hit = [...hit].sort((a, b) =>
        this.orderAsc
          ? String(a[key]).localeCompare(String(b[key]))
          : String(b[key]).localeCompare(String(a[key])),
      );
    }
    if (this.headCount) return { data: null, count: hit.length, error: null };
    if (this.limitN !== null) hit = hit.slice(0, this.limitN);
    return {
      data: single ? (hit[0] ?? null) : hit,
      error: null,
      count: hit.length,
    };
  }
}

/**
 * A recording stand-in, so this file needs no jest types in the build tree.
 *
 * `calls` is `any[][]` rather than a tuple of the impl's own parameters: a
 * zero-argument impl would otherwise give `calls: [][]`, and every
 * `calls[0][0]` assertion in the specs would be a compile error about indexing
 * an empty tuple. The looseness is the point — a spec asserting on arguments
 * the impl declares it does not take is exactly what these doubles are for.
 */
export interface Recorded {
  (...args: any[]): any;
  calls: any[][];
}

export function recorder(impl: (...args: any[]) => any): Recorded {
  const fn = ((...args: any[]) => {
    fn.calls.push(args);
    return impl(...args);
  }) as Recorded;
  fn.calls = [];
  return fn;
}

/** The `DatabaseService` shape the producers actually use. */
export function fakeDatabase(db: FakeDb, members: string[]) {
  return {
    getClient: () => db,
    supabase: db,
    getRestaurantMemberIds: recorder(async () => members),
  };
}

/**
 * A `NotificationsService` double that records what it was asked to write.
 *
 * `inserted` mirrors the real funnel's contract: the number of rows written,
 * narrowed to `onlyUserIds`. Returning 0 is how a spec proves the producer
 * releases its claims instead of counting a failed write as a send.
 */
export function fakeNotifications(
  members: string[],
  insertedOverride?: () => number | null,
) {
  return {
    persistForRestaurant: recorder(
      async (_r: string, _p: any, opts: any) => {
        const targets: string[] = opts?.onlyUserIds ?? members;
        const forced = insertedOverride?.();
        const inserted = forced === null || forced === undefined ? targets.length : forced;
        return {
          inserted,
          ids: inserted ? targets.map((u) => `notif-${u}`) : [],
        };
      },
    ),
  };
}
