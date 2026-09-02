import * as fs from "node:fs";
import * as path from "node:path";
import { Test, TestingModule } from "@nestjs/testing";
import { ProcurementService } from "./procurement.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { OrchestratorService } from "../common/orchestrator/orchestrator.service";
import {
  CalendarEventStatus,
  CalendarEventType,
} from "../calendar/dto/calendar.dto";

/**
 * The two functions that CLOSE the lifecycle of the delivery event that
 * `createCalendarEventForOrder` opens — `cancelCalendarEventForOrder` and
 * `updateCalendarEventForDelivery`. See ADR 0066 for the writer; this file
 * covers the reader/updater counterparts, which were broken the same two ways:
 *
 *  1. They located the event with `.select("id, tags")` and JSON-parsed `tags`
 *     for an `order_id`. `calendar_events` has no `tags` column. PostgREST
 *     answers 42703 — and the destructure took only `data`, so the error was
 *     never read: `events` was `undefined`, `(events || [])` was empty, and the
 *     function returned having done nothing, indistinguishable from a run that
 *     legitimately found no event.
 *  2. They wrote and filtered on uppercase `COMPLETED`/`CANCELLED`. The column
 *     carries no CHECK, so the write would have succeeded and produced a row no
 *     reader recognises, while the filters matched nothing.
 *
 * As in `order-calendar-event.spec.ts`, the column list is DERIVED from
 * `supabase/migrations/` and the derivation fails loudly rather than asserting
 * against an empty set. (That file's derivation is not exported and it sits on
 * an open PR, so this one is deliberately kept separate and compact rather than
 * extracted mid-flight.)
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
    `Could not locate supabase/migrations/ above ${__dirname}. This test ` +
      "cannot verify a column contract it cannot read; failing rather than " +
      "passing vacuously.",
  );
}

function calendarEventColumns(): Set<string> {
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
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
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
    const alterRe =
      /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?calendar_events\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi;
    let a: RegExpExecArray | null;
    while ((a = alterRe.exec(sql)) !== null) columns.add(a[1].toLowerCase());
  }

  // Prove presence before interpreting the set: a parser that matched nothing
  // would make every assertion below vacuously true.
  if (columns.size === 0) {
    throw new Error(
      `Parsed 0 columns for public.calendar_events out of ${files.length} ` +
        "migration file(s). The parser, not the table, is broken.",
    );
  }
  for (const anchor of [
    "id",
    "restaurant_id",
    "event_type",
    "status",
    "order_id",
  ]) {
    if (!columns.has(anchor)) {
      throw new Error(
        `Derived column set for calendar_events is missing "${anchor}". ` +
          "The parse is wrong; refusing to assert against it.",
      );
    }
  }
  return columns;
}

const COLUMNS = calendarEventColumns();

/**
 * Values `public.calendar_events.status` has actually held, measured against
 * project `exzueerziesmczwlhomd` on 2026-09-02 (19 rows, ADR 0066). The column
 * has no CHECK constraint, so a wrong value inserts happily and is then read by
 * nothing — which is why this list is measured rather than taken from the enum.
 */
const STATUSES_PRODUCTION_HOLDS = ["active", "completed", "pending"];

/**
 * Lowercase values `calendar.service.ts` itself writes or branches on:
 * `.update({ status: "cancelled" })` at :612, and the `generateICal` mapping at
 * :1275 (`cancelled`/`dismissed` → CANCELLED, `pending` → TENTATIVE).
 *
 * `cancelled` needs this second list because it has **zero** production rows —
 * and the reason it has zero is the defect under test: nothing has ever
 * successfully cancelled a delivery event. Asserting it against production
 * alone would demand that the bug still be present.
 */
const STATUSES_THE_CALENDAR_HANDLES = ["cancelled", "dismissed", "pending"];

/** The casings that were being written and filtered on, and never matched. */
const UPPERCASE_VOCABULARY = /\b(COMPLETED|CANCELLED|SCHEDULED)\b/;

const REST_ID = "rest-1";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// Harness. The builder is thenable so it can stand in for BOTH shapes: the
// pre-fix select-then-update pair and a single update-returning statement.
// ---------------------------------------------------------------------------

