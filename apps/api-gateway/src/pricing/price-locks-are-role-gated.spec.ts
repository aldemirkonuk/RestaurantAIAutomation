import { ForbiddenException } from "@nestjs/common";
import { PricingController } from "./pricing.controller";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * ADR 0193 round 3, L8: setting, changing, moving and releasing a price lock
 * -- and confirming a wine's own pour (round 6c answer 3) -- are an owner's or
 * a manager's, checked by the same `assertCanManageRestaurant` gate as a price
 * edit, BEFORE any write. Anyone of the house may read the locks.
 *
 * The real OrganizationsService decides; only its access-row read is stubbed.
 */
function controller(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  const locks = {
    list: jest.fn(async () => ({ readable: true, locks: [] })),
    lock: jest.fn(async () => ({ outcome: "locked" })),
    release: jest.fn(async () => ({ outcome: "released" })),
    changeAndKeep: jest.fn(async () => ({ outcome: "changed_and_locked" })),
    move: jest.fn(async () => ({ outcome: "moved" })),
  };
  const targets = { confirmWinePour: jest.fn(async () => ({ pour: { confirmed: true } })) };
  const c = new PricingController(targets as any, {} as any, organizations, locks as any);
  return { c, locks, targets };
}

const INV = "00000000-0000-4000-8000-000000000001";
const LOCK = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";

async function everyWrite(c: PricingController) {
  return [
    () => c.lockPrice("rest-1", "u-1", { inventoryId: INV, kind: "bottle", note: "season" } as any),
    () => c.releaseLock("rest-1", "u-1", LOCK, { note: "done" } as any),
    () => c.changeLockedPrice("rest-1", "u-1", LOCK, { price: 58 } as any),
    () => c.moveLock("rest-1", "u-1", LOCK, { targetInventoryId: OTHER, price: 42 } as any),
    () => c.confirmWinePour("rest-1", "u-1", INV, { pourMl: 75 } as any),
  ];
}

describe("price locks and a wine's pour -- owner or manager only (L8)", () => {
  it.each(["owner", "manager"])("a %s may lock, release, change, move and confirm a pour", async (role) => {
    const { c, locks, targets } = controller(role);
    for (const act of await everyWrite(c)) await act();
    expect(locks.lock).toHaveBeenCalledWith("rest-1", INV, "bottle", "u-1", "season");
    expect(locks.release).toHaveBeenCalledWith("rest-1", LOCK, "u-1", "done");
    expect(locks.changeAndKeep).toHaveBeenCalledWith("rest-1", LOCK, 58, "u-1", null);
    expect(locks.move).toHaveBeenCalledWith("rest-1", LOCK, OTHER, 42, "u-1", null);
    expect(targets.confirmWinePour).toHaveBeenCalledWith("rest-1", INV, { pourMl: 75 }, "u-1");
  });

  it.each(["staff", "viewer", null])("%s is refused every one of them (403) before anything is written", async (role) => {
    const { c, locks, targets } = controller(role as string | null);
    for (const act of await everyWrite(c)) await expect(act()).rejects.toBeInstanceOf(ForbiddenException);
    expect(locks.lock).not.toHaveBeenCalled();
    expect(locks.release).not.toHaveBeenCalled();
    expect(locks.changeAndKeep).not.toHaveBeenCalled();
    expect(locks.move).not.toHaveBeenCalled();
    expect(targets.confirmWinePour).not.toHaveBeenCalled();
  });

  it("staff may READ the locks (read-only wherever they see the price)", async () => {
    const { c, locks } = controller("staff");
    await c.getLocks("rest-1");
    expect(locks.list).toHaveBeenCalledWith("rest-1");
  });

  it("a session with no house is refused before any role is read", async () => {
    const { c, locks } = controller("owner");
    await expect(c.lockPrice(undefined as any, "u-1", { inventoryId: INV, kind: "bottle" } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.getLocks(undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(locks.lock).not.toHaveBeenCalled();
  });
});
