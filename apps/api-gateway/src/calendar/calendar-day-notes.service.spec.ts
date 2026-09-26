import { BadRequestException } from "@nestjs/common";
import { CalendarDayNotesService } from "./calendar-day-notes.service";
import { DatabaseService } from "../database/database.service";
import { CalendarDayNoteDocType } from "./dto/calendar.dto";

/**
 * `calendar_day_notes` — its own table, never `calendar_events.description`
 * (founder, 2026-09-21). See the service's own header and
 * `20260926140300_a_meeting_note_gets_its_own_table.sql`.
 *
 * What this suite pins:
 *  - an empty body and a name-by-nobody are both refused with a 400 that
 *    names the reason, before the insert — never a bare constraint 500;
 *  - the insert and the day's own read carry `restaurant_id`, scoping every
 *    write and read to the caller's own house;
 *  - a failed read is an error, never an empty list (absence is not health).
 */

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });
const failed: Answer = { data: null, error: { message: "connection reset" } };

function makeService(opts: {
  insertAnswer?: Answer;
  listAnswer?: Answer;
  captureInsert?: (payload: Record<string, unknown>) => void;
  captureList?: (restaurantId: string, businessDate: string) => void;
  // Every filter the read applied, as [op, column, value], and whether a
  // read was issued at all.
  captureFilters?: (filters: Array<[string, string, unknown]>) => void;
}) {
  const from = (table: string) => {
    if (table !== "calendar_day_notes")
      throw new Error(`unexpected table ${table}`);
    return {
      insert: (payload: Record<string, unknown>) => {
        opts.captureInsert?.(payload);
        return {
          select: () => ({
            single: async () => opts.insertAnswer ?? ok({}),
          }),
        };
      },
      select: () => {
        let restaurantId = "";
        let businessDate = "";
        const filters: Array<[string, string, unknown]> = [];
        const builder = {
          eq: (col: string, val: string) => {
            filters.push(["eq", col, val]);
            if (col === "restaurant_id") restaurantId = val;
            if (col === "business_date") businessDate = val;
            return builder;
          },
          gte: (col: string, val: string) => {
            filters.push(["gte", col, val]);
            return builder;
          },
          lte: (col: string, val: string) => {
            filters.push(["lte", col, val]);
            return builder;
          },
          order: async () => {
            opts.captureList?.(restaurantId, businessDate);
            opts.captureFilters?.(filters);
            return opts.listAnswer ?? ok([]);
          },
        };
        return builder;
      },
    };
  };

  const databaseService = { supabase: { from } } as unknown as DatabaseService;
  return new CalendarDayNotesService(databaseService);
}

const DTO = {
  businessDate: "2026-09-21",
  docType: CalendarDayNoteDocType.MEETING_MEMO,
  eventTitle: "Kavaklıdere tasting",
  body: "Hasan will hold the price.",
};

