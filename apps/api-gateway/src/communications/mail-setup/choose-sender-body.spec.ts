/**
 * Clearing the house's sending mailbox must be said, never implied (QA round
 * 26, #976 minor; probe B3-typo-clears).
 *
 * `PUT /communications/mail-setup/sender` with `{}` passed validation and the
 * controller turned the missing key into `null`, which CLEARS the choice and
 * answers 200. Now the key must be present: a UUID chooses, `null` clears,
 * and anything else is refused before the service is reached.
 *
 * The pipe here is configured as main.ts configures the global one.
 */

import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { ChooseMailSenderDto, MailSetupController } from "./mail-setup.controller";

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) =>
  pipe.transform(body, { type: "body", metatype: ChooseMailSenderDto, data: undefined });

const G = "11111111-1111-4111-8111-111111111111";
const USER = { userId: "22222222-2222-4222-8222-222222222222", restaurantId: "33333333-3333-4333-8333-333333333333" } as any;

describe("the sender body says what it means", () => {
  it("an empty body is refused, not read as clearing", async () => {
    await expect(validate({})).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a misspelt key is refused", async () => {
    await expect(validate({ connection_id: G })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a mailbox id chooses, and an explicit null clears", async () => {
    await expect(validate({ connectionId: G })).resolves.toMatchObject({ connectionId: G });
    await expect(validate({ connectionId: null })).resolves.toMatchObject({ connectionId: null });
  });

  it("a junk id is refused", async () => {
    await expect(validate({ connectionId: "not-a-mailbox" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("the controller never turns a missing key into a clear, even without the pipe", async () => {
    const setup = { chooseSender: jest.fn().mockResolvedValue({}) };
    const ctl = new MailSetupController(setup as any);
    await expect(ctl.chooseSender(USER, "owner", {} as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.chooseSender(USER, "owner", undefined as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(setup.chooseSender).not.toHaveBeenCalled();
    await ctl.chooseSender(USER, "owner", { connectionId: null });
    expect(setup.chooseSender).toHaveBeenCalledWith(USER.restaurantId, USER.userId, "owner", null);
  });
});
