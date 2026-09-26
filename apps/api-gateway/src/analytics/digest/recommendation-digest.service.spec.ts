/**
 * The recommendations digest sender (ADR 0149 row 26), driven end to end:
 *
 *   the REAL RecommendationDigestService
 *   → the REAL RecommendationsService (its rule engine, fed stub analytics)
 *   → the REAL ScheduledTenantsService
 *   → the REAL letter template
 *   against an in-memory store that enforces the migration's unique indexes and
 *   CHECKs (testing/digest-fake-db.ts), with only the mail PROVIDER faked.
 *
 * The five cases the founder's brief names are the first five describes. Each
 * was run against a sabotaged sender to prove it fails without the behaviour it
 * pins (the page note records which sabotage broke which case).
 */

import { createHash } from "crypto";
import { RecommendationsService } from "../recommendations.service";
import { ScheduledTenantsService } from "../../communications/scheduled-tenants.service";
import { RecommendationDigestService } from "./recommendation-digest.service";
import { FakeDb, type Row } from "./testing/digest-fake-db";

/* ── the house ────────────────────────────────────────────────────────────── */

const HOUSE = "house-1";
const HOUSE_NAME = "Sim Meyhouse Kaleiçi";
const ZONE = "Europe/Istanbul"; // UTC+3 all year: 07:00 local = 04:00Z
const API = "https://api.mudavym.test";

const ANA = "user-ana"; // asked, daily
const BORA = "user-bora"; // member, never asked
const CEM = "user-cem"; // asked, then stopped by the link

/** Thursday 2026-09-17, 07:05 in Istanbul — five minutes past a 07:00 digest. */
const DUE_PLUS_5 = new Date("2026-09-17T04:05:00Z");

const WEEKDAY_SENTENCE =
  "Wednesday sales came in 40% lower than your average Wednesday ($600 vs $1.0k, over 12 past Wednesdays).";

function weekdayInsight(over: Row = {}) {
  return {
    candidateKey: "overall.revenue.vs_same_weekday",
    category: "sales",
    sentence: WEEKDAY_SENTENCE,
    score: 2,
    effectPct: -0.4,
    subject: "Wednesday",
    periodKey: "d:2026-09-16",
    ...over,
  };
}

/** Fires `weekly_demand_slide`, whose urgency is `this_week`. */
function weekSlideInsight() {
  return {
    candidateKey: "overall.revenue.vs_prev_period_7d",
    category: "sales",
    sentence: "Sales over the last 7 days came in 18% below the 7 days before.",
    score: 1.5,
    effectPct: -0.18,
    subject: null,
    periodKey: "w:2026-09-16",
  };
}

interface EngineOpts {
  insights?: Row[];
  dispositionsReadable?: boolean;
  rejectRisk?: boolean;
}

function engine(db: FakeDb, o: EngineOpts = {}) {
  return new RecommendationsService(
    {
      getFinancialSummary: async () => null,
      getRiskProfile: o.rejectRisk
        ? async () => {
            throw new Error("risk profile read failed");
          }
        : async () => null,
      getInventoryScience: async () => null,
    } as any,
    {
      getMenuEngineering: async () => null,
      getSeasonality: async () => null,
      getCashflow: async () => null,
    } as any,
    {
      generate: async () => ({ insights: o.insights ?? [weekdayInsight()] }),
    } as any,
    { listGoals: async () => [] } as any,
    {
      readDispositions: async () => ({
        map: new Map(),
        readable: o.dispositionsReadable ?? true,
        problem: null,
      }),
    } as any,
    { supabase: db, getClient: () => db } as any,
    // ADR 0193: the engine's price-advice source, answering "nothing to
    // advise". Without it the engine rightly names "price advice" among the
    // sources it could not read, which is not what these letters are about.
    {
      adviseHouse: async (restaurantId: string) => ({
        restaurantId,
        generatedAt: "2026-09-17T04:00:00.000Z",
        target: { bottlePct: null, glassPct: null, bandPct: null, set: false, pourConfirmed: false, pourMl: null },
        wines: [],
        counts: { no_target: 0, pour_unconfirmed: 0, no_price: 0, no_cost: 0, on_target: 0, raise: 0, lower: 0 },
        locks: { readable: true, reason: null, held: 0 },
      }),
    } as any,
    // ADR 0193 round 3: the engine's price-lock source, answering "no locks".
    {
      list: async (restaurantId: string) => ({
        restaurantId,
        readable: true,
        reason: null,
        locks: [],
        counts: { open: 0, onCurrentMenu: 0, notOnCurrentMenu: 0, toReview: 0 },
      }),
    } as any,
  );
}

interface Provider {
  sendEmail: jest.Mock;
}

function provider(answer?: (opts: any) => any): Provider {
  let n = 0;
  return {
    sendEmail: jest.fn(async (opts: any) => {
      if (answer) return answer(opts);
      n += 1;
      return { success: true, messageId: `gmail-${n}` };
    }),
  };
}

