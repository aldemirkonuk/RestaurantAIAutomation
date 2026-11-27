import { ForbiddenException } from "@nestjs/common";
import { OnboardingController } from "./menus.controller";

// OB-1 t5 (onboarding walk, 2026-11-07 /goal): the low-stock threshold is set
// on the session's house, by an owner or a manager only. Staff got a 200
// before: the tenant was checked by the JWT guard, the role was not.

const houseA = "rest-A";
const houseB = "rest-B";

describe("PATCH /onboarding/threshold takes the session's house and an owner or manager (OB-1 t5)", () => {
  function controller(role: "owner" | "manager" | "staff") {
    const setDefaultThreshold = jest.fn(async (id: string, min: number) => ({
      default_threshold_min: min,
      threshold_configured: true as const,
      id,
    }));
    const organizations = {
      assertCanManageRestaurant: jest.fn(async () => {
        if (role === "staff") throw new ForbiddenException("Only an owner or a manager may do that.");
      }),
    };
    const ctl = new OnboardingController(
      { setDefaultThreshold } as any,
      {} as any,
      organizations as any,
    );
    return { ctl, setDefaultThreshold, organizations };
  }

  it("staff get a 403 and nothing is written", async () => {
    const { ctl, setDefaultThreshold } = controller("staff");
    await expect(
      ctl.setThreshold({ thresholdMin: 2 }, { userId: "u-1", restaurantId: houseA }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setDefaultThreshold).not.toHaveBeenCalled();
  });

  it("a manager sets it on the session's house", async () => {
    const { ctl, setDefaultThreshold, organizations } = controller("manager");
    await ctl.setThreshold({ thresholdMin: 3 }, { userId: "u-1", restaurantId: houseA });
    expect(organizations.assertCanManageRestaurant).toHaveBeenCalledWith("u-1", houseA, expect.any(String));
    expect(setDefaultThreshold).toHaveBeenCalledWith(houseA, 3);
  });

  it("a body naming another house is refused, never followed", async () => {
    const { ctl, setDefaultThreshold } = controller("owner");
    await expect(
      ctl.setThreshold({ restaurantId: houseB, thresholdMin: 3 }, { userId: "u-1", restaurantId: houseA }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(setDefaultThreshold).not.toHaveBeenCalled();
  });
});
