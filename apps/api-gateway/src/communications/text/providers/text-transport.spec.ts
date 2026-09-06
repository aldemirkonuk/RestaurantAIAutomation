/**
 * The two adapters, against the providers' own documented shapes.
 *
 * NOTHING IN THIS FILE PERFORMS A NETWORK CALL. There is no `fetch` mock,
 * because there is nothing to mock: `buildRequest` and `parseResponse` are pure,
 * and the fixtures come from `provider-fixtures.ts`, which carries the URL and
 * the fetch date for every shape.
 *
 * The one structural assertion at the bottom is the load-bearing one: it reads
 * the adapter source and fails if either file ever acquires an HTTP call, so
 * "nothing sends" stops being a promise in an ADR and becomes a test.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { MetaCloudAdapter, META_MAX_BODY_CHARS } from "./meta-cloud.adapter";
import { TwilioAdapter, isAlphanumericSender } from "./twilio.adapter";
import {
  META_ACCEPTED_BODY,
  META_EMPTY_200_BODY,
  META_WINDOW_CLOSED_BODY,
  TWILIO_FAILED_BODY,
  TWILIO_PRICED_BODY,
  TWILIO_QUEUED_BODY,
  TWILIO_REQUEST_REFUSED_BODY,
} from "./provider-fixtures";
import type { TransportCredential } from "./text-transport";

const metaCredential: TransportCredential = {
  provider: "meta_cloud",
  owner: "house",
  accessToken: "EAAJB-not-a-real-token",
  accountRef: "106540352242922-waba",
  senderRef: "106540352242922",
  serviceRef: null,
  apiVersion: null,
};

const twilioCredential: TransportCredential = {
  provider: "twilio",
  owner: "platform",
  accessToken: "not-a-real-key",
  accountRef: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  senderRef: "+15005550006",
  serviceRef: null,
  apiVersion: null,
};

describe("MetaCloudAdapter.buildRequest", () => {
  const adapter = new MetaCloudAdapter();

  it("builds the exact shape Meta documents, at the pinned Graph version", () => {
    const req = adapter.buildRequest(metaCredential, {
      toE164: "+16505551234",
      body: "Your order is confirmed.",
      windowOpen: true,
    });

    expect(req.method).toBe("POST");
    expect(req.url).toBe(
      "https://graph.facebook.com/v25.0/106540352242922/messages",
    );
    expect(req.encoding).toBe("json");
    expect(req.body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+16505551234",
      type: "text",
      text: { preview_url: false, body: "Your order is confirmed." },
    });
  });

  it("uses the credential's own API version when it names one", () => {
    const req = adapter.buildRequest(
      { ...metaCredential, apiVersion: "v24.0" },
      { toE164: "+16505551234", body: "hi", windowOpen: true },
    );
    expect(req.url).toContain("/v24.0/");
  });

  it("refuses a CLOSED window and an UNREAD window with different sentences", () => {
    const closed = () =>
      adapter.buildRequest(metaCredential, {
        toE164: "+1",
        body: "hi",
        windowOpen: false,
      });
    const unknown = () =>
      adapter.buildRequest(metaCredential, {
        toE164: "+1",
        body: "hi",
        windowOpen: null,
      });

    expect(closed).toThrow(/window is closed/);
    expect(unknown).toThrow(/could not be read/);
    // The point of the pair: a reader must be able to tell our ignorance from
    // the house's situation. If these two ever collapse into one sentence, the
    // product is telling a manager a fact about us as if it were a fact about
    // their conversation.
    let a = "";
    let b = "";
    try {
      closed();
    } catch (e) {
      a = (e as Error).message;
    }
    try {
      unknown();
    } catch (e) {
      b = (e as Error).message;
    }
    expect(a).not.toEqual(b);
  });

  it("refuses an over-long body rather than truncating it", () => {
    expect(() =>
      adapter.buildRequest(metaCredential, {
        toE164: "+1",
        body: "x".repeat(META_MAX_BODY_CHARS + 1),
        windowOpen: true,
      }),
    ).toThrow(/nothing was truncated/);
  });

  it("refuses a credential for the wrong provider", () => {
    expect(() =>
      adapter.buildRequest(
        { ...metaCredential, provider: "twilio" },
        { toE164: "+1", body: "hi", windowOpen: true },
      ),
    ).toThrow(/was handed a twilio credential/);
  });
});

describe("MetaCloudAdapter.parseResponse", () => {
  const adapter = new MetaCloudAdapter();

  it("reads the documented success envelope and returns the wamid", () => {
    const out = adapter.parseResponse(200, META_ACCEPTED_BODY);
    expect(out.kind).toBe("accepted_by_provider");
    expect(out.providerRef).toBe(
      "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI1RjQyNUE3NEYxMzAzMzQ5MkEA",
    );
    // Accepted is not delivered, and the adapter says so rather than inventing
    // a status Meta did not send.
    expect(out.providerStatus).toBeNull();
    expect(out.detail).toMatch(/not a handset showing it/);
  });

  it("prices a free-form message at nothing, and says which rule makes it free", () => {
    const out = adapter.parseResponse(200, META_ACCEPTED_BODY);
    expect(out.chargeable).toBe(false);
    expect(out.chargeableReason).toMatch(/non-template/);
    expect(out.cost).toEqual({
      state: "not_reported_yet",
      minor: null,
      currency: null,
    });
  });

  it("reads Meta's error envelope on a 4xx and keeps the code", () => {
    const out = adapter.parseResponse(400, META_WINDOW_CLOSED_BODY);
    expect(out.kind).toBe("refused_by_provider");
    expect(out.errorCode).toBe("131047");
    expect(out.providerRef).toBeNull();
    expect(out.chargeable).toBe(false);
  });

  it("treats an error object on a 200 as a refusal, not a send", () => {
    // Providers do ship this. A status-only check would file it as success.
    const out = adapter.parseResponse(200, META_WINDOW_CLOSED_BODY);
    expect(out.kind).toBe("refused_by_provider");
  });

  it("returns UNKNOWN and no id for a 200 with no message id", () => {
    const out = adapter.parseResponse(200, META_EMPTY_200_BODY);
    expect(out.kind).toBe("unreadable");
    expect(out.providerRef).toBeNull();
    // The regression this test exists for: ADR 0084 deleted a fabricated
    // messageId for a message nobody sent.
    expect(out.detail).toMatch(/recorded as unknown rather than as sent/);
    expect(out.chargeable).toBe(false);
  });
});

describe("TwilioAdapter.buildRequest", () => {
  const adapter = new TwilioAdapter();

  it("form-encodes to the 2010 Messages endpoint with From", () => {
    const req = adapter.buildRequest(twilioCredential, {
      toE164: "+905551112233",
      body: "Delivery confirmed.",
      windowOpen: null,
    });
    expect(req.encoding).toBe("form");
    expect(req.url).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages.json",
    );
    expect(req.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(req.body).toEqual({
      To: "+905551112233",
      Body: "Delivery confirmed.",
      From: "+15005550006",
    });
  });

  it("prefers a Messaging Service SID over From when the house has one", () => {
    const req = adapter.buildRequest(
      { ...twilioCredential, serviceRef: "MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
      { toE164: "+1", body: "hi", windowOpen: null },
    );
    expect(req.body).toHaveProperty(
      "MessagingServiceSid",
      "MGbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(req.body).not.toHaveProperty("From");
  });

  it("refuses an alphanumeric sender whose body carries no opt-out", () => {
    // Twilio: "Twilio's SMS STOP keyword does not work to automatically stop
    // Alphanumeric Sender ID messaging. You must provide other instructions."
    expect(() =>
      adapter.buildRequest(
        { ...twilioCredential, senderRef: "MUDAVYM" },
        {
          toE164: "+905551112233",
          body: "Delivery confirmed.",
          windowOpen: null,
        },
      ),
    ).toThrow(/must carry its own opt-out instruction/);
  });

  it("admits an alphanumeric sender whose body carries one, in either language", () => {
    for (const body of [
      "Delivery confirmed. Reply STOP to opt out.",
      "Teslimat onaylandi. Bildirimleri iptal etmek icin bizi arayin.",
    ]) {
      expect(() =>
        adapter.buildRequest(
          { ...twilioCredential, senderRef: "MUDAVYM" },
          { toE164: "+905551112233", body, windowOpen: null },
        ),
      ).not.toThrow();
    }
  });

  it("knows an alphanumeric sender from an E.164 number", () => {
    expect(isAlphanumericSender("MUDAVYM")).toBe(true);
    expect(isAlphanumericSender("+15005550006")).toBe(false);
    expect(isAlphanumericSender("12345678901")).toBe(false); // digits only
    expect(isAlphanumericSender("TWELVECHARSX")).toBe(false); // 12 > 11
  });
});

describe("TwilioAdapter.parseResponse", () => {
  const adapter = new TwilioAdapter();

  it("does not invent a cost for a queued message", () => {
    const out = adapter.parseResponse(201, TWILIO_QUEUED_BODY);
    expect(out.kind).toBe("accepted_by_provider");
    expect(out.providerRef).toBe("SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(out.providerStatus).toBe("queued");
    expect(out.cost.state).toBe("not_reported_yet");
    expect(out.cost.minor).toBeNull();
    // The distinction the whole meter is built on: it counts NOW and learns
    // what it cost LATER.
    expect(out.chargeable).toBe(true);
    expect(out.chargeableReason).toMatch(/populates `price` after the send/);
  });

  it("reads a reported price as positive minor units with its currency", () => {
    const out = adapter.parseResponse(200, TWILIO_PRICED_BODY);
    // -0.00750 USD, quoted negative because it is an amount billed.
    expect(out.cost).toEqual({ state: "reported", minor: 1, currency: "USD" });
  });

  it("does not treat a missing price as free", () => {
    const out = adapter.parseResponse(200, {
      ...TWILIO_PRICED_BODY,
      price: null,
      price_unit: null,
    });
    expect(out.cost.state).toBe("not_reported_yet");
    expect(out.cost.minor).toBeNull();
  });

  it("treats a 2xx carrying status=failed as a refusal, not a send", () => {
    const out = adapter.parseResponse(201, TWILIO_FAILED_BODY);
    expect(out.kind).toBe("refused_by_provider");
    expect(out.providerStatus).toBe("failed");
    expect(out.errorCode).toBe("30041");
    expect(out.detail).toMatch(/It will not arrive/);
  });

  it("reads Twilio's request-level error envelope", () => {
    const out = adapter.parseResponse(400, TWILIO_REQUEST_REFUSED_BODY);
    expect(out.kind).toBe("refused_by_provider");
    expect(out.errorCode).toBe("21657");
    expect(out.providerRef).toBeNull();
  });

  it("returns UNKNOWN and no reference for a 2xx with no SID", () => {
    const out = adapter.parseResponse(200, { status: "queued" });
    expect(out.kind).toBe("unreadable");
    expect(out.providerRef).toBeNull();
    expect(out.chargeable).toBe(false);
  });
});

describe("the adapters cannot send", () => {
  /**
   * READ OFF THE SOURCE, not asserted about behaviour.
   *
   * A behavioural test ("calling buildRequest does not hit the network") passes
   * on a file that added a `fetch` in a different method. This reads both
   * adapter files and the registry and fails if any HTTP primitive appears at
   * all, so the ADR's "nothing sends" line is enforced by the suite rather than
   * promised by a comment. Comments are stripped first: these files DISCUSS
   * `dispatch` and `fetch` by name at length, and a check that matched prose
   * would fail for the wrong reason — the mirror image of the bug
   * `check_route_exposure.py` shipped.
   */
  const files = [
    "meta-cloud.adapter.ts",
    "twilio.adapter.ts",
    "text-transport.registry.ts",
  ];

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it.each(files)("%s contains no HTTP primitive", (name) => {
    const src = stripComments(readFileSync(join(__dirname, name), "utf8"));
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/\baxios\b/);
    expect(src).not.toMatch(/require\(['"]https?['"]\)/);
    expect(src).not.toMatch(/from ['"]https?['"]/);
  });

  it("the stripper does not blank the whole file (never a vacuous pass)", () => {
    // A guard that passes because it read nothing is the shape this repo calls
    // absence-reported-as-health. This proves the stripped source still holds
    // the code the assertions above are about.
    for (const name of files) {
      const src = stripComments(readFileSync(join(__dirname, name), "utf8"));
      expect(src).toMatch(/export class/);
      expect(src.length).toBeGreaterThan(400);
    }
  });
});
