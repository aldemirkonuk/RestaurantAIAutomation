import { Test, TestingModule } from "@nestjs/testing";
import { DashboardService } from "../dashboard/dashboard.service";
import { DatabaseService } from "../database/database.service";

describe("DashboardService", () => {
  let service: DashboardService;
  let databaseService: DatabaseService;

  const mockDatabaseService = {
    getRestaurantInventory: jest.fn(),
    getLowStockItems: jest.fn(),
    getProcurementOrders: jest.fn(),
    getClient: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    databaseService = module.get<DatabaseService>(DatabaseService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getDashboardSummary", () => {
    const restaurantId = "test-restaurant-id";

    beforeEach(() => {
      // Mock inventory data
      mockDatabaseService.getRestaurantInventory.mockResolvedValue([
        { id: "1", name: "Wine 1", stock_live: 10 },
        { id: "2", name: "Wine 2", stock_live: 5 },
        { id: "3", name: "Wine 3", stock_live: 0 },
      ]);

      // Mock low stock items
      mockDatabaseService.getLowStockItems.mockResolvedValue([
        { id: "2", name: "Wine 2", stock_live: 5 },
      ]);

      // Mock procurement orders
      mockDatabaseService.getProcurementOrders.mockResolvedValue([
        { id: "1", status: "pending" },
        { id: "2", status: "in_transit" },
      ]);

      // Mock Supabase client for notifications and reports
      mockDatabaseService.getClient.mockReturnValue({
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });
    });

    it("should return aggregated dashboard data", async () => {
      const result = await service.getDashboardSummary(restaurantId);

      expect(result).toHaveProperty("inventory");
      expect(result).toHaveProperty("orders");
      expect(result).toHaveProperty("notifications");
      expect(result).toHaveProperty("reports");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("allServicesHealthy");
    });

    it("should calculate inventory summary correctly", async () => {
      const result = await service.getDashboardSummary(restaurantId);

      expect(result.inventory).toEqual({
        totalItems: 3,
        totalBottles: 15,
        lowStockCount: 1,
        criticalCount: 1,
        healthyCount: 2,
      });
    });

    it("should process orders correctly", async () => {
      const result = await service.getDashboardSummary(restaurantId);

      expect(result.orders).toHaveProperty("pending");
      expect(result.orders).toHaveProperty("inTransit");
      expect(result.orders).toHaveProperty("pendingCount");
      expect(result.orders).toHaveProperty("inTransitCount");
    });

    it("should handle service failures gracefully", async () => {
      // Make inventory service fail
      mockDatabaseService.getRestaurantInventory.mockRejectedValue(
        new Error("Database error"),
      );

      const result = await service.getDashboardSummary(restaurantId);

      // Should still return a response with null inventory
      expect(result.inventory).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.allServicesHealthy).toBe(false);
    });

    it("should include timestamp in response", async () => {
      const result = await service.getDashboardSummary(restaurantId);

      expect(result.timestamp).toBeDefined();
      expect(new Date(result.timestamp)).toBeInstanceOf(Date);
    });

    it("should call all services in parallel", async () => {
      await service.getDashboardSummary(restaurantId);

      expect(mockDatabaseService.getRestaurantInventory).toHaveBeenCalledWith(
        restaurantId,
      );
      expect(mockDatabaseService.getLowStockItems).toHaveBeenCalledWith(
        restaurantId,
      );
      expect(mockDatabaseService.getProcurementOrders).toHaveBeenCalledWith(
        restaurantId,
      );
    });
  });

  /**
   * OD-99. `getReportsSummary` used to select from a table called `reports`.
   * No migration in this repository declares it and production does not have
   * it (`to_regclass('public.reports')` is NULL, 2026-08-26) — so PostgREST
   * answered PGRST205 on every call and the service turned that into
   * `{latest: null, lastGeneratedAt: null}`, which is byte-identical to "the
   * archive is empty". The failure was therefore unobservable from the day it
   * was written.
   *
   * These three tests pin the two halves of the repair, and the third exists
   * to stop the second from being satisfied by always claiming failure:
   *   1. the read targets `generated_reports` (the table that exists)
   *   2. a failed read reports itself (ADR 0020) rather than looking empty
   *   3. a genuinely empty archive still looks empty, not broken
   */
  describe("getReportsSummary — OD-99 phantom `reports` table", () => {
    const restaurantId = "test-restaurant-id";

    /** Records every table name passed to `.from()` on the mock client. */
    function clientReturning(result: { data: any[] | null; error: any }) {
      const tables: string[] = [];
      const client = {
        from: jest.fn((table: string) => {
          tables.push(table);
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue(result),
                }),
              }),
            }),
          };
        }),
      };
      return { client, tables };
    }

    it("reads `generated_reports`, never the phantom `reports`", async () => {
      const { client, tables } = clientReturning({ data: [], error: null });
      mockDatabaseService.getClient.mockReturnValue(client);

      await service.getDashboardSummary(restaurantId);

      expect(tables).toContain("generated_reports");
      expect(tables).not.toContain("reports");
    });

    it("does not render a failed read as an empty archive (ADR 0020)", async () => {
      const { client } = clientReturning({
        data: null,
        error: {
          code: "PGRST205",
          message:
            "Could not find the table 'public.reports' in the schema cache",
        },
      });
      mockDatabaseService.getClient.mockReturnValue(client);

      const result = await service.getDashboardSummary(restaurantId);

      expect(result.reports).not.toBeNull();
      expect(result.reports.latest).toBeNull();
      // The whole point: a caller can tell this apart from an empty archive.
      expect(result.reports.unavailable).toEqual(expect.any(String));
      expect(result.reports.unavailable).toContain("PGRST205");
    });

    it("still renders a genuinely empty archive as empty, not as broken", async () => {
      const { client } = clientReturning({ data: [], error: null });
      mockDatabaseService.getClient.mockReturnValue(client);

      const result = await service.getDashboardSummary(restaurantId);

      expect(result.reports.latest).toBeNull();
      expect(result.reports.lastGeneratedAt).toBeNull();
      expect(result.reports.unavailable).toBeNull();
    });
  });
});
