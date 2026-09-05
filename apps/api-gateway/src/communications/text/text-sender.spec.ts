import { readFileSync } from "fs";
import { join } from "path";
import {
  asDatabaseService,
  makeStubDb,
  type StubDb,
} from "../../team/testing/supabase-stub";
import { TextSenderService } from "./text-sender.service";
import {
  TEXT_SENDER_DEFINITIONS,
  requirementFor,
  surveyedMarkets,
} from "./text-senders.catalogue";

/**
 * The house sends in its own name, or nothing goes (ADR 0121).
 *
 * Every assertion below is about something that must stay TRUE rather than
 * something that happens to be true today. The two that matter most are the
 * two this repo has been burned by:
 *
 *   1. Nothing may report a send it did not make. `send()` is typed
 *      `sent: false` so a future edit that wants to claim otherwise has to
 *      change the type, which is a decision rather than an accident.
 *   2. A failed read is never an empty house. supabase-js resolves
 *      `{ data, error }` and never throws, so the only thing standing between a
 *      database outage and the sentence "this restaurant has no sender" is a
 *      branch — and these tests are what keep it there.
 */

const RID = "restaurant-1";
const SAM = "user-sam";

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      house_text_senders: [],
      person_text_consents: [],
    },
    errors,
  );
}

const svc = (db: StubDb) => new TextSenderService(asDatabaseService(db));

/**
 * The file with its comments removed.
 *
 * The structural assertions below are about what the CODE does, and these files
 * deliberately NAME the things they refuse — "never the house's password", "the
 * shared PLIVO_PHONE_NUMBER is not reachable from here". A grep over the raw
 * text would fail on the sentence that states the rule, which would make the
 * guard punish the documentation and reward silence.
 */
