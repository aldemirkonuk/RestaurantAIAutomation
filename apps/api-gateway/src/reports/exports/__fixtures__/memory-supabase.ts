import { randomUUID } from "crypto";

/**
 * An in-memory stand-in for the Supabase query builder that APPLIES what it is
 * told — every `eq`, `lt`, `order` and `limit` filters real rows — and enforces
 * `report_exports`' CHECKs the way Postgres does
 * (supabase/migrations/20260917010200_a_report_export_is_written_or_says_why_not.sql).
 *
 * Why not a recording stub: the specs that use this are about tenancy and the
 * lifecycle. A stub that records `.eq("restaurant_id", …)` passes whether or not
 * the filter was applied to the right statement; a store that answers from its
 * rows returns another house's export the moment a scope is missing, and refuses
 * a `ready` row without its files the moment the service writes one. The
 * constraints mirrored here are pinned to the migration's text by
 * `report-exports.service.spec.ts`, so this file cannot quietly drift looser.
 */

type Row = Record<string, unknown>;
type DbError = { message: string; code?: string };

const REPORT_EXPORT_STATUSES = ["queued", "ready", "failed"];

function violation(table: string, row: Row, tables: Record<string, Row[]>): string | null {
  if (table !== "report_exports") return null;
  if (!REPORT_EXPORT_STATUSES.includes(String(row.status)))
    return 'new row for relation "report_exports" violates check constraint "report_exports_status_check"';
  if ((row.status === "ready") !== (row.csv != null && row.html != null))
    return 'new row for relation "report_exports" violates check constraint "report_exports_ready_has_both_files"';
  if ((row.status === "failed") !== (row.failure_reason != null))
    return 'new row for relation "report_exports" violates check constraint "report_exports_failed_says_why"';
  if ((row.status === "queued") !== (row.finished_at == null))
    return 'new row for relation "report_exports" violates check constraint "report_exports_settled_has_finished"';
  if (!/^[a-z_]{1,40}$/.test(String(row.cutting)))
    return 'new row for relation "report_exports" violates check constraint "report_exports_cutting_check"';
  const houses = tables.restaurants ?? [];
  if (!houses.some((h) => h.id === row.restaurant_id))
    return 'insert or update on table "report_exports" violates foreign key constraint "report_exports_restaurant_id_fkey"';
  return null;
}

function defaults(table: string): Row {
  if (table !== "report_exports") return { id: randomUUID() };
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    requested_by: null,
    window_days: null,
    status: "queued",
    failure_reason: null,
    csv: null,
    html: null,
    csv_bytes: null,
    html_bytes: null,
    withheld_count: null,
    attempts: 1,
    requested_at: now,
    started_at: now,
    finished_at: null,
  };
}

function project(row: Row, columns: string | undefined): Row {
  if (!columns || columns.trim() === "*") return { ...row };
  const out: Row = {};
  for (const c of columns.split(",").map((s) => s.trim()).filter(Boolean)) out[c] = row[c];
  return out;
}

export class MemorySupabase {
  readonly tables: Record<string, Row[]> = {};
  /** Statements issued, in order: `table:op`. */
  readonly log: string[] = [];
  /**
   * The same statements with the column list each one asked PostgREST to
   * return (`undefined` when `.select()` named none — every column). A spec
   * can then assert what a statement READ, not only what the service kept of
   * it: a list that selects the file bodies and drops them in the DTO still
   * pulls every file over the wire.
   */
  readonly statements: Array<{ table: string; op: string; columns: string | undefined }> = [];
  /** Make the next statement matching `table:op` fail with this message. */
  private failures: Array<{ key: string; message: string }> = [];

  failNext(table: string, op: "select" | "insert" | "update", message: string) {
    this.failures.push({ key: `${table}:${op}`, message });
  }

  takeFailure(key: string): DbError | null {
    const i = this.failures.findIndex((f) => f.key === key);
    if (i === -1) return null;
    const [f] = this.failures.splice(i, 1);
    return { message: f.message };
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  seed(table: string, row: Row): Row {
    const full = { ...defaults(table), ...row };
    this.rows(table).push(full);
    return full;
  }

  readonly supabase = {
    from: (table: string) => new MemoryQuery(this, table),
  };
}

class MemoryQuery implements PromiseLike<{ data: unknown; error: DbError | null; count?: number | null }> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private columns: string | undefined;
  private countMode = false;
  private head = false;
  private filters: Array<(r: Row) => boolean> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;
  private offsetN = 0;

