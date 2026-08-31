import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  GenerateReportDto,
  ReportCrossFileResponseDto,
  ReportListResponseDto,
  ReportResponseDto,
  ReportType,
  ScheduleReportDto,
  ScheduledReportResponseDto,
} from "./dto/reports.dto";

interface GeneratedReportRow {
  id: string;
  restaurant_id: string;
  report_type: string;
  title: string;
  status: string;
  pdf_url: string | null;
  excel_url: string | null;
  csv_url: string | null;
  summary: string | null;
  report_period_start: string | null;
  report_period_end: string | null;
  created_at: string;
}

interface ScheduledReportRow {
  id: string;
  restaurant_id: string;
  report_type: string;
  title: string;
  frequency: string;
  next_run_at: string | null;
  is_active: boolean;
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async generateReport(
    restaurantId: string,
    dto: GenerateReportDto,
  ): Promise<ReportResponseDto> {
    const payload = {
      restaurant_id: restaurantId,
      report_type: dto.reportType,
      report_period_start: dto.periodStart,
      report_period_end: dto.periodEnd,
      title: dto.title,
      report_data: dto.parameters ?? {},
      status: "pending",
    };

    const { data, error } = await this.databaseService.supabase
      .from("generated_reports")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to generate report", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return this.mapReportRow(data as GeneratedReportRow);
  }

