/**
 * The dispatch edge, finished honestly (ADR 0121 P1).
 *
 * WHAT THIS SUITE HAS TO PROVE, IN THE ADR'S OWN WORDS
 * ----------------------------------------------------
 *   *"outbound is FREE-FORM INSIDE AN OPEN 24-HOUR CUSTOMER-SERVICE WINDOW
 *   ONLY — no templates, no house-initiated conversations, no Meta charge …
 *   a send outside the window is refused with the reason, not queued."*
 *
 * So the two load-bearing cases are the two below: a closed window returns a
 * refusal whose words say nothing was queued, and an open one produces exactly
 * one message and exactly one meter row. Everything else exists so those two
 * cannot pass for the wrong reason.
 *
 * NOTHING HERE TOUCHES A NETWORK. `TextDispatchService` is constructed with a
 * stub `fetch`, and the last describe asserts that this file's stub is the only
 * way an HTTP call can happen in the whole `text/` tree.
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  asDatabaseService,
  makeStubDb,
  type StubDb,
} from "../../team/testing/supabase-stub";
import { TextSenderService } from "./text-sender.service";
import { TextUsageService } from "./text-usage.service";
import { TextDispatchService, type FetchLike } from "./providers/text-dispatch.service";
import { TextCredentialsService } from "./providers/text-credentials.service";
import { TextTransportRegistry } from "./providers/text-transport.registry";
import { TokenCryptoService } from "../../common/crypto/token-crypto.service";
import { WhatsAppBookService } from "./inbound/whatsapp-book.service";
import { WhatsAppSendService } from "./whatsapp-send.service";
import { ConfigService } from "@nestjs/config";

const RID = "restaurant-1";
const PID = "provider-1";
const SENDER = "sender-1";
const SAM = "user-sam";
const WA_ID = "16505551234";

/** Meta's own success envelope, from the Cloud API send-message docs. */
const META_ACCEPTED = {
  messaging_product: "whatsapp",
  contacts: [{ input: WA_ID, wa_id: WA_ID }],
  messages: [{ id: "wamid.OUT1" }],
};

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-06T12:00:00.000Z");

function inboundRow(agoMs: number) {
  return {
    id: "conv-in",
    restaurant_id: RID,
    provider_id: PID,
    direction: "inbound",
    channel: "whatsapp",
    message_text: "Can you take 6 cases Thursday?",
    created_at: new Date(NOW - agoMs).toISOString(),
    received_at: new Date(NOW - agoMs).toISOString(),
    email_headers: { transport: "whatsapp_cloud_api", from_wa_id: WA_ID },
  };
}

/**
 * A house that is fully wired: a connected WhatsApp sender, a house-owned
 * credential, a vendor in the book. This is NOT the state of any house on the
 * deployment today — it is the state the dispatch has to behave correctly in
 * the first time one reaches it.
 */
