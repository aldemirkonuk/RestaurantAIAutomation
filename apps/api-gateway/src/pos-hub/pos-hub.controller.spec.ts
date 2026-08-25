import { Test, TestingModule } from "@nestjs/testing";
import { HttpException, ValidationPipe } from "@nestjs/common";
import { PosHubController } from "./pos-hub.controller";
import { PosHubService } from "./pos-hub.service";
import { CatalogMatcherService } from "./catalog-matcher.service";
import { PosMappingReviewService } from "./pos-mapping-review.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { IS_PUBLIC_KEY } from "../auth/decorators/public.decorator";
import {
  ListSaleUnitReviewQueryDto,
  SetSaleUnitBatchDto,
  SetSaleUnitDto,
} from "./dto/pos-mapping-review.dto";

/**
 * Guarding and request validation for the sale-unit review routes.
 *
 * The guard assertions are not ceremony: catalog-match approve/reject were
 * reachable unauthenticated once, which meant anyone could operate the human
 * approval gate for any restaurant. These routes write the column that decides
 * how much stock a sale depletes, so "is it actually behind the guard, and did
 * anyone mark it @Public()" is a thing to assert, not to assume.
 */

// Mirrors main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = (metatype: any) => ({ type: "body", metatype }) as any;

describe("PosHubController — sale-unit review routes", () => {
  let controller: PosHubController;

  const mappingReview = {
    listNeedingSaleUnit: jest.fn(),
    setSaleUnit: jest.fn(),
    setSaleUnitBatch: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PosHubController],
      providers: [
        { provide: PosHubService, useValue: {} },
        { provide: CatalogMatcherService, useValue: {} },
        { provide: PosMappingReviewService, useValue: mappingReview },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PosHubController>(PosHubController);
    jest.clearAllMocks();
  });

  describe("guarding", () => {
    it("inherits the class-level JwtAuthGuard", () => {
      const guards = Reflect.getMetadata("__guards__", PosHubController) || [];
      expect(guards).toContain(JwtAuthGuard);
    });

    it("marks none of the review routes @Public() — only the HMAC webhook is", () => {
      const proto = PosHubController.prototype as any;
      for (const route of [
        "saleUnitReview",
        "setSaleUnit",
        "setSaleUnitBatch",
      ]) {
        expect(
          Reflect.getMetadata(IS_PUBLIC_KEY, proto[route]),
        ).toBeUndefined();
      }
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.webhook)).toBe(true);
    });
  });

  describe("GET mappings/:restaurantId/sale-unit-review", () => {
    it("passes the query options through to the service", async () => {
      mappingReview.listNeedingSaleUnit.mockResolvedValue({ items: [] });

      await controller.saleUnitReview("rest-1", {
        includeAnswered: true,
        checkLimit: 50,
      });

      expect(mappingReview.listNeedingSaleUnit).toHaveBeenCalledWith("rest-1", {
        includeAnswered: true,
        checkLimit: 50,
      });
    });

    it("reads ?includeAnswered=false as false, not as a truthy string", async () => {
      const parsed = (await pipe.transform(
        { includeAnswered: "false" },
        meta(ListSaleUnitReviewQueryDto),
      )) as ListSaleUnitReviewQueryDto;

      expect(parsed.includeAnswered).toBe(false);
    });

    it("rejects a checkLimit outside the allowed range", async () => {
      await expect(
        pipe.transform({ checkLimit: 99999 }, meta(ListSaleUnitReviewQueryDto)),
      ).rejects.toThrow();
    });

    it("surfaces a service failure as a 400 rather than a 500", async () => {
      mappingReview.listNeedingSaleUnit.mockRejectedValue(
        new Error("connection reset"),
      );

      await expect(controller.saleUnitReview("rest-1", {})).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe("write validation", () => {
    it("accepts glass and bottle", async () => {
      for (const sale_unit of ["glass", "bottle"]) {
        const parsed = await pipe.transform(
          { sale_unit },
          meta(SetSaleUnitDto),
        );
        expect(parsed).toEqual({ sale_unit });
      }
    });

    it("rejects near-miss units rather than coercing them", async () => {
      for (const sale_unit of ["Glass ", "bottles", "GLASS", "", 1]) {
        await expect(
          pipe.transform({ sale_unit }, meta(SetSaleUnitDto)),
        ).rejects.toThrow();
      }
    });

    it("rejects null — this surface exists to clear null, not to write it", async () => {
      // pos_item_mappings.sale_unit is nullable and upsertItemMapping accepts
      // null, but null is the state that makes applyStockEffects fall through
      // to its "bottle" default. The generic POST /pos-hub/mappings route
      // remains available for callers that genuinely need to write null.
      await expect(
        pipe.transform({ sale_unit: null }, meta(SetSaleUnitDto)),
      ).rejects.toThrow();
    });

    it("rejects unknown body keys (forbidNonWhitelisted)", async () => {
      await expect(
        pipe.transform(
          { sale_unit: "glass", inventory_id: "inv-hijack" },
          meta(SetSaleUnitDto),
        ),
      ).rejects.toThrow();
    });

    it("validates every entry of a batch, not just the first", async () => {
      await expect(
        pipe.transform(
          {
            items: [
              {
                mapping_id: "3f4b2f4e-6d1a-4d3c-9c1e-2b7a6c5d4e3f",
                sale_unit: "glass",
              },
              { mapping_id: "not-a-uuid", sale_unit: "bottle" },
            ],
          },
          meta(SetSaleUnitBatchDto),
        ),
      ).rejects.toThrow();
    });

    it("rejects an empty batch", async () => {
      await expect(
        pipe.transform({ items: [] }, meta(SetSaleUnitBatchDto)),
      ).rejects.toThrow();
    });

    it("delegates a valid single write to the review service", async () => {
      mappingReview.setSaleUnit.mockResolvedValue({ ok: true });

      await controller.setSaleUnit("rest-1", "map-1", { sale_unit: "glass" });

      expect(mappingReview.setSaleUnit).toHaveBeenCalledWith(
        "rest-1",
        "map-1",
        "glass",
      );
    });

    it("delegates a valid batch write to the review service", async () => {
      mappingReview.setSaleUnitBatch.mockResolvedValue({ updated: 1 });
      const items = [{ mapping_id: "map-1", sale_unit: "glass" as const }];

      await controller.setSaleUnitBatch("rest-1", { items });

      expect(mappingReview.setSaleUnitBatch).toHaveBeenCalledWith(
        "rest-1",
        items,
      );
    });

    it("surfaces a write failure as a 400", async () => {
      mappingReview.setSaleUnit.mockRejectedValue(new Error("not found"));

      await expect(
        controller.setSaleUnit("rest-1", "map-x", { sale_unit: "bottle" }),
      ).rejects.toThrow(HttpException);
    });
  });
});
