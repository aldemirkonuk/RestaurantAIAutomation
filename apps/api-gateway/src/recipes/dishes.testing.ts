import { DatabaseService } from "../database/database.service";

/**
 * Test-only: two houses' dish rows and a fake supabase client that APPLIES
 * eq / is / in / order / range and PostgREST's 1,000-row cap, so a read that
 * forgets its house filter, its current-version rule or its paging returns a
 * wrong row and the spec sees it (ADR 0366). Imported only by *.spec.ts.
 */

/** PostgREST's row cap, as the fake applies it. */
export const FAKE_PAGE = 1000;

export const HOUSE_A = "11111111-1111-4111-8111-111111111111";
export const HOUSE_B = "22222222-2222-4222-8222-222222222222";
export const TART = "d0000000-0000-4000-8000-0000000000a1";
export const SOUP = "d0000000-0000-4000-8000-0000000000a2";
export const GONE = "d0000000-0000-4000-8000-0000000000a3";
export const B_DISH = "d0000000-0000-4000-8000-0000000000b1";
export const FLOUR = "f0000000-0000-4000-8000-0000000000a1";
export const B_FLOUR = "f0000000-0000-4000-8000-0000000000b1";
export const V_TART_1 = "e0000000-0000-4000-8000-0000000000a1";
export const V_TART_2 = "e0000000-0000-4000-8000-0000000000a2";
export const V_SOUP = "e0000000-0000-4000-8000-0000000000a3";
export const V_GONE = "e0000000-0000-4000-8000-0000000000a4";
export const V_B = "e0000000-0000-4000-8000-0000000000b1";

export type Row = Record<string, any>;

