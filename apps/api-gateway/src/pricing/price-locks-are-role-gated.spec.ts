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
    await c.getLocks("rest-1", "staff");
    expect(locks.list).toHaveBeenCalledWith("rest-1");
  });

  // F-619: the advice sentence states the margin and the target, and the
  // price times one minus the margin is the cost. Staff read the lock and
  // the price; only an owner or a manager reads the advice.
  const ADVISED = {
    readable: true,
    locks: [
      {
        lockId: LOCK,
        lockedPrice: 48,
        menuPrice: 48,
        markers: ["off_target", "menu_differs"],
        advice: {
          state: "raise",
          sentence: "Raise the bottle to 57.14 (now 48.00, 16% below it): today's margin is 58%, your target is 70%.",
          advisedPrice: 57.14,
          gapPct: -16,
        },
        adviceUnknownReason: null,
      },
      {
        lockId: OTHER,
        lockedPrice: 30,
        menuPrice: null,
        markers: ["advice_unknown"],
        advice: null,
        adviceUnknownReason: "Cannot advise: the recorded cost is 0.00, and a target margin cannot price a free bottle.",
      },
    ],
  };

  it.each(["staff", "viewer", null])("%s reads each lock without its margin advice", async (role) => {
    const { c, locks } = controller(role as string | null);
    locks.list.mockResolvedValueOnce(ADVISED as any);
    const out: any = await c.getLocks("rest-1", role as string | null);
    expect(out.amountsWithheld).toBe(true);
    expect(out.locks.map((l: any) => l.lockedPrice)).toEqual([48, 30]);
    for (const l of out.locks) {
      expect(l.advice).toBeNull();
      expect(l.adviceUnknownReason).toBeNull();
      expect(l.markers).not.toContain("off_target");
      expect(l.markers).not.toContain("advice_unknown");
    }
    expect(out.locks[0].markers).toEqual(["menu_differs"]);
    expect(JSON.stringify(out)).not.toMatch(/margin|target|cost/i);
  });

  it.each(["owner", "manager"])("a %s reads the locks with the advice", async (role) => {
    const { c, locks } = controller(role);
    locks.list.mockResolvedValueOnce(ADVISED as any);
    const out: any = await c.getLocks("rest-1", role);
    expect(out).toEqual(ADVISED);
  });

  it("a session with no house is refused before any role is read", async () => {
    const { c, locks } = controller("owner");
    await expect(c.lockPrice(undefined as any, "u-1", { inventoryId: INV, kind: "bottle" } as any)).rejects.toMatchObject({ status: 400 });
    await expect(c.getLocks(undefined as any)).rejects.toMatchObject({ status: 400 });
    expect(locks.lock).not.toHaveBeenCalled();
  });
});
