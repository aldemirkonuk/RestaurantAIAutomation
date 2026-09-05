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
  counts?: Record<string, number>;
  firstEventAt?: string | null;
}

function makeDb(stub: Stub) {
  const calls: Call[] = [];

  const client: any = {
    from(table: string) {
      const entry: Call = { table, op: "", filters: {} };
      calls.push(entry);

      const result = (): { data: any; error: any; count?: number | null } => {
        if (table === "ux_experiment_assignments") {
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
          const key = String(entry.filters["choice"]);
          return { data: null, error: null, count: stub.counts?.[key] ?? 0 };
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
        eq: (col: string, v: unknown) => {
          entry.filters[col] = v;
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
