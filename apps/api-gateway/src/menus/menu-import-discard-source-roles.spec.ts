import { ForbiddenException } from "@nestjs/common";
import { MenuVersionsController, MenusController } from "./menus.controller";
import { OrganizationsService } from "../organizations/organizations.service";
import { withheldRawText } from "./import-reply-view";

/**
 * ADR 0358 D2 (locked under the founder's /goal, 2026-11-07): any member of a
 * house may read a menu in; discarding a line and opening the kept source file
 * are an owner's or a manager's; a member who may not see money and suppliers
 * is not sent a line's raw text in the import reply.
 *
 * The real OrganizationsService decides; only its access-row read is stubbed.
 */
function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}

const READ = {
  menuId: "m-1",
  current: false as const,
  itemsExtracted: 1,
  submissionsCreated: 0,
  items: [{ menuItemId: "mi-1", name: "Barolo", rawText: "Barolo 2019;95;cost 41;Supplier X" }],
  source: { kept: true, failure: null },
  warnings: [],
};

describe("POST /menus/import -- any member reads a menu in; the raw line follows ROLE_POLICY", () => {
  function controller() {
    const importMenu = jest.fn(async () => structuredClone(READ));
    const c = new MenusController({ importMenu } as any, orgs("staff"));
    return { c, importMenu };
  }

  it.each(["owner", "manager"])("a %s is sent each line's raw text", async (role) => {
    const { c, importMenu } = controller();
    const reply = await c.importMenu({ method: "scan" } as any, { userId: "u-1", restaurantId: "rest-1", role });
    expect(importMenu).toHaveBeenCalledWith({ method: "scan" }, "u-1");
    expect(reply.items[0].rawText).toBe(READ.items[0].rawText);
    expect((reply as any).rawLineWithheld).toBeUndefined();
  });

  it.each(["staff", null, undefined])("%s may read a menu in, but is sent no raw text, and is told it was held back", async (role) => {
    const { c, importMenu } = controller();
    const reply = await c.importMenu({ method: "scan" } as any, { userId: "u-1", restaurantId: "rest-1", role: role as any });
    expect(importMenu).toHaveBeenCalledTimes(1);
    expect(reply.items[0].rawText).toBeNull();
    expect(reply.items[0].name).toBe("Barolo");
    expect((reply as any).rawLineWithheld).toBe(true);
    expect(JSON.stringify(reply)).not.toContain("cost 41");
  });

  it("a reply with no items passes through untouched", () => {
    const empty = { menuId: "m-2" } as any;
    expect(withheldRawText(empty, false)).toBe(empty);
  });
});

describe("PATCH /menus/:restaurantId/items/:id/discard -- owner or manager only", () => {
  function controller(role: string | null) {
    const discard = jest.fn(async () => ({ menuItemId: "mi-1", status: "discarded" }));
    const c = new MenusController({ discardMenuItem: discard } as any, orgs(role));
    return { c, discard };
  }

  it.each(["owner", "manager"])("a %s may discard a line", async (role) => {
    const { c, discard } = controller(role);
    await c.discardMenuItem("rest-1", "mi-1", { userId: "u-1" });
    expect(discard).toHaveBeenCalledWith("rest-1", "mi-1");
  });

  it.each(["staff", null])("%s is refused before anything is read or written", async (role) => {
    const { c, discard } = controller(role as string | null);
    await expect(c.discardMenuItem("rest-1", "mi-1", { userId: "u-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(discard).not.toHaveBeenCalled();
  });

  it("a session naming nobody is refused", async () => {
    const { c, discard } = controller("owner");
    await expect(c.discardMenuItem("rest-1", "mi-1", {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(discard).not.toHaveBeenCalled();
  });
});

describe("GET /menu-versions/:menuId/source -- owner or manager only", () => {
  const MENU = "00000000-0000-4000-8000-000000000001";
  function controller(role: string | null) {
    const sourceUrl = jest.fn(async () => ({ url: "https://signed", expiresInSeconds: 300, mime: "text/csv" }));
    const c = new MenuVersionsController({ sourceUrl } as any, orgs(role));
    return { c, sourceUrl };
  }

  it.each(["owner", "manager"])("a %s gets the five-minute link", async (role) => {
    const { c, sourceUrl } = controller(role);
    await expect(c.source("rest-1", "u-1", MENU)).resolves.toMatchObject({ url: "https://signed" });
    expect(sourceUrl).toHaveBeenCalledWith("rest-1", MENU);
  });

  it.each(["staff", null])("%s is refused, and no link is minted", async (role) => {
    const { c, sourceUrl } = controller(role as string | null);
    await expect(c.source("rest-1", "u-1", MENU)).rejects.toBeInstanceOf(ForbiddenException);
    expect(sourceUrl).not.toHaveBeenCalled();
  });

  it("a session with no house is refused before the role is read", async () => {
    const { c, sourceUrl } = controller("owner");
    await expect(c.source(undefined as any, "u-1", MENU)).rejects.toMatchObject({ status: 400 });
    expect(sourceUrl).not.toHaveBeenCalled();
  });
});

describe("GET /menu-versions/:id/read -- a finished background read follows the same raw-line rule", () => {
  function controller() {
    const readStatus = jest.fn(async () => ({
      menuId: "m-1",
      state: "done" as const,
      failure: null,
      warnings: [],
      reply: structuredClone(READ),
    }));
    return { c: new MenuVersionsController({ readStatus } as any, orgs("staff")), readStatus };
  }

  it("an owner is sent the raw text; staff are not, and are told it was held back", async () => {
    const { c, readStatus } = controller();
    const owner: any = await c.read("rest-1", "owner", "m-1");
    expect(readStatus).toHaveBeenCalledWith("rest-1", "m-1");
    expect(owner.reply.items[0].rawText).toBe(READ.items[0].rawText);
    const staff: any = await c.read("rest-1", "staff", "m-1");
    expect(staff.reply.items[0].rawText).toBeNull();
    expect(staff.reply.rawLineWithheld).toBe(true);
    expect(JSON.stringify(staff)).not.toContain("cost 41");
  });
});

describe("PATCH /menu-versions/:menuId/items/:itemId/house-good -- owner or manager only (r28 G21)", () => {
  const MENU = "00000000-0000-4000-8000-000000000001";
  const ITEM = "00000000-0000-4000-8000-000000000002";
  const GOOD = "00000000-0000-4000-8000-000000000003";
  function controller(role: string | null) {
    const linkLineToHouseGood = jest.fn(async () => ({ menuItemId: ITEM, inventoryItemId: GOOD, goodName: "House Red" }));
    const c = new MenuVersionsController({ linkLineToHouseGood } as any, orgs(role));
    return { c, linkLineToHouseGood };
  }

  it.each(["owner", "manager"])("a %s links the line, in the session's own house", async (role) => {
    const { c, linkLineToHouseGood } = controller(role);
    await expect(c.linkHouseGood("rest-1", "u-1", MENU, ITEM, { inventoryItemId: GOOD })).resolves.toMatchObject({ goodName: "House Red" });
    expect(linkLineToHouseGood).toHaveBeenCalledWith("rest-1", MENU, ITEM, GOOD);
  });

  it.each(["staff", null])("%s is refused, and nothing is linked", async (role) => {
    const { c, linkLineToHouseGood } = controller(role as string | null);
    await expect(c.linkHouseGood("rest-1", "u-1", MENU, ITEM, { inventoryItemId: GOOD })).rejects.toBeInstanceOf(ForbiddenException);
    expect(linkLineToHouseGood).not.toHaveBeenCalled();
  });
});
