import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProviderIntelligenceController } from "./provider-intelligence.controller";
import { ProviderIntelligenceService } from "./provider-intelligence.service";

/**
 * Provider intelligence answered for every house at once.
 *
 * `ProviderIntelligenceController` is `@UseGuards(JwtAuthGuard)` and nothing
 * else — authentication, never authorisation. Fifteen of its seventeen reads
 * carried no restaurant clause: `provider_knowledge`, `provider_promotions`,
 * `conversation_embeddings`, `provider_conversation_sessions` and
 * `provider_sentiment_history` were queried on `provider_id` alone, or on
 * nothing at all (`promotions/active`, `promotions/expiring`,
 * `promotions/savings`, `promotions/compare`, `intelligence/compare`,
 * `intelligence/leverage`). Any signed-in account of any house read every
 * house's vendor knowledge, promotions, conversation memory, sessions and
 * sentiment, and could mark another house's knowledge fact verified.
 *
 * All five tables carry `restaurant_id NOT NULL`
 * (supabase/migrations/20260805000000_baseline_from_production.sql), so there
 * was never a technical reason for any of it.
 *
 * The rule, following ADR 0147 and PR #412: the house comes from the verified
 * token through `houseOf(user)`, a session that names no house is refused with
 * 403 rather than handed an unfiltered query, and a single row that belongs to
 * another house answers the same 404 as a row that does not exist.
 */

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROV_A = "11111111-1111-4111-8111-111111111111";
const PROV_B = "22222222-2222-4222-8222-222222222222";
const SESSION_A = "33333333-3333-4333-8333-333333333333";
const SESSION_B = "44444444-4444-4444-8444-444444444444";
const FACT_A = "55555555-5555-4555-8555-555555555555";
const FACT_B = "66666666-6666-4666-8666-666666666666";

type Row = Record<string, unknown>;

/**
 * A supabase stand-in that filters rather than records. A test that only
 * counted `.eq()` calls would pass against a clause applied to the wrong
 * column, so every operator these reads use narrows real rows and the
 * assertions are about which rows came back.
 */
function makeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const queried: string[] = [];

  const from = (table: string) => {
    queried.push(table);
    let rows = [...(tables[table] ?? [])];
    let pendingUpdate: Row | null = null;
    const q: Record<string, unknown> = {};
    const self = () => q;

    q.select = self;
    q.order = self;
    q.eq = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] === val);
      return q;
    };
    q.is = (col: string, val: unknown) => {
      rows = rows.filter((r) => r[col] == val);
      return q;
    };
    q.not = (col: string, _op: string, val: unknown) => {
      rows = rows.filter((r) => r[col] != val);
      return q;
    };
    q.in = (col: string, vals: unknown[]) => {
      rows = rows.filter((r) => vals.includes(r[col]));
      return q;
    };
    q.gt = (col: string, val: number) => {
      rows = rows.filter((r) => Number(r[col]) > val);
      return q;
    };
    q.lte = (col: string, val: string) => {
      rows = rows.filter((r) => String(r[col]) <= String(val));
      return q;
    };
    q.ilike = (col: string, pattern: string) => {
      const needle = pattern.replace(/%/g, "").toLowerCase();
      rows = rows.filter((r) => String(r[col]).toLowerCase().includes(needle));
      return q;
    };
    q.limit = (n: number) => {
      rows = rows.slice(0, n);
      return q;
    };
    q.update = (payload: Row) => {
      pendingUpdate = payload;
      return q;
    };
    const settleOne = () => {
      if (pendingUpdate) {
        for (const row of rows) Object.assign(row, pendingUpdate);
      }
      return rows[0] ?? null;
    };
    q.maybeSingle = () => Promise.resolve({ data: settleOne(), error: null });
    q.single = () => {
      const row = settleOne();
      return Promise.resolve(
        row
          ? { data: row, error: null }
          : { data: null, error: { code: "PGRST116", message: "none" } },
      );
    };
    (q as { then: typeof Promise.prototype.then }).then = (
      onFulfilled,
      onRejected,
    ) =>
      Promise.resolve({ data: rows, error: null }).then(
        onFulfilled,
        onRejected,
      );
    return q;
  };

  return { from, queried, tables };
}