describe("CalendarDayNotesService.create", () => {
  it("refuses an empty note before writing anything", async () => {
    let inserted = false;
    const svc = makeService({ captureInsert: () => (inserted = true) });
    await expect(
      svc.create("r-1", "u-1", "Ayşe", { ...DTO, body: "   " }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toBe(false);
  });

  it("refuses when the account has no name on file, before writing anything", async () => {
    let inserted = false;
    const svc = makeService({ captureInsert: () => (inserted = true) });
    await expect(svc.create("r-1", "u-1", "  ", DTO)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inserted).toBe(false);
  });

  it("writes the caller's own restaurant_id and userId, trimmed", async () => {
    let captured: Record<string, unknown> | null = null;
    const svc = makeService({
      captureInsert: (p) => (captured = p),
      insertAnswer: ok({
        id: "n-1",
        business_date: "2026-09-21",
        doc_type: "meeting_memo",
        event_title: "Kavaklıdere tasting",
        body: "Hasan will hold the price.",
        author_name: "Ayşe",
        created_at: "2026-09-21T10:00:00Z",
      }),
    });
    const result = await svc.create("r-1", "u-1", "  Ayşe  ", DTO);
    expect(captured).toMatchObject({
      restaurant_id: "r-1",
      author: "u-1",
      author_name: "Ayşe",
      business_date: "2026-09-21",
      doc_type: "meeting_memo",
    });
    expect(result.id).toBe("n-1");
  });

  it("defaults doc_type to general when the caller sends none", async () => {
    const captured: { value: Record<string, unknown> | null } = { value: null };
    const svc = makeService({
      captureInsert: (p) => (captured.value = p),
      insertAnswer: ok({
        id: "n-2",
        business_date: "2026-09-21",
        doc_type: "general",
        event_title: null,
        body: "x",
        author_name: "Ayşe",
        created_at: "2026-09-21T10:00:00Z",
      }),
    });
    await svc.create("r-1", "u-1", "Ayşe", {
      businessDate: "2026-09-21",
      body: "x",
    } as never);
    expect(captured.value?.doc_type).toBe(CalendarDayNoteDocType.GENERAL);
  });

  it("raises the database's own error rather than swallowing it", async () => {
    const svc = makeService({ insertAnswer: failed });
    await expect(svc.create("r-1", "u-1", "Ayşe", DTO)).rejects.toMatchObject({
      message: "connection reset",
    });
  });
});

describe("CalendarDayNotesService.listForDay", () => {
  it("scopes the read to the caller's own restaurant and the requested day", async () => {
    let seen: [string, string] | null = null;
    const svc = makeService({
      captureList: (rid, bd) => (seen = [rid, bd]),
      listAnswer: ok([]),
    });
    await svc.listForDay("r-1", "2026-09-21");
    expect(seen).toEqual(["r-1", "2026-09-21"]);
  });

  it("raises a failed read rather than returning an empty list — absence is not health", async () => {
    const svc = makeService({ listAnswer: failed });
    await expect(svc.listForDay("r-1", "2026-09-21")).rejects.toMatchObject({
      message: "connection reset",
    });
  });

  it("refuses a malformed day with a 400 before reading anything", async () => {
    let read = false;
    const svc = makeService({ captureFilters: () => (read = true) });
    await expect(svc.listForDay("r-1", "21/09/2026")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(read).toBe(false);
  });

  it("maps every row's fields, including a null event_title", async () => {
    const svc = makeService({
      listAnswer: ok([
        {
          id: "n-1",
          business_date: "2026-09-21",
          doc_type: "call_log",
          event_title: null,
          body: "Rang, no answer.",
          author_name: "Hasan",
          created_at: "2026-09-21T09:00:00Z",
        },
      ]),
    });
    const rows = await svc.listForDay("r-1", "2026-09-21");
    expect(rows).toEqual([
      {
        id: "n-1",
        businessDate: "2026-09-21",
        docType: "call_log",
        eventTitle: undefined,
        body: "Rang, no answer.",
        authorName: "Hasan",
        createdAt: "2026-09-21T09:00:00Z",
      },
    ]);
  });
});

describe("CalendarDayNotesService.listForRange", () => {
  it("scopes the read to the caller's own restaurant and the inclusive range", async () => {
    let filters: Array<[string, string, unknown]> = [];
    const svc = makeService({ captureFilters: (f) => (filters = f) });
    await svc.listForRange("r-1", "2026-09-01", "2026-09-30");
    expect(filters).toEqual(
      expect.arrayContaining([
        ["eq", "restaurant_id", "r-1"],
        ["gte", "business_date", "2026-09-01"],
        ["lte", "business_date", "2026-09-30"],
      ]),
    );
  });

  it("raises a failed read rather than returning an empty list — absence is not health", async () => {
    const svc = makeService({ listAnswer: failed });
    await expect(
      svc.listForRange("r-1", "2026-09-01", "2026-09-30"),
    ).rejects.toMatchObject({ message: "connection reset" });
  });

  it.each<[string, string, string]>([
    ["a malformed day", "2026-9-1", "2026-09-30"],
    ["a day that does not exist", "2026-02-31", "2026-03-01"],
    ["a reversed range", "2026-09-30", "2026-09-01"],
    ["a range longer than the cap", "2024-01-01", "2026-09-30"],
  ])("refuses %s with a 400 before reading anything", async (_l, from, to) => {
    let read = false;
    const svc = makeService({ captureFilters: () => (read = true) });
    await expect(svc.listForRange("r-1", from, to)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(read).toBe(false);
  });
});