export function fakeDb(rows: Record<string, Row[]>, opts: { rpc?: (name: string, args: Row) => { data?: unknown; error?: unknown }; insertError?: unknown } = {}) {
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const reads: string[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let sortBy: string | null = null;
    let desc = false;
    let window: [number, number] | null = null;
    let head = false;
    let patch: Row | null = null;
    let insert: Row | null = null;
    const hits = () => {
      let out = (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (sortBy) out = [...out].sort((x, y) => (x[sortBy!] < y[sortBy!] ? -1 : x[sortBy!] > y[sortBy!] ? 1 : 0) * (desc ? -1 : 1));
      // PostgREST's cap: never more than PAGE rows in one answer.
      return window ? out.slice(window[0], Math.min(window[1] + 1, window[0] + FAKE_PAGE)) : out.slice(0, FAKE_PAGE);
    };
    const run = () => {
      reads.push(table);
      if (insert) {
        if (opts.insertError) return { data: null, error: opts.insertError };
        const r = { id: "d0000000-0000-4000-8000-00000000new1", ...insert };
        (rows[table] ??= []).push(r);
        return { data: r, error: null };
      }
      if (patch) {
        const hit = hits()[0];
        if (hit) Object.assign(hit, patch);
        return { data: hit ?? null, error: null };
      }
      return head ? { data: null, count: hits().length, error: null } : { data: hits(), error: null };
    };
    const q: any = {
      select: (_c: string, o?: { head?: boolean }) => ((head = !!o?.head), q),
      insert: (r: Row) => ((insert = r), q),
      update: (p: Row) => ((patch = p), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      gt: (c: string, v: unknown) => (filters.push((r) => String(r[c]) > String(v)), q),
      order: (c: string, o?: { ascending?: boolean }) => ((sortBy = c), (desc = o?.ascending === false), q),
      range: (a: number, b: number) => ((window = [a, b]), q),
      limit: () => q,
      maybeSingle: async () => {
        const out = run() as { data: unknown; error: unknown };
        return { data: Array.isArray(out.data) ? (out.data[0] ?? null) : out.data, error: out.error };
      },
      single: async () => run(),
      then: (ok: (v: unknown) => unknown) => ok(run()),
    };
    return q;
  };
  const client = {
    from,
    rpc: async (name: string, args: Row) => (rpcCalls.push({ name, args }), { data: null, error: null, ...opts.rpc?.(name, args) }),
  };
  return { db: { getClient: () => client } as unknown as DatabaseService, rpcCalls, reads };
}

export const line = (id: string, version: string, house: string, position: number, label: string, item: string | null, extra: Row = {}) => ({
  id, version_id: version, restaurant_id: house, position, role: "stocked", inventory_id: item, label,
  qty_entered: 250, unit_code: "g", qty_base: 250_000, base_unit: "mg", ...extra,
});

export function twoHouses(): Record<string, Row[]> {
  return {
    dishes: [
      { id: TART, restaurant_id: HOUSE_A, name: "Lemon tart", menu_section: "Desserts", price: 9, description: null, deleted_at: null },
      { id: SOUP, restaurant_id: HOUSE_A, name: "Bread soup", menu_section: null, price: null, description: null, deleted_at: null },
      { id: GONE, restaurant_id: HOUSE_A, name: "Retired pie", menu_section: null, price: 5, description: null, deleted_at: "2026-10-01" },
      { id: B_DISH, restaurant_id: HOUSE_B, name: "B-ONLY flan", menu_section: null, price: 777, description: null, deleted_at: null },
    ],
    recipe_current_dish: [
      { dish_id: TART, version_id: V_TART_2, restaurant_id: HOUSE_A },
      { dish_id: SOUP, version_id: V_SOUP, restaurant_id: HOUSE_A },
      { dish_id: GONE, version_id: V_GONE, restaurant_id: HOUSE_A },
      { dish_id: B_DISH, version_id: V_B, restaurant_id: HOUSE_B },
    ],
    recipe_versions: [
      { id: V_TART_1, restaurant_id: HOUSE_A, dish_id: TART, owner_kind: "dish", version: 1, yield_serves: 4, created_at: "2026-11-01" },
      { id: V_TART_2, restaurant_id: HOUSE_A, dish_id: TART, owner_kind: "dish", version: 2, yield_serves: 8, created_at: "2026-11-02" },
      { id: V_SOUP, restaurant_id: HOUSE_A, dish_id: SOUP, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
      { id: V_GONE, restaurant_id: HOUSE_A, dish_id: GONE, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
      { id: V_B, restaurant_id: HOUSE_B, dish_id: B_DISH, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" },
    ],
    recipe_lines: [
      // Tart v1 used flour; v2 (current) uses flour twice and lemons; soup does not use flour now.
      line("l1", V_TART_1, HOUSE_A, 1, "Old flour line", FLOUR, { qty_entered: 999 }),
      line("l2", V_TART_2, HOUSE_A, 1, "Flour", FLOUR),
      line("l3", V_TART_2, HOUSE_A, 2, "Lemons", null, { qty_entered: 3, unit_code: "each", qty_base: 3000, base_unit: "each_milli" }),
      line("l4", V_TART_2, HOUSE_A, 3, "Flour for the base", FLOUR, { qty_entered: 50, qty_base: 50_000 }),
      line("l5", V_SOUP, HOUSE_A, 1, "Stale bread", null),
      line("l6", V_GONE, HOUSE_A, 1, "Flour", FLOUR),
      line("l7", V_B, HOUSE_B, 1, "B-SECRET flour", FLOUR),
    ],
    restaurant_inventory: [
      { id: FLOUR, restaurant_id: HOUSE_A, display_name: "Bread Flour", kind: "food", uom: "kg", bottle_size_ml: null, last_purchase_price: 2, is_active: true, deleted_at: null },
      { id: B_FLOUR, restaurant_id: HOUSE_B, display_name: "Lemons", kind: "food", uom: "each", bottle_size_ml: null, last_purchase_price: 1, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a2", restaurant_id: HOUSE_A, display_name: "Tonic  Water", kind: "mixer", uom: "bottle", bottle_size_ml: 200, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a3", restaurant_id: HOUSE_A, display_name: "Sugar", kind: "food", uom: "g", bottle_size_ml: null, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a4", restaurant_id: HOUSE_A, display_name: "sugar", kind: "food", uom: "kg", bottle_size_ml: null, is_active: true, deleted_at: null },
      { id: "f0000000-0000-4000-8000-0000000000a5", restaurant_id: HOUSE_A, display_name: "Old salt", kind: "food", uom: "g", bottle_size_ml: null, is_active: false, deleted_at: null },
    ],
    inventory_lot_rollup: [],
    users: [],
  };
}