function codeOf(file: string): string {
  return readFileSync(join(__dirname, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("TextSenderService — nothing sends, and it says why", () => {
  it("refuses with `no_sender` when this house has none, and never claims a send", async () => {
    const out = await svc(seed()).send({
      restaurantId: RID,
      recipientUserId: SAM,
      body: "Saturday moves to seven.",
    });
    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("no_sender");
    expect(out.words).toContain("nothing is sent");
  });

  it("a FAILED read is not an empty house, and the refusal says so in words", async () => {
    const db = seed({ "house_text_senders:select": { message: "connection reset" } });
    const readout = await svc(db).readout(RID);
    expect(readout.readable).toBe(false);
    expect(readout.reason).toBe("connection reset");

    const out = await svc(db).send({
      restaurantId: RID,
      recipientUserId: SAM,
      body: "x",
    });
    expect(out.refusal).toBe("read_failed");
    // The exact distinction. Without this sentence a manager reads an outage as
    // a fact about their restaurant.
    expect(out.words).toContain("not the same as this house having no sender");
  });

  it("a failed CONSENT read stops the send rather than treating silence as agreement", async () => {
    const db = seed({ "person_text_consents:select": { message: "statement timeout" } });
    db.tables.house_text_senders.push({
      id: "s1",
      restaurant_id: RID,
      channel: "whatsapp",
      path: "bring_your_own",
      state: "connected",
      identity: "+905550000000",
      identity_kind: "e164",
      market: "TR",
      created_at: "2026-09-05T00:00:00Z",
    });
    const out = await svc(db).send({
      restaurantId: RID,
      recipientUserId: SAM,
      body: "x",
    });
    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("read_failed");
    expect(out.words).toContain("withdrawal");
  });

  it("even with a connected sender AND a consent, it refuses — because no transport exists", async () => {
    const db = seed();
    db.tables.house_text_senders.push({
      id: "s1",
      restaurant_id: RID,
      channel: "whatsapp",
      path: "bring_your_own",
      state: "connected",
      identity: "+905550000000",
      identity_kind: "e164",
      market: "TR",
      created_at: "2026-09-05T00:00:00Z",
    });
    db.tables.person_text_consents.push({
      id: "c1",
      user_id: SAM,
      restaurant_id: RID,
      phone: "+905551111111",
      channel: "any",
      consented_at: "2026-09-05T00:00:00Z",
      withdrawn_at: null,
    });
    const out = await svc(db).send({
      restaurantId: RID,
      recipientUserId: SAM,
      body: "x",
    });
    expect(out.sent).toBe(false);
    expect(out.refusal).toBe("transport_not_built");
    expect(out.channel).toBe("whatsapp");
    // The one thing a caller must be able to rely on: nothing is queued, so
    // nothing arrives later and surprises somebody.
    expect(out.words).toContain("nothing will arrive later");
  });

  it("a revoked sender is not sendable, and drops out of the readout", async () => {
    const db = seed();
    db.tables.house_text_senders.push({
      id: "s1",
      restaurant_id: RID,
      channel: "sms",
      path: "mudavym_registers",
      state: "revoked",
      identity: "MUDAVYM",
      identity_kind: "alphanumeric",
      market: "TR",
      revoked_at: "2026-09-05T00:00:00Z",
      created_at: "2026-09-05T00:00:00Z",
    });
    const readout = await svc(db).readout(RID);
    expect(readout.sms).toBeNull();
    expect(await svc(db).sendableSender(RID, "sms")).toBeNull();
  });
});

describe("TextSenderService — choosing a channel", () => {
  const connected = (channel: "whatsapp" | "sms", market: string) => ({
    id: "s",
    channel,
    path: "bring_your_own" as const,
    state: "connected" as const,
    stateDetail: null,
    identity: channel === "whatsapp" ? "+905550000000" : "HOUSE",
    identityKind: (channel === "whatsapp" ? "e164" : "alphanumeric") as
      | "e164"
      | "alphanumeric",
    displayName: null,
    displayNameState: null,
    market,
    provider: null,
    externalRef: null,
    declaredBy: null,
    lastProbeAt: null,
    lastProbeResult: null,
    lastProbeDetail: null,
    feeStated: null,
    timelineStated: null,
    submittedAt: null,
    connectedAt: null,
    revokedAt: null,
    createdAt: "2026-09-05T00:00:00Z",
  });

  const consent = {
    userId: SAM,
    phone: "+90555",
    channel: "any" as const,
    consentedAt: "2026-09-05T00:00:00Z",
  };

  it("prefers WhatsApp where both exist — not on taste, but because a Turkish SMS cannot receive a reply", () => {
    const chosen = svc(seed()).choose({
      consent,
      whatsapp: connected("whatsapp", "TR"),
      sms: connected("sms", "TR"),
    });
    expect(chosen.channel).toBe("whatsapp");
  });

  it("names the one-way limit out loud when SMS in Türkiye is the only sender", () => {
    const chosen = svc(seed()).choose({
      consent,
      whatsapp: null,
      sms: connected("sms", "TR"),
    });
    expect(chosen.channel).toBe("sms");
    expect(chosen.why).toContain("one-way");
    expect(chosen.why).toContain("a reply cannot come back");
  });

  it("no consent means no channel, whatever the house has connected", () => {
    const chosen = svc(seed()).choose({
      consent: null,
      whatsapp: connected("whatsapp", "TR"),
      sms: connected("sms", "US"),
    });
    expect(chosen.channel).toBeNull();
    expect(chosen.why).toContain("has not agreed");
  });

  it("a person who consented to SMS only is not reached on WhatsApp", () => {
    const chosen = svc(seed()).choose({
      consent: { ...consent, channel: "sms" },
      whatsapp: connected("whatsapp", "TR"),
      sms: null,
    });
    expect(chosen.channel).toBeNull();
  });
});

describe("TextSenderService — the person's consent", () => {
  it("withdrawal is a timestamp, never a delete", async () => {
    const db = seed();
    await svc(db).consent({
      restaurantId: RID,
      userId: SAM,
      phone: "+905551111111",
      channel: "any",
    });
    expect(db.tables.person_text_consents).toHaveLength(1);

    const { withdrawn } = await svc(db).withdraw({
      restaurantId: RID,
      userId: SAM,
      via: "person",
    });
    expect(withdrawn).toBe(1);
    // The row survives. 47 CFR 64.1200(d)(3) requires the request to be
    // recorded and (d)(6) requires it honoured for five years, so a deleted row
    // is a compliance failure that looks like housekeeping.
    expect(db.tables.person_text_consents).toHaveLength(1);
    expect(db.tables.person_text_consents[0].withdrawn_at).toBeTruthy();
    expect(db.tables.person_text_consents[0].withdrawn_via).toBe("person");

    const mine = await svc(db).myConsent(RID, SAM);
    expect(mine.consent).toBeNull();
    expect(mine.readable).toBe(true);
  });

  it("re-consenting at a new number leaves the old consent on the record", async () => {
    const db = seed();
    await svc(db).consent({ restaurantId: RID, userId: SAM, phone: "+1", channel: "sms" });
    await svc(db).consent({ restaurantId: RID, userId: SAM, phone: "+2", channel: "whatsapp" });
    expect(db.tables.person_text_consents).toHaveLength(2);
    const live = db.tables.person_text_consents.filter((r: any) => !r.withdrawn_at);
    expect(live).toHaveLength(1);
    expect(live[0].phone).toBe("+2");
  });
});

describe("The catalogue — what a house must provide", () => {
  it("answers per channel per market, and returns null rather than an empty checklist for a market nobody surveyed", () => {
    expect(requirementFor("sms", "US")).not.toBeNull();
    expect(requirementFor("sms", "TR")).not.toBeNull();
    expect(requirementFor("whatsapp", "TR")).not.toBeNull();
    // An empty requirement list would read as "nothing needed", which is the
    // absence-as-health shape arriving through a checklist.
    expect(requirementFor("sms", "DE")).toBeNull();
    expect(surveyedMarkets("sms").sort()).toEqual(["TR", "US"]);
  });

  it("records that a Turkish SMS is one-way and a US 10DLC is not", () => {
    expect(requirementFor("sms", "TR")!.twoWay).toBe(false);
    expect(requirementFor("sms", "US")!.twoWay).toBe(true);
    expect(requirementFor("whatsapp", "TR")!.twoWay).toBe(true);
  });

  it("every fee and timeline is a sentence carrying its source, never a bare number", () => {
    for (const def of Object.values(TEXT_SENDER_DEFINITIONS)) {
      for (const market of def.markets) {
        expect(market.fee.length).toBeGreaterThan(40);
        expect(market.timeline.length).toBeGreaterThan(40);
        // A figure with no fetch date outlives its citation.
        expect(`${market.fee} ${market.timeline}`).toMatch(
          /fetched 20\d\d-\d\d-\d\d|Twilio|Meta|guidelines|rate card/,
        );
        expect(market.provides.length).toBeGreaterThan(0);
        expect(market.refusals.length).toBeGreaterThan(0);
      }
    }
  });

  it("names both paths for both channels, and neither of them takes a password", () => {
    for (const def of Object.values(TEXT_SENDER_DEFINITIONS)) {
      expect(def.connection.bring_your_own.length).toBeGreaterThan(40);
      expect(def.connection.mudavym_registers.length).toBeGreaterThan(40);
      expect(def.revocation.length).toBeGreaterThan(20);
    }
    // The security promise the founder asked for ("we have to make sure the
    // connection is secure"), asserted rather than described.
    const dtos = codeOf("text-senders.dto.ts");
    expect(dtos).not.toMatch(/password|authToken|auth_token|apiSecret/i);
  });
});

describe("The shared Plivo number is not a fallback", () => {
  /**
   * STRUCTURAL, AND DELIBERATELY SO. The rule is not "we currently do not call
   * SmsService" — it is "the house send path may never reach the deployment's
   * shared number", because on a shared sender a STOP reply opts a person out
   * of every restaurant here for five years, and Twilio's own US guidelines
   * list shared phone numbers among the restricted use cases. A behavioural
   * test would pass the day somebody added the import.
   */
  it("the send path does not import or reference SmsService or PLIVO", () => {
    for (const file of [
      "text-sender.service.ts",
      "text-senders.controller.ts",
      "text-senders.module.ts",
    ]) {
      const src = codeOf(file);
      expect(src).not.toMatch(/from\s+["'][^"']*sms\.service["']/);
      expect(src).not.toMatch(/PLIVO_[A-Z_]+/);
    }
  });
});