function seed(over: Partial<Record<string, unknown[]>> = {}, errors = {}): StubDb {
  const crypto = new TokenCryptoService({
    get: (k: string) => (k === "INTEGRATION_TOKEN_ENCRYPTION_KEY" ? KEY : undefined),
  } as unknown as ConfigService);
  return makeStubDb(
    {
      house_text_senders: [
        {
          id: SENDER,
          restaurant_id: RID,
          channel: "whatsapp",
          path: "bring_your_own",
          state: "connected",
          market: "TR",
          identity: "+905321112233",
          identity_kind: "e164",
          revoked_at: null,
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
      house_text_sender_credentials: [
        {
          id: "cred-1",
          sender_id: SENDER,
          restaurant_id: RID,
          provider: "meta_cloud",
          owner: "house",
          account_ref: "waba-1",
          sender_ref: "106540352242922",
          service_ref: null,
          access_token_encrypted: crypto.encrypt("house-token"),
          token_expires_at: null,
          api_version: null,
          revoked_at: null,
        },
      ],
      providers: [
        {
          id: PID,
          restaurant_id: RID,
          name: "Sheena Wines",
          contact_phone: `+${WA_ID}`,
          primary_contact: null,
          deleted_at: null,
        },
      ],
      provider_contacts: [],
      procurement_conversations: [inboundRow(2 * HOUR)],
      restaurants: [
        { id: RID, subscription_tier: "pilot", timezone: "Europe/Istanbul", currency: null },
      ],
      house_message_meter: [],
      house_message_credits: [],
      plan_message_allowances: [],
      house_message_allowances: [],
      person_text_consents: [],
      ...(over as Record<string, unknown[]>),
    },
    errors,
  );
}

/** A 32-byte hex key, so `TokenCryptoService` is live rather than disabled. */
const KEY = "a".repeat(64);

function build(db: StubDb, fetchImpl: FetchLike) {
  const dbs = asDatabaseService(db);
  const config = {
    get: (k: string) => (k === "INTEGRATION_TOKEN_ENCRYPTION_KEY" ? KEY : undefined),
  } as unknown as ConfigService;
  const credentials = new TextCredentialsService(dbs, new TokenCryptoService(config), config);
  return new WhatsAppSendService(
    dbs,
    new TextSenderService(dbs, new TextTransportRegistry(credentials), new TextUsageService(dbs)),
    new WhatsAppBookService(dbs),
    new TextTransportRegistry(credentials),
    new TextUsageService(dbs),
    new TextDispatchService(fetchImpl),
  );
}

function okFetch(calls: { url: string; body: string; headers: Record<string, string> }[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    return { status: 200, text: async () => JSON.stringify(META_ACCEPTED) };
  };
}

/** A fetch that fails the test if it is ever called. */
const neverFetch: FetchLike = async () => {
  throw new Error("the send path reached the network when it should have refused");
};

// ───────────────────────────────────────────────────────────────────────────
describe("a send OUTSIDE the 24-hour window is refused, and nothing is queued", () => {
  it("refuses when the vendor last wrote 25 hours ago", async () => {
    const db = seed({ procurement_conversations: [inboundRow(25 * HOUR)] });
    const out = await build(db, neverFetch).reply({
      restaurantId: RID,
      userId: SAM,
      providerId: PID,
      body: "Thursday works for us.",
      now: NOW,
    });

    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("window_closed");
    // THE SENTENCE, not just the code. ADR 0121: a refusal must say what did
    // NOT happen, because "it did not go" and "it will go later" are different
    // facts and only one of them is true.
    expect(out.words).toMatch(/closed/i);
    expect(out.words).toMatch(/nothing was queued/i);
    expect(out.words).toMatch(/will not go out when they next reply/i);
    expect(out.words).toMatch(/template/i);
  });

  it("writes NO conversation row and NO meter row when it refuses", async () => {
    const db = seed({ procurement_conversations: [inboundRow(25 * HOUR)] });
    await build(db, neverFetch).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    // One row: the inbound the fixture seeded. No outbound was mirrored,
    // because nothing was attempted.
    expect(db.tables.procurement_conversations).toHaveLength(1);
    expect(db.tables.house_message_meter).toHaveLength(0);
  });

  it("refuses when the vendor has NEVER written — there is no window to reply inside", async () => {
    const db = seed({ procurement_conversations: [] });
    const out = await build(db, neverFetch).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    expect(out.sent).toBe(false);
    // Not `window_closed`: with no conversation at all there is also no number
    // to reply to, and the book-only rule refuses first.
    expect(out.refusal).toBe("not_in_book");
    expect(out.words).toMatch(/nothing was queued/i);
  });

  it("an UNREADABLE window is its own refusal, never folded into `closed`", async () => {
    // Our read failing is ours. A manager told to "start with a template" for
    // our outage has been handed the wrong problem.
    const db = seed();
    const svc = build(db, neverFetch);
    // Fail the window read only, after the reply address has been resolved.
    let reads = 0;
    const realFrom = db.supabase.from.bind(db.supabase);
    db.supabase.from = (table: string) => {
      if (table === "procurement_conversations" && ++reads === 2) {
        db.errors["procurement_conversations:select"] = { message: "timeout" };
      }
      return realFrom(table);
    };
    const out = await svc.reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    expect(out.sent).toBe(false);
    expect(["window_unknown", "read_failed"]).toContain(out.refusal);
    expect(out.refusal).not.toBe("window_closed");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("a send INSIDE the window goes once, and is metered once", () => {
  it("dispatches exactly one request and writes exactly one meter row", async () => {
    const db = seed();
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const out = await build(db, okFetch(calls)).reply({
      restaurantId: RID, userId: SAM, providerId: PID,
      body: "Thursday works — six cases.", now: NOW,
    });

    expect(out.sent).toBe(true);
    expect(out.refusal).toBeNull();
    expect(out.providerRef).toBe("wamid.OUT1");
    expect(calls).toHaveLength(1);

    // The URL and the body are the adapter's, built from Meta's documented
    // shape. Asserted here so a change to either shows up on the send path and
    // not only in the adapter's own suite.
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/106540352242922/messages");
    expect(JSON.parse(calls[0].body)).toMatchObject({
      messaging_product: "whatsapp",
      to: WA_ID,
      type: "text",
      text: { preview_url: false, body: "Thursday works — six cases." },
    });
    // The house's own decrypted token, never the platform placeholder.
    expect(calls[0].headers.Authorization).toBe("Bearer house-token");

    // EXACTLY ONE METER ROW.
    expect(out.metered).toBe(true);
    expect(db.tables.house_message_meter).toHaveLength(1);
    const meter = db.tables.house_message_meter[0];
    expect(meter).toMatchObject({
      restaurant_id: RID,
      sender_id: SENDER,
      channel: "whatsapp",
      provider: "meta_cloud",
      provider_message_ref: "wamid.OUT1",
      // FREE BY RULE, and the rule is quotable: a non-template message inside
      // an open window is free on Meta's own rate card. Counting it would bill
      // a house for a message Meta gave away.
      counts_against_allowance: false,
      provider_cost_state: "not_reported_yet",
      // The month is the HOUSE's, not the server's.
      month_timezone: "Europe/Istanbul",
    });
    expect(String(meter.billable_reason).length).toBeGreaterThan(20);
    // The cost columns obey the table's CHECK: unreported means neither half.
    expect(meter.provider_cost_minor).toBeNull();
    expect(meter.provider_cost_currency).toBeNull();
  });

  it("MIRRORS the outbound before the provider is asked", async () => {
    const db = seed();
    const order: string[] = [];
    const fetchImpl: FetchLike = async () => {
      // Read the mirror AS IT STOOD when the provider was called. This is the
      // mutation-provable assertion: moving the insert below the dispatch makes
      // this fail.
      order.push(
        String(
          db.tables.procurement_conversations.find((r) => r.direction === "outbound")
            ?.delivery_status ?? "no-row",
        ),
      );
      return { status: 200, text: async () => JSON.stringify(META_ACCEPTED) };
    };
    await build(db, fetchImpl).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "On its way.", now: NOW,
    });
    // The row existed, and it did NOT say "sent" — a status set before the call
    // cannot describe the call.
    expect(order).toEqual(["attempting"]);

    const outbound = db.tables.procurement_conversations.find((r) => r.direction === "outbound");
    expect(outbound).toMatchObject({
      channel: "whatsapp",
      direction: "outbound",
      message_text: "On its way.",
      delivery_status: "accepted_by_provider",
      message_id: "wamid.OUT1",
      round_count: 1,
    });
  });

  it("REFUSES the send when the mirror cannot be written", async () => {
    // ADR 0121: without the mirror, P1 must not ship. A message Meta holds and
    // the house's book does not is the custody problem the mirror answers.
    const db = seed({}, { "procurement_conversations:insert": { message: "constraint" } });
    const out = await build(db, neverFetch).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("mirror_failed");
    expect(db.tables.house_message_meter).toHaveLength(0);
  });

  it("a provider refusal is reported as refused, with no invented message id", async () => {
    const db = seed();
    const fetchImpl: FetchLike = async () => ({
      status: 400,
      text: async () =>
        JSON.stringify({ error: { message: "Re-engagement message", code: 131047 } }),
    });
    const out = await build(db, fetchImpl).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    expect(out.sent).toBe(false);
    expect(out.providerRef).toBeNull();
    expect(out.words).toMatch(/131047/);
    // Still metered — the provider WAS asked, and the ledger records that.
    expect(db.tables.house_message_meter).toHaveLength(1);
    expect(db.tables.house_message_meter[0].counts_against_allowance).toBe(false);
  });

  it("an unreachable provider is UNKNOWN, never 'not sent'", async () => {
    const db = seed();
    const fetchImpl: FetchLike = async () => {
      throw new Error("ETIMEDOUT");
    };
    const out = await build(db, fetchImpl).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    expect(out.sent).toBe(false);
    expect(out.words).toMatch(/UNKNOWN/);
    const outbound = db.tables.procurement_conversations.find((r) => r.direction === "outbound");
    expect(outbound?.delivery_status).toBe("unknown");
    // Recorded and NOT counted: an uncounted message is recoverable, a wrongly
    // counted one is a bill.
    expect(db.tables.house_message_meter).toHaveLength(1);
    expect(db.tables.house_message_meter[0].provider_cost_state).toBe("unavailable");
  });

  it("says so when the meter row itself failed, rather than reporting a clean send", async () => {
    const db = seed({}, { "house_message_meter:insert": { message: "constraint" } });
    const out = await build(db, okFetch([])).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "Hello.", now: NOW,
    });
    expect(out.sent).toBe(true);
    expect(out.metered).toBe(false);
    expect(out.words).toMatch(/NOT recorded on the house's message meter/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the composer's guards run unchanged", () => {
  it("blocks commitment language before the window is even read", async () => {
    const db = seed();
    const out = await build(db, neverFetch).reply({
      restaurantId: RID, userId: SAM, providerId: PID,
      // A real phrase from `COMMITMENT_PATTERN_SOURCES`, quoted rather than
      // invented: a made-up sentence would test our idea of the list.
      body: "We accept the price — we will take six cases.", now: NOW,
    });
    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("guardrail");
    expect(out.guardrails.some((h) => h.rule === "commitment_language" && h.blocking)).toBe(true);
    expect(db.tables.house_message_meter).toHaveLength(0);
  });

  it("blocks an unresolved merge token", async () => {
    const db = seed();
    const out = await build(db, neverFetch).reply({
      restaurantId: RID, userId: SAM, providerId: PID,
      body: "Your last price was {{last_price}} — can you hold it?", now: NOW,
    });
    expect(out.refusal).toBe("guardrail");
    expect(out.guardrails.some((h) => h.rule === "unresolved_merge_field")).toBe(true);
  });

  it("states the round count rather than blocking on it", async () => {
    const db = seed({
      procurement_conversations: [
        inboundRow(2 * HOUR),
        { id: "o1", restaurant_id: RID, provider_id: PID, direction: "outbound", channel: "whatsapp", created_at: "2026-09-06T09:00:00Z" },
        { id: "o2", restaurant_id: RID, provider_id: PID, direction: "outbound", channel: "whatsapp", created_at: "2026-09-06T10:00:00Z" },
      ],
    });
    const out = await build(db, okFetch([])).reply({
      restaurantId: RID, userId: SAM, providerId: PID, body: "One more thing.", now: NOW,
    });
    expect(out.sent).toBe(true);
    const rounds = out.guardrails.find((h) => h.rule === "max_rounds");
    expect(rounds?.blocking).toBe(false);
  });

  it("is the same function the letter path runs, not a copy", () => {
    // The whole reason `composer-guardrails.ts` exists. Two implementations of
    // the commitment rule would let one grow a phrase the other lacks, on the
    // channel ADR 0121 says needs it MORE.
    const send = readFileSync(join(__dirname, "whatsapp-send.service.ts"), "utf8");
    const letters = readFileSync(
      join(__dirname, "..", "letters", "house-letters.service.ts"),
      "utf8",
    );
    expect(send).toMatch(/from "\.\.\/letters\/composer-guardrails"/);
    expect(letters).toMatch(/from "\.\/composer-guardrails"/);
    // And neither file re-declares the patterns.
    expect(send).not.toMatch(/COMMITMENT_PATTERN_SOURCES/);
    expect(letters).not.toMatch(/COMMITMENT_PATTERN_SOURCES/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("a withdrawn consent refuses the crew text", () => {
  /**
   * The crew leg, not the vendor one. `person_text_consents` is a PERSON's
   * agreement to be texted by their house; a vendor's agreement is Meta's
   * opt-in rule, which the open 24-hour window is the evidence for. Both are
   * proved, in the place each actually lives.
   */
  const crewSeed = (consents: Record<string, unknown>[]) =>
    makeStubDb({
      house_text_senders: [
        { id: SENDER, restaurant_id: RID, channel: "whatsapp", path: "bring_your_own", state: "connected", market: "TR", identity: "+905321112233", identity_kind: "e164", revoked_at: null, created_at: "2026-09-01T00:00:00Z" },
      ],
      person_text_consents: consents,
      house_text_sender_credentials: [],
      house_message_meter: [],
      house_message_credits: [],
      plan_message_allowances: [],
      house_message_allowances: [],
      restaurants: [{ id: RID, subscription_tier: "pilot", timezone: "Europe/Istanbul", currency: null }],
    });

  const senderSvc = (db: StubDb) => {
    const dbs = asDatabaseService(db);
    const config = { get: () => undefined } as unknown as ConfigService;
    const credentials = new TextCredentialsService(dbs, new TokenCryptoService(config), config);
    return new TextSenderService(dbs, new TextTransportRegistry(credentials), new TextUsageService(dbs));
  };

  const live = {
    restaurant_id: RID,
    user_id: SAM,
    phone: "+905320000000",
    channel: "any",
    consented_at: "2026-09-01T00:00:00Z",
    withdrawn_at: null,
  };

  it("refuses with `no_consent` once the consent is withdrawn", async () => {
    const db = crewSeed([{ ...live, withdrawn_at: "2026-09-05T00:00:00Z" }]);
    const out = await senderSvc(db).send({ restaurantId: RID, recipientUserId: SAM, body: "Shift change." });
    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("no_consent");
  });

  it("a live consent gets past the consent gate — so the refusal above is real", async () => {
    // Without this the case above could pass because EVERY send refuses.
    const db = crewSeed([live]);
    const out = await senderSvc(db).send({ restaurantId: RID, recipientUserId: SAM, body: "Shift change." });
    expect(out.sent).toBe(false);
    // It gets further: the refusal is now about the missing provider account,
    // not about consent.
    expect(out.refusal).not.toBe("no_consent");
    expect(out.refusal).toBe("no_provider_account");
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("the HTTP census is complete", () => {
  /**
   * `text-transport.spec.ts` asserts the two adapters and the registry hold no
   * HTTP primitive. That assertion is unchanged and still passes. This is its
   * completing half: across the WHOLE `text/` tree, exactly ONE file may hold
   * one, and it is `providers/text-dispatch.service.ts`.
   *
   * Without this, "the adapters cannot send" stays true while a `fetch` appears
   * in the send service — the same shape as a guard that checks the three files
   * somebody thought of.
   */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (name.endsWith(".ts") && !name.endsWith(".spec.ts")) out.push(p);
    }
    return out;
  }

  it("exactly one non-spec file under text/ performs an HTTP call", () => {
    const files = walk(__dirname);
    // Never vacuous: if the walk found nothing, the assertion below would pass
    // by looking at nothing.
    expect(files.length).toBeGreaterThan(10);

    const holders = files.filter((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return (
        /\bfetch\s*\(/.test(src) ||
        /\bfetchImpl\s*\(/.test(src) ||
        /\baxios\b/.test(src) ||
        /require\(['"]https?['"]\)/.test(src) ||
        /from ['"]https?['"]/.test(src)
      );
    });

    expect(holders.map((f) => f.split("/text/")[1])).toEqual([
      "providers/text-dispatch.service.ts",
    ]);
  });
});
