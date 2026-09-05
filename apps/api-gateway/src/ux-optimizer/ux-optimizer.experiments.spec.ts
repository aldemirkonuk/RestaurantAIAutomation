import { NotFoundException } from "@nestjs/common";
import { UxOptimizerService } from "./ux-optimizer.service";
import { NOTE_CLOSE_CONTROL } from "./experiments";

/**
 * The experiment half of the UX optimizer: assign, record, report.
 *
 * WHAT THESE CASES ARE FOR. Not "does it call supabase" — that proves nothing.
 * Each one pins a rule that, if broken, produces numbers that look fine and are
 * wrong:
 *
 *   * the stored row beats a recomputed hash, so editing the ratio cannot
 *     re-label exposures already in the ledger;
 *   * a failed READ is never an absent assignment;
 *   * the arm on an event comes from the assignment, never from the caller;
 *   * a failed COUNT is never zero;
 *   * reading the report does not enrol a house.
 */

const HOUSE = "550e8400-e29b-41d4-a716-446655440000"; // bucket 99 -> die
const OTHER_HOUSE = "550e8400-e29b-41d4-a716-000000000007";
const USER = "df60c36d-6a0f-4c7d-b744-05e42c7f608f";

type Call = {
  table: string;
  op: string;
  filters: Record<string, unknown>;
  payload?: unknown;
  options?: unknown;
};

interface Stub {
  /** The stored assignment row, or null for a house that has none. */
  assignment?: Record<string, unknown> | null;
  /** Set to make the assignment READ fail. */
  assignmentReadError?: string;
  /** Set to make the assignment WRITE fail. */
  assignmentWriteError?: string;
  /** Set to make the footprint insert fail. */
  insertError?: string;
  /** Set to make a count fail. */
  countError?: string;
  /** Keyed by `choice`, or by `arm:choice` when the two arms must differ. */
  counts?: Record<string, number>;
  /** Houses on each arm, keyed by arm. Read by the both-arms report. */
  houses?: Record<string, number>;
  firstEventAt?: string | null;
  /** The stored experiment window, or null for an experiment that has not started. */
  state?: Record<string, unknown> | null;
  /** Set to make the window READ fail. */
  stateReadError?: string;
  /** Set to make the window WRITE fail. */
  stateWriteError?: string;
  /** What a read of the window returns AFTER a write has landed on it. */
  stateAfterWrite?: Record<string, unknown> | null;
}

