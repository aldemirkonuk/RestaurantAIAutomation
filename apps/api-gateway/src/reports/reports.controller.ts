import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  GenerateReportDto,
  RefileReportDto,
  ReportCrossFileResponseDto,
  ReportListResponseDto,
  ReportResponseDto,
  ScheduleReportDto,
  ScheduledReportResponseDto,
} from "./dto/reports.dto";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post("generate")
  @ApiOperation({ summary: "Generate report" })
  @ApiResponse({ status: 201, type: ReportResponseDto })
  async generateReport(
    @Body() dto: GenerateReportDto,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<ReportResponseDto> {
    try {
      return await this.reportsService.generateReport(user.restaurantId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to generate report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: "List generated reports" })
  @ApiResponse({ status: 200, type: ReportListResponseDto })
  async listReports(
    @CurrentUser() user: { restaurantId: string },
  ): Promise<ReportListResponseDto> {
    try {
      return await this.reportsService.listReports(user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch reports",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // ── Literal routes must be declared before the `:id` wildcard ──────────────
  // Nest registers handlers in declaration order, so `@Get("schedules")` sitting
  // below `@Get(":id")` meant GET /reports/schedules was answered by getReport()
  // with reportId = "schedules" — an invalid-uuid 500 for a route the web client
  // already calls (services/api/reports.ts listReportSchedules). Found while
  // routing the Documents page through this controller for OD-45.
  @Get("schedules")
  @ApiOperation({ summary: "List scheduled reports" })
  @ApiResponse({ status: 200, type: [ScheduledReportResponseDto] })
  async listSchedules(
    @CurrentUser() user: { restaurantId: string },
  ): Promise<ScheduledReportResponseDto[]> {
    try {
      return await this.reportsService.listSchedules(user.restaurantId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch report schedules",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id")
  @ApiOperation({ summary: "Get report details" })
  @ApiResponse({ status: 200, type: ReportResponseDto })
  async getReport(
    @Param("id") reportId: string,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<ReportResponseDto> {
    try {
      return await this.reportsService.getReport(user.restaurantId, reportId);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to fetch report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/cross-file")
  @ApiOperation({
    summary:
      "Registers cross-filed with this report's period (Sorting Office)",
  })
  @ApiResponse({ status: 200, type: ReportCrossFileResponseDto })
  async getReportCrossFile(
    @Param("id") reportId: string,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<ReportCrossFileResponseDto> {
    try {
      return await this.reportsService.getReportCrossFile(
        user.restaurantId,
        reportId,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to cross-file report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(":id")
  @ApiOperation({ summary: "Re-file a report under a different type" })
  @ApiResponse({ status: 200, type: ReportResponseDto })
  async refileReport(
    @Param("id") reportId: string,
    @Body() dto: RefileReportDto,
    @CurrentUser() user: { restaurantId: string; userId?: string },
  ): Promise<ReportResponseDto> {
    try {
      return await this.reportsService.refileReport(
        user.restaurantId,
        reportId,
        dto.reportType,
        user.userId ?? null,
      );
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to refile report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(":id/download")
  @ApiOperation({ summary: "Download report file URL" })
  @ApiResponse({ status: 200, description: "Returns report download URL" })
  async downloadReport(
    @Param("id") reportId: string,
    @Query("format") format: string,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<{ url: string | null }> {
    try {
      const report = await this.reportsService.getReport(
        user.restaurantId,
        reportId,
      );
      const target = format?.toLowerCase();
      const url =
        target === "excel"
          ? report.excelUrl
          : target === "csv"
            ? report.csvUrl
            : report.pdfUrl;
      return { url: url ?? null };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to download report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("schedule")
  @ApiOperation({ summary: "Schedule recurring report" })
  @ApiResponse({ status: 201, type: ScheduledReportResponseDto })
  async scheduleReport(
    @Body() dto: ScheduleReportDto,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<ScheduledReportResponseDto> {
    try {
      return await this.reportsService.scheduleReport(user.restaurantId, dto);
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to schedule report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete("schedules/:id")
  @ApiOperation({ summary: "Delete scheduled report" })
  @ApiResponse({ status: 200, description: "Schedule deleted" })
  async deleteSchedule(
    @Param("id") scheduleId: string,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.reportsService.deleteSchedule(user.restaurantId, scheduleId);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to delete schedule",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Declared after "schedules/:id" so the two-segment literal route always wins.
  @Delete(":id")
  @ApiOperation({ summary: "Delete a generated report" })
  @ApiResponse({ status: 200, description: "Report deleted" })
  async deleteReport(
    @Param("id") reportId: string,
    @CurrentUser() user: { restaurantId: string },
  ): Promise<{ success: boolean }> {
    try {
      await this.reportsService.deleteReport(user.restaurantId, reportId);
      return { success: true };
    } catch (error) {
      throw new HttpException(
        error.message || "Failed to delete report",
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
