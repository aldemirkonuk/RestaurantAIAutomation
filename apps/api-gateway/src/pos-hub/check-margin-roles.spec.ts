import { ForbiddenException } from "@nestjs/common";
import { PosHubController } from "./pos-hub.controller";
import { assertTenantMatch } from "../common/tenant/assert-tenant-match";

/**
 * GET pos-hub/check-margin/:restaurantId/:checkId reads what a plate cost the
 * house. It carries the house's money, so it takes the same gate as the
 * vendor-prices and sealed-changes reads: holdsHouseMoney(role). The house is
 * JwtAuthGuard's assertTenantMatch, which runs before the handler.
 */
const HOUSE = "house-a";
const MARGIN = { lines: [], cost: 12.5 };

function build() {
  const getCheckMargin = jest.fn().mockResolvedValue(MARGIN);
  const controller = new PosHubController(
    { getCheckMargin } as any,
    {} as any,
    {} as any,
  );
  return { controller, getCheckMargin };
}

describe("check-margin — the house's money gate", () => {
  it("an owner reads it", async () => {
    const { controller, getCheckMargin } = build();
    await expect(
      controller.checkMargin(HOUSE, "c1", { role: "owner" }),
    ).resolves.toBe(MARGIN);
    expect(getCheckMargin).toHaveBeenCalledWith(HOUSE, "c1");
  });

  it("a manager reads it", async () => {
    const { controller, getCheckMargin } = build();
    await expect(
      controller.checkMargin(HOUSE, "c1", { role: "manager" }),
    ).resolves.toBe(MARGIN);
    expect(getCheckMargin).toHaveBeenCalledTimes(1);
  });

  it("staff get a 403 in words and nothing is read", async () => {
    const { controller, getCheckMargin } = build();
    const err: any = await controller
      .checkMargin(HOUSE, "c1", { role: "staff" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toBe(
      "A check's cost and margin is the house's money, so an owner or a manager reads it.",
    );
    expect(getCheckMargin).not.toHaveBeenCalled();
  });

  it("a session with no role gets a 403 and nothing is read", async () => {
    const { controller, getCheckMargin } = build();
    for (const user of [{ role: null }, {}, undefined as any]) {
      await expect(
        controller.checkMargin(HOUSE, "c1", user),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(getCheckMargin).not.toHaveBeenCalled();
  });

  it("another house is a 403 at the guard's tenant check, before the handler", () => {
    const request = {
      user: { userId: "u1", restaurantId: "house-b", role: "owner" },
      params: { restaurantId: HOUSE, checkId: "c1" },
    };
    expect(() => assertTenantMatch(request)).toThrow(ForbiddenException);
  });
});
