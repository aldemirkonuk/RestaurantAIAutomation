import "reflect-metadata";
import { ForbiddenException, RequestMethod, UnprocessableEntityException } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { MenusController } from "./menus.controller";
import { MenusService } from "./menus.service";
import { ImportMenuUrlDto } from "./dto/import-menu-url.dto";
import { fetchMenuLink, type LinkTransport } from "./menu-url-fetch";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r110 menu-r110-2 (DD-r108-66): POST /menus/import-url. The onboarding button
 * (#2252) posted to a route that did not exist (404). An owner or a manager
 * reads a menu from a link; staff are refused before anything is fetched; the
 * house is the session's, never the body's; the fence's refusals (a private
 * address, a redirect into one) are a 422 in its words. No network: DNS and
 * the transport are fakes.
 */

function orgs(role: string | null) {
  const organizations = new OrganizationsService({} as never);
  jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
  return organizations;
}
const USER = { userId: "u-1", restaurantId: "rest-1", role: "manager" };
const REPLY = { menuId: "m-1", current: false, reading: true, itemsExtracted: 0, submissionsCreated: 0, items: [], source: { kept: true, failure: null }, warnings: [] };

describe("the route the onboarding button posts to exists (was 404)", () => {
  it("MenusController answers POST /menus/import-url", () => {
    const handler = MenusController.prototype.importMenuFromUrl;
    expect(Reflect.getMetadata(PATH_METADATA, MenusController)).toBe("menus");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("import-url");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
  });
});

describe("POST /menus/import-url -- owner or manager, the session's house", () => {
  function controller(role: string | null) {
    const importMenuFromUrl = jest.fn(async () => REPLY);
    const c = new MenusController({ importMenuFromUrl } as any, orgs(role));
    return { c, importMenuFromUrl };
  }

  it.each(["owner", "manager"])("a %s reads a link for the session's house", async (role) => {
    const { c, importMenuFromUrl } = controller(role);
    await expect(c.importMenuFromUrl({ url: "https://menu.example/" }, { ...USER, role })).resolves.toMatchObject({ menuId: "m-1", reading: true });
    expect(importMenuFromUrl).toHaveBeenCalledWith("rest-1", "u-1", "https://menu.example/");
  });

  it.each(["staff", null])("%s is refused 403 with a sentence, before anything is fetched", async (role) => {
    const { c, importMenuFromUrl } = controller(role as string | null);
    const p = c.importMenuFromUrl({ url: "https://menu.example/" }, USER);
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await expect(p).rejects.toThrow(/read a menu from a link/);
    expect(importMenuFromUrl).not.toHaveBeenCalled();
  });

  it("a restaurantId in the body is ignored: the house is the session's", async () => {
    const { c, importMenuFromUrl } = controller("owner");
    await c.importMenuFromUrl({ url: "https://menu.example/", restaurantId: "11111111-1111-4111-8111-111111111111" }, USER);
    expect(importMenuFromUrl).toHaveBeenCalledWith("rest-1", "u-1", "https://menu.example/");
  });

  it("a session naming no house is refused, nothing fetched", async () => {
    const { c, importMenuFromUrl } = controller("owner");
    await expect(c.importMenuFromUrl({ url: "https://menu.example/" }, { userId: "u-1" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(importMenuFromUrl).not.toHaveBeenCalled();
  });
});

describe("ImportMenuUrlDto -- what the route takes", () => {
  const check = async (body: object) => (await validate(plainToInstance(ImportMenuUrlDto, body), { whitelist: true, forbidNonWhitelisted: true })).length;
  it("takes { url } and the onboarding client's { restaurantId, url }", async () => {
    expect(await check({ url: "https://menu.example/" })).toBe(0);
    expect(await check({ restaurantId: "11111111-1111-4111-8111-111111111111", url: "https://menu.example/" })).toBe(0);
  });
  it.each(["http://menu.example/", "menu.example", "javascript:alert(1)", `https://a.example/${"x".repeat(2050)}`])("refuses %s", async (url) => {
    expect(await check({ url })).toBeGreaterThan(0);
  });
});

describe("the real fence behind the route -- a private address or a redirect into one is a 422, never read", () => {
  function service(lookup: Record<string, string[]>, pages: Record<string, { status?: number; headers?: Record<string, string> }>) {
    const connected: string[] = [];
    const transport: LinkTransport = async (url) => {
      connected.push(url.toString());
      const page = pages[url.toString()] ?? { status: 404 };
      return { status: page.status ?? 200, headers: page.headers ?? {}, body: (async function* () {})(), abort: () => undefined };
    };
    const dns = async (host: string) => (lookup[host] ?? []).map((address) => ({ address, family: 4 }));
    const svc = new MenusService({ supabase: { from: () => { throw new Error("nothing is written"); } } } as any, undefined as any, undefined as any, undefined as any);
    svc.linkFetcher = (url) => fetchMenuLink(url, { lookup: dns, transport });
    return { svc, connected };
  }

  it("a link to 10.0.0.5 is refused and never connected to", async () => {
    const { svc, connected } = service({}, {});
    const p = svc.importMenuFromUrl("rest-1", "u-1", "https://10.0.0.5/menu");
    await expect(p).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(p).rejects.toThrow(/private network/);
    expect(connected).toEqual([]);
  });

  it("a redirect to a name that resolves privately is refused at the hop", async () => {
    const { svc, connected } = service(
      { "menu.example": ["93.184.216.34"], "inside.example": ["192.168.1.2"] },
      { "https://menu.example/": { status: 302, headers: { location: "https://inside.example/admin" } } },
    );
    await expect(svc.importMenuFromUrl("rest-1", "u-1", "https://menu.example/")).rejects.toThrow(/private network/);
    expect(connected).toEqual(["https://menu.example/"]);
  });
});
