import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { IdentityService } from "./identity.service";
import { VendorIntelController } from "./vendor-intel.controller";

/**
 * A decision on a shared register names the house that took it.
 *
 * ADR 0149 answer 17, the founder 2026-09-16: *"A new nullable deciding-house
 * column; the person's name and undo only inside that house."* (ADR 0124
 * addendum; ADR 0147 "Named and not fixed", faults 1 and 2.)
 *
 * Before this, a candidate with no house (a `price_index_postings` row every
 * house reads) was logged with `restaurant_id` NULL and nothing else, so:
 *   - any house's manager could undo another house's decision on it, clearing
 *     a link that changes every house's price ladder; and
 *   - every house read the deciding person's name (or email).
 *
 * TWO HOUSES, ONE STORE. The fake below is a small in-memory PostgREST: rows
 * persist across calls, `select` projects ONLY the columns the service names
 * (so a column the service forgets to read is absent, exactly as in
 * production), `or("restaurant_id.is.null,restaurant_id.eq.X")` filters for
 * real, and the decision log refuses UPDATE and DELETE the way its trigger
 * does. Every call goes through `VendorIntelController` and the real
 * `IdentityService`, with the house taken from the token object the guard
 * would have built.
 */

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function makeStore(seed: Tables) {
  const tables: Tables = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let seq = 0;

  const from = (table: string) => {
    tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let columns: string[] | null = null;
    let mode: "select" | "update" | "delete" = "select";
    let patch: Row = {};
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;

    const project = (r: Row) => {
      if (!columns) return { ...r };
      const out: Row = {};
      for (const c of columns) out[c] = r[c] === undefined ? null : r[c];
      return out;
    };
    const matching = () => tables[table].filter((r) => filters.every((f) => f(r)));

    const run = () => {
      if (mode === "update" || mode === "delete") {
        if (table === "beverage_identity_decisions") {
          return {
            data: null,
            error: {
              message: `beverage_identity_decisions is append-only: ${mode.toUpperCase()} is not permitted.`,
            },
          };
        }
        // Filter, then write, in one synchronous step: the row-lock-and-recheck
        // Postgres does for a conditional UPDATE. `.select()` returns the rows
        // it touched, as PostgREST's return=representation does.
        const hit = matching();
        if (mode === "update") hit.forEach((r) => Object.assign(r, patch));
        else tables[table] = tables[table].filter((r) => !hit.includes(r));
        return { data: columns ? hit.map(project) : null, error: null };
      }
      let rows = matching();
      if (order) {
        const { col, asc } = order;
        rows = [...rows].sort((a, b) =>
          a[col] === b[col] ? 0 : (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1),
        );
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return { data: rows.map(project), error: null };
    };

    const b: any = {
      select: (cols?: string) => {
        if (cols) columns = cols.split(",").map((c) => c.trim());
        return b;
      },
      eq: (col: string, val: any) => {
        filters.push((r) => r[col] === val);
        return b;
      },
      or: (clause: string) => {
        const parts = clause.split(",").map((p) => {
          const [col, op, ...rest] = p.split(".");
          const val = rest.join(".");
          if (op === "is" && val === "null") return (r: Row) => r[col] == null;
          if (op === "eq") return (r: Row) => r[col] === val;
          throw new Error(`fake store: unsupported or() part ${p}`);
        });
        filters.push((r) => parts.some((f) => f(r)));
        return b;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        order = { col, asc: opts?.ascending !== false };
        return b;
      },
      limit: (n: number) => {
        limit = n;
        return b;
      },
      update: (p: Row) => {
        mode = "update";
        patch = p;
        return b;
      },
      delete: () => {
        mode = "delete";
        return b;
      },
      maybeSingle: async () => {
        const rows = matching();
        return { data: rows[0] ? project(rows[0]) : null, error: null };
      },
      insert: (payload: Row) => {
        seq += 1;
        // A uuid, because the undo route refuses anything else as a decision id.
        const row = { id: `dddddddd-0000-4000-8000-${String(seq).padStart(12, "0")}`, ...payload };
        tables[table].push(row);
        return {
          select: (cols: string) => ({
            single: async () => {
              columns = cols.split(",").map((c) => c.trim());
              return { data: project(row), error: null };
            },
          }),
        };
      },
      upsert: (payload: Row) => {
        tables[table].push({ id: `eeeeeeee-0000-4000-8000-${String(++seq).padStart(12, "0")}`, ...payload });
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  };

  return { tables, supabase: { from } };
}

const HOUSE_1 = "11111111-1111-4111-8111-111111111111";
const HOUSE_2 = "22222222-2222-4222-8222-222222222222";
const CAND_PUB = "c0000000-0000-4000-8000-000000000001";
const CAND_H1 = "c0000000-0000-4000-8000-000000000002";
const LEGACY_PUB = "d0000000-0000-4000-8000-000000000001";
const LEGACY_H1 = "d0000000-0000-4000-8000-000000000002";

// The token objects JwtStrategy.validate builds. `restaurantId` is the active house.
const AYLIN = { userId: "u-aylin", name: "Aylin", email: "aylin@one.test", role: "staff", restaurantId: HOUSE_1 };
const DENIZ = { userId: "u-deniz", name: "Deniz", email: "deniz@one.test", role: "manager", restaurantId: HOUSE_1 };
const MERT = { userId: "u-mert", name: "Mert", email: "mert@two.test", role: "staff", restaurantId: HOUSE_2 };
const SELIN = { userId: "u-selin", name: "Selin", email: "selin@two.test", role: "manager", restaurantId: HOUSE_2 };

function seed(extra: Partial<Tables> = {}): Tables {
  return {
    beverage_identities: [
      { id: "ident-1", display_label: "Krug Vintage Brut 2008 (750ml)", identity_key: "k1", standing: "library" },
    ],
    beverage_identity_candidates: [
      // A shared-register candidate: no house, every house reads it.
      {
        id: CAND_PUB,
        subject_table: "price_index_postings",
        subject_id: "post-1",
        restaurant_id: null,
        identity_id: "ident-1",
        method: "normalised_key",
        confidence: 0.92,
        evidence: { producer: "krug" },
        status: "pending",
        created_at: "2026-09-16T08:00:00Z",
      },
      // House one's own candidate.
      {
        id: CAND_H1,
        subject_table: "restaurant_inventory",
        subject_id: "inv-1",
        restaurant_id: HOUSE_1,
        identity_id: "ident-1",
        method: "normalised_key",
        confidence: 0.9,
        evidence: {},
        status: "pending",
        created_at: "2026-09-16T08:00:00Z",
      },
    ],
    beverage_identity_decisions: [],
    price_index_postings: [{ id: "post-1", identity_id: null }],
    restaurant_inventory: [{ id: "inv-1", restaurant_id: HOUSE_1, identity_id: null }],
    ...extra,
  } as Tables;
}

function makeApp(tables: Tables = seed()) {
  const store = makeStore(tables);
  const identity = new IdentityService({ supabase: store.supabase } as any);
  const controller = new VendorIntelController(
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    identity,
  );
  const log = async (user: { restaurantId: string }) =>
    ((await controller.identityDecisions(user, "50")) as any).items as any[];
  const decide = (user: any, candidateId: string, decision: "confirmed" | "rejected", extra: object = {}) =>
    controller.identityDecide(user, { candidateId, decision, ...extra } as any);
  const undo = (user: any, decisionId: string) =>
    controller.identityUndo(user, { decisionId } as any);
  const decisions = () => store.tables.beverage_identity_decisions;
  const posting = () => store.tables.price_index_postings[0];
  const candidate = (id: string) =>
    store.tables.beverage_identity_candidates.find((c) => c.id === id)!;
  return { store, controller, log, decide, undo, decisions, posting, candidate };
}

/** Every value a leaked person could appear as. */
const PERSON_TRACES = [/Aylin/, /aylin@one\.test/, /u-aylin/, /Deniz/, /deniz@one\.test/, /u-deniz/];

describe("a shared-register decision names the house that took it", () => {
  it("records the token's active house, and ignores a house the body names", async () => {
    const app = makeApp();
    await app.decide(AYLIN, CAND_PUB, "confirmed", { restaurantId: HOUSE_2 });

    expect(app.decisions()).toHaveLength(1);
    const row = app.decisions()[0];
    expect(row.restaurant_id).toBeNull();
    expect(row.deciding_restaurant_id).toBe(HOUSE_1);
    // The Q2 capability is kept: staff of any house may still decide a shared row.
    expect(app.posting().identity_id).toBe("ident-1");
  });

  it("records the house on a house row too, and on the undo row", async () => {
    const app = makeApp();
    const d = (await app.decide(AYLIN, CAND_H1, "confirmed")) as any;
    await app.undo(DENIZ, d.decisionId);
    expect(app.decisions().map((r) => r.deciding_restaurant_id)).toEqual([HOUSE_1, HOUSE_1]);
  });
});

describe("the deciding house reads the person; another house reads the outcome and when", () => {
  it("shows the name inside the deciding house", async () => {
    const app = makeApp();
    await app.decide(AYLIN, CAND_PUB, "confirmed", { note: "same cuvee, same bottle" });

    const [mine] = await app.log(DENIZ);
    expect(mine.decided_by_label).toBe("Aylin");
    expect(mine.decided_by).toBe("u-aylin");
    expect(mine.decided_by_role).toBe("staff");
    expect(mine.note).toBe("same cuvee, same bottle");
    expect(mine.decided_in).toBe("this_house");
    expect(mine.person_shown).toBe(true);
    expect(mine.undo_refusal).toBeNull();
  });

  it("hides the person, the role and the note from another house, and keeps the outcome and when", async () => {
    const app = makeApp();
    await app.decide(AYLIN, CAND_PUB, "confirmed", { note: "Aylin checked the label" });
    const stored = app.decisions()[0];

    const [theirs] = await app.log(SELIN);
    expect(theirs.id).toBe(stored.id);
    expect(theirs.action).toBe("confirmed");
    expect(theirs.decided_at).toBe(stored.decided_at);
    expect(theirs.link_written).toBe("price_index_postings.identity_id");
    expect(theirs.decided_by).toBeNull();
    expect(theirs.decided_by_label).toBeNull();
    expect(theirs.decided_by_role).toBeNull();
    expect(theirs.note).toBeNull();
    expect(theirs.decided_in).toBe("another_house");
    expect(theirs.person_shown).toBe(false);
    expect(theirs.undo_refusal).toMatch(/taken in another house/);
    // Neither the person nor which house it was leaves in any field.
    const wire = JSON.stringify(theirs);
    for (const trace of PERSON_TRACES) expect(wire).not.toMatch(trace);
    expect(wire).not.toContain(HOUSE_1);
  });
});

describe("only the deciding house may take a shared decision back", () => {
  it("refuses another house's manager with a readable 403, and clears nothing", async () => {
    const app = makeApp();
    const d = (await app.decide(AYLIN, CAND_PUB, "confirmed")) as any;

    const refusal = await app.undo(SELIN, d.decisionId).catch((e) => e);
    expect(refusal).toBeInstanceOf(ForbiddenException);
    expect(refusal.getStatus()).toBe(403);
    expect(refusal.message).toMatch(/taken in another house/);
    // Owners may undo too (and the legacy admin alias), so the sentence names both.
    expect(refusal.message).toMatch(/Only an owner or manager of the house that took it/);

    expect(app.posting().identity_id).toBe("ident-1");
    expect(app.decisions()).toHaveLength(1);
    expect(app.candidate(CAND_PUB).status).toBe("confirmed");
  });

  it("lets the deciding house's manager undo it; the other house then sees the undo without the person", async () => {
    const app = makeApp();
    const d = (await app.decide(AYLIN, CAND_PUB, "confirmed")) as any;

    const out = (await app.undo(DENIZ, d.decisionId)) as any;
    expect(out.linkCleared).toBe("price_index_postings.identity_id cleared");
    expect(app.posting().identity_id).toBeNull();
    expect(app.candidate(CAND_PUB).status).toBe("pending");

    const theirs = await app.log(MERT);
    const undoRow = theirs.find((r) => r.action === "undone")!;
    expect(undoRow.undoes_decision_id).toBe(d.decisionId);
    expect(undoRow.decided_by_label).toBeNull();
    expect(undoRow.decided_in).toBe("another_house");
  });

  it("after the undo, the other house may decide afresh, and owns that decision alone", async () => {
    const app = makeApp();
    const first = (await app.decide(AYLIN, CAND_PUB, "confirmed")) as any;
    await app.undo(DENIZ, first.decisionId);

    const second = (await app.decide(MERT, CAND_PUB, "rejected")) as any;
    const two = (await app.log(SELIN)).find((r) => r.id === second.decisionId)!;
    expect(two.decided_by_label).toBe("Mert");
    expect(two.decided_in).toBe("this_house");
    const one = (await app.log(DENIZ)).find((r) => r.id === second.decisionId)!;
    expect(one.decided_by_label).toBeNull();

    await expect(app.undo(DENIZ, second.decisionId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(app.undo(SELIN, second.decisionId)).resolves.toBeDefined();
  });
});

describe("a shared decision logged before the deciding house was recorded", () => {
  const legacy = () =>
    seed({
      beverage_identity_decisions: [
        {
          id: LEGACY_PUB,
          candidate_id: CAND_PUB,
          restaurant_id: null,
          // No deciding_restaurant_id: the column did not exist when this was written.
          action: "confirmed",
          decided_by: "u-aylin",
          decided_by_label: "Aylin",
          decided_by_role: "staff",
          decided_at: "2026-09-10T09:00:00Z",
          evidence_shown: {},
          note: "legacy note",
          link_written: "price_index_postings.identity_id",
          undoes_decision_id: null,
        },
      ],
      price_index_postings: [{ id: "post-1", identity_id: "ident-1" }],
    });

  it("hides the person from EVERY house, including the one that may have taken it", async () => {
    const app = makeApp(legacy());
    for (const reader of [DENIZ, SELIN]) {
      const [row] = await app.log(reader);
      expect(row.id).toBe(LEGACY_PUB);
      expect(row.action).toBe("confirmed");
      expect(row.decided_at).toBe("2026-09-10T09:00:00Z");
      expect(row.decided_by_label).toBeNull();
      expect(row.note).toBeNull();
      expect(row.decided_in).toBe("unrecorded");
      expect(row.person_shown).toBe(false);
      expect(row.undo_refusal).toMatch(/before Mudavym recorded which house/);
      for (const trace of PERSON_TRACES) expect(JSON.stringify(row)).not.toMatch(trace);
    }
  });

  it("refuses its undo to every house with a reason, and clears nothing", async () => {
    const app = makeApp({
      ...legacy(),
      beverage_identity_candidates: seed().beverage_identity_candidates.map((c) =>
        c.id === CAND_PUB ? { ...c, status: "confirmed" } : c,
      ),
    });
    for (const manager of [DENIZ, SELIN]) {
      const refusal = await app.undo(manager, LEGACY_PUB).catch((e) => e);
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal.message).toMatch(/before Mudavym recorded which house/);
      expect(refusal.message).toMatch(/no house may take it back/);
      // Not a claim that no operator gate exists anywhere: one does
      // (PLATFORM_ADMIN_USER_IDS), and it was deliberately not extended.
      expect(refusal.message).not.toMatch(/platform-operator/);
    }
    expect(app.posting().identity_id).toBe("ident-1");
    expect(app.decisions()).toHaveLength(1);
  });
});

describe("a house's own rows are unchanged", () => {
  const legacyHouseRow = () =>
    seed({
      beverage_identity_decisions: [
        {
          id: LEGACY_H1,
          candidate_id: CAND_H1,
          restaurant_id: HOUSE_1,
          action: "confirmed",
          decided_by: "u-aylin",
          decided_by_label: "Aylin",
          decided_by_role: "staff",
          decided_at: "2026-09-10T09:00:00Z",
          evidence_shown: {},
          note: null,
          link_written: "restaurant_inventory.identity_id",
          undoes_decision_id: null,
        },
      ],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: HOUSE_1, identity_id: "ident-1" }],
    });

  it("a house row logged before the column still names the person inside its house, and never reaches another", async () => {
    const app = makeApp(legacyHouseRow());
    const [mine] = await app.log(DENIZ);
    expect(mine.decided_by_label).toBe("Aylin");
    expect(mine.decided_in).toBe("this_house");
    expect(mine.undo_refusal).toBeNull();
    expect(await app.log(SELIN)).toHaveLength(0);
  });

  it("its house's manager may still undo it; another house's gets the answer a missing id gets", async () => {
    const app = makeApp(legacyHouseRow());
    // ADR 0147: a row that is not the caller's is a 404, the same answer as a
    // row that does not exist. That row is never in house two's log, so a 403
    // would tell house two the id exists.
    const theirs = await app.undo(SELIN, LEGACY_H1).catch((e) => e);
    const missing = await app
      .undo(SELIN, "dddddddd-0000-4000-8000-999999999999")
      .catch((e) => e);
    expect(theirs).toBeInstanceOf(NotFoundException);
    expect(theirs.getStatus()).toBe(404);
    expect(missing).toBeInstanceOf(NotFoundException);
    expect(theirs.getResponse()).toEqual(missing.getResponse());
    expect(app.store.tables.restaurant_inventory[0].identity_id).toBe("ident-1");
    expect(app.decisions()).toHaveLength(1);

    const out = (await app.undo(DENIZ, LEGACY_H1)) as any;
    expect(out.linkCleared).toBe("restaurant_inventory.identity_id cleared");
  });

  it("another house's UNDO row on a house candidate is a 404 too, never the 400 that describes it", async () => {
    const app = makeApp();
    const d = (await app.decide(AYLIN, CAND_H1, "confirmed")) as any;
    const u = (await app.undo(DENIZ, d.decisionId)) as any;
    const err = await app.undo(SELIN, u.decisionId).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).not.toMatch(/IS an undo/);
  });
});

describe("deciding another house's candidate says nothing about it", () => {
  it("house two gets the 404 a missing id gets, pending or decided, and nothing is written or read from the log", async () => {
    const decided = seed({
      beverage_identity_decisions: [
        {
          id: LEGACY_H1,
          candidate_id: CAND_H1,
          restaurant_id: HOUSE_1,
          deciding_restaurant_id: HOUSE_1,
          action: "confirmed",
          decided_by: "u-aylin",
          decided_by_label: "Aylin",
          decided_by_role: "staff",
          decided_at: "2026-09-16T09:00:00Z",
          evidence_shown: {},
          note: null,
          link_written: "restaurant_inventory.identity_id",
          undoes_decision_id: null,
        },
      ],
      restaurant_inventory: [{ id: "inv-1", restaurant_id: HOUSE_1, identity_id: "ident-1" }],
    });
    decided.beverage_identity_candidates = decided.beverage_identity_candidates.map((c) =>
      c.id === CAND_H1 ? { ...c, status: "confirmed", decided_by: "u-aylin", decided_at: "2026-09-16T09:00:00Z" } : c,
    );

    for (const tables of [seed(), decided]) {
      const app = makeApp(tables);
      const before = JSON.stringify(app.store.tables);
      const theirs = await app.decide(MERT, CAND_H1, "rejected").catch((e) => e);
      const missing = await app
        .decide(MERT, "c0000000-0000-4000-8000-999999999999", "rejected")
        .catch((e) => e);
      expect(theirs).toBeInstanceOf(NotFoundException);
      expect(theirs.getStatus()).toBe(404);
      expect(theirs.getResponse()).toEqual(missing.getResponse());
      expect(theirs.message).not.toMatch(/already|another house/);
      expect(JSON.stringify(app.store.tables)).toBe(before);
    }
  });
});

describe("a shared candidate that reads decided with nothing logged behind it", () => {
  const stranded = () => {
    const t = seed();
    t.beverage_identity_candidates = t.beverage_identity_candidates.map((c) =>
      c.id === CAND_PUB ? { ...c, status: "confirmed", decided_by: "u-aylin", decided_at: "2026-09-16T09:00:00Z" } : c,
    );
    return t;
  };

  it("is answered with a 409 that names the state, in every house, and nothing is written", async () => {
    const app = makeApp(stranded());
    const before = JSON.stringify(app.store.tables);
    for (const person of [AYLIN, MERT]) {
      const err = await app.decide(person, CAND_PUB, "rejected").catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toMatch(/no logged decision stands behind it/);
    }
    expect(JSON.stringify(app.store.tables)).toBe(before);
  });

  it("is told apart from a decision that really stands: that one is the 400", async () => {
    const app = makeApp();
    await app.decide(AYLIN, CAND_PUB, "confirmed");
    const err = await app.decide(MERT, CAND_PUB, "rejected").catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toMatch(/already confirmed/);
  });
});

describe("the house rule is answered before anything else about the row", () => {
  it("another house's undo row on a SHARED candidate is refused with the house 403, not the 400 that says it is an undo", async () => {
    const app = makeApp();
    const d = (await app.decide(AYLIN, CAND_PUB, "confirmed")) as any;
    const u = (await app.undo(DENIZ, d.decisionId)) as any;

    const err = await app.undo(SELIN, u.decisionId).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getStatus()).toBe(403);
    expect(err.message).toMatch(/taken in another house/);
    expect(err.message).not.toMatch(/IS an undo/);

    // Inside the deciding house the same request gets the row's own answer.
    await expect(app.undo(DENIZ, u.decisionId)).rejects.toThrow(/IS an undo/);
    expect(app.decisions()).toHaveLength(2);
  });
});

