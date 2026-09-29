import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { DevTruthController } from "./dev-truth.controller";

/**
 * `/dev/truth` is for developers only (founder, 2026-09-29: "only devs can
 * open it"). The browser gate is not a control on its own, so the gateway
 * refuses a non-developer with 403 before any tenant row count is read, and
 * refuses a restaurant other than the session's own. Production still 404s
 * for everybody, developer or not.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function build(isDeveloper: boolean) {
  const service = {
    reach: jest.fn(async () => ({ ok: "reach" })),
    swallow: jest.fn(async () => ({ ok: "swallow" })),
    asOf: jest.fn(async () => ({ ok: "asof" })),
  };
  const operators = { isDeveloper: jest.fn(async () => isDeveloper) };
  const controller = new DevTruthController(service as any, operators as any);
  return { controller, service, operators };
}

const dev = { userId: "u-dev", restaurantId: HOUSE };

describe("DevTruthController access (developers only)", () => {
  const env = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it.each([
    ["reach", (c: DevTruthController, u: any, r: string) => c.reach(r, u)],
    ["swallow", (c: DevTruthController, u: any, r: string) => c.swallow(r, u)],
    ["asof", (c: DevTruthController, u: any, r: string) => c.asOf(r, u, undefined)],
  ])("%s: a non-developer gets 403 and nothing is read", async (_n, call) => {
    const { controller, service, operators } = build(false);
    await expect(call(controller, dev, HOUSE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(operators.isDeveloper).toHaveBeenCalledWith("u-dev");
    expect(service.reach).not.toHaveBeenCalled();
    expect(service.swallow).not.toHaveBeenCalled();
    expect(service.asOf).not.toHaveBeenCalled();
  });

  it("a developer reads their own house", async () => {
    const { controller, service } = build(true);
    await expect(controller.reach(HOUSE, dev)).resolves.toEqual({ ok: "reach" });
    await expect(controller.swallow(HOUSE, dev)).resolves.toEqual({ ok: "swallow" });
    await expect(controller.asOf(HOUSE, dev, "2026-09-01")).resolves.toEqual({ ok: "asof" });
    expect(service.asOf).toHaveBeenCalledWith(HOUSE, "2026-09-01");
  });

  it.each([
    ["reach", (c: DevTruthController, u: any, r: string) => c.reach(r, u)],
    ["swallow", (c: DevTruthController, u: any, r: string) => c.swallow(r, u)],
    ["asof", (c: DevTruthController, u: any, r: string) => c.asOf(r, u, undefined)],
  ])("%s: a developer naming another house gets 403", async (_n, call) => {
    const { controller, service } = build(true);
    await expect(call(controller, dev, OTHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      call(controller, { userId: "u-dev", restaurantId: null }, HOUSE),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.reach).not.toHaveBeenCalled();
    expect(service.swallow).not.toHaveBeenCalled();
    expect(service.asOf).not.toHaveBeenCalled();
  });

  it("production 404s for everybody, before the developer check", async () => {
    process.env.NODE_ENV = "production";
    for (const isDev of [true, false]) {
      const { controller, operators } = build(isDev);
      await expect(controller.reach(HOUSE, dev)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(operators.isDeveloper).not.toHaveBeenCalled();
    }
  });
});
