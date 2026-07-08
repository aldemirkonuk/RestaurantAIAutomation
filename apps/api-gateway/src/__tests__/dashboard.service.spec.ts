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
});
