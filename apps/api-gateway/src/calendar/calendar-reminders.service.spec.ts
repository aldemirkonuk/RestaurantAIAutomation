/**
 * The calendar reminder sweep, specified against an in-memory Postgres-shaped
 * store rather than a chain of `() => chain` stubs.
 *
 * WHY A REAL STORE. The whole design rests on one thing a stub cannot model:
 * the UNIQUE `(calendar_event_id, user_id)` index on
 * `calendar_reminder_dispatches`. A mock that returns "inserted" for every
 * upsert would let a broken job pass the idempotency test — so the fake below
 * enforces the constraint, and the "never twice" case is proven by running the
 * sweep twice against the same rows and counting sends.
 */

import { CalendarRemindersService } from "./calendar-reminders.service";
import type { ScheduledTenant } from "../communications/scheduled-tenants.service";

/* ── an in-memory store with the constraints that matter ──────────────────── */

type Row = Record<string, any>;

class FakeDb {
  tables: Record<string, Row[]> = {
    calendar_events: [],
    calendar_reminder_dispatches: [],
    calendar_reminder_runs: [],
    notification_preferences: [],
  };
  /** Tables the caller wants to fail, and with what message. */
  failures: Record<string, string> = {};
  private seq = 0;

  id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: "select" | "update" | "delete" | "insert" | "upsert" = "select";
  private payload: Row[] = [];
  private patch: Row = {};
  private limitN: number | null = null;
  private headCount = false;
  private orderKey: string | null = null;
  private orderAsc = true;
  private ignoreDuplicates = false;
  private returning = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.headCount = true;
    if (this.mode === "select") this.mode = "select";
    else this.returning = true;
    return this;
  }
  insert(rows: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Row[], opts?: { ignoreDuplicates?: boolean }) {
    this.mode = "upsert";
    this.payload = rows;
    this.ignoreDuplicates = opts?.ignoreDuplicates === true;
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(col: string, value: any) {
    this.filters.push((r) => r[col] === value);
    return this;
  }
  is(col: string, value: any) {
    this.filters.push((r) => (r[col] ?? null) === value);
    return this;
  }
  in(col: string, values: any[]) {
    this.filters.push((r) => values.includes(r[col]));
    return this;
  }
  gte(col: string, value: any) {
    this.filters.push((r) => String(r[col]) >= String(value));
    return this;
  }
  lte(col: string, value: any) {
    this.filters.push((r) => String(r[col]) <= String(value));
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
  single() {
    return this.run(true);
  }
  then(resolve: any, reject?: any) {
    return this.run(false).then(resolve, reject);
  }

  private matching(): Row[] {
    return (this.db.tables[this.table] ?? []).filter((r) =>
      this.filters.every((f) => f(r)),
    );
  }

  private async run(single: boolean): Promise<any> {
    const failure = this.db.failures[this.table];
    if (failure) return { data: null, error: { message: failure }, count: null };
    const rows = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);

    if (this.mode === "insert" || this.mode === "upsert") {
      const written: Row[] = [];
      for (const row of this.payload) {
        if (
          this.mode === "upsert" &&
          this.table === "calendar_reminder_dispatches" &&
          this.ignoreDuplicates
        ) {
          // THE UNIQUE INDEX. Without it this whole file proves nothing.
          const clash = rows.some(
            (r) =>
              r.calendar_event_id === row.calendar_event_id &&
              r.user_id === row.user_id,
          );
          if (clash) continue;
        }
        const stored = { id: this.db.id(this.table), ...row };
        rows.push(stored);
        written.push(stored);
      }
      const data = single ? (written[0] ?? null) : written;
      return { data, error: null };
    }

    if (this.mode === "update") {
      const hit = this.matching();
      for (const row of hit) Object.assign(row, this.patch);
      return { data: hit, error: null };
    }

    if (this.mode === "delete") {
      const hit = new Set(this.matching());
      this.db.tables[this.table] = rows.filter((r) => !hit.has(r));
      return { data: null, error: null };
    }

    let hit = this.matching();
    if (this.orderKey) {
      const key = this.orderKey;
      hit = [...hit].sort((a, b) =>
        this.orderAsc
          ? String(a[key]).localeCompare(String(b[key]))
          : String(b[key]).localeCompare(String(a[key])),
      );
    }
    if (this.headCount) return { data: null, count: hit.length, error: null };
    if (this.limitN !== null) hit = hit.slice(0, this.limitN);
    return {
      data: single ? (hit[0] ?? null) : hit,
      error: null,
      count: hit.length,
    };
  }
}

