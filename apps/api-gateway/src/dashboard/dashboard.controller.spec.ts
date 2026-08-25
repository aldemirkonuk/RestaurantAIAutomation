import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, HttpStatus } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import {
  DashboardStatsDto,
  ActivityItemDto,
  AlertDto,
  SalesChartPointDto,
  InventoryBreakdownDto,
} from "./dto/dashboard-summary.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

describe("DashboardController", () => {
  let controller: DashboardController;
  let dashboardService: DashboardService;

  const mockDashboardService = {
    getStats: jest.fn(),
    getActivity: jest.fn(),
    getAlerts: jest.fn(),
    getSalesChart: jest.fn(),
    getInventoryBreakdown: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        {
          provide: DashboardService,
          useValue: mockDashboardService,
        },
      ],
    })
      // OD-20 guarded this controller at class level. A unit spec should not
      // have to construct the auth graph to test a handler — stub the guard
      // and let the boot guard prove the real one resolves.
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DashboardController>(DashboardController);
    dashboardService = module.get<DashboardService>(DashboardService);

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("GET /dashboard/stats/:restaurantId", () => {
    const restaurantId = "restaurant-123";

    it("should return dashboard stats", async () => {
      const expectedResponse: DashboardStatsDto = {
        totalWines: 150,
        totalBottles: 500,
        totalVolumeMl: 375000,
        totalVolumeOz: 12680,
        lowStockItems: 5,
        pendingOrders: 3,
        todaySales: 1250.5,
        weekSales: 8750.0,
        monthSales: 35000.0,
      };

      mockDashboardService.getStats.mockResolvedValue(expectedResponse);

      const result = await controller.getStats(restaurantId);

      expect(result).toEqual(expectedResponse);
      expect(result).toHaveProperty("totalWines");
      expect(result).toHaveProperty("totalBottles");
      expect(result).toHaveProperty("lowStockItems");
      expect(result).toHaveProperty("pendingOrders");
      expect(mockDashboardService.getStats).toHaveBeenCalledWith(restaurantId);
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockDashboardService.getStats.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(controller.getStats(restaurantId)).rejects.toThrow(
        new HttpException("Database error", HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });

  describe("GET /dashboard/activity/:restaurantId", () => {
    const restaurantId = "restaurant-123";

    it("should return activity feed", async () => {
      const expectedResponse: ActivityItemDto[] = [
        {
          id: "activity-1",
          type: "order_created",
          title: "New Order",
          description: "Order #1234 created",
          timestamp: new Date().toISOString(),
          entityId: "order-123",
          entityType: "order",
        },
        {
          id: "activity-2",
          type: "inventory_updated",
          title: "Inventory Updated",
          description: "Wine X stock updated",
          timestamp: new Date().toISOString(),
          entityId: "wine-456",
          entityType: "wine",
        },
      ];

      mockDashboardService.getActivity.mockResolvedValue(expectedResponse);

      const result = await controller.getActivity(restaurantId);

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("type");
      expect(result[0]).toHaveProperty("title");
      expect(result[0]).toHaveProperty("timestamp");
      expect(mockDashboardService.getActivity).toHaveBeenCalledWith(
        restaurantId,
        20,
      );
    });

    it("should accept limit query parameter", async () => {
      mockDashboardService.getActivity.mockResolvedValue([]);

      await controller.getActivity(restaurantId, "50");

      expect(mockDashboardService.getActivity).toHaveBeenCalledWith(
        restaurantId,
        50,
      );
    });

    it("should use default limit of 20 when not provided", async () => {
      mockDashboardService.getActivity.mockResolvedValue([]);

      await controller.getActivity(restaurantId);

      expect(mockDashboardService.getActivity).toHaveBeenCalledWith(
        restaurantId,
        20,
      );
    });
  });

  describe("GET /dashboard/alerts/:restaurantId", () => {
    const restaurantId = "restaurant-123";

    it("should return alerts array", async () => {
      const expectedResponse: AlertDto[] = [
        {
          id: "alert-1",
          type: "low_stock",
          severity: "warning",
          title: "Low Stock Alert",
          message: "Wine X is running low (5 bottles remaining)",
          actionUrl: "/inventory/wine-x",
          createdAt: new Date().toISOString(),
        },
        {
          id: "alert-2",
          type: "overdue_order",
          severity: "error",
          title: "Overdue Order",
          message: "Order #1234 is overdue",
          actionUrl: "/orders/1234",
          createdAt: new Date().toISOString(),
        },
      ];

      mockDashboardService.getAlerts.mockResolvedValue(expectedResponse);

      const result = await controller.getAlerts(restaurantId);

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("id");
      expect(result[0]).toHaveProperty("type");
      expect(result[0]).toHaveProperty("severity");
      expect(result[0]).toHaveProperty("title");
      expect(result[0]).toHaveProperty("message");
      expect(result[0]).toHaveProperty("createdAt");
      expect(mockDashboardService.getAlerts).toHaveBeenCalledWith(restaurantId);
    });

    it("should return empty array when no alerts", async () => {
      mockDashboardService.getAlerts.mockResolvedValue([]);

      const result = await controller.getAlerts(restaurantId);

      expect(result).toEqual([]);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("GET /dashboard/sales-chart/:restaurantId", () => {
    const restaurantId = "restaurant-123";

    it("should return sales chart data with default period", async () => {
      const expectedResponse: SalesChartPointDto[] = [
        {
          date: "2024-01-01",
          revenue: 1250.5,
          bottles: 25,
          glasses: 150,
        },
        {
          date: "2024-01-02",
          revenue: 1800.0,
          bottles: 35,
          glasses: 210,
        },
      ];

      mockDashboardService.getSalesChart.mockResolvedValue(expectedResponse);

      const result = await controller.getSalesChart(restaurantId);

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("date");
      expect(result[0]).toHaveProperty("revenue");
      expect(result[0]).toHaveProperty("bottles");
      expect(result[0]).toHaveProperty("glasses");
      expect(mockDashboardService.getSalesChart).toHaveBeenCalledWith(
        restaurantId,
        "month",
      );
    });

    it("should accept period query parameter", async () => {
      mockDashboardService.getSalesChart.mockResolvedValue([]);

      await controller.getSalesChart(restaurantId, "week");

      expect(mockDashboardService.getSalesChart).toHaveBeenCalledWith(
        restaurantId,
        "week",
      );
    });

    it("should handle different period values", async () => {
      const periods: Array<"day" | "week" | "month" | "year"> = [
        "day",
        "week",
        "month",
        "year",
      ];

      for (const period of periods) {
        mockDashboardService.getSalesChart.mockResolvedValue([]);
        await controller.getSalesChart(restaurantId, period);
        expect(mockDashboardService.getSalesChart).toHaveBeenCalledWith(
          restaurantId,
          period,
        );
      }
    });
  });

  describe("GET /dashboard/inventory-breakdown/:restaurantId", () => {
    const restaurantId = "restaurant-123";

    it("should return inventory breakdown", async () => {
      const expectedResponse: InventoryBreakdownDto = {
        byType: [
          { type: "red", count: 50, value: 25000 },
          { type: "white", count: 30, value: 15000 },
          { type: "rose", count: 20, value: 10000 },
        ],
        byStatus: [
          { status: "in_stock", count: 80 },
          { status: "low_stock", count: 15 },
          { status: "out_of_stock", count: 5 },
        ],
        byLocation: [
          { location: "Cellar A", count: 40 },
          { location: "Cellar B", count: 35 },
          { location: "Bar", count: 25 },
        ],
      };

      mockDashboardService.getInventoryBreakdown.mockResolvedValue(
        expectedResponse,
      );

      const result = await controller.getInventoryBreakdown(restaurantId);

      expect(result).toEqual(expectedResponse);
      expect(result).toHaveProperty("byType");
      expect(result).toHaveProperty("byStatus");
      expect(result).toHaveProperty("byLocation");
      expect(Array.isArray(result.byType)).toBe(true);
      expect(Array.isArray(result.byStatus)).toBe(true);
      expect(Array.isArray(result.byLocation)).toBe(true);
      expect(mockDashboardService.getInventoryBreakdown).toHaveBeenCalledWith(
        restaurantId,
      );
    });

    it("should throw INTERNAL_SERVER_ERROR on service failure", async () => {
      mockDashboardService.getInventoryBreakdown.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(
        controller.getInventoryBreakdown(restaurantId),
      ).rejects.toThrow(
        new HttpException("Database error", HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });
});
