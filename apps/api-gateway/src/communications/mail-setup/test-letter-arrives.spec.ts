/**
 * The "send a test letter" check arriving at the inbound webhook (founder
 * /goal 2026-11-07, "check if the email comes"). A letter whose subject code
 * matches an open check of the house its recipient resolved to is marked
 * arrived and kept out of the vendor pipeline; anything else goes on as
 * before; a failed write answers 503 so the provider retries. No mail is sent.
 */

import { ServiceUnavailableException } from "@nestjs/common";
import { InboundEmailController } from "../../common/orchestrator/inbound-email.controller";
import { InboundAddressService } from "../../common/orchestrator/inbound-address.service";
import { testCodeIn, testSubject } from "./test-letter";
import { HOUSE, OTHER, Row, fakeDb } from "./fake-db.testing";

describe("the test letter arriving at the inbound webhook", () => {
  const SECRET = "s3cret";
  function webhook(checks: Row[], opts: { writeError?: boolean; house?: string | null } = {}) {
    const db = fakeDb({
      mail_setup_checks: { rows: checks, writeErrors: opts.writeError ? [{ message: "down" }] : [] },
    });
    const config = { get: (k: string) => (k === "INBOUND_WEBHOOK_SECRET" ? SECRET : k === "INBOUND_EMAIL_DOMAIN" ? "in.example.test" : undefined) } as any;
    const inbound = new InboundAddressService(db as any, config);
    jest.spyOn(inbound, "resolveRestaurantId").mockResolvedValue(opts.house === undefined ? HOUSE : opts.house);
    const publishEvent = jest.fn(async () => undefined);
    const controller = new InboundEmailController(config, { publishEvent } as any, inbound);
    return { controller, publishEvent, checks };
  }
  const letter = (subject: string) => ({
    From: "me@gmail.test",
    Subject: subject,
    TextBody: "This is a test letter.",
    OriginalRecipient: "r-1a2b3c4d@in.example.test",
  });
  const open = () => ({ id: "k1", restaurant_id: HOUSE, code: "K7QM-2RZD", arrived_at: null, arrived_from: null });

  it("reads the code from the subject, a reply included, and nothing else", () => {
    expect(testCodeIn(testSubject("K7QM-2RZD"))).toBe("K7QM-2RZD");
    expect(testCodeIn("Re: mudavym test letter k7qm-2rzd")).toBe("K7QM-2RZD");
    expect(testCodeIn("Invoice K7QM-2RZD")).toBeNull();
    expect(testCodeIn(null)).toBeNull();
  });

  it("a matched letter is marked arrived for this house and kept out of the vendor pipeline", async () => {
    const { controller, publishEvent, checks } = webhook([open()]);
    const res = await controller.inbound(letter("Mudavym test letter K7QM-2RZD"), SECRET);
    expect(res).toEqual({ status: "ok", restaurant_id: HOUSE, test: true });
    expect(publishEvent).not.toHaveBeenCalled();
    expect(checks[0].arrived_from).toBe("me@gmail.test");
    expect(typeof checks[0].arrived_at).toBe("string");
  });

  it("another house's code does not match; the letter goes on down the normal path", async () => {
    const { controller, publishEvent, checks } = webhook([{ ...open(), restaurant_id: OTHER }]);
    const res = await controller.inbound(letter("Mudavym test letter K7QM-2RZD"), SECRET);
    expect(res).toEqual({ status: "ok", restaurant_id: HOUSE });
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(checks[0].arrived_at).toBeNull();
  });

  it("a letter to no house is never matched to any check", async () => {
    const { controller, publishEvent, checks } = webhook([open()], { house: null });
    await controller.inbound(letter("Mudavym test letter K7QM-2RZD"), SECRET);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(checks[0].arrived_at).toBeNull();
  });

  it("a failed arrival write answers 503 so the provider retries", async () => {
    const { controller, publishEvent } = webhook([open()], { writeError: true });
    await expect(controller.inbound(letter("Mudavym test letter K7QM-2RZD"), SECRET)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it("an ordinary vendor letter is published as before", async () => {
    const { controller, publishEvent } = webhook([open()]);
    const res = await controller.inbound(letter("Order for Friday"), SECRET);
    expect(res).toEqual({ status: "ok", restaurant_id: HOUSE });
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
