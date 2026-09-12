import { ForbiddenException } from "@nestjs/common";
import { IdentityService } from "./identity.service";

/**
 * Confirming, rejecting, undoing — and the log that has to survive all three.
 *
 * The founder's call of 2026-09-05 was *"staff may confirm, log the decisions."*
 * The half that needs proving is the second: a decision that is not logged is
 * not recorded as taken, an undo does not erase what it reverses, and a log
 * that could not be read is a failure rather than an empty list.
 *
 * The PostgREST builder is thenable — every filter returns the builder and the
 * query only runs when it is awaited — so the fake below models it that way.
 */

type Table =
  | "beverage_identity_candidates"
  | "beverage_identity_decisions"
  | "beverage_identities"
  | "beverage_identity_keys"
  | "restaurant_inventory"
  | "vendor_price_observations"
  | "price_index_postings";

interface Recorded {
  inserts: Array<{ table: Table; payload: any }>;
  updates: Array<{ table: Table; patch: any; filters: Array<[string, any]> }>;
  deletes: Array<{ table: Table; filters: Array<[string, any]> }>;
}

function makeService(opts: {
  candidate?: any;
  candidateError?: any;
  decision?: any;
  decisionError?: any;
  priorUndo?: any;
  priorUndoError?: any;
  logRows?: any[];
  logError?: any;
  insertError?: any;
  identity?: any;
  identityError?: any;
}) {
  const rec: Recorded = { inserts: [], updates: [], deletes: [] };

  const build = (table: Table) => {
    const filters: Array<[string, any]> = [];
    let mode: "select" | "update" | "delete" = "select";
    let patch: any = null;

    const b: any = {
      select: () => b,
      order: () => b,
      limit: () => b,
      not: () => b,
      or: (clause: string) => {
        filters.push(["or", clause]);
        return b;
      },
      eq: (col: string, val: any) => {
        filters.push([col, val]);
        if (mode === "update") return b;
        return b;
      },
      update: (p: any) => {
        mode = "update";
        patch = p;
        return b;
      },
      delete: () => {
        mode = "delete";
        return b;
      },
      insert: (payload: any) => {
        rec.inserts.push({ table, payload });
        return {
          select: () => ({
            single: async () => ({
              data: opts.insertError ? null : { id: `${table}-new` },
              error: opts.insertError ?? null,
            }),
          }),
        };
      },
      upsert: (payload: any) => {
        rec.inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle: async () => {
        if (table === "beverage_identity_candidates") {
          return { data: opts.candidate ?? null, error: opts.candidateError ?? null };
        }
        if (table === "beverage_identities") {
          return { data: opts.identity ?? null, error: opts.identityError ?? null };
        }
        // The decisions table is read twice: by id, and by undoes_decision_id.
        const byUndo = filters.some(([c]) => c === "undoes_decision_id");
        if (byUndo) {
          return { data: opts.priorUndo ?? null, error: opts.priorUndoError ?? null };
        }
        return { data: opts.decision ?? null, error: opts.decisionError ?? null };
      },
      then: (resolve: any) => {
        if (mode === "update") rec.updates.push({ table, patch, filters });
        if (mode === "delete") rec.deletes.push({ table, filters });
        if (table === "beverage_identity_decisions" && mode === "select") {
          return resolve({ data: opts.logRows ?? [], error: opts.logError ?? null });
        }
        return resolve({ data: [], error: null });
      },
    };
    return b;
  };

  const databaseService = { supabase: { from: (t: Table) => build(t) } } as any;
  return { svc: new IdentityService(databaseService), rec };
}

const STAFF = {
  userId: "user-staff",
  name: "Aylin",
  email: "aylin@example.test",
  role: "staff",
};
const MANAGER = {
  userId: "user-mgr",
  name: "Deniz",
  email: "deniz@example.test",
  role: "manager",
};

const CANDIDATE = {
  id: "cand-1",
  subject_table: "restaurant_inventory",
  subject_id: "inv-1",
  restaurant_id: "house-1",
  identity_id: "ident-1",
  method: "normalised_key",
  confidence: 0.62,
  evidence: { producer: "agreed", name: "agreed", size: "unstated" },
  status: "pending",
};

describe("a confirmation is a logged decision", () => {
  it("writes the link, then the log, then the candidate's status", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      identity: { id: "ident-1", display_label: "Krug (750ml)", identity_key: "k" },
    });

    const out = await svc.decide({
      candidateId: "cand-1",
      decision: "confirmed",
      actor: STAFF,
      restaurantId: "house-1",
      note: "same bottle, checked the label",
    });

    expect(out.status).toBe("confirmed");
    expect(out.linkWritten).toBe("restaurant_inventory.identity_id");
    expect(out.decisionId).toBe("beverage_identity_decisions-new");

    const link = rec.updates.find((u) => u.table === "restaurant_inventory");
    expect(link?.patch).toEqual({ identity_id: "ident-1" });

    const logged = rec.inserts.find(
      (i) => i.table === "beverage_identity_decisions",
    )!;
    expect(logged.payload.action).toBe("confirmed");
    expect(logged.payload.candidate_id).toBe("cand-1");
    expect(logged.payload.restaurant_id).toBe("house-1");
    expect(logged.payload.decided_by).toBe("user-staff");
    expect(logged.payload.decided_by_label).toBe("Aylin");
    expect(logged.payload.decided_by_role).toBe("staff");
    expect(logged.payload.link_written).toBe("restaurant_inventory.identity_id");
    expect(logged.payload.undoes_decision_id).toBeNull();
  });

  it("captures the evidence the SERVER held, not anything the client sent", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      identity: { id: "ident-1", display_label: "Krug (750ml)", identity_key: "k" },
    });
    await svc.decide({
      candidateId: "cand-1",
      decision: "confirmed",
      actor: STAFF,
      restaurantId: "house-1",
    });
    const shown = rec.inserts.find(
      (i) => i.table === "beverage_identity_decisions",
    )!.payload.evidence_shown;
    expect(shown.capturedBy).toBe("server");
    expect(shown.method).toBe("normalised_key");
    expect(shown.confidence).toBe(0.62);
    expect(shown.evidence).toEqual(CANDIDATE.evidence);
    expect(shown.identity).toEqual({
      id: "ident-1",
      display_label: "Krug (750ml)",
      identity_key: "k",
    });
    expect(shown.subject).toEqual({ table: "restaurant_inventory", id: "inv-1" });
  });

  it("logs a rejection too, and writes no link for it", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      identity: { id: "ident-1", display_label: "Krug (750ml)", identity_key: "k" },
    });
    const out = await svc.decide({
      candidateId: "cand-1",
      decision: "rejected",
      actor: STAFF,
      restaurantId: "house-1",
    });
    expect(out.linkWritten).toBeNull();
    expect(rec.updates.some((u) => u.table === "restaurant_inventory")).toBe(false);
    const logged = rec.inserts.find(
      (i) => i.table === "beverage_identity_decisions",
    )!;
    expect(logged.payload.action).toBe("rejected");
    expect(logged.payload.link_written).toBeNull();
  });

  it("records the identity as UNREAD rather than dropping the log when it cannot be fetched", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      identityError: { message: "connection reset" },
    });
    await svc.decide({
      candidateId: "cand-1",
      decision: "confirmed",
      actor: STAFF,
      restaurantId: "house-1",
    });
    const shown = rec.inserts.find(
      (i) => i.table === "beverage_identity_decisions",
    )!.payload.evidence_shown;
    expect(shown.identity).toEqual({ unread: true, reason: "connection reset" });
  });

  it("fails the whole call when the decision cannot be logged", async () => {
    const { svc } = makeService({
      candidate: CANDIDATE,
      identity: { id: "ident-1", display_label: "x", identity_key: "k" },
      insertError: { message: "log table unreachable" },
    });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      }),
    ).rejects.toThrow(/could not be logged/);
  });

  it("refuses a decision from an account with no name and no email", async () => {
    const { svc } = makeService({ candidate: CANDIDATE });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: { userId: "u", name: null, email: null, role: "staff" },
        restaurantId: "house-1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses a decision on another house's candidate", async () => {
    const { svc } = makeService({ candidate: CANDIDATE });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-2",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("refuses to decide a candidate that was already decided", async () => {
    const { svc } = makeService({
      candidate: { ...CANDIDATE, status: "confirmed" },
    });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "rejected",
        actor: STAFF,
        restaurantId: "house-1",
      }),
    ).rejects.toThrow(/already confirmed/);
  });

  it("reports a failed candidate read as a failure, not as no such candidate", async () => {
    const { svc } = makeService({ candidateError: { message: "timeout" } });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      }),
    ).rejects.toThrow(/could not be read \(timeout\)/);
  });
});