/* ── the harness ──────────────────────────────────────────────────────────── */

const TENANT: ScheduledTenant = {
  id: "rest-1",
  name: "Meyhouse Palo Alto",
  timezone: "America/New_York",
  isLegacyDefault: true,
};

function build(members: string[] = ["user-1", "user-2"]) {
  const db = new FakeDb();
  const database = {
    getClient: () => db,
    supabase: db,
    getRestaurantMemberIds: jest.fn().mockResolvedValue(members),
  };
  const notifications = {
    persistForRestaurant: jest
      .fn()
      .mockImplementation(async (_r: string, _p: any, opts: any) => ({
        inserted: (opts?.onlyUserIds ?? members).length,
      })),
  };
  const tenants = {
    list: jest.fn().mockResolvedValue([TENANT]),
    runPerTenant: jest.fn(),
  };
  // Armed, so the behavioural cases below actually run. The disarmed case gets
  // its own test — the flag is off by default in production.
  const config = { get: jest.fn<string | undefined, [string]>(() => "true") };
  const service = new CalendarRemindersService(
    database as any,
    notifications as any,
    tenants as any,
    config as any,
  );
  return { db, database, notifications, tenants, config, service };
}

function event(over: Row = {}): Row {
  return {
    id: over.id ?? "evt-1",
    restaurant_id: "rest-1",
    title: "Terroir Selections delivery",
    event_type: "delivery",
    status: "pending",
    all_day: true,
    // 2026-01-15 all-day => starts 09:00 New York => 14:00Z
    start_date: "2026-01-15",
    event_date: "2026-01-15",
    start_time: null,
    event_time: null,
    reminder_enabled: true,
    reminder_sent: false,
    reminder_days_before: 1,
    ...over,
  };
}

/** 2026-01-14 15:00Z = 10:00 New York — one day before, past the 09:00 due. */
const DUE = new Date("2026-01-14T15:00:00Z");

describe("CalendarRemindersService — it sends once, and only once", () => {
  it("writes a durable notification through persistForRestaurant when a reminder is due", async () => {
    const { db, service, notifications } = build();
    db.tables.calendar_events.push(event());

    const tally = await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const [restaurantId, payload, opts] =
      notifications.persistForRestaurant.mock.calls[0];
    expect(restaurantId).toBe("rest-1");
    expect(payload.type).toBe("calendar_reminder");
    expect(payload.title).toBe("Terroir Selections delivery");
    expect(payload.actionUrl).toBe("/calendar");
    expect(payload.metadata.eventId).toBe("evt-1");
    expect(opts.onlyUserIds.sort()).toEqual(["user-1", "user-2"]);
    expect(tally.sent).toBe(2);
    expect(tally.considered).toBe(1);
  });

  it("does not send twice when the same sweep runs again", async () => {
    const { db, service, notifications } = build();
    db.tables.calendar_events.push(event());

    await service.sweepTenant(TENANT, DUE);
    // reminder_sent is now stamped, so the second sweep sees no candidate…
    const second = await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
  });

  it("does not send twice even if the roll-up flag is lost", async () => {
    // The unique index — not `reminder_sent` — is the thing that prevents a
    // double send. Unstamp the row and sweep again: nothing must go out.
    const { db, service, notifications } = build();
    db.tables.calendar_events.push(event());

    await service.sweepTenant(TENANT, DUE);
    db.tables.calendar_events[0].reminder_sent = false;
    const second = await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
    expect(db.tables.calendar_reminder_dispatches).toHaveLength(2);
  });

  it("stamps reminder_sent and reminder_sent_at — the column that had no writer", async () => {
    const { db, service } = build();
    db.tables.calendar_events.push(event());

    await service.sweepTenant(TENANT, DUE);

    expect(db.tables.calendar_events[0].reminder_sent).toBe(true);
    expect(db.tables.calendar_events[0].reminder_sent_at).toEqual(
      expect.any(String),
    );
  });

  it("leaves a not-yet-due reminder alone", async () => {
    const { db, service, notifications } = build();
    // Six days out with a one-day offset: due 2026-01-19, swept on the 14th.
    db.tables.calendar_events.push(
      event({ start_date: "2026-01-20", event_date: "2026-01-20" }),
    );

    const tally = await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(tally.considered).toBe(0);
    expect(db.tables.calendar_events[0].reminder_sent).toBe(false);
  });

  it("does not remind about a cancelled entry", async () => {
    const { db, service, notifications } = build();
    db.tables.calendar_events.push(event({ status: "cancelled" }));

    await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });
});

