/**
 * QA round 24 (2026-11-07): SPF, DKIM and DMARC were never consulted. A letter
 * the receiving server said did not come from sales@bigdist.com was filed as
 * BigDist's and handed to the responder. It is now held in the house as
 * "could not confirm it came from sales@bigdist.com", never filed as the
 * vendor's.
 *
 * Only the receiving server's own verdict is believed: the TOPMOST
 * Authentication-Results, with Gmail's authserv-id. The sender can write its
 * own Authentication-Results further down, and the header map keeps the last.
 */
import { fakeIntake, fakeWatch, reader } from "./testing/shared-mailbox";
import { CommunicationsController } from "./communications.controller";
import {
  ingressAuthenticationResults,
  senderUnconfirmed,
} from "./sender-authentication";
import { bridge, inbound, memoryDb, Row } from "./testing/mail-store";

const VENDOR = "sales@bigdist.com";
const PROVIDER = {
  id: "prov-A",
  restaurant_id: "house-A",
  name: "BigDist",
  contact_email: VENDOR,
  deleted_at: null,
};
const ORDER = {
  id: "order-A",
  provider_id: "prov-A",
  restaurant_id: "house-A",
  status: "NEGOTIATING",
  wine_name: "Barolo",
};
const house = (): Record<string, Row[]> => ({
  restaurants: [{ id: "house-A" }],
  providers: [PROVIDER],
  procurement_orders: [ORDER],
  procurement_conversations: [],
});

const G = "mx.google.com";
const FAIL = `${G}; dkim=none; spf=fail (google.com: domain of ${VENDOR} does not designate 203.0.113.9 as permitted sender) smtp.mailfrom=${VENDOR}; dmarc=fail (p=REJECT) header.from=bigdist.com`;
const PASS = `${G}; dkim=pass header.i=@bigdist.com header.s=s1; spf=pass smtp.mailfrom=${VENDOR}; dmarc=pass (p=REJECT) header.from=bigdist.com`;

describe("senderUnconfirmed: what the receiving server said", () => {
  it.each<[string, string | null, boolean]>([
    ["dmarc=fail", `${G}; dmarc=fail header.from=bigdist.com`, true],
    ["the full forged letter", FAIL, true],
    ["a clean pass", PASS, false],
    [
      "spf=fail with no dkim",
      `${G}; spf=fail smtp.mailfrom=${VENDOR}`,
      true,
    ],
    [
      "spf=fail with no smtp.mailfrom named",
      `${G}; spf=fail`,
      true,
    ],
    [
      "spf=fail, but the vendor's own dkim passes (a forwarder)",
      `${G}; spf=fail smtp.mailfrom=${VENDOR}; dkim=pass header.d=bigdist.com`,
      false,
    ],
    [
      "spf=fail, dkim passes for a subdomain of the vendor",
      `${G}; spf=fail smtp.mailfrom=${VENDOR}; dkim=pass header.i=@mail.bigdist.com`,
      false,
    ],
    [
      "spf=fail, dkim passes for someone else's domain",
      `${G}; spf=fail smtp.mailfrom=${VENDOR}; dkim=pass header.d=evil.example`,
      true,
    ],
    [
      "spf=fail for an envelope that is not the vendor's (a bounce relay)",
      `${G}; spf=fail smtp.mailfrom=bounce@esp.example`,
      false,
    ],
    ["spf=softfail decides nothing", `${G}; spf=softfail smtp.mailfrom=${VENDOR}`, false],
    ["dmarc=none decides nothing", `${G}; dmarc=none header.from=bigdist.com`, false],
    ["dmarc=temperror decides nothing", `${G}; dmarc=temperror`, false],
    ["no verdict at all", null, false],
    ["an empty verdict", "   ", false],
    [
      "a fail written only in a comment",
      `${G}; spf=pass (dmarc=fail) smtp.mailfrom=${VENDOR}`,
      false,
    ],
    [
      "a fail written only in a quoted string",
      `${G}; spf=pass smtp.mailfrom="dmarc=fail"`,
      false,
    ],
    ["upper case", `${G}; DMARC=FAIL header.from=bigdist.com`, true],
  ])("%s", (_l, verdict, want) => {
    expect(senderUnconfirmed(verdict, VENDOR)).toBe(want);
  });
});

