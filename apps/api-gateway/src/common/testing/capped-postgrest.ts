/**
 * Test-only stand-in for PostgREST's row cap (reports lane r3): never more
 * than 1,000 rows a response, an exact count when one is asked for, and the
 * filters a reader hands it. `failOn(table, n)` fails the n-th request to a
 * table, so a reader can be shown refusing on a later page.
 */
export type CappedRow = Record<string, any>;

export function cappedPostgrest(
  tables: Record<string, CappedRow[]>,
  failOn?: (table: string, call: number) => boolean,
  cap = 1000,
) {
  const calls: Record<string, number> = {};
  return {
    calls,
    from(table: string) {
      const filters: ((r: CappedRow) => boolean)[] = [];
      let counted = false;
      let orderBy: string | null = null;
      let limit = Infinity;
      const keep = (f: (r: CappedRow) => boolean) => (filters.push(f), q);
      const q: any = {
        select: (_cols: string, opts?: { count?: string }) => ((counted = opts?.count === "exact"), q),
        eq: (c: string, v: unknown) => keep((r) => r[c] === v),
        in: (c: string, vs: unknown[]) => keep((r) => vs.includes(r[c])),
        gte: (c: string, v: string) => keep((r) => r[c] != null && r[c] >= v),
        lte: (c: string, v: string) => keep((r) => r[c] != null && r[c] <= v),
        lt: (c: string, v: string) => keep((r) => r[c] != null && r[c] < v),
        gt: (c: string, v: string) => keep((r) => r[c] != null && String(r[c]) > v),
        // PostgREST's `or=(a.gte.x,b.gte.y)`: a row passes when any clause does.
        or: (expr: string) =>
          keep((r) =>
            expr.split(",").some((clause) => {
              const [c, op, ...rest] = clause.split(".");
              const v = rest.join(".");
              if (r[c] == null) return false;
              if (op === "gte") return r[c] >= v;
              if (op === "lte") return r[c] <= v;
              if (op === "eq") return String(r[c]) === v;
              throw new Error(`cappedPostgrest: or() does not know ${op}`);
            }),
          ),
        order: (c: string) => ((orderBy = c), q),
        limit: (n: number) => ((limit = n), q),
        then: (res: any, rej: any) => {
          const n = (calls[table] = (calls[table] ?? 0) + 1);
          if (failOn?.(table, n))
            return Promise.resolve({ data: null, error: { code: "57014", message: "timeout" }, count: null }).then(res, rej);
          const all = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (orderBy) {
            const k = orderBy;
            all.sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : String(a[k]) > String(b[k]) ? 1 : 0));
          }
          return Promise.resolve({
            data: all.slice(0, Math.min(limit, cap)),
            error: null,
            count: counted ? all.length : null,
          }).then(res, rej);
        },
      };
      return q;
    },
  };
}