function build(
  o: {
    db?: FakeDb;
    env?: Record<string, string | undefined>;
    engine?: EngineOpts;
    gmail?: Provider;
  } = {},
) {
  const db = o.db ?? seed();
  const env: Record<string, string | undefined> = {
    DIGEST_SEND_ENABLED: "true",
    API_PUBLIC_URL: API,
    FRONTEND_URL: "https://mudavym.test,http://localhost:3000",
    DEFAULT_RESTAURANT_ID: HOUSE,
    ...o.env,
  };
  const config = { get: (k: string) => env[k] } as any;
  const database = { getClient: () => db, supabase: db } as any;
  const gmail = o.gmail ?? provider();
  const tenants = new ScheduledTenantsService(config, database);
  const service = new RecommendationDigestService(
    database,
    engine(db, o.engine),
    gmail as any,
    tenants,
    config,
  );
  return { db, service, gmail, tenants };
}

function seed(): FakeDb {
  const db = new FakeDb();
  db.tables.restaurants = [
    {
      id: HOUSE,
      name: HOUSE_NAME,
      timezone: ZONE,
      is_active: true,
      deleted_at: null,
    },
  ];
  db.tables.restaurant_feature_flags = [];
  db.tables.recommendation_digest_prefs = [
    {
      restaurant_id: HOUSE,
      digest_enabled: true,
      digest_hour: 7,
      digest_min_urgency: "this_week",
      recipient_email: "not-a-member@elsewhere.test",
      last_sent_at: null,
      updated_at: "2026-09-01T09:00:00Z",
    },
  ];
  db.tables.users = [
    {
      user_id: ANA,
      email: "ana@house.test",
      name: "Ana",
      restaurant_id: HOUSE,
    },
    {
      user_id: BORA,
      email: "bora@house.test",
      name: "Bora",
      restaurant_id: HOUSE,
    },
    {
      user_id: CEM,
      email: "cem@house.test",
      name: "Cem",
      restaurant_id: HOUSE,
    },
  ];
  db.tables.user_restaurant_access = [ANA, BORA, CEM].map((user_id) => ({
    user_id,
    restaurant_id: HOUSE,
    is_active: true,
    valid_from: "2026-01-01T00:00:00Z",
    valid_until: null,
  }));
  db.tables.recommendation_digest_subscriptions = [
    {
      id: "sub-ana",
      restaurant_id: HOUSE,
      user_id: ANA,
      frequency: "daily",
      weekday: null,
      subscribed_at: "2026-09-02T10:00:00Z",
      updated_at: "2026-09-02T10:00:00Z",
      unsubscribed_at: null,
      unsubscribed_via: null,
    },
    {
      id: "sub-cem",
      restaurant_id: HOUSE,
      user_id: CEM,
      frequency: "daily",
      weekday: null,
      subscribed_at: "2026-09-02T10:00:00Z",
      updated_at: "2026-09-10T10:00:00Z",
      unsubscribed_at: "2026-09-10T10:00:00Z",
      unsubscribed_via: "link",
    },
  ];
  db.tables.notification_preferences = [];
  db.tables.recommendation_digest_sends = [];
  db.tables.recommendation_impressions = [];
  return db;
}

const TENANT = {
  id: HOUSE,
  name: HOUSE_NAME,
  timezone: ZONE,
  timezoneIsSet: true,
  isLegacyDefault: true,
};

const sends = (db: FakeDb) => db.rows("recommendation_digest_sends");

function tokenFrom(mail: any): string {
  const m = /\/unsubscribe\/([0-9a-f]{64})$/.exec(mail.listUnsubscribe.url);
  if (!m) throw new Error(`no token in ${mail.listUnsubscribe.url}`);
  return m[1];
}

/* ── 1. opted out ─────────────────────────────────────────────────────────── */