describe("CalendarRemindersService — quiet hours", () => {
  const QUIET = new Date("2026-01-14T04:00:00Z"); // 23:00 New York, 13 Jan

  function quietRow(userId: string) {
    return {
      user_id: userId,
      restaurant_id: "rest-1",
      calendar_reminders_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
    };
  }

  it("defers a member inside their window instead of waking them", async () => {
    const { db, service, notifications } = build(["user-1", "user-2"]);
    // Due two days out so the reminder is already due at 23:00 on the 13th.
    db.tables.calendar_events.push(event({ reminder_days_before: 2 }));
    db.tables.notification_preferences.push(quietRow("user-1"));

    const tally = await service.sweepTenant(TENANT, QUIET);

    expect(tally.deferredQuietHours).toBe(1);
    const opts = notifications.persistForRestaurant.mock.calls[0][2];
    expect(opts.onlyUserIds).toEqual(["user-2"]);
    // Not everyone was served, so the roll-up must NOT be stamped.
    expect(db.tables.calendar_events[0].reminder_sent).toBe(false);
  });

  it("serves the deferred member on the next sweep after the window closes, and only them", async () => {
    const { db, service, notifications } = build(["user-1", "user-2"]);
    db.tables.calendar_events.push(event({ reminder_days_before: 2 }));
    db.tables.notification_preferences.push(quietRow("user-1"));

    await service.sweepTenant(TENANT, QUIET);
    // 2026-01-14T15:00Z = 10:00 New York — the window has closed.
    const second = await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(2);
    expect(
      notifications.persistForRestaurant.mock.calls[1][2].onlyUserIds,
    ).toEqual(["user-1"]);
    expect(second.sent).toBe(1);
    expect(db.tables.calendar_events[0].reminder_sent).toBe(true);
  });

  it("skips a member who has turned calendar reminders off, and still rules the entry off", async () => {
    const { db, service, notifications } = build(["user-1", "user-2"]);
    db.tables.calendar_events.push(event());
    db.tables.notification_preferences.push({
      ...quietRow("user-1"),
      calendar_reminders_enabled: false,
      quiet_hours_enabled: false,
    });

    await service.sweepTenant(TENANT, DUE);

    expect(
      notifications.persistForRestaurant.mock.calls[0][2].onlyUserIds,
    ).toEqual(["user-2"]);
    expect(db.tables.calendar_events[0].reminder_sent).toBe(true);
  });

  it("treats a member with no preferences row as reminders-on, quiet-hours-off", async () => {
    const { db, service, notifications } = build(["user-1"]);
    db.tables.calendar_events.push(event({ reminder_days_before: 2 }));

    await service.sweepTenant(TENANT, QUIET);

    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });
});

