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

  @ApiPropertyOptional()
  createdAt?: string;
}

export class ReportListResponseDto {
  @ApiProperty({ type: [ReportResponseDto] })
  reports: ReportResponseDto[];

  @ApiProperty()
  total: number;
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
