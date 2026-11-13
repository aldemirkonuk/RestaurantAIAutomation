import { HttpException } from "@nestjs/common";
import { ProvidersController } from "./providers.controller";

/**
 * Who may remove a vendor (r27, vendor-remove-ui). Removing one pauses its
 * standing orders and stops every new order to it (#1283, #1337), and /vendors
 * now shows the control to owners and managers only. The route has to say the
 * same thing, or the hidden button is the only fence.
 */
const USER = { userId: "user-1", restaurantId: "house-1" };
const OUTCOME = {
  standingOrdersPaused: 1,
  schedulesPaused: 0,
  openOrders: 2,
  message: "The vendor was removed.",
};

function make(role: string | null) {
  const service = {
    softDeleteProvider: jest.fn().mockResolvedValue(OUTCOME),
    updateProvider: jest.fn().mockResolvedValue({ id: "p-1" }),
  };
  const organizations = {
    resolveRestaurantRole: jest.fn().mockResolvedValue(role),
  };
  const controller = new ProvidersController(
    service as never,
    organizations as never,
  );
  return { controller, service, organizations };
}

async function refusal(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error("expected a refusal");
}

describe("DELETE /providers/:id — a manager's or an owner's act", () => {
  it.each(["manager", "owner"])("%s removes the vendor and reads the outcome", async (role) => {
    const { controller, service, organizations } = make(role);
    await expect(controller.deleteProvider("p-1", USER as never)).resolves.toEqual({
      success: true,
      ...OUTCOME,
    });
    expect(service.softDeleteProvider).toHaveBeenCalledWith("p-1", "house-1", "user-1");
    expect(organizations.resolveRestaurantRole).toHaveBeenCalledWith("user-1", "house-1");
  });

  it("staff is refused with 403 in words, and nothing is removed", async () => {
    const { controller, service } = make("staff");
    const e = await refusal(controller.deleteProvider("p-1", USER as never));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toContain("You are signed in as staff at this house, so the vendor was not removed.");
    expect(service.softDeleteProvider).not.toHaveBeenCalled();
  });

  it("an unproven role (no row, or the read failed) is refused, never passed", async () => {
    const { controller, service } = make(null);
    const e = await refusal(controller.deleteProvider("p-1", USER as never));
    expect(e.getStatus()).toBe(403);
    expect(e.message).toContain("could not be shown to hold any role");
    expect(service.softDeleteProvider).not.toHaveBeenCalled();
  });
});

describe("PATCH /providers/:id — switching a vendor off is the same act", () => {
  it("staff switching a vendor off is refused, and nothing is written", async () => {
    const { controller, service } = make("staff");
    const e = await refusal(
      controller.updateProvider("p-1", { isActive: false } as never, USER as never),
    );
    expect(e.getStatus()).toBe(403);
    expect(service.updateProvider).not.toHaveBeenCalled();
  });

  it("a manager switches a vendor off", async () => {
    const { controller, service } = make("manager");
    await controller.updateProvider("p-1", { isActive: false } as never, USER as never);
    expect(service.updateProvider).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["another field", { name: "Renamed" }],
    ["switching a vendor back on", { isActive: true }],
  ])("%s is not this check's business (VEN-W30 owns edits)", async (_label, dto) => {
    const { controller, service, organizations } = make("staff");
    await controller.updateProvider("p-1", dto as never, USER as never);
    expect(service.updateProvider).toHaveBeenCalledTimes(1);
    expect(organizations.resolveRestaurantRole).not.toHaveBeenCalled();
  });
});