  async listReports(restaurantId: string): Promise<ReportListResponseDto> {
    const { data, error, count } = await this.databaseService.supabase
      .from("generated_reports")
      .select("*", { count: "exact" })
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("Failed to list reports", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    const reports = (data || []).map((row) =>
      this.mapReportRow(row as GeneratedReportRow),
    );

    return {
      reports,
      total: count ?? reports.length,
    };
  }

  async getReport(
    restaurantId: string,
    reportId: string,
  ): Promise<ReportResponseDto> {
    const { data, error } = await this.databaseService.supabase
      .from("generated_reports")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("id", reportId)
      .single();

    if (error) {
      this.logger.error("Failed to get report", {
        restaurantId,
        reportId,
        error: error.message,
      });
      throw error;
    }

    return this.mapReportRow(data as GeneratedReportRow);
  }

  /**
   * OD-45. The Documents page deleted rows from `generated_reports` directly
   * through the browser Supabase client; the gateway owned every other operation
   * on this table but had no delete, so there was nothing to route the page to.
   *
   * Scoped by `restaurant_id` as well as `id` — the restaurant comes from the JWT,
   * so a caller cannot delete another tenant's report by guessing a uuid. That
   * scoping is the substantive difference from the client-side delete it replaces.
   */
  async deleteReport(restaurantId: string, reportId: string): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("generated_reports")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("id", reportId);

    if (error) {
      this.logger.error("Failed to delete report", {
        restaurantId,
        reportId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * "File to…" (Sorting Office). Re-files a report under a different type —
   * the human override for the sorter's rules. Scoped like deleteReport, and
   * the change writes a `system_audit_log` row, which the /logs timeline
   * (and the page's own System-log drawer) reads: the re-file files itself.
   * A failed audit write is logged loudly but does not undo the re-file.
   */
  async refileReport(
    restaurantId: string,
    reportId: string,
    reportType: ReportType,
    actorId: string | null,
  ): Promise<ReportResponseDto> {
    const existing = await this.getReport(restaurantId, reportId);

    const { data, error } = await this.databaseService.supabase
      .from("generated_reports")
      .update({ report_type: reportType })
      .eq("restaurant_id", restaurantId)
      .eq("id", reportId)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to refile report", {
        restaurantId,
        reportId,
        error: error.message,
      });
      throw error;
    }

    const { error: auditError } = await this.databaseService.supabase
      .from("system_audit_log")
      .insert({
        actor_type: "user",
        actor_id: actorId,
        action: "report_refiled",
        entity_type: "generated_report",
        entity_id: reportId,
        changes: {
          report_type: { from: existing.reportType, to: reportType },
        },
        restaurant_id: restaurantId,
      });
    if (auditError) {
      this.logger.error("Report refiled but the audit row failed to write", {
        restaurantId,
        reportId,
        error: auditError.message,
      });
    }

    return this.mapReportRow(data as GeneratedReportRow);
  }

  /**
   * "Cross-filed under" (Sorting Office). The other registers holding entries
   * from this report's period: vendor paper (procurement_documents by
   * doc_date) and conversation threads (the production
   * `list_conversation_threads` RPC's window total, date-bounded). A report
   * with no period cross-files to nothing, and says so with nulls — the
   * counts are computed or absent, never invented.
   */
  async getReportCrossFile(
    restaurantId: string,
    reportId: string,
  ): Promise<ReportCrossFileResponseDto> {
    const report = await this.getReport(restaurantId, reportId);
    if (!report.periodStart || !report.periodEnd) {
      return { periodStart: null, periodEnd: null, paper: null, conversations: null };
    }

    const [paperRes, threadsRes] = await Promise.all([
      this.databaseService.supabase
        .from("procurement_documents")
        .select("doc_number", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .gte("doc_date", report.periodStart)
        .lte("doc_date", report.periodEnd)
        .order("doc_date", { ascending: false })
        .limit(1),
      this.databaseService.supabase.rpc("list_conversation_threads", {
        p_restaurant_id: restaurantId,
        p_date_from: report.periodStart,
        p_date_to: report.periodEnd,
        p_limit: 1,
        p_offset: 0,
      }),
    ]);

    if (paperRes.error) {
      this.logger.error("Cross-file paper count failed", {
        restaurantId,
        reportId,
        error: paperRes.error.message,
      });
      throw paperRes.error;
    }
    if (threadsRes.error) {
      this.logger.error("Cross-file thread count failed", {
        restaurantId,
        reportId,
        error: threadsRes.error.message,
      });
      throw threadsRes.error;
    }

    const paperRows = (paperRes.data ?? []) as Array<{ doc_number: string | null }>;
    const threadRows = (threadsRes.data ?? []) as Array<{ total_threads: number | string }>;

    return {
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      paper: {
        count: paperRes.count ?? 0,
        sample: paperRows[0]?.doc_number ?? null,
      },
      conversations: {
        // bigint over the wire — may arrive as a string; zero rows = zero threads
        count: Number(threadRows[0]?.total_threads ?? 0),
      },
    };
  }

  async scheduleReport(
    restaurantId: string,
    dto: ScheduleReportDto,
  ): Promise<ScheduledReportResponseDto> {
    const payload = {
      restaurant_id: restaurantId,
      report_type: dto.reportType,
      title: dto.title,
      parameters: dto.parameters ?? {},
      frequency: dto.frequency,
      day_of_week: dto.dayOfWeek ?? null,
      day_of_month: dto.dayOfMonth ?? null,
      time_of_day: dto.timeOfDay ?? null,
      recipients: dto.recipients ?? [],
      is_active: true,
    };

    const { data, error } = await this.databaseService.supabase
      .from("scheduled_reports")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      this.logger.error("Failed to schedule report", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return this.mapScheduledReportRow(data as ScheduledReportRow);
  }

  async listSchedules(
    restaurantId: string,
  ): Promise<ScheduledReportResponseDto[]> {
    const { data, error } = await this.databaseService.supabase
      .from("scheduled_reports")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error("Failed to list report schedules", {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return (data || []).map((row) =>
      this.mapScheduledReportRow(row as ScheduledReportRow),
    );
  }

  async deleteSchedule(
    restaurantId: string,
    scheduleId: string,
  ): Promise<void> {
    const { error } = await this.databaseService.supabase
      .from("scheduled_reports")
      .delete()
      .eq("restaurant_id", restaurantId)
      .eq("id", scheduleId);

    if (error) {
      this.logger.error("Failed to delete report schedule", {
        restaurantId,
        scheduleId,
        error: error.message,
      });
      throw error;
    }
  }

  private mapReportRow(row: GeneratedReportRow): ReportResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      reportType: row.report_type as any,
      title: row.title,
      status: row.status,
      pdfUrl: row.pdf_url ?? undefined,
      excelUrl: row.excel_url ?? undefined,
      csvUrl: row.csv_url ?? undefined,
      summary: row.summary ?? undefined,
      periodStart: row.report_period_start ?? undefined,
      periodEnd: row.report_period_end ?? undefined,
      createdAt: row.created_at,
    };
  }

  private mapScheduledReportRow(
    row: ScheduledReportRow,
  ): ScheduledReportResponseDto {
    return {
      id: row.id,
      restaurantId: row.restaurant_id,
      reportType: row.report_type as any,
      title: row.title,
      frequency: row.frequency,
      nextRunAt: row.next_run_at ?? undefined,
      isActive: row.is_active,
    };
  }
}
