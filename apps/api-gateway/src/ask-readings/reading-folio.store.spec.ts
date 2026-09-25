import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ReadingFolioStore } from "./reading-folio.store";
import { BoundReply, notPermittedReply } from "./bound-reply";

// KL audit J7: zero specs named this store before this file. The three
// properties below are the ones ADR 0145 actually depends on -- a paid
// request never runs twice for one request id, the same request id never
// crosses tenants, and a finish is a compare-and-swap so two racing writers
// cannot both believe they saved the answer.

const HOUSE_A = "22222222-2222-4222-8222-222222222222";
const HOUSE_B = "99999999-9999-4999-8999-999999999999";
const USER = "11111111-1111-4111-8111-111111111111";

/** What `BoundAskService` snapshots at ask time (ADR 0145, 2026-09-21). */
const SNAP = { askedAsRole: "Staff", catalogueSha: "c".repeat(64), policySha: "p".repeat(64) };

const KNOWLEDGE_REPLY: BoundReply = {
  kind: "model_knowledge",
  source: "model_knowledge",
  sourceLabel: "Not from the house's books",
  text: "answer" as any,
};

/** Query double for `ask_reading_folios` only: insert (with the table's real
 * unique constraint), select/eq/maybeSingle/single, and a conditional update
 * that only matches rows whose predicates (including status) still hold --
 * so a second finish on an already-finished row updates nothing, exactly as
 * Postgres would refuse a WHERE ... AND status = 'pending' that no longer
 * matches. */
function fixture() {
  const rows: any[] = [];
  const labels: any[] = [];
  const faults = new Set<string>();
  let nextId = 0;

  const db = {
    getClient: () => ({
      from(table: string) {
        if (table === "ask_folio_labels") {
          // The labels table: an insert that stores what it is given (the
          // store's own step and scope rules are what these specs test).
          return {
            insert: (value: any) => ({
              select: () => ({
                single: async () => {
                  if (faults.has("ask_folio_labels:insert")) return { data: null, error: { message: "database unavailable" } };
                  const row = { id: `label-${labels.length}`, at: new Date().toISOString(), ...value };
                  labels.push(row);
                  return { data: structuredClone(row), error: null };
                },
              }),
            }),
          };
        }
        if (table !== "ask_reading_folios") throw new Error(`unexpected table ${table}`);
        let action: "select" | "insert" | "update" = "select";
        let payload: any;
        const filters: Array<(row: any) => boolean> = [];

        const runSelect = () => rows.filter(row => filters.every(f => f(row)));

        const query: any = {
          select: () => query,
          insert: (value: any) => {
            action = "insert";
            payload = value;
            return query;
          },
          update: (value: any) => {
            action = "update";
            payload = value;
            return query;
          },
          eq: (key: string, value: any) => {
            filters.push(row => row[key] === value);
            return query;
          },
          order: () => query,
          limit: () => query,
          maybeSingle: async () => {
            if (faults.has(`${table}:${action}`)) return { data: null, error: { message: "database unavailable" } };
            if (action === "insert") {
              const dup = rows.find(
                r => r.restaurant_id === payload.restaurant_id && r.user_id === payload.user_id && r.request_id === payload.request_id,
              );
              if (dup) return { data: null, error: { code: "23505" } };
              const row = { ...payload, id: payload.id ?? `folio-${nextId++}`, status: "pending", created_at: new Date().toISOString(), completed_at: null };
              rows.push(row);
              return { data: structuredClone(row), error: null };
            }
            if (action === "update") {
              const matched = runSelect();
              if (matched.length !== 1) return { data: null, error: null };
              Object.assign(matched[0], payload);
              return { data: structuredClone(matched[0]), error: null };
            }
            const found = runSelect();
            return { data: found[0] ? structuredClone(found[0]) : null, error: null };
          },
          single: async () => query.maybeSingle(),
          then: (resolve: any, reject: any) =>
            Promise.resolve()
              .then(() => {
                if (faults.has(`${table}:${action}`)) return { data: null, error: { message: "database unavailable" } };
                return { data: structuredClone(runSelect()), error: null };
              })
              .then(resolve, reject),
        };
        return query;
      },
    }),
  };

  return { db: db as any, rows, labels, faults };
}

function store(f: ReturnType<typeof fixture>) {
  return new ReadingFolioStore(f.db);
}

