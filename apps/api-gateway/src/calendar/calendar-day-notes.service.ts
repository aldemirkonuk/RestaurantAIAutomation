import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  CalendarDayNoteDocType,
  CalendarDayNoteResponseDto,
  CreateCalendarDayNoteDto,
} from "./dto/calendar.dto";

/**
 * A day's marginalia — what a human knows that no other table does (ADR 0111
 * §1). Written from `MeetingMemoPrompt` on a labeled calendar entry (provider
 * meeting, call, tasting).
 *
 * Built 2026-09-21 (founder answer 2, "Build all now") to close the gap ADR
 * 0111 already named: `handleMemoSave` in `CalendarPage.tsx` has collected
 * this note and thrown it away since the prompt shipped ("Future: persist to
 * documents API"). See `20260921113800_a_meeting_note_gets_its_own_table.sql`
 * for why this is its own table rather than a write into
 * `calendar_events.description`.
 *
 * A note attaches to a `business_date`, never to a `calendar_events` row —
 * `event_title` is a plain snapshot, kept for display, never a foreign key —
 * so editing or deleting the event this note was written against cannot
 * destroy the note (ADR 0111 §1: only an Entry may be edited on the
 * calendar; a note is drawn on a day, not owned by one row).
 */

interface CalendarDayNoteRow {
  id: string;
  business_date: string;
  doc_type: string;
  event_title: string | null;
  body: string;
  author_name: string;
  created_at: string;
}

const SELECT_COLUMNS =
  "id, business_date, doc_type, event_title, body, author_name, created_at";

/** The longest range one read may ask for — a year of the book and a margin. */
export const MAX_RANGE_DAYS = 400;

/** A real calendar day written YYYY-MM-DD, or null. */
function dayOrNull(value: string | undefined | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  // Date.parse rolls 2026-02-31 over to March; a day that does not round-trip
  // is not a day.
  return new Date(t).toISOString().slice(0, 10) === value ? value : null;
}

@Injectable()
export class CalendarDayNotesService {
  private readonly logger = new Logger(CalendarDayNotesService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  private mapRow(row: CalendarDayNoteRow): CalendarDayNoteResponseDto {
    return {
      id: row.id,
      businessDate: row.business_date,
      docType: row.doc_type as CalendarDayNoteDocType,
      eventTitle: row.event_title ?? undefined,
      body: row.body,
      authorName: row.author_name,
      createdAt: row.created_at,
    };
  }

  async create(
    restaurantId: string,
    userId: string,
    authorName: string,
    dto: CreateCalendarDayNoteDto,
  ): Promise<CalendarDayNoteResponseDto> {
    const body = dto.body.trim();
    if (!body) {
      // The column's own CHECK (btrim(body) <> '') would refuse this too, but
      // failing here names the reason instead of surfacing a bare 500 from a
      // constraint violation.
      throw new BadRequestException("A note needs words — nothing was typed.");
    }
    // Same reasoning: a name-by-nobody is not a state this table admits
    // (calendar_day_notes.author_name CHECK). The JWT carries `name`, but a
    // dev-bypass or an incomplete profile can still hand this an empty
    // string, and a 400 that says so is more useful than a constraint 500.
    const trimmedAuthorName = (authorName || "").trim();
    if (!trimmedAuthorName) {
      throw new BadRequestException(
        "Your account has no name on file, so this note cannot record who wrote it.",
      );
    }

    const { data, error } = await this.databaseService.supabase
      .from("calendar_day_notes")
      .insert({
        restaurant_id: restaurantId,
        business_date: dto.businessDate,
        doc_type: dto.docType ?? CalendarDayNoteDocType.GENERAL,
        event_title: dto.eventTitle ?? null,
        body,
        author: userId,
        author_name: trimmedAuthorName,
      })
      .select(SELECT_COLUMNS)
      .single();

    if (error) {
      this.logger.error({
        message: "Failed to write calendar day note",
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return this.mapRow(data as CalendarDayNoteRow);
  }

  /**
   * Every note in an inclusive range of days, oldest day first. This is what
   * the rebuilt calendar reads to know which ended meetings ALREADY carry a
   * note, so a meeting noted in an earlier session is not listed again as
   * "without a note" after a reload. A failed read is an error — never an
   * empty list: "no notes" read into a read that did not happen would put
   * every noted meeting back on that list.
   */
  async listForRange(
    restaurantId: string,
    from: string,
    to: string,
  ): Promise<CalendarDayNoteResponseDto[]> {
    const start = dayOrNull(from);
    const end = dayOrNull(to);
    if (!start || !end) {
      throw new BadRequestException(
        "from and to must both be real days written YYYY-MM-DD.",
      );
    }
    if (start > end) {
      throw new BadRequestException("from must not be after to.");
    }
    const spanDays =
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
      86_400_000;
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `A range may cover at most ${MAX_RANGE_DAYS} days.`,
      );
    }

    const { data, error } = await this.databaseService.supabase
      .from("calendar_day_notes")
      .select(SELECT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .gte("business_date", start)
      .lte("business_date", end)
      .order("business_date", { ascending: true });

    if (error) {
      this.logger.error({
        message: "Failed to read calendar day notes for a range",
        restaurantId,
        from: start,
        to: end,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row) => this.mapRow(row as CalendarDayNoteRow));
  }

  /** Every note for one house's day, newest first. A failed read is an error — never an empty list. */
  async listForDay(
    restaurantId: string,
    businessDate: string,
  ): Promise<CalendarDayNoteResponseDto[]> {
    if (!dayOrNull(businessDate)) {
      // Was a bare Postgres 500 for a malformed date; the caller's mistake
      // gets a 400 that says so.
      throw new BadRequestException(
        "businessDate must be a real day written YYYY-MM-DD.",
      );
    }
    const { data, error } = await this.databaseService.supabase
      .from("calendar_day_notes")
      .select(SELECT_COLUMNS)
      .eq("restaurant_id", restaurantId)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error({
        message: "Failed to read calendar day notes",
        restaurantId,
        businessDate,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row) => this.mapRow(row as CalendarDayNoteRow));
  }
}
