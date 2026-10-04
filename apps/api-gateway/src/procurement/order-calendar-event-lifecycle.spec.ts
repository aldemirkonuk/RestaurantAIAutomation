import * as fs from "node:fs";
import * as path from "node:path";
import {
  alterTableColumnClauses,
  blankSqlComments,
} from "../common/testing/migration-alter-clauses";
import {
  CalendarEventStatus,
  CalendarEventType,
} from "../calendar/dto/calendar.dto";
import {
  ORDER_GOODS_ARRIVED_STATUSES,
  ORDER_TERMINAL_STATUSES,
} from "./order-transitions";

/**
 * What CLOSES the delivery event that `createCalendarEventForOrder` opens.
 *
 * ADR 0073 gave the gateway two closers, `cancelCalendarEventForOrder` and
 * `updateCalendarEventForDelivery`, called from `cancelOrder` and
 * `markDelivered`. Those were the only two doors that closed an event, while
 * orders also arrive through the receiving door, the order edit, the agents
 * and the console, and the delivered close never moved the date. On Tuzlu
 * Rüzgar 534 of 534 October events stayed pending on 9 October although every
 * one of the 87 whose orders were read had COMPLETED (F-152).
 *
 * ADR 0284 moves the closing to the table: migration
 * `a_delivery_event_follows_its_order` puts an AFTER trigger on
 * `procurement_orders` and one on `calendar_events`. The behaviour is proved
 * against a real Postgres by
 * `supabase/tests/<version>_a_delivery_event_follows_its_order_test.sql`; this
 * file pins what a gateway test CAN pin without a database: the SQL names only
 * columns the table has, writes the calendar's own vocabulary, uses the
 * order-status sets generated from `order-transitions.ts` character for
 * character, keeps the two date pairs written together, and the gateway no
 * longer writes the close itself.
 *
 * As in `order-calendar-event.spec.ts`, the column list is DERIVED from
 * `supabase/migrations/` and every derivation fails loudly rather than
 * asserting against an empty set.
 */

// ---------------------------------------------------------------------------
// The corpus on disk.
// ---------------------------------------------------------------------------

function repoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, "supabase", "migrations"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Could not locate supabase/migrations/ above ${__dirname}. This test ` +
      "cannot verify a column contract it cannot read; failing rather than " +
      "passing vacuously.",
  );
}

const MIGRATIONS_DIR = path.join(repoRoot(), "supabase", "migrations");

function calendarEventColumns(): Set<string> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No .sql files in ${MIGRATIONS_DIR} — cannot derive a column contract.`,
    );
  }

  const columns = new Set<string>();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const create =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?calendar_events\s*\(([\s\S]*?)\n\);/i.exec(
        sql,
      );
    if (create) {
      for (const rawLine of create[1].split("\n")) {
        const line = rawLine.trim().replace(/,$/, "");
        if (!line || line.startsWith("--")) continue;
        if (
          /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(line)
        ) {
          continue;
        }
        const m = /^"?([a-z_][a-z0-9_]*)"?\s+/i.exec(line);
        if (m) columns.add(m[1].toLowerCase());
      }
    }
    // Every ADD COLUMN clause of every ALTER TABLE calendar_events, comments
    // blanked first — the shared reader explains why a statement-level regex
    // went blind (multi-column statements, a `;` inside a comment).
    for (const clause of alterTableColumnClauses(sql)) {
      if (
        clause.table.toLowerCase() === "calendar_events" &&
        clause.op === "ADD"
      ) {
        columns.add(clause.column.toLowerCase());
      }
    }
  }

  if (columns.size === 0) {
    throw new Error(
      `Parsed 0 columns for public.calendar_events out of ${files.length} ` +
        "migration file(s). The parser, not the table, is broken.",
    );
  }
  for (const anchor of ["id", "restaurant_id", "event_type", "status"]) {
    if (!columns.has(anchor)) {
      throw new Error(
        `Derived column set for calendar_events is missing "${anchor}". ` +
          "The parse is wrong; refusing to assert against it.",
      );
    }
  }
  return columns;
}

/** Cited by slug, never by version: the version is assigned at merge. */
const MIGRATION_SLUG = "_a_delivery_event_follows_its_order.sql";