describe("ReadingFolioStore.begin: idempotent, tenant-scoped", () => {
  it("creates a new pending folio", async () => {
    const f = fixture();
    const { folio, created } = await store(f).begin({
      restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "how many bottles are open",
      origin: "page", ...SNAP,
    });
    expect(created).toBe(true);
    expect(folio.status).toBe("pending");
    expect(f.rows).toHaveLength(1);
  });

  it("replays a pending request instead of paying for it twice", async () => {
    const f = fixture();
    const s = store(f);
    const first = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "same question", origin: "page", ...SNAP });
    const second = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "same question", origin: "page", ...SNAP });
    expect(second.created).toBe(false);
    expect(second.folio.id).toBe(first.folio.id);
    expect(f.rows).toHaveLength(1); // never a second write for one request id
  });

  it("replays a COMPLETED request id too, rather than re-running an answered question", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    await s.finish(folio, KNOWLEDGE_REPLY);
    const replay = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    expect(replay.created).toBe(false);
    expect(replay.folio.status).toBe("complete");
    expect(f.rows).toHaveLength(1);
  });

  it("refuses a request id reused for a different question, rather than answering the new one under the old id", async () => {
    const f = fixture();
    const s = store(f);
    await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "first question", origin: "page", ...SNAP });
    await expect(
      s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "a different question", origin: "page", ...SNAP }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("the same request id in a DIFFERENT house is a different question, not a collision", async () => {
    const f = fixture();
    const s = store(f);
    const a = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    const b = await s.begin({ restaurantId: HOUSE_B, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.folio.id).not.toBe(b.folio.id);
  });
});

describe("ReadingFolioStore.finish: a compare-and-swap on pending", () => {
  it("a second finish on an already-complete folio does not overwrite the first answer", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });

    const firstAnswer: BoundReply = { ...KNOWLEDGE_REPLY, text: "first writer's answer" as any };
    const secondAnswer: BoundReply = { ...KNOWLEDGE_REPLY, text: "second writer's answer" as any };

    const finished = await s.finish(folio, firstAnswer);
    expect(finished.status).toBe("complete");

    // The second writer holds the SAME pending-folio object (as a racing
    // request would), so its own update predicate (status = 'pending') no
    // longer matches -- the store must read back the real row, not report
    // its own answer as saved.
    const racedFinish = await s.finish(folio, secondAnswer);
    expect((racedFinish.answer as any).text).toBe("first writer's answer");
    expect(f.rows).toHaveLength(1);
    expect((f.rows[0].answer as any).text).toBe("first writer's answer");
  });

  it("a failure reason marks the folio failed, not complete", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    const reply: BoundReply = { kind: "could_not_answer", reason: "model_unavailable" };
    const finished = await s.finish(folio, reply, undefined, "model_unavailable");
    expect(finished.status).toBe("failed");
    expect(finished.failure_reason).toBe("model_unavailable");
  });

  // Founder, batch 4, 2026-09-19 (the role gate): unlike not_built /
  // no_reading_matched / model_knowledge, a role refusal DOES name a real
  // reading -- it is decided after the question was classified, before a
  // Finding exists. A naturally-worded question never named a readingId at
  // `begin()` time (only a page-chosen one does), so without this the row
  // would record no reading id at all for a security-relevant refusal.
  it("a role refusal (not_permitted) backfills reading_id from the answer, though no Finding was ever produced -- and is complete, not failed", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "who do we buy from", origin: "page", ...SNAP });
    expect(folio.reading_id).toBeNull(); // natural-language ask: unknown until the model picks
    const reply: BoundReply = notPermittedReply("vendors.active", ["suppliers"]);
    const finished = await s.finish(folio, reply);
    expect(finished.status).toBe("complete"); // refused correctly, not an error
    expect(finished.reading_id).toBe("vendors.active");
    expect(finished.finding).toBeNull();
    // Round 6: the saved refusal carries its one-line reason, and reads back.
    expect((finished.answer as { line: string }).line).toContain("supplier orders");
    await expect(s.get(HOUSE_A, USER, folio.id)).resolves.toMatchObject({ reply_kind: "not_permitted" });
  });
});

