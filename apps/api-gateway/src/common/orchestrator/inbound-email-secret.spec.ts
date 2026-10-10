/**
 * F-476 — the inbound-email webhook compared its shared secret with `!==`
 * (a timing side channel) and took it from `?secret=` silently. The query form
 * stays (no repo record says the provider can send a header; see the
 * controller's doc comment), but the compare is constant-time and every
 * query-form hit is logged so it can be moved and then removed.
 */
import { timingSafeEqual } from "crypto";
import { Logger } from "@nestjs/common";
import {
  InboundEmailController,
  secretMatches,
} from "./inbound-email.controller";

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});
const tse = timingSafeEqual as unknown as jest.Mock;

const SECRET = "s3cret-inbound-value";

function makeController() {
  const publishEvent = jest.fn(async () => undefined);
  const controller = new InboundEmailController(
    { get: () => SECRET } as any,
    { publishEvent } as any,
    { resolveRestaurantId: async () => null } as any,
  );
  return { controller, publishEvent };
}

const body = { From: "vendor@example.com", Subject: "Re", TextBody: "hi" };

describe("inbound-email webhook secret (F-476)", () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    tse.mockClear();
  });

  it("compares in constant time, on equal-length buffers", async () => {
    const { controller } = makeController();
    await controller.inbound(body, "short");
    expect(tse).toHaveBeenCalled();
    const [a, b] = tse.mock.calls[0] as [Buffer, Buffer];
    expect(a.length).toBe(b.length);
  });

  it("accepts the right header and publishes, without a query warning", async () => {
    const { controller, publishEvent } = makeController();
    const res = await controller.inbound(body, SECRET);
    expect(res.status).not.toBe("unauthorized");
    expect(publishEvent).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/\?secret=/));
  });

  it("refuses a wrong secret, a prefix of it, and a longer one", async () => {
    const { controller, publishEvent } = makeController();
    for (const s of ["nope", SECRET.slice(0, 6), `${SECRET}x`]) {
      expect((await controller.inbound(body, s)).status).toBe("unauthorized");
      expect((await controller.inbound(body, undefined, s)).status).toBe(
        "unauthorized",
      );
    }
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("a header, when sent, is the only secret judged", async () => {
    const { controller } = makeController();
    const res = await controller.inbound(body, "wrong", SECRET);
    expect(res.status).toBe("unauthorized");
  });

  it("still accepts the query form, and says it should move to the header", async () => {
    const { controller, publishEvent } = makeController();
    const res = await controller.inbound(body, undefined, SECRET);
    expect(res.status).not.toBe("unauthorized");
    expect(publishEvent).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/\?secret= query.*x-inbound-secret header/),
    );
  });

  it("secretMatches refuses empty on either side", () => {
    expect(secretMatches("", SECRET)).toBe(false);
    expect(secretMatches(SECRET, "")).toBe(false);
    expect(secretMatches(SECRET, SECRET)).toBe(true);
  });
});
