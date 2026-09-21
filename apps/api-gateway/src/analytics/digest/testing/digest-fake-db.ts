/**
 * An in-memory, Postgres-shaped store for the digest specs — NOT a mock of the
 * service under test.
 *
 * WHY A STORE AND NOT A CHAIN OF STUBS. The sender's one hard promise ("two
 * gateway instances never both mail") rests on a thing a stub cannot model: the
 * UNIQUE `(restaurant_id, user_id, period_key)` index on
 * `recommendation_digest_sends`. A stub that answers "inserted" to every upsert
 * would let a broken sender pass. So this store ENFORCES the unique indexes and
 * the CHECK constraints that `20260917010100_a_digest_goes_to_a_member_who_
 * asked_for_it.sql` declares, and refuses a write that breaks one exactly as
 * PostgREST would — with an error, and without writing any row of the batch.
 * (The same shape `calendar-reminders.service.spec.ts` uses. The migration's own
 * constraints were applied to a real Postgres separately; see the page note.)
 *
 * Only the query-builder surface the digest, the recommendations engine and
 * `ScheduledTenantsService` actually call is implemented. An unimplemented
 * method throws, so a new call cannot silently read as "no rows".
 *
 * Lives in `testing/` beside the specs that share it (the convention of
 * `notifications/producers/testing/fake-db.ts`): no decorators, no side effects,
 * and not a `.spec.ts`, so jest does not collect it on its own.
 */

export type Row = Record<string, any>;

interface UniqueIndex {
  name: string;
  table: string;
  cols: string[];
  where?: (r: Row) => boolean;
}

const UNIQUE_INDEXES: UniqueIndex[] = [
  {
    name: "uq_recommendation_digest_sends_period",
    table: "recommendation_digest_sends",
    cols: ["restaurant_id", "user_id", "period_key"],
  },
  {
    name: "uq_recommendation_digest_sends_token",
    table: "recommendation_digest_sends",
    cols: ["unsubscribe_token_hash"],
    where: (r) => r.unsubscribe_token_hash != null,
  },
  {
    name: "uq_recommendation_digest_subscriptions_member",
    table: "recommendation_digest_subscriptions",
    cols: ["restaurant_id", "user_id"],
  },
];

const OUTCOMES = ["sent", "failed", "skipped_empty", "expired"];

/** The CHECKs of 20260917010100, as predicates over the row AFTER the write. */
const CHECKS: Record<string, Array<[string, (r: Row) => boolean]>> = {
  recommendation_digest_sends: [
    [
      "period_key is a date",
      (r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.period_key)),
    ],
    ["frequency", (r) => ["daily", "weekly"].includes(r.frequency)],
    [
      "time_zone not blank",
      (r) => typeof r.time_zone === "string" && r.time_zone.trim() !== "",
    ],
    [
      "outcome vocabulary",
      (r) => r.outcome == null || OUTCOMES.includes(r.outcome),
    ],
    ["sent_at_means_sent", (r) => r.sent_at == null || r.outcome === "sent"],
    ["sent_has_a_time", (r) => r.outcome !== "sent" || r.sent_at != null],
    [
      "a_miss_says_why",
      (r) =>
        !["failed", "skipped_empty", "expired"].includes(r.outcome) ||
        (typeof r.reason === "string" && r.reason.trim() !== ""),
    ],
    [
      "token hash shape",
      (r) =>
        r.unsubscribe_token_hash == null ||
        /^[0-9a-f]{64}$/.test(r.unsubscribe_token_hash),
    ],
  ],
  recommendation_digest_subscriptions: [
    [
      "frequency (no default)",
      (r) => ["daily", "weekly"].includes(r.frequency),
    ],
    [
      "weekly_names_a_day",
      (r) => (r.frequency === "weekly") === (r.weekday != null),
    ],
    [
      "a_stop_names_its_door",
      (r) => (r.unsubscribed_at == null) === (r.unsubscribed_via == null),
    ],
  ],
};

/**
 * Column defaults as the migration declares them: every nullable column is NULL
 * unless written, and the three NOT NULL DEFAULT now() columns take the time of
 * the write. Without this a row the store returns would lack keys a real row has.
 */
const DEFAULTS: Record<string, () => Row> = {
  recommendation_digest_sends: () => ({
    claimed_at: new Date().toISOString(),
    finished_at: null,
    sent_at: null,
    outcome: null,
    reason: null,
    entries_count: null,
    rule_keys: null,
    rules_evaluated: null,
    engine_generated_at: null,
    provider_message_id: null,
    unsubscribe_token_hash: null,
  }),
  recommendation_digest_subscriptions: () => ({
    weekday: null,
    subscribed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    unsubscribed_at: null,
    unsubscribed_via: null,
  }),
};

