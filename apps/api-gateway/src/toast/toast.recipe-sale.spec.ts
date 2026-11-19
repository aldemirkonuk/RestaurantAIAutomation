import { ToastService } from "./toast.service";
import { ToastWebhookDto, ToastWebhookEventType } from "./dto/toast-webhook.dto";
import { DatabaseService } from "../database/database.service";

/**
 * Recipe draw, slice 4, Toast door: an order line whose mapping names a drink
 * recipe draws the recipe, and the order's void gives it back under the SAME
 * sale key. The in-memory database filters for real (`eq`, `in`), so a read
 * that forgets the house fails here too.
 */

type Row = Record<string, any>;
const R = "r1";
const NEGRONI = "cocktail-negroni";
const GIN = "inv-gin";

function setup(rpc: (name: string, args: Row) => { data: any; error: any }, tables: Record<string, Row[]> = {}) {
  const data: Record<string, Row[]> = {
    restaurants: [{ id: R, toast_restaurant_guid: "toast-rest-1" }],
    pos_item_mappings: [
      { restaurant_id: R, source: "toast", external_item_id: "item-1", item_name: "Negroni", inventory_id: null, cocktail_id: NEGRONI, sale_unit: null },
    ],
    recipe_current: [{ restaurant_id: R, cocktail_id: NEGRONI, version_id: "v1" }],
    recipe_versions: [{ id: "v1", yield_serves: 1 }],
    recipe_lines: [
      { version_id: "v1", position: 1, role: "stocked", inventory_id: GIN, label: "Gin", qty_base: 600, base_unit: "ml10" },
    ],
    restaurant_inventory: [{ id: GIN, restaurant_id: R, uom: "bottle", bottle_size_ml: 700 }],
    ...tables,
  };
  const rpcCalls: Array<{ name: string; args: Row }> = [];
  const unresolved: Row[] = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let single = false;
    const run = () => {
      const rows = (data[table] ?? []).filter((r) => filters.every((f) => f(r)));
      return { data: single ? (rows[0] ?? null) : rows, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), q),
      order: () => q,
      maybeSingle: async () => ((single = true), run()),
      single: async () => ((single = true), run()),
      insert: (row: Row) => {
        if (table === "pos_unresolved_lines") unresolved.push(row);
        if (table === "events") return { select: () => ({ single: async () => ({ data: { id: "e1" }, error: null }) }) };
        return { error: null };
      },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  const client: any = {
    from,
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, args });
      return rpc(name, args);
    },
  };
  const config: any = {
    get: (k: string, f?: any) => (k === "TOAST_MOCK_MODE" ? true : k === "TOAST_WEBHOOK_SECRET" ? null : f),
  };
  const cache: any = { invalidateByPattern: async () => 0, del: async () => undefined, get: async () => null, set: async () => undefined };
  const service = new ToastService(config, cache, { supabase: client } as unknown as DatabaseService);
  return { service, rpcCalls, unresolved };
}

const dto = (eventType: ToastWebhookEventType, qty = 2): ToastWebhookDto =>
  ({
    eventId: "evt-1",
    eventType,
    restaurantGuid: "toast-rest-1",
    timestamp: new Date().toISOString(),
    order: { guid: "order-1", items: [{ guid: "item-1", name: "Negroni", quantity: qty, unitPrice: 1400 }] },
  }) as ToastWebhookDto;

const booked = { data: { status: "booked", draws: [{ inventory_id: GIN, via: "pour", units: 0 }] }, error: null };

describe("a Toast order line that sells a drink recipe draws it", () => {
  it("books through record_recipe_draw, not the shelf-item path", async () => {
    const t = setup(() => booked);
    await t.service.processWebhook(dto(ToastWebhookEventType.ORDER_CLOSED), "{}", null, null);
    expect(t.rpcCalls.map((c) => c.name)).toEqual(["record_recipe_draw"]);
    const a = t.rpcCalls[0].args;
    expect(a.p_restaurant).toBe(R);
    expect(a.p_cocktail_id).toBe(NEGRONI);
    expect(a.p_sale_key).toBe("toast_sale_order-1_item-1");
    expect(a.p_draws).toHaveLength(1);
    expect(a.p_draws[0].exact_micro).toBe(String(2n * 600n * 1_000_000n));
  });

  it("the void reverses under the sale's own key", async () => {
    const t = setup((name) => (name === "reverse_recipe_draw" ? { data: { status: "returned", draws: [] }, error: null } : booked));
    await t.service.processWebhook(dto(ToastWebhookEventType.ORDER_VOIDED), "{}", null, null);
    expect(t.rpcCalls).toEqual([
      { name: "reverse_recipe_draw", args: { p_restaurant: R, p_sale_key: "toast_sale_order-1_item-1", p_occurred_at: null } },
    ]);
  });

  it("a short shelf queues the line with the reason and the order still processes", async () => {
    const t = setup(() => ({ data: { status: "short", short: [{ inventory_id: GIN, via: "pour", need: 1200, have: 5 }] }, error: null }));
    await t.service.processWebhook(dto(ToastWebhookEventType.ORDER_CLOSED), "{}", null, null);
    expect(t.unresolved).toHaveLength(1);
    expect(t.unresolved[0].reason).toBe("no_sale_volume");
    expect(t.unresolved[0].raw.unresolved_detail).toContain("need 1200, have 5");
  });

  it("an unlinked recipe line queues as unmapped and attempts no write", async () => {
    const t = setup(() => booked, {
      recipe_lines: [{ version_id: "v1", position: 1, role: "stocked", inventory_id: null, label: "Gin", qty_base: 600, base_unit: "ml10" }],
    });
    await t.service.processWebhook(dto(ToastWebhookEventType.ORDER_CLOSED), "{}", null, null);
    expect(t.rpcCalls).toHaveLength(0);
    expect(t.unresolved[0].reason).toBe("unmapped");
  });
});
