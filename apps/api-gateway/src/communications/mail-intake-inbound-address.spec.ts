/**
 * Gap G8 (mail software, 2026-11-11): the house's Mudavym-address webhook.
 * On 4be3b63e6 it read `?secret=`, compared with `!==`, answered 200 to a
 * wrong secret, to an unset one and to a failed publish, and dropped a
 * letter with no readable sender.
 */
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { fakeIntake } from "./testing/shared-mailbox";
import { InboundEmailController } from "../common/orchestrator/inbound-email.controller";

describe("the inbound-address webhook (gap G8)", () => {
  const make = (secret: string | undefined, intake: any) =>
    new InboundEmailController(
      { get: (k: string) => (k === "INBOUND_WEBHOOK_SECRET" ? secret : undefined) } as any,
      {} as any,
      { resolveRestaurantId: async () => "house-A" } as any,
      intake,
    );
  const body = { From: "sales@bigdist.com", Subject: "Hi", TextBody: "x", MessageID: "pm-1" };

  it("refuses a wrong secret with 401", async () => {
    await expect(make("s3cret", fakeIntake([]).intake).inbound(body, "nope")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("does not read the secret from the URL any more", () => {
    expect(InboundEmailController.prototype.inbound.length).toBe(2);
  });

  it("refuses with 503 when no secret is set", async () => {
    await expect(make(undefined, fakeIntake([]).intake).inbound(body, "")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("records the letter under the provider's id before answering 200", async () => {
    const { intake, recorded } = fakeIntake([]);
    await expect(make("s3cret", intake).inbound(body, "s3cret")).resolves.toMatchObject({
      status: "ok",
    });
    expect(recorded[0]).toMatchObject({ door: "inbound_address", providerKey: "pm-1", restaurantId: "house-A" });
  });

  it("answers 503 when the letter could not be recorded, so the provider sends it again", async () => {
    await expect(make("s3cret", fakeIntake([], true).intake).inbound(body, "s3cret")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("records a letter with no sender too: the bridge holds it", async () => {
    const { intake, recorded } = fakeIntake([]);
    await make("s3cret", intake).inbound({ Subject: "?", MessageID: "pm-2" }, "s3cret");
    expect(recorded).toHaveLength(1);
  });
});

