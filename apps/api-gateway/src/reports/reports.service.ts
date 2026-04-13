import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  GenerateReportDto,
  ReportListResponseDto,
  ReportResponseDto,
  ScheduleReportDto,
  ScheduledReportResponseDto,
} from './dto/reports.dto';

interface GeneratedReportRow {
  id: string;
  restaurant_id: string;
  report_type: string;
  title: string;
  status: string;
  pdf_url: string | null;
  excel_url: string | null;
  csv_url: string | null;
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
      status: 'pending',
    };

    const { data, error } = await this.databaseService.supabase
      .from('generated_reports')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to generate report', {
        restaurantId,
        error: error.message,
      });
      throw error;
    }

    return this.mapReportRow(data as GeneratedReportRow);
  }

  async listReports(restaurantId: string): Promise<ReportListResponseDto> {
    const { data, error, count } = await this.databaseService.supabase
      .from('generated_reports')
      .select('*', { count: 'exact' })
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list reports', {
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
      .from('generated_reports')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .eq('id', reportId)
      .single();

    if (error) {
      this.logger.error('Failed to get report', {
        restaurantId,
        reportId,
        error: error.message,
      });
      throw error;
    }

    return this.mapReportRow(data as GeneratedReportRow);
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
      .from('scheduled_reports')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      this.logger.error('Failed to schedule report', {
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
      .from('scheduled_reports')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list report schedules', {
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
      .from('scheduled_reports')
      .delete()
      .eq('restaurant_id', restaurantId)
      .eq('id', scheduleId);

    if (error) {
      this.logger.error('Failed to delete report schedule', {
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
      createdAt: row.created_at,
    };
  }

  private mapScheduledReportRow(row: ScheduledReportRow): ScheduledReportResponseDto {
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