describe("a member who did not opt in gets nothing", () => {
  it("mails only the member who asked — not the member who never did, not the one who stopped it, not the house's free recipient address", async () => {
    const { db, service, gmail } = build();

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendEmail.mock.calls[0][0].to).toEqual(["ana@house.test"]);
    expect(tally.subscribed).toBe(1); // Cem's stopped row is not active
    expect(sends(db).map((r) => r.user_id)).toEqual([ANA]);
    const everyRecipient = gmail.sendEmail.mock.calls.flatMap((c) => c[0].to);
    expect(everyRecipient).not.toContain("bora@house.test");
    expect(everyRecipient).not.toContain("cem@house.test");
    expect(everyRecipient).not.toContain("not-a-member@elsewhere.test");
  });

  it("sends nothing to a subscriber whose email channel is off; the ai category preference no longer gates the digest (founder, PR #391 audit B2(b), 2026-09-19: the subscription alone is the gate)", async () => {
    const db = seed();
    db.tables.recommendation_digest_subscriptions.push({
      id: "sub-bora",
      restaurant_id: HOUSE,
      user_id: BORA,
      frequency: "daily",
      weekday: null,
      subscribed_at: "2026-09-02T10:00:00Z",
      updated_at: "2026-09-02T10:00:00Z",
      unsubscribed_at: null,
      unsubscribed_via: null,
    });
    db.tables.notification_preferences = [
      {
        user_id: ANA,
        restaurant_id: HOUSE,
        email_enabled: false,
        categories: { ai: true },
      },
      {
        user_id: BORA,
        restaurant_id: HOUSE,
        email_enabled: true,
        categories: { ai: false, orders: true },
      },
    ];
    const { service, gmail } = build({ db });

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    // Ana: email channel off -> still excluded.
    expect(tally.emailOff).toBe(1);
    // Bora: `categories.ai` is off, but that no longer gates anything -- their
    // subscription and email channel are both on, so they DO get the digest.
    // Against the pre-fix code (the `categoryOn`/`categoryOff` gate restored)
    // this assertion fails: Bora was skipped and nothing was sent. `DigestTally`
    // no longer declares `categoryOff` at all, so a reintroduced gate that wrote
    // it would also fail to TYPECHECK, not only to run.
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(sends(db)).toHaveLength(1);
  });

  it("sends nothing to an ex-member who kept their subscription row", async () => {
    const db = seed();
    db.tables.user_restaurant_access.find(
      (r) => r.user_id === ANA,
    )!.valid_until = "2026-09-15T00:00:00Z";
    const { service, gmail } = build({ db });

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tally.notMembers).toBe(1);
    expect(sends(db)).toHaveLength(0);
  });

  it("sends nothing at all — and does not even enumerate houses — while DIGEST_SEND_ENABLED is unset or anything but true/1", async () => {
    const saved = process.env.DIGEST_SEND_ENABLED;
    delete process.env.DIGEST_SEND_ENABLED;
    try {
      for (const value of [undefined, "", "yes", "on", "false", "0"]) {
        const { db, service, gmail, tenants } = build({
          env: { DIGEST_SEND_ENABLED: value },
        });
        const list = jest.spyOn(tenants, "list");
        await service.sweep();
        expect(list).not.toHaveBeenCalled();
        expect(gmail.sendEmail).not.toHaveBeenCalled();
        expect(sends(db)).toHaveLength(0);
      }
    } finally {
      if (saved !== undefined) process.env.DIGEST_SEND_ENABLED = saved;
    }
  });

  it("armed, the cron body runs the house through runPerTenant", async () => {
    const { service, tenants } = build();
    const run = jest.spyOn(tenants, "runPerTenant");
    const sweepTenant = jest
      .spyOn(service, "sweepTenant")
      .mockResolvedValue({} as any);
    await service.sweep();
    expect(run).toHaveBeenCalledWith(
      "recommendation-digest",
      expect.any(Function),
    );
    expect(sweepTenant).toHaveBeenCalledWith(
      expect.objectContaining({ id: HOUSE }),
    );
  });
});

/* ── 2. quiet hours ───────────────────────────────────────────────────────── */

describe("quiet hours defer the digest, on the house's wall clock", () => {
  function quietDb(start: string, end: string) {
    const db = seed();
    db.tables.notification_preferences = [
      {
        user_id: ANA,
        restaurant_id: HOUSE,
        email_enabled: true,
        categories: { ai: true },
        quiet_hours_enabled: true,
        quiet_hours_start: start,
        quiet_hours_end: end,
      },
    ];
    return db;
  }

  it("inside the window: no row and no send; the first sweep after it closes sends it", async () => {
    const db = quietDb("22:00", "08:00");
    const { service, gmail } = build({ db });

    // 07:05 Istanbul — inside 22:00–08:00.
    const early = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(early.deferredQuietHours).toBe(1);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(sends(db)).toHaveLength(0);

    // 07:45 Istanbul — still inside.
    await service.sweepTenant(TENANT, new Date("2026-09-17T04:45:00Z"));
    expect(gmail.sendEmail).not.toHaveBeenCalled();

    // 08:00 Istanbul — the window is half-open [start, end): 08:00 is out.
    const after = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T05:00:00Z"),
    );
    expect(after.sent).toBe(1);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(sends(db)).toHaveLength(1);
    expect(sends(db)[0]).toMatchObject({
      period_key: "2026-09-17",
      outcome: "sent",
    });
  });

  it("reads the window in the house's zone, not the server's: 07:05 Istanbul is 04:05Z, which a UTC reading would call outside 06:00–08:00", async () => {
    const db = quietDb("06:00", "08:00");
    const { service, gmail } = build({ db });
    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(tally.deferredQuietHours).toBe(1);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });

  it("a window that outlasts the late limit ends in an `expired` row that says why — never a send at 19:15", async () => {
    const db = quietDb("06:00", "20:00");
    const { service, gmail } = build({ db });

    // 19:15 Istanbul = 16:15Z: 12h15m after the 04:00Z due, still inside quiet hours.
    const tally = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T16:15:00Z"),
    );

    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tally.expired).toBe(1);
    expect(sends(db)).toHaveLength(1);
    expect(sends(db)[0].outcome).toBe("expired");
    expect(sends(db)[0].reason).toMatch(/within 12 hours/);
    expect(sends(db)[0].sent_at ?? null).toBeNull();
  });
});