function readTheMigration(): { file: string; text: string } {
  const hits = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(MIGRATION_SLUG));
  if (hits.length !== 1) {
    throw new Error(
      `Expected exactly one migration ending ${MIGRATION_SLUG} in ` +
        `${MIGRATIONS_DIR}, found ${hits.length}. Without it nothing closes a ` +
        "delivery event (ADR 0284).",
    );
  }
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, hits[0]), "utf8");
  // Comments blanked, so prose in the header cannot satisfy an assertion that
  // is about the SQL.
  const text = blankSqlComments(sql);
  if (text.trim().length === 0) {
    throw new Error(`${hits[0]} is empty once its comments are blanked.`);
  }
  return { file: hits[0], text };
}

const COLUMNS = calendarEventColumns();
const { text: SQL } = readTheMigration();

interface CalendarUpdate {
  set: string;
  where: string;
  /** Column names assigned in SET, in order. */
  assigned: string[];
  /** Every `status = '...'` literal written in SET. */
  statuses: string[];
}

/**
 * Every `UPDATE public.calendar_events e SET ... WHERE ...;` in the file.
 * Each assignment starts its own line in the migration, which is what makes a
 * line-start match enough here; a SET that cannot be read throws.
 */
function calendarUpdates(): CalendarUpdate[] {
  const re =
    /UPDATE\s+public\.calendar_events\s+e\s+SET\s+([\s\S]*?)\s+WHERE\s+([\s\S]*?);/gi;
  const out: CalendarUpdate[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(SQL))) {
    const set = m[1];
    const assigned = Array.from(set.matchAll(/^\s*([a-z_]+)\s*=(?!=)/gim)).map(
      (a) => a[1].toLowerCase(),
    );
    const statuses = Array.from(set.matchAll(/\bstatus\s*=\s*'([^']*)'/gi)).map(
      (a) => a[1],
    );
    if (assigned.length === 0) {
      throw new Error(`Read no assignment out of SET:\n${set}`);
    }
    out.push({ set, where: m[2], assigned, statuses });
  }
  return out;
}

const UPDATES = calendarUpdates();

/** How the migration declares a text[] of order statuses. */
function renderSqlArray(values: readonly string[]): string {
  return `ARRAY[${[...values]
    .sort()
    .map((v) => `'${v}'`)
    .join(", ")}]`;
}

