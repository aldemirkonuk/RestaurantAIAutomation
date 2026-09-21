import {
  UnauthorizedException,
  BadRequestException,
  ParseUUIDPipe,
} from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { TextSendersController } from "./text-senders.controller";

const token = { userId: "signed-person", restaurantId: "signed-house" };
function setup() {
  const senders = {
    readout: jest.fn(),
    myConsent: jest.fn(),
    liveConsentCount: jest.fn(),
    transportReadout: jest.fn(),
    declareOwn: jest.fn().mockResolvedValue({}),
    requestRegistration: jest.fn().mockResolvedValue({}),
    revoke: jest.fn(),
    consent: jest.fn(),
    withdraw: jest.fn(),
  };
  const organizations = {
    assertCanManageRestaurant: jest.fn().mockResolvedValue(undefined),
  };
  const whatsapp = { reply: jest.fn().mockResolvedValue({ sent: false }) };
  const book = { windowFor: jest.fn(), phoneBook: jest.fn() };
  return {
    senders,
    organizations,
    whatsapp,
    book,
    controller: new TextSendersController(
      senders as never,
      organizations as never,
      whatsapp as never,
      book as never,
    ),
  };
}
const routes = [
  "readout",
  "declareOwn",
  "requestRegistration",
  "revoke",
  "whatsappReply",
  "window",
  "phoneBook",
  "myConsent",
  "consent",
  "withdraw",
] as const;
describe("text actions name the signed JWT actor", () => {
  it.each(routes)(
    "%s refuses the obsolete id field before any read or write",
    async (route) => {
      const s = setup();
      await expect(
        (async () =>
          (
            s.controller[route] as unknown as (
              user: unknown,
              body: unknown,
            ) => unknown
          )(
            { id: "obsolete", restaurantId: "signed-house" },
            {},
          ))(),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      for (const service of [s.senders, s.organizations, s.whatsapp, s.book])
        for (const fn of Object.values(service))
          expect(fn).not.toHaveBeenCalled();
    },
  );
  it("a reply passes the signed actor and house through the manager guard and send", async () => {
    const s = setup();
    await s.controller.whatsappReply(token, {
      providerId: "vendor",
      body: "Thank you",
    });
    expect(s.organizations.assertCanManageRestaurant).toHaveBeenCalledWith(
      "signed-person",
      "signed-house",
      expect.any(String),
    );
    expect(s.whatsapp.reply).toHaveBeenCalledWith({
      restaurantId: "signed-house",
      userId: "signed-person",
      providerId: "vendor",
      body: "Thank you",
    });
  });
  it("records only the signed person's consent", async () => {
    const s = setup();
    await s.controller.consent(token, {
      phone: "+16505551234",
      channel: "whatsapp",
    });
    expect(s.senders.consent).toHaveBeenCalledWith({
      restaurantId: "signed-house",
      userId: "signed-person",
      phone: "+16505551234",
      channel: "whatsapp",
    });
  });
  it("a manager refusal prevents dispatch", async () => {
    const s = setup();
    s.organizations.assertCanManageRestaurant.mockRejectedValue(
      new Error("not a manager"),
    );
    await expect(
      s.controller.whatsappReply(token, {
        providerId: "vendor",
        body: "Thank you",
      }),
    ).rejects.toThrow("not a manager");
    expect(s.whatsapp.reply).not.toHaveBeenCalled();
  });
  it("refuses a token without an active house", () => {
    expect(() =>
      setup().controller.phoneBook({ userId: "signed-person" }),
    ).toThrow(BadRequestException);
  });
});

describe("the window route takes a vendor id, not any string", () => {
  /**
   * Without a pipe, `GET whatsapp/window/abc` reached the query, and the
   * database's "invalid input syntax for type uuid" came back inside `says`
   * (measured 2026-09-17). Read off the route's own parameter metadata, so the
   * test is about THIS route rather than about Nest.
   */
  const pipesOn = (route: string): unknown[] => {
    const args = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      TextSendersController,
      route,
    ) as Record<string, { data?: unknown; pipes?: unknown[] }>;
    return Object.values(args)
      .filter((a) => a.data === "providerId")
      .flatMap((a) => a.pipes ?? []);
  };

  it("carries a ParseUUIDPipe on :providerId", () => {
    const pipes = pipesOn("window");
    expect(pipes.some((p) => p instanceof ParseUUIDPipe)).toBe(true);
  });

  it("that pipe refuses a non-UUID before any read", async () => {
    const pipe = pipesOn("window").find(
      (p): p is ParseUUIDPipe => p instanceof ParseUUIDPipe,
    )!;
    await expect(
      pipe.transform("abc", { type: "param", data: "providerId" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform("6b1f1c0e-0d3a-4c1e-9f7a-2b8c5d4e3f21", {
        type: "param",
        data: "providerId",
      }),
    ).resolves.toBe("6b1f1c0e-0d3a-4c1e-9f7a-2b8c5d4e3f21");
  });
});
