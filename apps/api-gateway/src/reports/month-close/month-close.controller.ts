import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  MonthCloseService,
  type MonthCloseDetailDto,
  type MonthCloseDto,
} from "./month-close.service";

interface Caller {
  userId?: string;
  restaurantId: string;
}

/**
 * `/reports/month-close` — F-1013, the founder's ruling of 2026-10-11:
 * option C, the snapshot close (`month-close.service.ts`).
 *
 * Owners and managers only, at the server, as the export shelf: a closed
 * month is the house's books. The house is the one on the token; nothing in a
 * path or body names it.
 *
 * ROUTE ORDER. Registered BEFORE `ReportsController` in `ReportsModule`, whose
 * `GET /reports/:id` would otherwise answer `GET /reports/month-close`.
 */
@ApiTags("reports")
@Controller("reports/month-close")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class MonthCloseController {
  constructor(private readonly closes: MonthCloseService) {}

  private fail(error: unknown, fallback: string): never {
    if (error instanceof HttpException) throw error;
    const message =
      error && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : fallback;
    throw new HttpException(
      message || fallback,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Post()
  @ApiOperation({
    summary: "Close a month: keep its figures as they stand, unchanged",
    description:
      "Body { month: 'YYYY-MM' }. Only a month that has ended on the house's clock. Keeps the till's month (and its file), the cellar's value now, the purchases delivered and the count variance. Closing a month again keeps a new version; nothing is edited.",
  })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: "Not a month, not over yet, or the house has no time zone",
  })
  async close(
    @Body() body: { month?: unknown },
    @CurrentUser() user: Caller,
  ): Promise<MonthCloseDto> {
    try {
      return await this.closes.closeMonth(
        user.restaurantId,
        user.userId ?? null,
        body?.month,
      );
    } catch (error) {
      this.fail(error, "Failed to close the month");
    }
  }

  @Get()
  @ApiOperation({
    summary: "The house's closed months, newest first, every version",
  })
  async list(
    @CurrentUser() user: Caller,
  ): Promise<{ closes: MonthCloseDto[] }> {
    try {
      return await this.closes.listCloses(user.restaurantId);
    } catch (error) {
      this.fail(error, "Failed to list the closed months");
    }
  }

  @Get(":id")
  @ApiOperation({
    summary: "One closed month, and what changed inside it after it was closed",
    description:
      "Lists the till checks, stock movements and orders dated inside the month that reached the books after the close (who, what, by how much), and sets each figure as kept against the same figure read now.",
  })
  @ApiResponse({
    status: 404,
    description: "No such closed month for this house",
  })
  async get(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: Caller,
  ): Promise<MonthCloseDetailDto> {
    try {
      return await this.closes.getClose(user.restaurantId, id);
    } catch (error) {
      this.fail(error, "Failed to read the closed month");
    }
  }

  @Get(":id/till.csv")
  @ApiOperation({
    summary: "The till's month as it was written up when the month was closed",
  })
  async tillFile(
    @Param("id", new ParseUUIDPipe()) id: string,
    @CurrentUser() user: Caller,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    try {
      const file = await this.closes.tillCsv(user.restaurantId, id);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      return new StreamableFile(Buffer.from(file.body, "utf8"), {
        type: "text/csv; charset=utf-8",
        disposition: `attachment; filename="${file.filename}"`,
      });
    } catch (error) {
      this.fail(error, "Failed to read the till file");
    }
  }
}