/** The body of one plpgsql function in the file, by name. */
function functionBody(name: string): string {
  const re = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`,
    "i",
  );
  const m = re.exec(SQL);
  if (!m) throw new Error(`function public.${name} is not declared`);
  return m[1];
}

// ---------------------------------------------------------------------------

describe("delivery calendar event — closed by the table (ADR 0284)", () => {
  it("derives a plausible calendar_events shape from the migrations", () => {
    expect(COLUMNS.size).toBeGreaterThan(10);
    for (const c of [
      "order_id",
      "event_date",
      "event_time",
      "start_date",
      "start_time",
      "reminder_enabled",
    ]) {
      expect(COLUMNS.has(c)).toBe(true);
    }
    // The column ADR 0073's closers were scanning does not exist.
    expect(COLUMNS.has("tags")).toBe(false);
  });

  it("reads all three calendar writes out of the migration", () => {
    // Guards the guard: fewer would make every per-update assertion below
    // vacuous for the one that went missing.
    expect(UPDATES).toHaveLength(3);
  });

  it("names only columns calendar_events actually has", () => {
    const unknown = UPDATES.flatMap((u) =>
      u.assigned.filter((c) => !COLUMNS.has(c)),
    );
    expect(unknown).toEqual([]);
  });

  it("writes the calendar's own lowercase vocabulary: completed and cancelled", () => {
    const written = new Set(UPDATES.flatMap((u) => u.statuses));
    expect([...written].sort()).toEqual([
      CalendarEventStatus.CANCELLED,
      CalendarEventStatus.COMPLETED,
    ]);
    for (const u of UPDATES) {
      expect(u.statuses).toHaveLength(1);
      expect(u.assigned).toContain("status");
    }
  });

  it("switches the reminder off on every close", () => {
    // The reminder sweep does not skip a completed event, so a closed event
    // with its reminder on is still announced.
    for (const u of UPDATES) {
      expect(u.set).toMatch(/\breminder_enabled\s*=\s*false\b/i);
    }
  });

  // sync_calendar_dates_trigger copies a non-null start_time over event_time on
  // every UPDATE, so writing event_time alone is silently reverted.
  it("writes start_date with event_date and start_time with event_time", () => {
    const pairs: Array<[string, string]> = [
      ["event_date", "start_date"],
      ["event_time", "start_time"],
    ];
    let moved = 0;
    for (const u of UPDATES) {
      for (const [a, b] of pairs) {
        expect(u.assigned.includes(a)).toBe(u.assigned.includes(b));
      }
      if (u.assigned.includes("event_date")) moved += 1;
    }
    // Exactly the arrival-with-a-time write moves the event.
    expect(moved).toBe(1);
  });

  it("finds the order's events by order_id, in the order's house, never through tags", () => {
    for (const u of UPDATES) {
      expect(u.where).toMatch(/\be\.order_id\s*=\s*p_order_id\b/);
      expect(u.where).toMatch(/\be\.restaurant_id\s*=\s*p_restaurant_id\b/);
      expect(u.where).toContain(
        `e.event_type = '${CalendarEventType.DELIVERY}'`,
      );
    }
    expect(SQL).not.toMatch(/\btags\b/i);
    // The order is read in the same house as the event.
    expect(functionBody("delivery_event_follows_its_order")).toMatch(
      /o\.id\s*=\s*p_order_id\s+AND\s+o\.restaurant_id\s*=\s*p_restaurant_id/i,
    );
  });

  it("uses the arrived and not-coming sets generated from order-transitions.ts", () => {
    const arrived = [...ORDER_GOODS_ARRIVED_STATUSES];
    const notComing = ORDER_TERMINAL_STATUSES.filter(
      (s) => !ORDER_GOODS_ARRIVED_STATUSES.includes(s),
    );
    expect(arrived.length).toBeGreaterThan(0);
    expect(notComing.length).toBeGreaterThan(0);
    expect(SQL).toContain(`arrived    text[] := ${renderSqlArray(arrived)};`);
    expect(SQL).toContain(`not_coming text[] := ${renderSqlArray(notComing)};`);
  });

  it("never cancels an event whose delivery was recorded", () => {
    const cancel = UPDATES.filter((u) => u.statuses.includes("cancelled"));
    expect(cancel).toHaveLength(1);
    expect(cancel[0].where).toMatch(
      /NOT\s+IN\s*\(\s*'completed'\s*,\s*'cancelled'\s*\)/i,
    );
  });

  it("declares both triggers and the index the lookup uses", () => {
    expect(SQL).toMatch(
      /CREATE\s+TRIGGER\s+trg_procurement_order_moves_its_delivery_event\s+AFTER\s+UPDATE\s+OF\s+status\s*,\s*delivered_at\s+ON\s+public\.procurement_orders\s+FOR\s+EACH\s+ROW\b/i,
    );
    expect(SQL).toMatch(
      /CREATE\s+TRIGGER\s+trg_delivery_event_is_born_matching_its_order\s+AFTER\s+INSERT\s+ON\s+public\.calendar_events\s+FOR\s+EACH\s+ROW\b/i,
    );
    expect(SQL).toMatch(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_calendar_events_order_delivery\s+ON\s+public\.calendar_events\s*\(\s*order_id\s*\)/i,
    );
  });

  it("never fails the write a trigger rides on", () => {
    for (const name of [
      "procurement_order_moves_its_delivery_event",
      "delivery_event_is_born_matching_its_order",
    ]) {
      const body = functionBody(name);
      expect(body).toMatch(
        /EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+RAISE\s+WARNING/i,
      );
      expect(body).toMatch(/RETURN\s+NULL\s*;/i);
    }
  });

  it("runs with the writer's rights, never as definer", () => {
    expect(SQL).not.toMatch(/SECURITY\s+DEFINER/i);
    // Declared on each of the three functions, as a clause on its own line.
    expect(SQL.match(/^SECURITY\s+INVOKER$/gim) ?? []).toHaveLength(3);
  });

  it("changes no existing row when it is applied", () => {
    // Outside function and DO bodies, no statement writes a row. The backfill
    // of events already stale is a founder fork (ADR 0284), not this file.
    const outside = SQL.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, " ");
    const writes = outside
      .split(";")
      .map((s) => s.trim())
      .filter((s) => /^(UPDATE|INSERT|DELETE|TRUNCATE|MERGE)\b/i.test(s));
    expect(writes).toEqual([]);
  });

  it("leaves no delivery-event close in the gateway", () => {
    const service = fs.readFileSync(
      path.join(__dirname, "procurement.service.ts"),
      "utf8",
    );
    expect(service).not.toMatch(
      /\b(closeDeliveryCalendarEvent|cancelCalendarEventForOrder|updateCalendarEventForDelivery)\b/,
    );
    expect(service).not.toMatch(
      /\.from\(\s*["']calendar_events["']\s*\)\s*\.update\(/,
    );
    // Where the two calls were, a pointer to what replaced them.
    expect(
      (service.match(/migration `a_delivery_event_follows_its_order`/g) ?? [])
        .length,
    ).toBeGreaterThanOrEqual(2);
  });
});