const seed = () => ({
  providers: [
    {
      id: PROV_A,
      name: "House A vendor",
      restaurant_id: HOUSE_A,
      is_active: true,
      deleted_at: null,
      reliability_score: 5,
      tier: "core",
      minimum_order: 1,
      lead_time_days: 2,
    },
    {
      id: PROV_B,
      name: "House B vendor",
      restaurant_id: HOUSE_B,
      is_active: true,
      deleted_at: null,
      reliability_score: 5,
      tier: "core",
      minimum_order: 1,
      lead_time_days: 2,
    },
  ],
  provider_knowledge: [
    {
      id: FACT_A,
      provider_id: PROV_A,
      restaurant_id: HOUSE_A,
      category: "pricing",
      subcategory: null,
      label: "A list price",
      attributes: {},
      confidence: 1,
      verified: false,
      version: 1,
      previous_value: { was: 1 },
      is_active: true,
    },
    {
      id: FACT_B,
      provider_id: PROV_B,
      restaurant_id: HOUSE_B,
      category: "pricing",
      subcategory: null,
      label: "B list price",
      attributes: {},
      confidence: 1,
      verified: false,
      version: 1,
      previous_value: { was: 2 },
      is_active: true,
    },
    {
      id: "lev-a",
      provider_id: PROV_A,
      restaurant_id: HOUSE_A,
      category: "relationship",
      subcategory: "leverage_signal",
      label: "A leverage",
      attributes: {},
      is_active: true,
      previous_value: null,
    },
    {
      id: "lev-b",
      provider_id: PROV_B,
      restaurant_id: HOUSE_B,
      category: "relationship",
      subcategory: "leverage_signal",
      label: "B leverage",
      attributes: {},
      is_active: true,
      previous_value: null,
    },
    // Cross-linked: house A's provider, a row stamped with house B. Nothing in
    // the schema forbids it — `restaurant_id` is a plain NOT NULL column with
    // no composite key tying it to `providers.restaurant_id` — so the
    // per-provider aggregates filter on the house as well as the provider.
    {
      id: "fact-cross",
      provider_id: PROV_A,
      restaurant_id: HOUSE_B,
      category: "pricing",
      subcategory: null,
      label: "mis-stamped fact",
      attributes: {},
      is_active: true,
      previous_value: null,
    },
  ],
  provider_promotions: [
    {
      id: "promo-a",
      provider_id: PROV_A,
      restaurant_id: HOUSE_A,
      promo_type: "volume",
      is_active: true,
      status: "active",
      end_date: "2026-09-22",
      savings_realized: 10,
      times_used: 1,
    },
    {
      id: "promo-b",
      provider_id: PROV_B,
      restaurant_id: HOUSE_B,
      promo_type: "volume",
      is_active: true,
      status: "active",
      end_date: "2026-09-22",
      savings_realized: 990,
      times_used: 9,
    },
    {
      id: "promo-cross",
      provider_id: PROV_A,
      restaurant_id: HOUSE_B,
      promo_type: "volume",
      is_active: true,
      status: "active",
      end_date: "2026-09-22",
      savings_realized: 500,
      times_used: 5,
    },
  ],
  conversation_embeddings: [
    {
      id: "msg-a",
      provider_id: PROV_A,
      restaurant_id: HOUSE_A,
      message_text: "House A shipping terms",
      role: "provider",
      channel: "email",
      importance_score: 1,
      extracted_entities: {},
      language: "en",
      created_at: "2026-09-01",
    },
    {
      id: "msg-b",
      provider_id: PROV_B,
      restaurant_id: HOUSE_B,
      message_text: "House B shipping terms",
      role: "provider",
      channel: "email",
      importance_score: 1,
      extracted_entities: {},
      language: "en",
      created_at: "2026-09-02",
    },
  ],
  provider_conversation_sessions: [
    {
      id: SESSION_A,
      provider_id: PROV_A,
      restaurant_id: HOUSE_A,
      status: "active",
      summary: "A talks",
    },
    {
      id: SESSION_B,
      provider_id: PROV_B,
      restaurant_id: HOUSE_B,
      status: "active",
      summary: "B talks",
    },
  ],
  provider_sentiment_history: [
    {
      id: "sent-a",
      provider_id: PROV_A,
      restaurant_id: HOUSE_A,
      sentiment: "warm",
      sentiment_score: 0.4,
      detected_emotions: null,
      trigger_context: null,
      created_at: "2026-09-01",
    },
    {
      id: "sent-b",
      provider_id: PROV_B,
      restaurant_id: HOUSE_B,
      sentiment: "cold",
      sentiment_score: -0.9,
      detected_emotions: null,
      trigger_context: null,
      created_at: "2026-09-02",
    },
    {
      id: "sent-cross",
      provider_id: PROV_A,
      restaurant_id: HOUSE_B,
      sentiment: "cold",
      sentiment_score: -0.9,
      detected_emotions: null,
      trigger_context: null,
      created_at: "2026-09-03",
    },
  ],
});

function controllerFor(supabase: { from: (t: string) => unknown }) {
  return new ProviderIntelligenceController(
    new ProviderIntelligenceService({ supabase } as never),
    { supabase } as never,
  );
}

