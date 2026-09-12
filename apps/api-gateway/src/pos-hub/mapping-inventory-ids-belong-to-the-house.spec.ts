import { ForbiddenException } from "@nestjs/common";
import { PosHubService } from "./pos-hub.service";
import { CatalogMatcherService } from "./catalog-matcher.service";
import { ToastService } from "../toast/toast.service";
import { ToastWebhookEventType } from "../toast/dto/toast-webhook.dto";

/**
 * ADR 0141, second correction 2026-09-12. A POS glass line poured another
 * house's stock.
 *
 * `pos_item_mappings.inventory_id` is a plain FK to `restaurant_inventory`:
 * nothing ties the item's house to the mapping row's. `upsertItemMapping` --
 * the one writer of that column, behind POST /pos-hub/mappings, the catalog
 * matcher's auto-map and approve, and the sale-unit review -- stored whatever
 * id it was handed. At sale time the hub read the item's volumes with
 * `.in("id", ...)` and NO restaurant filter, and `record_glass_pour` (which
 * takes no restaurant) poured from the id. The Toast webhook had the same
 * shape. A PGlite probe on this tree's migrations wrote a 5-glass sale into
 * the other house.
 *
 * Closed at both places:
 *   - WRITE: `upsertItemMapping` refuses an inventory id that is not the
 *     caller's, before the upsert.
 *   - READ (defence in depth): the depletion paths only pour an id that a
 *     read scoped to the house returned, so a mapping ALREADY stored wrongly
 *     is queued, not poured.
 *
 * Every case pairs a refusal with a CONTROL on the caller's own item, and the
 * mock honours `.eq` / `.in` filters, so an unscoped read returns the foreign
 * row exactly as the database would.
 */

type Row = Record<string, any>;

const HOUSE_A = "restaurant-a";
const HOUSE_B = "restaurant-b";
const ITEM_A = "inventory-of-restaurant-a";
const ITEM_B = "inventory-of-restaurant-b";

const INVENTORY: Row[] = [
  {
    id: ITEM_A,
    restaurant_id: HOUSE_A,
    bottle_size_ml: 750,
    pour_size_ml: 150,
    menu_price_current: 12,
  },
  {
    id: ITEM_B,
    restaurant_id: HOUSE_B,
    bottle_size_ml: 750,
    pour_size_ml: 150,
    menu_price_current: 12,
  },
];

const quietLogger = {
  error: () => {},
  warn: () => {},
  log: () => {},
  debug: () => {},
};