  constructor(
    private readonly db: MemorySupabase,
    private readonly table: string,
  ) {}

  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    this.columns = columns;
    if (this.op === "select") {
      this.countMode = opts?.count === "exact";
      this.head = opts?.head === true;
    }
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push((r) => r[column] != null && String(r[column]) < String(value));
    return this;
  }
  /**
   * PostgREST's `or=(a.op.v,b.op.v)`, for the operators this codebase's
   * callers pass: `eq`, `neq`, `is.null`, `not.is.null`. Anything else throws,
   * so a filter this store cannot evaluate fails the spec instead of matching
   * every row. `neq` follows SQL: NULL <> 'x' is not true, so a NULL column
   * never satisfies it (that is why WRITTEN_REPORT_FILTER also says
   * `status.is.null`).
   */
  or(expr: string) {
    const terms = expr.split(",").map((t) => t.trim());
    const preds = terms.map((term): ((r: Row) => boolean) => {
      const [column, ...rest] = term.split(".");
      const op = rest.join(".");
      if (op === "is.null") return (r) => r[column] == null;
      if (op === "not.is.null") return (r) => r[column] != null;
      if (rest[0] === "eq") return (r) => r[column] != null && String(r[column]) === rest.slice(1).join(".");
      if (rest[0] === "neq") return (r) => r[column] != null && String(r[column]) !== rest.slice(1).join(".");
      throw new Error(`MemorySupabase.or cannot evaluate "${term}"`);
    });
    this.filters.push((r) => preds.some((p) => p(r)));
    return this;
  }
  range(from: number, to: number) {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }

  async single() {
    const res = await this.exec();
    if (res.error) return res;
    const rows = res.data as Row[];
    if (rows.length !== 1)
      return { data: null, error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" } };
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const res = await this.exec();
    if (res.error) return res;
    const rows = res.data as Row[];
    if (rows.length > 1)
      return { data: null, error: { message: "multiple rows returned", code: "PGRST116" } };
    return { data: rows[0] ?? null, error: null };
  }

  then<A, B>(
    onfulfilled?: ((v: { data: unknown; error: DbError | null; count?: number | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private matching(): Row[] {
    return this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)));
  }

  private async exec(): Promise<{ data: unknown; error: DbError | null; count?: number | null }> {
    this.db.log.push(`${this.table}:${this.op}`);
    this.db.statements.push({ table: this.table, op: this.op, columns: this.columns });
    const failure = this.db.takeFailure(`${this.table}:${this.op}`);
    if (failure) return { data: null, error: failure, count: null };

    if (this.op === "insert") {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      const built = incoming.map((p) => ({ ...defaults(this.table), ...p }));
      for (const b of built) {
        const v = violation(this.table, b, this.db.tables);
        if (v) return { data: null, error: { message: v, code: "23514" } };
      }
      this.db.rows(this.table).push(...built);
      return { data: built.map((b) => project(b, this.columns)), error: null };
    }

    if (this.op === "update") {
      const targets = this.matching();
      const merged = targets.map((t) => ({ ...t, ...(this.payload as Row) }));
      for (const m of merged) {
        const v = violation(this.table, m, this.db.tables);
        if (v) return { data: null, error: { message: v, code: "23514" } };
      }
      targets.forEach((t, i) => Object.assign(t, merged[i]));
      return { data: targets.map((t) => project(t, this.columns)), error: null };
    }

    if (this.op === "delete") {
      const keep = this.db.rows(this.table).filter((r) => !this.filters.every((f) => f(r)));
      this.db.tables[this.table] = keep;
      return { data: null, error: null };
    }

    let rows = this.matching();
    const count = rows.length;
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      rows = [...rows].sort((a, b) => {
        const x = String(a[column] ?? "");
        const y = String(b[column] ?? "");
        return ascending ? x.localeCompare(y) : y.localeCompare(x);
      });
    }
    if (this.offsetN > 0 || this.limitN !== null)
      rows = rows.slice(this.offsetN, this.limitN === null ? undefined : this.offsetN + this.limitN);
    return {
      data: this.head ? null : rows.map((r) => project(r, this.columns)),
      error: null,
      count: this.countMode ? count : null,
    };
  }
}
