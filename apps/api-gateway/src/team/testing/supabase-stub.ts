/**
 * An in-memory Supabase stand-in for the /team specs.
 *
 * TEST SUPPORT ONLY. Nothing in the runtime graph imports this file; it lives
 * under `src/` because `tsconfig.json` excludes `**\/*.spec.ts` from the build,
 * so a helper shared between spec files cannot itself be named `.spec.ts`
 * without jest trying to run it as a suite.
 *
 * It applies filters for real rather than replaying a canned answer. That is
 * the point: a stub that ignores `.eq("restaurant_id", …)` cannot fail a test
 * about tenant scoping, and a green run over it would be the same green tick
 * over an unexamined surface that [[absence-reported-as-health]] describes.
 */

type Row = Record<string, any>;
type Filter = { kind: string; column: string; value: any };

export interface RecordedOp {
  table: string;
  op: "select" | "insert" | "update" | "delete" | "upsert";
  filters: Filter[];
  payload?: any;
  /** The column list as written, so a spec can assert what was asked for. */
  columns?: string;
}

export interface StubDb {
  /** Rows per table. Mutated in place by insert/update/delete. */
  tables: Record<string, Row[]>;
  /** Every operation the code under test performed, in order. */
  ops: RecordedOp[];
  /** Force an error: key is `"<table>:<op>"`. */
  errors: Record<string, { message: string }>;
  /**
   * Optional real column list per table, cited to its migration. A table named
   * here answers 42703 to a select naming a column it does not have, the way
   * PostgREST does. A table not named here is not column-checked.
   */
  schema?: Record<string, string[]>;
  supabase: { from: (table: string) => any };
  /** Convenience: the ops that touched `table` with operation `op`. */
  opsOn(table: string, op?: RecordedOp["op"]): RecordedOp[];
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    switch (f.kind) {
      case "eq":
        return actual === f.value;
      case "neq":
        return actual !== f.value;
      case "in":
        return Array.isArray(f.value) && f.value.includes(actual);
      case "is":
        return f.value === null ? actual == null : actual === f.value;
      case "notis":
        return f.value === null ? actual != null : actual !== f.value;
      case "gte":
        return actual >= f.value;
      case "lte":
        return actual <= f.value;
      case "gt":
        return actual > f.value;
      case "ilike":
        return (
          typeof actual === "string" &&
          actual.toLowerCase() === String(f.value).toLowerCase()
        );
      default:
        throw new Error(`supabase-stub: unhandled filter ${f.kind}`);
    }
  });
}

export function makeStubDb(
  tables: Record<string, Row[]> = {},
  errors: Record<string, { message: string }> = {},
  schema?: Record<string, string[]>,
): StubDb {
  const db: StubDb = {
    tables,
    ops: [],
    errors,
    schema,
    supabase: { from: (table: string) => new Builder(db, table) },
    opsOn(table, op) {
      return db.ops.filter((o) => o.table === table && (!op || o.op === op));
    },
  };
  return db;
}

class Builder implements PromiseLike<any> {
  private op: RecordedOp["op"] | null = null;
  private filters: Filter[] = [];
  private payload: any;
  private columns: string | undefined;
  private wantCount = false;
  private headOnly = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  private limitTo: number | null = null;
  private recorded: RecordedOp | null = null;

