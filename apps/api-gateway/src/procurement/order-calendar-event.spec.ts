import * as fs from "node:fs";
import * as path from "node:path";
import { Test, TestingModule } from "@nestjs/testing";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import {
  CalendarEventSource,
  CalendarEventStatus,
  CalendarEventType,
} from "../calendar/dto/calendar.dto";

/**
 * `createCalendarEventForOrder` had never once succeeded. See ADR 0066.
 *
 * The point of this file is that it must not be able to pass by looking at
 * nothing. The column list is DERIVED from `supabase/migrations/`, and if the
 * derivation yields an empty or implausible set the suite FAILS rather than
 * quietly asserting a payload against zero known columns — the exact
 * absence-read-as-health shape that let the original defect live.
 */

// ---------------------------------------------------------------------------
// Derive the real shape of public.calendar_events from the migrations on disk.
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
    `Could not locate supabase/migrations/ above ${__dirname}. ` +
      "This test cannot verify a column contract it cannot read; failing " +
      "rather than passing vacuously.",
  );
}

interface TableShape {
  columns: Set<string>;
  /** NOT NULL, no DEFAULT — the caller must supply these on every insert. */
  requiredOnInsert: Set<string>;
}

function readCalendarEventsShape(): TableShape {
  const migrationsDir = path.join(repoRoot(), "supabase", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    throw new Error(
      `No .sql files in ${migrationsDir} — cannot derive a column contract.`,
    );
  }

  const columns = new Set<string>();
  const requiredOnInsert = new Set<string>();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");

    // CREATE TABLE [public.]calendar_events ( ... );
    const create =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?calendar_events\s*\(([\s\S]*?)\n\);/i.exec(
        sql,
      );
    if (create) {
      for (const rawLine of create[1].split("\n")) {
        const line = rawLine.trim().replace(/,$/, "");
        if (!line || line.startsWith("--")) continue;
        // Skip table-level constraints, which start with a keyword not a name.
        if (
          /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(line)
        ) {
          continue;
        }
        const m = /^"?([a-z_][a-z0-9_]*)"?\s+/i.exec(line);
        if (!m) continue;
        const name = m[1].toLowerCase();
        columns.add(name);
        const notNull = /\bNOT\s+NULL\b/i.test(line);
        const hasDefault = /\bDEFAULT\b/i.test(line);
        if (notNull && !hasDefault) requiredOnInsert.add(name);
      }
    }

    // ALTER TABLE [public.]calendar_events ADD COLUMN [IF NOT EXISTS] <name>
    const alterRe =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?calendar_events\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
    let a: RegExpExecArray | null;
    while ((a = alterRe.exec(sql)) !== null) {
      columns.add(a[1].toLowerCase());
    }
  }

  // Prove presence before interpreting the set. A parser that silently matched
  // nothing would make every assertion below vacuously true.
  if (columns.size === 0) {
    throw new Error(
      "Parsed 0 columns for public.calendar_events out of " +
        `${files.length} migration file(s). The parser, not the table, is ` +
        "broken — failing rather than asserting against an empty set.",
    );
  }
  for (const anchor of ["id", "restaurant_id", "event_type", "event_date"]) {
    if (!columns.has(anchor)) {
      throw new Error(
        `Derived column set for calendar_events is missing "${anchor}". ` +
          "The parse is wrong; refusing to assert against it.",
      );
    }
  }

  return { columns, requiredOnInsert };
}

const SHAPE = readCalendarEventsShape();

/**
 * Values `public.calendar_events.status` has actually held, measured against
 * project `exzueerziesmczwlhomd` on 2026-09-02 (19 rows). The column has no
 * CHECK constraint, so a wrong value inserts happily and is simply never read.
 * That is why this list is measured and not merely the DTO enum.
 */
const STATUSES_PRODUCTION_HOLDS = ["active", "completed", "pending"];
/** Same measurement, for `source`. */
const SOURCES_PRODUCTION_HOLDS = ["manual", "system_generated"];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