const userA = { userId: "user-a", restaurantId: HOUSE_A };
const noHouse = { userId: "user-a", restaurantId: null };

function setup() {
  const supabase = makeSupabase(seed());
  return { supabase, controller: controllerFor(supabase) };
}

describe("provider intelligence answers only for the caller's house", () => {
  it("knowledge: house A reads its own fact and not house B's", async () => {
    const { controller } = setup();

    const mine = await controller.getKnowledge(PROV_A, undefined, userA);
    expect(mine.pricing.map((f: { label: string }) => f.label)).toEqual([
      "A list price",
    ]);

    const theirs = await controller.getKnowledge(PROV_B, undefined, userA);
    expect(theirs).toEqual({});
  });

  it("contradictions: house B's provider yields nothing to house A", async () => {
    const { controller } = setup();

    await expect(
      controller.getContradictions(PROV_A, userA),
    ).resolves.toHaveLength(1);
    await expect(controller.getContradictions(PROV_B, userA)).resolves.toEqual(
      [],
    );
  });

  it("verify: house A cannot verify house B's fact, and does not change it", async () => {
    const { controller, supabase } = setup();

    await expect(
      controller.verifyKnowledge(FACT_B, userA),
    ).rejects.toBeInstanceOf(NotFoundException);

    const bRow = supabase.tables.provider_knowledge.find(
      (r) => r.id === FACT_B,
    );
    expect(bRow?.verified).toBe(false);
    expect(bRow?.verified_by).toBeUndefined();
  });

  it("verify: house A verifies its own fact, recorded against the token's userId", async () => {
    const { controller, supabase } = setup();

    await expect(
      controller.verifyKnowledge(FACT_A, userA),
    ).resolves.toBeTruthy();

    const aRow = supabase.tables.provider_knowledge.find(
      (r) => r.id === FACT_A,
    );
    expect(aRow?.verified).toBe(true);
    // ADR 0147 fault 3: `JwtStrategy.validate` returns `userId`, never `id`,
    // so the old `user.id` wrote undefined here on every verification.
    expect(aRow?.verified_by).toBe("user-a");
  });

  it("promotions by provider: house B's promotions are invisible to house A", async () => {
    const { controller } = setup();

    await expect(
      controller.getPromotions(PROV_A, undefined, userA),
    ).resolves.toEqual([expect.objectContaining({ id: "promo-a" })]);
    await expect(
      controller.getPromotions(PROV_B, undefined, userA),
    ).resolves.toEqual([]);
  });

  it("promotions/active lists only this house's promotions", async () => {
    const { controller } = setup();

    const rows = await controller.getAllActivePromotions(userA);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["promo-a"]);
  });

  it("promotions/expiring lists only this house's promotions", async () => {
    const { controller } = setup();

    const rows = await controller.getExpiringPromotions("3650", userA);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["promo-a"]);
  });

  it("promotions/savings totals only this house's savings", async () => {
    const { controller } = setup();

    const savings = await controller.getPromoSavings(userA);
    expect(savings.totalSavings).toBe(10);
    expect(savings.byProvider).toHaveLength(1);
  });

  it("promotions/compare groups only this house's promotions", async () => {
    const { controller } = setup();

    const byType = await controller.comparePromotions(userA);
    expect(byType.volume.map((p: { id: string }) => p.id)).toEqual(["promo-a"]);
  });

  it("conversation memory: house B's messages never reach house A", async () => {
    const { controller } = setup();

    await expect(
      controller.getConversationMemory(PROV_A, undefined, userA),
    ).resolves.toEqual([expect.objectContaining({ id: "msg-a" })]);
    await expect(
      controller.getConversationMemory(PROV_B, undefined, userA),
    ).resolves.toEqual([]);
  });

  it("conversation search: a term that matches both houses returns one house", async () => {
    const { controller } = setup();

    const hits = await controller.searchConversationMemory(
      PROV_A,
      { query: "shipping terms" },
      userA,
    );
    expect(hits.map((h: { id: string }) => h.id)).toEqual(["msg-a"]);

    await expect(
      controller.searchConversationMemory(
        PROV_B,
        { query: "shipping terms" },
        userA,
      ),
    ).resolves.toEqual([]);
  });

  it("sessions: house B's sessions are invisible to house A", async () => {
    const { controller } = setup();

    await expect(
      controller.getSessions(PROV_A, undefined, userA),
    ).resolves.toEqual([expect.objectContaining({ id: SESSION_A })]);
    await expect(
      controller.getSessions(PROV_B, undefined, userA),
    ).resolves.toEqual([]);
  });

  it("session summary: another house's session id is 404, the same as a missing one", async () => {
    const { controller } = setup();

    await expect(
      controller.getSessionSummary(SESSION_B, userA),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getSessionSummary("no-such-session", userA),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      controller.getSessionSummary(SESSION_A, userA),
    ).resolves.toMatchObject({ id: SESSION_A });
  });

  it("sentiment: house A's trend is built from house A's rows alone", async () => {
    const { controller } = setup();

    const mine = await controller.getSentimentTrend(PROV_A, undefined, userA);
    expect(mine.dataPoints).toHaveLength(1);
    expect(mine.averageScore).toBeCloseTo(0.4);

    const theirs = await controller.getSentimentTrend(PROV_B, undefined, userA);
    expect(theirs.dataPoints).toEqual([]);
  });

  it("intelligence/compare: naming another house's provider id returns nothing", async () => {
    const { controller } = setup();

    await expect(controller.compareProviders(PROV_B, userA)).resolves.toEqual(
      [],
    );

    const mine = await controller.compareProviders(undefined, userA);
    expect(mine.map((p: { id: string }) => p.id)).toEqual([PROV_A]);
    // The aggregates are counted per house too, not just the provider list.
    expect(mine[0].activePromoCount).toBe(1);
    expect(mine[0].knowledgeEntries).toBe(2);
    expect(mine[0].avgSentiment).toBeCloseTo(0.4);
  });

  it("a row stamped with another house is not counted for this house's provider", async () => {
    // Without the house clause on each per-provider aggregate, the three
    // cross-linked rows above would be counted into house A's comparison even
    // though the provider list itself is correctly scoped.
    const { controller } = setup();

    const [mine] = await controller.compareProviders(PROV_A, userA);
    expect(mine.activePromoCount).toBe(1);
    expect(mine.knowledgeEntries).toBe(2);
    expect(mine.avgSentiment).toBeCloseTo(0.4);
  });

  it("intelligence/leverage returns only this house's signals", async () => {
    const { controller } = setup();

    const signals = await controller.getLeverageSignals(userA);
    expect(signals.map((s: { label: string }) => s.label)).toEqual([
      "A leverage",
    ]);
  });
});