describe("ingressAuthenticationResults: only the receiving server's own line", () => {
  it("takes the topmost Authentication-Results", () => {
    expect(
      ingressAuthenticationResults([
        { name: "Delivered-To", value: "house@x" },
        { name: "Authentication-Results", value: FAIL },
        { name: "From", value: VENDOR },
        { name: "Authentication-Results", value: PASS },
      ]),
    ).toBe(FAIL);
  });

  it("never a lower one the sender wrote, when the top one is another server's", () => {
    expect(
      ingressAuthenticationResults([
        { name: "authentication-results", value: `relay.example; spf=pass` },
        { name: "Authentication-Results", value: PASS },
      ]),
    ).toBeNull();
  });

  it("not a line whose authserv-id only starts like Gmail's", () => {
    expect(
      ingressAuthenticationResults([
        { name: "Authentication-Results", value: `mx.google.com.evil.example; dmarc=pass` },
      ]),
    ).toBeNull();
  });

  it("reads the authserv-id past a comment and a version", () => {
    const v = `(Gmail) mx.google.com 1; dmarc=fail`;
    expect(
      ingressAuthenticationResults([{ name: "Authentication-Results", value: v }]),
    ).toBe(v);
  });

  it("no headers, no verdict", () => {
    expect(ingressAuthenticationResults([])).toBeNull();
    expect(ingressAuthenticationResults(undefined as any)).toBeNull();
  });
});

describe("the bridge: a letter the receiving server did not confirm is not the vendor's", () => {
  it("dmarc=fail: held in the house as unconfirmed; no thread, order, responder or promotion", async () => {
    const { svc, inserts, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: `BigDist <${VENDOR}>`,
        subject: "New bank details for invoice 4411",
        gmail_message_id: "m-f",
        ingress_authentication_results: FAIL,
        attachments: [{ filename: "i.pdf", mime_type: "application/pdf", data: "QQ==" }],
      }),
    );
    expect(inserts).toEqual([]);
    expect(events.some((e) => e[0] === "responder")).toBe(false);
    expect(events.some((e) => e[0] === "emitConversationUpdated")).toBe(false);
    const held = events.filter((e) => e[0] === "held").map((e) => e[1]);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      restaurantId: "house-A",
      heldReason: "sender_unconfirmed",
      senderEmail: VENDOR,
    });
    const persisted = events.find((e) => e[0] === "persistManagerNotification");
    expect(persisted?.[2]).toMatchObject({
      priority: "high",
      metadata: { kind: "held_letter", held_reason: "sender_unconfirmed" },
    });
    expect(persisted?.[2].title).toContain(VENDOR);
  });

  it("a pass is filed under the vendor as before", async () => {
    const { svc, inserts, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: VENDOR,
        gmail_message_id: "m-p",
        ingress_authentication_results: PASS,
      }),
    );
    const row = inserts.find((i) => i.table === "procurement_conversations")?.row;
    expect(row).toMatchObject({ provider_id: "prov-A", order_id: "order-A" });
    expect(events.some((e) => e[0] === "held")).toBe(false);
  });

  it("no verdict (the webhook, today) is filed under the vendor as before", async () => {
    const { svc, inserts, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({ restaurant_id: "house-A", from: VENDOR, gmail_message_id: "m-n" }),
    );
    expect(inserts.some((i) => i.table === "procurement_conversations")).toBe(true);
    expect(events.some((e) => e[0] === "held")).toBe(false);
  });

  it("a forged pass in the header map does not outweigh the receiving server's fail", async () => {
    const { svc, inserts, events } = bridge(house());
    await svc.handleInboundEmail(
      inbound({
        restaurant_id: "house-A",
        from: VENDOR,
        gmail_message_id: "m-x",
        headers: { "authentication-results": PASS },
        ingress_authentication_results: FAIL,
      }),
    );
    expect(inserts).toEqual([]);
    expect(events.filter((e) => e[0] === "held")).toHaveLength(1);
  });
});

describe("the Gmail publishers send the receiving server's own verdict", () => {
  const MSG = (id: string) => ({
    id,
    threadId: `t-${id}`,
    payload: {
      headers: [
        { name: "Authentication-Results", value: FAIL },
        { name: "From", value: VENDOR },
        { name: "Subject", value: "Re: order" },
        { name: "Authentication-Results", value: PASS },
      ],
      body: { data: Buffer.from("ok").toString("base64url") },
    },
  });

  function controller() {
    const published: any[] = [];
    const db = memoryDb(house());
    const messages = [MSG("g1")];
    const { watch } = fakeWatch(messages);
    const c = new CommunicationsController(
      {} as any,
      { getSenderEmail: () => "house@mudavym.example" } as any,
      {} as any,
      watch,
      {
        publishEvent: async (_x: string, _k: string, p: any) =>
          void published.push(p),
      } as any,
      { get: () => undefined } as any,
      db as any,
      { verifyPushRequest: async () => true } as any,
      reader(watch, fakeIntake(published).intake, db),
    );
    return { c, published };
  }

  it("the Gmail push path", async () => {
    const { c, published } = controller();
    await c.handleGmailWebhook(
      {
        message: {
          data: Buffer.from(
            JSON.stringify({ emailAddress: "x@y", historyId: 2 }),
          ).toString("base64"),
        },
      },
      "Bearer t",
    );
    expect(published.map((p) => p.ingress_authentication_results)).toEqual([FAIL]);
  });

  it("the force-fetch recovery path", async () => {
    const { c, published } = controller();
    await c.forceGmailFetch({ minutesBack: 5 });
    expect(published.map((p) => p.ingress_authentication_results)).toEqual([FAIL]);
  });
});
