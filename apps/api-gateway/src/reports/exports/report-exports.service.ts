import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseService } from "../../database/database.service";
import type {
  ReportExportFormat,
  ReportExportListResponseDto,
  ReportExportResponseDto,
  ReportExportStatus,
} from "../dto/report-exports.dto";
import { ReportCuttingReader } from "./report-cutting-reader.service";
import {
  EXPORT_CUTTINGS,
  TILL_DAYS_MAX,
  TILL_DAYS_MIN,
  countWithheld,
  isExportableCutting,
  type ExportableCutting,
} from "./report-export-cuttings";
import { renderCsv, renderHtml } from "./report-export-render";
import { exportFileStem } from "./report-export-naming";
import { houseFrame } from "../../common/house-frame";
import { houseToday } from "../../common/house-day";

/** A queued attempt older than this is failed, with that reason, on the next read. */
export const STALE_QUEUED_MS = 10 * 60_000;
/** Mirrors the table's `octet_length <= 5242880` CHECKs, so a too-large file fails in words, not as a constraint error. */
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
/**
 * Exports a house may have in flight at once. A fourth is refused, not queued behind them.
 *
 * A SOFT cap, deliberately. It is counted and then written in two statements, so
 * two requests (two tabs, two gateway instances) that count in the same instant
 * can both start and leave four or five in flight. That is acceptable for what
 * the cap is for — keeping one house from stacking renders on the gateway — and
 * it is not a security property: every export is still the requesting house's,
 * scoped by the token. Making it exact would need the count and the write in one
 * transaction (a trigger or RPC holding a per-house lock); that is not built.
 */
export const MAX_IN_FLIGHT = 3;
/**
 * Exports a house may keep in storage at once. The founder's answer,
 * 2026-09-17: at most 50 per house. Enforced on WRITE (`enforceHouseCap`,
 * called after every successful insert in `requestExport`): the oldest rows
 * beyond the newest 50 are deleted, by `requested_at`. Unlike MAX_IN_FLIGHT
 * this is not a concurrency-sensitive count-then-act guard against a request
 * that must be refused — it is store-then-trim housekeeping run after a
 * write that already succeeded, so a race between two inserts just means the
 * trim runs twice in a row and finds less (or nothing) the second time.
 */
export const MAX_EXPORTS_PER_HOUSE = 50;
/**
 * How long a report export is kept before the retention sweep deletes it.
 * The founder's answer, 2026-09-17: 90 days. Applies to every house alike —
 * there is no per-house override, unlike the mail-retention window in
 * `communications/retention`.
 */
export const EXPORT_RETENTION_DAYS = 90;

const REPORT_EXPORTS_TABLE = "report_exports";

/** Everything but the two bodies — a list never downloads the files. */
const ROW_COLUMNS =
  "id, restaurant_id, cutting, window_days, window_month, title, window_label, status, failure_reason, " +
  "withheld_count, csv_bytes, html_bytes, attempts, requested_at, started_at, finished_at";

interface ExportRow {
  id: string;
  restaurant_id: string;
  cutting: string;
  window_days: number | null;
  /** The till's calendar month, YYYY-MM on the house's calendar (F-1013); never set with window_days. */
  window_month: string | null;
  title: string;
  window_label: string;
  status: ReportExportStatus;
  failure_reason: string | null;
  withheld_count: number | null;
  csv_bytes: number | null;
  html_bytes: number | null;
  attempts: number;
  requested_at: string;
  started_at: string;
  finished_at: string | null;
}

/** What a file name needs from the house: its name and the clock its days are on. */
interface HouseNaming {
  name: string | null;
  zone: string | null;
}

export interface ExportDownload {
  filename: string;
  contentType: string;
  body: string;
}