function makeDb(stub: Stub) {
  const calls: Call[] = [];
  // The window is written once and read back; a stub that always returned the
  // pre-write row would make every re-read look like a write that vanished.
  let windowWritten = false;

  const client: any = {
    from(table: string) {
      const entry: Call = { table, op: "", filters: {} };
      calls.push(entry);

      const result = (): { data: any; error: any; count?: number | null } => {
        if (table === "ux_experiment_state") {
          if (entry.op === "upsert" || entry.op === "update") {
            if (stub.stateWriteError)
              return { data: null, error: { message: stub.stateWriteError } };
            windowWritten = true;
            return { data: null, error: null };
          }
          if (stub.stateReadError)
            return { data: null, error: { message: stub.stateReadError } };
          const row =
            windowWritten && stub.stateAfterWrite !== undefined
              ? stub.stateAfterWrite
              : stub.state;
          return { data: row ?? null, error: null };
        }
        if (table === "ux_experiment_assignments") {
          if (entry.op === "count") {
            if (stub.countError)
              return { data: null, error: { message: stub.countError }, count: null };
            return {
              data: null,
              error: null,
              count: stub.houses?.[String(entry.filters["arm"])] ?? 0,
            };
          }
          if (entry.op === "upsert")
            return stub.assignmentWriteError
              ? { data: null, error: { message: stub.assignmentWriteError } }
              : { data: null, error: null };
          if (stub.assignmentReadError)
            return { data: null, error: { message: stub.assignmentReadError } };
          const row = stub.assignment ?? null;
          if (row && entry.filters["restaurant_id"] !== row.restaurant_id)
            return { data: null, error: null };
          return { data: row, error: null };
        }
        // neural_footprint_event
        if (entry.op === "insert")
          return stub.insertError
            ? { data: null, error: { message: stub.insertError } }
            : { data: null, error: null };
        if (entry.op === "count") {
          if (stub.countError)
            return { data: null, error: { message: stub.countError }, count: null };
          const choice = String(entry.filters["choice"]);
          const arm = String(entry.filters["context->>arm"]);
          return {
            data: null,
            error: null,
            count: stub.counts?.[`${arm}:${choice}`] ?? stub.counts?.[choice] ?? 0,
          };
        }
        return {
          data: stub.firstEventAt ? [{ occurred_at: stub.firstEventAt }] : [],
          error: null,
        };
      };

      const q: any = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          entry.op = opts?.head ? "count" : entry.op || "select";
          return q;
        },
        insert: (payload: unknown) => {
          entry.op = "insert";
          entry.payload = payload;
          return q;
        },
        upsert: (payload: unknown, options?: unknown) => {
          entry.op = "upsert";
          entry.payload = payload;
          entry.options = options;
          return q;
        },
        update: (payload: unknown) => {
          entry.op = "update";
          entry.payload = payload;
          return q;
        },
        eq: (col: string, v: unknown) => {
          entry.filters[col] = v;
          return q;
        },
        is: (col: string, v: unknown) => {
          entry.filters[`is:${col}`] = v;
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => result(),
        then: (resolve: (r: unknown) => unknown) => resolve(result()),
      };
      return q;
    },
  };

  return { db: { getClient: () => client } as any, calls };
}

function makeService(stub: Stub) {
  const { db, calls } = makeDb(stub);
  const config = { get: () => undefined } as any;
  const service = new UxOptimizerService(db, config, {} as any, {} as any);
  return { service, calls };
}

const STORED_DIE = {
  restaurant_id: HOUSE,
  experiment_key: "note_close_control",
  arm: "die",
  bucket: 99,
  ratio: { plain: 80, die: 20 },
  assigned_at: "2026-09-05T12:00:00.000Z",
};

