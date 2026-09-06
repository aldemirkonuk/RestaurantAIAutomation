import { ForbiddenException } from "@nestjs/common";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { ApprovalThresholdsService } from "./approval-thresholds.service";
import { OrganizationsService } from "../organizations/organizations.service";
import { UpdateFeatureFlagsDto } from "./dto/feature-flags.dto";
import { ACTIVE_FEATURE_FLAG_KEYS } from "./feature-flag-registry";

/**
 * A switch anybody may flip is not a policy.
 *
 * The founder's call, 2026-09-05: the flags route gains a manager check — ONE
 * rule for every flag rather than one rule per flag. Until then
 * `PUT /settings/feature-flags` carried `JwtAuthGuard` and `TenantGuard` and no
 * role check at all, while `PUT /settings/approval-thresholds` in the same
 * controller called `assertCanManageRestaurant`. Two routes that both decide
 * what the house lets the system do without a person, disagreeing about who
 * may decide it.
 *
 * The consequence was not theoretical on either side:
 *
 *  - `enable_ai_autonomous_send` was flippable by any authenticated member, and
 *    ON means an AI-written reply reaches a vendor with nobody having read it.
 *  - `enable_house_inbox_read` was kept OUT of `UpdateFeatureFlagsDto` for
 *    exactly this reason (commit `3925cde6`, ADR 0118 D8-D11), which left the
 *    mailbox reader with no way to be switched on by anything at all.
 *
 * THE PRE-FIX BEHAVIOUR WAS MEASURED, NOT ASSERTED. On 2026-09-05 a copy of
 * `git show HEAD:apps/api-gateway/src/settings/settings.controller.ts` was
 * placed beside this file under a temporary name, with its class renamed, and
 * given the staff case below; `jest src/settings/zz-prefix-head.spec.ts`
 * reported 1 passed — the pre-fix controller called `updateFeatureFlags` for a
 * member whose role resolved to `staff`. The probe was deleted after the run;
 * the third test here is the same case, now refused.
 *
 * BOTH SIDES ARE TESTED. A gate only ever exercised on its refusal path cannot
 * tell you it lets the right people through.
 */

const REST = "rest-1";
const USER = "22222222-2222-4222-8222-222222222222";

const DTO: UpdateFeatureFlagsDto = { enable_ai_autonomous_send: true };

function controller(opts: {
  role?: "owner" | "manager" | "staff" | null;
  update?: jest.Mock;
}) {
  const update =
    opts.update ??
    jest.fn().mockResolvedValue({
      enable_ai_negotiation: true,
      enable_ai_autonomous_send: true,
      enable_house_inbox_read: false,
    });

  // The real assertion, not a stub of it: `assertCanManageRestaurant` delegates
  // to `assertManagerOrOwner`, which reads the role through
  // `resolveRestaurantRole`. Stubbing only the role read keeps the rule under
  // test rather than replacing it with a `jest.fn()` that always says yes.
  const organizations = new OrganizationsService({} as never);
  jest
    .spyOn(organizations, "resolveRestaurantRole")
    .mockResolvedValue(opts.role ?? null);

  const settings = { updateFeatureFlags: update } as unknown as SettingsService;
  const thresholds = {} as unknown as ApprovalThresholdsService;

  return {
    controller: new SettingsController(
      settings,
      thresholds,
      organizations,
      // The currency register, added 2026-09-05. Not exercised here — this file
      // owns the FLAG gate — so it is a bare double rather than a live service.
      {} as never,
      // The carrying-cost register, added 2026-09-06 (founder batch 59). Not
      // exercised here; a bare double so this file keeps owning one gate.
      {} as never,
    ),
    update,
  };
}

describe("PUT /settings/feature-flags — who may flip a flag", () => {
  it("an OWNER may write one", async () => {
    const { controller: c, update } = controller({ role: "owner" });
    await c.updateFeatureFlags(REST, DTO, USER);
    expect(update).toHaveBeenCalledWith(REST, DTO, USER);
  });

  it("a MANAGER may write one", async () => {
    const { controller: c, update } = controller({ role: "manager" });
    await c.updateFeatureFlags(REST, DTO, USER);
    expect(update).toHaveBeenCalledWith(REST, DTO, USER);
  });

  it("STAFF is refused, and NOTHING is written", async () => {
    const { controller: c, update } = controller({ role: "staff" });
    await expect(c.updateFeatureFlags(REST, DTO, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("a role that could not be read is refused — an unknown is not permission", async () => {
    // `resolveRestaurantRole` returns null both for "no row here" and for "the
    // read failed". Neither may flip a flag.
    const { controller: c, update } = controller({ role: null });
    await expect(c.updateFeatureFlags(REST, DTO, USER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("the refusal names what was refused, so the page can print the server's sentence", async () => {
    const { controller: c } = controller({ role: "staff" });
    await expect(c.updateFeatureFlags(REST, DTO, USER)).rejects.toThrow(
      /Only managers and owners can change a feature flag for this restaurant/,
    );
  });

  it("STAFF is refused the mailbox reader too — the flag this gate was waited on for", async () => {
    const { controller: c, update } = controller({ role: "staff" });
    await expect(
      c.updateFeatureFlags(REST, { enable_house_inbox_read: true }, USER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("the mailbox reader's switch round-trips", () => {
  it("a manager's write reaches the service and comes back as the server's value", async () => {
    const update = jest.fn().mockResolvedValue({
      enable_ai_negotiation: true,
      enable_ai_autonomous_send: false,
      enable_house_inbox_read: true,
    });
    const { controller: c } = controller({ role: "manager", update });
    const out = await c.updateFeatureFlags(
      REST,
      { enable_house_inbox_read: true },
      USER,
    );
    expect(update).toHaveBeenCalledWith(
      REST,
      { enable_house_inbox_read: true },
      USER,
    );
    expect(out.enable_house_inbox_read).toBe(true);
  });

  it("the key is one the registry declares ACTIVE, so the service will persist it", () => {
    // `updateFeatureFlags` filters the body against `ACTIVE_FEATURE_FLAG_KEYS`
    // (`settings.service.ts:95`). A DTO key the registry does not carry would
    // validate, reach the service, and be dropped in silence — a switch that
    // reports success and changes nothing.
    expect(ACTIVE_FEATURE_FLAG_KEYS).toContain("enable_house_inbox_read");
  });
});
