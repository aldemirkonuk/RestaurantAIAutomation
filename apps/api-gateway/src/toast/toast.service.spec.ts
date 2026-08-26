import { ToastService } from "./toast.service";
import { DatabaseService } from "../database/database.service";
import {
  ToastWebhookDto,
  ToastWebhookEventType,
} from "./dto/toast-webhook.dto";

/**
 * SimPOS testbed plan — ingress mapping resolution (decisions B21/B22) and
 * void reversal (B19): the real Toast production depletion path now reads
 * pos_item_mappings (not the retired toast_item_mappings), never infers
 * sale unit from the item name, reverses glass voids instead of skipping
 * them, and queues an unmapped line instead of dropping it.
 */

type Row = Record<string, any>;

function makeSupabase(opts: { mapping?: Row | null; inventory?: Row | null }) {
  const calls = {
    rpc: [] as any[],
    unresolvedInserts: [] as any[],
    mappingQueries: [] as any[],
  };

  const client: any = {
    from(table: string) {
      const q: any = {
        select(cols: string) {
          if (table === "pos_item_mappings") calls.mappingQueries.push(cols);
          return q;
        },
        eq: () => q,
        in: () => q,
        insert(row: Row) {
          if (table === "pos_unresolved_lines") {
            calls.unresolvedInserts.push(row);
            return { error: null };
          }
          if (table === "events")
            return {
              select: () => ({
                single: async () => ({ data: { id: "evt-1" }, error: null }),
              }),
            };
          return { error: null };
        },
        maybeSingle: async () => {
          if (table === "restaurants")
            return { data: { id: "r1" }, error: null };
          if (table === "pos_item_mappings")
            return { data: opts.mapping ?? null, error: null };
          if (table === "restaurant_inventory")
            return { data: opts.inventory ?? null, error: null };
          return { data: null, error: null };
        },
        single: async () => {
          if (table === "restaurants")
            return { data: { id: "r1" }, error: null };
          return { data: null, error: null };
        },
      };
      return q;
    },
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return { data: "tx-1", error: null };
    },
  };

  return { client, calls };
}

function makeService(opts: { mapping?: Row | null; inventory?: Row | null }) {
  const { client, calls } = makeSupabase(opts);
  const configService: any = {
    get: (key: string, fallback?: any) => {
      if (key === "TOAST_MOCK_MODE") return true;
      if (key === "TOAST_WEBHOOK_SECRET") return null;
      return fallback;
    },
  };
  const cacheService: any = {
    invalidateByPattern: async () => 0,
    del: async () => undefined,
    get: async () => null,
    set: async () => undefined,
  };
  const databaseService = { supabase: client } as unknown as DatabaseService;
  const service = new ToastService(
    configService,
    cacheService,
    databaseService,
  );
  return { service, calls };
}

function webhookDto(
  eventType: ToastWebhookEventType,
  itemOverrides: Row = {},
): ToastWebhookDto {
  return {
    eventId: "evt-1",
    eventType,
    restaurantGuid: "toast-rest-1",
    timestamp: new Date().toISOString(),
    order: {
      guid: "order-1",
      items: [
        {
          guid: "item-1",
          name: "Caymus Cabernet",
          quantity: 2,
          unitPrice: 2400,
          ...itemOverrides,
        },
      ],
    },
  } as ToastWebhookDto;
}

describe("ToastService.applyOrderSaleEffects (via processWebhook)", () => {
  it("resolves via pos_item_mappings (not toast_item_mappings) and depletes a bottle sale", async () => {
    const { service, calls } = makeService({
      mapping: {
        inventory_id: "inv-1",
        sale_unit: "bottle",
        item_name: "Caymus Cabernet",
      },
    });

    await service.processWebhook(
      webhookDto(ToastWebhookEventType.ORDER_CLOSED),
      "{}",
      null,
      null,
    );

    expect(calls.mappingQueries[0]).toContain("inventory_id");
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("apply_stock_movement");
    expect(calls.rpc[0].args.p_delta).toBe(-2);
  });

  it("never infers glass from the item name — only the mapping's sale_unit (B36)", async () => {
    const { service, calls } = makeService({
      mapping: {
        inventory_id: "inv-1",
        sale_unit: "bottle",
        item_name: "Caymus Cabernet glass",
      },
    });

    await service.processWebhook(
      webhookDto(ToastWebhookEventType.ORDER_CLOSED, {
        name: "Caymus Cabernet by the glass",
      }),
      "{}",
      null,
      null,
    );

    // sale_unit on the mapping says bottle, so despite "glass" in the name,
    // it must deplete as a bottle via apply_stock_movement.
    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("apply_stock_movement");
  });

  it("reverses a glass void via apply_stock_movement instead of skipping it (B19)", async () => {
    const { service, calls } = makeService({
      mapping: {
        inventory_id: "inv-1",
        sale_unit: "glass",
        item_name: "Caymus Cabernet",
      },
    });

    await service.processWebhook(
      webhookDto(ToastWebhookEventType.ORDER_VOIDED),
      "{}",
      null,
      null,
    );

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("apply_stock_movement");
    expect(calls.rpc[0].args.p_delta).toBe(2);
    expect(calls.rpc[0].args.p_transaction_type).toBe("return");
  });

  it("queues an unmapped line in pos_unresolved_lines instead of dropping it (B20)", async () => {
    const { service, calls } = makeService({ mapping: null, inventory: null });

    await service.processWebhook(
      webhookDto(ToastWebhookEventType.ORDER_CLOSED),
      "{}",
      null,
      null,
    );

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(1);
    expect(calls.unresolvedInserts[0].source).toBe("toast");
    expect(calls.unresolvedInserts[0].external_item_id).toBe("item-1");
  });
});

