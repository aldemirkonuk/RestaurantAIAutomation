import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { ProviderIntelligenceService } from "./provider-intelligence.service";
import { DatabaseService } from "../database/database.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

/**
 * 2026-09-17 finding — `user.restaurantId` falls back to the nullable
 * `users.restaurant_id` column (jwt.strategy.ts:29-31), so it can be empty on
 * a real session. Reaching `.eq("restaurant_id", ...)` on a NOT NULL uuid
 * column with that value is a 500 carrying a Postgres cast error, not a
 * stated "no house" refusal. These two routes must refuse before the query.
 */
describe("ProviderIntelligenceController — refuses a tenantless session before querying", () => {
  let controller: ProviderIntelligenceController;
  const mockIntelligenceService = {
    getSentimentTrend: jest.fn(),
    compareProviders: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProviderIntelligenceController],
      providers: [
        { provide: ProviderIntelligenceService, useValue: mockIntelligenceService },
        { provide: DatabaseService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ProviderIntelligenceController>(
      ProviderIntelligenceController,
    );
    jest.clearAllMocks();
  });

  describe("getSentimentTrend", () => {
    it("refuses with a 400 when the session carries no restaurant, never reaching the service", async () => {
      await expect(
        controller.getSentimentTrend("prov-1", { restaurantId: "" }, undefined),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntelligenceService.getSentimentTrend).not.toHaveBeenCalled();
    });

    it("calls through when the session has a restaurant", async () => {
      mockIntelligenceService.getSentimentTrend.mockResolvedValue({
        dataPoints: [],
      });

      await controller.getSentimentTrend(
        "prov-1",
        { restaurantId: "r1" },
        undefined,
      );

      expect(mockIntelligenceService.getSentimentTrend).toHaveBeenCalledWith(
        "prov-1",
        "r1",
        30,
      );
    });
  });

  describe("compareProviders", () => {
    it("refuses with a 400 when the session carries no restaurant, never reaching the service", async () => {
      await expect(
        controller.compareProviders({ restaurantId: "" }, undefined),
      ).rejects.toThrow(BadRequestException);

      expect(mockIntelligenceService.compareProviders).not.toHaveBeenCalled();
    });

    it("calls through when the session has a restaurant", async () => {
      mockIntelligenceService.compareProviders.mockResolvedValue([]);

      await controller.compareProviders({ restaurantId: "r1" }, undefined);

      expect(mockIntelligenceService.compareProviders).toHaveBeenCalledWith(
        "r1",
        undefined,
      );
    });
  });
});
