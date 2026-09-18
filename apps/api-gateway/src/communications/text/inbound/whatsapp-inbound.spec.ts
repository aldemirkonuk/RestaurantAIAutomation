/**
 * The inbound door: what it refuses, and what it writes (ADR 0121 P1).
 *
 * THIS SUITE IS THE REPLACEMENT ADR 0121 REQUIRES, NOT A DELETION
 * ---------------------------------------------------------------
 * `gateway-honesty.spec.ts:328` asserts that no inbound SMS handler exists. It
 * is untouched and still passes — this is WhatsApp, and no SMS inbound handler
 * exists. ADR 0121's consequences say that when an inbound handler does land,
 * that assertion is *replaced* by one requiring it to be guarded and
 * tenant-scoped rather than deleted. The last two describes here are that
 * second assertion, and they are structural (read off the source) rather than
 * behavioural, for the reason `text-transport.spec.ts` gives: a behavioural
 * test passes on a file that grew a second, unguarded route.
 */

import { createHmac } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import {
  Logger,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  DEFAULT_RATE_LIMITS,
  RATE_LIMIT_KEY,
  RateLimitGuard,
} from "../../../common/rate-limit/rate-limit.guard";
import {
  asDatabaseService,
  makeStubDb,
  type StubDb,
} from "../../../team/testing/supabase-stub";
import {
  META_SIGNATURE_HEADER,
  verifyMetaHandshake,
  verifyMetaSignature,
} from "./meta-webhook-signature";
import { parseWhatsAppWebhook } from "./meta-webhook-payload";
import { WhatsAppBookService } from "./whatsapp-book.service";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WhatsAppWebhookController } from "./whatsapp-webhook.controller";
import { TextConfigService } from "../text-config.service";

const SECRET = "app-secret-abc";
const VERIFY = "verify-token-xyz";
const RID = "restaurant-1";
const PID = "provider-1";
const PHONE_NUMBER_ID = "106540352242922";

/**
 * A payload transcribed from Meta's own documentation
 * (`developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples`,
 * fetched 2026-09-06) with the ids swapped for this suite's. NOT invented: a
 * fixture we made up would test our idea of the shape rather than Meta's.
 */
