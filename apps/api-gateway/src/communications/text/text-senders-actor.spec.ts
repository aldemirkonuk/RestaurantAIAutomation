import { UnauthorizedException, BadRequestException } from "@nestjs/common";
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
          (s.controller[route] as Function)(
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
