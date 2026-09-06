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
import { UnauthorizedException } from "@nestjs/common";
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
function textPayload(over: Partial<{ wamid: string; from: string; body: string }> = {}) {
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
                { profile: { name: "Sheena Nelson" }, wa_id: over.from ?? "16505551234" },
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
      verifyMetaSignature({ rawBody: body, header: sign(body), appSecret: SECRET }),
    ).toEqual({ ok: true });
  });

  it("REFUSES a wrong signature", () => {
    const wrong = sign(body, "not-the-secret");
    const r = verifyMetaSignature({ rawBody: body, header: wrong, appSecret: SECRET });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "no-matching-signature" });
  });

  it("REFUSES a valid signature computed over a DIFFERENT body", () => {
    // The case nobody writes a test for: the header is a real HMAC with the
    // real secret, just not of these bytes.
    const header = sign(JSON.stringify(textPayload({ body: "something else" })));
    expect(
      verifyMetaSignature({ rawBody: body, header, appSecret: SECRET }).ok,
    ).toBe(false);
  });

  it("REFUSES when this deployment holds no app secret, with its own reason", () => {
    // Absence must not read as "nothing to check". A missing secret makes the
    // HMAC computable by anyone, so an accepting branch here would turn a
    // public URL into an unauthenticated write on every house's book.
    const r = verifyMetaSignature({ rawBody: body, header: sign(body), appSecret: null });
    expect(r).toMatchObject({ ok: false, reason: "no-secret" });
  });

  it("REFUSES a missing header, an empty body and a malformed header apart", () => {
    expect(
      verifyMetaSignature({ rawBody: body, header: null, appSecret: SECRET }),
    ).toMatchObject({ reason: "no-signature" });
    expect(
      verifyMetaSignature({ rawBody: "", header: sign(body), appSecret: SECRET }),
    ).toMatchObject({ reason: "no-body" });
    expect(
      verifyMetaSignature({ rawBody: body, header: "sha1=abc", appSecret: SECRET }),
    ).toMatchObject({ reason: "malformed-header" });
    expect(
      verifyMetaSignature({ rawBody: body, header: "sha256=zz", appSecret: SECRET }),
    ).toMatchObject({ reason: "malformed-header" });
  });

  it("a re-serialised body does NOT verify — the raw bytes are the thing signed", () => {
    // Key order differs, so `JSON.stringify(parsed)` is a different string.
    // This is why the controller reads `req.rawBody`, and this test is what
    // stops somebody "fixing" a failing verification by re-serialising.
    const reserialised = JSON.stringify({ entry: [], object: "whatsapp_business_account" });
    expect(
      verifyMetaSignature({ rawBody: reserialised, header: sign(body), appSecret: SECRET }).ok,
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
    ({ rawBody: raw, headers: header ? { [META_SIGNATURE_HEADER]: header } : {} }) as never;

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
    await expect(c.receive(req("sha256=" + "0".repeat(64)), payload)).rejects.toThrow();
    expect(db.tables.procurement_conversations).toHaveLength(0);
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
      verifyMetaHandshake({ mode: "subscribe", token: "nope", challenge: "1", verifyToken: VERIFY }),
    ).toMatchObject({ ok: false, reason: "wrong-token" });
    expect(
      verifyMetaHandshake({ mode: "unsubscribe", token: VERIFY, challenge: "1", verifyToken: VERIFY }),
    ).toMatchObject({ ok: false, reason: "wrong-mode" });
    // No token configured must NOT echo: echoing would let anybody subscribe an
    // arbitrary Meta app to this endpoint.
    expect(
      verifyMetaHandshake({ mode: "subscribe", token: VERIFY, challenge: "1", verifyToken: null }),
    ).toMatchObject({ ok: false, reason: "no-verify-token" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("reading the payload", () => {
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
              value: { messages: [{ from: "1", id: "wamid.a", type: "text", text: { body: "hi" } }] },
            },
          ],
        },
      ],
    });
    expect(p.messages).toHaveLength(0);
    expect(p.skipped[0].why).toMatch(/which house's sender received them is unknown/);
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
                messages: [{ from: "1", id: "wamid.b", type: "image", image: { id: "9" } }],
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
    const r = await inbound(db).thread(parseWhatsAppWebhook(textPayload()).messages[0]);
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
    const r = await inbound(db).thread(parseWhatsAppWebhook(textPayload()).messages[0]);
    expect(r.disposition).toBe("no_sender_for_number");
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("refuses a revoked credential — a revoked sender is not a live one", async () => {
    const db = seed();
    db.tables.house_text_sender_credentials[0].revoked_at = "2026-09-01T00:00:00Z";
    const r = await inbound(db).thread(parseWhatsAppWebhook(textPayload()).messages[0]);
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
    const r = await inbound(db).thread(parseWhatsAppWebhook(textPayload()).messages[0]);
    expect(r.disposition).toBe("book_unreadable");
    expect(db.tables.procurement_conversations).toHaveLength(0);
  });

  it("a failed INSERT is reported, not swallowed", async () => {
    const db = seed();
    db.errors["procurement_conversations:insert"] = { message: "constraint" };
    const r = await inbound(db).thread(parseWhatsAppWebhook(textPayload()).messages[0]);
    expect(r.disposition).toBe("write_failed");
    expect(r.says).toMatch(/NOT recorded/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the phone book tells a mobile from a landline", () => {
  const book = (db: StubDb) => new WhatsAppBookService(asDatabaseService(db));

  it("reports each number's reach, and a failed read is NOT an empty book", async () => {
    const db = seed({
      provider_contacts: [
        { id: "c1", provider_id: PID, name: "Sheena", phone: "+16505550001", phone_type: "cell" },
        { id: "c2", provider_id: PID, name: "Desk", phone: "+16505550002", phone_type: "main_line" },
        { id: "c3", provider_id: PID, name: "Fax", phone: "+16505550003", phone_type: "fax" },
        { id: "c4", provider_id: PID, name: "Unknown", phone: "+16505550004", phone_type: null },
      ],
    });
    const out = await book(db).phoneBook(RID);
    expect(out.readable).toBe(true);

    const by = (p: string) => out.entries.find((e) => e.phone === p)!;
    expect(by("+16505550001")).toMatchObject({ reach: "mobile", phoneTypeStated: true });
    // The column's default: a landline for what we DO, unstated for what we KNOW.
    expect(by("+16505550002")).toMatchObject({ reach: "landline", phoneTypeStated: false });
    expect(by("+16505550003")).toMatchObject({ reach: "landline", phoneTypeStated: true });
    expect(by("+16505550004")).toMatchObject({ reach: "unstated", phoneTypeStated: false });

    // The number on the `providers` row has no phone_type column at all, so it
    // is UNSTATED rather than inheriting the contacts column's default.
    const vendorRow = out.entries.find((e) => e.source === "provider")!;
    expect(vendorRow.reach).toBe("unstated");
  });

  it("a failed contacts read reports readable: false, never an empty book", async () => {
    const db = seed({
      provider_contacts: [
        { id: "c1", provider_id: PID, name: "Sheena", phone: "+16505550001", phone_type: "cell" },
      ],
    });
    db.errors["provider_contacts:select"] = { message: "timeout" };
    const out = await book(db).phoneBook(RID);
    expect(out.readable).toBe(false);
    expect(out.reason).toMatch(/contact list could not be read/);
  });

  it("refuses to guess when two vendors match one arriving number", async () => {
    const db = seed({
      providers: [
        { id: PID, restaurant_id: RID, name: "A", contact_phone: "+16505551234", primary_contact: null, deleted_at: null },
        { id: "provider-2", restaurant_id: RID, name: "B", contact_phone: "16505551234", primary_contact: null, deleted_at: null },
      ],
    });
    // Both hold the same digits, so an exact match resolves it; make them
    // differ only by a prefix so the SUFFIX rule sees two candidates.
    db.tables.providers[1].contact_phone = "+9016505551234";
    const entry = await book(db).providerForWaId(RID, "16505551234");
    // One exact match wins over the ambiguous suffix — asserted so the rule is
    // "exact first", not "give up on any collision".
    expect(entry?.providerId).toBe(PID);
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