function textPayload(
  over: Partial<{ wamid: string; from: string; body: string }> = {},
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550783881",
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: "Sheena Nelson" },
                  wa_id: over.from ?? "16505551234",
                },
              ],
              messages: [
                {
                  from: over.from ?? "16505551234",
                  id: over.wamid ?? "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRB",
                  timestamp: "1749416383",
                  type: "text",
                  text: { body: over.body ?? "Does it come in another color?" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/**
 * A status callback in the shape of the same Meta payload-examples page: the
 * `statuses` array rides the `messages` field, with `errors` on a failure.
 */
function statusPayload(
  over: Partial<{
    wamid: string;
    status: string;
    phoneNumberId: string;
    errors: Record<string, unknown>[];
  }> = {},
) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550783881",
                phone_number_id: over.phoneNumberId ?? PHONE_NUMBER_ID,
              },
              statuses: [
                {
                  id: over.wamid ?? "wamid.OUT1",
                  status: over.status ?? "delivered",
                  timestamp: "1749416400",
                  recipient_id: "16505551234",
                  ...(over.errors ? { errors: over.errors } : {}),
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function stubConfig(env: Record<string, string>): TextConfigService {
  return new TextConfigService({
    get: (k: string) => env[k],
  } as never);
}

function seed(over: Partial<Record<string, unknown[]>> = {}): StubDb {
  return makeStubDb({
    house_text_sender_credentials: [
      {
        sender_id: "sender-1",
        restaurant_id: RID,
        provider: "meta_cloud",
        sender_ref: PHONE_NUMBER_ID,
        revoked_at: null,
      },
    ],
    house_text_senders: [
      {
        id: "sender-1",
        restaurant_id: RID,
        state: "connected",
        revoked_at: null,
      },
    ],
    providers: [
      {
        id: PID,
        restaurant_id: RID,
        name: "Sheena Wines",
        contact_phone: "+1 650 555 1234",
        primary_contact: null,
        deleted_at: null,
      },
    ],
    provider_contacts: [],
    procurement_conversations: [],
    ...(over as Record<string, unknown[]>),
  });
}

function inbound(db: StubDb): WhatsAppInboundService {
  const dbs = asDatabaseService(db);
  return new WhatsAppInboundService(dbs, new WhatsAppBookService(dbs));
}

// ───────────────────────────────────────────────────────────────────────────
describe("the signature is the only thing standing in for a token", () => {
  const body = JSON.stringify(textPayload());

  it("accepts a signature computed over the raw body with the app secret", () => {
    expect(
      verifyMetaSignature({
        rawBody: body,
        header: sign(body),
        appSecret: SECRET,
      }),
    ).toEqual({ ok: true });
  });

  it("REFUSES a wrong signature", () => {
    const wrong = sign(body, "not-the-secret");
    const r = verifyMetaSignature({
      rawBody: body,
      header: wrong,
      appSecret: SECRET,
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "no-matching-signature" });
  });

  it("REFUSES a valid signature computed over a DIFFERENT body", () => {
    // The case nobody writes a test for: the header is a real HMAC with the
    // real secret, just not of these bytes.
    const header = sign(
      JSON.stringify(textPayload({ body: "something else" })),
    );
    expect(
      verifyMetaSignature({ rawBody: body, header, appSecret: SECRET }).ok,
    ).toBe(false);
  });

  it("REFUSES when this deployment holds no app secret, with its own reason", () => {
    // Absence must not read as "nothing to check". A missing secret makes the
    // HMAC computable by anyone, so an accepting branch here would turn a
    // public URL into an unauthenticated write on every house's book.
    const r = verifyMetaSignature({
      rawBody: body,
      header: sign(body),
      appSecret: null,
    });
    expect(r).toMatchObject({ ok: false, reason: "no-secret" });
  });

  it("REFUSES a missing header, an empty body and a malformed header apart", () => {
    expect(
      verifyMetaSignature({ rawBody: body, header: null, appSecret: SECRET }),
    ).toMatchObject({ reason: "no-signature" });
    expect(
      verifyMetaSignature({
        rawBody: "",
        header: sign(body),
        appSecret: SECRET,
      }),
    ).toMatchObject({ reason: "no-body" });
    expect(
      verifyMetaSignature({
        rawBody: body,
        header: "sha1=abc",
        appSecret: SECRET,
      }),
    ).toMatchObject({ reason: "malformed-header" });
    expect(
      verifyMetaSignature({
        rawBody: body,
        header: "sha256=zz",
        appSecret: SECRET,
      }),
    ).toMatchObject({ reason: "malformed-header" });
  });

  it("a re-serialised body does NOT verify — the raw bytes are the thing signed", () => {
    // Key order differs, so `JSON.stringify(parsed)` is a different string.
    // This is why the controller reads `req.rawBody`, and this test is what
    // stops somebody "fixing" a failing verification by re-serialising.
    const reserialised = JSON.stringify({
      entry: [],
      object: "whatsapp_business_account",
    });
    expect(
      verifyMetaSignature({
        rawBody: reserialised,
        header: sign(body),
        appSecret: SECRET,
      }).ok,
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the POST route answers 401 on a wrong signature", () => {
  const payload = textPayload();
  const raw = Buffer.from(JSON.stringify(payload), "utf8");

  const controller = (db: StubDb, env: Record<string, string>) =>
    new WhatsAppWebhookController(stubConfig(env), inbound(db));

  const req = (header: string | undefined) =>
    ({
      rawBody: raw,
      headers: header ? { [META_SIGNATURE_HEADER]: header } : {},
    }) as never;

  it("throws Unauthorized for a signature that does not match", async () => {
    const c = controller(seed(), { WHATSAPP_APP_SECRET: SECRET });
    await expect(
      c.receive(req(sign(raw.toString("utf8"), "wrong-secret")), payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("throws Unauthorized when no secret is configured — never accepts", async () => {
    const c = controller(seed(), {});
    await expect(
      c.receive(req(sign(raw.toString("utf8"))), payload),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("stores NOTHING when the signature is refused", async () => {
    const db = seed();
    const c = controller(db, { WHATSAPP_APP_SECRET: SECRET });
    await expect(
      c.receive(req("sha256=" + "0".repeat(64)), payload),
    ).rejects.toThrow();
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it.each([
    "procurement_conversations:select",
    "procurement_conversations:insert",
  ])("returns a retryable failure when %s fails", async (operation) => {
    const db = seed();
    db.errors[operation] = { message: "temporary database failure" };
    await expect(
      controller(db, { WHATSAPP_APP_SECRET: SECRET }).receive(
        req(sign(raw.toString("utf8"))),
        payload,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("explicitly acknowledges accepted POSTs with 200, rather than Nest's default 201", () => {
    expect(
      Reflect.getMetadata(
        "__httpCode__",
        WhatsAppWebhookController.prototype.receive,
      ),
    ).toBe(200);
  });

  it("accepts and threads a correctly signed payload", async () => {
    const db = seed();
    const c = controller(db, { WHATSAPP_APP_SECRET: SECRET });
    const out = await c.receive(req(sign(raw.toString("utf8"))), payload);
    expect(out.received).toBe(1);
    expect(out.counts.threaded).toBe(1);
    expect(db.tables.procurement_conversations).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the GET handshake", () => {
  it("sends even an HTML-looking challenge as plain text", () => {
    const c = new WhatsAppWebhookController(
      stubConfig({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY }),
      inbound(seed()),
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    c.handshake(
      {
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY,
        "hub.challenge": "<img src=x onerror=alert(1)>",
      },
      response as never,
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.type).toHaveBeenCalledWith("text/plain");
    expect(response.send).toHaveBeenCalledWith("<img src=x onerror=alert(1)>");
  });

  it("sends handshake refusals as plain text", () => {
    const c = new WhatsAppWebhookController(
      stubConfig({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY }),
      inbound(seed()),
    );
    const response = {
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };
    c.handshake(
      {
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "<script>",
      },
      response as never,
    );
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.type).toHaveBeenCalledWith("text/plain");
    expect(response.send).not.toHaveBeenCalledWith("<script>");
  });

  it("echoes the challenge on a matching token", () => {
    expect(
      verifyMetaHandshake({
        mode: "subscribe",
        token: VERIFY,
        challenge: "1158201444",
        verifyToken: VERIFY,
      }),
    ).toEqual({ ok: true, challenge: "1158201444" });
  });

  it("refuses a wrong token, a wrong mode, and an unset verify token", () => {
    expect(
      verifyMetaHandshake({
        mode: "subscribe",
        token: "nope",
        challenge: "1",
        verifyToken: VERIFY,
      }),
    ).toMatchObject({ ok: false, reason: "wrong-token" });
    expect(
      verifyMetaHandshake({
        mode: "unsubscribe",
        token: VERIFY,
        challenge: "1",
        verifyToken: VERIFY,
      }),
    ).toMatchObject({ ok: false, reason: "wrong-mode" });
    // No token configured must NOT echo: echoing would let anybody subscribe an
    // arbitrary Meta app to this endpoint.
    expect(
      verifyMetaHandshake({
        mode: "subscribe",
        token: VERIFY,
        challenge: "1",
        verifyToken: null,
      }),
    ).toMatchObject({ ok: false, reason: "no-verify-token" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("reading the payload", () => {
  it.each(["not-a-time", "1e999", "999999999999999999999999"])(
    "reports an invalid timestamp without throwing: %s",
    (timestamp) => {
      const payload = textPayload();
      payload.entry[0].changes[0].value.messages[0].timestamp = timestamp;
      const parsed = parseWhatsAppWebhook(payload);
      expect(parsed.messages).toHaveLength(0);
      expect(parsed.skipped[0].why).toMatch(/invalid timestamp/);
    },
  );

  it("reads Meta's documented text-message shape", () => {
    const p = parseWhatsAppWebhook(textPayload());
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]).toMatchObject({
      phoneNumberId: PHONE_NUMBER_ID,
      fromWaId: "16505551234",
      type: "text",
      text: "Does it come in another color?",
      profileName: "Sheena Nelson",
    });
  });

  it("counts a delivery status as a status, never as a message", () => {
    const p = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                messaging_product: "whatsapp",
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                statuses: [{ id: "wamid.x", status: "delivered" }],
              },
            },
          ],
        },
      ],
    });
    expect(p.messages).toHaveLength(0);
    expect(p.statusCount).toBe(1);
    // And it is NOT reported as unreadable: a status callback is a thing we
    // understand and chose not to thread.
    expect(p.skipped).toHaveLength(0);
    // It is READ, though — into its own list, for the house's outbound row.
    expect(p.statuses).toEqual([
      {
        phoneNumberId: PHONE_NUMBER_ID,
        wamid: "wamid.x",
        status: "delivered",
        timestamp: null,
        recipientId: null,
        errorCode: null,
        errorTitle: null,
      },
    ]);
  });

  it("reads a failed status with Meta's error, and refuses one with no phone_number_id", () => {
    const p = parseWhatsAppWebhook(
      statusPayload({
        status: "failed",
        errors: [{ code: 131047, title: "Re-engagement message" }],
      }),
    );
    expect(p.statuses[0]).toMatchObject({
      wamid: "wamid.OUT1",
      status: "failed",
      timestamp: "1749416400",
      recipientId: "16505551234",
      errorCode: "131047",
      errorTitle: "Re-engagement message",
    });

    const orphan = statusPayload({ status: "read" });
    delete (orphan.entry[0].changes[0].value as { metadata?: unknown }).metadata;
    const q = parseWhatsAppWebhook(orphan);
    expect(q.statuses).toHaveLength(0);
    expect(q.statusCount).toBe(1);
    expect(q.skipped[0].why).toMatch(/which house's message they describe is unknown/);
  });

  it("reports what it could not read rather than dropping it", () => {
    const p = parseWhatsAppWebhook({ object: "page", entry: [] });
    expect(p.messages).toHaveLength(0);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0].why).toMatch(/not "whatsapp_business_account"/);
  });

  it("refuses a change with messages but no phone_number_id", () => {
    const p = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  {
                    from: "1",
                    id: "wamid.a",
                    type: "text",
                    text: { body: "hi" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(p.messages).toHaveLength(0);
    expect(p.skipped[0].why).toMatch(
      /which house's sender received them is unknown/,
    );
  });

  it("gives a non-text message a null body rather than inventing one", () => {
    const p = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1",
          changes: [
            {
              field: "messages",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                messages: [
                  {
                    from: "1",
                    id: "wamid.b",
                    type: "image",
                    image: { id: "9" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(p.messages[0].text).toBeNull();
    expect(p.messages[0].type).toBe("image");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("threading onto the house's own book", () => {
  it("writes an inbound row in the mail path's provenance shape", async () => {
    const db = seed();
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("threaded");

    const row = db.tables.procurement_conversations[0];
    expect(row).toMatchObject({
      restaurant_id: RID,
      provider_id: PID,
      direction: "inbound",
      channel: "whatsapp",
      message_text: "Does it come in another color?",
      ai_generated: false,
      delivery_status: "delivered",
      message_id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRB",
    });
    // The transport envelope, in the same column the mail path writes it to.
    expect(row.email_headers).toMatchObject({
      transport: "whatsapp_cloud_api",
      phone_number_id: PHONE_NUMBER_ID,
      from_wa_id: "16505551234",
    });
    // NEVER guessed onto an order. The mail path's fallback keys on a Gmail
    // thread; a WhatsApp thread has no order in it.
    expect(row.order_id).toBeNull();
  });

  it("the tenant comes from OUR credential row, never from the payload", async () => {
    // The payload names WABA `102290129340398`; the credential row is what says
    // the restaurant is `restaurant-1`. Changing the payload's WABA must not
    // move the row to another house.
    const db = seed();
    const msg = parseWhatsAppWebhook(textPayload()).messages[0];
    msg.wabaId = "999-someone-elses-waba";
    const r = await inbound(db).thread(msg);
    expect(r.disposition).toBe("threaded");
    expect(db.tables.procurement_conversations[0].restaurant_id).toBe(RID);
  });

  it("refuses a number no house holds a credential for", async () => {
    const db = seed({ house_text_sender_credentials: [] });
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("no_sender_for_number");
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("refuses a number two HOUSES hold live credentials for — never picks one", async () => {
    // No unique index covers (provider, sender_ref), so this state is writable.
    // Threading by row order would put one house's vendor message in another
    // house's book.
    const db = seed();
    db.tables.house_text_sender_credentials.push({
      sender_id: "sender-2",
      restaurant_id: "restaurant-2",
      provider: "meta_cloud",
      sender_ref: PHONE_NUMBER_ID,
      revoked_at: null,
    });
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("sender_ambiguous");
    expect(r.restaurantId).toBeUndefined();
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("refuses duplicate credentials even when the first two rows belong to one house", async () => {
    const db = seed();
    db.tables.house_text_sender_credentials.push(
      { ...db.tables.house_text_sender_credentials[0], sender_id: "sender-2" },
      {
        ...db.tables.house_text_sender_credentials[0],
        sender_id: "sender-3",
        restaurant_id: "other-house",
      },
    );
    expect(
      (
        await inbound(db).thread(
          parseWhatsAppWebhook(textPayload()).messages[0],
        )
      ).disposition,
    ).toBe("sender_ambiguous");
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("refuses a revoked sender even when its credential has not been revoked", async () => {
    const db = seed();
    db.tables.house_text_senders[0].state = "revoked";
    expect(
      (
        await inbound(db).thread(
          parseWhatsAppWebhook(textPayload()).messages[0],
        )
      ).disposition,
    ).toBe("no_sender_for_number");
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("does not treat another house's message id as this house's receipt", async () => {
    const db = seed();
    const msg = parseWhatsAppWebhook(textPayload()).messages[0];
    db.tables.procurement_conversations.push({
      id: "other",
      restaurant_id: "other-house",
      channel: "whatsapp",
      direction: "inbound",
      message_id: msg.wamid,
    });
    expect((await inbound(db).thread(msg)).disposition).toBe("threaded");
    expect(db.tables.procurement_conversations).toHaveLength(2);
  });

  it("recognizes a concurrent delivery only after reading this house's durable receipt", async () => {
    const db = seed();
    db.errors["procurement_conversations:insert"] = Object.assign(
      { message: "duplicate key" },
      { code: "23505" },
    );
    const service = inbound(db);
    const lookup = jest
      .spyOn(service as any, "alreadyStored")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const msg = parseWhatsAppWebhook(textPayload()).messages[0];
    expect((await service.thread(msg)).disposition).toBe("already_stored");
    expect(lookup).toHaveBeenNthCalledWith(2, RID, msg.wamid);
  });

  it("does not acknowledge an unrelated unique conflict without a durable receipt", async () => {
    const db = seed();
    db.errors["procurement_conversations:insert"] = Object.assign(
      { message: "duplicate key" },
      { code: "23505" },
    );
    expect(
      (
        await inbound(db).thread(
          parseWhatsAppWebhook(textPayload()).messages[0],
        )
      ).disposition,
    ).toBe("write_failed");
  });

  it("refuses a revoked credential — a revoked sender is not a live one", async () => {
    const db = seed();
    db.tables.house_text_sender_credentials[0].revoked_at =
      "2026-09-01T00:00:00Z";
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("no_sender_for_number");
  });

  it("refuses a number that is not in that house's book, and creates no vendor", async () => {
    const db = seed();
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload({ from: "905321112233" })).messages[0],
    );
    expect(r.disposition).toBe("not_in_book");
    expect(db.tables.procurement_conversations).toHaveLength(0);
    expect(db.tables.providers).toHaveLength(1);
    expect(r.says).toMatch(/no vendor was created/i);
  });

  it("is idempotent on the wamid — Meta retries what it did not get a 200 for", async () => {
    const db = seed();
    const msg = parseWhatsAppWebhook(textPayload()).messages[0];
    const svc = inbound(db);
    expect((await svc.thread(msg)).disposition).toBe("threaded");
    expect((await svc.thread(msg)).disposition).toBe("already_stored");
    expect(db.tables.procurement_conversations).toHaveLength(1);
  });

  it("a failed dedup read does NOT write — it says it could not tell", async () => {
    const db = seed();
    db.errors["procurement_conversations:select"] = { message: "timeout" };
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("book_unreadable");
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("a failed INSERT is reported, not swallowed", async () => {
    const db = seed();
    db.errors["procurement_conversations:insert"] = { message: "constraint" };
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("write_failed");
    expect(r.says).toMatch(/NOT confirmed/);
  });

  it("refuses a number two vendors in the house hold EXACTLY, and stores nothing", async () => {
    // The exact branch used to return the first match, so this resolved to
    // whichever vendor the read returned first (measured 2026-09-17).
    const db = seed();
    db.tables.providers.push({
      id: "provider-2",
      restaurant_id: RID,
      name: "Another Wines",
      contact_phone: "+16505551234",
      primary_contact: null,
      deleted_at: null,
    });
    const r = await inbound(db).thread(
      parseWhatsAppWebhook(textPayload()).messages[0],
    );
    expect(r.disposition).toBe("book_ambiguous");
    expect(r.says).toMatch(/more than one vendor/);
    // NOT "not in the book": the number is in it, twice.
    expect(r.says).not.toMatch(/not in this house's vendor book/);
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("logs the reason when the sender row cannot be read, and stores nothing", async () => {
    const db = seed();
    db.errors["house_text_senders:select"] = { message: "sender read timeout" };
    const error = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    try {
      const r = await inbound(db).thread(
        parseWhatsAppWebhook(textPayload()).messages[0],
      );
      expect(r.disposition).toBe("book_unreadable");
      expect(
        error.mock.calls.some((c) => String(c[0]).includes("sender read timeout")),
      ).toBe(true);
    } finally {
      error.mockRestore();
    }
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("a delivery status reaches the house's own outbound row", () => {
  const OTHER = "restaurant-2";

  function outbound(over: Record<string, unknown> = {}) {
    return {
      id: "out-1",
      restaurant_id: RID,
      provider_id: PID,
      direction: "outbound",
      channel: "whatsapp",
      message_id: "wamid.OUT1",
      delivery_status: "accepted_by_provider",
      email_headers: { transport: "whatsapp_cloud_api", sent_by: "user-sam" },
      ...over,
    };
  }

  const apply = (db: StubDb, over: Parameters<typeof statusPayload>[0]) =>
    inbound(db).applyStatus(parseWhatsAppWebhook(statusPayload(over)).statuses[0]);

  it("writes an asynchronous FAILURE onto the row, with Meta's code, keeping the envelope", async () => {
    const db = seed({ procurement_conversations: [outbound()] });
    const r = await apply(db, {
      status: "failed",
      errors: [{ code: 131047, title: "Re-engagement message" }],
    });
    expect(r.disposition).toBe("applied");
    expect(r.says).toMatch(/FAILED after accepting it \(code 131047/);
    const row = db.tables.procurement_conversations[0];
    expect(row.delivery_status).toBe("failed");
    expect(row.email_headers).toMatchObject({
      transport: "whatsapp_cloud_api",
      sent_by: "user-sam",
      provider_status: "failed",
      provider_error_code: "131047",
      provider_error_title: "Re-engagement message",
      provider_status_at: new Date(1749416400 * 1000).toISOString(),
    });
  });

  it("moves forward only: read after delivered lands, delivered after read does not", async () => {
    const db = seed({ procurement_conversations: [outbound()] });
    expect((await apply(db, { status: "delivered" })).disposition).toBe("applied");
    expect((await apply(db, { status: "read" })).disposition).toBe("applied");
    const late = await apply(db, { status: "delivered" });
    expect(late.disposition).toBe("not_newer");
    expect(db.tables.procurement_conversations[0].delivery_status).toBe("read");
  });

  it("never lets a failure unsay a delivery", async () => {
    const db = seed({
      procurement_conversations: [outbound({ delivery_status: "delivered" })],
    });
    const r = await apply(db, { status: "failed" });
    expect(r.disposition).toBe("not_newer");
    expect(db.tables.procurement_conversations[0].delivery_status).toBe("delivered");
  });

  it("the forward-only rule is in the UPDATE itself, not only in the read before it", async () => {
    const db = seed({ procurement_conversations: [outbound()] });
    await apply(db, { status: "read" });
    const update = db.opsOn("procurement_conversations", "update")[0];
    expect(update.filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "restaurant_id", value: RID },
        {
          kind: "in",
          column: "delivery_status",
          value: ["accepted_by_provider", "sent", "delivered"],
        },
      ]),
    );
  });

  it("never touches another house's row that carries the same wamid", async () => {
    const theirs = outbound({ id: "out-theirs", restaurant_id: OTHER });
    const db = seed({ procurement_conversations: [theirs] });
    const r = await apply(db, { status: "failed" });
    expect(r.disposition).toBe("no_matching_message");
    expect(db.tables.procurement_conversations[0].delivery_status).toBe(
      "accepted_by_provider",
    );
  });

  it("does not apply a status word this build does not know", async () => {
    const db = seed({ procurement_conversations: [outbound()] });
    const r = await apply(db, { status: "deleted" });
    expect(r.disposition).toBe("status_not_applied");
    expect(db.opsOn("procurement_conversations", "update")).toHaveLength(0);
  });

  it("refuses a status for a number no house holds, and a number two houses hold", async () => {
    const db = seed({ procurement_conversations: [outbound()] });
    expect(
      (await apply(db, { status: "read", phoneNumberId: "999" })).disposition,
    ).toBe("no_sender_for_number");

    db.tables.house_text_sender_credentials.push({
      sender_id: "sender-2",
      restaurant_id: OTHER,
      provider: "meta_cloud",
      sender_ref: PHONE_NUMBER_ID,
      revoked_at: null,
    });
    expect((await apply(db, { status: "read" })).disposition).toBe(
      "sender_ambiguous",
    );
    expect(db.tables.procurement_conversations[0].delivery_status).toBe(
      "accepted_by_provider",
    );
  });

  const controller = (db: StubDb) =>
    new WhatsAppWebhookController(
      stubConfig({ WHATSAPP_APP_SECRET: SECRET }),
      inbound(db),
    );
  const signed = (payload: unknown) => {
    const raw = Buffer.from(JSON.stringify(payload), "utf8");
    return {
      rawBody: raw,
      headers: { [META_SIGNATURE_HEADER]: sign(raw.toString("utf8")) },
    } as never;
  };

  it("the signed POST applies it and says so in the response", async () => {
    const db = seed({ procurement_conversations: [outbound()] });
    const payload = statusPayload({ status: "read" });
    const out = await controller(db).receive(signed(payload), payload);
    expect(out.statusCallbacks).toBe(1);
    expect(out.statusCounts).toEqual({ applied: 1 });
    expect(out.statuses[0]).toMatchObject({ wamid: "wamid.OUT1", status: "read" });
    expect(db.tables.procurement_conversations[0].delivery_status).toBe("read");
  });

  it.each([
    "procurement_conversations:select",
    "procurement_conversations:update",
  ])("answers 503 so Meta retries when %s fails", async (operation) => {
    const db = seed({ procurement_conversations: [outbound()] });
    db.errors[operation] = { message: "temporary database failure" };
    const payload = statusPayload({ status: "failed" });
    await expect(
      controller(db).receive(signed(payload), payload),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the door's configuration and its rate limit", () => {
  it("says at boot, once, that an unconfigured deployment refuses every request", () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    try {
      const config = stubConfig({});
      config.onModuleInit();
      config.onModuleInit();
      const lines = warn.mock.calls.filter((c) =>
        String(c[0]).includes("WhatsApp inbound is REFUSING every request"),
      );
      expect(lines).toHaveLength(1);
      expect(String(lines[0][0])).toMatch(/WHATSAPP_APP_SECRET/);
      expect(String(lines[0][0])).toMatch(/WHATSAPP_WEBHOOK_VERIFY_TOKEN/);
    } finally {
      warn.mockRestore();
    }
  });

  it("says nothing at boot when both are set", () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    try {
      stubConfig({
        WHATSAPP_APP_SECRET: SECRET,
        WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY,
      }).onModuleInit();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("the POST states the webhook rate-limit profile on the route itself", () => {
    expect(
      Reflect.getMetadata(
        RATE_LIMIT_KEY,
        WhatsAppWebhookController.prototype.receive,
      ),
    ).toEqual(DEFAULT_RATE_LIMITS.webhook);
  });

  it("the global guard answers that profile's limit for the POST", async () => {
    const guard = new RateLimitGuard(new Reflector(), {} as never);
    const headers: Record<string, unknown> = {};
    try {
      const allowed = await guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            route: { path: "/api/communications/webhooks/whatsapp" },
            url: "/api/communications/webhooks/whatsapp",
            headers: {},
            ip: "203.0.113.7",
          }),
          getResponse: () => ({
            setHeader: (k: string, v: unknown) => {
              headers[k] = v;
            },
          }),
        }),
        getHandler: () => WhatsAppWebhookController.prototype.receive,
        getClass: () => WhatsAppWebhookController,
      } as never);
      expect(allowed).toBe(true);
      expect(headers["X-RateLimit-Limit"]).toBe(1000);
    } finally {
      clearInterval(
        (guard as unknown as { cleanupInterval: NodeJS.Timeout }).cleanupInterval,
      );
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the phone book tells a mobile from a landline", () => {
  const book = (db: StubDb) => new WhatsAppBookService(asDatabaseService(db));

  it("reports each number's reach, and a failed read is NOT an empty book", async () => {
    const db = seed({
      provider_contacts: [
        {
          id: "c1",
          provider_id: PID,
          name: "Sheena",
          phone: "+16505550001",
          phone_type: "cell",
        },
        {
          id: "c2",
          provider_id: PID,
          name: "Desk",
          phone: "+16505550002",
          phone_type: "main_line",
        },
        {
          id: "c3",
          provider_id: PID,
          name: "Fax",
          phone: "+16505550003",
          phone_type: "fax",
        },
        {
          id: "c4",
          provider_id: PID,
          name: "Unknown",
          phone: "+16505550004",
          phone_type: null,
        },
      ],
    });
    const out = await book(db).phoneBook(RID);
    expect(out.readable).toBe(true);

    const by = (p: string) => out.entries.find((e) => e.phone === p)!;
    expect(by("+16505550001")).toMatchObject({
      reach: "mobile",
      phoneTypeStated: true,
    });
    // The column's default: a landline for what we DO, unstated for what we KNOW.
    expect(by("+16505550002")).toMatchObject({
      reach: "landline",
      phoneTypeStated: false,
    });
    expect(by("+16505550003")).toMatchObject({
      reach: "landline",
      phoneTypeStated: true,
    });
    expect(by("+16505550004")).toMatchObject({
      reach: "unstated",
      phoneTypeStated: false,
    });

    // The number on the `providers` row has no phone_type column at all, so it
    // is UNSTATED rather than inheriting the contacts column's default.
    const vendorRow = out.entries.find((e) => e.source === "provider")!;
    expect(vendorRow.reach).toBe("unstated");
  });

  it("a failed contacts read reports readable: false, never an empty book", async () => {
    const db = seed({
      provider_contacts: [
        {
          id: "c1",
          provider_id: PID,
          name: "Sheena",
          phone: "+16505550001",
          phone_type: "cell",
        },
      ],
    });
    db.errors["provider_contacts:select"] = { message: "timeout" };
    const out = await book(db).phoneBook(RID);
    expect(out.readable).toBe(false);
    expect(out.reason).toMatch(/contact list could not be read/);
    // `reason` reaches a client through GET phone-book; the database's own
    // text is logged instead.
    expect(out.reason).not.toMatch(/timeout/);
  });

  it("refuses to guess when two vendors match one arriving number", async () => {
    const db = seed({
      providers: [
        {
          id: PID,
          restaurant_id: RID,
          name: "A",
          contact_phone: "+16505551234",
          primary_contact: null,
          deleted_at: null,
        },
        {
          id: "provider-2",
          restaurant_id: RID,
          name: "B",
          contact_phone: "16505551234",
          primary_contact: null,
          deleted_at: null,
        },
      ],
    });
    // Both hold the same digits, so an exact match resolves it; make them
    // differ only by a prefix so the SUFFIX rule sees two candidates.
    db.tables.providers[1].contact_phone = "+9016505551234";
    const entry = await book(db).providerForWaId(RID, "16505551234");
    // One exact match wins over the ambiguous suffix — asserted so the rule is
    // "exact first", not "give up on any collision".
    expect(entry).not.toBe("ambiguous");
    expect((entry as { providerId: string }).providerId).toBe(PID);
  });

  it("refuses an EXACT number two vendors hold, rather than picking the first", async () => {
    const db = seed({
      providers: [
        {
          id: "pA",
          restaurant_id: RID,
          name: "A",
          contact_phone: "+905321112233",
          primary_contact: null,
          deleted_at: null,
        },
        {
          id: "pB",
          restaurant_id: RID,
          name: "B",
          contact_phone: "+90 532 111 22 33",
          primary_contact: null,
          deleted_at: null,
        },
      ],
    });
    expect(await book(db).providerForWaId(RID, "905321112233")).toBe("ambiguous");
  });

  it("one vendor holding the same line in two formats is still one vendor", async () => {
    const db = seed({
      providers: [
        {
          id: "pA",
          restaurant_id: RID,
          name: "A",
          contact_phone: "0532 111 22 33",
          primary_contact: { name: "Rep", phone: "532 111 22 33" },
          deleted_at: null,
        },
      ],
    });
    // Two SUFFIX matches, one vendor: resolved, not refused.
    const entry = await book(db).providerForWaId(RID, "905321112233");
    expect(entry).not.toBe("ambiguous");
    expect((entry as { providerId: string }).providerId).toBe("pA");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the route says what it is, structurally", () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const src = stripComments(
    readFileSync(join(__dirname, "whatsapp-webhook.controller.ts"), "utf8"),
  );

  it("the stripper did not blank the file (never a vacuous pass)", () => {
    expect(src).toMatch(/export class/);
    expect(src.length).toBeGreaterThan(400);
  });

  it("every route on it declares @Public() — ADR 0096", () => {
    const routes = src.match(/@(Get|Post|Put|Patch|Delete|All)\s*\(/g) ?? [];
    const publics = src.match(/@Public\(\)/g) ?? [];
    expect(routes.length).toBeGreaterThan(0);
    expect(publics.length).toBe(routes.length);
  });

  it("the POST verifies a signature over req.rawBody before anything else", () => {
    expect(src).toMatch(/verifyMetaSignature/);
    expect(src).toMatch(/rawBody/);
    // A re-serialised body would be the wrong bytes; asserting the absence
    // stops the "fix" that makes verification pass by making it meaningless.
    expect(src).not.toMatch(/JSON\.stringify\(\s*body\s*\)/);
  });

  it("the tenant is never taken off the payload in the handler", () => {
    // `restaurant_id` appears nowhere in the controller: it comes from
    // `WhatsAppInboundService.senderFor`, which reads our own credential row.
    expect(src).not.toMatch(/restaurant_?[iI]d/);
  });
});