describe("assignmentFor", () => {
  it("returns the stored arm and marks it recorded", async () => {
    const { service, calls } = makeService({ assignment: STORED_DIE });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    expect(a.arm).toBe("die");
    expect(a.bucket).toBe(99);
    expect(a.recorded).toBe(true);
    expect(a.founderWords).toBe(NOTE_CLOSE_CONTROL.founderWords);
    // A house that already has a row is not written to again.
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
  });

  it("THE STORED ROW WINS over a recomputed hash", async () => {
    // This house hashes to `die`. Its stored row says `plain` — which is what a
    // house would hold if the ratio had been different when it was assigned.
    // Recomputing here would move it, and every exposure already filed under
    // `plain` would then be counted against `die`.
    const { service } = makeService({
      assignment: { ...STORED_DIE, arm: "plain", bucket: 12, ratio: { plain: 95, die: 5 } },
    });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    expect(a.arm).toBe("plain");
    expect(a.bucket).toBe(12);
    expect(a.ratio).toEqual({ plain: 95, die: 5 });
  });

  it("assigns on first ask, writing the bucket and the ratio in force", async () => {
    const { service, calls } = makeService({ assignment: null });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    expect(a.arm).toBe("die");
    const write = calls.find((c) => c.op === "upsert");
    expect(write?.payload).toMatchObject({
      restaurant_id: HOUSE,
      experiment_key: "note_close_control",
      arm: "die",
      bucket: 99,
      ratio: { plain: 80, die: 20 },
    });
    // The race between two tabs resolves to the first write, not to an error:
    // both computed the same arm, so the loser has nothing to correct.
    expect(write?.options).toMatchObject({
      onConflict: "restaurant_id,experiment_key",
      ignoreDuplicates: true,
    });
  });

  it("A FAILED READ THROWS — it is never an absent assignment", async () => {
    // supabase-js resolves { data, error }; treating the error as "no row" would
    // re-assign on every failure and scatter one house across both arms.
    const { service } = makeService({ assignmentReadError: "connection reset" });
    await expect(service.assignmentFor("note_close_control", HOUSE)).rejects.toThrow(
      /connection reset/,
    );
  });

  it("says so when the arm is real but the write did not land", async () => {
    const { service } = makeService({
      assignment: null,
      assignmentWriteError: "permission denied",
    });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    expect(a.arm).toBe("die");
    expect(a.recorded).toBe(false);
    expect(a.assignedAt).toBeNull();
  });

  it("refuses an experiment nobody declared", async () => {
    const { service } = makeService({ assignment: null });
    await expect(service.assignmentFor("made_up", HOUSE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("scopes the read to the caller's house", async () => {
    const { service, calls } = makeService({ assignment: STORED_DIE });
    await service.assignmentFor("note_close_control", OTHER_HOUSE);
    const read = calls.find((c) => c.table === "ux_experiment_assignments");
    expect(read?.filters["restaurant_id"]).toBe(OTHER_HOUSE);
  });
});

describe("recordExperimentEvent", () => {
  it("stamps the arm from the ASSIGNMENT, not from the caller", async () => {
    const { service, calls } = makeService({ assignment: STORED_DIE });
    await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      // A caller that could name its arm could file its outcome against the
      // other one. There is no field for it, and this asserts what lands.
      event: "completed",
      actionId: "11111111-1111-4111-8111-111111111111",
      durationMs: 4200,
    });
    const insert = calls.find((c) => c.op === "insert");
    const row = insert?.payload as any;
    expect(insert?.table).toBe("neural_footprint_event");
    expect(row.subject_type).toBe("operator");
    expect(row.subject_id).toBe(USER);
    expect(row.stimulus).toBe("one_tap_note_card");
    expect(row.choice).toBe("completed");
    expect(row.context.arm).toBe("die");
    expect(row.context.experiment_key).toBe("note_close_control");
    expect(row.context.bucket).toBe(99);
    expect(row.restaurant_id).toBe(HOUSE);
  });

  it("writes outcome success only on a completion", async () => {
    const { service, calls } = makeService({ assignment: STORED_DIE });
    for (const event of ["exposed", "completed", "abandoned"] as const) {
      await service.recordExperimentEvent({
        experimentKey: "note_close_control",
        restaurantId: HOUSE,
        userId: USER,
        event,
      });
    }
    const rows = calls
      .filter((c) => c.op === "insert")
      .map((c) => c.payload as any);
    // In the loop's order: exposed, completed, abandoned.
    expect(rows.map((r) => r.choice)).toEqual([
      "exposed",
      "completed",
      "abandoned",
    ]);
    expect(rows.map((r) => r.outcome)).toEqual([null, "success", null]);
  });

  it("leaves an abandon's outcome NULL, because unknown is not failure", async () => {
    const { service, calls } = makeService({ assignment: STORED_DIE });
    await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "abandoned",
    });
    const row = calls.find((c) => c.op === "insert")?.payload as any;
    // The ledger's contract: NULL means UNKNOWN, never success. A person who
    // walks away from a note may have changed their mind, which is a correct
    // refusal rather than a defeat by the control.
    expect(row.outcome).toBeNull();
  });

  it("carries duration only on a completion", async () => {
    const { service, calls } = makeService({ assignment: STORED_DIE });
    await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "exposed",
      durationMs: 9999,
    });
    const row = calls.find((c) => c.op === "insert")?.payload as any;
    expect(row.duration_ms).toBeNull();
  });

  it("records nothing that only one arm could produce", async () => {
    // The die can be released half-way; a plain button cannot. An event one arm
    // can produce and the other cannot is a property of the control wearing the
    // costume of a measurement, so no such field exists on the event at all.
    const { service, calls } = makeService({ assignment: STORED_DIE });
    await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "abandoned",
    });
    const row = calls.find((c) => c.op === "insert")?.payload as any;
    expect(Object.keys(row.context).sort()).toEqual([
      "arm",
      "assignment_recorded",
      "bucket",
      "experiment_key",
      "ratio",
      "surface",
    ]);
  });

  it("throws when the ledger write fails, rather than reporting ok", async () => {
    const { service } = makeService({
      assignment: STORED_DIE,
      insertError: "23514 violates check constraint",
    });
    await expect(
      service.recordExperimentEvent({
        experimentKey: "note_close_control",
        restaurantId: HOUSE,
        userId: USER,
        event: "exposed",
      }),
    ).rejects.toThrow(/23514/);
  });
});

