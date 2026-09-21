import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  REPORT_EXPORT_FORMATS,
  ReportExportListResponseDto,
  ReportExportResponseDto,
  RequestReportExportDto,
  type ReportExportFormat,
} from "../dto/report-exports.dto";
import { ReportExportsService } from "./report-exports.service";

interface Caller {
  userId?: string;
  restaurantId: string;
}

/**
 * `/reports/exports` — OD-81's real export (ADR 0149, row 20).
 *
 * Owners and managers only, at the server: an export is the house's books in a
 * file that leaves the product. The house is the one on the token; nothing in
 * a path, query or body names it.
 *
 * ROUTE ORDER. This controller is registered BEFORE `ReportsController` in
 * `ReportsModule`, because that controller's `GET /reports/:id` would otherwise
 * answer `GET /reports/exports` with id = "exports" (the same trap its own
 * `schedules` comment records). `report-exports.controller.spec.ts` boots both
 * and asserts the list reaches this one.
 *
 * An HttpException the service raised (400, 404, 409, 429) is passed through
 * as itself; anything else is a 500 with the message, never a 200.
 */
@ApiTags("reports")
@Controller("reports/exports")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class ReportExportsController {
  constructor(private readonly exportsService: ReportExportsService) {}

  private fail(error: unknown, fallback: string): never {
    if (error instanceof HttpException) throw error;
    const message =
      error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : fallback;
    throw new HttpException(message || fallback, HttpStatus.INTERNAL_SERVER_ERROR);
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Queue one cutting of the /reports sheet to be written up",
    description:
      "Answers 202 with the export as QUEUED. The gateway reads the cutting through the same analytics service the page reads, writes a CSV and a print-ready page, and moves the export to ready or failed (with the reason). A figure the engine could not compute is written as `withheld`, never as 0. 429 when three exports are already in flight for the house.",
  })
  @ApiResponse({ status: 202, type: ReportExportResponseDto })
  async request(
    @Body() dto: RequestReportExportDto,
    @CurrentUser() user: Caller,
  ): Promise<ReportExportResponseDto> {
    try {
      const started = await this.exportsService.requestExport(
        user.restaurantId,
        user.userId ?? null,
        dto,
      );
      return started.export;
    } catch (error) {
      this.fail(error, "Failed to queue the export");
    }
  }

  @Get()
  @ApiOperation({
    summary: "The house's exports, newest first, with their true status",
    description:
      "Bounded (default 20, max 100) and paged with `offset`; `total` is the exact count over every export this house has — never only the page length — or null when it could not be counted. A queued export older than ten minutes is failed, with that reason, before the list is read. At most 50 exports are kept per house (oldest trimmed on write) and none past 90 days (the daily retention sweep) — `total` reflects the store after both.",
  })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "offset", required: false })
  @ApiResponse({ status: 200, type: ReportExportListResponseDto })
  async list(
    @CurrentUser() user: Caller,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ): Promise<ReportExportListResponseDto> {
    try {
      return await this.exportsService.listExports(user.restaurantId, {
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        offset: offset ? Number.parseInt(offset, 10) : undefined,
      });
    } catch (error) {
      this.fail(error, "Failed to list exports");
    }
  }

  @Get(":id")
  @ApiOperation({ summary: "One export's status" })
  @ApiResponse({ status: 200, type: ReportExportResponseDto })
  @ApiResponse({ status: 404, description: "No such export for this house" })
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: Caller,
  ): Promise<ReportExportResponseDto> {
    try {
      return await this.exportsService.getExport(user.restaurantId, id);
    } catch (error) {
      this.fail(error, "Failed to read the export");
    }
  }

  @Post(":id/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Write a failed export again, on the same record" })
  @ApiResponse({ status: 202, type: ReportExportResponseDto })
  @ApiResponse({ status: 409, description: "The export is not failed" })
  @ApiResponse({ status: 429, description: "Three exports are already in flight for the house" })
  async retry(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: Caller,
  ): Promise<ReportExportResponseDto> {
    try {
      return (await this.exportsService.retryExport(user.restaurantId, id)).export;
    } catch (error) {
      this.fail(error, "Failed to retry the export");
    }
  }

  @Get(":id/download")
  @ApiOperation({
    summary: "The written file: format=csv or format=html (the print page)",
    description:
      "404 for an export that is not this house's; 409 while it is queued or when it failed (with the reason).",
  })
  @ApiQuery({ name: "format", required: true, enum: REPORT_EXPORT_FORMATS })
  async download(
    @Param("id", new ParseUUIDPipe()) id: string,
    @Query("format") format: string,
    @CurrentUser() user: Caller,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!(REPORT_EXPORT_FORMATS as readonly string[]).includes(format))
      throw new BadRequestException('format must be "csv" or "html".');
    try {
      const file = await this.exportsService.downloadExport(
        user.restaurantId,
        id,
        format as ReportExportFormat,
      );
      // The print page is data the house's vendors and POS typed. It is served
      // as a file with script forbidden, so a missed escape cannot run.
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; style-src 'unsafe-inline'",
      );
      res.setHeader("Cache-Control", "private, no-store");
      return new StreamableFile(Buffer.from(file.body, "utf8"), {
        type: file.contentType,
        disposition: `attachment; filename="${file.filename}"`,
      });
    } catch (error) {
      this.fail(error, "Failed to download the export");
    }
  }
}