describe("ReadingFolioStore scoping and integrity", () => {
  it("get refuses a folio that belongs to a different house", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    await expect(s.get(HOUSE_B, USER, folio.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("get refuses a folio that belongs to a different person in the SAME house", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    await expect(s.get(HOUSE_A, "someone-else", folio.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses to serve a completed folio whose stored answer no longer validates", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    await s.finish(folio, KNOWLEDGE_REPLY);
    f.rows[0].answer = { kind: "not_a_real_kind" };
    await expect(s.get(HOUSE_A, USER, folio.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

// ADR 0145, 2026-09-21 amendment (founder's option "Rules in code, label rows").
// FAILING BEFORE THIS CHANGE: `begin` wrote no role, chooser or hashes, `finish`
// wrote no pick or compose capture, and `label` did not exist.
describe("ReadingFolioStore: the ask is captured as one complete row", () => {
  it("begin snapshots the role as the token carried it, who chose the Reading, and the rule hashes", async () => {
    const f = fixture();
    const s = store(f);
    await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-2", utterance: "q", origin: "page", readingId: "orders.open", readingVersion: 1, ...SNAP, askedAsRole: null });
    expect(f.rows[0]).toMatchObject({ asked_as_role: "staff", reading_chosen_by: "model", catalogue_sha: SNAP.catalogueSha, policy_sha: SNAP.policySha });
    expect(f.rows[1]).toMatchObject({ asked_as_role: null, reading_chosen_by: "page" });
  });

  it("a replayed request id that now names a Reading is a different request, not a replay", async () => {
    const f = fixture();
    const s = store(f);
    await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    await expect(s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", readingId: "orders.open", ...SNAP }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it("finish writes the pick and compose capture with the answer", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page", ...SNAP });
    const done = await s.finish(folio, KNOWLEDGE_REPLY, undefined, undefined, {
      pickClass: "general_knowledge", pickArgs: {}, pickModel: "claude-haiku-4-5", pickPromptSha: "a".repeat(64),
      composeModel: "claude-sonnet-5", composePromptSha: "b".repeat(64),
    });
    expect(done).toMatchObject({ pick_class: "general_knowledge", pick_model: "claude-haiku-4-5", compose_model: "claude-sonnet-5", compose_prompt_sha: "b".repeat(64) });
  });
});

describe("ReadingFolioStore.label: a person labels one step of their own ask", () => {
  async function finished(f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: `req-${f.rows.length}`, utterance: "q", origin: "page", ...SNAP });
    await s.finish(folio, KNOWLEDGE_REPLY, undefined, undefined, { pickClass: "general_knowledge", pickArgs: {}, pickModel: "m", pickPromptSha: "a".repeat(64) });
    Object.assign(f.rows[f.rows.length - 1], overrides);
    return { s, folio };
  }

  it("records the step, the label, the person's role snapshot and basis person", async () => {
    const f = fixture();
    const { s, folio } = await finished(f);
    const row = await s.label(HOUSE_A, USER, "Owner", folio.id, { step: "pick", label: "incorrect", goldClass: "sales.consumption" });
    expect(row).toMatchObject({ folio_id: folio.id, restaurant_id: HOUSE_A, step: "pick", label: "incorrect", gold_class: "sales.consumption", basis: "person", labeled_by_role: "owner" });
    expect(f.labels[0].labeled_by).toBe(USER);
  });

  it("is scoped exactly like GET /ask/folios/:id: another house or another person gets not-found and nothing is written", async () => {
    const f = fixture();
    const { s, folio } = await finished(f);
    await expect(s.label(HOUSE_B, USER, "owner", folio.id, { step: "knowledge", label: "correct" })).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.label(HOUSE_A, "someone-else", "owner", folio.id, { step: "knowledge", label: "correct" })).rejects.toBeInstanceOf(NotFoundException);
    expect(f.labels).toHaveLength(0);
  });

  it("refuses a step that did not run: no compose on a knowledge answer, no books without a Finding, no pick on a page-chosen Reading", async () => {
    const f = fixture();
    const { s, folio } = await finished(f);
    await expect(s.label(HOUSE_A, USER, "owner", folio.id, { step: "compose", label: "incorrect" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.label(HOUSE_A, USER, "owner", folio.id, { step: "books", label: "incorrect" })).rejects.toBeInstanceOf(BadRequestException);
    const page = await finished(f, { reading_chosen_by: "page", pick_class: null });
    await expect(page.s.label(HOUSE_A, USER, "owner", page.folio.id, { step: "pick", label: "incorrect" })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.labels).toHaveLength(0);
  });

  it("refuses a corrected class on any step but pick, and any label on a pending ask", async () => {
    const f = fixture();
    const { s, folio } = await finished(f);
    await expect(s.label(HOUSE_A, USER, "owner", folio.id, { step: "knowledge", label: "incorrect", goldClass: "orders.open" })).rejects.toBeInstanceOf(BadRequestException);
    const pending = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-pending", utterance: "q", origin: "page", ...SNAP });
    await expect(s.label(HOUSE_A, USER, "owner", pending.folio.id, { step: "pick", label: "correct" })).rejects.toBeInstanceOf(ConflictException);
    expect(f.labels).toHaveLength(0);
  });

  it("refuses a corrected class that contradicts the label, and admits one that agrees", async () => {
    const f = fixture();
    const { s, folio } = await finished(f);
    // The pick chose general_knowledge (see `finished`).
    await expect(s.label(HOUSE_A, USER, "owner", folio.id, { step: "pick", label: "correct", goldClass: "orders.open" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(s.label(HOUSE_A, USER, "owner", folio.id, { step: "pick", label: "incorrect", goldClass: "general_knowledge" })).rejects.toBeInstanceOf(BadRequestException);
    expect(f.labels).toHaveLength(0);
    await s.label(HOUSE_A, USER, "owner", folio.id, { step: "pick", label: "correct", goldClass: "general_knowledge" });
    await s.label(HOUSE_A, USER, "owner", folio.id, { step: "pick", label: "incorrect", goldClass: "orders.open" });
    expect(f.labels.map(l => [l.label, l.gold_class])).toEqual([["correct", "general_knowledge"], ["incorrect", "orders.open"]]);
  });

  it("a label that cannot be saved is an error, never a quiet success", async () => {
    const f = fixture();
    const { s, folio } = await finished(f);
    f.faults.add("ask_folio_labels:insert");
    await expect(s.label(HOUSE_A, USER, "owner", folio.id, { step: "knowledge", label: "correct" })).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
