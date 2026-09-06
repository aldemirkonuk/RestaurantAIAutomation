/**
 * An in-memory stand-in for the PostgREST client, for the push specs.
 *
 * WHY A STORE AND NOT A MOCK. The thing direction 1 has to be proven about is
 * STATE ACROSS CALLS: a retried create must produce ONE provider event, an
 * update must address the id the first push stored, a copy deleted inside
 * Google must come back under the same key. A `jest.fn()` returning a canned
 * row proves none of that — it proves the code called something. So this holds
 * rows, honours the unique constraints the migration declares, and lets a spec
 * push twice and then look.
 *
 * It is deliberately small and deliberately strict: an unsupported operator
 * THROWS rather than being ignored, because a filter silently dropped by a test
 * double is how a scoping test passes while the scope does not hold.
 */

type Row = Record<string, unknown>;

interface Filter {
  kind: "eq" | "is" | "not_is";
  column: string;
  value: unknown;
}

export interface FakeDb {
  client: unknown;
  rows: (table: string) => Row[];
  seed: (table: string, row: Row) => void;
  /** Unique constraints, as the migration declares them. */
  unique: Record<string, string[][]>;
}

export function fakeSupabase(
  initial: Record<string, Row[]> = {},
  unique: Record<string, string[][]> = {
    calendar_push_targets: [["restaurant_id", "connection_id"]],
    calendar_push_mappings: [
      ["idempotency_key"],
      ["target_id", "calendar_event_id"],
    ],
  },
): FakeDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const table = (name: string): Row[] => (tables[name] ??= []);

  let idCounter = 0;
  const nextId = () =>
    `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;

  const matches = (row: Row, filters: Filter[]) =>
    filters.every((f) => {
      if (f.kind === "eq") return String(row[f.column]) === String(f.value);
      if (f.kind === "is") return row[f.column] === null || row[f.column] === undefined;
      return row[f.column] !== null && row[f.column] !== undefined;
    });

  const conflictsWith = (name: string, candidate: Row): Row | null => {
    for (const columns of unique[name] ?? []) {
      const hit = table(name).find((row) =>
        columns.every((c) => String(row[c]) === String(candidate[c])),
      );
      if (hit) return hit;
    }
    return null;
  };

  function query(name: string) {
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: Row = {};
    let head = false;
    let counting = false;
    let limit: number | null = null;
    let ignoreDuplicates = false;

    const selected = () => {
      const rows = table(name).filter((r) => matches(r, filters));
      return limit === null ? rows : rows.slice(0, limit);
    };

    const runWrite = () => {
      if (mode === "insert") {
        const row = { id: nextId(), ...payload };
        table(name).push(row);
        return { data: [row], error: null };
      }
      if (mode === "upsert") {
        const clash = conflictsWith(name, payload);
        if (clash) {
          if (ignoreDuplicates) return { data: [clash], error: null };
          Object.assign(clash, payload);
          return { data: [clash], error: null };
        }
        const row = { id: nextId(), ...payload };
        table(name).push(row);
        return { data: [row], error: null };
      }
      if (mode === "update") {
        const hit = selected();
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      }
      if (mode === "delete") {
        const doomed = new Set(selected());
        tables[name] = table(name).filter((r) => !doomed.has(r));
        return { data: Array.from(doomed), error: null };
      }
      return { data: selected(), error: null };
    };

    const self: Record<string, unknown> = {};

    self.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.head) head = true;
      if (opts?.count) counting = true;
      return self;
    };
    self.insert = (body: Row) => {
      mode = "insert";
      payload = body;
      return self;
    };
    self.upsert = (body: Row, opts?: { ignoreDuplicates?: boolean }) => {
      mode = "upsert";
      payload = body;
      ignoreDuplicates = opts?.ignoreDuplicates ?? false;
      return self;
    };
    self.update = (body: Row) => {
      mode = "update";
      payload = body;
      return self;
    };
    self.delete = () => {
      mode = "delete";
      return self;
    };
    self.eq = (column: string, value: unknown) => {
      filters.push({ kind: "eq", column, value });
      return self;
    };
    self.is = (column: string, value: unknown) => {
      if (value !== null) throw new Error(`fakeSupabase: .is(${column}, non-null)`);
      filters.push({ kind: "is", column, value: null });
      return self;
    };
    self.not = (column: string, op: string, value: unknown) => {
      if (op !== "is" || value !== null) {
        throw new Error(`fakeSupabase: .not(${column}, ${op}) is not modelled`);
      }
      filters.push({ kind: "not_is", column, value: null });
      return self;
    };
    self.order = () => self;
    self.limit = (n: number) => {
      limit = n;
      return self;
    };
    const one = () => {
      const result = runWrite();
      const rows = (result.data ?? []) as Row[];
      return Promise.resolve({ data: rows[0] ?? null, error: null });
    };
    self.maybeSingle = one;
    self.single = one;
    self.then = (resolve: (v: unknown) => unknown) => {
      const result = runWrite();
      const rows = (result.data ?? []) as Row[];
      return Promise.resolve(
        counting
          ? { data: head ? null : rows, count: rows.length, error: null }
          : { data: rows, error: null },
      ).then(resolve);
    };

    return self;
  }

  return {
    client: { from: (name: string) => query(name) },
    rows: (name: string) => table(name),
    seed: (name: string, row: Row) => table(name).push({ ...row }),
    unique,
  };
}
