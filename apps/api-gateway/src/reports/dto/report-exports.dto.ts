import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import {
  EXPORTABLE_CUTTINGS,
  TILL_DAYS_MAX,
  TILL_DAYS_MIN,
  type ExportableCutting,
} from "../exports/report-export-cuttings";

export const REPORT_EXPORT_STATUSES = ["queued", "ready", "failed"] as const;
export type ReportExportStatus = (typeof REPORT_EXPORT_STATUSES)[number];

export const REPORT_EXPORT_FORMATS = ["csv", "html"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

/**
 * Ask for one cutting of the /reports sheet to be written up.
 *
 * No `restaurantId`: the house is the one on the token, and a body that named
 * one would be refused by the tenant check before it reached the service.
 */
export class RequestReportExportDto {
  @ApiProperty({ enum: EXPORTABLE_CUTTINGS })
  @IsIn(EXPORTABLE_CUTTINGS as unknown as string[])
  cutting: ExportableCutting;

  /**
   * The till window in days — only for `till`, whose endpoint is the one that
   * takes a window. Any other cutting refuses a window rather than ignoring it:
   * its window is fixed by the server, and an export labelled "7 days" over a
   * 365-day computation would be a lie with a filename.
   */
  @ApiPropertyOptional({ minimum: TILL_DAYS_MIN, maximum: TILL_DAYS_MAX })
  @IsOptional()
  @IsInt()
  @Min(TILL_DAYS_MIN)
  @Max(TILL_DAYS_MAX)
  days?: number;
}

export class ReportExportResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: EXPORTABLE_CUTTINGS })
  cutting: string;

  @ApiProperty({ description: "The cutting's title as the page prints it." })
  title: string;

  @ApiProperty({ description: "The window line the page prints under the title." })
  windowLabel: string;

  @ApiProperty({ type: Number, nullable: true })
  windowDays: number | null;

  @ApiProperty({ enum: REPORT_EXPORT_STATUSES })
  status: ReportExportStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Why the export was not written. Present exactly when status is failed.",
  })
  failureReason: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Figures written as withheld rather than as a number. Null until written.",
  })
  withheldCount: number | null;

  @ApiProperty({ type: Number, nullable: true })
  csvBytes: number | null;

  @ApiProperty({ type: Number, nullable: true })
  htmlBytes: number | null;

  @ApiProperty()
  attempts: number;

  @ApiProperty()
  requestedAt: string;

  @ApiProperty({ description: "When the current attempt began." })
  startedAt: string;

  @ApiProperty({ type: String, nullable: true })
  finishedAt: string | null;
}

export class ReportExportListResponseDto {
  @ApiProperty({ type: [ReportExportResponseDto] })
  exports: ReportExportResponseDto[];

  /** The exact count over the house's exports, or null when it could not be counted — never the page length. */
  @ApiProperty({ type: Number, nullable: true })
  total: number | null;
}
