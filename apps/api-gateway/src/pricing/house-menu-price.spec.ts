import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { heldWords, setHouseMenuPrice } from "./house-menu-price";

/**
 * ADR 0193 round 3 (L4, L5, L11): the one gateway writer of a house price
 * learns locks. Every caller (inventory, menus, advice) reads its answer, so
 * the answer is parsed strictly: a held kind is always named, "locked" with no
 * lock is an error, and an outcome it does not know is an error -- never a
 * success. The SQL behind it is proven in PGlite (cellar-r3-locks.mjs); here
 * the RPC answers the way that SQL does.
 */

function client(data: unknown, error: unknown = null) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  return {
    calls,
    c: {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push([fn, args]);
        return { data, error };
      },
    } as any,
  };
}

const BASE = { restaurantId: "rest-1", inventoryId: "inv-1", source: "import" as const, changedBy: "user-1" };

describe("setHouseMenuPrice -- what a lock held, said per kind (ADR 0193 round 3)", () => {
  it("L11: passes the menu that set the price and the moment of the choice", async () => {
    const { c, calls } = client({ outcome: "changed", held: [], kinds: { bottle: "changed", glass: null } });
    await setHouseMenuPrice(c, { ...BASE, bottle: 60, effectiveFrom: "2026-09-21T12:00:00Z", menuId: "menu-1" });
    expect(calls[0]).toEqual([
      "set_house_menu_price",
      expect.objectContaining({ p_menu_id: "menu-1", p_effective_from: "2026-09-21T12:00:00Z", p_set_bottle: true, p_set_glass: false }),
    ]);
    const other = client({ outcome: "changed", held: [] });
    await setHouseMenuPrice(other.c, { ...BASE, glass: 12 });
    expect(other.calls[0][1]).toMatchObject({ p_menu_id: null, p_effective_from: null });
  });

  it("L5: bottle held, glass changed -- 'changed' AND the held bottle, with its lock", async () => {
    const { c } = client({
      outcome: "changed",
      held: [{ kind: "bottle", lock_id: "lock-1", locked_price: "95.00", locked_by: "user-5", locked_at: "2026-09-01T09:00:00Z" }],
      kinds: { bottle: "locked", glass: "changed" },
    });
    const r = await setHouseMenuPrice(c, { ...BASE, bottle: 110, glass: 17 });
    expect(r.outcome).toBe("changed");
    expect(r.kinds).toEqual({ bottle: "locked", glass: "changed" });
    expect(r.held).toEqual([{ kind: "bottle", lockId: "lock-1", lockedPrice: 95, lockedBy: "user-5", lockedAt: "2026-09-01T09:00:00Z" }]);
    expect(heldWords(r.held)).toBe("the bottle price (locked at 95.00)");
  });

  it("L4: every named kind held is 'locked', and the lock is named", async () => {
    const { c } = client({ outcome: "locked", held: [{ kind: "glass", lock_id: "lock-2", locked_price: 9 }], kinds: { bottle: null, glass: "locked" } });
    const r = await setHouseMenuPrice(c, { ...BASE, glass: 12 });
    expect(r.outcome).toBe("locked");
    expect(r.kinds).toEqual({ bottle: null, glass: "locked" });
  });

  it("'locked' with no lock named is an error -- a hold nobody can see is not an answer", async () => {
    const { c } = client({ outcome: "locked", held: [] });
    await expect(setHouseMenuPrice(c, { ...BASE, bottle: 60 })).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("an outcome this writer does not know is an error, never a success (L5)", async () => {
    for (const outcome of ["held", "", undefined, "ok"]) {
      const { c } = client({ outcome, held: [] });
      await expect(setHouseMenuPrice(c, { ...BASE, bottle: 60 })).rejects.toBeInstanceOf(InternalServerErrorException);
    }
  });

  it("a held entry without its kind or its lock is an error, never dropped", async () => {
    const { c } = client({ outcome: "changed", held: [{ kind: "bottle" }] });
    await expect(setHouseMenuPrice(c, { ...BASE, bottle: 60 })).rejects.toBeInstanceOf(InternalServerErrorException);
    const notAList = client({ outcome: "changed", held: "bottle" });
    await expect(setHouseMenuPrice(notAList.c, { ...BASE, bottle: 60 })).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("an answer without per-kind outcomes falls back to the overall one, and a held kind still reads 'locked'", async () => {
    const { c } = client({ outcome: "stale", held: [{ kind: "glass", lock_id: "lock-3" }] });
    const r = await setHouseMenuPrice(c, { ...BASE, bottle: 60, glass: 12 });
    expect(r.kinds).toEqual({ bottle: "stale", glass: "locked" });
  });

  it.each([
    ["HPL01", ConflictException],
    ["P0002", NotFoundException],
    ["22023", BadRequestException],
    ["XX000", InternalServerErrorException],
  ])("a %s refusal is the HTTP answer it means", async (code, type) => {
    const { c } = client(null, { code, message: "refused" });
    await expect(setHouseMenuPrice(c, { ...BASE, bottle: 60 })).rejects.toBeInstanceOf(type);
  });

  it("naming neither price is refused before any call", async () => {
    const { c, calls } = client({ outcome: "changed" });
    await expect(setHouseMenuPrice(c, { ...BASE })).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toHaveLength(0);
  });
});