/* ── 3. two instances ─────────────────────────────────────────────────────── */

describe("two gateway instances sweeping the same house at the same instant", () => {
  it("claim the send once: one mail, one row, and the loser counts the claim it lost", async () => {
    const db = seed();
    // Both instances pass every pre-read (including the already-handled read)
    // before either writes: only the unique index can stop the second.
    db.claimBarrier = 2;
    const one = build({ db });
    const two = build({ db });

    const [a, b] = await Promise.all([
      one.service.sweepTenant(TENANT, DUE_PLUS_5),
      two.service.sweepTenant(TENANT, DUE_PLUS_5),
    ]);

    const mails =
      one.gmail.sendEmail.mock.calls.length +
      two.gmail.sendEmail.mock.calls.length;
    expect(mails).toBe(1);
    expect(sends(db)).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.claimedElsewhere + b.claimedElsewhere).toBe(1);
    expect(a.alreadyHandled + b.alreadyHandled).toBe(0); // the race really happened
  });

  it("and every later sweep in the same period finds it handled", async () => {
    const { db, service, gmail } = build();
    await service.sweepTenant(TENANT, DUE_PLUS_5);
    const again = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T09:00:00Z"),
    );
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(again.alreadyHandled).toBe(1);
    expect(sends(db)).toHaveLength(1);

    // The next day is a new period.
    await service.sweepTenant(TENANT, new Date("2026-09-18T04:05:00Z"));
    expect(gmail.sendEmail).toHaveBeenCalledTimes(2);
    expect(sends(db).map((r) => r.period_key)).toEqual([
      "2026-09-17",
      "2026-09-18",
    ]);
  });
});

/* ── 4. empty ─────────────────────────────────────────────────────────────── */

describe("an empty digest is not sent, and the log says why", () => {
  it("nothing fired: no mail, one skipped_empty row naming what the engine evaluated", async () => {
    const { db, service, gmail } = build({ engine: { insights: [] } });

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tally.skippedEmpty).toBe(1);
    const [row] = sends(db);
    expect(row).toMatchObject({
      outcome: "skipped_empty",
      entries_count: 0,
      rule_keys: [],
    });
    expect(row.reason).toMatch(
      /^Nothing to send: the engine evaluated \d+ rules at /,
    );
    expect(row.reason).toMatch(
      /0 entries stood and none at or above "This week"/,
    );
    expect(row.rules_evaluated).toBeGreaterThan(0);
    expect(row.sent_at ?? null).toBeNull();
    expect(row.unsubscribe_token_hash ?? null).toBeNull();
  });

  it("something fired below the house's floor: still nothing sent, and the row says an entry stood below it", async () => {
    const db = seed();
    db.tables.recommendation_digest_prefs[0].digest_min_urgency = "now";
    const { service, gmail } = build({
      db,
      engine: { insights: [weekSlideInsight()] },
    });

    await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(sends(db)[0].outcome).toBe("skipped_empty");
    expect(sends(db)[0].reason).toMatch(
      /1 entry stood and none at or above "Now"/,
    );
  });

  it("an engine source that did not answer is named, so an empty result is not passed off as a clean one", async () => {
    const { db, service } = build({
      engine: { insights: [], rejectRisk: true },
    });
    await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(sends(db)[0].reason).toMatch(
      /could not read one of its sources \(risk profile\)/,
    );
    expect(sends(db)[0].reason).toMatch(/not proof that nothing stands/);
  });

  it("and a feed read that failed outright is an error, not an empty digest: no row, digest still owed", async () => {
    const { db, service, gmail } = build({
      engine: { dispositionsReadable: false },
    });
    await expect(service.sweepTenant(TENANT, DUE_PLUS_5)).rejects.toThrow(
      /dismissal store could not be read/,
    );
    expect(sends(db)).toHaveLength(0);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });
});

/* ── 5. provider failure ──────────────────────────────────────────────────── */

describe("a provider failure is logged as failed, and not retried", () => {
  it("a refusal: outcome failed with the provider's words, no sent_at, and no second attempt", async () => {
    const gmail = provider(() => ({
      success: false,
      error: "550 5.1.1 mailbox unavailable",
    }));
    const { db, service } = build({ gmail });

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(tally.failed).toBe(1);
    const [row] = sends(db);
    expect(row.outcome).toBe("failed");
    expect(row.reason).toMatch(/550 5\.1\.1 mailbox unavailable/);
    expect(row.sent_at ?? null).toBeNull();
    expect(row.finished_at).toBeTruthy();
    expect(db.rows("recommendation_digest_prefs")[0].last_sent_at).toBeNull();

    await service.sweepTenant(TENANT, new Date("2026-09-17T04:20:00Z"));
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a throw is a failure too, with the thrown message", async () => {
    const gmail = provider(() => {
      throw new Error("ETIMEDOUT smtp.gmail.com:587");
    });
    const { db, service } = build({ gmail });
    await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(sends(db)[0]).toMatchObject({ outcome: "failed" });
    expect(sends(db)[0].reason).toMatch(/ETIMEDOUT/);
  });

  it("a failed claim never falls through to a send", async () => {
    const db = seed();
    db.failures["recommendation_digest_sends:upsert"] = "connection reset";
    const { service, gmail } = build({ db });
    await expect(service.sweepTenant(TENANT, DUE_PLUS_5)).rejects.toThrow(
      /claim failed/,
    );
    expect(gmail.sendEmail).not.toHaveBeenCalled();
  });
});