  constructor(
    private readonly db: StubDb,
    private readonly table: string,
  ) {}

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  private record(): RecordedOp {
    if (!this.recorded) {
      this.recorded = {
        table: this.table,
        op: this.op ?? "select",
        filters: this.filters,
        payload: this.payload,
        columns: this.columns,
      };
      this.db.ops.push(this.recorded);
    } else {
      this.recorded.op = this.op ?? "select";
      this.recorded.filters = this.filters;
      this.recorded.payload = this.payload;
      this.recorded.columns = this.columns;
    }
    return this.recorded;
  }

  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    this.op ??= "select";
    this.columns = columns;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }
  insert(payload: any) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: any) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: any, _opts?: any) {
    this.op = "upsert";
    this.payload = payload;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  neq(column: string, value: any) {
    this.filters.push({ kind: "neq", column, value });
    return this;
  }
  in(column: string, value: any[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }
  is(column: string, value: any) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  not(column: string, operator: string, value: any) {
    if (operator !== "is")
      throw new Error(`supabase-stub: unhandled .not(${operator})`);
    this.filters.push({ kind: "notis", column, value });
    return this;
  }
  gte(column: string, value: any) {
    this.filters.push({ kind: "gte", column, value });
    return this;
  }
  lte(column: string, value: any) {
    this.filters.push({ kind: "lte", column, value });
    return this;
  }
  gt(column: string, value: any) {
    this.filters.push({ kind: "gt", column, value });
    return this;
  }
  ilike(column: string, value: any) {
    this.filters.push({ kind: "ilike", column, value });
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }) {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitTo = n;
    return this;
  }

  /**
   * The first named column this table does not have, or null.
   *
   * Judged against a DECLARED schema, never against the seeded rows. A fixture
   * row is allowed to be sparse — omitting `position` from a `team_members`
   * fixture says nothing about the column existing — so inferring the schema
   * from the rows would fail specs for a reason that is about the stub. A
   * table with no declaration is not checked at all, and the check says so on
   * its own terms: opt in by naming the table's real columns, cited to the
   * migration that creates them.
   *
   * `*`, embedded resources (`orders(*)`), aliases (`a:b`) and `!inner` hints
   * are skipped rather than guessed at.
   */
  private unknownColumn(): string | null {
    const cols = this.columns;
    const declared = this.db.schema?.[this.table];
    if (!cols || !declared) return null;
    if (/[*():!]/.test(cols)) return null;
    for (const raw of cols.split(",")) {
      const name = raw.trim();
      if (!name || !/^[a-z_][a-z0-9_]*$/i.test(name)) return null;
      if (!declared.includes(name)) return name;
    }
    return null;
  }

  private resolve(): { data: any; error: any; count?: number } {
    this.record();
    const key = `${this.table}:${this.op ?? "select"}`;
    const forced = this.db.errors[key];
    if (forced) return { data: null, error: forced };

    const store = this.rows();

    // PostgREST answers 42703 for a SELECT that names a column the table does
    // not have, exactly as it does for an unknown sort column below — and the
    // caller, if it destructures only `data`, then sees `null` and reads it as
    // "no rows". That is not hypothetical here: `team.service.ts` asked
    // `users` for `avatar_url` (a column `public.users` has never had), so
    // every roster row came back with `linkedUser: null` and the backfill wrote
    // the literal "Team member" into `display_name`. Measured on the demo
    // tenant 2026-09-04, 3 of 3 rows. A stub that ignores the column list
    // cannot fail that test, so it no longer ignores it.
    const unknown = this.unknownColumn();
    if (this.op === "select" && unknown) {
      return {
        data: null,
        error: {
          code: "42703",
          message: `column ${this.table}.${unknown} does not exist`,
        },
      };
    }

    if (this.op === "insert" || this.op === "upsert") {
      const incoming: Row[] = Array.isArray(this.payload)
        ? this.payload
        : [this.payload];
      const written = incoming.map((r) => ({
        id: `stub-${store.length + 1}`,
        // Postgres fills `created_at` from its DEFAULT now(); a stub that
        // leaves it undefined makes an inserted row look like a table with no
        // such column to the sort check below.
        created_at: new Date().toISOString(),
        ...r,
      }));
      store.push(...written);
      return { data: written, error: null };
    }

    const hit = store.filter((r) => matches(r, this.filters));

    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.payload);
      return { data: hit, error: null };
    }
    if (this.op === "delete") {
      for (const r of hit) store.splice(store.indexOf(r), 1);
      return { data: hit, error: null };
    }

    let out = [...hit];
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      // PostgREST does not silently ignore an unknown sort column -- it
      // answers 42703 and returns NO rows. A stub that sorts by `undefined`
      // instead would let `.order("granted_at")` on a table that has no such
      // column pass every test while returning nothing in production.
      if (store.length > 0 && !store.some((r) => column in r)) {
        return {
          data: null,
          error: {
            code: "42703",
            message: `column ${this.table}.${column} does not exist`,
          },
        };
      }
      out.sort((a, b) =>
        a[column] === b[column]
          ? 0
          : (a[column] > b[column] ? 1 : -1) * (ascending ? 1 : -1),
      );
    }
    if (this.limitTo != null) out = out.slice(0, this.limitTo);
    return {
      data: this.headOnly ? null : out,
      error: null,
      ...(this.wantCount ? { count: hit.length } : {}),
    };
  }

  async maybeSingle() {
    const r = this.resolve();
    const data = Array.isArray(r.data) ? (r.data[0] ?? null) : r.data;
    return { ...r, data };
  }
  async single() {
    const r = this.resolve();
    const list = Array.isArray(r.data) ? r.data : r.data ? [r.data] : [];
    if (r.error) return r;
    if (list.length !== 1)
      return {
        data: null,
        error: { message: `stub: .single() matched ${list.length} rows` },
      };
    return { ...r, data: list[0] };
  }
  then<TR1 = any, TR2 = never>(
    onfulfilled?: ((value: any) => TR1 | PromiseLike<TR1>) | null,
    onrejected?: ((reason: any) => TR2 | PromiseLike<TR2>) | null,
  ): PromiseLike<TR1 | TR2> {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
}

/** A `DatabaseService`-shaped object over a stub db. */
export function asDatabaseService(db: StubDb): any {
  // All THREE accessors the real `DatabaseService` exposes. `client` is an
  // alias some services use (`database.service.ts:37`), and a stub that
  // offered only two of the three would fail any service that picked the
  // third — which is a divergence in the harness reported as a defect in the
  // code under test.
  return {
    supabase: db.supabase,
    client: db.supabase,
    getClient: () => db.supabase,
  };
}
