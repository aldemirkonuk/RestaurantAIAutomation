import * as crypto from "crypto";
import { PosHubService } from "./pos-hub.service";
import { DatabaseService } from "../database/database.service";

/**
 * Ingress unification (SimPOS testbed plan, decisions B13/B15/B17-B20).
 *
 * Locks in: closed checks deplete stock through apply_stock_movement /
 * record_glass_pour, open checks never do, voids reverse, unmapped wine
 * lines are queued instead of dropped, and the webhook signature guard
 * fails closed.
 */

type Row = Record<string, any>;

function makeDb(opts: { mappings?: Row[]; tables?: Row[]; inventory?: Row[] }) {
  const calls = {
    rpc: [] as any[],
    unresolvedInserts: [] as any[],
    checkUpserts: [] as any[],
  };

  const client: any = {
    from(table: string) {
      const q: any = {
        _table: table,
        select: () => q,
        eq: () => q,
        in: () => q,
        upsert: async () => ({ error: null }),
      };
      if (table === "pos_item_mappings") {
        q.in = async () => ({ data: opts.mappings ?? [], error: null });
      }
      if (table === "restaurant_inventory") {
        // ADR 0011: a sale volume is resolved from the inventory row before
        // any depletion RPC. A mapping whose inventory_id resolves to nothing
        // now queues rather than depleting a guessed bottle, so these fixtures
        // supply the row the mapping points at. Defaults to the shape of every
        // production row: a 750ml bottle poured at 150ml.
        q.in = async () => ({
          data: opts.inventory ?? [
            { id: "inv-1", bottle_size_ml: 750, pour_size_ml: 150 },
          ],
          error: null,
        });
      }
      if (table === "restaurant_tables") {
        q.eq = () => ({
          eq: async () => ({ data: opts.tables ?? [], error: null }),
        });
      }
      if (table === "pos_checks") {
        q.upsert = async (row: Row) => {
          calls.checkUpserts.push(row);
          return { error: null };
        };
      }
      if (table === "pos_unresolved_lines") {
        q.insert = async (row: Row) => {
          calls.unresolvedInserts.push(row);
          return { error: null };
        };
      }
      return q;
    },
    rpc: async (name: string, args: Row) => {
      calls.rpc.push({ name, args });
      return { data: "tx-1", error: null };
    },
  };

  return {
    db: { getClient: () => client } as unknown as DatabaseService,
    calls,
  };
}

function makeService(
  opts: { mappings?: Row[]; tables?: Row[]; inventory?: Row[] } = {},
) {
  const { db, calls } = makeDb(opts);
  const service = new PosHubService(db);
  return { service, calls };
}

const closedCheckPayload = (overrides: Row = {}) => ({
  externalCheckId: "chk-1",
  openedAt: "2026-08-05T18:00:00Z",
  closedAt: "2026-08-05T19:00:00Z",
  items: [
    {
      name: "Caymus Cabernet",
      externalItemId: "item-1",
      qty: 2,
      price: 24,
    },
  ],
  ...overrides,
});