describe("experimentReport", () => {
  it("reports this house's own arm and counts, and says it is house-scoped", async () => {
    const { service } = makeService({
      assignment: STORED_DIE,
      counts: { exposed: 12, completed: 9, abandoned: 2 },
      firstEventAt: "2026-09-05T12:01:00.000Z",
    });
    const r = await service.experimentReport("note_close_control", HOUSE);
    expect(r.arm).toBe("die");
    expect(r.exposures).toBe(12);
    expect(r.completed).toBe(9);
    expect(r.abandoned).toBe(2);
    expect(r.since).toBe("2026-09-05T12:01:00.000Z");
    expect(r.houseScopedOnly).toBe(true);
    expect(r.ratio).toEqual({ plain: 80, die: 20 });
  });

  it("filters every count by BOTH the experiment key and the arm", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      counts: { exposed: 1, completed: 1, abandoned: 0 },
    });
    await service.experimentReport("note_close_control", HOUSE);
    const counted = calls.filter((c) => c.op === "count");
    expect(counted).toHaveLength(3);
    for (const c of counted) {
      expect(c.filters["context->>experiment_key"]).toBe("note_close_control");
      expect(c.filters["context->>arm"]).toBe("die");
      expect(c.filters["restaurant_id"]).toBe(HOUSE);
      expect(c.filters["subject_type"]).toBe("operator");
    }
  });

  it("READING DOES NOT ENROL — a report never writes an assignment", async () => {
    const { service, calls } = makeService({ assignment: null });
    const r = await service.experimentReport("note_close_control", HOUSE);
    expect(r.arm).toBeNull();
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
  });

  it("A FAILED COUNT THROWS — it is never zero", async () => {
    // Zero is a real answer this report prints in words ("no exposures yet"), so
    // an error collapsing into it would be absence reported as health in the one
    // place built to report absence.
    const { service } = makeService({
      assignment: STORED_DIE,
      countError: "statement timeout",
    });
    await expect(
      service.experimentReport("note_close_control", HOUSE),
    ).rejects.toThrow(/statement timeout/);
  });

  it("refuses an experiment nobody declared", async () => {
    const { service } = makeService({ assignment: null });
    await expect(
      service.experimentReport("made_up", HOUSE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/* ==========================================================================
 * The end — one quarter from the first exposure, and a winner named once
 * ==========================================================================
 * The founder, 2026-09-05 (batch 45), answering ADR 0127's two open questions:
 * the founder alone reads both arms, and the experiment ends one quarter after
 * its first exposure.
 *
 * WHAT THESE CASES PIN. Every one of them is a way for a measurement to keep
 * running, or to acquire a winner, without anybody deciding:
 *
 *   * an ended experiment must record NOTHING further, or the founder's end is
 *     a suggestion;
 *   * an ended experiment with no winner must report exactly that — printing
 *     the first-declared arm would be a verdict nobody reached;
 *   * a failed read of the window must fail, because "no experiment" reads as
 *     "still running" and quietly resumes recording;
 *   * a house that appears after the end must not be enrolled, or the
 *     denominator grows after the counting stopped;
 *   * the both-arms report must never carry a house's identity beside its arm,
 *     which is the property that makes a cross-house read safe to grant.
 */

const RUNNING_WINDOW = {
  experiment_key: "note_close_control",
  first_exposure_at: "2026-09-05T12:00:00.000Z",
  quarter_days: 91,
  ends_at: "2026-12-05T12:00:00.000Z",
  winner_arm: null,
  winner_named_at: null,
  winner_words: null,
};

const CLOSED_WINDOW = {
  ...RUNNING_WINDOW,
  first_exposure_at: "2026-01-01T12:00:00.000Z",
  ends_at: "2026-04-02T12:00:00.000Z",
};

const CLOSED_WITH_WINNER = {
  ...CLOSED_WINDOW,
  winner_arm: "plain",
  winner_named_at: "2026-04-03T09:00:00.000Z",
  winner_words: "the plain button stays",
};

describe("the window", () => {
  it("leaves a RUNNING experiment exactly as it was", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      state: RUNNING_WINDOW,
    });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    expect(a.arm).toBe("die");
    expect(a.armSource).toBe("assignment");
    expect(a.assignedArm).toBe("die");
    expect(a.running).toBe(true);
    expect(a.winnerArm).toBeNull();
    // The per-house path never derives the window: deriving is a cross-house
    // read and a page load must not pay for one.
    expect(calls.filter((c) => c.table === "ux_experiment_state" && c.op === "upsert")).toHaveLength(0);
  });

  it("gives EVERY house the named winner once the window has closed", async () => {
    const { service } = makeService({
      // This house was shown the die. The founder named `plain`.
      assignment: STORED_DIE,
      state: CLOSED_WITH_WINNER,
    });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    expect(a.arm).toBe("plain");
    expect(a.armSource).toBe("winner");
    expect(a.winnerArm).toBe("plain");
    expect(a.running).toBe(false);
    // The assignment row is KEPT as the record of what this house was shown.
    expect(a.assignedArm).toBe("die");
    expect(a.assignedAt).toBe(STORED_DIE.assigned_at);
  });

  it("NEVER names a default winner — an ended experiment with none says so", async () => {
    const { service } = makeService({
      assignment: STORED_DIE,
      state: CLOSED_WINDOW,
    });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    // Not `plain` because plain is declared first. The house keeps what it was
    // shown until a person names an arm.
    expect(a.arm).toBe("die");
    expect(a.armSource).toBe("assignment");
    expect(a.winnerArm).toBeNull();
    expect(a.running).toBe(false);
  });

  it("does not enrol a new house after the window has closed", async () => {
    const { service, calls } = makeService({ assignment: null, state: CLOSED_WINDOW });
    const a = await service.assignmentFor("note_close_control", HOUSE);
    // A row written now could never carry an exposure, and it would enlarge a
    // denominator nobody was shown anything under.
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
    expect(a.assignedArm).toBeNull();
    expect(a.recorded).toBe(false);
    // The fallback is the product as built, and it SAYS it is a fallback.
    expect(a.arm).toBe("plain");
    expect(a.armSource).toBe("fallback");
    expect(a.bucket).toBe(-1);
  });

  it("A FAILED WINDOW READ THROWS — it is never 'no experiment'", async () => {
    // Folding the error into null would report an ENDED experiment as a running
    // one and quietly resume recording exposures after the founder ended it.
    const { service } = makeService({
      assignment: STORED_DIE,
      stateReadError: "statement timeout",
    });
    await expect(
      service.assignmentFor("note_close_control", HOUSE),
    ).rejects.toThrow(/statement timeout/);
    await expect(
      service.experimentReport("note_close_control", HOUSE),
    ).rejects.toThrow(/statement timeout/);
    await expect(
      service.recordExperimentEvent({
        experimentKey: "note_close_control",
        restaurantId: HOUSE,
        userId: USER,
        event: "exposed",
      }),
    ).rejects.toThrow(/statement timeout/);
  });

  it("refuses to treat an unreadable stored end date as an experiment that runs forever", async () => {
    const { service } = makeService({
      assignment: STORED_DIE,
      state: { ...RUNNING_WINDOW, ends_at: "not a date" },
    });
    await expect(
      service.assignmentFor("note_close_control", HOUSE),
    ).rejects.toThrow(/not a readable time/);
  });
});

describe("recording stops at the end", () => {
  it("records NOTHING once the window has closed, and says why", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      state: CLOSED_WINDOW,
    });
    const r = await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "exposed",
    });
    expect(r.recorded).toBe(false);
    expect(r.reason).toBe("experiment_ended");
    expect(r.arm).toBeNull();
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(0);
    // Nor is a house enrolled on the way past.
    expect(calls.filter((c) => c.op === "upsert")).toHaveLength(0);
  });

  it("stamps the window on the FIRST exposure, first exposure + 91 days", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      state: null,
      firstEventAt: "2026-09-05T12:00:00.000Z",
      stateAfterWrite: RUNNING_WINDOW,
    });
    const r = await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "exposed",
    });
    expect(r.recorded).toBe(true);
    const stamp = calls.find(
      (c) => c.table === "ux_experiment_state" && c.op === "upsert",
    );
    expect(stamp?.payload).toEqual({
      experiment_key: "note_close_control",
      first_exposure_at: "2026-09-05T12:00:00.000Z",
      quarter_days: 91,
      // 13 whole weeks later, to the second.
      ends_at: "2026-12-05T12:00:00.000Z",
    });
    // The first stamp stands; a later one has nothing to correct.
    expect(stamp?.options).toMatchObject({
      onConflict: "experiment_key",
      ignoreDuplicates: true,
    });
  });

  it("derives the window from the ledger's MIN across ALL houses, not this house's", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      state: null,
      firstEventAt: "2026-09-05T12:00:00.000Z",
      stateAfterWrite: RUNNING_WINDOW,
    });
    await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "exposed",
    });
    const derive = calls.find(
      (c) =>
        c.table === "neural_footprint_event" &&
        c.op === "select" &&
        c.filters["choice"] === "exposed" &&
        c.filters["context->>arm"] === undefined,
    );
    expect(derive).toBeDefined();
    // No restaurant filter, on purpose: "first exposure" means the
    // EXPERIMENT'S first exposure. It selects a timestamp and nothing else.
    expect(derive?.filters["restaurant_id"]).toBeUndefined();
  });

  it("does not stamp a window when nothing has been exposed to anybody", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      state: null,
      firstEventAt: null,
    });
    await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "exposed",
    });
    expect(
      calls.filter((c) => c.table === "ux_experiment_state" && c.op === "upsert"),
    ).toHaveLength(0);
  });

  it("does not lose the event when the window stamp fails", async () => {
    const { service, calls } = makeService({
      assignment: STORED_DIE,
      state: null,
      firstEventAt: "2026-09-05T12:00:00.000Z",
      stateWriteError: "permission denied",
    });
    const r = await service.recordExperimentEvent({
      experimentKey: "note_close_control",
      restaurantId: HOUSE,
      userId: USER,
      event: "exposed",
    });
    // The exposure is what the caller asked for and it landed. The stamp is
    // retried on the next exposure, and the admin report derives it itself.
    expect(r.recorded).toBe(true);
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("carries the window through to the house report", async () => {
    const { service } = makeService({
      assignment: STORED_DIE,
      state: CLOSED_WITH_WINNER,
      counts: { exposed: 5, completed: 4, abandoned: 1 },
    });
    const r = await service.experimentReport("note_close_control", HOUSE);
    expect(r.running).toBe(false);
    expect(r.winnerArm).toBe("plain");
    // The counts are this house's real history and are still printed.
    expect(r.exposures).toBe(5);
    expect(r.arm).toBe("die");
  });
});