describe("delivery calendar event — closing the lifecycle ADR 0066 opened", () => {
  let service: ProcurementService;
  let builder: any;
  let supabase: any;
  let result: { data: any; error: any };
  let loggerErrorSpy: jest.SpyInstance;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerLogSpy: jest.SpyInstance;

  const order = {
    id: ORDER_ID,
    orderNumber: "ORD-9001",
    quantity: 12,
    deliveredAt: "2026-09-02T10:00:00.000Z",
  } as any;

  beforeEach(async () => {
    jest.clearAllMocks();
    result = { data: [{ id: "cal-event-1" }], error: null };

    builder = {
      select: jest.fn(() => builder),
      update: jest.fn(() => builder),
      insert: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      neq: jest.fn(() => builder),
      not: jest.fn(() => builder),
      in: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      single: jest.fn(() => Promise.resolve(result)),
      maybeSingle: jest.fn(() => Promise.resolve(result)),
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    };
    supabase = { from: jest.fn(() => builder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcurementService,
        {
          provide: DatabaseService,
          useValue: { supabase, getClient: jest.fn(() => supabase) },
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

  /** Every string that reached the query builder, across every call. */
  const builderStrings = (): string[] => {
    const out: string[] = [];
    for (const fn of ["select", "update", "eq", "neq", "not", "in", "limit"]) {
      for (const call of (builder[fn] as jest.Mock).mock.calls) {
        for (const arg of call) {
          out.push(typeof arg === "string" ? arg : JSON.stringify(arg ?? null));
        }
      }
    }
    return out;
  };

  const updatePayload = (): Record<string, unknown> => {
    expect(builder.update).toHaveBeenCalledTimes(1);
    return builder.update.mock.calls[0][0] as Record<string, unknown>;
  };

  const eqPairs = (): [string, unknown][] =>
    builder.eq.mock.calls.map((c: any[]) => [c[0], c[1]] as [string, unknown]);

  // Each case is run against both functions: they are the same defect twice.
  const CASES: {
    name: string;
    call: () => Promise<void>;
    status: CalendarEventStatus;
    /** The measured list that carries this value, and why it is that one. */
    recognisedBy: string[];
    /** Statuses this transition must LEAVE ALONE — the deliberate asymmetry. */
    leavesAlone: CalendarEventStatus[];
    descriptionContains: string;
  }[] = [
    {
      name: "cancelCalendarEventForOrder",
      call: () =>
        (service as any).cancelCalendarEventForOrder(REST_ID, ORDER_ID, order),
      status: CalendarEventStatus.CANCELLED,
      recognisedBy: STATUSES_THE_CALENDAR_HANDLES,
      // A recorded delivery is a physical fact; a later administrative
      // cancellation must not erase it.
      leavesAlone: [
        CalendarEventStatus.COMPLETED,
        CalendarEventStatus.CANCELLED,
      ],
      descriptionContains: "cancelled",
    },
    {
      name: "updateCalendarEventForDelivery",
      call: () =>
        (service as any).updateCalendarEventForDelivery(
          REST_ID,
          ORDER_ID,
          order,
        ),
      status: CalendarEventStatus.COMPLETED,
      recognisedBy: STATUSES_PRODUCTION_HOLDS,
      // Deliberately NOT symmetric: an arrival outranks an earlier
      // cancellation, so a `cancelled` event is still eligible to be closed.
      leavesAlone: [CalendarEventStatus.COMPLETED],
      descriptionContains: "Delivered",
    },
  ];

  it("derives a plausible calendar_events shape from the migrations", () => {
    expect(COLUMNS.size).toBeGreaterThan(10);
    expect(COLUMNS.has("order_id")).toBe(true);
    // The column both functions were scanning does not exist.
    expect(COLUMNS.has("tags")).toBe(false);
  });

  it("has non-empty, all-lowercase vocabularies to assert against", () => {
    // Guards the guard: an empty list would make the status assertions below
    // pass against anything.
    for (const list of [
      STATUSES_PRODUCTION_HOLDS,
      STATUSES_THE_CALENDAR_HANDLES,
    ]) {
      expect(list.length).toBeGreaterThan(0);
      expect(list.filter((s) => s !== s.toLowerCase())).toEqual([]);
      expect(
        list.filter(
          (s) =>
            !Object.values(CalendarEventStatus).includes(
              s as CalendarEventStatus,
            ),
        ).length,
      ).toBeLessThan(list.length);
    }
  });

  for (const c of CASES) {
    describe(c.name, () => {
      it("finds the event by order_id, never by a tags scan", async () => {
        await c.call();

        expect(supabase.from).toHaveBeenCalledWith("calendar_events");
        expect(eqPairs()).toContainEqual(["order_id", ORDER_ID]);
        expect(eqPairs()).toContainEqual(["restaurant_id", REST_ID]);
        expect(eqPairs()).toContainEqual([
          "event_type",
          CalendarEventType.DELIVERY,
        ]);
        // `tags` is not a column; asking for it is a 42703 for the whole query.
        const mentionsTags = builderStrings().filter((s) => /\btags\b/.test(s));
        expect(mentionsTags).toEqual([]);
      });

      it("writes only columns calendar_events actually has", async () => {
        await c.call();
        const unknown = Object.keys(updatePayload()).filter(
          (k) => !COLUMNS.has(k.toLowerCase()),
        );
        expect(unknown).toEqual([]);
      });

      it("writes the lowercase status the calendar can read", async () => {
        await c.call();
        const p = updatePayload();
        expect(p.status).toBe(c.status);
        expect(Object.values(CalendarEventStatus)).toContain(p.status);
        expect(c.recognisedBy).toContain(p.status);
        expect(String(p.status)).toBe(String(p.status).toLowerCase());
        expect(String(p.description)).toContain(c.descriptionContains);
      });

      it("never sends an uppercase status to the database, in a payload or a filter", async () => {
        await c.call();
        const shouty = builderStrings().filter((s) =>
          UPPERCASE_VOCABULARY.test(s),
        );
        expect(shouty).toEqual([]);
      });

      it("leaves exactly the statuses this direction must not reopen", async () => {
        await c.call();

        // Both directions go through one shared body, so the ONLY thing that
        // legitimately differs between them is this filter. Pinned, because it
        // is a decision now and not the accident it used to be: written twice,
        // the two had drifted to `.not(...in...)` and `.neq(...)` for no
        // recorded reason.
        expect(builder.not).toHaveBeenCalledTimes(1);
        const [column, operator, value] = builder.not.mock.calls[0];
        expect(column).toBe("status");
        expect(operator).toBe("in");
        for (const s of c.leavesAlone)
          expect(String(value)).toContain(`"${s}"`);
        const excluded = Object.values(CalendarEventStatus).filter((s) =>
          String(value).includes(`"${s}"`),
        );
        expect(excluded.sort()).toEqual([...c.leavesAlone].sort());
      });

      it("reads the rows back rather than trusting a bare update", async () => {
        await c.call();
        expect(builder.select).toHaveBeenCalledWith("id");
        expect(loggerLogSpy).toHaveBeenCalledTimes(1);
        expect(String(loggerLogSpy.mock.calls[0][0])).toContain("cal-event-1");
      });

      it("READS THE ERROR: a failed query is reported, not swallowed", async () => {
        // The real pre-fix failure: PostgREST 42703 on the absent `tags`
        // column, destructured away and never looked at.
        result = {
          data: null,
          error: {
            code: "42703",
            message: "column calendar_events.tags does not exist",
          },
        };

        await expect(c.call()).resolves.toBeUndefined();
        expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
        expect(loggerLogSpy).not.toHaveBeenCalled();
        const [, ctx] = loggerErrorSpy.mock.calls[0];
        expect(ctx).toMatchObject({ orderId: ORDER_ID, code: "42703" });
      });

      it("states that nothing matched instead of looking like success", async () => {
        result = { data: [], error: null };

        await c.call();
        expect(loggerErrorSpy).not.toHaveBeenCalled();
        expect(loggerLogSpy).not.toHaveBeenCalled();
        expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
        expect(String(loggerWarnSpy.mock.calls[0][0])).toMatch(
          /nothing was (cancelled|completed)/i,
        );
      });

      it("does not throw when the client itself blows up", async () => {
        builder.then = (_res: any, rej: any) =>
          Promise.reject(new Error("socket hang up")).catch(rej);

        await expect(c.call()).resolves.toBeUndefined();
        expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
      });
    });
  }
});