type Mode = "select" | "insert" | "upsert" | "update";

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** `table` or `table:mode` → the error message every such call returns. */
  failures: Record<string, string> = {};
  /** Every write attempted, in order, for assertions about what was NOT written. */
  writes: Array<{ table: string; mode: Mode; rows: Row[] }> = [];
  /**
   * When set to N, the first N upserts into `recommendation_digest_sends` wait
   * for each other before any of them writes — two instances that have BOTH
   * passed every pre-read, so only the unique index can stop the second.
   */
  claimBarrier = 0;
  private barrierWaiters: Array<() => void> = [];
  private seq = 0;

  nextId(table: string): string {
    this.seq += 1;
    return `${table}-${this.seq}`;
  }

  rows(table: string): Row[] {
    return this.tables[table] ?? (this.tables[table] = []);
  }

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  /** @internal */
  async waitAtBarrier(): Promise<void> {
    if (this.claimBarrier <= 0) return;
    await new Promise<void>((resolve) => {
      this.barrierWaiters.push(resolve);
      if (this.barrierWaiters.length >= this.claimBarrier) {
        const release = this.barrierWaiters.splice(0);
        this.claimBarrier = 0;
        for (const r of release) r();
      }
    });
  }
}

export class FakeQuery {
  private mode: Mode = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private returning = false;
  private ignoreDuplicates = false;
  private onConflict: string[] = [];
  private orderKey: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_cols?: string) {
    if (this.mode !== "select") this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(
    rows: Row | Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {
    this.mode = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    this.onConflict = (opts?.onConflict ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  in(col: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderKey = col;
    this.orderAsc = opts?.ascending !== false;
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  maybeSingle() {
    return this.run("maybe");
  }
  single() {
    return this.run("single");
  }
  then(resolve: (v: any) => any, reject?: (e: unknown) => any) {
    return this.run("many").then(resolve, reject);
  }

  private failure(): string | null {
    return (
      this.db.failures[`${this.table}:${this.mode}`] ??
      this.db.failures[this.table] ??
      null
    );
  }

  private violated(row: Row): string | null {
    for (const [name, ok] of CHECKS[this.table] ?? []) {
      if (!ok(row))
        return `new row for relation "${this.table}" violates check constraint "${name}"`;
    }
    return null;
  }

  private clash(row: Row, existing: Row[], ignore?: Row): UniqueIndex | null {
    for (const idx of UNIQUE_INDEXES) {
      if (idx.table !== this.table) continue;
      if (idx.where && !idx.where(row)) continue;
      const hit = existing.some(
        (r) =>
          r !== ignore &&
          (!idx.where || idx.where(r)) &&
          idx.cols.every((c) => (r[c] ?? null) === (row[c] ?? null)),
      );
      if (hit) return idx;
    }
    return null;
  }

  private shape(rows: Row[], kind: "many" | "maybe" | "single") {
    if (kind === "many") return { data: rows, error: null };
    if (rows.length > 1) {
      return {
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        },
      };
    }
    if (kind === "single" && rows.length === 0) {
      return {
        data: null,
        error: {
          code: "PGRST116",
          message: "JSON object requested, multiple (or no) rows returned",
        },
      };
    }
    return { data: rows[0] ?? null, error: null };
  }

  private async run(kind: "many" | "maybe" | "single"): Promise<any> {
    const failure = this.failure();
    if (failure) return { data: null, error: { message: failure } };
    const table = this.db.rows(this.table);

    if (this.mode === "insert" || this.mode === "upsert") {
      if (
        this.mode === "upsert" &&
        this.table === "recommendation_digest_sends"
      ) {
        await this.db.waitAtBarrier();
      }
      this.db.writes.push({
        table: this.table,
        mode: this.mode,
        rows: this.payload,
      });
      // One statement: every row is checked before any row is written.
      const staged: Row[] = [];
      for (const raw of this.payload) {
        const row = {
          id: this.db.nextId(this.table),
          ...(DEFAULTS[this.table]?.() ?? {}),
          ...raw,
        };
        const bad = this.violated(row);
        if (bad) return { data: null, error: { code: "23514", message: bad } };
        const idx = this.clash(row, [...table, ...staged]);
        if (idx) {
          const isTheConflictTarget =
            this.mode === "upsert" &&
            this.ignoreDuplicates &&
            idx.cols.join(",") === this.onConflict.join(",");
          if (isTheConflictTarget) continue; // ON CONFLICT (...) DO NOTHING
          return {
            data: null,
            error: {
              code: "23505",
              message: `duplicate key value violates unique constraint "${idx.name}"`,
            },
          };
        }
        staged.push(row);
      }
      table.push(...staged);
      return this.returning
        ? this.shape(staged, kind)
        : { data: null, error: null };
    }

    if (this.mode === "update") {
      const hit = table.filter((r) => this.filters.every((f) => f(r)));
      this.db.writes.push({
        table: this.table,
        mode: "update",
        rows: hit.map(() => this.patch),
      });
      const after = hit.map((r) => ({ ...r, ...this.patch }));
      for (const row of after) {
        const bad = this.violated(row);
        if (bad) return { data: null, error: { code: "23514", message: bad } };
      }
      hit.forEach((r, i) => Object.assign(r, after[i]));
      return this.returning
        ? this.shape(hit, kind)
        : { data: null, error: null };
    }

    let hit = table.filter((r) => this.filters.every((f) => f(r)));
    if (this.orderKey) {
      const key = this.orderKey;
      hit = [...hit].sort((a, b) => {
        const cmp = String(a[key]).localeCompare(String(b[key]));
        return this.orderAsc ? cmp : -cmp;
      });
    }
    if (this.limitN !== null) hit = hit.slice(0, this.limitN);
    return this.shape(
      hit.map((r) => ({ ...r })),
      kind,
    );
  }
}
