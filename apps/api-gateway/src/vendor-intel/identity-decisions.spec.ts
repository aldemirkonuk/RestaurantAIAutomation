import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
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
  /** Every awaited SELECT, with its filters, so a test can say a read never ran. */
  reads: Array<{ table: Table; filters: Array<[string, any]> }>;
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
  /** Rows the conditional claim gets back. Default: the candidate, i.e. it won. */
  claimRows?: any[];
  claimError?: any;
  /** An error from the link write (the subject table's update). */
  linkError?: any;
  releaseRows?: any[];
  releaseError?: any;
  /** Rows for the plain `select().eq(...)` reads of the candidates table —
   * `pending()`'s own list, and `decisions(identityId)`'s first step (which
   * candidates named this identity) — distinct from `loadCandidate`'s
   * `maybeSingle()` read above. */
  candidateRows?: any[];
  candidateReadError?: any;
}) {
  const rec: Recorded = { inserts: [], updates: [], deletes: [], reads: [] };

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
      in: (col: string, vals: any[]) => {
        filters.push([col, vals]);
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
        if (mode === "select") rec.reads.push({ table, filters });
        if (table === "beverage_identity_decisions" && mode === "select") {
          return resolve({ data: opts.logRows ?? [], error: opts.logError ?? null });
        }
        if (table === "beverage_identity_candidates" && mode === "update") {
          // A release (or an undo) sets pending; a claim sets the decision.
          if (patch?.status === "pending") {
            return resolve({
              data: opts.releaseError ? null : (opts.releaseRows ?? [{ id: "cand-1" }]),
              error: opts.releaseError ?? null,
            });
          }
          return resolve({
            data: opts.claimError ? null : (opts.claimRows ?? [{ id: "cand-1" }]),
            error: opts.claimError ?? null,
          });
        }
        if (mode === "update" && table !== "beverage_identity_candidates" && opts.linkError) {
          return resolve({ data: null, error: opts.linkError });
        }
        if (table === "beverage_identity_candidates" && mode === "select") {
          return resolve({
            data: opts.candidateRows ?? [],
            error: opts.candidateReadError ?? null,
          });
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
  it("claims the candidate, then writes the link, then the log", async () => {
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

    // The claim is the FIRST write, and it is conditional on the row still
    // reading pending: that condition is what makes a concurrent decision lose.
    expect(rec.updates[0].table).toBe("beverage_identity_candidates");
    expect(rec.updates[0].patch).toEqual(
      expect.objectContaining({ status: "confirmed", decided_by: "user-staff" }),
    );
    expect(rec.updates[0].filters).toEqual([
      ["id", "cand-1"],
      ["status", "pending"],
    ]);
    const link = rec.updates.find((u) => u.table === "restaurant_inventory");
    expect(link?.patch).toEqual({ identity_id: "ident-1" });
    expect(rec.updates.indexOf(link!)).toBeGreaterThan(0);
    // One candidate write only: nothing re-stamps the status after the log.
    expect(rec.updates.filter((u) => u.table === "beverage_identity_candidates")).toHaveLength(1);

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

  it("fails the whole call when the decision cannot be logged, says the link stands, and releases the claim", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      identity: { id: "ident-1", display_label: "x", identity_key: "k" },
      insertError: { message: "log table unreachable" },
    });
    const err = await svc
      .decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      })
      .catch((e) => e);
    expect(err.message).toMatch(/could not be logged/);
    expect(err.message).toMatch(/link was written \(restaurant_inventory\.identity_id\) and stays written/);
    expect(err.message).toMatch(/returned to pending/);

    const cand = rec.updates.filter((u) => u.table === "beverage_identity_candidates");
    expect(cand).toHaveLength(2);
    const [claim, release] = cand;
    expect(release.patch).toEqual({
      status: "pending",
      decided_by: null,
      decided_at: null,
      decision_note: null,
    });
    // Only THIS call's claim is released: same status, same stamp.
    expect(release.filters).toEqual([
      ["id", "cand-1"],
      ["status", "confirmed"],
      ["decided_at", claim.patch.decided_at],
    ]);
  });

  it("loses to a decision taken at the same moment: 409, nothing linked, nothing logged", async () => {
    const { svc, rec } = makeService({ candidate: CANDIDATE, claimRows: [] });
    const err = await svc
      .decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getStatus()).toBe(409);
    expect(err.message).toMatch(/nothing was linked or logged/);
    expect(rec.updates.map((u) => u.table)).toEqual(["beverage_identity_candidates"]);
    expect(rec.inserts).toHaveLength(0);
  });

  it("reports a failed claim as a failure and writes nothing after it", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      claimError: { message: "lock timeout" },
    });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      }),
    ).rejects.toThrow(/could not be taken for this decision \(lock timeout\)\. Nothing was linked or logged/);
    expect(rec.updates.map((u) => u.table)).toEqual(["beverage_identity_candidates"]);
    expect(rec.inserts).toHaveLength(0);
  });

  it("releases the claim when the link cannot be written, and logs nothing", async () => {
    const { svc, rec } = makeService({
      candidate: CANDIDATE,
      linkError: { message: "permission denied" },
    });
    const err = await svc
      .decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      })
      .catch((e) => e);
    expect(err.message).toMatch(/could not be written to restaurant_inventory: permission denied/);
    expect(err.message).toMatch(/No link was written and nothing was logged\. The candidate was returned to pending\./);
    expect(rec.inserts).toHaveLength(0);
    const cand = rec.updates.filter((u) => u.table === "beverage_identity_candidates");
    expect(cand.map((u) => u.patch.status)).toEqual(["confirmed", "pending"]);
  });

  it("says so when a released claim could not be returned to pending", async () => {
    const { svc } = makeService({
      candidate: CANDIDATE,
      linkError: { message: "permission denied" },
      releaseError: { message: "connection reset" },
    });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      }),
    ).rejects.toThrow(/could NOT be returned to pending \(connection reset\): it reads confirmed with no logged decision behind it/);
  });

  it("leaves a candidate alone when it is no longer this call's claim to release", async () => {
    const { svc } = makeService({
      candidate: CANDIDATE,
      linkError: { message: "permission denied" },
      releaseRows: [],
    });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: "house-1",
      }),
    ).rejects.toThrow(/no longer this decision's to return/);
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

  it("answers another house's candidate with the 404 a missing id gets, and writes nothing", async () => {
    // ADR 0147: a row that is not the caller's is a 404. Asked of a DECIDED
    // candidate too, because the status check used to run first and answered
    // another house with "already confirmed" (vintel review 2026-09-17, defect 5).
    for (const status of ["pending", "confirmed"]) {
      const { svc, rec } = makeService({ candidate: { ...CANDIDATE, status } });
      const err = await svc
        .decide({
          candidateId: "cand-1",
          decision: "confirmed",
          actor: STAFF,
          restaurantId: "house-2",
        })
        .catch((e) => e);
      const missing = await makeService({})
        .svc.decide({
          candidateId: "cand-1",
          decision: "confirmed",
          actor: STAFF,
          restaurantId: "house-2",
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.getResponse()).toEqual(missing.getResponse());
      expect(rec.updates).toHaveLength(0);
      expect(rec.inserts).toHaveLength(0);
      // Nothing about the candidate was read past the row itself: not its log.
      expect(rec.reads.filter((r) => r.table === "beverage_identity_decisions")).toHaveLength(0);
    }
  });

  it("refuses to decide a candidate that was already decided, without promising an undo", async () => {
    const { svc, rec } = makeService({
      candidate: { ...CANDIDATE, status: "confirmed" },
      logRows: [{ id: "dec-1", action: "confirmed", undoes_decision_id: null }],
    });
    const err = await svc
      .decide({
        candidateId: "cand-1",
        decision: "rejected",
        actor: STAFF,
        restaurantId: "house-1",
      })
      .catch((e) => e);
    expect(err.message).toMatch(/already confirmed/);
    // A decision logged before the deciding house was recorded has no house
    // that can undo it, so the refusal must not say one can.
    expect(err.message).not.toMatch(/can undo it/);
    expect(err.message).toMatch(/only where the log recorded which house/);
    expect(rec.updates).toHaveLength(0);
  });

  /**
   * A candidate's status is what the application believes; the log is the
   * record. `decide` claims, then links, then logs, in three writes, so a
   * process that dies after the claim leaves a candidate reading decided with
   * no logged decision behind it (vintel review 2026-09-17, defect 4). The one
   * surface for that state is here: the refusal says what is true.
   */
  it("answers a decided candidate with NO logged decision behind it with a 409 that says so", async () => {
    const { svc, rec } = makeService({
      candidate: { ...CANDIDATE, status: "confirmed" },
      logRows: [],
    });
    const err = await svc
      .decide({ candidateId: "cand-1", decision: "rejected", actor: STAFF, restaurantId: "house-1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toMatch(/reads confirmed, but no logged decision stands behind it/);
    expect(err.message).toMatch(/cannot be undone from any session/);
    expect(err.message).not.toMatch(/already confirmed/);
    const logRead = rec.reads.find((r) => r.table === "beverage_identity_decisions")!;
    expect(logRead.filters).toEqual([["candidate_id", "cand-1"]]);
    expect(rec.updates).toHaveLength(0);
    expect(rec.inserts).toHaveLength(0);
  });

  it("counts an undone decision as no decision: decided, undone, re-claimed and never logged is stranded", async () => {
    const { svc } = makeService({
      candidate: { ...CANDIDATE, status: "rejected" },
      logRows: [
        { id: "dec-1", action: "confirmed", undoes_decision_id: null },
        { id: "dec-2", action: "undone", undoes_decision_id: "dec-1" },
      ],
    });
    const err = await svc
      .decide({ candidateId: "cand-1", decision: "confirmed", actor: STAFF, restaurantId: "house-1" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toMatch(/reads rejected, but no logged decision stands behind it/);
  });

  it("reports an unreadable log as a failure, never as already decided or as stranded", async () => {
    const { svc, rec } = makeService({
      candidate: { ...CANDIDATE, status: "confirmed" },
      logError: { message: "statement timeout" },
    });
    const err = await svc
      .decide({ candidateId: "cand-1", decision: "rejected", actor: STAFF, restaurantId: "house-1" })
      .catch((e) => e);
    expect(err.getStatus()).toBe(400);
    expect(err.message).toMatch(/could not be read \(statement timeout\)\. Nothing was decided/);
    expect(err.message).not.toMatch(/already confirmed|no logged decision stands/);
    expect(rec.updates).toHaveLength(0);
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

/**
 * The house that decided a shared-register row is now recorded
 * (`deciding_restaurant_id`, migration 20260917010000) — ADR 0149 answer 17:
 * "the person's name and undo only inside that house." A HOUSE row's own
 * `restaurant_id` still IS its deciding house, unaffected by whether
 * `deciding_restaurant_id` was ever written on it.
 */
describe("naming the deciding house on a shared row (ADR 0149 answer 17)", () => {
  it("shows the person and allows undo inside the deciding house", async () => {
    const { svc } = makeService({
      logRows: [
        {
          id: "d1",
          candidate_id: "cand-1",
          restaurant_id: null,
          deciding_restaurant_id: "house-1",
          decided_by_label: "Aylin",
          decided_by_role: "staff",
        },
      ],
    });
    const out = await svc.decisions("house-1", 50);
    expect(out.items[0]).toMatchObject({
      decided_by_label: "Aylin",
      decided_by_role: "staff",
      decided_in: "this_house",
      person_shown: true,
      undo_refusal: null,
    });
    expect(out.items[0].deciding_restaurant_id).toBeUndefined();
  });

  it("hides the person and refuses undo from a different house", async () => {
    const { svc } = makeService({
      logRows: [
        {
          id: "d1",
          candidate_id: "cand-1",
          restaurant_id: null,
          deciding_restaurant_id: "house-2",
          decided_by_label: "Someone Else",
          decided_by_role: "manager",
          note: "checked the label",
        },
      ],
    });
    const out = await svc.decisions("house-1", 50);
    expect(out.items[0]).toMatchObject({
      decided_by: null,
      decided_by_label: null,
      decided_by_role: null,
      note: null,
      decided_in: "another_house",
      person_shown: false,
    });
    expect(out.items[0].undo_refusal).toMatch(/taken in another house/);
  });

  it("reads a HOUSE row's own restaurant_id as its deciding house, even with no deciding_restaurant_id column value", async () => {
    const { svc } = makeService({
      logRows: [
        { id: "d1", candidate_id: "cand-1", restaurant_id: "house-1", decided_by_label: "Aylin" },
      ],
    });
    const out = await svc.decisions("house-1", 50);
    expect(out.items[0]).toMatchObject({ decided_by_label: "Aylin", decided_in: "this_house", person_shown: true, undo_refusal: null });
  });
});

describe("undo refuses a shared decision taken in another house (ADR 0149 answer 17)", () => {
  it("refuses an undo of a shared row decided by another house", async () => {
    const { svc } = makeService({
      decision: {
        id: "dec-1",
        candidate_id: "cand-1",
        restaurant_id: null,
        deciding_restaurant_id: "house-2",
        action: "confirmed",
        link_written: null,
      },
      candidate: { ...CANDIDATE, restaurant_id: null, status: "confirmed" },
    });
    await expect(
      svc.undo({ decisionId: "dec-1", actor: MANAGER, restaurantId: "house-1" }),
    ).rejects.toThrow(/taken in another house/);
  });

  it("allows an undo of a shared row this same house decided", async () => {
    const { svc, rec } = makeService({
      decision: {
        id: "dec-1",
        candidate_id: "cand-1",
        restaurant_id: null,
        deciding_restaurant_id: "house-1",
        action: "rejected",
        link_written: null,
      },
      candidate: { ...CANDIDATE, restaurant_id: null, status: "rejected" },
      identity: { id: "ident-1", display_label: "x", identity_key: "k" },
    });
    const out = await svc.undo({ decisionId: "dec-1", actor: MANAGER, restaurantId: "house-1" });
    expect(out.undid).toBe("dec-1");
    const logged = rec.inserts.find((i) => i.table === "beverage_identity_decisions")!;
    expect(logged.payload.deciding_restaurant_id).toBe("house-1");
  });
});

/**
 * Narrowed to one bottle — the sighting sheet's "identity decisions on this
 * row" card and its pending line (ADR 0160 §112, direction A).
 */
describe("narrowing the queue and the log to one identity", () => {
  it("pending() filters the candidates table by identity_id", async () => {
    const { svc, rec } = makeService({ candidateRows: [CANDIDATE] });
    const out = await svc.pending("house-1", 50, "ident-1");
    expect(out).toEqual([CANDIDATE]);
    const read = rec.reads.find((r) => r.table === "beverage_identity_candidates")!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ["status", "pending"],
        ["or", "restaurant_id.is.null,restaurant_id.eq.house-1"],
        ["identity_id", "ident-1"],
      ]),
    );
  });

  it("decisions(identityId) reads which candidates named this identity, then filters the log by those candidates", async () => {
    const { svc, rec } = makeService({
      candidateRows: [{ id: "cand-1" }, { id: "cand-2" }],
      logRows: [{ id: "d1", candidate_id: "cand-1" }],
    });
    const out = await svc.decisions("house-1", 50, "ident-1");
    expect(out.items).toHaveLength(1);
    // The row names no `restaurant_id`/`deciding_restaurant_id` at all (a
    // fixture predating the migration) — read conservatively: hidden person,
    // no house may take it back (ADR 0149 answer 17).
    expect(out.items[0]).toMatchObject({
      id: "d1",
      candidate_id: "cand-1",
      decided_by: null,
      decided_by_label: null,
      decided_by_role: null,
      note: null,
      decided_in: "unrecorded",
      person_shown: false,
    });
    expect(out.items[0].undo_refusal).toMatch(/before Mudavym recorded which house/);
    expect(out.scope).toContain("this bottle");
    const candidateRead = rec.reads.find(
      (r) => r.table === "beverage_identity_candidates",
    )!;
    expect(candidateRead.filters).toEqual(
      expect.arrayContaining([
        ["identity_id", "ident-1"],
        ["or", "restaurant_id.is.null,restaurant_id.eq.house-1"],
      ]),
    );
    const logRead = rec.reads.find((r) => r.table === "beverage_identity_decisions")!;
    expect(logRead.filters).toEqual(
      expect.arrayContaining([["candidate_id", ["cand-1", "cand-2"]]]),
    );
  });

  it("decisions(identityId) returns an honest empty result without querying the log, when no candidate ever named this identity", async () => {
    const { svc, rec } = makeService({
      candidateRows: [],
      logRows: [{ id: "should-not-appear" }],
    });
    const out = await svc.decisions("house-1", 50, "ident-with-no-candidates");
    expect(out).toEqual({
      items: [],
      scope:
        "this house's decisions on this bottle, plus decisions on it from the public registers",
      limit: 50,
      complete: true,
    });
    expect(rec.reads.some((r) => r.table === "beverage_identity_decisions")).toBe(false);
  });

  it("decisions(identityId) fails loudly when the candidate lookup itself fails", async () => {
    const { svc } = makeService({
      candidateReadError: { message: "connection reset" },
    });
    await expect(svc.decisions("house-1", 50, "ident-1")).rejects.toThrow(
      /could not be read \(connection reset\)\. This is a failure, not an empty log/,
    );
  });
});

/**
 * A session that names no house.
 *
 * `JwtStrategy.validate` returns `restaurantId` from the token, falling back to
 * `users.restaurant_id`, and both can be empty. The controller passes that on
 * as `null`. Before this fix a null house was read as "no filter": the queue
 * and the log returned every tenant's rows, and `requireSameHouse` waved a
 * decision or an undo through on any house's candidate. ADR 0124 gives the
 * not-a-tenant view to the service key, never to a JWT session, so a session
 * with no house is refused before anything is read or written.
 */
describe("a session that names no house", () => {
  const HOUSE_DECISION = {
    id: "dec-1",
    candidate_id: "cand-1",
    restaurant_id: "house-1",
    action: "confirmed",
    link_written: "restaurant_inventory.identity_id",
  };

  it("is refused the candidate queue rather than shown every house's", async () => {
    const { svc, rec } = makeService({});
    await expect(svc.pending(null, 50)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rec.reads).toHaveLength(0);
  });

  it("still gives a session that names a house its own queue plus the public registers", async () => {
    const { svc, rec } = makeService({});
    await svc.pending("house-1", 50);
    const read = rec.reads.find((r) => r.table === "beverage_identity_candidates")!;
    expect(read.filters).toEqual(
      expect.arrayContaining([
        ["status", "pending"],
        ["or", "restaurant_id.is.null,restaurant_id.eq.house-1"],
      ]),
    );
  });

  it("is refused the decision log rather than shown every decision", async () => {
    const { svc, rec } = makeService({ logRows: [{ id: "d1" }] });
    await expect(svc.decisions(null, 50)).rejects.toBeInstanceOf(ForbiddenException);
    expect(rec.reads).toHaveLength(0);
  });

  it("still gives a session that names a house its own log plus the public registers", async () => {
    const { svc, rec } = makeService({ logRows: [] });
    const out = await svc.decisions("house-1", 50);
    const read = rec.reads.find((r) => r.table === "beverage_identity_decisions")!;
    expect(read.filters).toEqual([
      ["or", "restaurant_id.is.null,restaurant_id.eq.house-1"],
    ]);
    expect(out.scope).toContain("this house");
  });

  it("cannot decide a house's candidate, and nothing is linked or logged", async () => {
    const { svc, rec } = makeService({ candidate: CANDIDATE });
    await expect(
      svc.decide({
        candidateId: "cand-1",
        decision: "confirmed",
        actor: STAFF,
        restaurantId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rec.updates).toHaveLength(0);
    expect(rec.inserts).toHaveLength(0);
  });

  it("cannot undo a house's decision, and no link is taken back", async () => {
    const { svc, rec } = makeService({
      decision: HOUSE_DECISION,
      candidate: { ...CANDIDATE, status: "confirmed" },
    });
    await expect(
      svc.undo({ decisionId: "dec-1", actor: MANAGER, restaurantId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rec.updates).toHaveLength(0);
    expect(rec.deletes).toHaveLength(0);
    expect(rec.inserts).toHaveLength(0);
  });
});