describe("the both-arms report — platform admin", () => {
  const BOTH = {
    state: CLOSED_WINDOW,
    houses: { plain: 8, die: 2 },
    counts: {
      "plain:exposed": 40,
      "plain:completed": 31,
      "plain:abandoned": 4,
      "die:exposed": 11,
      "die:completed": 7,
      "die:abandoned": 3,
    },
    firstEventAt: "2026-01-01T12:00:00.000Z",
  };

  it("returns every arm's houses, exposures, completions, abandons and first exposure", async () => {
    const { service } = makeService(BOTH);
    const r = await service.adminExperimentReport("note_close_control");
    expect(r.arms.map((a) => a.arm)).toEqual(["plain", "die"]);
    expect(r.arms[0]).toMatchObject({
      arm: "plain",
      sharePct: 80,
      housesAssigned: 8,
      exposures: 40,
      completed: 31,
      abandoned: 4,
      firstExposureAt: "2026-01-01T12:00:00.000Z",
    });
    expect(r.arms[1]).toMatchObject({
      arm: "die",
      sharePct: 20,
      housesAssigned: 2,
      exposures: 11,
      completed: 7,
      abandoned: 3,
    });
    expect(r.firstExposureAt).toBe("2026-01-01T12:00:00.000Z");
    expect(r.endsAt).toBe("2026-04-02T12:00:00.000Z");
    expect(r.quarterDays).toBe(91);
    expect(r.ended).toBe(true);
    expect(r.abandonedIsAFloor).toBe(true);
  });

  it("NEVER carries a house's identity beside its arm", async () => {
    const { service, calls } = makeService(BOTH);
    const r = await service.adminExperimentReport("note_close_control");
    const payload = JSON.stringify(r);
    expect(payload).not.toContain(HOUSE);
    expect(payload).not.toContain(OTHER_HOUSE);
    expect(payload).not.toMatch(/restaurant/i);
    expect(r.houseIdentitiesWithheld).toBe(true);
    // And no row is ever selected: every house figure is a HEAD count.
    const houseReads = calls.filter((c) => c.table === "ux_experiment_assignments");
    expect(houseReads.length).toBeGreaterThan(0);
    for (const c of houseReads) expect(c.op).toBe("count");
  });

  it("says the experiment ended and that NO winner is recorded", async () => {
    const { service } = makeService(BOTH);
    const r = await service.adminExperimentReport("note_close_control");
    expect(r.winnerArm).toBeNull();
    expect(r.endedWithNoWinnerNamed).toBe(true);
    expect(r.running).toBe(false);
    // Nothing anywhere in the payload calls an arm the winner.
    expect(Object.keys(r)).not.toContain("leadingArm");
  });

  it("A FAILED COUNT THROWS — it is never zero", async () => {
    const { service } = makeService({ ...BOTH, countError: "statement timeout" });
    await expect(
      service.adminExperimentReport("note_close_control"),
    ).rejects.toThrow(/statement timeout/);
  });

  it("derives and stores the end date when it is knowable and unstored", async () => {
    const { service, calls } = makeService({
      ...BOTH,
      state: null,
      stateAfterWrite: RUNNING_WINDOW,
    });
    const r = await service.adminExperimentReport("note_close_control");
    expect(
      calls.find((c) => c.table === "ux_experiment_state" && c.op === "upsert"),
    ).toBeDefined();
    expect(r.endsAt).toBe(RUNNING_WINDOW.ends_at);
    expect(r.started).toBe(true);
  });

  it("reports an experiment nothing has been shown for as not started", async () => {
    const { service } = makeService({ ...BOTH, state: null, firstEventAt: null });
    const r = await service.adminExperimentReport("note_close_control");
    expect(r.started).toBe(false);
    expect(r.endsAt).toBeNull();
    expect(r.ended).toBe(false);
    expect(r.endedWithNoWinnerNamed).toBe(false);
  });

  it("A FAILED WINDOW DERIVATION reaches the person reading the end date", async () => {
    const { service } = makeService({
      ...BOTH,
      state: null,
      stateWriteError: "permission denied",
    });
    await expect(
      service.adminExperimentReport("note_close_control"),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses an experiment nobody declared", async () => {
    const { service } = makeService({ state: null });
    await expect(
      service.adminExperimentReport("made_up"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("naming the winner — the sealed admin act", () => {
  it("writes the arm once the window has closed, and only over an unnamed one", async () => {
    const { service, calls } = makeService({
      state: CLOSED_WINDOW,
      stateAfterWrite: CLOSED_WITH_WINNER,
    });
    const r = await service.nameExperimentWinner({
      experimentKey: "note_close_control",
      arm: "plain",
      words: "the plain button stays",
    });
    expect(r.winnerArm).toBe("plain");
    expect(r.alreadyNamed).toBe(false);
    const write = calls.find(
      (c) => c.table === "ux_experiment_state" && c.op === "update",
    );
    expect(write?.payload).toMatchObject({
      winner_arm: "plain",
      winner_words: "the plain button stays",
    });
    // The loser of two simultaneous namings must lose at the database, not at
    // the read above it.
    expect(write?.filters["is:winner_arm"]).toBeNull();
    // The assignment rows are NOT touched: they are the record of what each
    // house was shown and they are kept as history.
    expect(
      calls.filter((c) => c.table === "ux_experiment_assignments" && c.op !== ""),
    ).toHaveLength(0);
  });

  it("refuses an arm the experiment does not declare", async () => {
    const { service, calls } = makeService({ state: CLOSED_WINDOW });
    await expect(
      service.nameExperimentWinner({
        experimentKey: "note_close_control",
        arm: "plane",
      }),
    ).rejects.toThrow(/not an arm of note_close_control/);
    // A typo would otherwise be frozen by the trigger and then served to every
    // house as the product.
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("refuses while the experiment is still running, and says when it ends", async () => {
    const { service, calls } = makeService({ state: RUNNING_WINDOW });
    await expect(
      service.nameExperimentWinner({
        experimentKey: "note_close_control",
        arm: "plain",
      }),
    ).rejects.toThrow(/still running until 2026-12-05/);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("refuses before anything has been exposed to anybody", async () => {
    const { service } = makeService({ state: null, firstEventAt: null });
    await expect(
      service.nameExperimentWinner({
        experimentKey: "note_close_control",
        arm: "plain",
      }),
    ).rejects.toThrow(/no end date yet/);
  });

  it("naming the SAME arm again is idempotent, not an error", async () => {
    const { service, calls } = makeService({ state: CLOSED_WITH_WINNER });
    const r = await service.nameExperimentWinner({
      experimentKey: "note_close_control",
      arm: "plain",
    });
    expect(r.alreadyNamed).toBe(true);
    expect(r.winnerArm).toBe("plain");
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("refuses a DIFFERENT winner once one is named", async () => {
    const { service, calls } = makeService({ state: CLOSED_WITH_WINNER });
    await expect(
      service.nameExperimentWinner({
        experimentKey: "note_close_control",
        arm: "die",
      }),
    ).rejects.toThrow(/already has a winner: "plain"/);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("refuses to report a winner that was written and read back as absent", async () => {
    // The loser of a race: PostgREST does not error when an UPDATE matches no
    // row, so echoing the request would report a decision that was never stored.
    const { service } = makeService({
      state: CLOSED_WINDOW,
      stateAfterWrite: CLOSED_WINDOW,
    });
    await expect(
      service.nameExperimentWinner({
        experimentKey: "note_close_control",
        arm: "plain",
      }),
    ).rejects.toThrow(/read back as absent/);
  });

  it("refuses an experiment nobody declared", async () => {
    const { service } = makeService({ state: CLOSED_WINDOW });
    await expect(
      service.nameExperimentWinner({ experimentKey: "made_up", arm: "plain" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