describe("CalendarRemindersService — it never reports absence as health", () => {
  it("counts an entry whose start has already passed as expired, not sent", async () => {
    const { db, service, notifications } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    // A day AFTER the entry began: the gateway was down.
    const late = new Date("2026-01-16T15:00:00Z");

    const tally = await service.sweepTenant(TENANT, late);

    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(tally.expired).toBe(1);
    expect(tally.sent).toBe(0);
    expect(db.tables.calendar_reminder_dispatches[0].outcome).toBe("expired");
    expect(db.tables.calendar_reminder_dispatches[0].sent_at).toBeNull();
    // And `reminder_sent` stays FALSE: nothing was sent, so a column named
    // reminder_sent must not say otherwise.
    expect(db.tables.calendar_events[0].reminder_sent).toBe(false);
  });

  it("does not re-count an expired entry on every later sweep", async () => {
    const { db, service } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    const late = new Date("2026-01-16T15:00:00Z");

    await service.sweepTenant(TENANT, late);
    const second = await service.sweepTenant(TENANT, late);

    expect(second.expired).toBe(0);
    expect(db.tables.calendar_reminder_dispatches).toHaveLength(1);
  });

  it("treats a funnel that wrote nothing as a failure and releases the claim so it retries", async () => {
    const { db, service, notifications } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    notifications.persistForRestaurant.mockResolvedValueOnce({ inserted: 0 });

    const tally = await service.sweepTenant(TENANT, DUE);

    expect(tally.sent).toBe(0);
    expect(tally.failed).toBe(1);
    // The claim was released, so nothing is permanently undeliverable…
    expect(db.tables.calendar_reminder_dispatches).toHaveLength(0);
    // …and the entry was not ruled off.
    expect(db.tables.calendar_events[0].reminder_sent).toBe(false);

    const second = await service.sweepTenant(TENANT, DUE);
    expect(second.sent).toBe(1);
  });

  it("opens and closes a run row with the counts, so the page can show a real last run", async () => {
    const { db, service } = build(["user-1"]);
    db.tables.calendar_events.push(event());

    await service.sweepTenant(TENANT, DUE);

    expect(db.tables.calendar_reminder_runs).toHaveLength(1);
    const run = db.tables.calendar_reminder_runs[0];
    expect(run.job_name).toBe("calendar-reminders");
    expect(run.started_at).toBe(DUE.toISOString());
    expect(run.finished_at).toEqual(expect.any(String));
    expect(run.considered).toBe(1);
    expect(run.sent).toBe(1);
    expect(run.error).toBeNull();
  });

  it("closes the run row with the error when the sweep throws, and rethrows for runPerTenant", async () => {
    const { db, service } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    db.failures.calendar_events = "connection reset";

    await expect(service.sweepTenant(TENANT, DUE)).rejects.toThrow(
      /could not read calendar_events/,
    );
    expect(db.tables.calendar_reminder_runs[0].error).toMatch(
      /could not read calendar_events/,
    );
    expect(db.tables.calendar_reminder_runs[0].finished_at).toEqual(
      expect.any(String),
    );
  });

  it("aborts the tenant rather than ignoring quiet hours when preferences cannot be read", async () => {
    const { db, service, notifications } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    db.failures.notification_preferences = "permission denied";

    await expect(service.sweepTenant(TENANT, DUE)).rejects.toThrow(
      /could not read notification_preferences/,
    );
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });

  it("sends nothing and records a clean run when the restaurant has no members", async () => {
    const { db, service, notifications } = build([]);
    db.tables.calendar_events.push(event());

    const tally = await service.sweepTenant(TENANT, DUE);

    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(tally.considered).toBe(0);
    expect(db.tables.calendar_reminder_runs[0].finished_at).toEqual(
      expect.any(String),
    );
  });
});

describe("CalendarRemindersService — off by default", () => {
  it("sends nothing, and does not even enumerate tenants, while CALENDAR_REMINDERS_ENABLED is unset", async () => {
    const { service, tenants, config, db } = build(["user-1"]);
    config.get.mockReturnValue(undefined);
    db.tables.calendar_events.push(event());

    await service.sweep();

    expect(tenants.runPerTenant).not.toHaveBeenCalled();
    expect(db.tables.calendar_reminder_runs).toHaveLength(0);
  });

  it("treats anything but 'true'/'1' as OFF, so a typo is silence and not a sender", async () => {
    const { service, tenants, config } = build(["user-1"]);
    for (const value of ["yes", "on", "enabled", "TRUE!", "", "0", "false"]) {
      config.get.mockReturnValue(value);
      await service.sweep();
    }
    expect(tenants.runPerTenant).not.toHaveBeenCalled();

    for (const value of ["true", " TRUE ", "1"]) {
      config.get.mockReturnValue(value);
      await service.sweep();
    }
    expect(tenants.runPerTenant).toHaveBeenCalledTimes(3);
  });

  it("says 'not armed' on the status endpoint rather than promising a next run", async () => {
    const { service, config } = build(["user-1"]);
    config.get.mockReturnValue(undefined);

    const status = await service.statusFor("rest-1", "user-1");

    expect(status.armed).toBe(false);
    expect(status.armedFlag).toBe("CALENDAR_REMINDERS_ENABLED");
    // The house WOULD be served — that is the point of keeping the two separate.
    expect(status.served).toBe(true);
    expect(status.nextRunAt).toBeNull();
  });
});

