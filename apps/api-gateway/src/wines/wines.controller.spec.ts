/**
 * POST /wines/submissions/process — platform admin only, the founder's
 * answer of 2026-09-22 (round 6z), verbatim pick (4): "Schedule + admin only
 * (Recommended)": the dedup worker settles `master_wine_library_submissions`
 * rows across every house at once (no tenant scope, ADR 0192's stated gap),
 * so before this file any authenticated member of any house could trigger it
 * by hand. Mirrors `ProspectsController.assertPlatformAdmin`
 * (common/orchestrator/prospects.controller.ts): the `PLATFORM_ADMIN_USER_IDS`
 * allowlist, fail-closed on an unset or empty list.
 *
 * Real: `WinesController` itself, called directly (no HTTP server — the gate
 * is a plain method, not a guard, so there is nothing an HTTP layer adds to
 * this proof). Doubles: `WinesService`, `WineSubmissionsService`,
 * `ConfigService` (jest.fn()s).
 */
import { ForbiddenException } from "@nestjs/common";
import { WinesController } from "./wines.controller";

const ADMIN = "admin-1";
const OWNER = "owner-1";
const HOUSE = "house-1";

function build(allowlist = ADMIN) {
  const winesService = {} as any;
  const wineSubmissionsService = {
    processPendingSubmissions: jest.fn().mockResolvedValue({ processed: 3, results: [] }),
  };
  const configService = { get: jest.fn().mockReturnValue(allowlist) };
  const controller = new WinesController(winesService, wineSubmissionsService as any, configService as any);
  return { controller, wineSubmissionsService, configService };
}

describe("POST /wines/submissions/process is platform admin only", () => {
  it("a platform admin runs it, and the allowlist is read from PLATFORM_ADMIN_USER_IDS", async () => {
    const t = build();
    const out = await t.controller.processSubmissions({ limit: 10 } as any, { userId: ADMIN, restaurantId: HOUSE });
    expect(out).toEqual({ processed: 3, results: [] });
    expect(t.wineSubmissionsService.processPendingSubmissions).toHaveBeenCalledWith(10);
    expect(t.configService.get).toHaveBeenCalledWith("PLATFORM_ADMIN_USER_IDS");
  });

  it("an ordinary owner is refused, and the worker is never called", async () => {
    const t = build();
    await expect(
      t.controller.processSubmissions({ limit: 10 } as any, { userId: OWNER, restaurantId: HOUSE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.wineSubmissionsService.processPendingSubmissions).not.toHaveBeenCalled();
  });

  it("an unset allowlist fails closed — nobody is a platform admin, not even a name that would otherwise match", async () => {
    const t = build("");
    await expect(
      t.controller.processSubmissions({ limit: 10 } as any, { userId: ADMIN, restaurantId: HOUSE }),
    ).rejects.toThrow(/platform admin/);
    expect(t.wineSubmissionsService.processPendingSubmissions).not.toHaveBeenCalled();
  });

  it("the allowlist is a comma-separated list, trimmed", async () => {
    const t = build(" owner-1 , admin-1 ");
    await expect(
      t.controller.processSubmissions({ limit: 10 } as any, { userId: OWNER, restaurantId: HOUSE }),
    ).resolves.toBeDefined();
  });
});