describe("a manager takes a decision back, and the undo is a decision", () => {
  const CONFIRMED = {
    id: "dec-1",
    candidate_id: "cand-1",
    restaurant_id: "house-1",
    action: "confirmed",
    link_written: "restaurant_inventory.identity_id",
  };

  it("clears the link, logs the undo naming what it reverses, and returns the candidate to pending", async () => {
    const { svc, rec } = makeService({
      decision: CONFIRMED,
      candidate: { ...CANDIDATE, status: "confirmed" },
      identity: { id: "ident-1", display_label: "Krug (750ml)", identity_key: "k" },
    });

    const out = await svc.undo({
      decisionId: "dec-1",
      actor: MANAGER,
      restaurantId: "house-1",
      note: "wrong bottle",
    });

    expect(out.undid).toBe("dec-1");
    expect(out.linkCleared).toBe("restaurant_inventory.identity_id cleared");

    const cleared = rec.updates.find((u) => u.table === "restaurant_inventory")!;
    expect(cleared.patch).toEqual({ identity_id: null });
    // Cleared by BOTH ids: an undo must not blank a link somebody else wrote.
    expect(cleared.filters).toEqual(
      expect.arrayContaining([
        ["id", "inv-1"],
        ["identity_id", "ident-1"],
      ]),
    );

    const logged = rec.inserts.find(
      (i) => i.table === "beverage_identity_decisions",
    )!;
    expect(logged.payload.action).toBe("undone");
    expect(logged.payload.undoes_decision_id).toBe("dec-1");
    expect(logged.payload.decided_by_label).toBe("Deniz");
    expect(logged.payload.decided_by_role).toBe("manager");

    const back = rec.updates.find(
      (u) => u.table === "beverage_identity_candidates",
    )!;
    expect(back.patch).toEqual({
      status: "pending",
      decided_by: null,
      decided_at: null,
      decision_note: null,
    });
  });

  it("withdraws a key row for a subject linked by key, not by column", async () => {
    const { svc, rec } = makeService({
      decision: { ...CONFIRMED, link_written: "beverage_identity_keys(...)" },
      candidate: {
        ...CANDIDATE,
        subject_table: "master_wine_library",
        subject_id: "wine-1",
        status: "confirmed",
      },
      identity: { id: "ident-1", display_label: "x", identity_key: "k" },
    });
    const out = await svc.undo({
      decisionId: "dec-1",
      actor: MANAGER,
      restaurantId: "house-1",
    });
    expect(out.linkCleared).toContain("withdrawn");
    const del = rec.deletes.find((d) => d.table === "beverage_identity_keys")!;
    expect(del.filters).toEqual(
      expect.arrayContaining([
        ["key_namespace", "mudavym:master_wine_library"],
        ["key_value", "wine-1"],
        ["identity_id", "ident-1"],
      ]),
    );
  });

  it("refuses an undo from staff — that half of the gate is the manager's", async () => {
    const { svc } = makeService({ decision: CONFIRMED, candidate: CANDIDATE });
    await expect(
      svc.undo({ decisionId: "dec-1", actor: STAFF, restaurantId: "house-1" }),
    ).rejects.toThrow(/only an owner or a manager may undo/i);
  });

  it("refuses to undo the same decision twice", async () => {
    const { svc } = makeService({
      decision: CONFIRMED,
      priorUndo: { id: "dec-2" },
      candidate: CANDIDATE,
    });
    await expect(
      svc.undo({ decisionId: "dec-1", actor: MANAGER, restaurantId: "house-1" }),
    ).rejects.toThrow(/already undone \(dec-2\)/);
  });

  it("refuses to act when it cannot tell whether the decision was already undone", async () => {
    const { svc } = makeService({
      decision: CONFIRMED,
      priorUndoError: { message: "timeout" },
      candidate: CANDIDATE,
    });
    await expect(
      svc.undo({ decisionId: "dec-1", actor: MANAGER, restaurantId: "house-1" }),
    ).rejects.toThrow(/could take a link back twice/);
  });

  it("refuses to undo an undo", async () => {
    const { svc } = makeService({
      decision: { ...CONFIRMED, action: "undone" },
      candidate: CANDIDATE,
    });
    await expect(
      svc.undo({ decisionId: "dec-1", actor: MANAGER, restaurantId: "house-1" }),
    ).rejects.toThrow(/re-confirmation/);
  });

  it("undoes a rejection without touching any link", async () => {
    const { svc, rec } = makeService({
      decision: { ...CONFIRMED, action: "rejected", link_written: null },
      candidate: { ...CANDIDATE, status: "rejected" },
      identity: { id: "ident-1", display_label: "x", identity_key: "k" },
    });
    const out = await svc.undo({
      decisionId: "dec-1",
      actor: MANAGER,
      restaurantId: "house-1",
    });
    expect(out.linkCleared).toBeNull();
    expect(rec.updates.some((u) => u.table === "restaurant_inventory")).toBe(false);
    expect(rec.deletes).toHaveLength(0);
  });
});

describe("the decision log read", () => {
  it("returns this house's decisions and says the read was complete", async () => {
    const { svc } = makeService({
      logRows: [{ id: "d1", action: "confirmed", decided_by_label: "Aylin" }],
    });
    const out = await svc.decisions("house-1", 50);
    expect(out.items).toHaveLength(1);
    expect(out.complete).toBe(true);
    expect(out.scope).toContain("this house");
  });

  it("says a FULL page is a floor rather than a total", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `d${i}` }));
    const { svc } = makeService({ logRows: rows });
    const out = await svc.decisions("house-1", 3);
    expect(out.limit).toBe(3);
    expect(out.complete).toBe(false);
  });

  it("caps an absurd limit instead of honouring it", async () => {
    const { svc } = makeService({ logRows: [] });
    expect((await svc.decisions("house-1", 100000)).limit).toBe(200);
    expect((await svc.decisions("house-1", 0)).limit).toBe(1);
  });

  it("FAILS on a read error rather than returning an empty log", async () => {
    const { svc } = makeService({ logError: { message: "relation missing" } });
    await expect(svc.decisions("house-1")).rejects.toThrow(
      /could not be read \(relation missing\)\. This is a failure, not an empty log/,
    );
  });
});
