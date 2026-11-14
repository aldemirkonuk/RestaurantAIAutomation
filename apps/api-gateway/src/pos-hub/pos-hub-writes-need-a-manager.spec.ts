import "reflect-metadata";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PosHubController } from "./pos-hub.controller";

/**
 * The POS hub's writes need an owner or a manager (QA round 11, R11-06).
 *
 * `PosHubController` was guarded by JwtAuthGuard alone, so any staff member of
 * a house -- or an owner demoted to staff, whose next request already reads
 * `staff` -- could POST fabricated closed checks that deplete stock through
 * `apply_stock_movement`, remap POS items to other wines, or approve a
 * catalog match. The tenant check kept it inside their own house; nothing
 * asked the role.
 *
 * This drives the real RolesGuard over the real controller's metadata, for
 * each handler, with each role a token can carry.
 *
 * PRE-FIX PROOF: without RolesGuard on the class and @Roles on the writes,
 * the guard is never run and admits every role -- the "staff is refused"
 * cases and the class-guard case fail. The reads and the webhook pass both
 * ways.
 */

const WRITES = [
  "importChecks",
  "upsertMapping",
  "setSaleUnitBatch",
  "setSaleUnit",
  "catalogMatch",
  "approveProposals",
  "approveProposal",
  "rejectProposal",
] as const;

const READS = [
  "getProviders",
  "getStatus",
  "listMappings",
  "saleUnitReview",
  "listProposals",
  "listUnresolved",
] as const;

function admits(handler: string, role: string | null): boolean {
  const fn = (PosHubController.prototype as any)[handler];
  expect(typeof fn).toBe("function");
  const ctx = {
    getHandler: () => fn,
    getClass: () => PosHubController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { userId: "u1", role } }),
    }),
  } as any;
  return new RolesGuard(new Reflector()).canActivate(ctx);
}

describe("PosHubController asks the role on every write (R11-06)", () => {
  it("runs RolesGuard on the whole controller", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PosHubController) ?? [];
    expect(guards).toContain(RolesGuard);
  });

  it.each(WRITES)("%s refuses staff and admits owner and manager", (handler) => {
    expect(admits(handler, "staff")).toBe(false);
    expect(admits(handler, null)).toBe(false);
    expect(admits(handler, "owner")).toBe(true);
    expect(admits(handler, "manager")).toBe(true);
  });

  it.each(READS)("%s stays open to the whole house", (handler) => {
    expect(admits(handler, "staff")).toBe(true);
    expect(admits(handler, "manager")).toBe(true);
  });
});