describe("CalendarRemindersService — the sweep runs under the per-tenant scheduler", () => {
  it("delegates to runPerTenant with the job name, so ADR 0022's isolation applies", async () => {
    const { service, tenants, db } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    tenants.runPerTenant.mockImplementation(
      async (_name: string, body: any) => {
        await body(TENANT);
        return { tenants: 1, succeeded: 1, failed: 0 };
      },
    );

    await service.sweep();

    expect(tenants.runPerTenant).toHaveBeenCalledWith(
      "calendar-reminders",
      expect.any(Function),
    );
    expect(db.tables.calendar_reminder_runs).toHaveLength(1);
  });
});

describe("CalendarRemindersService.statusFor — what the page is allowed to say", () => {
  it("reports the last run, the next scheduled tick and that this house is served", async () => {
    const { db, service } = build(["user-1"]);
    db.tables.calendar_events.push(event());
    await service.sweepTenant(TENANT, DUE);

    const status = await service.statusFor(
      "rest-1",
      "user-1",
      new Date("2026-01-14T15:07:00Z"),
    );

    expect(status.served).toBe(true);
    expect(status.servedReason).toBeNull();
    expect(status.timeZone).toBe("America/New_York");
    expect(status.lastRun?.sent).toBe(1);
    expect(status.lastRun?.finishedAt).toEqual(expect.any(String));
    expect(status.nextRunAt).toBe("2026-01-14T15:15:00.000Z");
    expect(status.ledgerReadable).toBe(true);
    expect(status.armed).toBe(true);
    expect(status.intervalMinutes).toBe(15);
    expect(status.granularity).toBe("days");
    expect(status.deliveredToMe).toBe(1);
  });

  it("says a restaurant the scheduler does not enumerate is NOT served, and promises no next run", async () => {
    const { service } = build(["user-1"]);

    const status = await service.statusFor("rest-other", "user-1");

    expect(status.served).toBe(false);
    expect(status.nextRunAt).toBeNull();
    expect(status.servedReason).toMatch(/scheduled_communications/);
    expect(status.lastRun).toBeNull();
  });

  it("says 'unknown', not 'no', when the opt-in register cannot be read", async () => {
    const { service, tenants } = build(["user-1"]);
    tenants.list.mockRejectedValue(new Error("flags table unreachable"));

    const status = await service.statusFor("rest-1", "user-1");

    expect(status.served).toBeNull();
    expect(status.nextRunAt).toBeNull();
    expect(status.servedReason).toMatch(/flags table unreachable/);
  });

  it("reports the reader's own quiet window, and whether it is a stored one", async () => {
    const { db, service } = build(["user-1"]);
    const status = await service.statusFor("rest-1", "user-1");
    expect(status.viewer.usingDefaults).toBe(true);
    expect(status.viewer.quietHours.enabled).toBe(false);

    db.tables.notification_preferences.push({
      user_id: "user-1",
      restaurant_id: "rest-1",
      calendar_reminders_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start: "23:00",
      quiet_hours_end: "07:30",
    });
    const stored = await service.statusFor("rest-1", "user-1");
    expect(stored.viewer.usingDefaults).toBe(false);
    expect(stored.viewer.quietHours).toEqual({
      enabled: true,
      start: "23:00",
      end: "07:30",
    });
  });

  it("returns null — not zero — for a count the database refused", async () => {
    const { db, service } = build(["user-1"]);
    db.failures.calendar_reminder_dispatches = "statement timeout";

    const status = await service.statusFor("rest-1", "user-1");

    expect(status.unconfirmed).toBeNull();
    expect(status.deliveredToMe).toBeNull();
  });

  it("says the ledger was UNREADABLE rather than 'never run' when the table refuses", async () => {
    const { db, service } = build(["user-1"]);
    db.failures.calendar_reminder_runs = "relation does not exist";

    const status = await service.statusFor("rest-1", "user-1");

    expect(status.ledgerReadable).toBe(false);
    expect(status.lastRun).toBeNull();
  });
});
