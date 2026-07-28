import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, NotFoundException } from "@nestjs/common";
import { DistributorDiscoveryController } from "./distributor-discovery.controller";
import { DistributorDiscoveryService } from "./distributor-discovery.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

describe("DistributorDiscoveryController", () => {
  let controller: DistributorDiscoveryController;
  let service: jest.Mocked<Partial<DistributorDiscoveryService>>;

  const user = { restaurantId: "33333333-3333-3333-3333-333333333333" };

  beforeEach(async () => {
    service = {
      search: jest.fn().mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 }),
      facetCounts: jest.fn().mockResolvedValue({}),
      findById: jest.fn().mockResolvedValue({ vendor: { id: "v1" }, locations: [], territories: [], facets: {} }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DistributorDiscoveryController],
      providers: [{ provide: DistributorDiscoveryService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(DistributorDiscoveryController);
  });

  it("takes the restaurant from the authenticated user", async () => {
    await controller.search(user, { q: "burgundy" });

    expect(service.search).toHaveBeenCalledWith(user.restaurantId, { q: "burgundy" });
  });

  it("passes facet filters through to the service", async () => {
    await controller.facets(user, { territoryOnly: false });

    expect(service.facetCounts).toHaveBeenCalledWith(user.restaurantId, { territoryOnly: false });
  });

  it("preserves a 404 from the service rather than flattening it to a 500", async () => {
    (service.findById as jest.Mock).mockRejectedValue(new NotFoundException("nope"));

    await expect(controller.findById("missing")).rejects.toMatchObject({ status: 404 });
  });

  it("surfaces unexpected failures as a 500", async () => {
    (service.search as jest.Mock).mockRejectedValue(new Error("db down"));

    await expect(controller.search(user, {})).rejects.toBeInstanceOf(HttpException);
    await expect(controller.search(user, {})).rejects.toMatchObject({ status: 500 });
  });
});
