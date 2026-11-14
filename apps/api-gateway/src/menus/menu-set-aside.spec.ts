import { ConflictException, ForbiddenException, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { SET_ASIDE_MAKE_CURRENT_REFUSAL, setMenuAside } from "./menu-set-aside";
import { MenuVersionsController } from "./menus.controller";
import { MenusService } from "./menus.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r36 menu audit N9: a kept menu can be set aside and brought back. The
 * supabase client is a recording fake: every read and write is checked for
 * what it filters on, so a write that could reach another house, or the
 * current menu, fails here.
 */
type Call = { table: string; op: string; args: unknown[] }[];

function fakeDb(rows: Array<Record<string, any> | null>, write: { data?: unknown; error?: unknown } = { data: [{ id: "m-1" }] }) {
  const calls: Call[] = [];
  const reads = [...rows];
  const db = {
    calls,
    from(table: string) {
      const call: Call = [];
      calls.push(call);
      const chain: any = {};
      for (const op of ["select", "eq", "neq", "is", "update"]) {
        chain[op] = (...args: unknown[]) => {
          call.push({ table, op, args });
          return chain;
        };
      }
      chain.maybeSingle = async () => {
        const next = reads.shift();
        return next === undefined ? { data: null, error: null } : { data: next, error: null };
      };
      // An update awaited as is (bring back) or after .select (set aside).
      chain.then = (resolve: (v: unknown) => void) => resolve(write);
      return chain;
    },
  };
  return db;
}
const ops = (call: Call) => call.map((c) => [c.op, ...c.args]);
const AT = "2026-11-14T09:00:00.000Z";

describe("setMenuAside: set a kept menu aside (r36 N9)", () => {
  it("sets a draft aside, scoped to this house and never the current menu, and says who and when", async () => {
    const db = fakeDb([{ id: "m-1", status: "draft", set_aside_at: null }]);
    const r = await setMenuAside(db, "rest-1", "m-1", "u-1", true, () => AT);
    expect(r).toEqual({
      menuId: "m-1",
      setAside: true,
      setAsideAt: AT,
      changed: true,
      said: "Set aside. Its lines are kept as they were read; bring it back from Set aside to make it current again.",
    });
    expect(ops(db.calls[0])).toEqual([
      ["select", "id, status, set_aside_at"],
      ["eq", "id", "m-1"],
      ["eq", "restaurant_id", "rest-1"],
    ]);
    expect(ops(db.calls[1])).toEqual([
      ["update", { set_aside_at: AT, set_aside_by: "u-1" }],
      ["eq", "id", "m-1"],
      ["eq", "restaurant_id", "rest-1"],
      ["neq", "status", "active"],
      ["is", "set_aside_at", null],
      ["select", "id"],
    ]);
  });

  it("an archived menu (current once) can be set aside too", async () => {
    const db = fakeDb([{ id: "m-1", status: "archived", set_aside_at: null }]);
    expect((await setMenuAside(db, "rest-1", "m-1", "u-1", true, () => AT)).changed).toBe(true);
  });

  it("refuses the current menu with a 409, and writes nothing", async () => {
    const db = fakeDb([{ id: "m-1", status: "active", set_aside_at: null }]);
    await expect(setMenuAside(db, "rest-1", "m-1", "u-1", true)).rejects.toThrow(
      new ConflictException(
        "This is the current menu, so it cannot be set aside: the house sells from it. Make another menu current first. Nothing was changed.",
      ),
    );
    expect(db.calls).toHaveLength(1);
  });

  it("another house's menu is a 404, and nothing is written", async () => {
    const db = fakeDb([null]);
    await expect(setMenuAside(db, "rest-1", "m-9", "u-1", true)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.calls).toHaveLength(1);
  });

  it("a menu already set aside answers changed: false, and keeps who set it aside first", async () => {
    const db = fakeDb([{ id: "m-1", status: "draft", set_aside_at: "2026-11-01T00:00:00Z" }]);
    const r = await setMenuAside(db, "rest-1", "m-1", "u-2", true);
    expect(r).toEqual(expect.objectContaining({ changed: false, setAside: true, setAsideAt: "2026-11-01T00:00:00Z" }));
    expect(r.said).toBe("This menu was already set aside. Nothing was changed.");
    expect(db.calls).toHaveLength(1);
  });

  it("a menu made current between the read and the write is refused, never reported as set aside", async () => {
    const db = fakeDb(
      [
        { id: "m-1", status: "draft", set_aside_at: null },
        { id: "m-1", status: "active", set_aside_at: null },
      ],
      { data: [], error: null },
    );
    await expect(setMenuAside(db, "rest-1", "m-1", "u-1", true)).rejects.toBeInstanceOf(ConflictException);
    // The CHECK's own refusal (23514) reads the menu again the same way.
    const viaCheck = fakeDb(
      [
        { id: "m-1", status: "draft", set_aside_at: null },
        { id: "m-1", status: "active", set_aside_at: null },
      ],
      { data: null, error: { code: "23514", message: "check" } },
    );
    await expect(setMenuAside(viaCheck, "rest-1", "m-1", "u-1", true)).rejects.toThrow(/current menu/);
    // Someone else set it aside first: that is said, not an error.
    const raced = fakeDb(
      [
        { id: "m-1", status: "draft", set_aside_at: null },
        { id: "m-1", status: "draft", set_aside_at: "2026-11-14T08:59:00Z" },
      ],
      { data: [], error: null },
    );
    expect(await setMenuAside(raced, "rest-1", "m-1", "u-1", true)).toEqual(
      expect.objectContaining({ changed: false, setAside: true }),
    );
  });

  it("a failed write is a 500 that says nothing changed", async () => {
    const db = fakeDb([{ id: "m-1", status: "draft", set_aside_at: null }], { data: null, error: { code: "08006", message: "connection lost" } });
    await expect(setMenuAside(db, "rest-1", "m-1", "u-1", true)).rejects.toThrow(
      new InternalServerErrorException("The menu could not be set aside: connection lost. Nothing was changed."),
    );
  });
});

describe("setMenuAside: bring a menu back (r36 N9)", () => {
  it("clears who and when, scoped to this house", async () => {
    const db = fakeDb([{ id: "m-1", status: "draft", set_aside_at: AT }], { data: null, error: null });
    const r = await setMenuAside(db, "rest-1", "m-1", "u-1", false);
    expect(r).toEqual({ menuId: "m-1", setAside: false, setAsideAt: null, changed: true, said: "Brought back. It can be made current again." });
    expect(ops(db.calls[1])).toEqual([
      ["update", { set_aside_at: null, set_aside_by: null }],
      ["eq", "id", "m-1"],
      ["eq", "restaurant_id", "rest-1"],
    ]);
  });

  it("a menu that is not set aside answers changed: false, and nothing is written", async () => {
    const db = fakeDb([{ id: "m-1", status: "draft", set_aside_at: null }]);
    expect(await setMenuAside(db, "rest-1", "m-1", "u-1", false)).toEqual(
      expect.objectContaining({ changed: false, said: "This menu is not set aside. Nothing was changed." }),
    );
    expect(db.calls).toHaveLength(1);
  });

  it("a failed write is a 500", async () => {
    const db = fakeDb([{ id: "m-1", status: "draft", set_aside_at: AT }], { data: null, error: { message: "down" } });
    await expect(setMenuAside(db, "rest-1", "m-1", "u-1", false)).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe("POST /menu-versions/:menuId/set-aside and /bring-back: owner or manager only", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const setAside = jest.fn(async () => ({ changed: true }));
    return { c: new MenuVersionsController({ setAside } as any, organizations), setAside };
  }

  it.each(["owner", "manager"])("a %s sets aside and brings back", async (role) => {
    const { c, setAside } = controller(role);
    await c.setAside("rest-1", "u-1", "m-1");
    await c.bringBack("rest-1", "u-1", "m-1");
    expect(setAside.mock.calls).toEqual([
      ["rest-1", "m-1", "u-1", true],
      ["rest-1", "m-1", "u-1", false],
    ]);
  });

  it.each(["staff", null])("%s is refused, and nothing is set aside or brought back", async (role) => {
    const { c, setAside } = controller(role);
    await expect(c.setAside("rest-1", "u-1", "m-1")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(c.bringBack("rest-1", "u-1", "m-1")).rejects.toBeInstanceOf(ForbiddenException);
    expect(setAside).not.toHaveBeenCalled();
  });
});

describe("make-current refuses a menu set aside (r36 N9)", () => {
  it("is refused with a 409 before the plan is worked out, and nothing is switched", async () => {
    const service = Object.create(MenusService.prototype) as MenusService & Record<string, any>;
    const rpc = jest.fn();
    service.readLines = jest.fn(async () => []);
    service.readVersionRow = jest.fn(async () => ({ id: "m-1", status: "draft", set_aside_at: AT }));
    service.computePlan = jest.fn();
    service.dbService = { supabase: { rpc } };
    await expect(service.makeCurrent("rest-1", "m-1", "u-1", "fp-1")).rejects.toThrow(new ConflictException(SET_ASIDE_MAKE_CURRENT_REFUSAL));
    expect(service.computePlan).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