/** What a request or retry hands back: the row as stored, and the render it started. */
export interface ExportStarted {
  export: ReportExportResponseDto;
  /** Resolves when the attempt has settled to ready or failed. Never rejects. */
  settled: Promise<void>;
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** "July 2026" for 2026-07 — the month as the sheet's month picker names it. */
function monthName(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string")
    return (err as { message: string }).message;
  return "no reason was given";
}

/**
 * OD-81 — a report export that is written, or says why not.
 *
 * `POST /reports/generate` filed a `generated_reports` row marked `pending`
 * that nothing ever filled. This service is the writer that never existed:
 * it reads one cutting through `ReportCuttingReader` (the page's own service
 * calls), writes it to a CSV and a print-ready page, and stores both on a
 * `report_exports` row whose status moves queued -> ready | failed.
 *
 * HONEST STATES, AND WHAT MAKES EACH ONE TRUE
 * -------------------------------------------
 *  - `queued` is written BEFORE any read, so the reader sees the request the
 *    moment it is made — and a render that dies with the process cannot leave
 *    it there forever: any queued attempt older than STALE_QUEUED_MS is failed,
 *    with that reason, the next time this house's exports are read.
 *  - `ready` is written with both files in one update; the table's CHECK
 *    refuses a `ready` row without them.
 *  - `failed` carries the reason the read or the write gave. A register that
 *    did not answer is a failed export, never an export of empty figures.
 *
 * TENANCY
 * -------
 * Every statement is scoped by `restaurant_id` from the token as well as by
 * id, so a foreign house's export id reads as not found — 404, the same answer
 * as an id that does not exist, which says nothing about the other house.
 *
 * STORAGE, ON THE FOUNDER'S WORD (2026-09-17)
 * --------------------------------------------
 * Exports are not kept forever, and not without bound: `enforceHouseCap`
 * trims a house to MAX_EXPORTS_PER_HOUSE (50) right after every write, oldest
 * first, and `sweepExpired` — run daily by `ReportExportRetentionCron` on the
 * gateway's existing `@Cron` schedule — deletes any export past
 * EXPORT_RETENTION_DAYS (90) for every house alike. `listExports` pages past
 * the newest batch with `offset`, so the shelf can show more than the first
 * page without ever pretending the cap or the window do not exist.
 */
@Injectable()
export class ReportExportsService {
  private readonly logger = new Logger(ReportExportsService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly reader: ReportCuttingReader,
  ) {}

  private get db() {
    return this.databaseService.supabase;
  }

  /* ─────────────────────────────────────────────────────────── writes ── */