function houseClient(opts: { mappings?: Row[]; proposals?: Row[] } = {}) {
  const calls = {
    mappingUpserts: [] as Row[],
    unresolved: [] as Row[],
    proposalUpdates: [] as Row[],
  };
  const rpc = jest.fn(async (_name: string, _args: Row) => ({
    data: "tx-1",
    error: null,
  }));
  const client: any = {
    rpc,
    from(table: string) {
      const filters: Array<[string, string, any]> = [];
      const source = (): Row[] =>
        table === "restaurant_inventory"
          ? INVENTORY
          : table === "pos_item_mappings"
            ? (opts.mappings ?? [])
            : table === "pos_catalog_match_proposals"
              ? (opts.proposals ?? [])
              : [];
      const rows = () =>
        source().filter((r) =>
          filters.every(([op, col, v]) =>
            op === "eq" ? r[col] === v : (v as unknown[]).includes(r[col]),
          ),
        );
      const q: any = {
        select: () => q,
        eq: (col: string, v: unknown) => {
          filters.push(["eq", col, v]);
          return q;
        },
        in: (col: string, v: unknown[]) => {
          filters.push(["in", col, v]);
          return q;
        },
        neq: () => q,
        is: () => q,
        not: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => {
          const r = rows()[0];
          return r
            ? { data: r, error: null }
            : { data: null, error: { message: "no row" } };
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
        upsert: (row: Row) => {
          calls.mappingUpserts.push(row);
          return {
            select: () => ({ single: async () => ({ data: row, error: null }) }),
          };
        },
        insert: async (row: Row) => {
          if (table === "pos_unresolved_lines") calls.unresolved.push(row);
          return { error: null };
        },
        update: (row: Row) => {
          if (table === "pos_catalog_match_proposals")
            calls.proposalUpdates.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    },
  };
  return { client, calls, rpc };
}

function posHub(client: any): PosHubService {
  const svc = Object.create(PosHubService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = quietLogger;
  return svc as PosHubService;
}

describe("a POS mapping's inventory id is WRITTEN only for the caller's own item", () => {
  it("upsertItemMapping: a foreign inventory id is refused and nothing is upserted", async () => {
    const { client, calls } = houseClient();
    await expect(
      posHub(client).upsertItemMapping(HOUSE_B, {
        external_item_id: "glass-1",
        item_name: "House glass",
        is_wine: true,
        inventory_id: ITEM_A,
        sale_volume_ml: 150,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.mappingUpserts).toHaveLength(0);
  });

  it("upsertItemMapping: the caller's own item is written (control)", async () => {
    const { client, calls } = houseClient();
    await posHub(client).upsertItemMapping(HOUSE_B, {
      external_item_id: "glass-1",
      item_name: "House glass",
      is_wine: true,
      inventory_id: ITEM_B,
      sale_volume_ml: 150,
    });
    expect(calls.mappingUpserts).toHaveLength(1);
    expect(calls.mappingUpserts[0].inventory_id).toBe(ITEM_B);
  });

  it("upsertItemMapping: a mapping with no inventory id still writes (control)", async () => {
    const { client, calls } = houseClient();
    await posHub(client).upsertItemMapping(HOUSE_B, { item_name: "Chips" });
    expect(calls.mappingUpserts).toHaveLength(1);
    expect(calls.mappingUpserts[0].inventory_id).toBeNull();
  });

  function matcher(client: any) {
    const svc = Object.create(CatalogMatcherService.prototype) as any;
    svc.dbService = { getClient: () => client };
    svc.posHub = posHub(client);
    svc.logger = quietLogger;
    return svc as CatalogMatcherService;
  }

  const proposal = (candidate: string): Row => ({
    id: "proposal-1",
    restaurant_id: HOUSE_B,
    source: "simpos",
    external_item_id: "glass-1",
    item_name: "House glass",
    candidate_inventory_id: candidate,
    candidate_master_wine_id: null,
    status: "pending",
  });

  it("approveProposal: a proposal naming a foreign item is refused, no mapping is written and the proposal stays open", async () => {
    const { client, calls } = houseClient({ proposals: [proposal(ITEM_A)] });
    await expect(
      matcher(client).approveProposal(HOUSE_B, "proposal-1", {
        sale_volume_ml: 150,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.mappingUpserts).toHaveLength(0);
    expect(calls.proposalUpdates).toHaveLength(0);
  });

  it("approveProposal: a proposal naming the caller's own item is written and closed (control)", async () => {
    const { client, calls } = houseClient({ proposals: [proposal(ITEM_B)] });
    await matcher(client).approveProposal(HOUSE_B, "proposal-1", {
      sale_volume_ml: 150,
    });
    expect(calls.mappingUpserts).toHaveLength(1);
    expect(calls.proposalUpdates).toEqual([
      expect.objectContaining({ status: "approved" }),
    ]);
  });
});

describe("a mapping ALREADY stored with another house's item cannot pour it", () => {
  const glassLine = (inventoryId: string) => ({
    name: "House glass",
    external_item_id: "glass-1",
    qty: 5,
    price: 12,
    is_wine: true,
    inventory_id: inventoryId,
    sale_unit: "glass",
    sale_volume_ml: 150,
  });
  const check = {
    externalCheckId: "check-1",
    openedAt: "2026-09-12T20:00:00.000Z",
    closedAt: "2026-09-12T21:00:00.000Z",
    voided: false,
    items: [],
  };

  it("PosHubService.applyStockEffects: a foreign item is queued, record_glass_pour is never called", async () => {
    const { client, calls, rpc } = houseClient();
    await (posHub(client) as any).applyStockEffects(
      HOUSE_B,
      "generic_webhook",
      check,
      [glassLine(ITEM_A)],
    );
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.unresolved).toEqual([
      expect.objectContaining({
        restaurant_id: HOUSE_B,
        reason: "unmapped",
        mapped_inventory_id: null,
      }),
    ]);
  });

  it("PosHubService.applyStockEffects: the caller's own item still pours (control)", async () => {
    const { client, calls, rpc } = houseClient();
    await (posHub(client) as any).applyStockEffects(
      HOUSE_B,
      "generic_webhook",
      check,
      [glassLine(ITEM_B)],
    );
    expect(rpc).toHaveBeenCalledWith(
      "record_glass_pour",
      expect.objectContaining({ p_inventory_id: ITEM_B, p_pours: 5 }),
    );
    expect(calls.unresolved).toHaveLength(0);
  });

  function toast(client: any): ToastService {
    const svc = Object.create(ToastService.prototype) as any;
    svc.databaseService = { supabase: client };
    svc.logger = quietLogger;
    return svc as ToastService;
  }

  const toastMapping = (inventoryId: string): Row => ({
    restaurant_id: HOUSE_B,
    source: "toast",
    external_item_id: "toast-item-1",
    item_name: "House glass",
    inventory_id: inventoryId,
    sale_unit: "glass",
  });
  const toastOrder = {
    eventId: "evt-1",
    eventType: ToastWebhookEventType.ORDER_CLOSED,
    restaurantGuid: "toast-rest-b",
    timestamp: "2026-09-12T21:00:00.000Z",
    order: {
      guid: "order-1",
      items: [
        { guid: "toast-item-1", name: "House glass", quantity: 5, unitPrice: 12 },
      ],
    },
  };

  it("ToastService.applyOrderSaleEffects: a foreign item is queued, record_glass_pour is never called", async () => {
    const { client, calls, rpc } = houseClient({
      mappings: [toastMapping(ITEM_A)],
    });
    await (toast(client) as any).applyOrderSaleEffects(HOUSE_B, toastOrder);
    expect(rpc).not.toHaveBeenCalled();
    expect(calls.unresolved).toEqual([
      expect.objectContaining({ restaurant_id: HOUSE_B, source: "toast" }),
    ]);
  });

  it("ToastService.applyOrderSaleEffects: the caller's own item still pours (control)", async () => {
    const { client, calls, rpc } = houseClient({
      mappings: [toastMapping(ITEM_B)],
    });
    await (toast(client) as any).applyOrderSaleEffects(HOUSE_B, toastOrder);
    expect(rpc).toHaveBeenCalledWith(
      "record_glass_pour",
      expect.objectContaining({ p_inventory_id: ITEM_B, p_pours: 5 }),
    );
    expect(calls.unresolved).toHaveLength(0);
  });
});