describe("ToastService webhook signature enforcement in production", () => {
  // TOAST_MOCK_MODE defaults to TRUE, and until 2026-08-25 mock mode also
  // bypassed signature checking — so a production deploy that never set the
  // variable accepted unsigned stock mutations from anyone. These tests pin
  // the closed escape: in production, unsigned webhooks are rejected no
  // matter what mock mode says. Dev/test keep the mock-mode ergonomics.
  const prodEnv = () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    return () => {
      process.env.NODE_ENV = prev;
    };
  };

  it("rejects an unsigned webhook in production even in mock mode (no secret)", async () => {
    const restore = prodEnv();
    try {
      const { service } = makeService({});
      await expect(
        service.processWebhook(
          webhookDto(ToastWebhookEventType.ORDER_CLOSED),
          "{}",
          null,
          null,
        ),
      ).rejects.toThrow("TOAST_WEBHOOK_SECRET is not configured");
    } finally {
      restore();
    }
  });

  it("rejects an unsigned webhook in production when a secret IS configured", async () => {
    const restore = prodEnv();
    try {
      const { client } = ((): any => makeSupabase({}))();
      const configService: any = {
        get: (key: string, fallback?: any) => {
          if (key === "TOAST_MOCK_MODE") return true;
          if (key === "TOAST_WEBHOOK_SECRET") return "real-secret";
          return fallback;
        },
      };
      const cacheService: any = {
        invalidateByPattern: async () => 0,
        del: async () => undefined,
        get: async () => null,
        set: async () => undefined,
      };
      const service = new ToastService(
        configService,
        cacheService,
        { supabase: client } as any,
      );
      await expect(
        service.processWebhook(
          webhookDto(ToastWebhookEventType.ORDER_CLOSED),
          "{}",
          null,
          null,
        ),
      ).rejects.toThrow("Missing webhook signature");
    } finally {
      restore();
    }
  });

  it("still accepts unsigned webhooks in mock mode outside production", async () => {
    // Dev ergonomics are the reason the mock escape exists; losing them
    // silently would push people to disable verification some other way.
    const { service } = makeService({});
    const res = await service.processWebhook(
      webhookDto(ToastWebhookEventType.ORDER_CLOSED),
      "{}",
      null,
      null,
    );
    expect(res.status).not.toBe("error");
  });
});

/**
 * CodeQL js/request-forgery, open since 2026-07-08.
 *
 * getMenu/getOrder interpolate a route param into the outbound orchestrator URL. Express
 * decodes route params, so `%2f` becomes a real slash after routing has matched and
 * `..%2f..%2f…` escapes the /toast/ prefix into the internal service.
 */
describe("Toast id validation (SSRF)", () => {
  function nonMockService() {
    const configService: any = {
      // Mock mode short-circuits before the HTTP call, so the guard must be proven with
      // it OFF — otherwise the test passes for the wrong reason.
      get: (key: string, fallback?: any) =>
        key === "TOAST_MOCK_MODE" ? false : fallback,
    };
    const cacheService: any = {
      get: async () => null,
      set: async () => undefined,
      del: async () => undefined,
      invalidateByPattern: async () => 0,
    };
    const service = new ToastService(
      configService,
      cacheService,
      { supabase: {} } as unknown as DatabaseService,
    );
    const get = jest.fn();
    (service as any).httpClient = { get };
    return { service, get };
  }

  it.each([
    "../../agents/execute",
    "..%2f..%2fagents",
    "..",
    "a/b",
    "http://evil.com",
  ])("getMenu refuses %s without issuing a request", async (bad) => {
    const { service, get } = nonMockService();
    await expect(service.getMenu(bad)).rejects.toThrow("Invalid menu id");
    expect(get).not.toHaveBeenCalled();
  });

  it.each(["../../agents/execute", "..", "a/b"])(
    "getOrder refuses %s without issuing a request",
    async (bad) => {
      const { service, get } = nonMockService();
      await expect(service.getOrder(bad)).rejects.toThrow("Invalid order id");
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("still fetches a legitimate GUID", async () => {
    const { service, get } = nonMockService();
    get.mockResolvedValue({ data: { guid: "abc" } });
    await service.getMenu("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(get.mock.calls[0][0]).toBe(
      "/api/v1/toast/menus/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
    );
  });
});