  async requestExport(
    restaurantId: string,
    actorId: string | null,
    input: { cutting: unknown; days?: unknown; month?: unknown },
  ): Promise<ExportStarted> {
    if (!isExportableCutting(input.cutting))
      throw new BadRequestException(
        `"${String(input.cutting)}" is not a cutting this sheet can export.`,
      );
    const cutting: ExportableCutting = input.cutting;
    const spec = EXPORT_CUTTINGS[cutting];
    const { days, month } = this.windowFor(cutting, input.days, input.month);
    const windowLabel = month
      ? await this.monthWindowLabel(restaurantId, month)
      : spec.window(days);

    await this.failStaleQueued(restaurantId);
    await this.assertRoomInFlight(restaurantId);

    const { data, error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .insert({
        restaurant_id: restaurantId,
        requested_by: actorId,
        cutting,
        window_days: days,
        window_month: month,
        title: spec.title,
        window_label: windowLabel,
        status: "queued",
      })
      .select(ROW_COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error("Failed to queue a report export", {
        restaurantId,
        cutting,
        error: error?.message,
      });
      throw error ?? new InternalServerErrorException("The export could not be queued.");
    }
    const row = data as unknown as ExportRow;

    const { error: auditError } = await this.db.from("system_audit_log").insert({
      actor_type: "user",
      actor_id: actorId,
      action: "report_export_requested",
      entity_type: "report_export",
      entity_id: row.id,
        changes: { cutting, window_days: days, window_month: month },
      restaurant_id: restaurantId,
    });
    if (auditError)
      this.logger.error("Export queued but the audit row failed to write", {
        restaurantId,
        exportId: row.id,
        error: auditError.message,
      });

    // Cap AFTER the write, never instead of it: the export just asked for is
    // always kept, and it is the (now) oldest rows past MAX_EXPORTS_PER_HOUSE
    // that go. A failure here is logged, not thrown — the export the caller
    // asked for has already succeeded, and a trim that could not run today
    // runs again on the next write to this house.
    await this.enforceHouseCap(restaurantId);

    return { export: this.toDto(row), settled: this.settle(row) };
  }

  async retryExport(
    restaurantId: string,
    exportId: string,
  ): Promise<ExportStarted> {
    await this.failStaleQueued(restaurantId);
    const existing = await this.readRow(restaurantId, exportId);
    if (existing.status !== "failed")
      throw new ConflictException(
        existing.status === "ready"
          ? "This export was written; there is nothing to retry."
          : "This export is still being written.",
      );
    // A retry puts a row back in flight exactly as a new request does, so it
    // is held to the same cap — otherwise three queued plus any number of
    // retried failures would all be rendering at once.
    await this.assertRoomInFlight(restaurantId);
    // A month asked for while it ran said ", so far"; the retry re-reads the
    // month as it stands now, so its line is re-said on today's house clock
    // — a month that has since closed is written up as the whole month (F-1072).
    const windowLabel = existing.window_month
      ? await this.monthWindowLabel(restaurantId, existing.window_month)
      : existing.window_label;

    const { data, error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .update({
        status: "queued",
        failure_reason: null,
        finished_at: null,
        window_label: windowLabel,
        attempts: existing.attempts + 1,
        started_at: new Date().toISOString(),
      })
      .eq("id", exportId)
      .eq("restaurant_id", restaurantId)
      .eq("status", "failed")
      .eq("attempts", existing.attempts)
      .select(ROW_COLUMNS)
      .maybeSingle();
    if (error) {
      this.logger.error("Failed to re-queue a report export", {
        restaurantId,
        exportId,
        error: error.message,
      });
      throw error;
    }
    if (!data)
      throw new ConflictException(
        "This export changed while it was being retried. Read it again.",
      );
    const row = data as unknown as ExportRow;
    return { export: this.toDto(row), settled: this.settle(row) };
  }

  /* ──────────────────────────────────────────────────────────── reads ── */

  async listExports(
    restaurantId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<ReportExportListResponseDto> {
    const limit = Math.min(100, Math.max(1, Math.trunc(opts.limit ?? 20) || 20));
    const offset = Math.max(0, Math.trunc(opts.offset ?? 0) || 0);
    await this.failStaleQueued(restaurantId);

    const { data, error, count } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .select(ROW_COLUMNS, { count: "exact" })
      .eq("restaurant_id", restaurantId)
      .order("requested_at", { ascending: false })
      // `range` bounds ROWS; `count: "exact"` still counts the whole filtered
      // set (every export this house has), so a page past the newest 20 can
      // still be told the true total.
      .range(offset, offset + limit - 1);
    if (error) {
      this.logger.error("Failed to list report exports", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }
    const rows = (data ?? []) as unknown as ExportRow[];
    // The house is read only when a row has a file to name: the page polls
    // this list while anything is queued, and a queued row has no name yet.
    const house = rows.some((r) => r.status === "ready")
      ? await this.readHouseNaming(restaurantId)
      : null;
    return {
      exports: rows.map((r) => this.toDto(r, house)),
      total: count ?? null,
    };
  }

  async getExport(
    restaurantId: string,
    exportId: string,
  ): Promise<ReportExportResponseDto> {
    await this.failStaleQueued(restaurantId);
    const row = await this.readRow(restaurantId, exportId);
    const house =
      row.status === "ready" ? await this.readHouseNaming(restaurantId) : null;
    return this.toDto(row, house);
  }

  async downloadExport(
    restaurantId: string,
    exportId: string,
    format: ReportExportFormat,
  ): Promise<ExportDownload> {
    const { data, error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .select(
        `id, cutting, window_days, window_month, status, failure_reason, finished_at, ${format}`,
      )
      .eq("id", exportId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error("Failed to read a report export for download", {
        restaurantId,
        exportId,
        error: error.message,
      });
      throw error;
    }
    if (!data) throw new NotFoundException("No such export for this house.");
    const row = data as unknown as Record<string, unknown>;
    if (row.status === "queued")
      throw new ConflictException("This export is still being written.");
    if (row.status === "failed")
      throw new ConflictException(
        `This export was not written: ${String(row.failure_reason ?? "no reason recorded")}`,
      );
    const body = row[format];
    if (typeof body !== "string")
      throw new InternalServerErrorException(
        "This export is marked ready but its file is missing.",
      );
    const house = await this.readHouseNaming(restaurantId);
    const stem =
      this.fileStem(
        {
          cutting: String(row.cutting),
          window_days:
            typeof row.window_days === "number" ? row.window_days : null,
          window_month:
            typeof row.window_month === "string" ? row.window_month : null,
          finished_at:
            typeof row.finished_at === "string" ? row.finished_at : null,
        },
        house,
      ) ?? `mudavym-${String(row.cutting)}-undated`;
    return {
      filename: `${stem}.${format}`,
      contentType:
        format === "csv" ? "text/csv; charset=utf-8" : "text/html; charset=utf-8",
      body,
    };
  }

  /* ────────────────────────────────────────────────────────── internals ── */

  /**
   * The window the row keeps: a number of days, or a calendar month of the
   * till (F-1013) — never both, so the export cannot be read two ways later.
   */
  private windowFor(
    cutting: ExportableCutting,
    raw: unknown,
    rawMonth: unknown = undefined,
  ): { days: number | null; month: string | null } {
    const spec = EXPORT_CUTTINGS[cutting];
    const hasMonth = rawMonth !== undefined && rawMonth !== null;
    if (!spec.takesWindow) {
      if ((raw !== undefined && raw !== null) || hasMonth)
        throw new BadRequestException(
          `${spec.title} takes no window: the server fixes it (${spec.window(null)}).`,
        );
      return { days: null, month: null };
    }
    if (hasMonth) {
      if (raw !== undefined && raw !== null)
        throw new BadRequestException(
          "Ask for a number of days or a month of the till, not both.",
        );
      if (
        typeof rawMonth !== "string" ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
      )
        throw new BadRequestException(
          "A month is written as year and month, like 2026-07.",
        );
      return { days: null, month: rawMonth };
    }
    if (raw === undefined || raw === null) return { days: 30, month: null };
    if (
      typeof raw !== "number" ||
      !Number.isInteger(raw) ||
      raw < TILL_DAYS_MIN ||
      raw > TILL_DAYS_MAX
    )
      throw new BadRequestException(
        `The till window must be a whole number of days from ${TILL_DAYS_MIN} to ${TILL_DAYS_MAX}.`,
      );
    return { days: raw, month: null };
  }

  /**
   * The line a month export prints under its title — the sheet's own words
   * (`rp-registers-trade.tsx` till window), ", so far" while the month still
   * runs on the house's clock. A month that has not begun there is refused
   * now, rather than queued to fail.
   */
  private async monthWindowLabel(
    restaurantId: string,
    month: string,
  ): Promise<string> {
    const { zone } = await this.readHouseNaming(restaurantId);
    const thisMonth = zone ? houseToday(zone).slice(0, 7) : null;
    if (thisMonth && month > thisMonth)
      throw new BadRequestException(
        `${monthName(month)} has not begun on this house's clock, so there is nothing to write up yet.`,
      );
    return `${monthName(month)} of POS checks${month === thisMonth ? ", so far" : ""}, by the house’s days`;
  }

  /** Refuse to put another export in flight for a house already at MAX_IN_FLIGHT (a soft cap — see there). */
  private async assertRoomInFlight(restaurantId: string): Promise<void> {
    const { count: inFlight, error: countError } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("restaurant_id", restaurantId)
      .eq("status", "queued");
    if (countError) {
      this.logger.error("Could not count exports in flight", {
        restaurantId,
        error: countError.message,
      });
      throw countError;
    }
    if (inFlight === null || inFlight === undefined)
      throw new InternalServerErrorException(
        "The exports in flight could not be counted, so a new one was not started.",
      );
    if (inFlight >= MAX_IN_FLIGHT)
      throw new HttpException(
        `${inFlight} exports are already being written for this house. Wait for one to finish.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  /**
   * Trim a house's exports to MAX_EXPORTS_PER_HOUSE, oldest first, after a
   * write. No `.in()` over a fetched id list: instead it reads the
   * `requested_at` of the row AT the cap boundary (the 50th newest, 0-indexed
   * offset MAX_EXPORTS_PER_HOUSE - 1) and deletes everything strictly older —
   * one read, one delete, both filters the store already supports. Fewer than
   * MAX_EXPORTS_PER_HOUSE rows for this house: no boundary row comes back,
   * nothing is deleted.
   */
  private async enforceHouseCap(restaurantId: string): Promise<void> {
    const { data, error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .select("requested_at")
      .eq("restaurant_id", restaurantId)
      .order("requested_at", { ascending: false })
      .range(MAX_EXPORTS_PER_HOUSE - 1, MAX_EXPORTS_PER_HOUSE - 1);
    if (error) {
      this.logger.error("Could not read this house's export-cap boundary", {
        restaurantId,
        error: error.message,
      });
      return;
    }
    const boundary = ((data ?? [])[0] as { requested_at?: string } | undefined)?.requested_at;
    if (!boundary) return; // at or under the cap already

    const { error: deleteError } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .delete()
      .eq("restaurant_id", restaurantId)
      .lt("requested_at", boundary);
    if (deleteError)
      this.logger.error("Could not trim this house's exports to its cap", {
        restaurantId,
        cap: MAX_EXPORTS_PER_HOUSE,
        error: deleteError.message,
      });
    else
      this.logger.log(
        `report exports: house ${restaurantId} trimmed to its cap of ${MAX_EXPORTS_PER_HOUSE}.`,
      );
  }

  /**
   * The daily retention sweep's work (founder's answer, 2026-09-17: 90 days,
   * every house alike). Deletes unconditionally on age — `requested_at` past
   * the cutoff — with no per-house exception, so it is IDEMPOTENT (a second
   * run against the same clock finds only what the first run left, which is
   * nothing new) and SAFE FROM SEVERAL INSTANCES AT ONCE (two gateways
   * computing the same cutoff and both issuing
   * `DELETE ... WHERE requested_at < cutoff` is exactly one delete of the
   * expired rows, however many processes race to run it — a `DELETE` with no
   * matching rows is a no-op, not an error). The count is read before the
   * delete for logging only, so under a genuine race the logged figure can
   * overcount what a single instance actually removed; the delete itself
   * removes only what still matches, once.
   */
  async sweepExpired(): Promise<{ deleted: number }> {
    const cutoff = new Date(
      Date.now() - EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { count, error: countError } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .select("id", { count: "exact", head: true })
      .lt("requested_at", cutoff);
    if (countError) {
      this.logger.error("Report export retention: could not count expired exports", {
        error: countError.message,
      });
      throw countError;
    }

    const { error: deleteError } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .delete()
      .lt("requested_at", cutoff);
    if (deleteError) {
      this.logger.error("Report export retention: could not delete expired exports", {
        error: deleteError.message,
      });
      throw deleteError;
    }

    return { deleted: count ?? 0 };
  }

  private async readRow(restaurantId: string, exportId: string): Promise<ExportRow> {
    const { data, error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .select(ROW_COLUMNS)
      .eq("id", exportId)
      .eq("restaurant_id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error("Failed to read a report export", {
        restaurantId,
        exportId,
        error: error.message,
      });
      throw error;
    }
    if (!data) throw new NotFoundException("No such export for this house.");
    return data as unknown as ExportRow;
  }

  /**
   * A queued attempt that has run past the limit did not finish: the process
   * that owned it restarted, or a read hung. Left alone it would say
   * "being written" forever, which is the one status it is not. Failing it
   * makes it retryable and says why. A write that fails here fails the read
   * that triggered it — a list that could not correct a stale row would
   * present that row's lie as current.
   */
  private async failStaleQueued(restaurantId: string): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_QUEUED_MS).toISOString();
    const { error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .update({
        status: "failed",
        failure_reason: `Abandoned: the export did not finish within ${STALE_QUEUED_MS / 60_000} minutes of starting — the gateway restarted or a register did not answer. Nothing was written; try again.`,
        finished_at: new Date().toISOString(),
      })
      .eq("restaurant_id", restaurantId)
      .eq("status", "queued")
      .lt("started_at", cutoff);
    if (error) {
      this.logger.error("Could not fail stale queued exports", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * The attempt the controller does not wait for. It must never reject: an
   * unhandled rejection would take the process down, and the row would be left
   * queued until the stale sweep. A throw that escapes `run` (a client that
   * threw instead of returning an error) is logged here; the row is then
   * failed by the sweep within STALE_QUEUED_MS, with that reason.
   */
  private settle(row: ExportRow): Promise<void> {
    return this.run(row).catch((err) => {
      this.logger.error("A report export attempt threw outside its own handling", {
        restaurantId: row.restaurant_id,
        exportId: row.id,
        error: messageOf(err),
      });
    });
  }

  /** Render one attempt and settle it. Every outcome it can see is written to the row. */
  private async run(row: ExportRow): Promise<void> {
    const cutting = row.cutting as ExportableCutting;
    const spec = EXPORT_CUTTINGS[cutting];
    let csv: string;
    let html: string;
    let withheldCount: number;
    try {
      const payload = await this.reader
        .read(row.restaurant_id, cutting, row.window_days, row.window_month)
        .catch((err) => {
          throw new Error(`the ${spec.title} register could not be read: ${messageOf(err)}`);
        });
      const { data: house, error: houseError } = await this.db
        .from("restaurants")
        .select("name, currency, timezone, country")
        .eq("id", row.restaurant_id)
        .maybeSingle();
      if (houseError)
        throw new Error(`the house's name and currency could not be read: ${houseError.message}`);
      if (!house) throw new Error("the house this export belongs to could not be found");

      // The writer knows the header's money, so a figure given in another
      // currency is not written under it as the house's (F-1145).
      const doc = spec.write(payload, {
        days: row.window_days,
        currency:
          typeof house.currency === "string" && house.currency
            ? house.currency
            : null,
      });

      withheldCount = countWithheld(doc);
      const header = {
        houseName: typeof house.name === "string" && house.name ? house.name : null,
        currency: typeof house.currency === "string" && house.currency ? house.currency : null,
        title: row.title,
        windowLabel: row.window_label,
        writtenAt: new Date().toISOString(),
        // The same zone the till files its days on (`readHouseZone`), so
        // "Written" and the days in the file are one clock (F-413).
        timezone: houseFrame(
          house as { timezone?: string | null; country?: string | null },
        ).zone,
        // The printed file groups its figures the house's way (F-889).
        locale: houseFrame(
          house as { timezone?: string | null; country?: string | null },
        ).locale,
        withheldCount,
      };
      csv = renderCsv(doc, header);
      html = renderHtml(doc, header);
      if (byteLength(csv) > MAX_ARTIFACT_BYTES || byteLength(html) > MAX_ARTIFACT_BYTES)
        throw new Error(
          `the written files are larger than the ${MAX_ARTIFACT_BYTES / (1024 * 1024)} MB an export may hold`,
        );
    } catch (err) {
      await this.settleFailed(row, `Not written: ${messageOf(err)}`);
      return;
    }

    const { data, error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .update({
        status: "ready",
        failure_reason: null,
        csv,
        html,
        csv_bytes: byteLength(csv),
        html_bytes: byteLength(html),
        withheld_count: withheldCount,
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("restaurant_id", row.restaurant_id)
      // Only THIS attempt, and only while it is still queued. A row the stale
      // sweep already failed stays failed: queued -> ready | failed is the whole
      // state machine, and failed -> ready without a retry is not in it.
      .eq("attempts", row.attempts)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (error || !data) {
      this.logger.error("A report export was written but could not be stored", {
        restaurantId: row.restaurant_id,
        exportId: row.id,
        error: error?.message ?? "no row matched this attempt",
      });
      if (error)
        await this.settleFailed(
          row,
          `Not stored: the files were written but saving them failed: ${error.message}`,
        );
    }
  }

  private async settleFailed(row: ExportRow, reason: string): Promise<void> {
    const { error } = await this.db
      .from(REPORT_EXPORTS_TABLE)
      .update({
        status: "failed",
        failure_reason: reason.slice(0, 2000),
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("restaurant_id", row.restaurant_id)
      .eq("attempts", row.attempts)
      .eq("status", "queued");
    if (error)
      // The row stays queued; the stale sweep fails it within STALE_QUEUED_MS.
      this.logger.error("A report export failed and the failure could not be recorded", {
        restaurantId: row.restaurant_id,
        exportId: row.id,
        reason,
        error: error.message,
      });
  }

  /**
   * The house's name and zone, for a file name. Read by key. The file is
   * already written, so a failed read never blocks listing or downloading it
   * (F-784): it falls back to the neutral name, no house name and no zone, which
   * `exportFileStem` dates on UTC and marks `-utc` rather than passing UTC off
   * as the house's day. Only the name falls back: writing an export (`run`)
   * still fails it when this same row cannot be read.
   */
  private async readHouseNaming(restaurantId: string): Promise<HouseNaming> {
    const { data, error } = await this.db
      .from("restaurants")
      .select("name, timezone, country")
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) {
      this.logger.error(
        "Failed to read the house for an export's file name; naming it neutrally",
        {
          restaurantId,
          error: error.message,
        },
      );
      return { name: null, zone: null };
    }
    const h = (data ?? null) as {
      name?: unknown;
      timezone?: string | null;
      country?: string | null;
    } | null;
    return {
      name: typeof h?.name === "string" && h.name ? h.name : null,
      zone: houseFrame(h).zone,
    };
  }

  private fileStem(
    row: Pick<
      ExportRow,
      "cutting" | "window_days" | "window_month" | "finished_at"
    >,
    house: HouseNaming | null,
  ): string | null {
    if (!house) return null;
    return exportFileStem({
      cutting: row.cutting,
      windowDays: row.window_days,
      windowMonth: row.window_month,
      finishedAt: row.finished_at,
      houseName: house.name,
      zone: house.zone,
    });
  }

  private toDto(
    row: ExportRow,
    house: HouseNaming | null = null,
  ): ReportExportResponseDto {
    return {
      id: row.id,
      cutting: row.cutting,
      title: row.title,
      windowLabel: row.window_label,
      windowDays: row.window_days,
      windowMonth: row.window_month ?? null,
      status: row.status,
      failureReason: row.failure_reason,
      withheldCount: row.withheld_count,
      csvBytes: row.csv_bytes,
      htmlBytes: row.html_bytes,
      attempts: row.attempts,
      requestedAt: row.requested_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      fileStem: row.status === "ready" ? this.fileStem(row, house) : null,
    };
  }
}
