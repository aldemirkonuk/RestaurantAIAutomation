/**
 * Chainable Supabase stub shared by the dashboard-signals specs.
 *
 * Two things it does that the older per-file stubs do not:
 *
 *  1. It APPLIES the filters, not just records them. A stub that returns every
 *     fixture row regardless of `.eq("restaurant_id", …)` cannot fail a
 *     cross-tenant leak — it hands the service another restaurant's rows and
 *     the service happily reports them. Spec §6 is the one item the investor
 *     called "cheap now, ruinous later", so the harness has to be able to
 *     catch it: fixtures carry rows for a second restaurant, and a service
 *     that forgets the filter returns them.
 *
 *  2. It RECORDS every builder call, so a spec can additionally assert that
 *     the filter was applied at the DATABASE, not in JavaScript after the
 *     fact. Both matter — filtering in memory still ships every tenant's rows
 *     over the wire.
 *
 * It mints a fresh builder per `.from()` call rather than sharing one: these
 * services fan several queries out through `Promise.all`, so a shared "current
 * table" would be overwritten by the last caller before any of them awaited.
 */

export interface RecordedCall {
  table: string;
  /** Every chained method, in call order, with its arguments. */
  filters: Array<{ method: string; args: any[] }>;
}

export interface SupabaseStub {
  client: any;
  calls: RecordedCall[];
  /** Every recorded call against one table. */
  callsFor(table: string): RecordedCall[];
  /** True when at least one call on `table` filtered `eq(column, value)`. */
  filtered(table: string, column: string, value?: any): boolean;
}

const PASSTHROUGH = [
  "select",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "or",
  "not",
  "order",
  "limit",
  "range",
  "in",
  "contains",
  "overlaps",
];

const WRITE_METHODS = ["insert", "update", "upsert", "delete"];

/**
 * Applies the subset of PostgREST filter semantics these services use.
 *
 * A column absent from every fixture row is treated as "not modelled here" and
 * the filter is skipped — otherwise every spec would have to spell out
 * `deleted_at: null` and `is_active: true` on every fixture just to survive
 * guard clauses that are not what the spec is about.
 */
function applyFilters(rows: any[], filters: RecordedCall["filters"]): any[] {
  let out = rows;
  let limit: number | null = null;

  const known = (col: string) => rows.some((r) => r && col in r);

  for (const f of filters) {
    const [a, b, c] = f.args;
    switch (f.method) {
      case "eq":
        if (known(a)) out = out.filter((r) => r[a] === b);
        break;
      case "neq":
        if (known(a)) out = out.filter((r) => r[a] !== b);
        break;
      case "in":
        if (known(a)) out = out.filter((r) => (b as any[]).includes(r[a]));
        break;
      case "is":
        if (known(a) && b === null)
          out = out.filter((r) => r[a] === null || r[a] === undefined);
        break;
      case "not":
        if (known(a) && b === "is" && c === null)
          out = out.filter((r) => r[a] !== null && r[a] !== undefined);
        break;
      case "gte":
        if (known(a)) out = out.filter((r) => r[a] >= b);
        break;
      case "lt":
        if (known(a)) out = out.filter((r) => r[a] < b);
        break;
      case "gt":
        if (known(a)) out = out.filter((r) => r[a] > b);
        break;
      case "lte":
        if (known(a)) out = out.filter((r) => r[a] <= b);
        break;
      case "limit":
        limit = a;
        break;
      default:
        break;
    }
  }

  return limit === null ? out : out.slice(0, limit);
}

/**
 * @param rowsByTable rows each table resolves to.
 * @param writes optional per-table result for insert/update/upsert/delete.
 */
export function makeSupabaseStub(
  rowsByTable: Record<string, any[]>,
  writes: Record<string, { data?: any; error?: any }> = {},
): SupabaseStub {
  const calls: RecordedCall[] = [];

  const from = jest.fn((table: string) => {
    const record: RecordedCall = { table, filters: [] };
    calls.push(record);

    const builder: any = {};
    for (const method of [...PASSTHROUGH, ...WRITE_METHODS]) {
      builder[method] = jest.fn((...args: any[]) => {
        record.filters.push({ method, args });
        return builder;
      });
    }

    const settle = () => {
      const isWrite = record.filters.some((f) =>
        WRITE_METHODS.includes(f.method),
      );
      const write = writes[table];
      if (isWrite) {
        return Promise.resolve({
          data: write?.data ?? null,
          error: write?.error ?? null,
        });
      }
      return Promise.resolve({
        data: applyFilters(rowsByTable[table] ?? [], record.filters),
        error: null,
      });
    };

    builder.single = jest.fn(() =>
      settle().then((r: any) => ({
        data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data,
        error: r.error,
      })),
    );
    builder.maybeSingle = builder.single;
    builder.then = (resolve: any, reject: any) =>
      settle().then(resolve, reject);

    return builder;
  });

  const callsFor = (table: string) => calls.filter((c) => c.table === table);

  return {
    client: { from, rpc: jest.fn() },
    calls,
    callsFor,
    filtered: (table: string, column: string, value?: any) =>
      callsFor(table).some((c) =>
        c.filters.some(
          (f) =>
            f.method === "eq" &&
            f.args[0] === column &&
            (value === undefined || f.args[1] === value),
        ),
      ),
  };
}
