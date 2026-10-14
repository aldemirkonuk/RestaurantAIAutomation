import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import {
  VendorSpendService,
  type VendorSpendDto,
} from "./vendor-spend.service";

interface Caller {
  restaurantId: string;
}

/**
 * `/reports/vendor-spend` — F-1608: what the house spent with each vendor in
 * any period, received and invoiced, and the same as a file.
 *
 * Owners and managers only, at the server, as the month close and the export
 * shelf: it is the house's books. The house is the one on the token.
 *
 * ROUTE ORDER. Registered BEFORE `ReportsController` in `ReportsModule`, whose
 * `GET /reports/:id` would otherwise answer `GET /reports/vendor-spend`.
 */
@ApiTags("reports")
@Controller("reports/vendor-spend")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("owner", "manager")
export class VendorSpendController {
  constructor(private readonly spend: VendorSpendService) {}

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

  @Get()
  @ApiOperation({
    summary: "Spend by vendor for a period: received and invoiced, per vendor",
    description:
      "from and to are house dates (YYYY-MM-DD), both included, at most three years apart. Received is the delivered orders at their totals, as the month close counts them; invoiced is the invoices dated in the period at their printed totals. Each is kept per currency; nothing is converted.",
  })
  @ApiQuery({ name: "from", required: true })
  @ApiQuery({ name: "to", required: true })
  async read(
    @Query("from") from: string,
    @Query("to") to: string,
    @CurrentUser() user: Caller,
  ): Promise<VendorSpendDto> {
    try {
      const {
        houseName: _name,
        locale: _locale,
        ...dto
      } = await this.spend.read(user.restaurantId, from, to);
      return dto;
    } catch (error) {
      this.fail(error, "Failed to read the spend by vendor");
    }
  }

  @Get("file.csv")
  @ApiOperation({
    summary: "Spend by vendor for a period, as a spreadsheet file",
  })
  @ApiQuery({ name: "from", required: true })
  @ApiQuery({ name: "to", required: true })
  async file(
    @Query("from") from: string,
    @Query("to") to: string,
    @CurrentUser() user: Caller,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    try {
      const file = await this.spend.csv(user.restaurantId, from, to);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "private, no-store");
      return new StreamableFile(Buffer.from(file.body, "utf8"), {
        type: "text/csv; charset=utf-8",
        disposition: `attachment; filename="${file.filename}"`,
      });
    } catch (error) {
      this.fail(error, "Failed to write the spend by vendor file");
    }
  }
}
