import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import {
  TransactionType,
  TransactionSource,
  StockType,
} from "../inventory-ledger/dto/inventory-ledger.dto";

describe("InventoryLedgerService", () => {
  let service: InventoryLedgerService;

  const mockSupabaseClient = {
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    gte: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn(),
    rpc: jest.fn(),
  };

  const mockDatabaseService = {
    supabase: mockSupabaseClient,
  };

  const mockEventsService = {
    createEvent: jest.fn().mockResolvedValue({ id: "event-123" }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryLedgerService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: EventsService, useValue: mockEventsService },
      ],
    }).compile();

    service = module.get<InventoryLedgerService>(InventoryLedgerService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createTransaction", () => {
    const restaurantId = "restaurant-123";
    const userId = "user-456";

    const baseDto = {
      inventoryId: "inv-123",
      wineId: "wine-456",
      transactionType: TransactionType.SALE,
      source: TransactionSource.POS,
      quantityChange: -2,
      idempotencyKey: "test-key-1",
    };

    it("should create a transaction successfully", async () => {
      const transactionId = "txn-789";
      const mockTransaction = {
        id: transactionId,
        restaurant_id: restaurantId,
        inventory_id: baseDto.inventoryId,
        wine_id: baseDto.wineId,
        transaction_type: baseDto.transactionType,
        source: baseDto.source,
        quantity_change: baseDto.quantityChange,
        quantity_before: 10,
        quantity_after: 8,
        stock_type: "live",
        performed_by: userId,
        performed_by_type: "user",
        transaction_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        metadata: {},
      };

      mockSupabaseClient.rpc.mockResolvedValue({
        data: transactionId,
        error: null,
      });

      mockSupabaseClient.single.mockResolvedValue({
        data: mockTransaction,
        error: null,
      });

      const result = await service.createTransaction(
        restaurantId,
        userId,
        baseDto,
      );

      expect(result.id).toBe(transactionId);
      expect(result.quantityChange).toBe(-2);
      expect(result.quantityBefore).toBe(10);
      expect(result.quantityAfter).toBe(8);
      expect(mockEventsService.createEvent).toHaveBeenCalled();
      // Regression guard: record_inventory_transaction referenced a ghost
      // `live_stock` column and 500'd against the real DB (spine repair,
      // decision A5). Every write now goes through apply_stock_movement.
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        "apply_stock_movement",
        expect.objectContaining({
          p_inventory_id: baseDto.inventoryId,
          p_delta: baseDto.quantityChange,
          p_idempotency_key: baseDto.idempotencyKey,
        }),
      );
      expect(mockSupabaseClient.rpc).not.toHaveBeenCalledWith(
        "record_inventory_transaction",
        expect.anything(),
      );
    });

    it("should reject zero quantity change", async () => {
      await expect(
        service.createTransaction(restaurantId, userId, {
          ...baseDto,
          quantityChange: 0,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle purchase transactions (positive quantity)", async () => {
      const purchaseDto = {
        ...baseDto,
        transactionType: TransactionType.PURCHASE,
        source: TransactionSource.ORDER,
        quantityChange: 24,
        orderId: "order-123",
        idempotencyKey: "test-key-purchase",
      };

      const transactionId = "txn-purchase";
      const mockTransaction = {
        id: transactionId,
        restaurant_id: restaurantId,
        inventory_id: purchaseDto.inventoryId,
        wine_id: purchaseDto.wineId,
        transaction_type: purchaseDto.transactionType,
        source: purchaseDto.source,
        quantity_change: purchaseDto.quantityChange,
        quantity_before: 10,
        quantity_after: 34,
        stock_type: "live",
        order_id: purchaseDto.orderId,
        performed_by: userId,
        performed_by_type: "user",
        transaction_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        metadata: {},
      };

      mockSupabaseClient.rpc.mockResolvedValue({
        data: transactionId,
        error: null,
      });

      mockSupabaseClient.single.mockResolvedValue({
        data: mockTransaction,
        error: null,
      });

      const result = await service.createTransaction(
        restaurantId,
        userId,
        purchaseDto,
      );

      expect(result.quantityChange).toBe(24);
      expect(result.quantityAfter).toBe(34);
      expect(result.orderId).toBe("order-123");
    });
  });

  describe("listTransactions", () => {
    const restaurantId = "restaurant-123";

    it("should return paginated transactions", async () => {
      const mockTransactions = [
        {
          id: "txn-1",
          restaurant_id: restaurantId,
          inventory_id: "inv-1",
          wine_id: "wine-1",
          transaction_type: "sale",
          source: "pos",
          quantity_change: -2,
          quantity_before: 10,
          quantity_after: 8,
          stock_type: "live",
          performed_by_type: "system",
          transaction_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          metadata: {},
        },
        {
          id: "txn-2",
          restaurant_id: restaurantId,
          inventory_id: "inv-1",
          wine_id: "wine-1",
          transaction_type: "purchase",
          source: "order",
          quantity_change: 24,
          quantity_before: 8,
          quantity_after: 32,
          stock_type: "live",
          performed_by_type: "user",
          transaction_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
          metadata: {},
        },
      ];

      mockSupabaseClient.range.mockResolvedValue({
        data: mockTransactions,
        error: null,
        count: 2,
      });

      const result = await service.listTransactions(restaurantId, {
        page: 1,
        limit: 50,
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it("should filter by transaction type", async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listTransactions(restaurantId, {
        transactionType: TransactionType.SALE,
      });

      expect(mockSupabaseClient.eq).toHaveBeenCalledWith(
        "transaction_type",
        "sale",
      );
    });

    it("should filter by date range", async () => {
      mockSupabaseClient.range.mockResolvedValue({
        data: [],
        error: null,
        count: 0,
      });

      await service.listTransactions(restaurantId, {
        startDate: "2024-01-01T00:00:00Z",
        endDate: "2024-01-31T23:59:59Z",
      });

      expect(mockSupabaseClient.gte).toHaveBeenCalledWith(
        "transaction_date",
        "2024-01-01T00:00:00Z",
      );
      expect(mockSupabaseClient.lte).toHaveBeenCalledWith(
        "transaction_date",
        "2024-01-31T23:59:59Z",
      );
    });
  });

  describe("getBalanceAt", () => {
    const restaurantId = "restaurant-123";

    it("should return balance at point in time", async () => {
      mockSupabaseClient.rpc.mockResolvedValue({
        data: 15,
        error: null,
      });

      const result = await service.getBalanceAt(
        restaurantId,
        "inv-123",
        "2024-01-15T12:00:00Z",
        StockType.LIVE,
      );

      expect(result.balance).toBe(15);
      expect(result.inventoryId).toBe("inv-123");
      expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
        "get_inventory_balance_at",
        expect.objectContaining({
          p_inventory_id: "inv-123",
          p_as_of: "2024-01-15T12:00:00Z",
          p_stock_type: "live",
        }),
      );
    });
  });

  describe("getTransactionSummary", () => {
    const restaurantId = "restaurant-123";

    it("should calculate summary correctly", async () => {
      const mockData = [
        { transaction_type: "sale", source: "pos", quantity_change: -5 },
        { transaction_type: "sale", source: "pos", quantity_change: -3 },
        { transaction_type: "purchase", source: "order", quantity_change: 24 },
        { transaction_type: "waste", source: "manual", quantity_change: -1 },
      ];

      mockSupabaseClient.lte.mockResolvedValue({
        data: mockData,
        error: null,
      });

      const result = await service.getTransactionSummary(
        restaurantId,
        "2024-01-01",
        "2024-01-31",
      );

      expect(result.totalIn).toBe(24);
      expect(result.totalOut).toBe(9); // 5 + 3 + 1
      expect(result.netChange).toBe(15);
      expect(result.transactionCount).toBe(4);
      expect(result.byType.sale.count).toBe(2);
      expect(result.byType.sale.quantity).toBe(-8);
    });
  });

  // Ported to the Phase 2 write model (2026-07-14): reconcileInventory now reads the real
  // `stock_live` projection and applies the adjustment via the `apply_stock_movement` RPC
  // (lots + ledger, atomic) instead of the removed record_inventory_transaction path that
  // direct-updated the ghost `live_stock` column. See .planning/FIX_ERROR_LOG.md.
  describe("reconcileInventory", () => {
    const restaurantId = "restaurant-123";
    const userId = "user-456";

    it("should create reconciliation transaction for positive adjustment", async () => {
      // Current stock is 10, actual count is 12
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { stock_live: 10 },
        error: null,
      });

      const transactionId = "txn-reconcile";
      const mockTransaction = {
        id: transactionId,
        restaurant_id: restaurantId,
        inventory_id: "inv-123",
        wine_id: "wine-456",
        transaction_type: "reconciliation",
        source: "reconciliation",
        quantity_change: 2,
        quantity_before: 10,
        quantity_after: 12,
        stock_type: "live",
        performed_by: userId,
        performed_by_type: "user",
        reason: "Physical count reconciliation: Expected 10, Actual 12",
        transaction_date: new Date().toISOString(),
        created_at: new Date().toISOString(),
        metadata: {},
      };

      mockSupabaseClient.rpc.mockResolvedValue({
        data: transactionId,
        error: null,
      });

      mockSupabaseClient.single.mockResolvedValueOnce({
        data: mockTransaction,
        error: null,
      });

      const result = await service.reconcileInventory(
        restaurantId,
        userId,
        "inv-123",
        "wine-456",
        12,
      );

      expect(result.quantityChange).toBe(2);
      expect(result.transactionType).toBe("reconciliation");
    });

    it("should reject reconciliation when counts match", async () => {
      mockSupabaseClient.single.mockResolvedValue({
        data: { stock_live: 10 },
        error: null,
      });

      await expect(
        service.reconcileInventory(
          restaurantId,
          userId,
          "inv-123",
          "wine-456",
          10, // Same as current
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("createBulkTransactions", () => {
    const restaurantId = "restaurant-123";
    const userId = "user-456";

    it("should create multiple transactions", async () => {
      const transactions = [
        {
          inventoryId: "inv-1",
          wineId: "wine-1",
          transactionType: TransactionType.SALE,
          source: TransactionSource.POS,
          quantityChange: -2,
          idempotencyKey: "test-key-bulk-1",
        },
        {
          inventoryId: "inv-2",
          wineId: "wine-2",
          transactionType: TransactionType.SALE,
          source: TransactionSource.POS,
          quantityChange: -1,
          idempotencyKey: "test-key-bulk-2",
        },
      ];

      // Mock successful transactions
      mockSupabaseClient.rpc
        .mockResolvedValueOnce({ data: "txn-1", error: null })
        .mockResolvedValueOnce({ data: "txn-2", error: null });

      mockSupabaseClient.single
        .mockResolvedValueOnce({
          data: {
            id: "txn-1",
            restaurant_id: restaurantId,
            inventory_id: "inv-1",
            wine_id: "wine-1",
            transaction_type: "sale",
            source: "pos",
            quantity_change: -2,
            quantity_before: 10,
            quantity_after: 8,
            stock_type: "live",
            performed_by_type: "user",
            transaction_date: new Date().toISOString(),
            created_at: new Date().toISOString(),
            metadata: {},
          },
          error: null,
        })
        .mockResolvedValueOnce({
          data: {
            id: "txn-2",
            restaurant_id: restaurantId,
            inventory_id: "inv-2",
            wine_id: "wine-2",
            transaction_type: "sale",
            source: "pos",
            quantity_change: -1,
            quantity_before: 5,
            quantity_after: 4,
            stock_type: "live",
            performed_by_type: "user",
            transaction_date: new Date().toISOString(),
            created_at: new Date().toISOString(),
            metadata: {},
          },
          error: null,
        });

      const result = await service.createBulkTransactions(
        restaurantId,
        userId,
        {
          transactions,
        },
      );

      expect(result.successCount).toBe(2);
      expect(result.failedCount).toBe(0);
      expect(result.createdIds).toHaveLength(2);
    });
  });
});