/* ── the letter ───────────────────────────────────────────────────────────── */

describe("the letter quotes the engine, is branded Mudavym, and carries a working stop", () => {
  it("carries the engine's own sentences and their provenance, and records what went out", async () => {
    const db = seed();
    db.tables.recommendation_impressions.push({
      restaurant_id: HOUSE,
      rule_key: "sales_below_weekday_baseline",
      shown_at: "2026-09-16T18:00:00Z",
    });
    const { service, gmail } = build({ db });

    await service.sweepTenant(TENANT, DUE_PLUS_5);

    const mail = gmail.sendEmail.mock.calls[0][0];
    expect(mail.fromName).toBe("Mudavym");
    // Non-ASCII house name → RFC 2047 subject that decodes to the branded line.
    const decoded = Buffer.from(
      /^=\?UTF-8\?B\?(.+)\?=$/.exec(mail.subject)![1],
      "base64",
    ).toString("utf8");
    expect(decoded).toBe(`Mudavym: 1 recommendation standing at ${HOUSE_NAME}`);
    expect(mail.text).toContain(`[Now] ${WEEKDAY_SENTENCE}`);
    expect(mail.text).toContain(
      "From rule sales_below_weekday_baseline · sales · standing since 16 September 2026",
    );
    expect(mail.text).toContain(
      "Open it: https://mudavym.test/recommendations?insight=sales_below_weekday_baseline",
    );
    expect(mail.text).toContain("support@mudavym.com");
    expect(mail.html).toContain("$600 vs $1.0k"); // the engine's number, not a recomputed one
    expect(mail.html).toContain(">Mudavym<");

    const [row] = sends(db);
    expect(row).toMatchObject({
      outcome: "sent",
      provider_message_id: "gmail-1",
      entries_count: 1,
      rule_keys: ["sales_below_weekday_baseline"],
      time_zone: ZONE,
      due_at: "2026-09-17T04:00:00.000Z",
      reason: null,
    });
    expect(row.rules_evaluated).toBeGreaterThan(0);
    expect(db.rows("recommendation_digest_prefs")[0].last_sent_at).toBe(
      DUE_PLUS_5.toISOString(),
    );
    // The digest's compose is not a showing: no impression was logged for it.
    expect(
      db.writes.filter((w) => w.table === "recommendation_impressions"),
    ).toHaveLength(0);
  });

  it("stores only the SHA-256 of the unsubscribe token, never the token", async () => {
    const { db, service, gmail } = build();
    await service.sweepTenant(TENANT, DUE_PLUS_5);
    const mail = gmail.sendEmail.mock.calls[0][0];
    expect(
      mail.listUnsubscribe.url.startsWith(
        `${API}/api/v1/recommendations/digest/unsubscribe/`,
      ),
    ).toBe(true);
    expect(mail.listUnsubscribe.oneClick).toBe(true);
    const token = tokenFrom(mail);
    const [row] = sends(db);
    expect(row.unsubscribe_token_hash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    expect(JSON.stringify(db.tables)).not.toContain(token);
    expect(mail.html).toContain(token);
  });

  it("says in words when the letter was built on a partial reading", async () => {
    const { db, service, gmail } = build({ engine: { rejectRisk: true } });
    await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(gmail.sendEmail.mock.calls[0][0].text).toMatch(
      /could not read one of its sources \(risk profile\)/,
    );
    expect(sends(db)[0].reason).toMatch(/^Sent with a gap the letter states:/);
  });

  it("a house with no zone is read in UTC, and the letter says so", async () => {
    const db = seed();
    db.tables.restaurants[0].timezone = null;
    const { service, gmail } = build({ db });
    const tenant = { ...TENANT, timezone: "", timezoneIsSet: false };

    // 07:05 UTC.
    await service.sweepTenant(tenant, new Date("2026-09-17T07:05:00Z"));

    expect(sends(db)[0]).toMatchObject({
      time_zone: "UTC",
      due_at: "2026-09-17T07:00:00.000Z",
    });
    expect(gmail.sendEmail.mock.calls[0][0].text).toMatch(
      /has not set its time zone, so 07:00 is read in UTC/,
    );
  });

  it("refuses to send without a public origin for the unsubscribe link", async () => {
    const { db, service, gmail } = build({
      env: { API_PUBLIC_URL: undefined },
    });
    await expect(service.sweepTenant(TENANT, DUE_PLUS_5)).rejects.toThrow(
      /API_PUBLIC_URL is not set/,
    );
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(sends(db)).toHaveLength(0);
  });

  it("will not put an address that could become a second header on a To: line", async () => {
    const db = seed();
    db.tables.users.find((u) => u.user_id === ANA)!.email =
      "ana@house.test\r\nBcc: all@elsewhere.test";
    const { service, gmail } = build({ db });
    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(tally.noAddress).toBe(1);
  });
});

/* ── cadence ──────────────────────────────────────────────────────────────── */

describe("the person's frequency, on the house's clock", () => {
  it("weekly on Thursday sends on Thursday and not on Friday", async () => {
    const db = seed();
    Object.assign(db.tables.recommendation_digest_subscriptions[0], {
      frequency: "weekly",
      weekday: 4,
    });
    const { service, gmail } = build({ db });

    await service.sweepTenant(TENANT, DUE_PLUS_5); // Thursday
    await service.sweepTenant(TENANT, new Date("2026-09-18T04:05:00Z")); // Friday

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(sends(db).map((r) => [r.period_key, r.frequency])).toEqual([
      ["2026-09-17", "weekly"],
    ]);
  });

  it("a subscription made after a due that is now past the late limit leaves no expired row — a miss for a mail nobody owed", async () => {
    const db = seed();
    Object.assign(db.tables.recommendation_digest_subscriptions[0], {
      subscribed_at: "2026-09-17T12:00:00Z",
      updated_at: "2026-09-17T12:00:00Z",
    });
    const { service, gmail } = build({ db });

    // 20:00 Istanbul: 13h after the 07:00 due, which predates the subscription.
    const tally = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T17:00:00Z"),
    );

    expect(tally.lateBeforeChange).toBe(1);
    expect(tally.expired).toBe(0);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(sends(db)).toHaveLength(0);
  });

  it("a subscription made inside the late limit is served that period's digest at the next sweep — a save after the due never cancels a timely one", async () => {
    const db = seed();
    Object.assign(db.tables.recommendation_digest_subscriptions[0], {
      subscribed_at: "2026-09-17T06:00:00Z", // 09:00 Istanbul, after the 07:00 due
      updated_at: "2026-09-17T06:00:00Z",
    });
    const { service, gmail } = build({ db });

    const tally = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T06:05:00Z"),
    );

    expect(tally.sent).toBe(1);
    expect(tally.lateBeforeChange).toBe(0);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(sends(db)[0]).toMatchObject({
      period_key: "2026-09-17",
      outcome: "sent",
    });
  });

  it("a house whose digest is off sends nothing and writes nothing", async () => {
    const db = seed();
    db.tables.recommendation_digest_prefs[0].digest_enabled = false;
    const { service, gmail } = build({ db });
    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(tally.house).toBe("off");
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(db.writes).toHaveLength(0);
  });
});

