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
      const service = new ToastService(configService, cacheService, {
        supabase: client,
      } as any);
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
    const service = new ToastService(configService, cacheService, {
      supabase: {},
    } as unknown as DatabaseService);
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

/**
 * ADR 0020 (no fabricated answers, LOCKED) applied to the Toast DATA paths.
 *
 * The webhook-signature escape was closed in production on 2026-08-25; the same
 * reasoning was never applied to the five endpoints that RETURN data. Because
 * TOAST_MOCK_MODE is not set in the production Railway environment, its TRUE
 * default was live, and production served fabricated menus, orders and sales
 * figures — including a fake "success" for an order never placed at a vendor.
 *
 * These tests pin the close. Each one fails on the pre-fix tree by receiving
 * mock data where it now expects a refusal.
 */
describe("Toast mock data is unreachable in production (ADR 0020)", () => {
  /**
   * Simulates the REAL production environment: TOAST_MOCK_MODE genuinely unset,
   * so ConfigService returns the declared fallback. Passing `true` explicitly
   * would test a different, less dangerous configuration.
   */
  function serviceWithUnsetMockMode() {
    const configService: any = {
      get: (_key: string, fallback?: any) => fallback,
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
    // Proves the fallback really is TRUE — i.e. these tests exercise the
    // dangerous path and not an accidentally-safe one.
    expect((service as any).mockMode).toBe(true);
    return service;
  }

  const withNodeEnv = (value: string | undefined) => {
    const prev = process.env.NODE_ENV;
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    return () => {
      process.env.NODE_ENV = prev;
    };
  };

  const orderDto: any = {
    items: [{ itemGuid: "item-1", name: "Opus One", quantity: 1, unitPrice: 4500 }],
    tableName: "Table 5",
    serverName: "Alex",
  };

  describe("with NODE_ENV=production and TOAST_MOCK_MODE unset", () => {
    let restore: () => void;
    beforeEach(() => {
      restore = withNodeEnv("production");
    });
    afterEach(() => restore());

    it("GET /toast/menus refuses instead of returning mock menus", async () => {
      const service = serviceWithUnsetMockMode();
      await expect(service.getMenus("r1")).rejects.toThrow(
        /Toast is not connected/,
      );
    });

    it("GET /toast/menus/:menuId refuses instead of returning a mock menu", async () => {
      const service = serviceWithUnsetMockMode();
      await expect(service.getMenu("menu-wine-001")).rejects.toThrow(
        /Toast is not connected/,
      );
    });

    it("POST /toast/orders refuses and says NOTHING WAS PLACED", async () => {
      // The false success on an acting path: pre-fix this resolved with a
      // convincing `mock-order-<ts>` guid and status OPEN, telling the owner an
      // order existed at a vendor that had never heard of it.
      const service = serviceWithUnsetMockMode();
      await expect(service.createOrder("r1", orderDto)).rejects.toThrow(
        /was NOT sent and nothing was placed/,
      );
    });

    it("GET /toast/orders/:orderId refuses instead of returning a mock order", async () => {
      const service = serviceWithUnsetMockMode();
      await expect(
        service.getOrder("3f2504e0-4f89-11d3-9a0c-0305e82c3301"),
      ).rejects.toThrow(/Toast is not connected/);
    });

    it("GET /toast/sales refuses instead of returning fabricated revenue", async () => {
      const service = serviceWithUnsetMockMode();
      await expect(
        service.getSalesData("r1", new Date(0), new Date(3600000)),
      ).rejects.toThrow(/Toast is not connected/);
    });

    it("refuses with 503, not a silent 200 and not an empty list", async () => {
      // ADR 0020: an error must never render as emptiness. Assert the shape of
      // the refusal, not just that something was thrown.
      const service = serviceWithUnsetMockMode();
      await expect(service.getSalesData("r1", new Date(0), new Date(1)))
        .rejects.toMatchObject({ status: 503 });
      await expect(service.createOrder("r1", orderDto)).rejects.toMatchObject({
        status: 503,
      });
    });
  });

  describe("outside production, mock mode still works", () => {
    // Deleting dev ergonomics would push people to work around the close.
    let restore: () => void;
    beforeEach(() => {
      restore = withNodeEnv("development");
    });
    afterEach(() => restore());

    it("serves mock menus, menu-by-id, orders and sales", async () => {
      const service = serviceWithUnsetMockMode();

      const menus = await service.getMenus("r1");
      expect(menus.menus.length).toBeGreaterThan(0);

      const menu = await service.getMenu(menus.menus[0].guid);
      expect(menu.guid).toBe(menus.menus[0].guid);

      const created = await service.createOrder("r1", orderDto);
      expect(created.guid).toMatch(/^mock-order-/);

      const fetched = await service.getOrder(
        "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      );
      expect(fetched.guid).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");

      const sales = await service.getSalesData(
        "r1",
        new Date(0),
        new Date(3600000),
      );
      expect(sales.sales.length).toBeGreaterThan(0);
    });
  });

  /**
   * A second, independent fabrication path found while fixing the first:
   * getMenus and getSalesData CAUGHT an orchestrator failure and returned mock
   * data — with mock mode correctly OFF. A real Toast integration plus one
   * network blip served invented menus and invented revenue, unmarked.
   */
  describe("a failed upstream fetch fails loudly rather than falling back to mock", () => {
    function realModeServiceWithFailingHttp() {
      const configService: any = {
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
      (service as any).httpClient = {
        get: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      };
      return service;
    }

    it("getMenus throws rather than returning mock menus", async () => {
      const service = realModeServiceWithFailingHttp();
      await expect(service.getMenus("r1")).rejects.toThrow(
        /Failed to fetch menus from Toast/,
      );
    });

    it("getSalesData throws rather than feeding analytics invented revenue", async () => {
      const service = realModeServiceWithFailingHttp();
      await expect(
        service.getSalesData("r1", new Date(0), new Date(3600000)),
      ).rejects.toThrow(/Failed to fetch sales data from Toast/);
    });
 * Defect A — the dead orchestrator forward.
 *
 * `forwardToOrchestrator()` POSTed every order and stock webhook to
 * `/api/v1/toast/webhooks/{type}`. The orchestrator has never registered an
 * `/api/v1/toast` router (`services/agent-orchestrator/main.py:151-186`), so
 * the call 404'd every single time and the catch downgraded a permanent
 * misconfiguration to `logger.warn(...)` — invisible.
 *
 * The forward is deleted (see the block comment in toast.service.ts for why
 * repointing at `/api/v1/pos/webhook/toast` is wrong). These tests pin that:
 * no outbound POST is issued at all, so there is no 404 left to swallow.
 *
 * Against the pre-fix tree both of the first two tests fail — `post` IS called.
 */
describe("Defect A — no silently-swallowed forward to the orchestrator", () => {
  function spyingHttpClient(service: any) {
    // Rejects the way axios rejects a 404, so that if the forward ever comes
    // back, it comes back into a test that is already watching for the swallow.
    const err: any = new Error("Request failed with status code 404");
    err.response = { status: 404, data: { detail: "Not Found" } };
    const post = jest.fn().mockRejectedValue(err);
    const get = jest.fn().mockRejectedValue(err);
    service.httpClient = { post, get };
    return { post, get };
  }

  it("processes an order webhook without POSTing to the non-existent /api/v1/toast/webhooks route", async () => {
    const { service, calls } = makeService({
      mapping: {
        inventory_id: "inv-1",
        sale_unit: "bottle",
        item_name: "Caymus Cabernet",
      },
    });
    const { post } = spyingHttpClient(service);

    const res = await service.processWebhook(
      webhookDto(ToastWebhookEventType.ORDER_CLOSED),
      "{}",
      null,
      null,
    );

    // The real work still happens…
    expect(res.status).toBe("processed");
    expect(calls.rpc).toHaveLength(1);
    // …and nothing is fired at a route that does not exist.
    expect(post).not.toHaveBeenCalled();
  });

  it("processes a stock webhook without POSTing to the non-existent /api/v1/toast/webhooks route", async () => {
    const { service } = makeService({});
    const { post } = spyingHttpClient(service);

    const res = await service.processWebhook(
      {
        eventId: "evt-stock-1",
        eventType: ToastWebhookEventType.STOCK_UPDATED,
        restaurantGuid: "toast-rest-1",
        timestamp: new Date().toISOString(),
        stock: {
          itemGuid: "item-1",
          itemName: "Caymus Cabernet",
          quantity: 3,
          previousQuantity: 5,
        },
      } as any,
      "{}",
      null,
      null,
    );

    expect(res.status).toBe("processed");
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps the dead route out of the source (regression guard)", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "toast.service.ts"),
      "utf8",
    );
    // Only the explanatory block comment may mention the path or the old
    // method name; neither may appear as live code again.
    expect(src).not.toMatch(/httpClient\.post\(\s*`\/api\/v1\/toast\/webhooks/);
    expect(src).not.toMatch(/this\.forwardToOrchestrator\(/);
    expect(src).not.toMatch(/private async forwardToOrchestrator\(/);
  });
});
