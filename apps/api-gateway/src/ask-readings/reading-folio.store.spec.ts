import { ConflictException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ReadingFolioStore } from "./reading-folio.store";
import { BoundReply } from "./bound-reply";

// KL audit J7: zero specs named this store before this file. The three
// properties below are the ones ADR 0145 actually depends on -- a paid
// request never runs twice for one request id, the same request id never
// crosses tenants, and a finish is a compare-and-swap so two racing writers
// cannot both believe they saved the answer.

const HOUSE_A = "22222222-2222-4222-8222-222222222222";
const HOUSE_B = "99999999-9999-4999-8999-999999999999";
const USER = "11111111-1111-4111-8111-111111111111";

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
  const faults = new Set<string>();
  let nextId = 0;

  const db = {
    getClient: () => ({
      from(table: string) {
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

  return { db: db as any, rows, faults };
}

function store(f: ReturnType<typeof fixture>) {
  return new ReadingFolioStore(f.db);
}

describe("ReadingFolioStore.begin: idempotent, tenant-scoped", () => {
  it("creates a new pending folio", async () => {
    const f = fixture();
    const { folio, created } = await store(f).begin({
      restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "how many bottles are open",
      origin: "page",
    });
    expect(created).toBe(true);
    expect(folio.status).toBe("pending");
    expect(f.rows).toHaveLength(1);
  });

  it("replays a pending request instead of paying for it twice", async () => {
    const f = fixture();
    const s = store(f);
    const first = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "same question", origin: "page" });
    const second = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "same question", origin: "page" });
    expect(second.created).toBe(false);
    expect(second.folio.id).toBe(first.folio.id);
    expect(f.rows).toHaveLength(1); // never a second write for one request id
  });

  it("replays a COMPLETED request id too, rather than re-running an answered question", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    await s.finish(folio, KNOWLEDGE_REPLY);
    const replay = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    expect(replay.created).toBe(false);
    expect(replay.folio.status).toBe("complete");
    expect(f.rows).toHaveLength(1);
  });

  it("refuses a request id reused for a different question, rather than answering the new one under the old id", async () => {
    const f = fixture();
    const s = store(f);
    await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "first question", origin: "page" });
    await expect(
      s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "a different question", origin: "page" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("the same request id in a DIFFERENT house is a different question, not a collision", async () => {
    const f = fixture();
    const s = store(f);
    const a = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    const b = await s.begin({ restaurantId: HOUSE_B, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.folio.id).not.toBe(b.folio.id);
  });
});

describe("ReadingFolioStore.finish: a compare-and-swap on pending", () => {
  it("a second finish on an already-complete folio does not overwrite the first answer", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });

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
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    const reply: BoundReply = { kind: "could_not_answer", reason: "model_unavailable" };
    const finished = await s.finish(folio, reply, undefined, "model_unavailable");
    expect(finished.status).toBe("failed");
    expect(finished.failure_reason).toBe("model_unavailable");
  });
});

describe("ReadingFolioStore scoping and integrity", () => {
  it("get refuses a folio that belongs to a different house", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    await expect(s.get(HOUSE_B, USER, folio.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("get refuses a folio that belongs to a different person in the SAME house", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    await expect(s.get(HOUSE_A, "someone-else", folio.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("refuses to serve a completed folio whose stored answer no longer validates", async () => {
    const f = fixture();
    const s = store(f);
    const { folio } = await s.begin({ restaurantId: HOUSE_A, userId: USER, requestId: "req-1", utterance: "q", origin: "page" });
    await s.finish(folio, KNOWLEDGE_REPLY);
    f.rows[0].answer = { kind: "not_a_real_kind" };
    await expect(s.get(HOUSE_A, USER, folio.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