/* ── a save after the due time (review D1) ────────────────────────────────── */

describe("saving the house's digest row or a subscription after the due time does not cancel that period's digest", () => {
  it("P-B: the house row re-saved at 07:02 Istanbul (04:02Z) — the 07:05 sweep still sends, and a later sweep does not send twice", async () => {
    const db = seed();
    Object.assign(db.tables.recommendation_digest_prefs[0], {
      recipient_email: "changed@elsewhere.test",
      updated_at: "2026-09-17T04:02:00Z",
    });
    const { service, gmail } = build({ db });

    const first = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(first.sent).toBe(1);
    expect(first.lateBeforeChange).toBe(0);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(gmail.sendEmail.mock.calls[0][0].to).toEqual(["ana@house.test"]);

    const later = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T15:00:00Z"),
    );
    expect(later.alreadyHandled).toBe(1);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(sends(db)).toHaveLength(1);
    expect(sends(db)[0].outcome).toBe("sent");
  });

  it("P-E: a member deferred by quiet hours who re-saves the same daily subscription at 07:30 is served at 08:05 — and the re-save writes nothing", async () => {
    const db = seed();
    db.tables.notification_preferences = [
      {
        user_id: ANA,
        restaurant_id: HOUSE,
        email_enabled: true,
        categories: { ai: true },
        quiet_hours_enabled: true,
        quiet_hours_start: "22:00",
        quiet_hours_end: "08:00",
      },
    ];
    const { service, gmail } = build({ db });

    const deferred = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(deferred.deferredQuietHours).toBe(1);

    const writesBefore = db.writes.length;
    await service.subscribe(
      ANA,
      HOUSE,
      { frequency: "daily" },
      new Date("2026-09-17T04:30:00Z"),
    );
    expect(
      db.writes
        .slice(writesBefore)
        .filter((w) => w.table === "recommendation_digest_subscriptions"),
    ).toHaveLength(0);
    expect(
      db
        .rows("recommendation_digest_subscriptions")
        .find((r) => r.user_id === ANA)!.updated_at,
    ).toBe("2026-09-02T10:00:00Z");

    const served = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T05:05:00Z"),
    );
    expect(served.sent).toBe(1);
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a real change of cadence after the due time still does not cancel the timely digest, and the date key keeps it to one mail that day", async () => {
    const db = seed();
    const { service, gmail } = build({ db });

    await service.subscribe(
      ANA,
      HOUSE,
      { frequency: "weekly", weekday: 4 }, // Thursday, today
      new Date("2026-09-17T04:02:00Z"),
    );
    expect(
      db
        .rows("recommendation_digest_subscriptions")
        .find((r) => r.user_id === ANA)!.updated_at,
    ).toBe("2026-09-17T04:02:00.000Z");

    await service.sweepTenant(TENANT, DUE_PLUS_5);
    await service.sweepTenant(TENANT, new Date("2026-09-17T09:00:00Z"));

    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
    expect(sends(db).map((r) => [r.period_key, r.frequency])).toEqual([
      ["2026-09-17", "weekly"],
    ]);
  });
});

