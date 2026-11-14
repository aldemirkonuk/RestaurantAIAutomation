import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { DatabaseService } from "../../database/database.service";
import { NotificationsService } from "../../notifications/notifications.service";
import { VendorSendAuthorityService } from "../../organizations/vendor-send-authority.service";
import { DeliveryClockService } from "./delivery-clock.service";
import { DeliveryService } from "./delivery.service";
import { DeliveryStockService } from "./delivery-stock.service";

/**
 * r39 walk-w2: on a running server the stock-not-given-back notice still
 * reached staff. The service's optional `authority` was typed as a `Pick<>`,
 * which decorator metadata erases to `Object`, so Nest injected nothing and
 * the notice fell back to the whole house. The unit specs pass the authority
 * by hand and could not see it; this one asks Nest's own injector.
 */
describe("DeliveryService gets the owners-and-managers reader from Nest", () => {
  it("[REVERT-FAILS] the module's VendorSendAuthorityService is the one the notice reads", async () => {
    const authority = { ownersAndManagers: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: DatabaseService, useValue: {} },
        { provide: DeliveryClockService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: DeliveryStockService, useValue: {} },
        { provide: VendorSendAuthorityService, useValue: authority },
      ],
    }).compile();
    const service = moduleRef.get(DeliveryService) as unknown as { authority?: unknown };
    expect(service.authority).toBe(authority);
  });

  it("without the reader in the module it still builds, and the notice falls back to the house", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeliveryService,
        { provide: DatabaseService, useValue: {} },
        { provide: DeliveryClockService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: DeliveryStockService, useValue: {} },
      ],
    }).compile();
    const service = moduleRef.get(DeliveryService) as unknown as { authority?: unknown };
    expect(service.authority).toBeUndefined();
  });
});
