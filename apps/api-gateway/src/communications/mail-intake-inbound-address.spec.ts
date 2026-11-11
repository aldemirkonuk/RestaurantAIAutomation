/**
 * Gap G8 (mail software, 2026-11-11): the house's Mudavym-address webhook.
 * On 4be3b63e6 it read `?secret=`, compared with `!==`, answered 200 to a
 * wrong secret, to an unset one and to a failed publish, and dropped a
 * letter with no readable sender.
 */
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { fakeIntake } from "./testing/shared-mailbox";
import {
  inboundContentKey,
  InboundEmailController,
} from "../common/orchestrator/inbound-email.controller";
import { HouseLettersController } from "./letters/house-letters.controller";

const basic = (user: string, pass: string) =>
  "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");

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

  it("takes the secret as the Basic-auth password (Postmark sends no custom header)", async () => {
    const { intake, recorded } = fakeIntake([]);
    await expect(
      make("s3cret", intake).inbound(body, undefined, basic("inbound", "s3cret")),
    ).resolves.toMatchObject({ status: "ok" });
    expect(recorded).toHaveLength(1);
  });

  it("refuses a wrong Basic-auth password with 401", async () => {
    await expect(
      make("s3cret", fakeIntake([]).intake).inbound(body, undefined, basic("inbound", "nope")),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("still takes the deprecated ?secret= so a deployed hook URL is not 401'd, and says so", async () => {
    const { intake, recorded } = fakeIntake([]);
    const c = make("s3cret", intake);
    const warn = jest.spyOn((c as any).logger, "warn").mockImplementation(() => undefined);
    await expect(c.inbound(body, undefined, undefined, "s3cret")).resolves.toMatchObject({
      status: "ok",
    });
    expect(recorded).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/deprecated/));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("s3cret");
  });

  it("refuses a wrong ?secret= with 401", async () => {
    await expect(
      make("s3cret", fakeIntake([]).intake).inbound(body, undefined, undefined, "nope"),
    ).rejects.toThrow(UnauthorizedException);
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

describe("a delivery with no provider id (gap G2, batch review of #1049)", () => {
  const letter = {
    from: "sales@bigdist.com",
    subject: "Delivery tomorrow",
    body: "Delivery tomorrow 8am",
    recipients: ["house-a@in.example.com"],
  };
  const at = new Date("2026-11-11T10:00:30Z");

  it("two letters with the same words on different dates are two keys", () => {
    expect(
      inboundContentKey({ ...letter, date: "Mon, 9 Nov 2026 07:00:00 +0000" }, at),
    ).not.toBe(inboundContentKey({ ...letter, date: "Tue, 10 Nov 2026 07:00:00 +0000" }, at));
  });

  it("the provider's retry of one letter (same Date, later arrival) is one key", () => {
    const d = "Mon, 9 Nov 2026 07:00:00 +0000";
    expect(inboundContentKey({ ...letter, date: d }, at)).toBe(
      inboundContentKey({ ...letter, date: d }, new Date("2026-11-11T14:00:00Z")),
    );
  });

  it("with no Date at all, the minute of arrival keeps two same-text letters apart", () => {
    expect(inboundContentKey({ ...letter, date: "" }, at)).not.toBe(
      inboundContentKey({ ...letter, date: "" }, new Date("2026-11-12T10:00:30Z")),
    );
  });

  it("the webhook keys a no-id letter on its Date", async () => {
    const { intake, recorded } = fakeIntake([]);
    const c = new InboundEmailController(
      { get: () => "s3cret" } as any,
      {} as any,
      { resolveRestaurantId: async () => "house-A" } as any,
      intake,
    );
    const noId = { From: "sales@bigdist.com", Subject: "Delivery tomorrow", TextBody: "8am" };
    await c.inbound({ ...noId, Date: "Mon, 9 Nov 2026 07:00:00 +0000" }, "s3cret");
    await c.inbound({ ...noId, Date: "Tue, 10 Nov 2026 07:00:00 +0000" }, "s3cret");
    expect(new Set(recorded.map((r: any) => r.providerKey)).size).toBe(2);
  });
});

describe("GET letters/intake tells a house only THAT the shared mailbox failed", () => {
  const make = (door: any) =>
    new HouseLettersController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        houseHealth: async () => ({ byStatus: {}, waiting: 0, oldestWaitingAt: null, unknown: false }),
        doorStatus: async () => door,
      } as any,
    );
  const user = { userId: "u-1", restaurantId: "house-A" };

  it("drops the raw error text and says errored", async () => {
    const res: any = await make({
      lastReadAt: "2026-11-11T10:00:00Z",
      lastStoredAt: null,
      lastError: "mail_intake insert refused (permission denied for table mail_intake)",
    }).intakeHealth(user as any);
    expect(res.sharedMailbox).toEqual({
      lastReadAt: "2026-11-11T10:00:00Z",
      lastStoredAt: null,
      errored: true,
    });
    expect(JSON.stringify(res)).not.toContain("permission denied");
  });

  it("passes unknown and never-read through", async () => {
    expect((await make({ unknown: true }).intakeHealth(user as any) as any).sharedMailbox).toEqual({
      unknown: true,
    });
    expect((await make(null).intakeHealth(user as any) as any).sharedMailbox).toBeNull();
  });
});