describe("PosHubService.ingest — stock effects", () => {
  it("does not touch stock for an open check (B18)", async () => {
    const { service, calls } = makeService({
      mappings: [
        {
          external_item_id: "item-1",
          item_name: "Caymus Cabernet",
          is_wine: true,
          inventory_id: "inv-1",
          sale_unit: "bottle",
        },
      ],
    });

    await service.ingest("r1", "generic_webhook", [
      { ...closedCheckPayload(), closedAt: null },
    ]);

    expect(calls.rpc).toHaveLength(0);
  });

  it("depletes a mapped bottle sale via apply_stock_movement on close (B13/B18)", async () => {
    const { service, calls } = makeService({
      mappings: [
        {
          external_item_id: "item-1",
          item_name: "Caymus Cabernet",
          is_wine: true,
          inventory_id: "inv-1",
          sale_unit: "bottle",
        },
      ],
    });

    await service.ingest("r1", "generic_webhook", [closedCheckPayload()]);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("apply_stock_movement");
    expect(calls.rpc[0].args.p_inventory_id).toBe("inv-1");
    expect(calls.rpc[0].args.p_delta).toBe(-2);
    expect(calls.rpc[0].args.p_transaction_type).toBe("sale");
    expect(calls.rpc[0].args.p_source).toBe("pos");
    // B15: idempotency key format.
    expect(calls.rpc[0].args.p_idempotency_key).toBe(
      "pos:generic_webhook:chk-1:item-1:0",
    );
  });

  it("depletes a mapped glass sale via record_glass_pour, never apply_stock_movement", async () => {
    const { service, calls } = makeService({
      mappings: [
        {
          external_item_id: "item-1",
          item_name: "Caymus Cabernet",
          is_wine: true,
          inventory_id: "inv-1",
          sale_unit: "glass",
        },
      ],
    });

    await service.ingest("r1", "generic_webhook", [closedCheckPayload()]);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("record_glass_pour");
    expect(calls.rpc[0].args.p_pours).toBe(2);
  });

  it("reverses a bottle void with a positive return delta (B19)", async () => {
    const { service, calls } = makeService({
      mappings: [
        {
          external_item_id: "item-1",
          item_name: "Caymus Cabernet",
          is_wine: true,
          inventory_id: "inv-1",
          sale_unit: "bottle",
        },
      ],
    });

    await service.ingest("r1", "generic_webhook", [
      closedCheckPayload({ voided: true }),
    ]);

    expect(calls.rpc[0].args.p_delta).toBe(2);
    expect(calls.rpc[0].args.p_transaction_type).toBe("return");
  });

  it("reverses a glass void via apply_stock_movement, not record_glass_pour (B19)", async () => {
    const { service, calls } = makeService({
      mappings: [
        {
          external_item_id: "item-1",
          item_name: "Caymus Cabernet",
          is_wine: true,
          inventory_id: "inv-1",
          sale_unit: "glass",
        },
      ],
    });

    await service.ingest("r1", "generic_webhook", [
      closedCheckPayload({ voided: true }),
    ]);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("apply_stock_movement");
    expect(calls.rpc[0].args.p_delta).toBe(2);
    expect(calls.rpc[0].args.p_transaction_type).toBe("return");
  });

  it("queues an unmapped wine line in pos_unresolved_lines instead of dropping it (B20)", async () => {
    const { service, calls } = makeService({ mappings: [] });

    // No mapping row at all, but the name is caught by the WINE_WORDS
    // fallback, so it's flagged wine with nothing to resolve it to stock.
    await service.ingest("r1", "generic_webhook", [
      closedCheckPayload({
        items: [
          {
            name: "Mystery Cabernet",
            externalItemId: "item-9",
            qty: 1,
            price: 30,
          },
        ],
      }),
    ]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(1);
    expect(calls.unresolvedInserts[0].item_name).toBe("Mystery Cabernet");
    expect(calls.unresolvedInserts[0].external_item_id).toBe("item-9");
  });

  it("never queues or depletes a non-wine item", async () => {
    const { service, calls } = makeService({ mappings: [] });

    await service.ingest("r1", "generic_webhook", [
      closedCheckPayload({
        items: [
          { name: "Cheeseburger", externalItemId: "food-1", qty: 1, price: 12 },
        ],
      }),
    ]);

    expect(calls.rpc).toHaveLength(0);
    expect(calls.unresolvedInserts).toHaveLength(0);
  });
});

describe("PosHubService.verifyWebhookSignature (B16/B17/B28)", () => {
  const R_A = "11111111-1111-4111-8111-111111111111";
  const R_B = "22222222-2222-4222-8222-222222222222";
  const body = Buffer.from(JSON.stringify({ hello: "world" }));

  /** Every env var this suite may set, cleared between tests. */
  const SECRET_VARS = [
    "POS_HUB_WEBHOOK_SECRET",
    "POS_WEBHOOK_SECRET_GENERIC_WEBHOOK",
    "POS_WEBHOOK_SECRET_TOAST",
    `POS_WEBHOOK_SECRET_GENERIC_WEBHOOK__${R_A.toUpperCase().replace(/-/g, "_")}`,
    `POS_WEBHOOK_SECRET_GENERIC_WEBHOOK__${R_B.toUpperCase().replace(/-/g, "_")}`,
  ];

  const hmac = (secret: string, message: Buffer | string) =>
    crypto.createHmac("sha256", secret).update(message).digest("hex");

  /** What a scoped signer produces: the identity is inside the signed bytes. */
  const scopedSig = (
    secret: string,
    provider: string,
    restaurantId: string,
    raw: Buffer,
  ) => hmac(secret, `${provider}:${restaurantId}.${raw.toString("utf8")}`);

  beforeEach(() => {
    for (const v of SECRET_VARS) delete process.env[v];
  });
  afterAll(() => {
    for (const v of SECRET_VARS) delete process.env[v];
  });

  it("fails closed when no secret is configured, naming the available provider", () => {
    const { service } = makeService();
    const errors = jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => undefined);

    expect(
      service.verifyWebhookSignature(body, "anything", {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(false);

    // Logged once, and it says the door is advertised — generic_webhook is
    // registry status 'available', which is exactly the case that must never
    // fall open.
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toMatch(/fail closed/i);
    expect(errors.mock.calls[0][0]).toMatch(/AVAILABLE/);

    // Repeat calls stay rejected; the log does not repeat.
    expect(
      service.verifyWebhookSignature(body, "anything", {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("rejects a mismatched signature and accepts a correct one (legacy scheme)", () => {
    process.env.POS_HUB_WEBHOOK_SECRET = "test-secret";
    const { service } = makeService();
    const ctx = { provider: "generic_webhook", restaurantId: R_A };

    expect(service.verifyWebhookSignature(body, "deadbeef", ctx)).toBe(false);
    expect(
      service.verifyWebhookSignature(body, hmac("test-secret", body), ctx),
    ).toBe(true);
  });

  it("still authenticates the legacy global secret, and warns that it did", () => {
    // The fallback window: SimPOS (simpos.service.ts sendSignedWebhook) and
    // scripts/simulate/bridge.py both sign the raw body with the process-wide
    // key, and production has no scoped secret set. Break this and the only
    // door with rows behind it goes dark.
    process.env.POS_HUB_WEBHOOK_SECRET = "legacy-secret";
    const { service } = makeService();
    const warn = jest
      .spyOn((service as any).logger, "warn")
      .mockImplementation(() => undefined);

    expect(
      service.verifyWebhookSignature(body, hmac("legacy-secret", body), {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(true);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/legacy process-wide/i);
    expect(warn.mock.calls[0][0]).toMatch(/POS_WEBHOOK_SECRET_GENERIC_WEBHOOK/);
  });

  it("rejects a signature minted for another PROVIDER", () => {
    process.env.POS_WEBHOOK_SECRET_GENERIC_WEBHOOK = "secret-generic";
    process.env.POS_WEBHOOK_SECRET_TOAST = "secret-toast";
    const { service } = makeService();

    const sigForGeneric = scopedSig(
      "secret-generic",
      "generic_webhook",
      R_A,
      body,
    );

    expect(
      service.verifyWebhookSignature(body, sigForGeneric, {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(true);
    // Same tenant, same bytes, provider A's key — must not open provider B.
    expect(
      service.verifyWebhookSignature(body, sigForGeneric, {
        provider: "toast",
        restaurantId: R_A,
      }),
    ).toBe(false);
  });

  it("rejects a signature minted for another RESTAURANT under one provider secret", () => {
    // The cross-tenant forgery itself: one provider-wide key, two tenants.
    process.env.POS_WEBHOOK_SECRET_GENERIC_WEBHOOK = "secret-generic";
    const { service } = makeService();

    const sigForA = scopedSig("secret-generic", "generic_webhook", R_A, body);

    expect(
      service.verifyWebhookSignature(body, sigForA, {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(true);
    expect(
      service.verifyWebhookSignature(body, sigForA, {
        provider: "generic_webhook",
        restaurantId: R_B,
      }),
    ).toBe(false);
  });

  it("prefers the per-connection secret, and one tenant's key does not open another's", () => {
    const varA = `POS_WEBHOOK_SECRET_GENERIC_WEBHOOK__${R_A.toUpperCase().replace(/-/g, "_")}`;
    const varB = `POS_WEBHOOK_SECRET_GENERIC_WEBHOOK__${R_B.toUpperCase().replace(/-/g, "_")}`;
    process.env[varA] = "secret-a";
    process.env[varB] = "secret-b";
    process.env.POS_WEBHOOK_SECRET_GENERIC_WEBHOOK = "secret-provider";
    process.env.POS_HUB_WEBHOOK_SECRET = "legacy-secret";
    const { service } = makeService();

    const sigA = scopedSig("secret-a", "generic_webhook", R_A, body);
    expect(
      service.verifyWebhookSignature(body, sigA, {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(true);
    expect(
      service.verifyWebhookSignature(body, sigA, {
        provider: "generic_webhook",
        restaurantId: R_B,
      }),
    ).toBe(false);

    // A scoped secret is the cutover switch: the legacy key no longer opens
    // this door, on either the legacy scheme or the scoped one.
    expect(
      service.verifyWebhookSignature(body, hmac("legacy-secret", body), {
        provider: "generic_webhook",
        restaurantId: R_A,
      }),
    ).toBe(false);
    expect(
      service.verifyWebhookSignature(
        body,
        scopedSig("secret-provider", "generic_webhook", R_A, body),
        { provider: "generic_webhook", restaurantId: R_A },
      ),
    ).toBe(false);
  });

  it("rejects an unknown provider and a blank context even with a secret set", () => {
    process.env.POS_HUB_WEBHOOK_SECRET = "legacy-secret";
    const { service } = makeService();
    const good = hmac("legacy-secret", body);

    expect(
      service.verifyWebhookSignature(body, good, {
        provider: "not_a_real_pos",
        restaurantId: R_A,
      }),
    ).toBe(false);
    expect(
      service.verifyWebhookSignature(body, good, {
        provider: "generic_webhook",
        restaurantId: "  ",
      }),
    ).toBe(false);
    expect(
      service.verifyWebhookSignature(body, good, undefined as any),
    ).toBe(false);
  });
});