/* ── membership (review D2) ───────────────────────────────────────────────── */

describe("membership is decided on every access row, revoked ones included", () => {
  it("P-A: a house whose access rows are ALL revoked has no members — the users.restaurant_id fallback does not count its revoked members back in", async () => {
    const db = seed();
    for (const r of db.tables.user_restaurant_access) r.is_active = false;
    const { service, gmail } = build({ db });

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(tally.notMembers).toBe(1);
    expect(tally.sent).toBe(0);
    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(sends(db)).toHaveLength(0);

    // …and the same ex-member cannot subscribe either.
    await expect(
      service.subscribe(BORA, HOUSE, { frequency: "daily" }, DUE_PLUS_5),
    ).rejects.toThrow(/not an active member/);
    const status = await service.statusFor(ANA, HOUSE, DUE_PLUS_5);
    expect(status.isMember).toBe(false);
    expect(status.willReceive).toBe(false);
  });

  it("a house with no access rows at all still reads its members from users.restaurant_id", async () => {
    const db = seed();
    db.tables.user_restaurant_access = [];
    const { service, gmail } = build({ db });

    const tally = await service.sweepTenant(TENANT, DUE_PLUS_5);

    expect(tally.notMembers).toBe(0);
    expect(tally.sent).toBe(1);
    expect(gmail.sendEmail.mock.calls[0][0].to).toEqual(["ana@house.test"]);
  });
});

/* ── what an expired row claims (review D4) ───────────────────────────────── */

describe("an expired row states what is known, not a cause it cannot see", () => {
  it("P-C: email off at the due time and switched on in the evening — the row names email among the possible causes and blames nothing in particular", async () => {
    const db = seed();
    db.tables.notification_preferences = [
      {
        user_id: ANA,
        restaurant_id: HOUSE,
        email_enabled: false,
        categories: { ai: true },
      },
    ];
    const { service, gmail } = build({ db });

    const atDue = await service.sweepTenant(TENANT, DUE_PLUS_5);
    expect(atDue.emailOff).toBe(1);
    expect(sends(db)).toHaveLength(0);

    db.tables.notification_preferences[0].email_enabled = true;
    const evening = await service.sweepTenant(
      TENANT,
      new Date("2026-09-17T16:15:00Z"),
    );

    expect(gmail.sendEmail).not.toHaveBeenCalled();
    expect(evening.expired).toBe(1);
    const reason: string = sends(db)[0].reason;
    expect(reason).toMatch(
      /^Not sent within 12 hours of its due time \(2026-09-17T04:00:00\.000Z\)/,
    );
    expect(reason).toMatch(/does not record which gate held it back/);
    expect(reason).toMatch(/email notifications/);
    expect(reason).toMatch(/"ai" notification category/);
    expect(reason).toMatch(/not being an active member/);
    expect(reason).toMatch(/no usable address/);
    // The retired wording asserted one of three causes as fact.
    expect(reason).not.toMatch(/the person was inside their quiet hours/);
  });
});

/* ── a failed read ────────────────────────────────────────────────────────── */

describe("a failed read is an error, never an empty audience", () => {
  it.each([
    "recommendation_digest_prefs",
    "recommendation_digest_subscriptions",
    "user_restaurant_access",
    "users",
    "notification_preferences",
  ])(
    "%s unreadable → the sweep throws, nothing is claimed or sent",
    async (table) => {
      const db = seed();
      db.failures[`${table}:select`] = "permission denied";
      const { service, gmail } = build({ db });
      await expect(service.sweepTenant(TENANT, DUE_PLUS_5)).rejects.toThrow(
        /could not be read/,
      );
      expect(gmail.sendEmail).not.toHaveBeenCalled();
      expect(sends(db)).toHaveLength(0);
    },
  );
});

/* ── the link and the person's own door ───────────────────────────────────── */

