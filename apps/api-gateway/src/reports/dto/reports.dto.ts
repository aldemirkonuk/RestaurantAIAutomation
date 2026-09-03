import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsEnum, IsOptional, IsString } from "class-validator";

export enum ReportType {
  INVENTORY_SUMMARY = "inventory_summary",
  SALES_ANALYSIS = "sales_analysis",
  PROCUREMENT_HISTORY = "procurement_history",
  FINANCIAL_SUMMARY = "financial_summary",
  COMPLIANCE_REPORT = "compliance_report",
}

export enum ReportFormat {
  PDF = "pdf",
  EXCEL = "excel",
  CSV = "csv",
}

export class GenerateReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  reportType: ReportType;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  periodStart: string;

  @ApiProperty()
  @IsString()
  periodEnd: string;

  @ApiPropertyOptional()
  @IsOptional()
  parameters?: Record<string, any>;

  @ApiPropertyOptional({ enum: ReportFormat })
  @IsEnum(ReportFormat)
  @IsOptional()
  format?: ReportFormat;
}

export class ScheduleReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  reportType: ReportType;

  @ApiProperty()
  @IsString()
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  parameters?: Record<string, any>;

  @ApiProperty()
  @IsString()
  frequency: string;

  @ApiPropertyOptional()
  @IsOptional()
  dayOfWeek?: number;

  @ApiPropertyOptional()
  @IsOptional()
  dayOfMonth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  timeOfDay?: string;

  @ApiPropertyOptional()
  @IsArray()
  @IsOptional()
  recipients?: string[];
}

export class ReportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty({ enum: ReportType })
  reportType: ReportType;

  @ApiProperty()
  title: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  pdfUrl?: string;

  @ApiPropertyOptional()
  excelUrl?: string;

  @ApiPropertyOptional()
  csvUrl?: string;

  // OD-45. The web Documents page used to read generated_reports straight from
  // Postgres and expected `metadata.description` / `metadata.period`. Neither
  // column exists — the real table carries `summary` and the two period dates.
  // Exposing them here is what lets the page drop the direct client and stop
  // rendering fields that were always undefined.
  @ApiPropertyOptional()
  summary?: string;

  @ApiPropertyOptional()
  periodStart?: string;

  @ApiPropertyOptional()
  periodEnd?: string;

  @ApiPropertyOptional()
  createdAt?: string;
}

export class ReportListResponseDto {
  @ApiProperty({ type: [ReportResponseDto] })
  reports: ReportResponseDto[];

  /**
   * The EXACT count over the whole filtered set, or `null` when the count
   * could not be read. It is nullable rather than falling back to
   * `reports.length`: since ADR 0086 bounded the query, that fallback would
   * silently return the PAGE SIZE as the total — a window rendered as a total,
   * which is the fault ADR 0051 clause 2 and ADR 0086 both exist to forbid.
   * A caller that cannot be told the total must say `—`, not print 100.
   */
  @ApiProperty({ type: Number, nullable: true })
  total: number | null;
}

/** "File to…" — re-file a report under a different type (Sorting Office). */
export class RefileReportDto {
  @ApiProperty({ enum: ReportType })
  @IsEnum(ReportType)
  reportType: ReportType;
}

export class ReportCrossFileRegisterDto {
  @ApiProperty()
  count: number;

  @ApiPropertyOptional()
  sample?: string | null;
}

/**
 * "Cross-filed under" — the other registers holding entries from this
 * report's period. `paper`/`conversations` are null exactly when the report
 * names no period: nothing is invented for a report that covers nothing.
 */
export class ReportCrossFileResponseDto {
  @ApiPropertyOptional()
  periodStart?: string | null;

  @ApiPropertyOptional()
  periodEnd?: string | null;

  @ApiPropertyOptional({ type: ReportCrossFileRegisterDto })
  paper?: ReportCrossFileRegisterDto | null;

  @ApiPropertyOptional({ type: ReportCrossFileRegisterDto })
  conversations?: ReportCrossFileRegisterDto | null;
}

export class ScheduledReportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  restaurantId: string;

  @ApiProperty({ enum: ReportType })
  reportType: ReportType;

  @ApiProperty()
  title: string;

  @ApiProperty()
  frequency: string;

  @ApiPropertyOptional()
  nextRunAt?: string;

  @ApiProperty()
  isActive: boolean;
}
