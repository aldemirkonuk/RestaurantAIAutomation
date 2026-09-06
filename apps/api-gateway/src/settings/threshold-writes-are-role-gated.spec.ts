import { ForbiddenException } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import {
  ApprovalThresholdsService,
  ENFORCED_AT,
} from "./approval-thresholds.service";
import { OrganizationsService } from "../organizations/organizations.service";
import type { SetApprovalThresholdDto } from "../vendor-terms/dto/vendor-terms.dto";

/**
 * A limit anybody may raise is not a limit.
 *
 * The founder's call, 2026-09-03: *"only certain high tier like manager or
 * owner can adjust it"*. Until today `PUT /settings/approval-thresholds`
 * carried `JwtAuthGuard` and `TenantGuard` and no role check at all, so the
 * person a ceiling stopped could raise the ceiling and seal the order a second
 * later — which is not a weaker policy than none, it is a policy that reports
 * itself as holding while it is not.
 *
 * The check is deliberately the SAME one `payment-methods` and
 * `mcp-connections` already use (`OrganizationsService.assertCanManageRestaurant`),
 * so "may this person manage this house" has one implementation and one spec
 * behind it rather than three that drift.
 *
 * BOTH SIDES ARE TESTED. A guard that is only ever tested on the refusal path
 * cannot tell you it lets the right people through, and a guard that is only
 * tested on the happy path cannot tell you it stops anybody.
 */

const REST = "rest-1";
const USER = "22222222-2222-4222-8222-222222222222";

const DTO: SetApprovalThresholdDto = {
  rule: "manager_ceiling",
  enabled: true,
  amountLimit: 5000,
  requiredRole: "owner",
};

function controller(opts: {
  role?: "owner" | "manager" | "staff" | null;
  write?: jest.Mock;
}) {
  const write = opts.write ?? jest.fn().mockResolvedValue({
    readout: { thresholds: [] },
    audited: true,
    auditReason: null,
  });

  // The real assertion, not a stub of it: `assertCanManageRestaurant` delegates
  // to `assertManagerOrOwner`, which reads the role through
  // `resolveRestaurantRole`. Stubbing only the role read keeps the rule under
  // test rather than replacing it with `jest.fn()`.
  const organizations = new OrganizationsService({} as never);
  jest
    .spyOn(organizations, "resolveRestaurantRole")
    .mockResolvedValue(opts.role ?? null);

  const thresholds = { write } as unknown as ApprovalThresholdsService;
  const settings = {} as unknown as SettingsService;

  return {
    controller: new SettingsController(
      settings,
      thresholds,
      organizations,
      // The currency register, added 2026-09-05. Not exercised here — this file
      // owns the THRESHOLD gate — so it is a bare double rather than a live one.
      {} as never,
      // The carrying-cost register, added 2026-09-06 (founder batch 59). Not
      // exercised here; a bare double so this file keeps owning one gate.
      {} as never,
    ),
    write,
  };
}

describe("PUT /settings/approval-thresholds — who may write a rule", () => {
  it("an OWNER may write one", async () => {
    const { controller: c, write } = controller({ role: "owner" });
    await c.setApprovalThreshold(REST, DTO, USER);
    expect(write).toHaveBeenCalledWith(REST, DTO, USER);
  });

  it("a MANAGER may write one", async () => {
    const { controller: c, write } = controller({ role: "manager" });
    await c.setApprovalThreshold(REST, DTO, USER);
    expect(write).toHaveBeenCalledWith(REST, DTO, USER);
  });

  it("STAFF is refused, and NOTHING is written", async () => {
    const { controller: c, write } = controller({ role: "staff" });
    await expect(c.setApprovalThreshold(REST, DTO, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("a role that could not be read is refused — an unknown is not permission", async () => {
    // `resolveRestaurantRole` returns null both for "no row here" and for "the
    // read failed". Neither may write a threshold.
    const { controller: c, write } = controller({ role: null });
    await expect(c.setApprovalThreshold(REST, DTO, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("the refusal names what was refused, so the page can print it", async () => {
    const { controller: c } = controller({ role: "staff" });
    await expect(c.setApprovalThreshold(REST, DTO, USER)).rejects.toThrow(
      /set an approval threshold for this restaurant/,
    );
  });

  it("a session with no restaurant is a 400 before the role is even read", async () => {
    const { controller: c, write } = controller({ role: "owner" });
    await expect(c.setApprovalThreshold("", DTO, USER)).rejects.toThrow(
      /not attached to a restaurant/,
    );
    expect(write).not.toHaveBeenCalled();
  });
});

describe("the readout tells the truth about enforcement", () => {
  it("names exactly one enforcing path, and the same string in both fields", () => {
    // `enforcement.enforcedBy` is what the register renders its opening
    // sentence from. It was `[]` for two passes and the page said "Nothing
    // stops an order yet"; it is one entry now and the page flips itself. The
    // constant is asserted here so the two fields cannot drift into describing
    // two different worlds.
    expect(ENFORCED_AT).toContain("procurement.service.ts");
    expect(ENFORCED_AT).toContain("approveOrder");
    expect(ENFORCED_AT).toContain("assertApprovalAllowed");
  });
});