/**
 * Fail closed. A sibling controller's list and stats routes used to fail OPEN
 * for a session that named no house — no house meant no filter meant every
 * house. Every route here is listed, so a route added later without a house is
 * a missing entry in this table rather than a silent hole.
 */
describe("a session that names no house is refused on every route", () => {
  const routes: Array<
    [string, (c: ProviderIntelligenceController) => unknown]
  > = [
    ["GET :id/knowledge", (c) => c.getKnowledge(PROV_A, undefined, noHouse)],
    [
      "GET :id/knowledge/contradictions",
      (c) => c.getContradictions(PROV_A, noHouse),
    ],
    [
      "PUT :id/knowledge/:knowledgeId/verify",
      (c) => c.verifyKnowledge(FACT_A, noHouse),
    ],
    ["GET :id/promotions", (c) => c.getPromotions(PROV_A, undefined, noHouse)],
    ["GET promotions/active", (c) => c.getAllActivePromotions(noHouse)],
    [
      "GET promotions/expiring",
      (c) => c.getExpiringPromotions(undefined, noHouse),
    ],
    ["GET promotions/compare", (c) => c.comparePromotions(noHouse)],
    ["GET promotions/savings", (c) => c.getPromoSavings(noHouse)],
    [
      "GET :id/conversation-memory",
      (c) => c.getConversationMemory(PROV_A, undefined, noHouse),
    ],
    [
      "POST :id/conversation-memory/search",
      (c) => c.searchConversationMemory(PROV_A, { query: "shipping" }, noHouse),
    ],
    ["GET :id/sessions", (c) => c.getSessions(PROV_A, undefined, noHouse)],
    [
      "GET :id/sessions/:sessionId/summary",
      (c) => c.getSessionSummary(SESSION_A, noHouse),
    ],
    [
      "GET :id/sentiment",
      (c) => c.getSentimentTrend(PROV_A, undefined, noHouse),
    ],
    ["GET intelligence/compare", (c) => c.compareProviders(undefined, noHouse)],
    ["GET intelligence/leverage", (c) => c.getLeverageSignals(noHouse)],
  ];

  it("covers all fifteen unscoped reads", () => {
    expect(routes).toHaveLength(15);
  });

  it.each(routes)("%s is 403 and touches no table", async (_name, call) => {
    const { controller, supabase } = setup();

    await expect(call(controller)).rejects.toBeInstanceOf(ForbiddenException);
    expect(supabase.queried).toEqual([]);
  });

  it("an empty-string house is refused too, never passed through as a filter", async () => {
    const { controller, supabase } = setup();

    await expect(
      controller.getAllActivePromotions({ userId: "u", restaurantId: "" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(supabase.queried).toEqual([]);
  });
});
