/**
 * Test-only: a house, its delivered orders and the reads a spend reader hands
 * PostgREST, for the house-currency specs (`spend-in-house-currency*.spec.ts`).
 * A filter on a column a row does not carry passes, so one row shape serves
 * every reader. A table in `failing` answers an error.
 */
export const HOUSE = "house-1";
export const NOW = new Date("2026-11-12T12:00:00Z");
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 86400000).toISOString();

export type Row = Record<string, any>;

export function db(tables: Record<string, Row[]>, failing = new Set<string>()) {
  const reads: Record<string, number> = {};
  const client = {
    reads,
    rpc: () => Promise.resolve({ data: null, error: { message: "no rpc" } }),
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      const answer = () => {
        reads[table] = (reads[table] ?? 0) + 1;
        return failing.has(table)
          ? {
              data: null,
              error: { code: "57014", message: "timeout" },
              count: null,
            }
          : {
              data: (tables[table] ?? []).filter((r) =>
                filters.every((f) => f(r)),
              ),
              error: null,
              count: null,
            };
      };
      const q: any = {};
      for (const m of [
        "select",
        "order",
        "limit",
        "neq",
        "lt",
        "is",
        "or",
        "not",
        "range",
        "delete",
        "insert",
      ])
        q[m] = () => q;
      q.eq = (c: string, v: unknown) => (
        filters.push((r) => r[c] === undefined || r[c] === v),
        q
      );
      q.in = (c: string, vs: unknown[]) => (
        filters.push((r) => r[c] === undefined || vs.includes(r[c])),
        q
      );
      q.gte = (c: string, v: string) => (
        filters.push((r) => r[c] === undefined || (r[c] != null && r[c] >= v)),
        q
      );
      q.lte = (c: string, v: string) => (
        filters.push((r) => r[c] === undefined || (r[c] != null && r[c] <= v)),
        q
      );
      q.gt = (c: string, v: string) => (
        filters.push((r) => r[c] === undefined || String(r[c]) > v),
        q
      );
      q.maybeSingle = () => {
        const a = answer();
        return Promise.resolve({ data: a.data?.[0] ?? null, error: a.error });
      };
      q.single = q.maybeSingle;
      q.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
      return q;
    },
  };
  return client;
}

export const house = (currency: string | null) => [
  { id: HOUSE, currency, timezone: "UTC" },
];

export function order(
  id: string,
  ago: number,
  cost: number | null,
  currency: string | null,
  over: Row = {},
): Row {
  return {
    id,
    restaurant_id: HOUSE,
    status: "DELIVERED",
    provider_id: "v1",
    providers: { name: "Vendor one" },
    bottles_total: 10,
    quantity: 10,
    total_cost: cost,
    final_price: cost,
    currency,
    created_at: daysAgo(ago + 1),
    delivered_at: daysAgo(ago),
    ...over,
  };
}
