/**
 * `InboundEmailController.inbound()` — the door's status codes.
 *
 * Mail proposal F16 / G8 (founder /goal 2026-11-07): an inbound-parse provider
 * (Postmark / SES / Mailgun) only retries a letter it did NOT get a 2xx for.
 * The door used to answer 200 for a bad secret (`{status:'unauthorized'}`),
 * for an unset secret (`{status:'disabled'}`) and for any failure resolving the
 * house or publishing the event (`{status:'error'}`) — so a failed letter was
 * recorded as delivered and lost. These pin: 401 for a bad secret, 503 when
 * the secret is unset or the hand-off fails, a constant-time compare, and the
 * `INBOUND_WEBHOOK_ALLOW_QUERY_SECRET` flag over `?secret=`.
 */

import * as crypto from "crypto";
import { HttpException } from "@nestjs/common";
import { InboundEmailController } from "./inbound-email.controller";

// Node's crypto exports are non-configurable, so jest.spyOn cannot wrap
// timingSafeEqual; a module mock that delegates to the real one can.
jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto");
  return { ...actual, timingSafeEqual: jest.fn(actual.timingSafeEqual) };
});

const SECRET = "right-secret-value";
const PAYLOAD = {
  From: "vendor@example.com",
  Subject: "Re: order",
  TextBody: "We can deliver Tuesday.",
  OriginalRecipient: "r-abc@inbound.example",
};

function makeController(
  env: Record<string, string | undefined> = {},
  overrides: {
    publishEvent?: jest.Mock;
    resolveRestaurantId?: jest.Mock;
  } = {},
) {
  const values: Record<string, string | undefined> = {
    INBOUND_WEBHOOK_SECRET: SECRET,
    ...env,
  };
  const configStub = { get: (k: string) => values[k] } as any;
  const publishEvent =
    overrides.publishEvent ?? jest.fn().mockResolvedValue(undefined);
  const resolveRestaurantId =
    overrides.resolveRestaurantId ?? jest.fn().mockResolvedValue("house-1");
  const controller = new InboundEmailController(
    configStub,
    { publishEvent } as any,
    { resolveRestaurantId } as any,
  );
  return { controller, publishEvent, resolveRestaurantId };
}

/** Resolves to the HttpException the handler threw, or fails the test. */
async function statusOf(p: Promise<unknown>): Promise<number> {
  let result: unknown;
  try {
    result = await p;
  } catch (e) {
    expect(e).toBeInstanceOf(HttpException);
    return (e as HttpException).getStatus();
  }
  throw new Error(
    `expected an HttpException, handler resolved ${JSON.stringify(result)}`,
  );
}

afterEach(() => jest.restoreAllMocks());

describe("InboundEmailController.inbound — the door refuses loudly", () => {
  it("(f) happy path still returns {status:'ok', restaurant_id}", async () => {
    const { controller, publishEvent } = makeController();
    await expect(controller.inbound(PAYLOAD, SECRET)).resolves.toEqual({
      status: "ok",
      restaurant_id: "house-1",
    });
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent.mock.calls[0][2]).toMatchObject({
      restaurant_id: "house-1",
      from: "vendor@example.com",
      source: "inbound-domain",
    });
  });

  it("(b) wrong header secret -> 401, not a resolved 200 object", async () => {
    const { controller, publishEvent } = makeController();
    expect(await statusOf(controller.inbound(PAYLOAD, "wrong-secret"))).toBe(
      401,
    );
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("(b) missing secret -> 401", async () => {
    const { controller, publishEvent } = makeController();
    expect(await statusOf(controller.inbound(PAYLOAD))).toBe(401);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("(b) a secret of a different length -> 401 (no length throw)", async () => {
    const { controller } = makeController();
    expect(await statusOf(controller.inbound(PAYLOAD, "x"))).toBe(401);
    expect(
      await statusOf(controller.inbound(PAYLOAD, SECRET + SECRET + "tail")),
    ).toBe(401);
  });

  it("(c) the compare goes through crypto.timingSafeEqual", async () => {
    const spy = crypto.timingSafeEqual as unknown as jest.Mock;
    spy.mockClear();
    const { controller } = makeController();
    await controller.inbound(PAYLOAD, SECRET);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    await statusOf(controller.inbound(PAYLOAD, "wrong-secret"));
    expect(spy).toHaveBeenCalled();
  });

  it("(a) ALLOW flag 'false': ?secret=<right> alone -> 401, nothing published", async () => {
    const { controller, publishEvent } = makeController({
      INBOUND_WEBHOOK_ALLOW_QUERY_SECRET: "false",
    });
    expect(await statusOf(controller.inbound(PAYLOAD, undefined, SECRET))).toBe(
      401,
    );
    expect(publishEvent).not.toHaveBeenCalled();
    // The header still opens the door under the flag.
    await expect(controller.inbound(PAYLOAD, SECRET)).resolves.toMatchObject({
      status: "ok",
    });
  });

  it("(a) flag unset: ?secret=<right> is still accepted (the default)", async () => {
    const { controller, publishEvent } = makeController();
    await expect(
      controller.inbound(PAYLOAD, undefined, SECRET),
    ).resolves.toEqual({ status: "ok", restaurant_id: "house-1" });
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });

  it("(e) INBOUND_WEBHOOK_SECRET unset -> 503", async () => {
    const { controller, publishEvent } = makeController({
      INBOUND_WEBHOOK_SECRET: undefined,
    });
    expect(await statusOf(controller.inbound(PAYLOAD, SECRET))).toBe(503);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("(d) publishEvent rejecting -> HttpException >= 500 so the provider retries", async () => {
    const { controller } = makeController(
      {},
      { publishEvent: jest.fn().mockRejectedValue(new Error("broker down")) },
    );
    expect(
      await statusOf(controller.inbound(PAYLOAD, SECRET)),
    ).toBeGreaterThanOrEqual(500);
  });

  it("(d) resolveRestaurantId rejecting -> HttpException >= 500", async () => {
    const { controller, publishEvent } = makeController(
      {},
      {
        resolveRestaurantId: jest
          .fn()
          .mockRejectedValue(new Error("db unreachable")),
      },
    );
    expect(
      await statusOf(controller.inbound(PAYLOAD, SECRET)),
    ).toBeGreaterThanOrEqual(500);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("a payload with no sender stays 200 {status:'ignored'} (a retry cannot fix it)", async () => {
    const { controller, publishEvent } = makeController();
    await expect(
      controller.inbound({ Subject: "no from" }, SECRET),
    ).resolves.toEqual({ status: "ignored" });
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("never logs either secret value", async () => {
    const { Logger } = await import("@nestjs/common");
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    const { controller } = makeController();
    await statusOf(controller.inbound(PAYLOAD, "wrong-header-secret", SECRET));
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("wrong-header-secret");
  });
});