describe("two houses deciding one shared candidate at the same moment", () => {
  it("exactly one decision is taken; the other gets a 409 and writes nothing", async () => {
    const app = makeApp();
    const [one, two] = await Promise.allSettled([
      app.decide(AYLIN, CAND_PUB, "confirmed"),
      app.decide(MERT, CAND_PUB, "rejected"),
    ]);

    const settled = [one, two];
    const won = settled.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const lost = settled.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(ConflictException);
    expect(lost[0].reason.getStatus()).toBe(409);

    // The log, the candidate and the link all tell the winner's story, and only it.
    const winner = won[0].value;
    expect(app.decisions()).toHaveLength(1);
    expect(app.decisions()[0].id).toBe(winner.decisionId);
    expect(app.candidate(CAND_PUB).status).toBe(winner.status);
    expect(app.posting().identity_id).toBe(winner.status === "confirmed" ? "ident-1" : null);
  });

  it("after the race, undoing the winner leaves a pending candidate with no link behind it", async () => {
    const app = makeApp();
    const [one, two] = await Promise.allSettled([
      app.decide(AYLIN, CAND_PUB, "confirmed"),
      app.decide(MERT, CAND_PUB, "rejected"),
    ]);
    const winnerIsOne = one.status === "fulfilled";
    const winner = ((winnerIsOne ? one : two) as PromiseFulfilledResult<any>).value;
    await app.undo(winnerIsOne ? DENIZ : SELIN, winner.decisionId);

    expect(app.candidate(CAND_PUB).status).toBe("pending");
    expect(app.posting().identity_id).toBeNull();
    // And the loser's house has no decision of its own to undo.
    const loserLog = await app.log(winnerIsOne ? SELIN : DENIZ);
    expect(loserLog.every((r) => r.decided_in !== "this_house")).toBe(true);
  });
});