describe("ProcurementService.createCalendarEventForOrder — writes a row the table accepts", () => {
  let service: ProcurementService;
  let insertSpy: jest.Mock;
  let singleSpy: jest.Mock;
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const order = {
    id: "11111111-1111-4111-8111-111111111111",
    orderNumber: "ORD-9001",
    restaurantId: "rest-1",
    inventoryId: "inv-1",
    providerId: "22222222-2222-4222-8222-222222222222",
    quantity: 12,
    status: "APPROVED",
    isEmergency: false,
  } as any;

  const chain: any = {};

  beforeEach(async () => {
    jest.clearAllMocks();

    singleSpy = jest
      .fn()
      .mockResolvedValue({ data: { id: "cal-event-1" }, error: null });
    insertSpy = jest.fn().mockReturnValue(chain);

    Object.assign(chain, {
      from: jest.fn().mockReturnValue(chain),
      insert: insertSpy,
      select: jest.fn().mockReturnValue(chain),
      eq: jest.fn().mockReturnValue(chain),
      single: singleSpy,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcurementService,
        {
          provide: DatabaseService,
          useValue: { supabase: chain, getClient: jest.fn(() => chain) },
        },
        { provide: EventsService, useValue: { createEvent: jest.fn() } },
        {
          provide: InventoryLedgerService,
          useValue: { recordTransaction: jest.fn() },
        },
        {
          provide: OrchestratorService,
          useValue: { publishEvent: jest.fn(), triggerDraftHttp: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ProcurementService>(ProcurementService);
    loggerErrorSpy = jest
      .spyOn((service as any).logger, "error")
      .mockImplementation(() => {});
    loggerWarnSpy = jest
      .spyOn((service as any).logger, "warn")
      .mockImplementation(() => {});
    loggerLogSpy = jest
      .spyOn((service as any).logger, "log")
      .mockImplementation(() => {});
  });

  const call = (o: any = order, trigger: "approved" | "created" = "approved") =>
    (service as any).createCalendarEventForOrder("rest-1", o, trigger);

  const payload = (): Record<string, unknown> => {
    expect(insertSpy).toHaveBeenCalledTimes(1);
    return insertSpy.mock.calls[0][0] as Record<string, unknown>;
  };

  it("derives a plausible calendar_events shape from the migrations", () => {
    // Guards the guard: if this ever shrinks to nothing the assertions below
    // stop meaning anything, so it is asserted explicitly.
    expect(SHAPE.columns.size).toBeGreaterThan(10);
    expect(SHAPE.columns.has("order_id")).toBe(true);
    expect(SHAPE.columns.has("provider_id")).toBe(true);
    expect(SHAPE.columns.has("source")).toBe(true);
    // The two columns the pre-fix payload invented.
    expect(SHAPE.columns.has("priority")).toBe(false);
    expect(SHAPE.columns.has("tags")).toBe(false);
    // source is NOT NULL with no default — omitting it is a 23502.
    expect(Array.from(SHAPE.requiredOnInsert)).toContain("source");
  });

  it("names only columns calendar_events actually has", async () => {
    await call();
    const unknown = Object.keys(payload()).filter(
      (k) => !SHAPE.columns.has(k.toLowerCase()),
    );
    expect(unknown).toEqual([]);
  });

  it("supplies every NOT NULL column that has no default", async () => {
    await call();
    const p = payload();
    const missing = Array.from(SHAPE.requiredOnInsert).filter(
      (c) => p[c] === undefined || p[c] === null,
    );
    expect(missing).toEqual([]);
  });

  it("carries a non-null source drawn from the vocabulary production holds", async () => {
    await call();
    const p = payload();
    expect(p.source).toBeDefined();
    expect(p.source).not.toBeNull();
    expect(SOURCES_PRODUCTION_HOLDS).toContain(p.source);
    expect(Object.values(CalendarEventSource)).toContain(p.source);
  });

  it("uses a status the table really holds, not SCHEDULED", async () => {
    await call();
    const p = payload();
    expect(STATUSES_PRODUCTION_HOLDS).toContain(p.status);
    expect(Object.values(CalendarEventStatus)).toContain(p.status);
    expect(String(p.status)).toBe(String(p.status).toLowerCase());
  });

  it("uses a real event_type", async () => {
    await call();
    expect(payload().event_type).toBe(CalendarEventType.DELIVERY);
  });

  it("puts identity in the real order_id/provider_id columns", async () => {
    await call();
    const p = payload();
    expect(p.order_id).toBe(order.id);
    expect(p.provider_id).toBe(order.providerId);
    expect(p).not.toHaveProperty("tags");
    expect(p).not.toHaveProperty("priority");
  });

  it("writes provider_id as null rather than undefined when the order has none", async () => {
    await call({ ...order, providerId: undefined });
    expect(payload().provider_id).toBeNull();
  });

  it("keeps the emergency signal, which had no column to go to", async () => {
    await call({ ...order, isEmergency: true });
    const p = payload();
    expect(String(p.title)).toContain("URGENT");
    expect(String(p.title).length).toBeLessThanOrEqual(255);
    expect(String(p.description)).toContain("Emergency");
  });

  it("reads the new row's id back rather than trusting a bare insert", async () => {
    const id = await call();
    expect(chain.select).toHaveBeenCalledWith("id");
    expect(singleSpy).toHaveBeenCalled();
    expect(id).toBe("cal-event-1");
  });

  it("reports a failed insert at error level, does not throw, and returns null", async () => {
    singleSpy.mockResolvedValue({
      data: null,
      error: { message: 'column "priority" does not exist', code: "PGRST204" },
    });

    await expect(call()).resolves.toBeNull();
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    // A warning is what let this defect live for its whole life.
    expect(loggerWarnSpy).not.toHaveBeenCalled();
    expect(loggerLogSpy).not.toHaveBeenCalled();
    const [msg, ctx] = loggerErrorSpy.mock.calls[0];
    expect(String(msg)).toMatch(/NOT created/i);
    expect(ctx).toMatchObject({ orderId: order.id, code: "PGRST204" });
  });

  it("treats 'no error and no row' as a failure, not as success", async () => {
    singleSpy.mockResolvedValue({ data: null, error: null });

    await expect(call()).resolves.toBeNull();
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerLogSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the client itself blows up", async () => {
    singleSpy.mockRejectedValue(new Error("socket hang up"));

    await expect(call()).resolves.toBeNull();
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });
});
