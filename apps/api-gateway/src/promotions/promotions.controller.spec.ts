import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, NotFoundException } from "@nestjs/common";
import { PromotionsController } from "./promotions.controller";
import { PromotionsService } from "./promotions.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";

describe("PromotionsController", () => {
  let controller: PromotionsController;
  let service: jest.Mocked<Partial<PromotionsService>>;

  const user = { restaurantId: "33333333-3333-3333-3333-333333333333", userId: "u-1" };
  const offerId = "44444444-4444-4444-4444-444444444444";

  beforeEach(async () => {
    service = {
      readForHouse: jest.fn().mockResolvedValue({
        read_at: "2026-09-17T00:00:00.000Z",
        offers: [],
        ledger: { window_days: 540, since: "2026-03-11", paid_lines: 0, house_sightings: 0, market_sightings: 0, skipped_sightings: 0 },
      }),
      dismiss: jest.fn().mockResolvedValue({ dismissed: true, dismissed_at: "2026-09-17T00:00:00.000Z" }),
      restore: jest.fn().mockResolvedValue({ restored: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromotionsController],
      providers: [{ provide: PromotionsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(PromotionsController);
  });

  it("takes the restaurant from the authenticated user, never a query param", async () => {
    await controller.read(user, undefined);
    expect(service.readForHouse).toHaveBeenCalledWith(user.restaurantId, { includeDismissed: false });
  });

  it("parses includeDismissed=true, and only the literal string", async () => {
    await controller.read(user, "true");
    expect(service.readForHouse).toHaveBeenCalledWith(user.restaurantId, { includeDismissed: true });
    await controller.read(user, "1");
    expect(service.readForHouse).toHaveBeenLastCalledWith(user.restaurantId, { includeDismissed: false });
  });

  it("dismiss takes the actor from the token, not the body — no @Body on the route", async () => {
    await controller.dismiss(user, offerId);
    expect(service.dismiss).toHaveBeenCalledWith(user.restaurantId, user.userId, offerId);
  });

  it("restore is scoped to the caller's house", async () => {
    await controller.restore(user, offerId);
    expect(service.restore).toHaveBeenCalledWith(user.restaurantId, offerId);
  });

  it("preserves a 404 from the service rather than flattening it to a 500", async () => {
    (service.dismiss as jest.Mock).mockRejectedValue(new NotFoundException("No such offer on this house's table."));
    await expect(controller.dismiss(user, offerId)).rejects.toMatchObject({ status: 404 });
  });

  it("surfaces an unexpected read failure as a 500, not an empty offers list", async () => {
    (service.readForHouse as jest.Mock).mockRejectedValue(new Error("the offers register could not be read"));
    await expect(controller.read(user, undefined)).rejects.toBeInstanceOf(HttpException);
    await expect(controller.read(user, undefined)).rejects.toMatchObject({ status: 500 });
  });
});
