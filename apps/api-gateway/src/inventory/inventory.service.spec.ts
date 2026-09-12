import { Test, TestingModule } from "@nestjs/testing";
import { HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { DatabaseService } from "../database/database.service";
import { PhotoCountService } from "./photo-count.service";

describe("InventoryService", () => {
  let service: InventoryService;
  const mockEstimate = jest.fn();

  // Each test configures specific return values via these jest.fn references.
  const mockSingle = jest.fn();
  const mockExecute = jest.fn();
  // createInventoryItem applies initial stock as a lot via the
  // `apply_stock_movement` RPC and then re-fetches the fresh row, so the mock
  // client must expose `.rpc()` as well as the fluent chain.
  const mockRpc = jest.fn();
  const mockMaybeSingle = jest.fn();

  const mockSupabaseChain = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    is: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: mockSingle,
    maybeSingle: mockMaybeSingle,
    execute: mockExecute,
    rpc: mockRpc,
  };

  const mockDatabaseService = {
    getClient: jest.fn(() => mockSupabaseChain),
    supabase: mockSupabaseChain,
    getRestaurantInventory: jest.fn().mockResolvedValue([]),
    getLowStockItems: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Restore the chain mock after clearAllMocks wipes return values
    mockSupabaseChain.from.mockReturnThis();
    mockSupabaseChain.select.mockReturnThis();
    mockSupabaseChain.insert.mockReturnThis();
    mockSupabaseChain.update.mockReturnThis();
    mockSupabaseChain.eq.mockReturnThis();
    mockSupabaseChain.neq.mockReturnThis();
    mockSupabaseChain.is.mockReturnThis();
    mockSupabaseChain.order.mockReturnThis();
    // apply_stock_movement RPC resolves with no error by default
    mockRpc.mockResolvedValue({ data: null, error: null });
    // Safe fallback for any single() call not explicitly queued with
    // mockResolvedValueOnce — notably the post-insert fresh re-fetch. Returning
    // { data: null } makes createInventoryItem fall back to the inserted row.
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockEstimate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: PhotoCountService, useValue: { estimate: mockEstimate } },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  describe("createInventoryItem — wine_name population (regression: Bug 1)", () => {
    it("returns a non-null wineName when the master wine library resolves a name", async () => {
      // Call 1: no existing inventory item (duplicate check → PGRST116 = not found)
      // Call 2: master_wine_library name lookup → 'Château Pétrus'
      // Call 3: the INSERT .single() → full row with wine_name populated
      mockSingle
        .mockResolvedValueOnce({
          data: null,
          error: { code: "PGRST116", message: "not found" },
        })
        .mockResolvedValueOnce({
          data: { name: "Château Pétrus" },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: "inv-uuid-1",
            restaurant_id: "rest-1",
            master_wine_id: "mw-1",
            wine_name: "Château Pétrus",
            stock_live: 6,
            master_wine_library: {
              name: "Château Pétrus",
              bottle_size_ml: 750,
            },
            restaurants: { default_pour_ml: 150, measurement_unit: "oz" },
          },
          error: null,
        });

      const result = await service.createInventoryItem("rest-1", {
        wineId: "mw-1",
        stockLive: 6,
        providerId: null,
        thresholdMin: 6,
        thresholdMax: 24,
      } as any);

      expect(result.wineName).toBe("Château Pétrus");
      expect(result.wine_name).toBe("Château Pétrus");
    });

    it("includes wine_name in the INSERT payload sent to Supabase", async () => {
      // Real call order:
      //  1. master_wine_library name lookup  → single()
      //  2. restaurant_inventory existing check → single() — PGRST116 = not found → proceed to INSERT
      //  3. INSERT .select().single() → inserted row
      mockSingle
        .mockResolvedValueOnce({
          data: { name: "Barolo Riserva" },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { code: "PGRST116", message: "not found" },
        })
        .mockResolvedValueOnce({
          data: {
            id: "inv-uuid-2",
            wine_name: "Barolo Riserva",
            master_wine_library: {
              name: "Barolo Riserva",
              bottle_size_ml: 750,
            },
            restaurants: { default_pour_ml: 150, measurement_unit: "oz" },
          },
          error: null,
        });

      await service.createInventoryItem("rest-1", {
        wineId: "mw-2",
        stockLive: 3,
        providerId: null,
        thresholdMin: 6,
        thresholdMax: 24,
      } as any);

      // Verify the insert call received an object containing wine_name
      const insertCall = mockSupabaseChain.insert.mock.calls[0][0];
      expect(insertCall).toMatchObject({ wine_name: "Barolo Riserva" });
    });

    it("falls back to master_wine_library.name via mapInventoryItem when wine_name column is null", () => {
      // Access the private method via bracket notation for the unit test
      const row = {
        id: "inv-3",
        wine_name: null,
        master_wine_library: {
          name: "Pinot Noir Reserve",
          bottle_size_ml: 750,
        },
        restaurants: { default_pour_ml: 150 },
        bottle_size_ml: null,
        pour_size_ml: null,
        glasses_per_bottle_override: null,
      };
      const result = (service as any).mapInventoryItem(row);
      expect(result.wineName).toBe("Pinot Noir Reserve");
      expect(result.wine_name).toBe("Pinot Noir Reserve");
    });

    it("never returns wineName as undefined — returns null when no source available", () => {
      const row = {
        id: "inv-4",
        wine_name: null,
        master_wine_library: null,
        restaurants: null,
        bottle_size_ml: null,
        pour_size_ml: null,
        glasses_per_bottle_override: null,
      };
      const result = (service as any).mapInventoryItem(row);
      // Must be null, not undefined — undefined as an object key becomes the string "undefined"
      expect(result.wineName).toBeNull();
      expect(result.wine_name).toBeNull();
    });
  });

  describe("recordSpotCount (decisions E40-E43)", () => {
    it("rejects a negative countedQty before calling the RPC", async () => {
      await expect(
        service.recordSpotCount("rest-1", "inv-1", {
          countedQty: -1,
          clientCountId: "c1",
        }),
      ).rejects.toThrow(HttpException);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects a missing clientCountId before calling the RPC", async () => {
      await expect(
        service.recordSpotCount("rest-1", "inv-1", {
          countedQty: 5,
          clientCountId: "",
        }),
      ).rejects.toThrow(HttpException);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    // ADR 0078 — a count is a record. This block used to assert the call went to
    // `set_stock_absolute`, which returns NULL on a zero delta and therefore
    // wrote NOTHING when the count agreed.
    it("commits through record_stock_count with a count:{inventoryId}:{clientCountId} idempotency key", async () => {
      await service.recordSpotCount("rest-1", "inv-1", {
        countedQty: 8,
        clientCountId: "client-count-42",
      });

      expect(mockRpc).toHaveBeenCalledWith(
        "record_stock_count",
        expect.objectContaining({
          p_inventory_id: "inv-1",
          p_stock_state: "live",
          p_counted_qty: 8,
          p_transaction_type: "reconciliation",
          p_source: "mobile_count",
          p_idempotency_key: "count:inv-1:client-count-42",
        }),
      );
      // The primitive that could not record agreement is no longer on this path.
      const usedRpcs = mockRpc.mock.calls.map((c) => c[0]);
      expect(usedRpcs).not.toContain("set_stock_absolute");
    });

    // The core claim. A count that AGREES produces a record.
    it("returns the recorded count when the count agrees — variance 0, no movement", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          count_id: "count-9",
          expected_qty: 8,
          counted_qty: 8,
          variance_qty: 0,
          transaction_id: null,
          counted_at: "2026-09-02T11:00:00.000Z",
          replayed: false,
        },
        error: null,
      });

      const result = await service.recordSpotCount("rest-1", "inv-1", {
        countedQty: 8,
        clientCountId: "client-count-agree",
      });

      expect(result.count).toEqual({
        countId: "count-9",
        expectedQty: 8,
        countedQty: 8,
        varianceQty: 0,
        // Null because nothing had to move. Before this ADR there was no way to
        // say that at all: set_stock_absolute returned NULL and
        // inventory_transactions CHECKs quantity_change <> 0, so the only counts
        // the system could hold were the ones that disagreed.
        transactionId: null,
        countedAt: "2026-09-02T11:00:00.000Z",
        replayed: false,
      });
    });

    it("surfaces both the count and the movement when the count disagrees", async () => {
      mockRpc.mockResolvedValueOnce({
        data: {
          count_id: "count-10",
          expected_qty: 8,
          counted_qty: 5,
          variance_qty: -3,
          transaction_id: "txn-55",
          counted_at: "2026-09-02T11:05:00.000Z",
          replayed: false,
        },
        error: null,
      });

      const result = await service.recordSpotCount("rest-1", "inv-1", {
        countedQty: 5,
        clientCountId: "client-count-disagree",
      });

      expect(result.count?.varianceQty).toBe(-3);
      expect(result.count?.transactionId).toBe("txn-55");
    });

    // A retry sends the SAME clientCountId, so it must produce the SAME
    // idempotency key — which is the count row's unique index, and therefore the
    // single gate that keeps one count from becoming two. The de-duplication
    // itself happens in Postgres (see stock-count-is-a-record.spec.ts for the
    // structural assertions on the constraint and the replay gate); what this
    // test proves is that the gateway hands the retry a key the gate can match.
    it("hands a retried count the identical key, so the retry is de-duplicable", async () => {
      const dto = { countedQty: 8, clientCountId: "client-count-retry" };
      await service.recordSpotCount("rest-1", "inv-1", { ...dto });
      await service.recordSpotCount("rest-1", "inv-1", { ...dto });

      const keys = mockRpc.mock.calls
        .filter((c) => c[0] === "record_stock_count")
        .map((c) => c[1].p_idempotency_key);
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe("count:inv-1:client-count-retry");
      expect(keys[1]).toBe(keys[0]);
    });

    // last_counted_at survives ADR 0078 as a denormalised MAX(counted_at) cache,
    // but it is no longer stamped from here: it was a SECOND round trip whose
    // failure only warned, so a count could leave no trace at all and still
    // report success. It is now written inside record_stock_count's transaction.
    it("does not stamp last_counted_at in a separate write that could fail alone", async () => {
      await service.recordSpotCount("rest-1", "inv-1", {
        countedQty: 8,
        clientCountId: "client-count-43",
      });

      const updateCall = mockSupabaseChain.update.mock.calls.find(
        (args) => "last_counted_at" in (args[0] || {}),
      );
      expect(updateCall).toBeUndefined();
    });

    it("surfaces an RPC error as an HttpException instead of silently succeeding", async () => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: "inventory not found" },
      });

      await expect(
        service.recordSpotCount("rest-1", "inv-1", {
          countedQty: 8,
          clientCountId: "client-count-44",
        }),
      ).rejects.toThrow(HttpException);
    });
  });

  // ADR 0078 (attribution). `transfer_stock` and `record_glass_pour` have always
  // accepted p_performed_by (baseline:1838, :1132) and these call sites never
  // passed it, so `performed_by_type` resolved to 'system' on every manual move —
  // a ledger built to answer "who moved this" answering "the system".
  describe("attribution comes from the caller, not from nowhere", () => {
    it("passes performedBy to transfer_stock", async () => {
      await service.transferStock(
        "rest-1",
        "inv-1",
        { fromLocationId: null, toLocationId: "loc-2", qty: 2 },
        "user-77",
      );

      expect(mockRpc).toHaveBeenCalledWith(
        "transfer_stock",
        expect.objectContaining({ p_performed_by: "user-77" }),
      );
    });

    it("passes performedBy to record_glass_pour", async () => {
      await service.recordPour(
        "rest-1",
        "inv-1",
        { pours: 2, source: "manual" },
        "user-77",
      );

      expect(mockRpc).toHaveBeenCalledWith(
        "record_glass_pour",
        expect.objectContaining({ p_performed_by: "user-77" }),
      );
    });

    it("passes performedBy to the manual-override set_stock_absolute", async () => {
      // 1: the informational old-values read. 2: the post-write re-fetch, which
      // mapInventoryItem dereferences.
      mockSingle
        .mockResolvedValueOnce({ data: { stock_live: 10 }, error: null })
        .mockResolvedValueOnce({
          data: {
            id: "inv-1",
            restaurant_id: "rest-1",
            stock_live: 12,
            master_wine_library: { name: "X", bottle_size_ml: 750 },
            restaurants: { default_pour_ml: 150, measurement_unit: "oz" },
          },
          error: null,
        });

      await service.updateInventoryItem(
        "rest-1",
        "inv-1",
        { stockLive: 12 } as any,
        "user-77",
      );

      expect(mockRpc).toHaveBeenCalledWith(
        "set_stock_absolute",
        expect.objectContaining({ p_performed_by: "user-77" }),
      );
    });
  });

  describe("estimateCountFromPhoto (decision E46 — suggestion only, never a stock write)", () => {
    it("rejects a missing imageBase64 without calling the vision service", async () => {
      await expect(
        service.estimateCountFromPhoto("rest-1", "inv-1", ""),
      ).rejects.toThrow(HttpException);
      expect(mockEstimate).not.toHaveBeenCalled();
    });

    it("passes the resolved wine name to the vision estimator and returns its result verbatim", async () => {
      mockMaybeSingle.mockResolvedValueOnce({
        data: { wine_name: "Château Pétrus", master_wine_library: null },
        error: null,
      });
      mockEstimate.mockResolvedValueOnce({
        suggestedQty: 7,
        confidence: "medium",
        note: "Counted 7 bottles on the shelf.",
      });

      const result = await service.estimateCountFromPhoto(
        "rest-1",
        "inv-1",
        "ZmFrZS1iYXNlNjQ=",
      );

      expect(mockEstimate).toHaveBeenCalledWith(
        "ZmFrZS1iYXNlNjQ=",
        "Château Pétrus",
        // P1 NF-A: restaurantId now rides along so the emitted footprint row
        // is tenant-attributed.
        "rest-1",
        // OD-59 / P3.0: a handle on that footprint row, so the suggestion can
        // be graded against the count a human commits later.
        expect.anything(),
      );
      expect(result).toEqual({
        suggestedQty: 7,
        confidence: "medium",
        note: "Counted 7 bottles on the shelf.",
      });
      // Never touches the RPC that actually moves stock.
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("never writes STOCK — the E46 posture is unchanged by the OD-59 grading", async () => {
      // This assertion used to read "never writes to the database". That is no
      // longer true and, more importantly, it would now pass VACUOUSLY: the
      // suggestion insert waits on the NF row id, which never settles in a unit
      // test with no model client, so the write simply never runs and the old
      // assertion would keep going green while the code wrote. The claim worth
      // protecting was always the narrower one — no stock moves.
      mockEstimate.mockResolvedValueOnce({
        suggestedQty: null,
        confidence: "low",
        note: "Too blurry to count.",
      });

      await service.estimateCountFromPhoto("rest-1", "inv-1", "abc123");

      expect(mockRpc).not.toHaveBeenCalled();
      expect(mockSupabaseChain.update).not.toHaveBeenCalled();
    });

    it("records the suggestion once the footprint row id arrives", async () => {
      // Settle the ref the way ModelClientService would, so the deferred insert
      // actually runs instead of hanging on an unsettled promise.
      mockMaybeSingle.mockResolvedValueOnce({
        data: { wine_name: "Château Pétrus", master_wine_library: null },
        error: null,
      });
      mockEstimate.mockImplementationOnce(
        async (
          _img: string,
          _name: string,
          _rid: string,
          ref: { settle: (id: string | null) => void },
        ) => {
          ref.settle("event-1");
          return { suggestedQty: 7, confidence: "medium", note: "7 bottles." };
        },
      );

      await service.estimateCountFromPhoto("rest-1", "inv-1", "abc123");
      // The insert is fire-and-forget behind an awaited promise; let it land.
      await new Promise((r) => setImmediate(r));

      expect(mockSupabaseChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: "event-1",
          restaurant_id: "rest-1",
          inventory_id: "inv-1",
          suggested_qty: 7,
          confidence: "medium",
        }),
      );
      // Still no stock movement — the whole point of E46.
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });
});