describe("the unsubscribe link works without a session, and only stops that one digest", () => {
  it("GET changes nothing; POST stops it; the next due sends nothing; a second POST says already stopped", async () => {
    const { db, service, gmail } = build();
    await service.sweepTenant(TENANT, DUE_PLUS_5);
    const token = tokenFrom(gmail.sendEmail.mock.calls[0][0]);

    expect(await service.readUnsubscribeLink(token)).toEqual({
      kind: "active",
      houseName: HOUSE_NAME,
    });
    const sub = () =>
      db
        .rows("recommendation_digest_subscriptions")
        .find((r) => r.user_id === ANA)!;
    expect(sub().unsubscribed_at).toBeNull();

    const at = new Date("2026-09-17T10:00:00Z");
    expect(await service.stopByLink(token, at)).toEqual({
      kind: "stopped",
      houseName: HOUSE_NAME,
    });
    expect(sub()).toMatchObject({
      unsubscribed_at: at.toISOString(),
      unsubscribed_via: "link",
    });
    expect(await service.stopByLink(token, at)).toEqual({
      kind: "already_stopped",
      houseName: HOUSE_NAME,
    });

    await service.sweepTenant(TENANT, new Date("2026-09-18T04:05:00Z"));
    expect(gmail.sendEmail).toHaveBeenCalledTimes(1);
  });

  it("a malformed token and an unknown token are both refused, and neither touches a row", async () => {
    const { db, service } = build();
    const before = JSON.stringify(db.tables);
    expect(await service.stopByLink("not-a-token")).toEqual({
      kind: "malformed",
    });
    expect(await service.stopByLink("a".repeat(64))).toEqual({
      kind: "unknown",
    });
    expect(JSON.stringify(db.tables)).toBe(before);
  });
});

describe("the person's own subscription (session door)", () => {
  it("records a daily subscription for a member, and states every reason it would not arrive", async () => {
    const { db, service } = build({ env: { DIGEST_SEND_ENABLED: undefined } });
    const status = await service.subscribe(
      BORA,
      HOUSE,
      { frequency: "daily" },
      DUE_PLUS_5,
    );

    expect(
      db
        .rows("recommendation_digest_subscriptions")
        .find((r) => r.user_id === BORA),
    ).toMatchObject({
      frequency: "daily",
      weekday: null,
      unsubscribed_at: null,
    });
    expect(status.subscription?.frequency).toBe("daily");
    expect(status.willReceive).toBe(false);
    expect(status.blockers.join(" ")).toMatch(/DIGEST_SEND_ENABLED is not set/);
    expect(status.nextDueAt).toBeNull();
  });

  it("with nothing in the way, says it will arrive and when", async () => {
    const { service } = build();
    const status = await service.statusFor(ANA, HOUSE, DUE_PLUS_5);
    expect(status.blockers).toEqual([]);
    expect(status.willReceive).toBe(true);
    expect(status.nextDueAt).toBe("2026-09-18T04:00:00.000Z");
    expect(status.timeZone).toEqual({ zone: ZONE, isFallback: false });
  });

  it("a house the scheduler does not serve is explained to the member in words, not as an operator's table insert", async () => {
    const { service } = build({ env: { DEFAULT_RESTAURANT_ID: "another" } });
    const status = await service.statusFor(ANA, HOUSE, DUE_PLUS_5);
    expect(status.served).toBe(false);
    expect(status.servedReason).toMatch(
      /Scheduled mail has not been switched on for this house yet/,
    );
    expect(status.blockers).toContain(status.servedReason);
    expect(status.blockers.join(" ")).not.toMatch(
      /restaurant_feature_flags|flag_name|enabled = true/,
    );
  });

  it("refuses a weekly subscription with no weekday, a daily one with a weekday, and a non-member", async () => {
    const { db, service } = build();
    await expect(
      service.subscribe(BORA, HOUSE, { frequency: "weekly" }),
    ).rejects.toThrow(/needs a weekday/);
    await expect(
      service.subscribe(BORA, HOUSE, { frequency: "daily", weekday: 2 }),
    ).rejects.toThrow(/has no weekday/);
    await expect(
      service.subscribe("user-stranger", HOUSE, { frequency: "daily" }),
    ).rejects.toThrow(/not an active member/);
    expect(db.rows("recommendation_digest_subscriptions")).toHaveLength(2);
  });

  it("a resubscription after a stop starts a new subscription rather than resurrecting the old date", async () => {
    const { db, service } = build();
    const at = new Date("2026-09-17T12:00:00Z");
    await service.subscribe(
      CEM,
      HOUSE,
      { frequency: "weekly", weekday: 1 },
      at,
    );
    expect(
      db
        .rows("recommendation_digest_subscriptions")
        .find((r) => r.user_id === CEM),
    ).toMatchObject({
      frequency: "weekly",
      weekday: 1,
      subscribed_at: at.toISOString(),
      unsubscribed_at: null,
      unsubscribed_via: null,
    });
    await service.stopForSelf(CEM, HOUSE, new Date("2026-09-17T13:00:00Z"));
    expect(
      db
        .rows("recommendation_digest_subscriptions")
        .find((r) => r.user_id === CEM),
    ).toMatchObject({
      unsubscribed_via: "settings",
    });
  });
});
