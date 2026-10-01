import { Test, TestingModule } from "@nestjs/testing";
import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
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

/** The token's role in its house (jwt.strategy.ts); DASH-W22 reads it. */
const OWNER = { role: "owner" };

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
        todayProcurementSpend: 1250.5,
        weekProcurementSpend: 8750.0,
        monthProcurementSpend: 35000.0,
      };

      mockDashboardService.getStats.mockResolvedValue(expectedResponse);

      const result = await controller.getStats(restaurantId, OWNER);

      expect(result).toEqual({ ...expectedResponse, amounts: "shown" });
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

      await expect(controller.getStats(restaurantId, OWNER)).rejects.toThrow(
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

    it("should return the procurement-spend series with default period", async () => {
      const expectedResponse: SalesChartPointDto[] = [
        {
          date: "2024-01-01",
          procurementSpend: 1250.5,
          bottles: 25,
          glasses: 150,
        },
        {
          date: "2024-01-02",
          procurementSpend: 1800.0,
          bottles: 35,
          glasses: 210,
        },
      ];

      mockDashboardService.getSalesChart.mockResolvedValue(expectedResponse);

      const result = await controller.getSalesChart(restaurantId, undefined, OWNER);

      expect(result).toEqual(expectedResponse);
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty("date");
      // The money field is vendor spend, not sales. Asserting the absence of
      // `revenue` is the point: the old name inverted the sign of the figure
      // for every consumer that plotted it.
      expect(result[0]).toHaveProperty("procurementSpend");
      expect(result[0]).not.toHaveProperty("revenue");
      expect(result[0]).toHaveProperty("bottles");
      expect(result[0]).toHaveProperty("glasses");
      expect(mockDashboardService.getSalesChart).toHaveBeenCalledWith(
        restaurantId,
        "month",
      );
    });

    it("should accept period query parameter", async () => {
      mockDashboardService.getSalesChart.mockResolvedValue([]);

      await controller.getSalesChart(restaurantId, "week", OWNER);

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
        await controller.getSalesChart(restaurantId, period, OWNER);
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

      const result = await controller.getInventoryBreakdown(restaurantId, OWNER);

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
        controller.getInventoryBreakdown(restaurantId, OWNER),
      ).rejects.toThrow(
        new HttpException("Database error", HttpStatus.INTERNAL_SERVER_ERROR),
      );
    });
  });
  // DASH-W22 (founder, 2026-10-01): "A: hide amounts for staff" — the counts
  // stay, the money is not sent.
  describe("DASH-W22 — staff get counts, not money", () => {
    const restaurantId = "restaurant-123";
    const stats = {
      totalWines: 3, totalBottles: 40, totalVolumeMl: 30000, totalVolumeOz: 1014,
      lowStockItems: 1, pendingOrders: 2,
      todayProcurementSpend: 384, weekProcurementSpend: 900, monthProcurementSpend: 4210,
      todayDeliveries: 2, monthBottlesIn: 48, timezone: "America/Chicago",
    };

    it.each([["staff"], [null], [undefined]])("withholds the spend on the stat cards for role %p", async (role) => {
      mockDashboardService.getStats.mockResolvedValue({ ...stats });
      const result: any = await controller.getStats(restaurantId, { role } as any);
      expect(result.todayProcurementSpend).toBeNull();
      expect(result.weekProcurementSpend).toBeNull();
      expect(result.monthProcurementSpend).toBeNull();
      expect(result.amounts).toBe("withheld");
      expect(result.todayDeliveries).toBe(2);
      expect(result.monthBottlesIn).toBe(48);
      expect(result.totalBottles).toBe(40);
    });

    it("keeps the spend for an owner and a manager", async () => {
      for (const role of ["owner", "manager"]) {
        mockDashboardService.getStats.mockResolvedValue({ ...stats });
        const result: any = await controller.getStats(restaurantId, { role });
        expect(result.monthProcurementSpend).toBe(4210);
        expect(result.amounts).toBe("shown");
      }
    });

    it("withholds each day's spend on the month ledger, keeping deliveries and bottles", async () => {
      (mockDashboardService as any).getCalendarRevenue = jest.fn().mockResolvedValue({
        year: 2026, month: 10, restaurant_id: restaurantId,
        daily: [{ date: "2026-10-01", procurement_spend: 384, bottles_sold: 12, events: [], order_count: 1 }],
        monthly_procurement_spend: 384, monthly_bottles: 12,
      });
      const result: any = await controller.getCalendarRevenue(restaurantId, "2026", "10", { role: "staff" });
      expect(result.daily[0]).toMatchObject({ procurement_spend: null, bottles_sold: 12, order_count: 1 });
      expect(result.monthly_procurement_spend).toBeNull();
      expect(result.monthly_bottles).toBe(12);
      expect(result.amounts).toBe("withheld");
    });

    it("refuses the money-only routes to staff, in words, before reading anything", async () => {
      (mockDashboardService as any).getDashboardSummary = jest.fn();
      const staff = { role: "staff" };
      await expect(controller.getSalesChart(restaurantId, "month", staff)).rejects.toThrow(
        "Amounts are for the house's owners and managers.",
      );
      await expect(controller.getInventoryBreakdown(restaurantId, staff)).rejects.toThrow(ForbiddenException);
      await expect(controller.getDashboardSummary(restaurantId, staff)).rejects.toThrow(ForbiddenException);
      expect(mockDashboardService.getSalesChart).not.toHaveBeenCalled();
      expect(mockDashboardService.getInventoryBreakdown).not.toHaveBeenCalled();
      expect((mockDashboardService as any).getDashboardSummary).not.toHaveBeenCalled();
    });
  });
});
